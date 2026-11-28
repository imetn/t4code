import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";

import {
  IsoDateTime,
  NonNegativeInt,
  PositiveInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "../baseSchemas.ts";

export const PROJECT_TODO_MAX_TITLE_LENGTH = 300;
export const PROJECT_TODO_MAX_BODY_BYTES = 8 * 1024;
export const PROJECT_TODO_BODY_PREVIEW_MAX_CHARS = 160;
export const PROJECT_TODO_MAX_LIST_LIMIT = 40;
export const PROJECT_TODO_LIST_MAX_BYTES = 32 * 1024;
export const PROJECT_TODO_DAILY_REVIEW_BUCKET_LIMIT = 20;
export const PROJECT_TODO_DAILY_REVIEW_MAX_BYTES = 64 * 1024;
export const PROJECT_TODO_CALENDAR_MAX_ITEMS = 200;
export const PROJECT_TODO_CALENDAR_MAX_BYTES = 96 * 1024;
export const PROJECT_TODO_MAX_FILE_REFS = 10;
export const PROJECT_TODO_MAX_FILE_REF_LENGTH = 512;

const textEncoder = new TextEncoder();

export function utf8ByteLength(value: string): number {
  return textEncoder.encode(value).byteLength;
}

export function buildProjectTodoBodyPreview(body: string): string {
  const normalized = body.replace(/\s+/gu, " ").trim();
  if (normalized.length === 0) return "";
  const chars = Array.from(normalized);
  if (chars.length <= PROJECT_TODO_BODY_PREVIEW_MAX_CHARS) return normalized;
  return `${chars
    .slice(0, PROJECT_TODO_BODY_PREVIEW_MAX_CHARS - 1)
    .join("")
    .trimEnd()}…`;
}

export const ProjectTodoId = TrimmedNonEmptyString.pipe(Schema.brand("ProjectTodoId"));
export type ProjectTodoId = typeof ProjectTodoId.Type;

export const ProjectTodoKind = Schema.Literals(["todo", "note"]);
export type ProjectTodoKind = typeof ProjectTodoKind.Type;

export const ProjectTodoPriority = Schema.Literals(["normal", "high"]);
export type ProjectTodoPriority = typeof ProjectTodoPriority.Type;

export const ProjectTodoCreatedBy = Schema.Literals(["user", "agent"]);
export type ProjectTodoCreatedBy = typeof ProjectTodoCreatedBy.Type;

export const ProjectTodoStateFilter = Schema.Literals(["open", "completed", "archived", "all"]);
export type ProjectTodoStateFilter = typeof ProjectTodoStateFilter.Type;

const TrimmedTitle = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(PROJECT_TODO_MAX_TITLE_LENGTH),
).pipe(
  Schema.decodeTo(
    Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(PROJECT_TODO_MAX_TITLE_LENGTH)),
    SchemaTransformation.trim(),
  ),
);

const ProjectTodoFileRef = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(PROJECT_TODO_MAX_FILE_REF_LENGTH),
).pipe(
  Schema.decodeTo(
    Schema.String.check(
      Schema.isMinLength(1),
      Schema.isMaxLength(PROJECT_TODO_MAX_FILE_REF_LENGTH),
    ),
    SchemaTransformation.trim(),
  ),
);

export const ProjectTodoFileRefs = Schema.Array(ProjectTodoFileRef).check(
  Schema.isMaxLength(PROJECT_TODO_MAX_FILE_REFS),
);

export const ProjectTodoCursor = Schema.Struct({
  createdAt: IsoDateTime,
  id: ProjectTodoId,
});
export type ProjectTodoCursor = typeof ProjectTodoCursor.Type;

const ProjectTodoBaseFields = {
  id: ProjectTodoId,
  projectId: ProjectId,
  kind: ProjectTodoKind,
  title: Schema.String,
  priority: ProjectTodoPriority,
  pinned: Schema.Boolean,
  sourceThreadId: Schema.NullOr(ThreadId),
  linkedThreadId: Schema.NullOr(ThreadId),
  fileRefs: Schema.Array(Schema.String),
  createdBy: ProjectTodoCreatedBy,
  revision: PositiveInt,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  completedAt: Schema.NullOr(IsoDateTime),
  archivedAt: Schema.NullOr(IsoDateTime),
} as const;

export const ProjectTodoSummary = Schema.Struct({
  ...ProjectTodoBaseFields,
  bodyPreview: Schema.String,
  hasBody: Schema.Boolean,
});
export type ProjectTodoSummary = typeof ProjectTodoSummary.Type;

export const ProjectTodoItem = Schema.Struct({
  ...ProjectTodoBaseFields,
  body: Schema.String,
});
export type ProjectTodoItem = typeof ProjectTodoItem.Type;

export const ProjectTodoListInput = Schema.Struct({
  projectId: ProjectId,
  state: Schema.optional(ProjectTodoStateFilter),
  kind: Schema.optional(ProjectTodoKind),
  pinnedOnly: Schema.optional(Schema.Boolean),
  query: Schema.optional(Schema.String),
  cursor: Schema.optional(Schema.NullOr(ProjectTodoCursor)),
  limit: Schema.optional(
    Schema.Int.check(
      Schema.isGreaterThanOrEqualTo(1),
      Schema.isLessThanOrEqualTo(PROJECT_TODO_MAX_LIST_LIMIT),
    ),
  ),
});
export type ProjectTodoListInput = typeof ProjectTodoListInput.Type;

export const ProjectTodoListResult = Schema.Struct({
  items: Schema.Array(ProjectTodoSummary),
  nextCursor: Schema.NullOr(ProjectTodoCursor),
  hasMore: Schema.Boolean,
});
export type ProjectTodoListResult = typeof ProjectTodoListResult.Type;

export const ProjectTodoGetInput = Schema.Struct({
  projectId: ProjectId,
  id: ProjectTodoId,
});
export type ProjectTodoGetInput = typeof ProjectTodoGetInput.Type;

export const ProjectTodoGetResult = Schema.Struct({
  item: ProjectTodoItem,
});
export type ProjectTodoGetResult = typeof ProjectTodoGetResult.Type;

export const ProjectTodoActivityPoint = Schema.Struct({
  createdAt: IsoDateTime,
  completedAt: Schema.NullOr(IsoDateTime),
});
export type ProjectTodoActivityPoint = typeof ProjectTodoActivityPoint.Type;

export const ProjectTodoDailyReviewInput = Schema.Struct({
  projectId: Schema.optional(ProjectId),
  dayStartIso: IsoDateTime,
  dayEndIso: IsoDateTime,
  rangeStartIso: Schema.optional(IsoDateTime),
  rangeEndIso: Schema.optional(IsoDateTime),
  staleDays: Schema.optional(
    Schema.Int.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(90)),
  ),
});
export type ProjectTodoDailyReviewInput = typeof ProjectTodoDailyReviewInput.Type;

export const ProjectTodoDailyReviewResult = Schema.Struct({
  capturedToday: Schema.Array(ProjectTodoSummary),
  completedToday: Schema.Array(ProjectTodoSummary),
  linkedActive: Schema.Array(ProjectTodoSummary),
  staleOpen: Schema.Array(ProjectTodoSummary),
  pinnedNotes: Schema.Array(ProjectTodoSummary),
  activityPoints: Schema.optional(Schema.Array(ProjectTodoActivityPoint)),
  calendarItems: Schema.optional(Schema.Array(ProjectTodoSummary)),
  calendarTruncated: Schema.optional(Schema.Boolean),
  truncated: Schema.Boolean,
});
export type ProjectTodoDailyReviewResult = typeof ProjectTodoDailyReviewResult.Type;

export const ProjectTodoCreateInput = Schema.Struct({
  id: ProjectTodoId,
  projectId: ProjectId,
  title: TrimmedTitle,
  body: Schema.optional(Schema.String),
  kind: Schema.optional(ProjectTodoKind),
  priority: Schema.optional(ProjectTodoPriority),
  pinned: Schema.optional(Schema.Boolean),
  sourceThreadId: Schema.optional(Schema.NullOr(ThreadId)),
  linkedThreadId: Schema.optional(Schema.NullOr(ThreadId)),
  fileRefs: Schema.optional(ProjectTodoFileRefs),
});
export type ProjectTodoCreateInput = typeof ProjectTodoCreateInput.Type;

export const ProjectTodoCreateResult = Schema.Struct({
  item: ProjectTodoItem,
  created: Schema.Boolean,
});
export type ProjectTodoCreateResult = typeof ProjectTodoCreateResult.Type;

export const ProjectTodoUpdateInput = Schema.Struct({
  id: ProjectTodoId,
  projectId: ProjectId,
  expectedRevision: PositiveInt,
  title: Schema.optional(TrimmedTitle),
  body: Schema.optional(Schema.String),
  kind: Schema.optional(ProjectTodoKind),
  priority: Schema.optional(ProjectTodoPriority),
  pinned: Schema.optional(Schema.Boolean),
  completed: Schema.optional(Schema.Boolean),
  archived: Schema.optional(Schema.Boolean),
  linkedThreadId: Schema.optional(Schema.NullOr(ThreadId)),
  fileRefs: Schema.optional(ProjectTodoFileRefs),
});
export type ProjectTodoUpdateInput = typeof ProjectTodoUpdateInput.Type;

export const ProjectTodoUpdateResult = Schema.Struct({
  item: ProjectTodoItem,
});
export type ProjectTodoUpdateResult = typeof ProjectTodoUpdateResult.Type;

export const ProjectTodoDeleteInput = Schema.Struct({
  id: ProjectTodoId,
  projectId: ProjectId,
  expectedRevision: PositiveInt,
});
export type ProjectTodoDeleteInput = typeof ProjectTodoDeleteInput.Type;

export const ProjectTodoDeleteResult = Schema.Struct({
  deleted: Schema.Boolean,
});
export type ProjectTodoDeleteResult = typeof ProjectTodoDeleteResult.Type;

export class ProjectTodoUnavailableError extends Schema.TaggedError<ProjectTodoUnavailableError>()(
  "ProjectTodoUnavailableError",
  {
    detail: Schema.String,
  },
) {
  override get message(): string {
    return this.detail;
  }
}

export class ProjectTodoNotFoundError extends Schema.TaggedError<ProjectTodoNotFoundError>()(
  "ProjectTodoNotFoundError",
  {
    todoId: ProjectTodoId,
    projectId: ProjectId,
  },
) {
  override get message(): string {
    return `Project todo '${this.todoId}' was not found in project '${this.projectId}'.`;
  }
}

export class ProjectTodoConflictError extends Schema.TaggedError<ProjectTodoConflictError>()(
  "ProjectTodoConflictError",
  {
    todoId: ProjectTodoId,
    expectedRevision: NonNegativeInt,
    actualRevision: NonNegativeInt,
  },
) {
  override get message(): string {
    return `Project todo '${this.todoId}' changed concurrently (expected revision ${this.expectedRevision}, actual ${this.actualRevision}). Refresh and retry.`;
  }
}

export class ProjectTodoValidationError extends Schema.TaggedError<ProjectTodoValidationError>()(
  "ProjectTodoValidationError",
  {
    detail: Schema.String,
  },
) {
  override get message(): string {
    return this.detail;
  }
}

export class ProjectTodoOperationError extends Schema.TaggedError<ProjectTodoOperationError>()(
  "ProjectTodoOperationError",
  {
    operation: Schema.String,
    detail: Schema.String,
  },
) {
  override get message(): string {
    return `Project todo ${this.operation} failed: ${this.detail}`;
  }
}

export const ProjectTodoError = Schema.Union([
  ProjectTodoUnavailableError,
  ProjectTodoNotFoundError,
  ProjectTodoConflictError,
  ProjectTodoValidationError,
  ProjectTodoOperationError,
]);
export type ProjectTodoError = typeof ProjectTodoError.Type;
