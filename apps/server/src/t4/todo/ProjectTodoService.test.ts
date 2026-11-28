import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  IsoDateTime,
  PositiveInt,
  PROJECT_TODO_LIST_MAX_BYTES,
  PROJECT_TODO_MAX_BODY_BYTES,
  ProjectId,
  ProjectTodoId,
  ThreadId,
  utf8ByteLength,
  type OrchestrationV2ThreadShell,
  type Project,
  type ProjectTodoCursor,
  type ProjectTodoListResult,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import { OrchestratorV2 } from "../../orchestration-v2/Orchestrator.ts";
import { ProjectService } from "../../project/ProjectService.ts";
import * as T4Sqlite from "../persistence/T4Sqlite.ts";
import * as ProjectTodoService from "./ProjectTodoService.ts";

const PROJECT_A = ProjectId.make("project-a");
const PROJECT_B = ProjectId.make("project-b");
const DELETED_PROJECT = ProjectId.make("project-deleted");
const THREAD_A1 = ThreadId.make("thread-a1");
const THREAD_B1 = ThreadId.make("thread-b1");

function makeMockProject(id: ProjectId): Project {
  return {
    id,
    title: `Project ${id}`,
    workspaceRoot: `/tmp/${id}`,
    defaultModelSelection: null,
    scripts: [],
    createdAt: IsoDateTime.make("2026-11-20T00:00:00.000Z"),
    updatedAt: IsoDateTime.make("2026-11-20T00:00:00.000Z"),
    deletedAt: null,
  } as unknown as Project;
}

function makeMockThreadShell(id: ThreadId, projectId: ProjectId): OrchestrationV2ThreadShell {
  return {
    id,
    projectId,
    title: `Thread ${id}`,
    deletedAt: null,
    archivedAt: null,
  } as unknown as OrchestrationV2ThreadShell;
}

const mockProjects = new Map<ProjectId, Project>([
  [PROJECT_A, makeMockProject(PROJECT_A)],
  [PROJECT_B, makeMockProject(PROJECT_B)],
]);

const mockThreads = new Map<ThreadId, OrchestrationV2ThreadShell>([
  [THREAD_A1, makeMockThreadShell(THREAD_A1, PROJECT_A)],
  [THREAD_B1, makeMockThreadShell(THREAD_B1, PROJECT_B)],
]);

const layerMockCore = Layer.mergeAll(
  Layer.mock(ProjectService)({
    getById: (projectId) => Effect.succeed(Option.fromNullishOr(mockProjects.get(projectId))),
    snapshot: Effect.succeed({
      snapshotSequence: 1,
      projects: [...mockProjects.values()],
      updatedAt: IsoDateTime.make("2026-11-27T00:00:00.000Z"),
    } as never),
  }),
  Layer.mock(OrchestratorV2)({
    getThreadShell: (threadId) => Effect.succeed(mockThreads.get(threadId) ?? null),
  }),
);

const layerMemoryService = ProjectTodoService.layer.pipe(
  Layer.provide(T4Sqlite.layerMemory),
  Layer.provide(layerMockCore),
);

it.effect(
  "supports idempotent create, orthogonal complete/archive, revision conflict, and delete",
  () =>
    Effect.gen(function* () {
      const todos = yield* ProjectTodoService.ProjectTodoService;
      const id = ProjectTodoId.make("todo-1");

      const first = yield* todos.create({
        id,
        projectId: PROJECT_A,
        title: "  Add cache eviction limit  ",
        body: "Cap LRU cache at 500 entries",
        kind: "todo",
        priority: "high",
        pinned: true,
        sourceThreadId: THREAD_A1,
        fileRefs: ["apps/server/src/cache.ts", "apps/server/src/cache.ts"],
      });
      expect(first.created).toBe(true);
      expect(first.item.title).toBe("Add cache eviction limit");
      expect(first.item.revision).toBe(1);
      expect(first.item.fileRefs).toEqual(["apps/server/src/cache.ts"]);
      expect(first.item.createdBy).toBe("user");

      // Idempotent retry with same ID in same project returns existing item with created=false.
      const retry = yield* todos.create({
        id,
        projectId: PROJECT_A,
        title: "Different title ignored on duplicate",
      });
      expect(retry.created).toBe(false);
      expect(retry.item.title).toBe("Add cache eviction limit");

      // Same ID in another project is rejected.
      const crossProject = yield* todos
        .create({ id, projectId: PROJECT_B, title: "Hijack attempt" })
        .pipe(Effect.flip);
      expect(crossProject._tag).toBe("ProjectTodoValidationError");

      // Complete -> archive -> restore preserves completedAt.
      const completed = yield* todos.update({
        id,
        projectId: PROJECT_A,
        expectedRevision: PositiveInt.make(1),
        completed: true,
        linkedThreadId: THREAD_A1,
      });
      expect(completed.item.revision).toBe(2);
      expect(completed.item.completedAt).not.toBeNull();
      expect(completed.item.archivedAt).toBeNull();
      expect(completed.item.linkedThreadId).toBe(THREAD_A1);

      // Stale revision fails with ProjectTodoConflictError.
      const conflict = yield* todos
        .update({
          id,
          projectId: PROJECT_A,
          expectedRevision: PositiveInt.make(1),
          title: "Stale write",
        })
        .pipe(Effect.flip);
      expect(conflict._tag).toBe("ProjectTodoConflictError");

      const archived = yield* todos.update({
        id,
        projectId: PROJECT_A,
        expectedRevision: PositiveInt.make(2),
        archived: true,
      });
      expect(archived.item.completedAt).toBe(completed.item.completedAt);
      expect(archived.item.archivedAt).not.toBeNull();

      const restored = yield* todos.update({
        id,
        projectId: PROJECT_A,
        expectedRevision: PositiveInt.make(3),
        archived: false,
      });
      expect(restored.item.completedAt).toBe(completed.item.completedAt);
      expect(restored.item.archivedAt).toBeNull();

      // Delete with stale revision conflicts; matching revision deletes; retry is idempotent.
      const deleteConflict = yield* todos
        .remove({ id, projectId: PROJECT_A, expectedRevision: PositiveInt.make(3) })
        .pipe(Effect.flip);
      expect(deleteConflict._tag).toBe("ProjectTodoConflictError");

      const deleted = yield* todos.remove({
        id,
        projectId: PROJECT_A,
        expectedRevision: PositiveInt.make(4),
      });
      expect(deleted.deleted).toBe(true);

      const deletedRetry = yield* todos.remove({
        id,
        projectId: PROJECT_A,
        expectedRevision: PositiveInt.make(4),
      });
      expect(deletedRetry.deleted).toBe(false);
    }).pipe(Effect.provide(layerMemoryService)),
);

it.effect("rejects deleted projects, cross-project threads, and oversized bodies", () =>
  Effect.gen(function* () {
    const todos = yield* ProjectTodoService.ProjectTodoService;

    const deletedProjectErr = yield* todos
      .create({
        id: ProjectTodoId.make("todo-del-proj"),
        projectId: DELETED_PROJECT,
        title: "Should fail",
      })
      .pipe(Effect.flip);
    expect(deletedProjectErr._tag).toBe("ProjectTodoValidationError");

    const crossThreadErr = yield* todos
      .create({
        id: ProjectTodoId.make("todo-cross-thread"),
        projectId: PROJECT_A,
        title: "Cross-project thread link",
        linkedThreadId: THREAD_B1,
      })
      .pipe(Effect.flip);
    expect(crossThreadErr._tag).toBe("ProjectTodoValidationError");

    const bigBodyErr = yield* todos
      .create({
        id: ProjectTodoId.make("todo-big-body"),
        projectId: PROJECT_A,
        title: "Too large",
        body: "中".repeat(Math.ceil(PROJECT_TODO_MAX_BODY_BYTES / 3) + 10),
      })
      .pipe(Effect.flip);
    expect(bigBodyErr._tag).toBe("ProjectTodoValidationError");
  }).pipe(Effect.provide(layerMemoryService)),
);

it.effect("enforces 32 KiB serialized page byte budget and cursor continuation", () =>
  Effect.gen(function* () {
    const todos = yield* ProjectTodoService.ProjectTodoService;
    const body = "中".repeat(250);
    for (let i = 0; i < 45; i++) {
      yield* todos.create({
        id: ProjectTodoId.make(`todo-page-${String(i).padStart(3, "0")}`),
        projectId: PROJECT_A,
        title: `Item ${i} ${"测试标题".repeat(15)}`,
        body,
        fileRefs: [`apps/web/src/components/example-${i}.tsx`],
      });
    }

    const seen = new Set<string>();
    let cursor: ProjectTodoCursor | null = null;
    let pages = 0;
    while (true) {
      const page: ProjectTodoListResult = yield* todos.list({
        projectId: PROJECT_A,
        state: "open",
        limit: 40,
        cursor,
      });
      pages += 1;
      const pageBytes = utf8ByteLength(JSON.stringify(page));
      expect(pageBytes).toBeLessThanOrEqual(PROJECT_TODO_LIST_MAX_BYTES + 256);
      for (const item of page.items) {
        expect(seen.has(item.id)).toBe(false);
        seen.add(item.id);
      }
      if (!page.hasMore) break;
      expect(page.nextCursor).not.toBeNull();
      cursor = page.nextCursor;
      expect(pages).toBeLessThan(10);
    }

    expect(seen.size).toBe(45);
    expect(pages).toBeGreaterThanOrEqual(2);
  }).pipe(Effect.provide(layerMemoryService)),
);

it.effect(
  "persists across file-backed T4Sqlite close and reopen, and degrades gracefully on bad path",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const tmpDir = yield* fs.makeTempDirectoryScoped({ prefix: "t4-todo-sqlite-" });
      const dbPath = path.join(tmpDir, "t4", "t4.sqlite");

      const fileLayer = ProjectTodoService.layer.pipe(
        Layer.provide(T4Sqlite.layerFromPath(dbPath)),
        Layer.provide(layerMockCore),
        Layer.provide(NodeServices.layer),
      );

      const createdId = ProjectTodoId.make("todo-persisted");
      yield* Effect.gen(function* () {
        const todos = yield* ProjectTodoService.ProjectTodoService;
        yield* todos.create({
          id: createdId,
          projectId: PROJECT_A,
          title: "Survives server restart",
          kind: "note",
          pinned: true,
        });
      }).pipe(Effect.provide(fileLayer));

      // Reopen the same file database in a fresh layer to verify migration idempotence and persistence.
      const reopened = yield* Effect.gen(function* () {
        const todos = yield* ProjectTodoService.ProjectTodoService;
        return yield* todos.get({ projectId: PROJECT_A, id: createdId });
      }).pipe(Effect.provide(fileLayer));

      expect(reopened.item.title).toBe("Survives server restart");
      expect(reopened.item.kind).toBe("note");
      expect(reopened.item.pinned).toBe(true);

      // Corrupt non-SQLite file degrades cleanly to ProjectTodoUnavailableError instead of crashing layer build.
      const badDbPath = path.join(tmpDir, "bad", "t4.sqlite");
      yield* fs.makeDirectory(path.dirname(badDbPath), { recursive: true });
      yield* fs.writeFileString(badDbPath, "not a sqlite file at all");

      const badLayer = ProjectTodoService.layer.pipe(
        Layer.provide(T4Sqlite.layerFromPath(badDbPath)),
        Layer.provide(layerMockCore),
        Layer.provide(NodeServices.layer),
      );
      const unavailable = yield* Effect.gen(function* () {
        const todos = yield* ProjectTodoService.ProjectTodoService;
        return yield* todos.list({ projectId: PROJECT_A });
      }).pipe(Effect.provide(badLayer), Effect.flip);

      expect(unavailable._tag).toBe("ProjectTodoUnavailableError");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("returns bounded dailyReview buckets for local day window", () =>
  Effect.gen(function* () {
    const todos = yield* ProjectTodoService.ProjectTodoService;
    const now = yield* Clock.currentTimeMillis;
    const dayStartIso = IsoDateTime.make(new Date(now - 60_000).toISOString());
    const dayEndIso = IsoDateTime.make(new Date(now + 60_000).toISOString());

    const created = yield* todos.create({
      id: ProjectTodoId.make("todo-today-1"),
      projectId: PROJECT_A,
      title: "Captured today",
      kind: "todo",
      linkedThreadId: THREAD_A1,
    });
    yield* todos.create({
      id: ProjectTodoId.make("note-pinned-1"),
      projectId: PROJECT_A,
      title: "Important invariant",
      kind: "note",
      pinned: true,
    });
    const toComplete = yield* todos.create({
      id: ProjectTodoId.make("todo-done-1"),
      projectId: PROJECT_A,
      title: "Completed today",
    });
    yield* todos.update({
      id: toComplete.item.id,
      projectId: PROJECT_A,
      expectedRevision: toComplete.item.revision,
      completed: true,
    });

    const review = yield* todos.dailyReview({
      projectId: PROJECT_A,
      dayStartIso,
      dayEndIso,
      rangeStartIso: IsoDateTime.make(new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString()),
      rangeEndIso: IsoDateTime.make(new Date(now + 24 * 60 * 60 * 1000).toISOString()),
    });
    expect(review.capturedToday.map((item) => item.id)).toContain(created.item.id);
    expect(review.completedToday.map((item) => item.id)).toEqual([toComplete.item.id]);
    expect(review.linkedActive.map((item) => item.id)).toEqual([created.item.id]);
    expect(review.pinnedNotes.map((item) => item.id)).toEqual(["note-pinned-1"]);
    expect(review.activityPoints?.length).toBe(3);
    expect(review.activityPoints?.some((point) => point.completedAt !== null)).toBe(true);
    expect(review.calendarItems?.length).toBe(3);
    expect(review.calendarTruncated).toBe(false);
  }).pipe(Effect.provide(layerMemoryService)),
);
