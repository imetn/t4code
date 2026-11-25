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

export const setCustomRelayUrl = makeIpcMethod({
  channel: IpcChannels.SET_CUSTOM_RELAY_URL_CHANNEL,
  payload: Schema.NullOr(Schema.String),
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.localEnvironment.setCustomRelayUrl")(function* (url) {
    const appSettings = yield* DesktopAppSettings.DesktopAppSettings;
    const lifecycle = yield* DesktopLifecycle.DesktopLifecycle;
    const normalized = url === null || url.trim() === "" ? null : normalizeSecureRelayUrl(url);
    if (url !== null && url.trim() !== "" && normalized === null) {
      return yield* Effect.die(new Error("Relay URL must be an HTTPS origin."));
    }
    const change = yield* appSettings.setCustomRelayUrl(normalized);
    if (change.changed) {
      yield* lifecycle.relaunch("customRelayUrl");
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
