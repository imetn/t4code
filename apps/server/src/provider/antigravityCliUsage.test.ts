import { ProviderInstanceId, ProviderSetupError } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import {
  buildAntigravityCliUsageSpawnInput,
  type AntigravityProfile,
} from "./antigravityAuthSupport.ts";
import {
  antigravitySupportsCliUsage,
  isAntigravityAccountSuspendedText,
  makeAntigravityCliUsageProbe,
  parseAntigravityCliUsageOutput,
  type AntigravityCliUsageQuarantine,
  type AntigravityCliUsageSpawnConfig,
} from "./antigravityCliUsage.ts";

const VALID_USAGE_JSON = JSON.stringify({
  status: "SUCCESS",
  num_turns: 0,
  command: {
    name: "usage",
    data: {
      groups: [
        {
          name: "Gemini Models",
          buckets: [
            {
              id: "gemini-5h",
              name: "5-Hour Limit",
              window: "5h",
              remaining_fraction: 0.65,
              reset_time: "2026-11-27T05:00:00Z",
            },
            {
              id: "gemini-weekly",
              name: "Weekly Limit",
              window: "weekly",
              remaining_fraction: 0.9,
              reset_time: "2026-12-03T00:00:00Z",
            },
            {
              id: "gemini-disabled",
              name: "Disabled",
              window: "5h",
              remaining_fraction: 0,
              disabled: true,
            },
          ],
        },
        {
          name: "Claude & GPT",
          buckets: [
            {
              id: "3p-5h",
              name: "5-Hour Limit",
              window: "5h",
              remaining_fraction: 0.4,
              reset_time: "2026-11-27T04:00:00Z",
            },
          ],
        },
      ],
    },
  },
});

const DEFAULT_SPAWN: AntigravityCliUsageSpawnConfig = {
  command: "/usr/local/bin/agy",
  args: ["-p", "/usage", "--output-format", "json", "--print-timeout", "20s"],
  cwd: "/tmp/antigravity-usage",
  env: {
    GEMINI_HOME: "/tmp/profile",
    ANTIGRAVITY_GEMINI_DIR: "/tmp/profile",
    ANTIGRAVITY_APP_DATA_DIR: "antigravity-acp",
    AGY_CLI_DISABLE_AUTO_UPDATE: "true",
  },
  extendEnv: false,
  version: "1.5.15",
};

interface FakeProcessReply {
  readonly stdout?: string;
  readonly stderr?: string;
  readonly exitCode?: number;
  readonly hang?: boolean;
}

const makeFakeSpawner = (
  replies: Ref.Ref<FakeProcessReply>,
  spawned: Ref.Ref<
    ReadonlyArray<{ readonly command: string; readonly args: ReadonlyArray<string> }>
  >,
) =>
  ChildProcessSpawner.make(
    Effect.fnUntraced(function* (command) {
      if (command._tag === "StandardCommand") {
        yield* Ref.update(spawned, (all) => [
          ...all,
          { command: command.command, args: [...command.args] },
        ]);
      }
      const reply = yield* Ref.get(replies);
      const encode = (text: string) =>
        text.length === 0 ? Stream.empty : Stream.succeed(new TextEncoder().encode(text));
      const handle = {
        [ChildProcessSpawner.HandleTypeId]: ChildProcessSpawner.HandleTypeId,
        pid: ChildProcessSpawner.ProcessId(12345),
        stdin: Sink.drain,
        stdout: reply.hang ? Stream.never : encode(reply.stdout ?? ""),
        stderr: reply.hang ? Stream.never : encode(reply.stderr ?? ""),
        all: Stream.empty,
        exitCode: reply.hang
          ? Effect.never
          : Effect.succeed(ChildProcessSpawner.ExitCode(reply.exitCode ?? 0)),
        isRunning: Effect.succeed(Boolean(reply.hang)),
        kill: () => Effect.void,
        getInputFd: () => Sink.drain,
        getOutputFd: () => Stream.empty,
      } as unknown as ChildProcessSpawner.ChildProcessHandle;
      return handle;
    }),
  );

describe("antigravitySupportsCliUsage", () => {
  it.each([
    ["1.1.10", false],
    ["1.0.99", false],
    ["v1.1.10", false],
    ["unknown", false],
    ["", false],
    [null, false],
    [undefined, false],
    ["1.1.11", true],
    ["v1.5.15", true],
    ["agy_acp_server_1.5.12", true],
    ["2.0.0", true],
  ] as const)("%s → %s", (version, expected) => {
    expect(antigravitySupportsCliUsage(version)).toBe(expected);
  });
});

describe("isAntigravityAccountSuspendedText", () => {
  it("recognizes ToS restrictions and validation errors", () => {
    expect(
      isAntigravityAccountSuspendedText(
        "PERMISSION_DENIED (code 403): Antigravity access is disabled in this account due to a violation of Google's Terms of Service.",
      ),
    ).toBe(true);
    expect(isAntigravityAccountSuspendedText("Error 403: VALIDATION_REQUIRED")).toBe(true);
    expect(isAntigravityAccountSuspendedText("Error 503: Service temporarily unavailable")).toBe(
      false,
    );
  });
});

describe("parseAntigravityCliUsageOutput", () => {
  it("parses official agy /usage JSON groups and skips disabled buckets", () => {
    const result = parseAntigravityCliUsageOutput(
      VALID_USAGE_JSON,
      Date.parse("2026-11-27T00:00:00Z"),
    );
    expect(result._tag).toBe("ok");
    if (result._tag !== "ok") return;
    expect(result.windows).toEqual([
      {
        id: "gemini-5h",
        label: "Gemini · 5-hour",
        kind: "session",
        usedPercent: 35,
        resetsAt: "2026-11-27T05:00:00.000Z",
        windowDurationMins: 300,
      },
      {
        id: "gemini-weekly",
        label: "Gemini · Weekly",
        kind: "weekly",
        usedPercent: 10,
        resetsAt: "2026-12-03T00:00:00.000Z",
        windowDurationMins: 10080,
      },
      {
        id: "3p-5h",
        label: "Claude & GPT (shared) · 5-hour",
        kind: "session",
        usedPercent: 60,
        resetsAt: "2026-11-27T04:00:00.000Z",
        windowDurationMins: 300,
      },
    ]);
  });

  it("suppresses untouched rolling full-window reset timestamps", () => {
    const requestedAtMs = Date.parse("2026-11-27T00:00:00.000Z");
    const untouched = JSON.stringify({
      status: "SUCCESS",
      num_turns: 0,
      command: {
        name: "usage",
        data: {
          groups: [
            {
              name: "Gemini",
              buckets: [
                {
                  id: "gemini-5h",
                  window: "5h",
                  remaining_fraction: 1,
                  reset_time: "2026-11-27T05:00:10.000Z",
                },
              ],
            },
          ],
        },
      },
    });
    const result = parseAntigravityCliUsageOutput(untouched, requestedAtMs);
    expect(result).toEqual({
      _tag: "ok",
      windows: [
        {
          id: "gemini-5h",
          label: "Gemini · 5-hour",
          kind: "session",
          usedPercent: 0,
          windowDurationMins: 300,
        },
      ],
    });
  });

  it("flags model turns when num_turns > 0 or command.name !== usage", () => {
    expect(
      parseAntigravityCliUsageOutput(
        JSON.stringify({ status: "SUCCESS", num_turns: 1, response: "Here is your usage." }),
        0,
      ),
    ).toEqual({ _tag: "modelTurn" });
    expect(
      parseAntigravityCliUsageOutput(
        JSON.stringify({ status: "SUCCESS", num_turns: 0, response: "I cannot check usage." }),
        0,
      ),
    ).toEqual({ _tag: "modelTurn" });
  });
});

describe("buildAntigravityCliUsageSpawnInput", () => {
  it("isolates profile env, strips display variables, and never disables slash commands", () => {
    const profile: AntigravityProfile = {
      platform: "darwin",
      geminiHome: "/tmp/t3-profile",
      acpDirectory: "/tmp/t3-profile/antigravity-acp",
      tokenPath: "/tmp/t3-profile/antigravity-acp/acp_token.json",
      tempDirectory: "/tmp/t3-tmp",
      browserCommand: "node -e ''",
      fileTokenStorage: true,
    };
    const spawn = buildAntigravityCliUsageSpawnInput({
      installation: { executablePath: "/opt/agy" },
      profile,
      cwd: "/tmp/work",
      baseEnv: {
        PATH: "/usr/bin",
        DISPLAY: ":0",
        WAYLAND_DISPLAY: "wayland-0",
        GEMINI_API_KEY: "should-be-stripped",
      },
    });
    expect(spawn.args).toEqual([
      "-p",
      "/usage",
      "--output-format",
      "json",
      "--print-timeout",
      "20s",
    ]);
    expect(spawn.args).not.toContain("--disable-slash-commands");
    expect(spawn.env.GEMINI_HOME).toBe("/tmp/t3-profile");
    expect(spawn.env.ANTIGRAVITY_GEMINI_DIR).toBe("/tmp/t3-profile");
    expect(spawn.env.ANTIGRAVITY_APP_DATA_DIR).toBe("antigravity-acp");
    expect(spawn.env.AGY_CLI_DISABLE_AUTO_UPDATE).toBe("true");
    expect(spawn.env.AGY_CLI_FORCE_FILE_TOKEN_STORAGE).toBe("1");
    expect(spawn.env.DISPLAY).toBeUndefined();
    expect(spawn.env.WAYLAND_DISPLAY).toBeUndefined();
    expect(spawn.env.GEMINI_API_KEY).toBeUndefined();
  });
});

describe("makeAntigravityCliUsageProbe", () => {
  it.effect(
    "never spawns when mode is off, unauthenticated, API-key auth, or version < 1.1.11",
    () =>
      Effect.gen(function* () {
        const replies = yield* Ref.make<FakeProcessReply>({ stdout: VALID_USAGE_JSON });
        const spawned = yield* Ref.make<
          ReadonlyArray<{ readonly command: string; readonly args: ReadonlyArray<string> }>
        >([]);
        const spawner = makeFakeSpawner(replies, spawned);

        const offProbe = yield* makeAntigravityCliUsageProbe({
          usageProbeMode: "off",
          authMethod: "oauth-personal",
          prepareSpawn: Effect.succeed(DEFAULT_SPAWN),
        }).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner));
        expect(yield* offProbe.probe({ version: "1.5.15", authenticated: true })).toBeUndefined();

        const apiKeyProbe = yield* makeAntigravityCliUsageProbe({
          usageProbeMode: "manual",
          authMethod: "gemini-api-key",
          prepareSpawn: Effect.succeed(DEFAULT_SPAWN),
        }).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner));
        expect(
          (yield* apiKeyProbe.probe({ version: "1.5.15", authenticated: true }))?.unavailable
            ?.reason,
        ).toBe("unsupported");

        const manualProbe = yield* makeAntigravityCliUsageProbe({
          usageProbeMode: "manual",
          authMethod: "oauth-personal",
          prepareSpawn: Effect.succeed({ ...DEFAULT_SPAWN, version: "1.1.10" }),
        }).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner));
        expect(
          yield* manualProbe.probe({ version: "1.5.15", authenticated: false }),
        ).toBeUndefined();
        expect(
          (yield* manualProbe.probe({ version: "1.1.10", authenticated: true }))?.unavailable
            ?.reason,
        ).toBe("unsupported");
        expect(
          (yield* manualProbe.probe({ version: null, authenticated: true }))?.unavailable?.reason,
        ).toBe("unsupported");

        expect(yield* Ref.get(spawned)).toEqual([]);
      }),
  );

  it.effect("enforces 60s cooldown and reads quota after cooldown expires", () =>
    Effect.gen(function* () {
      const replies = yield* Ref.make<FakeProcessReply>({ stdout: VALID_USAGE_JSON });
      const spawned = yield* Ref.make<
        ReadonlyArray<{ readonly command: string; readonly args: ReadonlyArray<string> }>
      >([]);
      const spawner = makeFakeSpawner(replies, spawned);

      const probe = yield* makeAntigravityCliUsageProbe({
        usageProbeMode: "manual",
        authMethod: "oauth-personal",
        prepareSpawn: Effect.succeed(DEFAULT_SPAWN),
      }).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner));

      const first = yield* probe.probe({ version: "1.5.15", authenticated: true });
      expect(first?.unavailable).toBeUndefined();
      expect(first?.windows).toHaveLength(3);
      expect(yield* Ref.get(spawned)).toHaveLength(1);

      // Immediate second call hits cooldown and does not spawn.
      expect(yield* probe.probe({ version: "1.5.15", authenticated: true })).toBeUndefined();
      expect(yield* Ref.get(spawned)).toHaveLength(1);

      // Advancing past 60s allows another manual probe.
      yield* TestClock.adjust("60 seconds");
      const second = yield* probe.probe({ version: "1.5.15", authenticated: true });
      expect(second?.windows).toHaveLength(3);
      expect(yield* Ref.get(spawned)).toHaveLength(2);
    }),
  );

  it.effect(
    "permanently quarantines on model-turn fallback or 403 ToS restriction until clear",
    () =>
      Effect.gen(function* () {
        const replies = yield* Ref.make<FakeProcessReply>({
          stdout: JSON.stringify({ status: "SUCCESS", num_turns: 1, response: "Quota info..." }),
        });
        const spawned = yield* Ref.make<
          ReadonlyArray<{ readonly command: string; readonly args: ReadonlyArray<string> }>
        >([]);
        const spawner = makeFakeSpawner(replies, spawned);

        const probe = yield* makeAntigravityCliUsageProbe({
          usageProbeMode: "manual",
          authMethod: "oauth-personal",
          prepareSpawn: Effect.succeed(DEFAULT_SPAWN),
        }).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner));

        const tripped = yield* probe.probe({ version: "1.5.15", authenticated: true });
        expect(tripped?.unavailable?.reason).toBe("unsupported");
        expect(tripped?.unavailable?.message).toContain("model turn");
        expect(yield* Ref.get(spawned)).toHaveLength(1);

        // Even after cooldown, quarantined probe refuses to spawn.
        yield* TestClock.adjust("120 seconds");
        const blocked = yield* probe.probe({ version: "1.5.15", authenticated: true });
        expect(blocked?.unavailable?.reason).toBe("unsupported");
        expect(yield* Ref.get(spawned)).toHaveLength(1);

        // Sign-out / sign-in clears quarantine; 403 ToS restriction re-quarantines.
        yield* probe.clear;
        yield* Ref.set(replies, {
          exitCode: 1,
          stderr: "PERMISSION_DENIED (code 403): violation of Google's Terms of Service",
        });
        const suspended = yield* probe.probe({ version: "1.5.15", authenticated: true });
        expect(suspended?.unavailable?.reason).toBe("unsupported");
        expect(suspended?.unavailable?.message).toContain("account restriction");
        expect(yield* Ref.get(spawned)).toHaveLength(2);

        yield* TestClock.adjust("120 seconds");
        expect(
          (yield* probe.probe({ version: "1.5.15", authenticated: true }))?.unavailable?.reason,
        ).toBe("unsupported");
        expect(yield* Ref.get(spawned)).toHaveLength(2);
      }),
  );

  it.effect("returns probeFailed on non-zero exit or oversized stdout without quarantining", () =>
    Effect.gen(function* () {
      const replies = yield* Ref.make<FakeProcessReply>({
        exitCode: 1,
        stderr: "transient network error",
      });
      const spawned = yield* Ref.make<
        ReadonlyArray<{ readonly command: string; readonly args: ReadonlyArray<string> }>
      >([]);
      const spawner = makeFakeSpawner(replies, spawned);

      const probe = yield* makeAntigravityCliUsageProbe({
        usageProbeMode: "manual",
        authMethod: "oauth-personal",
        prepareSpawn: Effect.succeed(DEFAULT_SPAWN),
        maxOutputBytes: 1024,
      }).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner));

      expect(
        (yield* probe.probe({ version: "1.5.15", authenticated: true }))?.unavailable?.reason,
      ).toBe("probeFailed");

      yield* TestClock.adjust("60 seconds");
      yield* Ref.set(replies, { exitCode: 0, stdout: "x".repeat(2048) });
      expect(
        (yield* probe.probe({ version: "1.5.15", authenticated: true }))?.unavailable?.reason,
      ).toBe("probeFailed");

      yield* TestClock.adjust("60 seconds");
      yield* Ref.set(replies, { exitCode: 0, stdout: VALID_USAGE_JSON });
      expect(
        (yield* probe.probe({ version: "1.5.15", authenticated: true }))?.windows,
      ).toHaveLength(3);
    }),
  );

  it.effect(
    "returns undefined without setting cooldown when withProcess rejects during sign-in",
    () =>
      Effect.gen(function* () {
        const replies = yield* Ref.make<FakeProcessReply>({ stdout: VALID_USAGE_JSON });
        const spawned = yield* Ref.make<
          ReadonlyArray<{ readonly command: string; readonly args: ReadonlyArray<string> }>
        >([]);
        const spawner = makeFakeSpawner(replies, spawned);
        const signingIn = yield* Ref.make(true);

        const probe = yield* makeAntigravityCliUsageProbe({
          usageProbeMode: "manual",
          authMethod: "oauth-personal",
          prepareSpawn: Effect.succeed(DEFAULT_SPAWN),
          withProcess: (_stop, task) =>
            Effect.gen(function* () {
              if (yield* Ref.get(signingIn)) {
                return yield* new ProviderSetupError({
                  instanceId: ProviderInstanceId.make("antigravity-test"),
                  operation: "start",
                  detail: "Sign-in is in progress.",
                });
              }
              return yield* task;
            }),
        }).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner));

        expect(yield* probe.probe({ version: "1.5.15", authenticated: true })).toBeUndefined();
        expect(yield* Ref.get(spawned)).toEqual([]);

        // Immediately after sign-in finishes, no cooldown should block the real check.
        yield* Ref.set(signingIn, false);
        expect(
          (yield* probe.probe({ version: "1.5.15", authenticated: true }))?.windows,
        ).toHaveLength(3);
        expect(yield* Ref.get(spawned)).toHaveLength(1);
      }),
  );

  it.effect(
    "aborts immediately when agy prints an interactive auth prompt instead of waiting for timeout",
    () =>
      Effect.gen(function* () {
        const spawned = yield* Ref.make<
          ReadonlyArray<{ readonly command: string; readonly args: ReadonlyArray<string> }>
        >([]);
        const spawner = ChildProcessSpawner.make(
          Effect.fnUntraced(function* (command) {
            if (command._tag === "StandardCommand") {
              yield* Ref.update(spawned, (all) => [
                ...all,
                { command: command.command, args: [...command.args] },
              ]);
            }
            return {
              [ChildProcessSpawner.HandleTypeId]: ChildProcessSpawner.HandleTypeId,
              pid: ChildProcessSpawner.ProcessId(12345),
              stdin: Sink.drain,
              stdout: Stream.concat(
                Stream.succeed(
                  new TextEncoder().encode(
                    "Authentication required. Please visit the URL to log in:\n  https://accounts.google.com/o/oauth2/auth?client_id=test\n",
                  ),
                ),
                Stream.never,
              ),
              stderr: Stream.never,
              all: Stream.empty,
              exitCode: Effect.never,
              isRunning: Effect.succeed(true),
              kill: () => Effect.void,
              getInputFd: () => Sink.drain,
              getOutputFd: () => Stream.empty,
            } as unknown as ChildProcessSpawner.ChildProcessHandle;
          }),
        );

        const probe = yield* makeAntigravityCliUsageProbe({
          usageProbeMode: "manual",
          authMethod: "oauth-personal",
          prepareSpawn: Effect.succeed(DEFAULT_SPAWN),
        }).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner));

        // Resolves immediately without advancing TestClock for the 25s timeout.
        expect(
          (yield* probe.probe({ version: "1.5.15", authenticated: true }))?.unavailable?.reason,
        ).toBe("probeFailed");
      }),
  );

  it.effect("persists modelTurn quarantine per version and auto-recovers after agy upgrades", () =>
    Effect.gen(function* () {
      const replies = yield* Ref.make<FakeProcessReply>({ stdout: VALID_USAGE_JSON });
      const spawned = yield* Ref.make<
        ReadonlyArray<{ readonly command: string; readonly args: ReadonlyArray<string> }>
      >([]);
      const persisted = yield* Ref.make<ReadonlyArray<AntigravityCliUsageQuarantine | null>>([]);
      const spawner = makeFakeSpawner(replies, spawned);

      const probe = yield* makeAntigravityCliUsageProbe({
        usageProbeMode: "manual",
        authMethod: "oauth-personal",
        prepareSpawn: Effect.succeed({ ...DEFAULT_SPAWN, version: "1.5.16" }),
        persistedQuarantine: {
          kind: "modelTurn",
          version: "1.5.15",
          message: "old version quarantined",
        },
        persistQuarantine: (next) => Ref.update(persisted, (all) => [...all, next]),
      }).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner));

      // Same version stays blocked.
      expect(
        (yield* probe.probe({ version: "1.5.15", authenticated: true }))?.unavailable?.reason,
      ).toBe("unsupported");
      expect(yield* Ref.get(spawned)).toEqual([]);

      // Upgraded version clears the stale modelTurn quarantine and succeeds.
      const upgraded = yield* probe.probe({ version: "1.5.16", authenticated: true });
      expect(upgraded?.windows).toHaveLength(3);
      expect(yield* Ref.get(persisted)).toEqual([null]);
      expect(yield* Ref.get(spawned)).toHaveLength(1);
    }),
  );
});
