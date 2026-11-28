import {
  buildProjectTodoBodyPreview,
  IsoDateTime,
  NonNegativeInt,
  PositiveInt,
  PROJECT_TODO_CALENDAR_MAX_BYTES,
  PROJECT_TODO_CALENDAR_MAX_ITEMS,
  PROJECT_TODO_DAILY_REVIEW_BUCKET_LIMIT,
  PROJECT_TODO_DAILY_REVIEW_MAX_BYTES,
  PROJECT_TODO_LIST_MAX_BYTES,
  PROJECT_TODO_MAX_BODY_BYTES,
  PROJECT_TODO_MAX_FILE_REFS,
  PROJECT_TODO_MAX_FILE_REF_LENGTH,
  PROJECT_TODO_MAX_LIST_LIMIT,
  PROJECT_TODO_MAX_TITLE_LENGTH,
  ProjectId,
  ProjectTodoConflictError,
  type ProjectTodoCreatedBy,
  type ProjectTodoCreateInput,
  type ProjectTodoCreateResult,
  type ProjectTodoDailyReviewInput,
  type ProjectTodoDailyReviewResult,
  type ProjectTodoDeleteInput,
  type ProjectTodoDeleteResult,
  type ProjectTodoError,
  type ProjectTodoGetInput,
  type ProjectTodoGetResult,
  ProjectTodoId,
  type ProjectTodoItem,
  type ProjectTodoKind,
  type ProjectTodoListInput,
  type ProjectTodoListResult,
  ProjectTodoNotFoundError,
  ProjectTodoOperationError,
  type ProjectTodoPriority,
  type ProjectTodoSummary,
  type ProjectTodoUpdateInput,
  type ProjectTodoUpdateResult,
  ProjectTodoValidationError,
  ThreadId,
  utf8ByteLength,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type * as SqlClient from "effect/sql/SqlClient";

import * as Orchestrator from "../../orchestration-v2/Orchestrator.ts";
import * as ProjectService from "../../project/ProjectService.ts";
import * as T4Sqlite from "../persistence/T4Sqlite.ts";

interface TodoRow {
  readonly id: string;
  readonly project_id: string;
  readonly kind: string;
  readonly title: string;
  readonly body: string;
  readonly priority: string;
  readonly pinned: number;
  readonly source_thread_id: string | null;
  readonly linked_thread_id: string | null;
  readonly file_refs_json: string;
  readonly created_by: string;
  readonly revision: number;
  readonly created_at: string;
  readonly updated_at: string;
  readonly completed_at: string | null;
  readonly archived_at: string | null;
}

export interface ProjectTodoWriteActor {
  readonly createdBy: ProjectTodoCreatedBy;
  readonly sourceThreadId?: ThreadId | null;
}

const DEFAULT_STALE_DAYS = 7;

const FileRefsJsonCodec = Schema.fromJsonString(Schema.Array(Schema.String));
const encodeFileRefsJson = Schema.encodeSync(FileRefsJsonCodec);
const decodeFileRefsJson = Schema.decodeUnknownSync(FileRefsJsonCodec);
const SummaryJsonCodec = Schema.fromJsonString(Schema.Unknown);
const encodeSummaryJson = Schema.encodeSync(SummaryJsonCodec);
const summaryByteLength = (summary: ProjectTodoSummary): number =>
  utf8ByteLength(encodeSummaryJson(summary));

function parseFileRefs(raw: string): ReadonlyArray<string> {
  try {
    return decodeFileRefsJson(raw);
  } catch {
    return [];
  }
}

function rowToItem(row: TodoRow): ProjectTodoItem {
  return {
    id: ProjectTodoId.make(row.id),
    projectId: ProjectId.make(row.project_id),
    kind: row.kind === "note" ? "note" : "todo",
    title: row.title,
    body: row.body,
    priority: row.priority === "high" ? "high" : "normal",
    pinned: Number(row.pinned) !== 0,
    sourceThreadId: row.source_thread_id === null ? null : ThreadId.make(row.source_thread_id),
    linkedThreadId: row.linked_thread_id === null ? null : ThreadId.make(row.linked_thread_id),
    fileRefs: parseFileRefs(row.file_refs_json),
    createdBy: row.created_by === "agent" ? "agent" : "user",
    revision: PositiveInt.make(Math.max(1, Number(row.revision))),
    createdAt: IsoDateTime.make(row.created_at),
    updatedAt: IsoDateTime.make(row.updated_at),
    completedAt: row.completed_at === null ? null : IsoDateTime.make(row.completed_at),
    archivedAt: row.archived_at === null ? null : IsoDateTime.make(row.archived_at),
  };
}

function rowToSummary(row: TodoRow): ProjectTodoSummary {
  const item = rowToItem(row);
  const { body, ...rest } = item;
  return {
    ...rest,
    bodyPreview: buildProjectTodoBodyPreview(body),
    hasBody: body.trim().length > 0,
  };
}

function normalizeAndValidateTitle(
  title: string,
): Effect.Effect<string, ProjectTodoValidationError> {
  const trimmed = title.trim();
  if (trimmed.length === 0) {
    return Effect.fail(new ProjectTodoValidationError({ detail: "Title must not be empty." }));
  }
  if (trimmed.length > PROJECT_TODO_MAX_TITLE_LENGTH) {
    return Effect.fail(
      new ProjectTodoValidationError({
        detail: `Title must be at most ${PROJECT_TODO_MAX_TITLE_LENGTH} characters.`,
      }),
    );
  }
  return Effect.succeed(trimmed);
}

function validateBody(body: string): Effect.Effect<string, ProjectTodoValidationError> {
  const bytes = utf8ByteLength(body);
  if (bytes > PROJECT_TODO_MAX_BODY_BYTES) {
    return Effect.fail(
      new ProjectTodoValidationError({
        detail: `Body exceeds the ${PROJECT_TODO_MAX_BODY_BYTES}-byte UTF-8 limit (${bytes} bytes).`,
      }),
    );
  }
  return Effect.succeed(body);
}

function normalizeAndValidateFileRefs(
  refs: ReadonlyArray<string>,
): Effect.Effect<ReadonlyArray<string>, ProjectTodoValidationError> {
  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const raw of refs) {
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue;
    if (trimmed.length > PROJECT_TODO_MAX_FILE_REF_LENGTH) {
      return Effect.fail(
        new ProjectTodoValidationError({
          detail: `File reference exceeds ${PROJECT_TODO_MAX_FILE_REF_LENGTH} characters.`,
        }),
      );
    }
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    deduped.push(trimmed);
    if (deduped.length > PROJECT_TODO_MAX_FILE_REFS) {
      return Effect.fail(
        new ProjectTodoValidationError({
          detail: `At most ${PROJECT_TODO_MAX_FILE_REFS} file references are allowed.`,
        }),
      );
    }
  }
  return Effect.succeed(deduped);
}

function escapeLikePattern(query: string): string {
  return query.replace(/[\\%_]/gu, (match) => `\\${match}`);
}

function isUniqueConstraintError(cause: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = cause;
  while (current !== null && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const record = current as {
      readonly message?: unknown;
      readonly errcode?: unknown;
      readonly cause?: unknown;
    };
    if (
      typeof record.errcode === "number" &&
      (record.errcode === 1555 || record.errcode === 2067 || record.errcode === 19)
    ) {
      return true;
    }
    if (typeof record.message === "string" && /UNIQUE constraint failed/i.test(record.message)) {
      return true;
    }
    current = record.cause;
  }
  return false;
}

const toOperationError =
  (operation: string) =>
  (cause: unknown): ProjectTodoOperationError =>
    new ProjectTodoOperationError({
      operation,
      detail: cause instanceof Error ? cause.message : String(cause),
    });

export class ProjectTodoService extends Context.Service<
  ProjectTodoService,
  {
    readonly list: (
      input: ProjectTodoListInput,
    ) => Effect.Effect<ProjectTodoListResult, ProjectTodoError>;
    readonly get: (
      input: ProjectTodoGetInput,
    ) => Effect.Effect<ProjectTodoGetResult, ProjectTodoError>;
    readonly dailyReview: (
      input: ProjectTodoDailyReviewInput,
    ) => Effect.Effect<ProjectTodoDailyReviewResult, ProjectTodoError>;
    readonly create: (
      input: ProjectTodoCreateInput,
      actor?: ProjectTodoWriteActor,
    ) => Effect.Effect<ProjectTodoCreateResult, ProjectTodoError>;
    readonly update: (
      input: ProjectTodoUpdateInput,
    ) => Effect.Effect<ProjectTodoUpdateResult, ProjectTodoError>;
    readonly remove: (
      input: ProjectTodoDeleteInput,
    ) => Effect.Effect<ProjectTodoDeleteResult, ProjectTodoError>;
  }
>()("t3/t4/todo/ProjectTodoService") {}

const make = Effect.gen(function* () {
  const t4Sqlite = yield* T4Sqlite.T4Sqlite;
  const projectService = yield* ProjectService.ProjectService;
  const orchestrator = yield* Orchestrator.OrchestratorV2;

  const requireActiveProject = Effect.fn("ProjectTodoService.requireActiveProject")(function* (
    projectId: ProjectId,
  ) {
    const project = yield* projectService
      .getById(projectId)
      .pipe(Effect.mapError(toOperationError("resolveProject")));
    if (Option.isNone(project)) {
      return yield* new ProjectTodoValidationError({
        detail: `Project '${projectId}' does not exist or has been deleted.`,
      });
    }
    return project.value;
  });

  const requireSameProjectThread = Effect.fn("ProjectTodoService.requireSameProjectThread")(
    function* (projectId: ProjectId, threadId: ThreadId, fieldName: string) {
      const shell = yield* orchestrator
        .getThreadShell(threadId)
        .pipe(Effect.mapError(toOperationError("resolveThread")));
      if (shell === null || shell.deletedAt !== null) {
        return yield* new ProjectTodoValidationError({
          detail: `${fieldName} '${threadId}' does not exist or has been deleted.`,
        });
      }
      if (shell.projectId !== projectId) {
        return yield* new ProjectTodoValidationError({
          detail: `${fieldName} '${threadId}' does not belong to project '${projectId}'.`,
        });
      }
      return shell;
    },
  );

  const selectRowById = Effect.fn("ProjectTodoService.selectRowById")(function* (
    sql: SqlClient.SqlClient,
    id: ProjectTodoId,
  ) {
    const rows = yield* sql<TodoRow>`
      SELECT * FROM t4_project_todos WHERE id = ${id} LIMIT 1
    `.pipe(Effect.mapError(toOperationError("select")));
    return rows[0] ?? null;
  });

  const list = Effect.fn("ProjectTodoService.list")(function* (input: ProjectTodoListInput) {
    yield* requireActiveProject(input.projectId);
    const sql = yield* t4Sqlite.getClient;

    const limit = Math.min(
      Math.max(1, input.limit ?? PROJECT_TODO_MAX_LIST_LIMIT),
      PROJECT_TODO_MAX_LIST_LIMIT,
    );
    const state = input.state ?? "open";
    const queryText = (input.query ?? "").trim();

    const conditions: string[] = ["project_id = ?"];
    const params: Array<string | number> = [input.projectId];

    if (state === "open") {
      conditions.push("archived_at IS NULL AND completed_at IS NULL");
    } else if (state === "completed") {
      conditions.push("archived_at IS NULL AND completed_at IS NOT NULL");
    } else if (state === "archived") {
      conditions.push("archived_at IS NOT NULL");
    }

    if (input.kind !== undefined) {
      conditions.push("kind = ?");
      params.push(input.kind);
    }

    if (input.pinnedOnly === true) {
      conditions.push("pinned = 1");
    }

    if (queryText.length > 0) {
      const escaped = `%${escapeLikePattern(queryText)}%`;
      conditions.push("(title LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\')");
      params.push(escaped, escaped);
    }

    if (input.cursor != null) {
      conditions.push("(created_at < ? OR (created_at = ? AND id < ?))");
      params.push(input.cursor.createdAt, input.cursor.createdAt, input.cursor.id);
    }

    const fetchLimit = limit + 1;
    params.push(fetchLimit);

    const rows = yield* sql
      .unsafe<TodoRow>(
        `SELECT * FROM t4_project_todos WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC, id DESC LIMIT ?`,
        params,
      )
      .pipe(Effect.mapError(toOperationError("list")));

    const hasMoreFromSql = rows.length > limit;
    const candidates = hasMoreFromSql ? rows.slice(0, limit) : rows;

    const items: ProjectTodoSummary[] = [];
    // Account for envelope overhead so the full serialized response stays within the 32 KiB page budget.
    let usedBytes = 128;
    let truncatedByBytes = false;

    for (const row of candidates) {
      const summary = rowToSummary(row);
      const itemBytes = summaryByteLength(summary) + 1;
      if (items.length > 0 && usedBytes + itemBytes > PROJECT_TODO_LIST_MAX_BYTES) {
        truncatedByBytes = true;
        break;
      }
      items.push(summary);
      usedBytes += itemBytes;
    }

    const hasMore = hasMoreFromSql || truncatedByBytes;
    const last = items[items.length - 1];
    return {
      items,
      nextCursor: hasMore && last !== undefined ? { createdAt: last.createdAt, id: last.id } : null,
      hasMore,
    } satisfies ProjectTodoListResult;
  });

  const get = Effect.fn("ProjectTodoService.get")(function* (input: ProjectTodoGetInput) {
    yield* requireActiveProject(input.projectId);
    const sql = yield* t4Sqlite.getClient;
    const row = yield* selectRowById(sql, input.id);
    if (row === null || row.project_id !== input.projectId) {
      return yield* new ProjectTodoNotFoundError({
        todoId: input.id,
        projectId: input.projectId,
      });
    }
    return { item: rowToItem(row) } satisfies ProjectTodoGetResult;
  });

  const dailyReview = Effect.fn("ProjectTodoService.dailyReview")(function* (
    input: ProjectTodoDailyReviewInput,
  ) {
    const startMs = Date.parse(input.dayStartIso);
    const endMs = Date.parse(input.dayEndIso);
    if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) {
      return yield* new ProjectTodoValidationError({
        detail: "dayEndIso must be strictly after dayStartIso.",
      });
    }

    let allowedProjectIds: ReadonlySet<string> | null = null;
    if (input.projectId !== undefined) {
      yield* requireActiveProject(input.projectId);
      allowedProjectIds = new Set([input.projectId]);
    } else {
      const snapshot = yield* projectService.snapshot.pipe(
        Effect.mapError(toOperationError("listActiveProjects")),
      );
      allowedProjectIds = new Set(
        snapshot.projects
          .filter((project) => project.deletedAt === null)
          .map((project) => project.id),
      );
    }

    const sql = yield* t4Sqlite.getClient;
    const staleDays = input.staleDays ?? DEFAULT_STALE_DAYS;
    const staleCutoffIso = DateTime.formatIso(
      DateTime.subtract(DateTime.makeUnsafe(startMs), { days: staleDays }),
    );

    const projectFilterSql = input.projectId !== undefined ? "AND project_id = ?" : "";
    const projectFilterParams: ReadonlyArray<string> =
      input.projectId !== undefined ? [input.projectId] : [];
    const fetchCap = PROJECT_TODO_DAILY_REVIEW_BUCKET_LIMIT * 2;

    const queryBucket = (
      whereClause: string,
      orderBy: string,
      params: ReadonlyArray<string | number>,
    ) =>
      sql
        .unsafe<TodoRow>(
          `SELECT * FROM t4_project_todos WHERE ${whereClause} ${projectFilterSql} ORDER BY ${orderBy} LIMIT ?`,
          [...params, ...projectFilterParams, fetchCap],
        )
        .pipe(Effect.mapError(toOperationError("dailyReview")));

    const rangeStartMs =
      input.rangeStartIso !== undefined ? Date.parse(input.rangeStartIso) : Number.NaN;
    const rangeEndMs = input.rangeEndIso !== undefined ? Date.parse(input.rangeEndIso) : Number.NaN;
    const hasValidActivityRange =
      input.rangeStartIso !== undefined &&
      input.rangeEndIso !== undefined &&
      Number.isFinite(rangeStartMs) &&
      Number.isFinite(rangeEndMs) &&
      rangeEndMs > rangeStartMs &&
      rangeEndMs - rangeStartMs <= 45 * 24 * 60 * 60 * 1000;

    const queryCalendarRows = () =>
      hasValidActivityRange
        ? sql
            .unsafe<TodoRow>(
              `SELECT *
               FROM t4_project_todos
               WHERE archived_at IS NULL
                 AND ((created_at >= ? AND created_at < ?) OR (completed_at IS NOT NULL AND completed_at >= ? AND completed_at < ?))
                 ${projectFilterSql}
               ORDER BY created_at DESC, id DESC
               LIMIT ?`,
              [
                input.rangeStartIso!,
                input.rangeEndIso!,
                input.rangeStartIso!,
                input.rangeEndIso!,
                ...projectFilterParams,
                PROJECT_TODO_CALENDAR_MAX_ITEMS + 1,
              ],
            )
            .pipe(Effect.mapError(toOperationError("dailyReview")))
        : Effect.succeed<ReadonlyArray<TodoRow>>([]);

    const [capturedRows, completedRows, linkedRows, staleRows, pinnedRows, calendarRows] =
      yield* Effect.all([
        queryBucket(
          "created_at >= ? AND created_at < ? AND archived_at IS NULL",
          "created_at DESC, id DESC",
          [input.dayStartIso, input.dayEndIso],
        ),
        queryBucket(
          "completed_at IS NOT NULL AND completed_at >= ? AND completed_at < ? AND archived_at IS NULL",
          "completed_at DESC, id DESC",
          [input.dayStartIso, input.dayEndIso],
        ),
        queryBucket(
          "linked_thread_id IS NOT NULL AND completed_at IS NULL AND archived_at IS NULL",
          "updated_at DESC, id DESC",
          [],
        ),
        queryBucket(
          "kind = 'todo' AND completed_at IS NULL AND archived_at IS NULL AND created_at < ?",
          "created_at ASC, id ASC",
          [staleCutoffIso],
        ),
        queryBucket("pinned = 1 AND archived_at IS NULL", "updated_at DESC, id DESC", []),
        queryCalendarRows(),
      ]);

    const visibleCalendarRows = hasValidActivityRange
      ? calendarRows.filter(
          (row) => allowedProjectIds === null || allowedProjectIds.has(row.project_id),
        )
      : [];

    const activityPoints = hasValidActivityRange
      ? visibleCalendarRows.slice(0, PROJECT_TODO_CALENDAR_MAX_ITEMS).map((row) => ({
          createdAt: IsoDateTime.make(row.created_at),
          completedAt: row.completed_at !== null ? IsoDateTime.make(row.completed_at) : null,
        }))
      : undefined;

    let calendarItems: ProjectTodoSummary[] | undefined;
    let calendarTruncated: boolean | undefined;
    if (hasValidActivityRange) {
      calendarItems = [];
      calendarTruncated = visibleCalendarRows.length > PROJECT_TODO_CALENDAR_MAX_ITEMS;
      let calendarBytes = 64;
      for (const row of visibleCalendarRows.slice(0, PROJECT_TODO_CALENDAR_MAX_ITEMS)) {
        const summary = rowToSummary(row);
        const itemBytes = summaryByteLength(summary) + 1;
        if (
          calendarItems.length > 0 &&
          calendarBytes + itemBytes > PROJECT_TODO_CALENDAR_MAX_BYTES
        ) {
          calendarTruncated = true;
          break;
        }
        calendarItems.push(summary);
        calendarBytes += itemBytes;
      }
    }

    const filterActive = (rows: ReadonlyArray<TodoRow>) =>
      rows
        .filter((row) => allowedProjectIds === null || allowedProjectIds.has(row.project_id))
        .slice(0, PROJECT_TODO_DAILY_REVIEW_BUCKET_LIMIT)
        .map(rowToSummary);

    const rawBuckets = {
      capturedToday: filterActive(capturedRows),
      completedToday: filterActive(completedRows),
      linkedActive: filterActive(linkedRows),
      staleOpen: filterActive(staleRows),
      pinnedNotes: filterActive(pinnedRows),
    };

    const result = {
      capturedToday: [] as ProjectTodoSummary[],
      completedToday: [] as ProjectTodoSummary[],
      linkedActive: [] as ProjectTodoSummary[],
      staleOpen: [] as ProjectTodoSummary[],
      pinnedNotes: [] as ProjectTodoSummary[],
    };

    let usedBytes = 256;
    let truncated =
      capturedRows.length > PROJECT_TODO_DAILY_REVIEW_BUCKET_LIMIT ||
      completedRows.length > PROJECT_TODO_DAILY_REVIEW_BUCKET_LIMIT ||
      linkedRows.length > PROJECT_TODO_DAILY_REVIEW_BUCKET_LIMIT ||
      staleRows.length > PROJECT_TODO_DAILY_REVIEW_BUCKET_LIMIT ||
      pinnedRows.length > PROJECT_TODO_DAILY_REVIEW_BUCKET_LIMIT;

    const bucketKeys = [
      "capturedToday",
      "completedToday",
      "linkedActive",
      "staleOpen",
      "pinnedNotes",
    ] as const;

    // Round-robin fill across buckets so no single bucket starves the others when approaching the 64 KiB cap.
    for (let index = 0; index < PROJECT_TODO_DAILY_REVIEW_BUCKET_LIMIT; index++) {
      for (const key of bucketKeys) {
        const candidate = rawBuckets[key][index];
        if (candidate === undefined) continue;
        const itemBytes = summaryByteLength(candidate) + 1;
        if (usedBytes + itemBytes > PROJECT_TODO_DAILY_REVIEW_MAX_BYTES) {
          truncated = true;
          continue;
        }
        result[key].push(candidate);
        usedBytes += itemBytes;
      }
    }

    return {
      ...result,
      ...(activityPoints !== undefined ? { activityPoints } : {}),
      ...(calendarItems !== undefined ? { calendarItems } : {}),
      ...(calendarTruncated !== undefined ? { calendarTruncated } : {}),
      truncated,
    } satisfies ProjectTodoDailyReviewResult;
  });

  const create = Effect.fn("ProjectTodoService.create")(function* (
    input: ProjectTodoCreateInput,
    actor: ProjectTodoWriteActor = { createdBy: "user" },
  ) {
    yield* requireActiveProject(input.projectId);
    const title = yield* normalizeAndValidateTitle(input.title);
    const body = yield* validateBody(input.body ?? "");
    const fileRefs = yield* normalizeAndValidateFileRefs(input.fileRefs ?? []);
    const kind: ProjectTodoKind = input.kind ?? "todo";
    const priority: ProjectTodoPriority = input.priority ?? "normal";
    const pinned = input.pinned === true;

    const sourceThreadId =
      actor.sourceThreadId !== undefined ? actor.sourceThreadId : (input.sourceThreadId ?? null);
    if (sourceThreadId !== null) {
      yield* requireSameProjectThread(input.projectId, sourceThreadId, "sourceThreadId");
    }

    const linkedThreadId = input.linkedThreadId ?? null;
    if (linkedThreadId !== null) {
      yield* requireSameProjectThread(input.projectId, linkedThreadId, "linkedThreadId");
    }

    const sql = yield* t4Sqlite.getClient;
    const nowIso = DateTime.formatIso(yield* DateTime.now);

    const insertResult = yield* sql`
      INSERT INTO t4_project_todos (
        id,
        project_id,
        kind,
        title,
        body,
        priority,
        pinned,
        source_thread_id,
        linked_thread_id,
        file_refs_json,
        created_by,
        revision,
        created_at,
        updated_at,
        completed_at,
        archived_at
      ) VALUES (
        ${input.id},
        ${input.projectId},
        ${kind},
        ${title},
        ${body},
        ${priority},
        ${pinned ? 1 : 0},
        ${sourceThreadId},
        ${linkedThreadId},
        ${encodeFileRefsJson(fileRefs)},
        ${actor.createdBy},
        1,
        ${nowIso},
        ${nowIso},
        NULL,
        NULL
      )
    `.pipe(
      Effect.as("inserted" as const),
      Effect.catch((cause) =>
        isUniqueConstraintError(cause)
          ? Effect.succeed("conflict" as const)
          : Effect.fail(toOperationError("create")(cause)),
      ),
    );

    const stored = yield* selectRowById(sql, input.id);
    if (stored === null) {
      return yield* new ProjectTodoOperationError({
        operation: "create",
        detail: `Todo '${input.id}' was not readable after insert.`,
      });
    }
    if (stored.project_id !== input.projectId) {
      return yield* new ProjectTodoValidationError({
        detail: `Todo id '${input.id}' already belongs to another project.`,
      });
    }
    return {
      item: rowToItem(stored),
      created: insertResult === "inserted",
    } satisfies ProjectTodoCreateResult;
  });

  const update = Effect.fn("ProjectTodoService.update")(function* (input: ProjectTodoUpdateInput) {
    yield* requireActiveProject(input.projectId);
    const sql = yield* t4Sqlite.getClient;

    const existingRow = yield* selectRowById(sql, input.id);
    if (existingRow === null || existingRow.project_id !== input.projectId) {
      return yield* new ProjectTodoNotFoundError({
        todoId: input.id,
        projectId: input.projectId,
      });
    }

    const current = rowToItem(existingRow);
    if (current.revision !== input.expectedRevision) {
      return yield* new ProjectTodoConflictError({
        todoId: input.id,
        expectedRevision: NonNegativeInt.make(input.expectedRevision),
        actualRevision: NonNegativeInt.make(current.revision),
      });
    }

    const nextTitle =
      input.title !== undefined ? yield* normalizeAndValidateTitle(input.title) : current.title;
    const nextBody = input.body !== undefined ? yield* validateBody(input.body) : current.body;
    const nextKind = input.kind ?? current.kind;
    const nextPriority = input.priority ?? current.priority;
    const nextPinned = input.pinned ?? current.pinned;
    const nextFileRefs =
      input.fileRefs !== undefined
        ? yield* normalizeAndValidateFileRefs(input.fileRefs)
        : current.fileRefs;

    let nextLinkedThreadId = current.linkedThreadId;
    if (input.linkedThreadId !== undefined) {
      if (input.linkedThreadId !== null) {
        yield* requireSameProjectThread(input.projectId, input.linkedThreadId, "linkedThreadId");
      }
      nextLinkedThreadId = input.linkedThreadId;
    }

    const nowIso = DateTime.formatIso(yield* DateTime.now);
    const nextCompletedAt =
      input.completed === undefined
        ? current.completedAt
        : input.completed
          ? (current.completedAt ?? nowIso)
          : null;
    const nextArchivedAt =
      input.archived === undefined
        ? current.archivedAt
        : input.archived
          ? (current.archivedAt ?? nowIso)
          : null;
    const nextRevision = current.revision + 1;

    const updatedRows = yield* sql<TodoRow>`
      UPDATE t4_project_todos
      SET
        kind = ${nextKind},
        title = ${nextTitle},
        body = ${nextBody},
        priority = ${nextPriority},
        pinned = ${nextPinned ? 1 : 0},
        linked_thread_id = ${nextLinkedThreadId},
        file_refs_json = ${encodeFileRefsJson(nextFileRefs)},
        revision = ${nextRevision},
        updated_at = ${nowIso},
        completed_at = ${nextCompletedAt},
        archived_at = ${nextArchivedAt}
      WHERE id = ${input.id}
        AND project_id = ${input.projectId}
        AND revision = ${input.expectedRevision}
      RETURNING *
    `.pipe(Effect.mapError(toOperationError("update")));

    const updated = updatedRows[0];
    if (updated === undefined) {
      const latest = yield* selectRowById(sql, input.id);
      if (latest === null || latest.project_id !== input.projectId) {
        return yield* new ProjectTodoNotFoundError({
          todoId: input.id,
          projectId: input.projectId,
        });
      }
      return yield* new ProjectTodoConflictError({
        todoId: input.id,
        expectedRevision: NonNegativeInt.make(input.expectedRevision),
        actualRevision: NonNegativeInt.make(Number(latest.revision)),
      });
    }

    return { item: rowToItem(updated) } satisfies ProjectTodoUpdateResult;
  });

  const remove = Effect.fn("ProjectTodoService.remove")(function* (input: ProjectTodoDeleteInput) {
    yield* requireActiveProject(input.projectId);
    const sql = yield* t4Sqlite.getClient;

    const deletedRows = yield* sql<{ readonly id: string }>`
      DELETE FROM t4_project_todos
      WHERE id = ${input.id}
        AND project_id = ${input.projectId}
        AND revision = ${input.expectedRevision}
      RETURNING id
    `.pipe(Effect.mapError(toOperationError("delete")));

    if (deletedRows.length > 0) {
      return { deleted: true } satisfies ProjectTodoDeleteResult;
    }

    const latest = yield* selectRowById(sql, input.id);
    if (latest === null || latest.project_id !== input.projectId) {
      // Idempotent retry: already removed.
      return { deleted: false } satisfies ProjectTodoDeleteResult;
    }

    return yield* new ProjectTodoConflictError({
      todoId: input.id,
      expectedRevision: NonNegativeInt.make(input.expectedRevision),
      actualRevision: NonNegativeInt.make(Number(latest.revision)),
    });
  });

  return ProjectTodoService.of({
    list,
    get,
    dailyReview,
    create,
    update,
    remove,
  });
});

export const layer = Layer.effect(ProjectTodoService, make);
