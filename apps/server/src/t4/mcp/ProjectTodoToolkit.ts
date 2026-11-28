import {
  OrchestratorMcpFailure,
  PositiveInt,
  PROJECT_TODO_MAX_LIST_LIMIT,
  ProjectTodoCursor,
  type ProjectTodoError,
  ProjectTodoFileRefs,
  ProjectTodoId,
  ProjectTodoItem,
  ProjectTodoKind,
  ProjectTodoPriority,
  ProjectTodoStateFilter,
  ProjectTodoSummary,
} from "@t3tools/contracts";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { McpSchema, Tool, Toolkit } from "effect/ai";

import * as Orchestrator from "../../orchestration-v2/Orchestrator.ts";
import * as ThreadManagementService from "../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../mcp/McpInvocationContext.ts";
import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import { callerLinkOrigin } from "../../mcp/linkOrigin.ts";
import * as ProjectTodoService from "../todo/ProjectTodoService.ts";

const shared = {
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    Orchestrator.OrchestratorV2,
    ThreadManagementService.ThreadManagementService,
    ProjectTodoService.ProjectTodoService,
    SecureRandom.SecureRandom,
  ],
};

export const ProjectTodoListTool = Tool.make("project_todo_list", {
  ...shared,
  description: "List or search todos and pinned notes for this thread's project.",
  parameters: Schema.Struct({
    state: Schema.optional(ProjectTodoStateFilter),
    kind: Schema.optional(ProjectTodoKind),
    pinnedOnly: Schema.optional(Schema.Boolean),
    query: Schema.optional(Schema.String),
    limit: Schema.optional(
      Schema.Int.check(
        Schema.isGreaterThanOrEqualTo(1),
        Schema.isLessThanOrEqualTo(PROJECT_TODO_MAX_LIST_LIMIT),
      ),
    ),
    cursor: Schema.optional(ProjectTodoCursor),
  }),
  success: Schema.Struct({
    items: Schema.Array(ProjectTodoSummary),
    nextCursor: Schema.NullOr(ProjectTodoCursor),
    hasMore: Schema.Boolean,
  }),
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromOutsideClients);

export const ProjectTodoReadTool = Tool.make("project_todo_read", {
  ...shared,
  description: "Read one todo or note in this thread's project, including full body and revision.",
  parameters: Schema.Struct({
    id: ProjectTodoId,
  }),
  success: ProjectTodoItem,
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromOutsideClients);

export const ProjectTodoAddTool = Tool.make("project_todo_add", {
  ...shared,
  description: "Save a deferred idea, follow-up todo, or project note without executing it now.",
  parameters: Schema.Struct({
    title: Schema.String,
    body: Schema.optional(Schema.String),
    kind: Schema.optional(ProjectTodoKind),
    priority: Schema.optional(ProjectTodoPriority),
    pinned: Schema.optional(Schema.Boolean),
    fileRefs: Schema.optional(ProjectTodoFileRefs),
  }),
  success: ProjectTodoItem,
})
  .annotate(Tool.Destructive, false)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromOutsideClients);

export const ProjectTodoUpdateTool = Tool.make("project_todo_update", {
  ...shared,
  description:
    "Update a todo or note in this thread's project. Requires expectedRevision from list/read.",
  parameters: Schema.Struct({
    id: ProjectTodoId,
    expectedRevision: PositiveInt,
    title: Schema.optional(Schema.String),
    body: Schema.optional(Schema.String),
    kind: Schema.optional(ProjectTodoKind),
    priority: Schema.optional(ProjectTodoPriority),
    pinned: Schema.optional(Schema.Boolean),
    completed: Schema.optional(Schema.Boolean),
    archived: Schema.optional(Schema.Boolean),
    linkCurrentThread: Schema.optional(Schema.Boolean),
    fileRefs: Schema.optional(ProjectTodoFileRefs),
  }),
  success: ProjectTodoItem,
})
  .annotate(Tool.Destructive, false)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromOutsideClients);

export const ProjectTodoToolkit = Toolkit.make(
  ProjectTodoListTool,
  ProjectTodoReadTool,
  ProjectTodoAddTool,
  ProjectTodoUpdateTool,
);

const mapTodoError = (error: ProjectTodoError): OrchestratorMcpFailure => {
  switch (error._tag) {
    case "ProjectTodoNotFoundError":
      return new OrchestratorMcpFailure({ code: "task_not_found", message: error.message });
    case "ProjectTodoConflictError":
      return new OrchestratorMcpFailure({ code: "invalid_request", message: error.message });
    case "ProjectTodoValidationError":
      return new OrchestratorMcpFailure({ code: "invalid_request", message: error.message });
    case "ProjectTodoUnavailableError":
      return new OrchestratorMcpFailure({ code: "orchestration_error", message: error.message });
    case "ProjectTodoOperationError":
      return new OrchestratorMcpFailure({ code: "orchestration_error", message: error.message });
  }
};

const resolveCallerProject = Effect.fn("ProjectTodoToolkit.resolveCallerProject")(function* () {
  const scope = yield* McpInvocationContext.McpInvocationContext;
  const threadScope = yield* McpInvocationContext.requireThreadScope(scope, "Project todo tools");
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const caller = yield* orchestrator.getThreadShell(threadScope.thread.threadId).pipe(
    Effect.mapError(
      (cause) =>
        new OrchestratorMcpFailure({
          code: "orchestration_error",
          message: cause instanceof Error ? cause.message : String(cause),
        }),
    ),
  );
  if (caller === null || caller.deletedAt !== null) {
    return yield* new OrchestratorMcpFailure({
      code: "thread_not_found",
      message: `Calling thread '${threadScope.thread.threadId}' was not found.`,
    });
  }
  const linkOrigin = callerLinkOrigin({ scope, caller });
  if (linkOrigin !== undefined) {
    return yield* new OrchestratorMcpFailure({
      code: "capability_denied",
      message:
        "Project todo tools are local to this environment and cannot be accessed through a peer link.",
    });
  }
  return caller;
});

export const layer = McpToolAccess.toLayer(ProjectTodoToolkit, {
  project_todo_list: McpToolAccess.readsAsCaller(
    Effect.fn("ProjectTodoToolkit.list")(function* (params) {
      const caller = yield* resolveCallerProject();
      const todos = yield* ProjectTodoService.ProjectTodoService;
      return yield* todos
        .list({
          projectId: caller.projectId,
          ...(params.state !== undefined ? { state: params.state } : {}),
          ...(params.kind !== undefined ? { kind: params.kind } : {}),
          ...(params.pinnedOnly !== undefined ? { pinnedOnly: params.pinnedOnly } : {}),
          ...(params.query !== undefined ? { query: params.query } : {}),
          ...(params.limit !== undefined ? { limit: params.limit } : {}),
          ...(params.cursor !== undefined ? { cursor: params.cursor } : {}),
        })
        .pipe(Effect.mapError(mapTodoError));
    }),
  ),
  project_todo_read: McpToolAccess.readsAsCaller(
    Effect.fn("ProjectTodoToolkit.read")(function* (params) {
      const caller = yield* resolveCallerProject();
      const todos = yield* ProjectTodoService.ProjectTodoService;
      const result = yield* todos
        .get({ projectId: caller.projectId, id: params.id })
        .pipe(Effect.mapError(mapTodoError));
      return result.item;
    }),
  ),
  project_todo_add: McpToolAccess.actsAsCaller(
    Effect.fn("ProjectTodoToolkit.add")(function* (params) {
      const caller = yield* resolveCallerProject();
      const todos = yield* ProjectTodoService.ProjectTodoService;
      const random = yield* SecureRandom.SecureRandom;
      const id = ProjectTodoId.make(`todo_${yield* random.uuidV4()}`);
      const result = yield* todos
        .create(
          {
            id,
            projectId: caller.projectId,
            title: params.title,
            ...(params.body !== undefined ? { body: params.body } : {}),
            ...(params.kind !== undefined ? { kind: params.kind } : {}),
            ...(params.priority !== undefined ? { priority: params.priority } : {}),
            ...(params.pinned !== undefined ? { pinned: params.pinned } : {}),
            ...(params.fileRefs !== undefined ? { fileRefs: params.fileRefs } : {}),
          },
          { createdBy: "agent", sourceThreadId: caller.id },
        )
        .pipe(Effect.mapError(mapTodoError));
      return result.item;
    }),
  ),
  project_todo_update: McpToolAccess.actsAsCaller(
    Effect.fn("ProjectTodoToolkit.update")(function* (params) {
      const caller = yield* resolveCallerProject();
      const todos = yield* ProjectTodoService.ProjectTodoService;
      const result = yield* todos
        .update({
          id: params.id,
          projectId: caller.projectId,
          expectedRevision: params.expectedRevision,
          ...(params.title !== undefined ? { title: params.title } : {}),
          ...(params.body !== undefined ? { body: params.body } : {}),
          ...(params.kind !== undefined ? { kind: params.kind } : {}),
          ...(params.priority !== undefined ? { priority: params.priority } : {}),
          ...(params.pinned !== undefined ? { pinned: params.pinned } : {}),
          ...(params.completed !== undefined ? { completed: params.completed } : {}),
          ...(params.archived !== undefined ? { archived: params.archived } : {}),
          ...(params.linkCurrentThread === true
            ? { linkedThreadId: caller.id }
            : params.linkCurrentThread === false
              ? { linkedThreadId: null }
              : {}),
          ...(params.fileRefs !== undefined ? { fileRefs: params.fileRefs } : {}),
        })
        .pipe(Effect.mapError(mapTodoError));
      return result.item;
    }),
  ),
});
