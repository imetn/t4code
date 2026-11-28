import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  IsoDateTime,
  type OrchestratorMcpFailure,
  PositiveInt,
  ProjectId,
  ProjectTodoId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationV2ThreadShell,
  type Project,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import type { Tool } from "effect/ai";

import * as McpInvocationContext from "../../mcp/McpInvocationContext.ts";
import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import * as McpToolAccessTestkit from "../../mcp/McpToolAccess.testkit.ts";
import { OrchestratorV2 } from "../../orchestration-v2/Orchestrator.ts";
import { ProjectService } from "../../project/ProjectService.ts";
import * as T4Sqlite from "../persistence/T4Sqlite.ts";
import * as ProjectTodoToolkit from "./ProjectTodoToolkit.ts";
import * as ProjectTodoService from "../todo/ProjectTodoService.ts";

const PROJECT_A = ProjectId.make("project-a");
const PROJECT_B = ProjectId.make("project-b");
const THREAD_A = ThreadId.make("thread-a");
const THREAD_LINKED = ThreadId.make("thread-linked");

const mockProjects = new Map<ProjectId, Project>([
  [
    PROJECT_A,
    {
      id: PROJECT_A,
      title: "Project A",
      workspaceRoot: "/tmp/a",
      defaultModelSelection: null,
      scripts: [],
      createdAt: IsoDateTime.make("2026-11-20T00:00:00.000Z"),
      updatedAt: IsoDateTime.make("2026-11-20T00:00:00.000Z"),
      deletedAt: null,
    } as unknown as Project,
  ],
  [
    PROJECT_B,
    {
      id: PROJECT_B,
      title: "Project B",
      workspaceRoot: "/tmp/b",
      defaultModelSelection: null,
      scripts: [],
      createdAt: IsoDateTime.make("2026-11-20T00:00:00.000Z"),
      updatedAt: IsoDateTime.make("2026-11-20T00:00:00.000Z"),
      deletedAt: null,
    } as unknown as Project,
  ],
]);

const mockThreads = new Map<ThreadId, OrchestrationV2ThreadShell>([
  [
    THREAD_A,
    {
      id: THREAD_A,
      projectId: PROJECT_A,
      title: "Thread A",
      runtimeMode: "full-access",
      interactionMode: "default",
      deletedAt: null,
      archivedAt: null,
      linkOrigin: null,
    } as unknown as OrchestrationV2ThreadShell,
  ],
  [
    THREAD_LINKED,
    {
      id: THREAD_LINKED,
      projectId: PROJECT_A,
      title: "Peer-spawned Thread",
      runtimeMode: "full-access",
      interactionMode: "default",
      deletedAt: null,
      archivedAt: null,
      linkOrigin: {
        sessionId: "peer-session-1",
        label: "Remote VPS",
        access: "full-access",
      },
    } as unknown as OrchestrationV2ThreadShell,
  ],
]);

const layerCore = Layer.mergeAll(
  NodeCrypto.layer,
  Layer.mock(ProjectService)({
    getById: (projectId) => Effect.succeed(Option.fromNullishOr(mockProjects.get(projectId))),
  }),
  Layer.mock(OrchestratorV2)({
    getThreadShell: (threadId) => Effect.succeed(mockThreads.get(threadId) ?? null),
  }),
);

const layerServices = ProjectTodoService.layer.pipe(
  Layer.provide(T4Sqlite.layerMemory),
  Layer.provideMerge(layerCore),
);

const layerTest = McpToolAccess.HandlersLayer.layer(ProjectTodoToolkit.layer).pipe(
  Layer.provideMerge(McpToolAccessTestkit.liveThreadsLayer),
  Layer.provideMerge(layerServices),
);

const callerScope = (threadId: ThreadId, readOnlyClient = false) =>
  McpInvocationContext.McpInvocationContext.of({
    environmentId: EnvironmentId.make("env-test"),
    issuedAt: DateTime.makeUnsafe("2026-11-27T00:00:00.000Z"),
    requestNamespace: "test",
    capabilities: new Set(["orchestration"]),
    thread: {
      threadId,
      providerSessionId: "provider-session-1",
      providerInstanceId: ProviderInstanceId.make("codex"),
    },
    ...(readOnlyClient
      ? {
          client: {
            sessionId: "ro-client",
            label: "Read-only client",
            access: "read-only",
          },
        }
      : {}),
  });

type TodoTools = typeof ProjectTodoToolkit.ProjectTodoToolkit.tools;
type ToolOutcome<Name extends keyof TodoTools> =
  | { readonly isFailure: false; readonly result: Tool.Success<TodoTools[Name]> }
  | { readonly isFailure: true; readonly result: OrchestratorMcpFailure };

it.effect(
  "allows local thread agent to add, list, read, and update todos scoped to its project",
  () =>
    Effect.gen(function* () {
      const toolkit = yield* ProjectTodoToolkit.ProjectTodoToolkit;
      const todos = yield* ProjectTodoService.ProjectTodoService;
      const invoke = <Name extends keyof TodoTools>(
        name: Name,
        params: Parameters<typeof toolkit.handle<Name>>[1],
      ): Effect.Effect<ToolOutcome<Name>, unknown, unknown> =>
        toolkit.handle(name, params).pipe(
          Stream.unwrap,
          Stream.runCollect,
          Effect.map((chunk) => chunk.at(-1)! as unknown as ToolOutcome<Name>),
        );

      // Seed a todo in Project B to ensure caller in Project A cannot read or list it.
      const otherTodo = yield* todos.create({
        id: ProjectTodoId.make("todo-project-b"),
        projectId: PROJECT_B,
        title: "Secret Project B todo",
      });

      const added = yield* invoke("project_todo_add", {
        title: "Follow up on retry backoff",
        body: "Add exponential jitter later",
        kind: "todo",
        priority: "high",
      });
      expect(added.isFailure).toBe(false);
      if (added.isFailure) return;
      expect(added.result.projectId).toBe(PROJECT_A);
      expect(added.result.createdBy).toBe("agent");
      expect(added.result.sourceThreadId).toBe(THREAD_A);

      const listed = yield* invoke("project_todo_list", {});
      expect(listed.isFailure).toBe(false);
      if (listed.isFailure) return;
      expect(listed.result.items.map((item) => item.id)).toEqual([added.result.id]);

      const crossRead = yield* invoke("project_todo_read", { id: otherTodo.item.id });
      expect(crossRead.isFailure).toBe(true);
      if (crossRead.isFailure) {
        expect(crossRead.result.code).toBe("task_not_found");
      }

      const updated = yield* invoke("project_todo_update", {
        id: added.result.id,
        expectedRevision: PositiveInt.make(1),
        completed: true,
        linkCurrentThread: true,
      });
      expect(updated.isFailure).toBe(false);
      if (updated.isFailure) return;
      expect(updated.result.revision).toBe(2);
      expect(updated.result.completedAt).not.toBeNull();
      expect(updated.result.linkedThreadId).toBe(THREAD_A);
    }).pipe(
      Effect.provideService(McpInvocationContext.McpInvocationContext, callerScope(THREAD_A)),
      Effect.provide(layerTest),
    ),
);

it.effect("blocks peer-linked thread callers even with full-access linkOrigin", () =>
  Effect.gen(function* () {
    const toolkit = yield* ProjectTodoToolkit.ProjectTodoToolkit;
    const res = yield* toolkit.handle("project_todo_list", {}).pipe(
      Stream.unwrap,
      Stream.runCollect,
      Effect.map((chunk) => chunk.at(-1)! as unknown as ToolOutcome<"project_todo_list">),
    );
    expect(res.isFailure).toBe(true);
    if (res.isFailure) {
      expect(res.result.code).toBe("capability_denied");
    }
  }).pipe(
    Effect.provideService(McpInvocationContext.McpInvocationContext, callerScope(THREAD_LINKED)),
    Effect.provide(layerTest),
  ),
);

it.effect("refuses writes from read-only clients while allowing reads", () =>
  Effect.gen(function* () {
    const toolkit = yield* ProjectTodoToolkit.ProjectTodoToolkit;
    const listed = yield* toolkit.handle("project_todo_list", {}).pipe(
      Stream.unwrap,
      Stream.runCollect,
      Effect.map((chunk) => chunk.at(-1)! as unknown as ToolOutcome<"project_todo_list">),
    );
    expect(listed.isFailure).toBe(false);

    const added = yield* toolkit.handle("project_todo_add", { title: "Blocked write" }).pipe(
      Stream.unwrap,
      Stream.runCollect,
      Effect.map((chunk) => chunk.at(-1)! as unknown as ToolOutcome<"project_todo_add">),
    );
    expect(added.isFailure).toBe(true);
    if (added.isFailure) {
      expect(added.result.code).toBe("capability_denied");
    }
  }).pipe(
    Effect.provideService(McpInvocationContext.McpInvocationContext, callerScope(THREAD_A, true)),
    Effect.provide(layerTest),
  ),
);
