import {
  ProviderSetupError,
  type AntigravitySettings,
  type ServerProviderUsageLimits,
  type ServerProviderUsageWindow,
} from "@t3tools/contracts";
import {
  clampPercent,
  makeUnavailableUsageLimits,
  makeUsageLimits,
} from "@t3tools/provider-core/server/usageLimits";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

// Pre-1.1.11 agy binaries do not handle `/usage` locally in `-p` mode and send it to the model.
export const MIN_ANTIGRAVITY_USAGE_CLI_VERSION = [1, 1, 11] as const;
export const ANTIGRAVITY_CLI_USAGE_COOLDOWN_MS = 60_000;
const ANTIGRAVITY_CLI_USAGE_AUTO_INTERVAL_MS = 15 * 60_000;
const AUTO_FAILURE_BACKOFF_MS = 10 * 60_000;
const AUTO_FAILURE_BACKOFF_MAX_MS = 6 * 60 * 60_000;
export const ANTIGRAVITY_CLI_USAGE_PRINT_TIMEOUT = "20s";
export const ANTIGRAVITY_CLI_USAGE_PROCESS_TIMEOUT_MS = 25_000;
export const ANTIGRAVITY_CLI_USAGE_MAX_OUTPUT_BYTES = 512 * 1024;

const SUMMARY_WINDOW_MINS = new Map<string, number>([
  ["5h", 5 * 60],
  ["weekly", 7 * 24 * 60],
]);

const SUSPENSION_TEXT_PATTERN =
  /(?:(?:\b403\b|\bPERMISSION_DENIED\b)[\s\S]{0,400}(?:terms of service|disabled in this account|account has been (?:suspended|disabled)|violation)|violation of (?:google'?s )?terms of service|antigravity(?: access)? (?:is|has been) disabled in this account|\bVALIDATION_REQUIRED\b)/i;

// When a profile is signed out, `agy -p /usage` prints an OAuth URL and waits 60s even with stdin closed.
const AUTH_PROMPT_TEXT_PATTERN =
  /(?:Authentication required\.?\s+Please visit the URL|https:\/\/accounts\.google\.com\/o\/oauth2\/auth\b|Waiting for authentication\b)/i;

const isProviderSetupError = Schema.is(ProviderSetupError);

export const AntigravityCliUsageQuarantine = Schema.Struct({
  kind: Schema.Literals(["modelTurn", "suspended"]),
  version: Schema.NullOr(Schema.String),
  message: Schema.String,
});
export type AntigravityCliUsageQuarantine = typeof AntigravityCliUsageQuarantine.Type;

const CliUsageBucket = Schema.Struct({
  id: Schema.optional(Schema.String),
  bucketId: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
  displayName: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  window: Schema.optional(Schema.String),
  remaining_fraction: Schema.optional(Schema.NullOr(Schema.Number)),
  remainingFraction: Schema.optional(Schema.NullOr(Schema.Number)),
  reset_time: Schema.optional(Schema.NullOr(Schema.String)),
  resetTime: Schema.optional(Schema.NullOr(Schema.String)),
  disabled: Schema.optional(Schema.Boolean),
});

const CliUsageGroup = Schema.Struct({
  name: Schema.optional(Schema.String),
  displayName: Schema.optional(Schema.String),
  buckets: Schema.optional(Schema.Array(CliUsageBucket)),
});

const CliUsageCommand = Schema.Struct({
  name: Schema.String,
  data: Schema.optional(
    Schema.Struct({
      groups: Schema.optional(Schema.Array(CliUsageGroup)),
      buckets: Schema.optional(Schema.Array(CliUsageBucket)),
    }),
  ),
});

const CliUsageResponse = Schema.Struct({
  status: Schema.String,
  num_turns: Schema.optional(Schema.Number),
  numTurns: Schema.optional(Schema.Number),
  error: Schema.optional(Schema.NullOr(Schema.String)),
  response: Schema.optional(Schema.NullOr(Schema.String)),
  command: Schema.optional(Schema.NullOr(CliUsageCommand)),
});

const decodeCliUsageJson = Schema.decodeUnknownOption(Schema.fromJsonString(CliUsageResponse));

class AuthPromptAbortError extends Schema.TaggedError<AuthPromptAbortError>()(
  "AuthPromptAbortError",
  {},
) {}

function parseAntigravityVersion(version: string | null | undefined) {
  const match = /^(?:v|agy_acp_server_)?(\d+)\.(\d+)\.(\d+)/.exec(version?.trim() ?? "");
  return match === null
    ? undefined
    : ([Number(match[1]), Number(match[2]), Number(match[3])] as const);
}

export function antigravitySupportsCliUsage(version: string | null | undefined): boolean {
  const parsed = parseAntigravityVersion(version);
  if (parsed === undefined) return false;
  for (let index = 0; index < 3; index++) {
    const difference = parsed[index]! - MIN_ANTIGRAVITY_USAGE_CLI_VERSION[index]!;
    if (difference !== 0) return difference > 0;
  }
  return true;
}

export function isAntigravityAccountSuspendedText(text: string): boolean {
  return SUSPENSION_TEXT_PATTERN.test(text);
}

function iso(value: string | null | undefined): string | undefined {
  const parsed = value ? DateTime.make(value) : Option.none();
  return Option.isSome(parsed) ? DateTime.formatIso(parsed.value) : undefined;
}

function formatGroupLabel(name: string | undefined): string | undefined {
  const trimmed = name
    ?.trim()
    .replace(/(?:^|\s+)models$/i, "")
    .trim();
  return trimmed ? trimmed : undefined;
}

function summaryResetTime(
  remainingFraction: number,
  resetTime: string | null | undefined,
  description: string | undefined,
  windowDurationMins: number | undefined,
  requestedAtMs: number,
): string | undefined {
  // Untouched summary buckets report a rolling full-window reset.
  const untouched =
    remainingFraction === 1 &&
    description === undefined &&
    windowDurationMins !== undefined &&
    Math.abs(Date.parse(resetTime ?? "") - requestedAtMs - windowDurationMins * 60_000) <= 60_000;
  return untouched ? undefined : iso(resetTime);
}

function bucketToWindow(
  bucket: typeof CliUsageBucket.Type,
  groupName: string | undefined,
  requestedAtMs: number,
): ServerProviderUsageWindow | undefined {
  if (bucket.disabled) return undefined;
  const id = (bucket.id ?? bucket.bucketId)?.trim();
  if (!id) return undefined;
  const remainingFraction = bucket.remaining_fraction ?? bucket.remainingFraction;
  if (
    typeof remainingFraction !== "number" ||
    !Number.isFinite(remainingFraction) ||
    remainingFraction < 0 ||
    remainingFraction > 1
  ) {
    return undefined;
  }
  const normalizedWindow = bucket.window?.trim().toLowerCase() ?? "";
  const weekly = normalizedWindow === "weekly";
  const session = normalizedWindow === "5h";
  const windowDurationMins = SUMMARY_WINDOW_MINS.get(normalizedWindow);
  const groupLabel = formatGroupLabel(groupName);
  const family = id.startsWith("gemini-argon-")
    ? groupLabel || "Gemini Argon"
    : id.startsWith("gemini-carbon-")
      ? groupLabel || "Gemini Carbon"
      : id.startsWith("gemini-")
        ? "Gemini"
        : id.startsWith("3p-")
          ? "Claude & GPT"
          : groupLabel || id;
  const bucketLabel = (bucket.displayName ?? bucket.name)
    ?.trim()
    .replace(/(?:\s+Limit)?\s+Remaining$/i, "")
    .trim();
  const resetsAt = summaryResetTime(
    remainingFraction,
    bucket.reset_time ?? bucket.resetTime,
    bucket.description,
    windowDurationMins,
    requestedAtMs,
  );
  return {
    id,
    label: `${family} · ${weekly ? "Weekly" : session ? "5-hour" : bucketLabel || "Quota"}`,
    kind: weekly ? "weekly" : session ? "session" : "other",
    usedPercent: clampPercent(Math.round((1 - remainingFraction) * 10_000) / 100),
    ...(resetsAt ? { resetsAt } : {}),
    ...(windowDurationMins === undefined ? {} : { windowDurationMins }),
  };
}

export type AntigravityCliUsageParseResult =
  | { readonly _tag: "ok"; readonly windows: ReadonlyArray<ServerProviderUsageWindow> }
  | { readonly _tag: "modelTurn" }
  | { readonly _tag: "suspended"; readonly detail: string }
  | { readonly _tag: "empty" }
  | { readonly _tag: "failed"; readonly detail: string };

export function parseAntigravityCliUsageOutput(
  stdout: string,
  requestedAtMs: number,
): AntigravityCliUsageParseResult {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return { _tag: "failed", detail: "Antigravity CLI returned empty usage output." };
  }
  const parsed = decodeCliUsageJson(trimmed);
  if (Option.isNone(parsed)) {
    if (isAntigravityAccountSuspendedText(trimmed)) {
      return { _tag: "suspended", detail: "Google reported an Antigravity account restriction." };
    }
    return { _tag: "failed", detail: "Antigravity CLI returned non-JSON usage output." };
  }
  const payload = parsed.value;
  const combinedMessages = [payload.error, payload.response].filter(Boolean).join("\n");
  if (combinedMessages && isAntigravityAccountSuspendedText(combinedMessages)) {
    return { _tag: "suspended", detail: "Google reported an Antigravity account restriction." };
  }
  const numTurns = payload.num_turns ?? payload.numTurns;
  if (typeof numTurns === "number" && numTurns > 0) {
    return { _tag: "modelTurn" };
  }
  if (payload.status !== "SUCCESS") {
    return {
      _tag: "failed",
      detail: `Antigravity CLI usage check returned status ${payload.status}.`,
    };
  }
  if (!payload.command || payload.command.name !== "usage") {
    // A SUCCESS response without command.name === "usage" indicates `/usage` ran as a model prompt.
    return { _tag: "modelTurn" };
  }
  const data = payload.command.data;
  const groups = data?.groups?.some((group) => (group.buckets?.length ?? 0) > 0)
    ? data.groups
    : [{ buckets: data?.buckets }];
  const windows = new Map<string, ServerProviderUsageWindow>();
  for (const group of groups) {
    const groupName = group.displayName ?? group.name;
    for (const bucket of group.buckets ?? []) {
      const window = bucketToWindow(bucket, groupName, requestedAtMs);
      if (window) windows.set(window.id, window);
    }
  }
  if (windows.size === 0) {
    return { _tag: "empty" };
  }
  return { _tag: "ok", windows: [...windows.values()] };
}

function collectStreamAbortOnAuthPrompt<E>(stream: Stream.Stream<Uint8Array, E>, maxBytes: number) {
  return Effect.suspend(() => {
    const decoder = new TextDecoder();
    let text = "";
    let bytes = 0;
    let truncated = false;
    return stream.pipe(
      Stream.runForEach((chunk) =>
        Effect.suspend(() => {
          const remaining = maxBytes - bytes;
          if (remaining <= 0) {
            truncated = true;
            return Effect.void;
          }
          const slice = chunk.byteLength > remaining ? chunk.subarray(0, remaining) : chunk;
          if (chunk.byteLength > remaining) truncated = true;
          bytes += slice.byteLength;
          text += decoder.decode(slice, { stream: true });
          if (AUTH_PROMPT_TEXT_PATTERN.test(text)) {
            return Effect.fail(new AuthPromptAbortError());
          }
          return Effect.void;
        }),
      ),
      Effect.map(() => ({ text: `${text}${decoder.decode()}`, bytes, truncated })),
    );
  });
}

export interface AntigravityCliUsageSpawnConfig {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly extendEnv: false;
  readonly version: string | null;
}

export interface AntigravityCliUsageProbeContext {
  readonly version: string | null;
  readonly authenticated: boolean;
}

export type AntigravityCliUsageTrigger = "manual" | "automatic";

interface ProbeState {
  readonly quarantine: AntigravityCliUsageQuarantine | null;
  readonly lastProbeAtMs: number | null;
  readonly nextAutomaticAtMs: number | null;
  readonly automaticFailures: number;
}

const INITIAL_PROBE_STATE = {
  lastProbeAtMs: null,
  nextAutomaticAtMs: null,
  automaticFailures: 0,
} as const;

const QUARANTINE_MODEL_TURN_MESSAGE =
  "Antigravity quota checks were disabled because the CLI treated /usage as a model turn.";
const QUARANTINE_SUSPENDED_MESSAGE =
  "Antigravity quota checks were paused after Google reported an account restriction or verification requirement.";
const UNSUPPORTED_VERSION_MESSAGE = "Antigravity CLI 1.1.11 or newer is required for quota checks.";

export const makeAntigravityCliUsageProbe = Effect.fn("makeAntigravityCliUsageProbe")(
  function* (input: {
    readonly usageProbeMode: AntigravitySettings["usageProbeMode"];
    readonly authMethod: AntigravitySettings["authMethod"];
    readonly prepareSpawn: Effect.Effect<AntigravityCliUsageSpawnConfig, unknown, Scope.Scope>;
    readonly withProcess?: <A, E, R>(
      stop: Effect.Effect<void>,
      task: Effect.Effect<A, E, R>,
    ) => Effect.Effect<A, E | ProviderSetupError, R | Scope.Scope>;
    readonly persistedQuarantine?: AntigravityCliUsageQuarantine | null;
    readonly persistQuarantine?: (
      quarantine: AntigravityCliUsageQuarantine | null,
    ) => Effect.Effect<void>;
    readonly cooldownMs?: number;
    readonly processTimeoutMs?: number;
    readonly maxOutputBytes?: number;
  }) {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const stateRef = yield* Ref.make<ProbeState>({
      quarantine: input.persistedQuarantine ?? null,
      ...INITIAL_PROBE_STATE,
    });
    const cooldownMs = input.cooldownMs ?? ANTIGRAVITY_CLI_USAGE_COOLDOWN_MS;
    const processTimeoutMs = input.processTimeoutMs ?? ANTIGRAVITY_CLI_USAGE_PROCESS_TIMEOUT_MS;
    const maxOutputBytes = input.maxOutputBytes ?? ANTIGRAVITY_CLI_USAGE_MAX_OUTPUT_BYTES;

    const setQuarantine = (quarantine: AntigravityCliUsageQuarantine | null) =>
      Ref.update(stateRef, (current) => ({ ...current, quarantine })).pipe(
        Effect.andThen(input.persistQuarantine ? input.persistQuarantine(quarantine) : Effect.void),
      );

    const clear = Ref.set(stateRef, { quarantine: null, ...INITIAL_PROBE_STATE }).pipe(
      Effect.andThen(input.persistQuarantine ? input.persistQuarantine(null) : Effect.void),
    );

    const quarantineSuspended = setQuarantine({
      kind: "suspended",
      version: null,
      message: QUARANTINE_SUSPENDED_MESSAGE,
    });

    const probe = Effect.fn("AntigravityCliUsage.probe")(function* (
      context: AntigravityCliUsageProbeContext,
      trigger: AntigravityCliUsageTrigger = "manual",
    ): Effect.fn.Return<ServerProviderUsageLimits | undefined> {
      if (input.usageProbeMode === "off") return undefined;
      if (trigger === "automatic") {
        if (input.usageProbeMode !== "auto") return undefined;
        const { nextAutomaticAtMs } = yield* Ref.get(stateRef);
        if (nextAutomaticAtMs !== null && (yield* Clock.currentTimeMillis) < nextAutomaticAtMs) {
          return undefined;
        }
      }
      const result = yield* probeNow(context);
      if (result !== undefined && input.usageProbeMode === "auto") {
        const nowMs = yield* Clock.currentTimeMillis;
        yield* Ref.update(stateRef, (current) => {
          if (result.unavailable === undefined) {
            return {
              ...current,
              automaticFailures: 0,
              nextAutomaticAtMs: nowMs + ANTIGRAVITY_CLI_USAGE_AUTO_INTERVAL_MS,
            };
          }
          const automaticFailures = current.automaticFailures + 1;
          return {
            ...current,
            automaticFailures,
            nextAutomaticAtMs:
              nowMs +
              Math.min(
                AUTO_FAILURE_BACKOFF_MS * 2 ** (automaticFailures - 1),
                AUTO_FAILURE_BACKOFF_MAX_MS,
              ),
          };
        });
      }
      return result;
    });

    const probeNow = Effect.fn("AntigravityCliUsage.probeNow")(function* (
      context: AntigravityCliUsageProbeContext,
    ): Effect.fn.Return<ServerProviderUsageLimits | undefined> {
      const checkedAt = DateTime.formatIso(yield* DateTime.now);
      if (input.authMethod !== "oauth-personal" && input.authMethod !== "oauth-business") {
        return makeUnavailableUsageLimits({ checkedAt, reason: "unsupported" });
      }
      if (!context.authenticated) {
        return undefined;
      }
      const nowMs = yield* Clock.currentTimeMillis;
      const state = yield* Ref.get(stateRef);
      if (state.quarantine !== null) {
        // A model-turn quarantine is bound to the binary version that misbehaved; updating agy recovers it.
        const recoveredFromUpgrade =
          state.quarantine.kind === "modelTurn" &&
          context.version !== null &&
          context.version !== state.quarantine.version;
        if (recoveredFromUpgrade) {
          yield* setQuarantine(null);
        } else {
          return makeUnavailableUsageLimits({
            checkedAt,
            reason: "unsupported",
            message: state.quarantine.message,
          });
        }
      }
      if (state.lastProbeAtMs !== null && nowMs - state.lastProbeAtMs < cooldownMs) {
        return undefined;
      }
      if (context.version !== null && !antigravitySupportsCliUsage(context.version)) {
        return makeUnavailableUsageLimits({
          checkedAt,
          reason: "unsupported",
          message: UNSUPPORTED_VERSION_MESSAGE,
        });
      }

      const run = Effect.gen(function* () {
        // Prepare isolated profile and temp workspace before starting the child-process timeout.
        const spawn = yield* input.prepareSpawn;
        const effectiveVersion = spawn.version ?? context.version;
        const latestQuarantine = (yield* Ref.get(stateRef)).quarantine;
        if (
          latestQuarantine !== null &&
          latestQuarantine.kind === "modelTurn" &&
          effectiveVersion !== null &&
          effectiveVersion !== latestQuarantine.version
        ) {
          yield* setQuarantine(null);
        }
        if (!antigravitySupportsCliUsage(effectiveVersion)) {
          return makeUnavailableUsageLimits({
            checkedAt,
            reason: "unsupported",
            message: UNSUPPORTED_VERSION_MESSAGE,
          });
        }

        const executeChild = Effect.gen(function* () {
          yield* Ref.update(stateRef, (current) => ({ ...current, lastProbeAtMs: nowMs }));
          const child = yield* spawner.spawn(
            ChildProcess.make(spawn.command, [...spawn.args], {
              cwd: spawn.cwd,
              env: spawn.env,
              extendEnv: false,
              shell: false,
              stdin: "ignore",
            }),
          );
          const [stdout, stderr, exitCode] = yield* Effect.all(
            [
              collectStreamAbortOnAuthPrompt(child.stdout, maxOutputBytes),
              collectStreamAbortOnAuthPrompt(child.stderr, maxOutputBytes),
              child.exitCode,
            ],
            { concurrency: "unbounded" },
          );
          const code = Number(exitCode);
          if (
            isAntigravityAccountSuspendedText(stderr.text) ||
            (code !== 0 && isAntigravityAccountSuspendedText(stdout.text))
          ) {
            yield* quarantineSuspended;
            return makeUnavailableUsageLimits({
              checkedAt,
              reason: "unsupported",
              message: QUARANTINE_SUSPENDED_MESSAGE,
            });
          }
          if (stdout.truncated || stderr.truncated || code !== 0) {
            return makeUnavailableUsageLimits({ checkedAt, reason: "probeFailed" });
          }
          const parsed = parseAntigravityCliUsageOutput(stdout.text, nowMs);
          switch (parsed._tag) {
            case "ok":
              return makeUsageLimits({ checkedAt, windows: parsed.windows });
            case "modelTurn":
              yield* setQuarantine({
                kind: "modelTurn",
                version: effectiveVersion,
                message: QUARANTINE_MODEL_TURN_MESSAGE,
              });
              return makeUnavailableUsageLimits({
                checkedAt,
                reason: "unsupported",
                message: QUARANTINE_MODEL_TURN_MESSAGE,
              });
            case "suspended":
              yield* quarantineSuspended;
              return makeUnavailableUsageLimits({
                checkedAt,
                reason: "unsupported",
                message: QUARANTINE_SUSPENDED_MESSAGE,
              });
            case "empty":
            case "failed":
              return makeUnavailableUsageLimits({ checkedAt, reason: "probeFailed" });
          }
        });

        const processScope = yield* Scope.make();
        yield* Effect.addFinalizer((exit) => Scope.close(processScope, exit));
        const guarded = input.withProcess
          ? input.withProcess(Scope.close(processScope, Exit.void), executeChild)
          : executeChild;

        return yield* guarded.pipe(
          Effect.provideService(Scope.Scope, processScope),
          Effect.timeoutOption(processTimeoutMs),
          Effect.map(
            Option.getOrElse(() =>
              makeUnavailableUsageLimits({ checkedAt, reason: "probeFailed" }),
            ),
          ),
          Effect.catch((error) =>
            // Sign-in / sign-out in progress: do not trip cooldown or overwrite published limits.
            isProviderSetupError(error)
              ? Effect.succeed(undefined)
              : Effect.succeed(makeUnavailableUsageLimits({ checkedAt, reason: "probeFailed" })),
          ),
        );
      }).pipe(
        Effect.scoped,
        Effect.catch(() =>
          Effect.succeed(makeUnavailableUsageLimits({ checkedAt, reason: "probeFailed" })),
        ),
      );

      return yield* run;
    });

    return { probe, clear, quarantineSuspended };
  },
);
