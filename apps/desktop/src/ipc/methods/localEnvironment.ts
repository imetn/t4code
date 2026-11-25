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
