import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, expect, it } from "@effect/vitest";
import {
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderSessionId,
  ProviderThreadId,
  ThreadId,
  type OrchestrationV2ProviderThread,
  type Project,
  type ServerProvider,
} from "@t3tools/contracts";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import * as ProviderSessionManager from "../orchestration-v2/ProviderSessionManager.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as ThreadInspector from "./ThreadInspector.ts";

describe("buildEstimatedContextCategories", () => {
  it("splits input, cached input, output, reasoning, autocompact buffer, and free space", () => {
    const categories = ThreadInspector.buildEstimatedContextCategories({
      usedTokens: 100_000,
      maxTokens: 200_000,
      lastCachedInputTokens: 60_000,
      lastOutputTokens: 10_000,
      lastReasoningOutputTokens: 4_000,
      autoCompactThreshold: 167_000,
    });
    expect(categories).toEqual([
      { id: "input", name: "Input", tokens: 30_000, kind: "used" },
      { id: "cached_input", name: "Cached input", tokens: 60_000, kind: "used" },
      { id: "output", name: "Output", tokens: 6_000, kind: "used" },
      { id: "reasoning", name: "Reasoning", tokens: 4_000, kind: "used" },
      { id: "autocompact_buffer", name: "Autocompact buffer", tokens: 33_000, kind: "buffer" },
      { id: "free_space", name: "Free space", tokens: 67_000, kind: "free" },
    ]);
  });

  it("falls back to Messages and Free space when only total usage is known", () => {
    const categories = ThreadInspector.buildEstimatedContextCategories({
      usedTokens: 45_000,
      maxTokens: 200_000,
    });
    expect(categories).toEqual([
      { id: "messages", name: "Messages", tokens: 45_000, kind: "used" },
      { id: "free_space", name: "Free space", tokens: 155_000, kind: "free" },
    ]);
  });
});

describe("ThreadInspector service", () => {
  const threadId = ThreadId.make("thread:inspect-1");
  const projectId = ProjectId.make("project:inspect-1");
  const providerThreadId = ProviderThreadId.make("provider-thread:inspect-1");
  const providerSessionId = ProviderSessionId.make("provider-session:inspect-1");
  const instanceId = ProviderInstanceId.make("claudeAgent");

  it.effect("returns live provider breakdown and forwards reconnect/toggle controls", () =>
    Effect.gen(function* () {
      const reconnected: string[] = [];
      const toggled: Array<{ server: string; enabled: boolean }> = [];
      const providerThread = {
        id: providerThreadId,
        driver: ProviderDriverKind.make("claudeAgent"),
        providerInstanceId: instanceId,
        providerSessionId,
        contextUsage: null,
      } as unknown as OrchestrationV2ProviderThread;

      const runtime = {
        driver: ProviderDriverKind.make("claudeAgent"),
        threadInspector: {
          inspect: () =>
            Effect.succeed({
              context: {
                source: "provider" as const,
                model: "claude-opus-4-6",
                totalTokens: 105_900,
                maxTokens: 240_000,
                percentage: 44.1,
                autoCompactThreshold: 207_000,
                isAutoCompactEnabled: true,
                categories: [
                  {
                    id: "messages" as const,
                    name: "Messages",
                    tokens: 44_500,
                    kind: "used" as const,
                  },
                  {
                    id: "mcp_tools" as const,
                    name: "MCP tools",
                    tokens: 18_300,
                    kind: "used" as const,
                  },
                ],
                mcpTools: [
                  { name: "mcp__linear__list_issues", serverName: "linear", tokens: 1_200 },
                ],
                memoryFiles: [{ path: "/repo/CLAUDE.md", type: "Project", tokens: 2_400 }],
                skills: [
                  {
                    name: "review",
                    source: "project",
                    path: "/repo/.agents/skills/review/SKILL.md",
                    tokens: 800,
                  },
                ],
              },
              mcpServers: [
                {
                  name: "linear",
                  status: "failed" as const,
                  toolCount: 0,
                  error: "Connection timed out",
                  canReconnect: true,
                  canToggle: true,
                  canSignIn: false,
                },
              ],
            }),
          reconnectMcpServer: ({ server }: { readonly server: string }) =>
            Effect.sync(() => void reconnected.push(server)),
          toggleMcpServer: ({
            server,
            enabled,
          }: {
            readonly server: string;
            readonly enabled: boolean;
          }) => Effect.sync(() => void toggled.push({ server, enabled })),
        },
      } as unknown as ProviderAdapter.ProviderAdapterV2SessionRuntime;

      const testLayer = ThreadInspector.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.mock(ThreadManagementService.ThreadManagementService)({
              getThreadRecords: () =>
                Effect.succeed({
                  thread: {
                    id: threadId,
                    projectId,
                    activeProviderThreadId: providerThreadId,
                    worktreePath: null,
                    modelSelection: { instanceId, model: "claude-opus-4-6" },
                  },
                  providerThreads: [providerThread],
                } as never),
            }),
            Layer.mock(ProviderSessionManager.ProviderSessionManagerV2)({
              get: () => Effect.succeed(Option.some(runtime)),
            }),
          ),
        ),
      );

      yield* Effect.gen(function* () {
        const inspector = yield* ThreadInspector.ThreadInspector;
        const result = yield* inspector.inspect({ threadId });
        assert.equal(result.sessionActive, true);
        assert.equal(result.providerThreadId, providerThreadId);
        assert.equal(result.context?.source, "provider");
        assert.equal(result.context?.totalTokens, 105_900);
        assert.equal(result.mcpServers.length, 1);
        assert.equal(result.mcpServers[0]?.name, "linear");

        yield* inspector.reconnectMcpServer({ threadId, providerThreadId, server: "linear" });
        yield* inspector.toggleMcpServer({
          threadId,
          providerThreadId,
          server: "linear",
          enabled: false,
        });
      }).pipe(Effect.provide(testLayer));

      expect(reconnected).toEqual(["linear"]);
      expect(toggled).toEqual([{ server: "linear", enabled: false }]);
    }),
  );

  it.effect(
    "enriches idle or non-inspector providers with estimated breakdown, deduped memory files, and workspace skills",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const p = yield* Path.Path;
          const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "t4-inspector-" });
          const agentsPath = p.join(tempDir, "AGENTS.md");
          const claudePath = p.join(tempDir, "CLAUDE.md");
          yield* fs.writeFileString(agentsPath, "# Project Rules\n".repeat(40));
          yield* fs.symlink(agentsPath, claudePath);

          const providerThread = {
            id: providerThreadId,
            driver: ProviderDriverKind.make("antigravity"),
            providerInstanceId: ProviderInstanceId.make("antigravity"),
            providerSessionId: null,
            contextUsage: {
              usedTokens: 50_000,
              maxTokens: 200_000,
              lastCachedInputTokens: 30_000,
            },
          } as unknown as OrchestrationV2ProviderThread;

          const testLayer = ThreadInspector.layer.pipe(
            Layer.provide(
              Layer.mergeAll(
                NodeServices.layer,
                Layer.mock(ThreadManagementService.ThreadManagementService)({
                  getThreadRecords: () =>
                    Effect.succeed({
                      thread: {
                        id: threadId,
                        projectId,
                        activeProviderThreadId: providerThreadId,
                        worktreePath: null,
                        modelSelection: {
                          instanceId: ProviderInstanceId.make("antigravity"),
                          model: "gemini-4-neon",
                        },
                      },
                      providerThreads: [providerThread],
                    } as never),
                }),
                Layer.mock(ProviderSessionManager.ProviderSessionManagerV2)({
                  get: () => Effect.succeed(Option.none()),
                }),
                Layer.mock(ProjectService.ProjectService)({
                  getById: () =>
                    Effect.succeed(
                      Option.some({ id: projectId, workspaceRoot: tempDir } as unknown as Project),
                    ),
                }),
                Layer.mock(ProviderRegistry.ProviderRegistry)({
                  getProviders: Effect.succeed([
                    {
                      instanceId: ProviderInstanceId.make("antigravity"),
                      workspaceSnapshots: [
                        {
                          cwd: tempDir,
                          skills: [
                            {
                              name: "test-t3-app",
                              scope: "project",
                              path: p.join(tempDir, ".agents/skills/test-t3-app/SKILL.md"),
                            },
                          ],
                        },
                      ],
                    } as unknown as ServerProvider,
                  ]),
                }),
              ),
            ),
          );

          const result = yield* Effect.gen(function* () {
            const inspector = yield* ThreadInspector.ThreadInspector;
            return yield* inspector.inspect({ threadId });
          }).pipe(Effect.provide(testLayer));

          assert.equal(result.sessionActive, false);
          assert.equal(result.context?.source, "estimated");
          assert.equal(result.context?.totalTokens, 50_000);
          assert.equal(result.context?.maxTokens, 200_000);
          // Symlinked CLAUDE.md -> AGENTS.md must appear only once.
          assert.equal(result.context?.memoryFiles.length, 1);
          assert.equal(result.context?.memoryFiles[0]?.path, agentsPath);
          assert.equal(result.context?.skills.length, 1);
          assert.equal(result.context?.skills[0]?.name, "test-t3-app");
        }),
      ).pipe(Effect.provide(NodeServices.layer)),
  );
});
