import {
  DesktopRelayProbeResultSchema,
  type DesktopRelayProbeResult,
} from "@t3tools/contracts";
import { clerkFrontendApiHostnameFromPublishableKey } from "@t3tools/shared/relayAuth";
import { normalizeSecureRelayUrl } from "@t3tools/shared/relayUrl";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";

import * as DesktopEnvironment from "../../app/DesktopEnvironment.ts";
import * as DesktopLifecycle from "../../app/DesktopLifecycle.ts";
import * as DesktopAppSettings from "../../settings/DesktopAppSettings.ts";
import * as IpcChannels from "../channels.ts";
import { makeIpcMethod, makeSyncIpcMethod } from "../DesktopIpc.ts";

export const getLocalEnvironmentEnabled = makeSyncIpcMethod({
  channel: IpcChannels.GET_LOCAL_ENVIRONMENT_ENABLED_CHANNEL,
  result: Schema.Boolean,
  handler: Effect.fn("desktop.ipc.localEnvironment.getEnabled")(function* () {
    const appSettings = yield* DesktopAppSettings.DesktopAppSettings;
    return (yield* appSettings.get).localEnvironmentEnabled;
  }),
});

export const setLocalEnvironmentEnabled = makeIpcMethod({
  channel: IpcChannels.SET_LOCAL_ENVIRONMENT_ENABLED_CHANNEL,
  payload: Schema.Boolean,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.localEnvironment.setEnabled")(function* (enabled) {
    const appSettings = yield* DesktopAppSettings.DesktopAppSettings;
    const lifecycle = yield* DesktopLifecycle.DesktopLifecycle;
    const change = yield* appSettings.setLocalEnvironmentEnabled(enabled);
    if (change.changed) {
      yield* lifecycle.relaunch(`localEnvironmentEnabled=${enabled}`);
    }
  }),
});

export const getCustomRelayUrl = makeSyncIpcMethod({
  channel: IpcChannels.GET_CUSTOM_RELAY_URL_CHANNEL,
  result: Schema.NullOr(Schema.String),
  handler: Effect.fn("desktop.ipc.localEnvironment.getCustomRelayUrl")(function* () {
    const appSettings = yield* DesktopAppSettings.DesktopAppSettings;
    return (yield* appSettings.get).customRelayUrl;
  }),
});

export const getCustomClerkPublishableKey = makeSyncIpcMethod({
  channel: IpcChannels.GET_CUSTOM_CLERK_PUBLISHABLE_KEY_CHANNEL,
  result: Schema.NullOr(Schema.String),
  handler: Effect.fn("desktop.ipc.localEnvironment.getCustomClerkPublishableKey")(function* () {
    const appSettings = yield* DesktopAppSettings.DesktopAppSettings;
    return (yield* appSettings.get).customClerkPublishableKey;
  }),
});

export const getCustomClerkCliOAuthClientId = makeSyncIpcMethod({
  channel: IpcChannels.GET_CUSTOM_CLERK_CLI_OAUTH_CLIENT_ID_CHANNEL,
  result: Schema.NullOr(Schema.String),
  handler: Effect.fn("desktop.ipc.localEnvironment.getCustomClerkCliOAuthClientId")(function* () {
    const appSettings = yield* DesktopAppSettings.DesktopAppSettings;
    return (yield* appSettings.get).customClerkCliOAuthClientId;
  }),
});

const CustomCloudConfigPayload = Schema.Struct({
  relayUrl: Schema.NullOr(Schema.String),
  clerkPublishableKey: Schema.NullOr(Schema.String),
  clerkCliOAuthClientId: Schema.NullOr(Schema.String),
});

function parseCustomClerkPublishableKey(raw: string): string | null {
  try {
    clerkFrontendApiHostnameFromPublishableKey(raw);
    return raw;
  } catch {
    return null;
  }
}

export const setCustomCloudConfig = makeIpcMethod({
  channel: IpcChannels.SET_CUSTOM_CLOUD_CONFIG_CHANNEL,
  payload: CustomCloudConfigPayload,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.localEnvironment.setCustomCloudConfig")(function* (config) {
    const appSettings = yield* DesktopAppSettings.DesktopAppSettings;
    const lifecycle = yield* DesktopLifecycle.DesktopLifecycle;
    const relayUrl =
      config.relayUrl === null || config.relayUrl.trim() === ""
        ? null
        : normalizeSecureRelayUrl(config.relayUrl);
    if (config.relayUrl !== null && config.relayUrl.trim() !== "" && relayUrl === null) {
      return yield* Effect.die(new Error("Relay URL must be an HTTPS origin."));
    }
    const clerkKeyRaw = config.clerkPublishableKey?.trim() ?? "";
    const clerkPublishableKey =
      clerkKeyRaw.length === 0 ? null : parseCustomClerkPublishableKey(clerkKeyRaw);
    if (clerkKeyRaw.length > 0 && clerkPublishableKey === null) {
      return yield* Effect.die(new Error("Invalid Clerk publishable key."));
    }
    const clerkCliOAuthClientId = config.clerkCliOAuthClientId?.trim() || null;
    const change = yield* appSettings.setCustomCloudConfig({
      relayUrl,
      clerkPublishableKey,
      clerkCliOAuthClientId,
    });
    if (change.changed) {
      yield* lifecycle.relaunch("customCloudConfig");
    }
  }),
});

const RELAY_PROBE_TIMEOUT_MS = 5_000;

function isRelayHealthPayload(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "ok" in value &&
    value.ok === true &&
    "service" in value &&
    value.service === "relay"
  );
}

// Main-process probe avoids renderer CORS/CSP blocks against self-hosted relays behind proxies.
export const probeRelay = makeIpcMethod({
  channel: IpcChannels.PROBE_RELAY_CHANNEL,
  payload: Schema.String,
  result: DesktopRelayProbeResultSchema,
  handler: Effect.fn("desktop.ipc.localEnvironment.probeRelay")(function* (rawUrl) {
    const origin = normalizeSecureRelayUrl(rawUrl);
    if (origin === null) {
      return {
        ok: false as const,
        latencyMs: null,
        status: null,
        reason: "invalid-url" as const,
      };
    }
    return yield* Effect.promise(async (): Promise<DesktopRelayProbeResult> => {
      const startedAt = performance.now();
      try {
        const response = await fetch(`${origin}/health`, {
          method: "GET",
          cache: "no-store",
          credentials: "omit",
          redirect: "error",
          signal: AbortSignal.timeout(RELAY_PROBE_TIMEOUT_MS),
        });
        const latencyMs = Math.max(0, Math.round(performance.now() - startedAt));
        if (!response.ok) {
          await response.body?.cancel();
          return {
            ok: false,
            latencyMs,
            status: response.status,
            reason: "http-error",
          };
        }
        let payload: unknown;
        try {
          payload = await response.json();
        } catch {
          return {
            ok: false,
            latencyMs,
            status: response.status,
            reason: "invalid-response",
          };
        }
        if (!isRelayHealthPayload(payload)) {
          return {
            ok: false,
            latencyMs,
            status: response.status,
            reason: "invalid-response",
          };
        }
        return { ok: true, latencyMs, status: response.status };
      } catch (cause) {
        const isTimeout =
          cause instanceof Error &&
          (cause.name === "TimeoutError" || cause.name === "AbortError");
        return {
          ok: false,
          latencyMs: null,
          status: null,
          reason: isTimeout ? "timeout" : "unreachable",
        };
      }
    });
  }),
});

// A background service sharing this app's T3 home records its environment ID in the same state dir.
export const getHostEnvironmentId = makeIpcMethod({
  channel: IpcChannels.GET_HOST_ENVIRONMENT_ID_CHANNEL,
  payload: Schema.Void,
  result: Schema.NullOr(Schema.String),
  handler: Effect.fn("desktop.ipc.localEnvironment.getHostEnvironmentId")(function* () {
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    const fileSystem = yield* FileSystem.FileSystem;
    const contents = yield* fileSystem
      .readFileString(environment.path.join(environment.stateDir, "environment-id"))
      .pipe(Effect.orElseSucceed(() => ""));
    return contents.trim() || null;
  }),
});
