import {
  CommandId,
  type EnvironmentId,
  type OrchestratorMcpFailure,
  ThreadHandoffError,
  type OrchestrationV2ThreadHandoff,
  type OrchestratorMcpImportedMessage,
  type Project,
  type ProjectId,
  type ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as HttpBody from "effect/http/HttpBody";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";

import type * as McpInvocationContext from "../../mcp/McpInvocationContext.ts";
import { AttachmentToolkit } from "../../mcp/toolkits/attachment/tools.ts";
import { ProjectToolkit } from "../../mcp/toolkits/project/tools.ts";
import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import * as ThreadManagement from "../../orchestration-v2/ThreadManagementService.ts";
import * as ServerEnvironment from "../../environment/ServerEnvironment.ts";
import * as ProjectService from "../../project/ProjectService.ts";
import * as RepositoryIdentityResolver from "../../project/RepositoryIdentityResolver.ts";
import { forkParked } from "../../serverActivation.ts";
import * as PeerForwarding from "../PeerForwarding.ts";
import * as PeerLinks from "../PeerLinks.ts";
import * as HandoffGit from "./HandoffGit.ts";

/** What the thread there starts with, unless the move names its own. */
const DEFAULT_CONTINUATION =
  "This thread was just moved here from another machine, with its conversation and its uncommitted work. Continue where it left off.";

const MAX_REMOTE_PROJECT_PAGES = 20;

type HandoffState = OrchestrationV2ThreadHandoff["state"];

/**
 * Moves a thread to a linked environment: its conversation, and its git work
 * (unpushed commits, uncommitted edits, new files). Exactly one copy stays
 * live: the thread here takes no new turns once it starts moving, and reads
 * only once it has moved. A failed move releases it with the reason.
 *
 * An agent can ask to move its own thread mid-turn; the move then waits for
 * that turn to end (`pending`), and a message to the thread before then cancels it.
 */
export class ThreadHandoff extends Context.Service<
  ThreadHandoff,
  {
    /** Where the thread can go: linked environments with a project of its repository. */
    readonly options: (threadId: ThreadId) => Effect.Effect<
      ReadonlyArray<{
        readonly environmentId: EnvironmentId;
        readonly label: string;
        readonly projectId: ProjectId | null;
        readonly reason: string | null;
      }>,
      ThreadHandoffError
    >;
    /**
     * Moves `threadId` to `environmentId` now. An agent moving the thread it
     * runs in (`callerThreadId`, the default target) or a caller passing
     * `whenTurnEnds: true` while a turn runs schedules the move for when that
     * turn ends. Returns the state the move is in.
     */
    readonly start: (input: {
      readonly threadId?: ThreadId | undefined;
      readonly callerThreadId?: ThreadId | undefined;
      readonly environmentId: EnvironmentId;
      readonly projectId?: ProjectId | undefined;
      readonly whenTurnEnds?: boolean | undefined;
      readonly continuationPrompt?: string | undefined;
    }) => Effect.Effect<OrchestrationV2ThreadHandoff, ThreadHandoffError>;
    /** Cancels a move that is still waiting for the turn to end, or dismisses a failed one. */
    readonly cancel: (threadId: ThreadId) => Effect.Effect<void, ThreadHandoffError>;
    /** Runs moves whose turn ended, and settles any a restart cut short. */
    readonly start_: () => Effect.Effect<void, never, Scope.Scope>;
    /** Settles one thread's move now: what the follower does when its turn ends. */
    readonly settle: (threadId: ThreadId) => Effect.Effect<void>;
  }
>()("t3/peer/handoff/ThreadHandoff") {}

/** A failure the other environment reported, carried as the move's own. */
const fromRemote = (cause: OrchestratorMcpFailure) =>
  new ThreadHandoffError({ reason: "failed", message: cause.message, cause });

const make = Effect.gen(function* () {
  const threads = yield* ThreadManagement.ThreadManagementService;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const projects = yield* ProjectService.ProjectService;
  const repositoryIdentities = yield* RepositoryIdentityResolver.RepositoryIdentityResolver;
  const forwarding = yield* PeerForwarding.PeerForwarding;
  const links = yield* PeerLinks.PeerLinks;
  const git = yield* HandoffGit.HandoffGit;
  const httpClient = yield* HttpClient.HttpClient;
  const fileSystem = yield* FileSystem.FileSystem;
  const secureRandom = yield* SecureRandom.SecureRandom;
  const hereId = yield* ServerEnvironment.ServerEnvironment.pipe(
    Effect.flatMap((environment) => environment.getEnvironmentId),
  );

  /** The thread's agent, acting on its own behalf there through the link. */
  const scopeFor = (thread: {
    readonly id: ThreadId;
    readonly providerInstanceId: string;
  }): McpInvocationContext.McpThreadInvocationScope => ({
    environmentId: hereId,
    requestNamespace: `handoff:${thread.id}`,
    thread: {
      threadId: thread.id,
      providerSessionId: `handoff:${thread.id}`,
      providerInstanceId: thread.providerInstanceId as never,
    },
    client: undefined,
    capabilities: new Set(["orchestration"]),
    issuedAt: 0,
  });

  const setHandoff = Effect.fn("ThreadHandoff.setHandoff")(function* (
    threadId: ThreadId,
    expected: HandoffState | null,
    handoff: OrchestrationV2ThreadHandoff | null,
    step: string,
    expectedHandoffId?: string | null,
  ) {
    const commandKey = handoff?.handoffId ?? expectedHandoffId ?? "clear";
    yield* threads
      .dispatch({
        type: "thread.handoff.update",
        commandId: CommandId.make(`command:handoff:${threadId}:${commandKey}:${step}`),
        threadId,
        expected,
        ...(expectedHandoffId === undefined ? {} : { expectedHandoffId }),
        handoff,
      })
      .pipe(
        Effect.asVoid,
        Effect.mapError(
          (error) => new ThreadHandoffError({ reason: "refused", message: error.message }),
        ),
      );
  });

  /** The project there with this thread's repository, or the one named. */
  const remoteProject = Effect.fn("ThreadHandoff.remoteProject")(function* (
    scope: McpInvocationContext.McpThreadInvocationScope,
    environmentId: EnvironmentId,
    projectId: ProjectId,
    requested: ProjectId | undefined,
  ) {
    if (requested !== undefined) return requested;
    const here = yield* projects.getById(projectId).pipe(
      Effect.map(Option.getOrUndefined),
      Effect.orElseSucceed(() => undefined),
    );
    // The project's own identity reads blank while its cache is cold.
    const key =
      here === undefined
        ? undefined
        : (yield* repositoryIdentities.resolve(here.workspaceRoot))?.canonicalKey;
    if (key === undefined) {
      return yield* new ThreadHandoffError({
        reason: "refused",
        message:
          "This thread's project has no repository to match there. Pick the project there.",
      });
    }
    const allProjects: Array<Project> = [];
    let cursor: number | undefined;
    for (let page = 0; page < MAX_REMOTE_PROJECT_PAGES; page += 1) {
      const listed = yield* forwarding
        .call(scope, ProjectToolkit.tools.t3_project_list, environmentId, {
          limit: 100,
          ...(cursor === undefined ? {} : { cursor }),
        })
        .pipe(Effect.mapError(fromRemote));
      allProjects.push(...listed.projects);
      if (listed.nextCursor === null || listed.nextCursor === cursor) break;
      cursor = listed.nextCursor;
    }
    const matches = allProjects.filter(
      (project) => project.repositoryIdentity?.canonicalKey === key,
    );
    if (matches.length !== 1) {
      return yield* new ThreadHandoffError({
        reason: "refused",
        message:
          matches.length === 0
            ? `No project there has this repository (${key}). Add it there first.`
            : `Several projects there have this repository; pick one: ${matches.map((p) => p.title).join(", ")}.`,
      });
    }
    return matches[0]!.id;
  });

  /** The conversation as the thread there will see it. */
  const conversation = Effect.fn("ThreadHandoff.conversation")(function* (threadId: ThreadId) {
    return yield* threads
      .getThreadRecords(threadId, ["messages"], { messageRoles: ["user", "assistant"] })
      .pipe(
        Effect.map((records) =>
          records.messages
            .filter(
              (message) =>
                !message.streaming &&
                message.notification === undefined &&
                message.delegatedCompletion === undefined &&
                message.text.trim() !== "",
            )
            .slice(-2_000)
            .map((message): OrchestratorMcpImportedMessage => ({
              role: message.role === "user" ? "user" : "assistant",
              text: message.text.slice(0, 200_000),
              createdAt: DateTime.formatIso(message.createdAt),
            })),
        ),
        Effect.mapError(
          () =>
            new ThreadHandoffError({
              reason: "failed",
              message: "The conversation could not be read.",
            }),
        ),
      );
  });

  /** Uploads the bundle there through its signed upload route. */
  const upload = Effect.fn("ThreadHandoff.upload")(function* (
    scope: McpInvocationContext.McpThreadInvocationScope,
    environmentId: EnvironmentId,
    packed: HandoffGit.HandoffPackage,
  ) {
    const prepared = yield* forwarding
      .call(scope, AttachmentToolkit.tools.t3_attachment_prepare_upload, environmentId, {
        upload: {
          type: "file",
          name: `${packed.snapshot.slice(0, 12)}.bundle`,
          mimeType: "application/x-git-bundle",
          sizeBytes: packed.bundleBytes,
        },
      })
      .pipe(Effect.mapError(fromRemote));
    const resolved = yield* links
      .resolve(environmentId)
      .pipe(
        Effect.mapError(
          (error) => new ThreadHandoffError({ reason: "failed", message: error.message }),
        ),
      );
    const bytes = yield* fileSystem.readFile(packed.bundlePath).pipe(
      Effect.mapError(
        () =>
          new ThreadHandoffError({
            reason: "failed",
            message: "The bundle could not be read.",
          }),
      ),
    );
    const response = yield* httpClient
      .execute(
        HttpClientRequest.post(`${resolved.url}${prepared.relativeUrl}`).pipe(
          HttpClientRequest.setBody(HttpBody.uint8Array(bytes, "application/x-git-bundle")),
        ),
      )
      .pipe(
        Effect.mapError(
          () =>
            new ThreadHandoffError({
              reason: "failed",
              message: "The linked environment stopped answering mid-upload.",
            }),
        ),
      );
    if (response.status !== 204) {
      return yield* new ThreadHandoffError({
        reason: "failed",
        message: `The linked environment refused the upload (HTTP ${response.status}).`,
      });
    }
    return prepared.attachmentId;
  });

  /** The move itself, from `departing`: package, send, import, then mark departed. */
  const depart = Effect.fn("ThreadHandoff.depart")(function* (
    threadId: ThreadId,
    projectHint?: ProjectId | undefined,
  ) {
    const records = yield* threads
      .getThreadRecords(threadId, [])
      .pipe(
        Effect.mapError(
          () =>
            new ThreadHandoffError({ reason: "not_found", message: "The thread was not found." }),
        ),
      );
    const thread = records.thread;
    const handoff = thread.handoff;
    if (handoff?.state !== "departing") return handoff;
    const scope = scopeFor(thread);
    const result = yield* Effect.gen(function* () {
      const projectId = yield* remoteProject(
        scope,
        handoff.environmentId,
        thread.projectId,
        projectHint ?? handoff.projectId,
      );
      const project = yield* projects.getById(thread.projectId).pipe(
        Effect.map(Option.getOrUndefined),
        Effect.orElseSucceed(() => undefined),
      );
      const cwd = thread.worktreePath ?? project?.workspaceRoot;
      const tempDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-handoff-" }).pipe(
        Effect.mapError(
          () =>
            new ThreadHandoffError({
              reason: "failed",
              message: "No temp space for the move.",
            }),
        ),
      );
      const packed =
        cwd === undefined
          ? undefined
          : yield* git.pack({ cwd, handoffId: handoff.handoffId, outDir: tempDir }).pipe(
              Effect.catchTags({
                // A thread outside git moves with its conversation only.
                HandoffNotARepositoryError: () => Effect.succeed(undefined),
              }),
              Effect.mapError(
                (error) => new ThreadHandoffError({ reason: "refused", message: error.message }),
              ),
            );
      const attachmentId =
        packed === undefined ? undefined : yield* upload(scope, handoff.environmentId, packed);
      return yield* forwarding
        .call(scope, ProjectToolkit.tools.t3_thread_import, handoff.environmentId, {
          source: {
            environmentId: hereId,
            threadId,
            handoffId: handoff.handoffId,
          },
          projectId,
          title: thread.title,
          modelSelection: thread.modelSelection,
          runtimeMode: thread.runtimeMode,
          interactionMode: thread.interactionMode,
          messages: yield* conversation(threadId),
          continuationPrompt: handoff.continuationPrompt ?? DEFAULT_CONTINUATION,
          ...(packed === undefined || attachmentId === undefined
            ? {}
            : {
                bundle: {
                  attachmentId,
                  branch: packed.branch,
                  tip: packed.tip,
                  snapshot: packed.snapshot,
                },
              }),
        })
        .pipe(Effect.mapError(fromRemote));
    }).pipe(Effect.scoped, Effect.result);
    if (result._tag === "Failure") {
      yield* setHandoff(
        threadId,
        "departing",
        {
          state: "failed",
          handoffId: handoff.handoffId,
          environmentId: handoff.environmentId,
          label: handoff.label,
          lastError: result.failure.message,
        },
        "failed",
        handoff.handoffId,
      ).pipe(Effect.ignore);
      return yield* Effect.fail(result.failure);
    }
    const departed: OrchestrationV2ThreadHandoff = {
      state: "departed",
      handoffId: handoff.handoffId,
      environmentId: handoff.environmentId,
      label: handoff.label,
      threadId: result.success.threadId,
    };
    yield* setHandoff(threadId, "departing", departed, "departed", handoff.handoffId);
    return departed;
  });

  const options: ThreadHandoff["Service"]["options"] = Effect.fn("ThreadHandoff.options")(
    function* (threadId) {
      const records = yield* threads
        .getThreadRecords(threadId, [])
        .pipe(
          Effect.mapError(
            () =>
              new ThreadHandoffError({ reason: "not_found", message: "The thread was not found." }),
          ),
        );
      const listed = yield* links.list.pipe(Effect.orElseSucceed(() => []));
      return yield* Effect.forEach(
        listed,
        (link) =>
          link.status !== "reachable"
            ? Effect.succeed({
                environmentId: link.environmentId,
                label: link.label,
                projectId: null,
                reason:
                  link.status === "expired" ? "The link expired." : "Not answering right now.",
              })
            : remoteProject(
                scopeFor(records.thread),
                link.environmentId,
                records.thread.projectId,
                undefined,
              ).pipe(
                Effect.map((projectId) => ({
                  environmentId: link.environmentId,
                  label: link.label,
                  projectId,
                  reason: null,
                })),
                Effect.catch((error) =>
                  Effect.succeed({
                    environmentId: link.environmentId,
                    label: link.label,
                    projectId: null,
                    reason: error.message,
                  }),
                ),
              ),
        { concurrency: 4 },
      );
    },
  );

  const start: ThreadHandoff["Service"]["start"] = Effect.fn("ThreadHandoff.start")(
    function* (request) {
      const threadId = request.threadId ?? request.callerThreadId;
      if (threadId === undefined) {
        return yield* new ThreadHandoffError({
          reason: "refused",
          message: "Pass threadId: this MCP client is not running inside a T3 thread.",
        });
      }
      const whenTurnEnds = request.whenTurnEnds ?? threadId === request.callerThreadId;
      const records = yield* threads
        .getThreadRecords(threadId, ["runs"])
        .pipe(
          Effect.mapError(
            () =>
              new ThreadHandoffError({ reason: "not_found", message: "The thread was not found." }),
          ),
        );
      const thread = records.thread;
      if (thread.archivedAt !== null) {
        return yield* new ThreadHandoffError({
          reason: "refused",
          message: "Unarchive the thread to move it.",
        });
      }
      const current = thread.handoff?.state ?? null;
      if (current === "pending" || current === "departing" || current === "departed") {
        return yield* new ThreadHandoffError({
          reason: "refused",
          message: `This thread's move is already ${current}.`,
        });
      }
      const link = (yield* links.list.pipe(Effect.orElseSucceed(() => []))).find(
        (candidate) => candidate.environmentId === request.environmentId,
      );
      if (link === undefined) {
        return yield* new ThreadHandoffError({
          reason: "refused",
          message: "That environment is not linked.",
        });
      }
      // Fails now, while the asking agent can still say so, rather than after its turn.
      const resolvedProjectId = yield* remoteProject(
        scopeFor(thread),
        request.environmentId,
        thread.projectId,
        request.projectId,
      );
      const handoffId = (yield* secureRandom.uuidV4()).replaceAll("-", "");
      const busy = records.runs.some(
        (run) =>
          run.status === "running" ||
          run.status === "starting" ||
          run.status === "waiting" ||
          run.status === "queued" ||
          run.status === "preparing",
      );
      const base = {
        handoffId,
        environmentId: request.environmentId,
        label: link.label,
        projectId: resolvedProjectId,
        ...(request.continuationPrompt === undefined
          ? {}
          : { continuationPrompt: request.continuationPrompt }),
      };
      if (busy) {
        if (!whenTurnEnds) {
          return yield* new ThreadHandoffError({
            reason: "refused",
            message: "The thread is running a turn. Stop it, or let it move when the turn ends.",
          });
        }
        const pending: OrchestrationV2ThreadHandoff = {
          state: "pending",
          ...base,
          askedAt: DateTime.formatIso(yield* DateTime.now),
        };
        yield* setHandoff(threadId, current, pending, "pending", thread.handoff?.handoffId ?? null);
        // Catch the race where the running turn ended while `remoteProject` was in flight.
        yield* settle(threadId);
        const latest = yield* threads.getThreadRecords(threadId, []).pipe(
          Effect.map((currentRecords) => currentRecords.thread.handoff),
          Effect.orElseSucceed(() => pending),
        );
        return latest ?? pending;
      }
      yield* setHandoff(
        threadId,
        current,
        { state: "departing", ...base },
        "departing",
        thread.handoff?.handoffId ?? null,
      );
      return (yield* depart(threadId, resolvedProjectId)) ?? { state: "departing", ...base };
    },
  );

  const cancel: ThreadHandoff["Service"]["cancel"] = Effect.fn("ThreadHandoff.cancel")(
    function* (threadId) {
      const records = yield* threads
        .getThreadRecords(threadId, [])
        .pipe(
          Effect.mapError(
            () =>
              new ThreadHandoffError({ reason: "not_found", message: "The thread was not found." }),
          ),
        );
      const handoff = records.thread.handoff;
      if (handoff === undefined) return;
      if (handoff.state !== "pending" && handoff.state !== "failed") {
        return yield* new ThreadHandoffError({
          reason: "refused",
          message: `This thread's move is ${handoff.state} and cannot be cancelled.`,
        });
      }
      yield* setHandoff(threadId, handoff.state, null, "cancel", handoff.handoffId);
    },
  );

  /** A pending move whose turn ended departs; one a restart cut short is settled. */
  const settle = Effect.fn("ThreadHandoff.settle")(function* (threadId: ThreadId) {
    yield* Effect.gen(function* () {
      const records = yield* threads.getThreadRecords(threadId, ["runs", "messages"], {
        messageRoles: ["user"],
      });
      const handoff = records.thread.handoff;
      if (handoff === undefined) return;
      if (handoff.state === "pending") {
        const live = records.runs.some(
          (run) =>
            run.status === "running" ||
            run.status === "starting" ||
            run.status === "waiting" ||
            run.status === "preparing",
        );
        if (live) return;
        // Someone wrote during the turn the agent asked in, steered into it or
        // queued after it: new instructions win. That is the user, or an agent
        // the user works through, such as an orchestrator.
        const askedAtParsed =
          handoff.askedAt === undefined ? undefined : Option.getOrUndefined(DateTime.make(handoff.askedAt));
        const asked = askedAtParsed ?? records.runs.at(-1)?.requestedAt;
        const runTriggerMessageIds = new Set(records.runs.map((run) => run.userMessageId));
        const writtenSince =
          asked !== undefined &&
          records.messages.some(
            (message) =>
              !runTriggerMessageIds.has(message.id) &&
              DateTime.isGreaterThanOrEqualTo(message.createdAt, asked),
          );
        if (writtenSince || records.runs.some((run) => run.status === "queued")) {
          yield* setHandoff(threadId, "pending", null, "cancel-by-user", handoff.handoffId);
          return;
        }
        const { askedAt: _askedAt, ...rest } = handoff;
        yield* setHandoff(
          threadId,
          "pending",
          { ...rest, state: "departing" },
          "departing",
          handoff.handoffId,
        );
      }
      const now = yield* threads.getThreadRecords(threadId, []);
      if (now.thread.handoff?.state === "departing") {
        yield* depart(threadId).pipe(Effect.ignoreCause({ log: true }));
      }
    }).pipe(Effect.ignoreCause({ log: true }));
  });

  const start_: ThreadHandoff["Service"]["start_"] = () =>
    forkParked(
      Effect.gen(function* () {
        // Capture sequence before the startup sweep so no run-end event between
        // the sweep and live subscription is missed, without replaying old history.
        const afterSequence = yield* threads
          .getLatestEventSequence()
          .pipe(Effect.orElseSucceed(() => 0));
        // Moves a restart cut short, or that were waiting for a turn that ended meanwhile.
        const shells = yield* projections.getShellSnapshot().pipe(
          Effect.map((snapshot) => snapshot.threads),
          Effect.orElseSucceed(() => []),
        );
        yield* Effect.forEach(
          shells.filter(
            (shell) => shell.handoff?.state === "pending" || shell.handoff?.state === "departing",
          ),
          (shell) => settle(shell.id),
          { discard: true },
        );
        yield* threads.streamStoredEventsFrom({ afterSequence, eventType: "run.updated" }).pipe(
          Stream.filter(
            (stored) =>
              stored.event.type === "run.updated" &&
              ["completed", "failed", "cancelled", "interrupted", "rolled_back"].includes(
                stored.event.payload.status,
              ),
          ),
          Stream.runForEach((stored) => settle(stored.event.threadId)),
        );
      }).pipe(Effect.ignoreCause({ log: true })),
    );

  return ThreadHandoff.of({ options, start, cancel, start_, settle });
});

export const layer = Layer.effect(ThreadHandoff, make);
