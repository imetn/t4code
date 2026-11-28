import {
  type ProviderContextBreakdown,
  type ProviderContextCategory,
  type ProviderContextMemoryFile,
  type ProviderContextSkill,
  ProviderMcpControlError,
  type ProviderMcpReconnectInput,
  type ProviderMcpReconnectResult,
  type ProviderMcpServerEntry,
  type ProviderMcpToggleInput,
  type ProviderMcpToggleResult,
  ProviderThreadInspectError,
  type ProviderThreadInspectInput,
  type ProviderThreadInspectResult,
  type ThreadTokenUsageSnapshot,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";

import * as ProviderSessionManager from "../orchestration-v2/ProviderSessionManager.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";

const WORKSPACE_MEMORY_CANDIDATES = [
  "AGENTS.md",
  "CLAUDE.md",
  ".claude/CLAUDE.md",
  "GEMINI.md",
  ".cursorrules",
  ".github/copilot-instructions.md",
] as const;

const MAX_MEMORY_FILE_BYTES = 1_048_576;

const isMcpControlError = Schema.is(ProviderMcpControlError);
const isInspectError = Schema.is(ProviderThreadInspectError);

export function buildEstimatedContextCategories(
  usage: ThreadTokenUsageSnapshot,
): ReadonlyArray<ProviderContextCategory> {
  const usedTokens = Math.max(0, Math.round(usage.usedTokens));
  const categories: ProviderContextCategory[] = [];

  const rawCached =
    usage.lastCachedInputTokens ??
    (usage.cachedInputTokens !== undefined && usage.cachedInputTokens <= usedTokens
      ? usage.cachedInputTokens
      : 0);
  const cached = Math.min(usedTokens, Math.max(0, Math.round(rawCached)));

  const rawReasoning =
    usage.lastReasoningOutputTokens ??
    (usage.reasoningOutputTokens !== undefined && usage.reasoningOutputTokens <= usedTokens
      ? usage.reasoningOutputTokens
      : 0);
  const reasoning = Math.min(
    Math.max(0, usedTokens - cached),
    Math.max(0, Math.round(rawReasoning)),
  );

  const rawOutput = usage.lastOutputTokens ?? 0;
  const output = Math.min(
    Math.max(0, usedTokens - cached - reasoning),
    Math.max(0, Math.round(rawOutput) - reasoning),
  );

  const input = Math.max(0, usedTokens - cached - reasoning - output);

  if (cached > 0 || reasoning > 0 || output > 0) {
    if (input > 0) {
      categories.push({ id: "input", name: "Input", tokens: input, kind: "used" });
    }
    if (cached > 0) {
      categories.push({ id: "cached_input", name: "Cached input", tokens: cached, kind: "used" });
    }
    if (output > 0) {
      categories.push({ id: "output", name: "Output", tokens: output, kind: "used" });
    }
    if (reasoning > 0) {
      categories.push({ id: "reasoning", name: "Reasoning", tokens: reasoning, kind: "used" });
    }
  } else if (usedTokens > 0) {
    categories.push({ id: "messages", name: "Messages", tokens: usedTokens, kind: "used" });
  }

  const maxTokens = usage.maxTokens;
  if (maxTokens !== undefined && maxTokens > usedTokens) {
    const threshold = usage.autoCompactThreshold;
    if (threshold !== undefined && threshold > 0 && threshold < maxTokens) {
      const bufferTokens = Math.max(0, Math.round(maxTokens - threshold));
      const freeTokens = Math.max(0, Math.round(threshold - usedTokens));
      if (bufferTokens > 0) {
        categories.push({
          id: "autocompact_buffer",
          name: "Autocompact buffer",
          tokens: bufferTokens,
          kind: "buffer",
        });
      }
      if (freeTokens > 0) {
        categories.push({
          id: "free_space",
          name: "Free space",
          tokens: freeTokens,
          kind: "free",
        });
      }
    } else {
      categories.push({
        id: "free_space",
        name: "Free space",
        tokens: Math.max(0, Math.round(maxTokens - usedTokens)),
        kind: "free",
      });
    }
  }

  return categories;
}

/**
 * Reads live context-window breakdowns, workspace instruction/skill inventories,
 * and MCP connector statuses for a thread, and forwards connector controls to
 * the running provider session.
 */
export class ThreadInspector extends Context.Service<
  ThreadInspector,
  {
    readonly inspect: (
      input: ProviderThreadInspectInput,
    ) => Effect.Effect<ProviderThreadInspectResult, ProviderThreadInspectError>;
    readonly reconnectMcpServer: (
      input: ProviderMcpReconnectInput,
    ) => Effect.Effect<ProviderMcpReconnectResult, ProviderMcpControlError>;
    readonly toggleMcpServer: (
      input: ProviderMcpToggleInput,
    ) => Effect.Effect<ProviderMcpToggleResult, ProviderMcpControlError>;
  }
>()("t3/mcpApps/ThreadInspector") {}

const make = Effect.gen(function* () {
  const threadManagement = yield* ThreadManagementService.ThreadManagementService;
  const providerSessions = yield* ProviderSessionManager.ProviderSessionManagerV2;
  const projects = yield* Effect.serviceOption(ProjectService.ProjectService);
  const providerRegistry = yield* Effect.serviceOption(ProviderRegistry.ProviderRegistry);
  const fileSystem = yield* Effect.serviceOption(FileSystem.FileSystem);
  const path = yield* Effect.serviceOption(Path.Path);

  const discoverWorkspaceMemoryFiles = Effect.fn("ThreadInspector.discoverWorkspaceMemoryFiles")(
    function* (cwd: string | null): Effect.fn.Return<ReadonlyArray<ProviderContextMemoryFile>> {
      if (cwd === null || Option.isNone(fileSystem) || Option.isNone(path)) return [];
      const fs = fileSystem.value;
      const p = path.value;
      const seenRealPaths = new Set<string>();
      const files: ProviderContextMemoryFile[] = [];
      for (const relative of WORKSPACE_MEMORY_CANDIDATES) {
        const fullPath = p.join(cwd, relative);
        const info = yield* fs.stat(fullPath).pipe(Effect.option);
        if (Option.isNone(info) || info.value.type !== "File") continue;
        const sizeBytes = Number(info.value.size);
        if (!Number.isFinite(sizeBytes) || sizeBytes < 0 || sizeBytes > MAX_MEMORY_FILE_BYTES) {
          continue;
        }
        const canonical = yield* fs.realPath(fullPath).pipe(Effect.orElseSucceed(() => fullPath));
        if (seenRealPaths.has(canonical)) continue;
        seenRealPaths.add(canonical);
        files.push({
          path: fullPath,
          type: "Project",
          ...(sizeBytes > 0 ? { tokens: Math.max(1, Math.round(sizeBytes / 4)) } : {}),
        });
      }
      return files;
    },
  );

  const readWorkspaceSkills = Effect.fn("ThreadInspector.readWorkspaceSkills")(function* (
    providerInstanceId: string,
    cwd: string | null,
  ): Effect.fn.Return<ReadonlyArray<ProviderContextSkill>> {
    if (Option.isNone(providerRegistry)) return [];
    const providers = yield* providerRegistry.value.getProviders.pipe(
      Effect.orElseSucceed(() => []),
    );
    const provider = providers.find((entry) => entry.instanceId === providerInstanceId);
    if (!provider) return [];
    const workspaceSnapshot =
      cwd !== null ? provider.workspaceSnapshots?.find((entry) => entry.cwd === cwd) : undefined;
    const rawSkills = workspaceSnapshot?.skills ?? provider.skills ?? [];
    const skills: ProviderContextSkill[] = [];
    for (const skill of rawSkills) {
      const name = skill.name.trim();
      if (name.length === 0) continue;
      const skillPath = skill.path?.trim();
      const source = skill.scope?.trim() || "workspace";
      skills.push({
        name,
        source,
        ...(skillPath ? { path: skillPath } : {}),
      });
    }
    return skills;
  });

  const inspect = Effect.fn("ThreadInspector.inspect")(
    function* (input: ProviderThreadInspectInput) {
      const projection = yield* threadManagement.getThreadRecords(input.threadId, [
        "providerThreads",
      ]);
      const providerThread =
        projection.providerThreads.find(
          (candidate) => candidate.id === projection.thread.activeProviderThreadId,
        ) ??
        projection.providerThreads.at(-1) ??
        null;

      const project = Option.isSome(projects)
        ? Option.getOrUndefined(
            yield* projects.value
              .getById(projection.thread.projectId)
              .pipe(Effect.orElseSucceed(() => Option.none())),
          )
        : undefined;
      const cwd = projection.thread.worktreePath ?? project?.workspaceRoot ?? null;

      let sessionActive = false;
      let providerContext: ProviderContextBreakdown | null = null;
      let mcpServers: ReadonlyArray<ProviderMcpServerEntry> = [];

      if (providerThread?.providerSessionId != null) {
        const runtime = Option.getOrUndefined(
          yield* providerSessions.get(providerThread.providerSessionId),
        );
        if (runtime !== undefined) {
          sessionActive = true;
          if (runtime.threadInspector !== undefined) {
            const inspected = yield* runtime.threadInspector.inspect({ providerThread }).pipe(
              Effect.catch((cause) =>
                Effect.logWarning("thread-inspector.provider-inspect-failed", {
                  threadId: input.threadId,
                  driver: runtime.driver,
                  cause: Predicate.hasProperty(cause, "_tag") ? cause._tag : "unknown",
                }).pipe(Effect.as({ context: null, mcpServers: [] as const })),
              ),
            );
            providerContext = inspected.context;
            mcpServers = inspected.mcpServers;
          }
        }
      }

      const needsMemoryFiles = providerContext === null || providerContext.memoryFiles.length === 0;
      const needsSkills = providerContext === null || providerContext.skills.length === 0;
      const [fallbackMemoryFiles, fallbackSkills] = yield* Effect.all(
        [
          needsMemoryFiles ? discoverWorkspaceMemoryFiles(cwd) : Effect.succeed([]),
          needsSkills
            ? readWorkspaceSkills(
                providerThread?.providerInstanceId ?? projection.thread.modelSelection.instanceId,
                cwd,
              )
            : Effect.succeed([]),
        ],
        { concurrency: "unbounded" },
      );

      const usage = providerThread?.contextUsage ?? null;
      let context: ProviderContextBreakdown | null = providerContext;
      if (context !== null) {
        const categories =
          context.categories.length > 0
            ? context.categories
            : usage !== null
              ? buildEstimatedContextCategories(usage)
              : [];
        const memoryFiles =
          context.memoryFiles.length > 0 ? context.memoryFiles : fallbackMemoryFiles;
        const skills = context.skills.length > 0 ? context.skills : fallbackSkills;
        context = {
          ...context,
          categories,
          memoryFiles,
          skills,
        };
      } else if (usage !== null || fallbackMemoryFiles.length > 0 || fallbackSkills.length > 0) {
        const maxTokens = usage?.maxTokens ?? null;
        const totalTokens = usage?.usedTokens ?? 0;
        const percentage =
          maxTokens !== null && maxTokens > 0
            ? Math.round((totalTokens / maxTokens) * 1000) / 10
            : null;
        context = {
          source: "estimated",
          model: projection.thread.modelSelection.model,
          totalTokens,
          maxTokens,
          percentage,
          autoCompactThreshold: usage?.autoCompactThreshold ?? null,
          ...(usage?.compactsAutomatically !== undefined
            ? { isAutoCompactEnabled: usage.compactsAutomatically }
            : {}),
          categories: usage !== null ? buildEstimatedContextCategories(usage) : [],
          mcpTools: [],
          memoryFiles: fallbackMemoryFiles,
          skills: fallbackSkills,
        };
      }

      return {
        providerThreadId: providerThread?.id ?? null,
        sessionActive,
        context,
        mcpServers,
        fetchedAt: DateTime.formatIso(yield* DateTime.now),
      } satisfies ProviderThreadInspectResult;
    },
    (effect, input) =>
      effect.pipe(
        Effect.catch((cause) =>
          isInspectError(cause)
            ? Effect.fail(cause)
            : Effect.fail(
                new ProviderThreadInspectError({
                  threadId: input.threadId,
                  detail: "Couldn't inspect thread context and connectors.",
                }),
              ),
        ),
      ),
  );

  const resolveControl = Effect.fn("ThreadInspector.resolveControl")(function* (input: {
    readonly threadId: ProviderMcpReconnectInput["threadId"];
    readonly providerThreadId: ProviderMcpReconnectInput["providerThreadId"];
    readonly server: string;
  }) {
    const fail = (detail: string) => new ProviderMcpControlError({ server: input.server, detail });
    const projection = yield* threadManagement.getThreadRecords(input.threadId, [
      "providerThreads",
    ]);
    const providerThread = projection.providerThreads.find(
      (candidate) => candidate.id === input.providerThreadId,
    );
    if (providerThread?.providerSessionId == null) {
      return yield* fail("The agent session has ended. Send a message, then try again.");
    }
    const runtime = Option.getOrUndefined(
      yield* providerSessions.get(providerThread.providerSessionId),
    );
    if (runtime === undefined) {
      return yield* fail("The agent session has ended. Send a message, then try again.");
    }
    if (runtime.threadInspector === undefined) {
      return yield* fail("This agent doesn't support managing MCP connectors from T3 Code.");
    }
    return { providerThread, threadInspector: runtime.threadInspector };
  });

  const toControlError = (server: string, fallbackDetail: string) => (cause: unknown) =>
    isMcpControlError(cause)
      ? Effect.fail(cause)
      : Predicate.isTagged(cause, "ProviderAdapterSessionStoppedError")
        ? Effect.fail(
            new ProviderMcpControlError({
              server,
              detail: "The agent session has ended. Send a message, then try again.",
            }),
          )
        : Effect.fail(new ProviderMcpControlError({ server, detail: fallbackDetail }));

  const reconnectMcpServer = Effect.fn("ThreadInspector.reconnectMcpServer")(
    function* (input: ProviderMcpReconnectInput) {
      const { providerThread, threadInspector } = yield* resolveControl(input);
      if (threadInspector.reconnectMcpServer === undefined) {
        return yield* new ProviderMcpControlError({
          server: input.server,
          detail: "This agent doesn't support reconnecting MCP servers from T3 Code.",
        });
      }
      yield* threadInspector.reconnectMcpServer({
        providerThread,
        server: input.server,
      });
      return { reconnectedAt: DateTime.formatIso(yield* DateTime.now) };
    },
    (effect, input) =>
      effect.pipe(
        Effect.catch(toControlError(input.server, `Couldn't reconnect ${input.server}.`)),
      ),
  );

  const toggleMcpServer = Effect.fn("ThreadInspector.toggleMcpServer")(
    function* (input: ProviderMcpToggleInput) {
      const { providerThread, threadInspector } = yield* resolveControl(input);
      if (threadInspector.toggleMcpServer === undefined) {
        return yield* new ProviderMcpControlError({
          server: input.server,
          detail: "This agent doesn't support toggling MCP servers from T3 Code.",
        });
      }
      yield* threadInspector.toggleMcpServer({
        providerThread,
        server: input.server,
        enabled: input.enabled,
      });
      return { updatedAt: DateTime.formatIso(yield* DateTime.now) };
    },
    (effect, input) =>
      effect.pipe(
        Effect.catch(
          toControlError(
            input.server,
            input.enabled
              ? `Couldn't enable ${input.server}.`
              : `Couldn't disable ${input.server}.`,
          ),
        ),
      ),
  );

  return ThreadInspector.of({ inspect, reconnectMcpServer, toggleMcpServer });
});

export const layer = Layer.effect(ThreadInspector, make);
