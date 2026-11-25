import {
  CommandId,
  EventId,
  MessageId,
  type OrchestrationV2AppThread,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2LinkOrigin,
  type OrchestratorMcpThreadImportInput,
  type OrchestratorMcpThreadImportResult,
  type ProviderInteractionMode,
  ProjectId,
  type RunId,
  type RuntimeMode,
  ThreadId,
  TurnItemId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Digest from "effect/crypto/Digest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import * as EventSink from "./EventSink.ts";
import * as ThreadManagement from "./ThreadManagementService.ts";

const IMPORT_EVENT_PREFIX = "thread-import:v1";

/** The imported thread's events could not be written. */
export class ThreadImportWriteError extends Schema.TaggedError<ThreadImportWriteError>()(
  "ThreadImportWriteError",
  { threadId: ThreadId, cause: Schema.Defect() },
) {
  override get message(): string {
    return "The thread could not be imported.";
  }
}

/** A retried import named another project than the one the thread landed in. */
export class ThreadImportProjectMismatchError extends Schema.TaggedError<ThreadImportProjectMismatchError>()(
  "ThreadImportProjectMismatchError",
  { threadId: ThreadId, existingProjectId: ProjectId },
) {
  override get message(): string {
    return `This handoff was already imported into another project (${this.existingProjectId}).`;
  }
}

/** The import request carried an invalid field, such as an unparseable timestamp or wrong link owner. */
export class ThreadImportInvalidInputError extends Schema.TaggedError<ThreadImportInvalidInputError>()(
  "ThreadImportInvalidInputError",
  { detail: Schema.String },
) {
  override get message(): string {
    return this.detail;
  }
}

/**
 * The thread was imported, but its continuation prompt could not start a run.
 * `rejection` is the orchestrator's own reason when it refused the message.
 */
export class ThreadImportContinuationError extends Schema.TaggedError<ThreadImportContinuationError>()(
  "ThreadImportContinuationError",
  { threadId: ThreadId, rejection: Schema.optional(Schema.String), cause: Schema.Defect() },
) {
  override get message(): string {
    return this.rejection === undefined
      ? "The thread was imported, but its first message could not start."
      : `The thread was imported, but its first message could not start: ${this.rejection}`;
  }
}

export type ThreadImportError =
  | ThreadImportWriteError
  | ThreadImportProjectMismatchError
  | ThreadImportInvalidInputError
  | ThreadImportContinuationError;

/** A checkout an import prepared for its thread. */
export interface ImportedWorkspace {
  readonly worktreePath: string;
  readonly branch: string | null;
  readonly undo: Effect.Effect<void>;
}

/** Imports a thread conversation from another environment; ids derive from source+handoff for idempotent retries. */
export class ThreadImportService extends Context.Service<
  ThreadImportService,
  {
    readonly importThread: <E = never>(
      input: OrchestratorMcpThreadImportInput & {
        readonly runtimeMode: RuntimeMode;
        readonly interactionMode: ProviderInteractionMode;
        readonly linkOrigin: OrchestrationV2LinkOrigin | undefined;
        /**
         * Prepares the checkout the thread works in, run only when this import
         * creates the thread; `undo` runs if the thread then cannot be written.
         */
        readonly workspace?: Effect.Effect<ImportedWorkspace, E>;
      },
    ) => Effect.Effect<OrchestratorMcpThreadImportResult, ThreadImportError | E>;
  }
>()("t3/orchestration-v2/ThreadImportService") {}

const make = Effect.gen(function* () {
  const sink = yield* EventSink.EventSinkV2;
  const threads = yield* ThreadManagement.ThreadManagementService;
  const digest = yield* Digest.Digest;
  const locks = new Map<ThreadId, Semaphore.Semaphore>();

  const withThreadLock = <A, E, R>(threadId: ThreadId, effect: Effect.Effect<A, E, R>) =>
    Effect.suspend(() => {
      let lock = locks.get(threadId);
      if (lock === undefined) {
        lock = Semaphore.makeUnsafe(1);
        locks.set(threadId, lock);
      }
      return lock.withPermits(1)(effect);
    });

  const encodeSourceKey = Schema.encodeEffect(
    Schema.fromJsonString(Schema.Tuple([Schema.String, Schema.String, Schema.String])),
  );

  /** The thread an import of `source` creates here, the same on every retry. */
  const importedThreadId = Effect.fn("ThreadImportService.importedThreadId")(function* (
    source: OrchestratorMcpThreadImportInput["source"],
  ) {
    const serialized = yield* encodeSourceKey([
      source.environmentId,
      source.threadId,
      source.handoffId,
    ]).pipe(Effect.orDie);
    const hash = yield* digest.digest(Digest.sha256, new TextEncoder().encode(serialized));
    return ThreadId.make(`thread:import:${Hex.encode(hash).slice(0, 32)}`);
  });

  const parseHistoryEvents = Effect.fn("ThreadImportService.parseHistoryEvents")(function* (
    threadId: ThreadId,
    messages: OrchestratorMcpThreadImportInput["messages"],
  ): Effect.fn.Return<ReadonlyArray<OrchestrationV2DomainEvent>, ThreadImportInvalidInputError> {
    const events: Array<OrchestrationV2DomainEvent> = [];
    for (const [index, message] of messages.entries()) {
      const parsed = DateTime.make(message.createdAt);
      if (Option.isNone(parsed)) {
        return yield* new ThreadImportInvalidInputError({
          detail: `Message ${index} has an invalid createdAt timestamp.`,
        });
      }
      const at = parsed.value;
      const suffix = String(index).padStart(6, "0");
      const messageId = MessageId.make(`${threadId}:${suffix}`);
      const turnItemId = TurnItemId.make(`${IMPORT_EVENT_PREFIX}:turn-item:${threadId}:${suffix}`);
      const common = {
        id: turnItemId,
        threadId,
        runId: null,
        nodeId: null,
        providerThreadId: null,
        providerTurnId: null,
        nativeItemRef: null,
        parentItemId: null,
        // Imported items are numbered before any run here by the position store.
        ordinal: index + 1,
        status: "completed" as const,
        title: null,
        startedAt: at,
        completedAt: at,
        updatedAt: at,
      };
      events.push(
        {
          id: EventId.make(`${IMPORT_EVENT_PREFIX}:message:${threadId}:${suffix}`),
          type: "message.updated",
          threadId,
          occurredAt: at,
          payload: {
            createdBy: message.role === "user" ? "user" : "agent",
            creationSource: "server",
            id: messageId,
            threadId,
            runId: null,
            nodeId: null,
            role: message.role,
            text: message.text,
            attachments: [],
            streaming: false,
            createdAt: at,
            updatedAt: at,
          },
        },
        {
          id: EventId.make(`${IMPORT_EVENT_PREFIX}:turn-item:${threadId}:${suffix}`),
          type: "turn-item.updated",
          threadId,
          occurredAt: at,
          payload:
            message.role === "user"
              ? {
                  ...common,
                  createdBy: "user",
                  creationSource: "server",
                  type: "user_message",
                  messageId,
                  inputIntent: "turn_start",
                  text: message.text,
                  attachments: [],
                }
              : {
                  ...common,
                  type: "assistant_message",
                  messageId,
                  text: message.text,
                  streaming: false,
                },
        },
      );
    }
    return events;
  });

  const continuationMessageId = (threadId: ThreadId) => MessageId.make(`${threadId}:continue`);

  const readContinuationRunId = Effect.fn("ThreadImportService.readContinuationRunId")(function* (
    threadId: ThreadId,
  ) {
    const records = yield* threads.getThreadRecords(threadId, ["runs"]);
    const messageId = continuationMessageId(threadId);
    return records.runs.find((run) => run.userMessageId === messageId)?.id ?? null;
  });

  const verifyExistingMatch = (
    existing: {
      readonly id: ThreadId;
      readonly projectId: ProjectId;
      readonly linkOrigin?: OrchestrationV2LinkOrigin | undefined;
    },
    input: {
      readonly projectId: ProjectId;
      readonly linkOrigin: OrchestrationV2LinkOrigin | undefined;
    },
  ): Effect.Effect<void, ThreadImportProjectMismatchError | ThreadImportInvalidInputError> => {
    if (existing.projectId !== input.projectId) {
      return Effect.fail(
        new ThreadImportProjectMismatchError({
          threadId: existing.id,
          existingProjectId: existing.projectId,
        }),
      );
    }
    if (
      input.linkOrigin !== undefined &&
      existing.linkOrigin?.sessionId !== input.linkOrigin.sessionId
    ) {
      return Effect.fail(
        new ThreadImportInvalidInputError({
          detail: "This handoff already belongs to another thread here.",
        }),
      );
    }
    return Effect.void;
  };

  /** Sends the continuation prompt once for a newly created import. */
  const startContinuation = Effect.fn("ThreadImportService.startContinuation")(function* (
    threadId: ThreadId,
    input: OrchestratorMcpThreadImportInput,
  ): Effect.fn.Return<RunId | null, ThreadImportContinuationError> {
    if (input.continuationPrompt === undefined) return null;
    return yield* threads
      .dispatch({
        type: "message.dispatch",
        commandId: CommandId.make(`command:thread-import:${threadId}:continue`),
        threadId,
        messageId: continuationMessageId(threadId),
        text: input.continuationPrompt,
        attachments: [],
        modelSelection: input.modelSelection,
        dispatchMode: { type: "start_immediately" },
        createdBy: "agent",
        creationSource: "mcp",
      })
      .pipe(
        Effect.flatMap(() => readContinuationRunId(threadId)),
        Effect.mapError(
          (cause) =>
            new ThreadImportContinuationError({
              threadId,
              // Decider refusals are public; storage and other causes are not.
              ...((cause._tag === "OrchestratorDispatchError" ||
                cause._tag === "OrchestratorCommandRejectedError") &&
              typeof cause.cause === "string" &&
              cause.cause.length > 0
                ? { rejection: Array.from(cause.cause).slice(0, 1000).join("") }
                : {}),
              cause,
            }),
        ),
      );
  });

  const importThread: ThreadImportService["Service"]["importThread"] = Effect.fn(
    "ThreadImportService.importThread",
  )(function* <E = never>(
    input: OrchestratorMcpThreadImportInput & {
      readonly runtimeMode: RuntimeMode;
      readonly interactionMode: ProviderInteractionMode;
      readonly linkOrigin: OrchestrationV2LinkOrigin | undefined;
      readonly workspace?: Effect.Effect<ImportedWorkspace, E>;
    },
  ) {
    const threadId = yield* importedThreadId(input.source);
    // Validate every timestamp before preparing any workspace or writing events.
    const history = yield* parseHistoryEvents(threadId, input.messages);
    return yield* withThreadLock(
      threadId,
      Effect.gen(function* () {
        const existing = yield* threads
          .getThreadShell(threadId)
          .pipe(Effect.orElseSucceed(() => null));
        if (existing !== null) {
          yield* verifyExistingMatch(existing, input);
          const runId = yield* readContinuationRunId(threadId).pipe(
            Effect.orElseSucceed(() => null),
          );
          return { threadId, projectId: input.projectId, created: false, runId };
        }
        const workspace = input.workspace === undefined ? undefined : yield* input.workspace;
        const created = yield* Effect.gen(function* () {
          const now = yield* DateTime.now;
          const thread: OrchestrationV2AppThread = {
            createdBy: "agent",
            creationSource: "mcp",
            id: threadId,
            projectId: input.projectId,
            title: input.title,
            providerInstanceId: input.modelSelection.instanceId,
            modelSelection: input.modelSelection,
            runtimeMode: input.runtimeMode,
            interactionMode: input.interactionMode,
            branch: workspace === undefined ? (input.branch ?? null) : workspace.branch,
            worktreePath:
              workspace === undefined ? (input.worktreePath ?? null) : workspace.worktreePath,
            activeProviderThreadId: null,
            historyOrigin: "v1_import",
            ...(input.linkOrigin === undefined ? {} : { linkOrigin: input.linkOrigin }),
            lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
            forkedFrom: null,
            createdAt: now,
            updatedAt: now,
            archivedAt: null,
            settledOverride: null,
            settledAt: null,
            snoozedUntil: null,
            snoozedAt: null,
            lastVisitedAt: null,
            deletedAt: null,
          };
          return yield* sink
            .write({
              events: [
                {
                  id: EventId.make(`${IMPORT_EVENT_PREFIX}:thread:${threadId}:created`),
                  type: "thread.created",
                  threadId,
                  providerInstanceId: input.modelSelection.instanceId,
                  occurredAt: now,
                  payload: thread,
                },
                ...history,
              ],
            })
            .pipe(
              Effect.as(true),
              // A concurrent retry may have written the same events first.
              Effect.catch((writeError) =>
                threads.getThreadShell(threadId).pipe(
                  Effect.orElseSucceed(() => null),
                  Effect.flatMap(
                    (
                      raced,
                    ): Effect.Effect<
                      boolean,
                      | ThreadImportWriteError
                      | ThreadImportProjectMismatchError
                      | ThreadImportInvalidInputError
                    > =>
                      raced === null
                        ? Effect.fail(new ThreadImportWriteError({ threadId, cause: writeError }))
                        : (workspace?.undo ?? Effect.void).pipe(
                            Effect.andThen(verifyExistingMatch(raced, input)),
                            Effect.as(false),
                          ),
                  ),
                ),
              ),
            );
        }).pipe(Effect.tapError(() => workspace?.undo ?? Effect.void));
        const runId = created
          ? yield* startContinuation(threadId, input)
          : yield* readContinuationRunId(threadId).pipe(Effect.orElseSucceed(() => null));
        return { threadId, projectId: input.projectId, created, runId };
      }),
    );
  });

  return ThreadImportService.of({ importThread });
});

export const layer = Layer.effect(ThreadImportService, make);
