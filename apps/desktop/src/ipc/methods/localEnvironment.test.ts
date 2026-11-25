import { assert, describe, it } from "@effect/vitest";
import { DesktopRelayProbeResultSchema } from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as FileSystem from "effect/FileSystem";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as Path from "effect/Path";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as DesktopEnvironment from "../../app/DesktopEnvironment.ts";
import * as DesktopLifecycle from "../../app/DesktopLifecycle.ts";
import * as DesktopShutdown from "../../app/DesktopShutdown.ts";
import * as DesktopState from "../../app/DesktopState.ts";
import * as ElectronApp from "../../electron/ElectronApp.ts";
import * as ElectronTheme from "../../electron/ElectronTheme.ts";
import * as DesktopAppSettings from "../../settings/DesktopAppSettings.ts";
import * as DesktopWindow from "../../window/DesktopWindow.ts";
import {
  getHostEnvironmentId,
  getLocalEnvironmentEnabled,
  probeRelay,
  setLocalEnvironmentEnabled,
} from "./localEnvironment.ts";

const layerUnusedLifecycleRuntime = Layer.mergeAll(
  DesktopShutdown.layer,
  DesktopState.layer,
  Layer.succeed(
    DesktopEnvironment.DesktopEnvironment,
    DesktopEnvironment.DesktopEnvironment.of(
      {} as DesktopEnvironment.DesktopEnvironment["Service"],
    ),
  ),
  Layer.mock(DesktopWindow.DesktopWindow, {}),
  Layer.mock(ElectronApp.ElectronApp, {}),
  Layer.mock(ElectronTheme.ElectronTheme, {}),
);

describe("local environment IPC", () => {
  it.effect("reads the shared home identity without creating one", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const stateDir = yield* fs.makeTempDirectoryScoped();
      const environment = DesktopEnvironment.DesktopEnvironment.of({
        path,
        stateDir,
      } as DesktopEnvironment.DesktopEnvironment["Service"]);
      const read = getHostEnvironmentId
        .handler(undefined)
        .pipe(Effect.provideService(DesktopEnvironment.DesktopEnvironment, environment));
      assert.strictEqual(yield* read, null);
      assert.isFalse(yield* fs.exists(path.join(stateDir, "environment-id")));
      yield* fs.writeFileString(path.join(stateDir, "environment-id"), "  service-id\n");
      assert.strictEqual(yield* read, "service-id");
      yield* fs.writeFileString(path.join(stateDir, "environment-id"), "\n");
      assert.strictEqual(yield* read, null);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
  it.effect("relaunches only when the setting changes and keeps other settings", () => {
    const relaunchReasons: Array<string> = [];
    const layer = Layer.mergeAll(
      DesktopAppSettings.layerTest({
        ...DesktopAppSettings.DEFAULT_DESKTOP_SETTINGS,
        wslBackendEnabled: true,
      }),
      Layer.mock(DesktopLifecycle.DesktopLifecycle, {
        relaunch: (reason) =>
          Effect.sync(() => {
            relaunchReasons.push(reason);
          }),
      }),
      layerUnusedLifecycleRuntime,
    );
    return Effect.gen(function* () {
      yield* setLocalEnvironmentEnabled.handler(false);
      assert.isFalse(yield* getLocalEnvironmentEnabled.handler());
      yield* setLocalEnvironmentEnabled.handler(false);
      assert.deepEqual(relaunchReasons, ["localEnvironmentEnabled=false"]);

      yield* setLocalEnvironmentEnabled.handler(true);
      assert.isTrue(yield* getLocalEnvironmentEnabled.handler());
      const appSettings = yield* DesktopAppSettings.DesktopAppSettings;
      assert.isTrue((yield* appSettings.get).wslBackendEnabled);
      assert.deepEqual(relaunchReasons, [
        "localEnvironmentEnabled=false",
        "localEnvironmentEnabled=true",
      ]);
    }).pipe(Effect.provide(layer));
  });

  it.effect("rejects non-HTTPS relay probe URLs without making a request", () =>
    Effect.gen(function* () {
      assert.deepEqual(yield* probeRelay.handler("http://relay.example.com"), {
        ok: false,
        latencyMs: null,
        status: null,
        reason: "invalid-url",
      });
      assert.deepEqual(yield* probeRelay.handler("https://relay.example.com/path"), {
        ok: false,
        latencyMs: null,
        status: null,
        reason: "invalid-url",
      });
    }).pipe(
      Effect.provideService(
        HttpClient.HttpClient,
        HttpClient.make(() => Effect.die("unexpected HTTP request")),
      ),
    ),
  );

  it.effect("probes a healthy relay and returns latencyMs", () =>
    Effect.gen(function* () {
      const rawResult = yield* probeRelay.handler("https://relay.example.com");
      const result = yield* Schema.decodeUnknownEffect(DesktopRelayProbeResultSchema)(rawResult);
      assert.strictEqual(result.ok, true);
      if (result.ok) {
        assert.strictEqual(result.status, 200);
        assert.isNumber(result.latencyMs);
      }
    }).pipe(
      Effect.provideService(
        HttpClient.HttpClient,
        HttpClient.make((request) =>
          Effect.succeed(
            HttpClientResponse.fromWeb(
              request,
              new Response(JSON.stringify({ ok: true, service: "relay" }), {
                status: 200,
                headers: { "content-type": "application/json" },
              }),
            ),
          ),
        ),
      ),
    ),
  );
});
