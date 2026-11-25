import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as TestClock from "effect/testing/TestClock";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as HttpServer from "effect/http/HttpServer";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as HostProcess from "@t3tools/shared/HostProcess";

import * as ServerConfig from "../config.ts";
import * as ManagedPolicy from "../policy/ManagedPolicy.ts";
import * as AnalyticsService from "./AnalyticsService.ts";

it.layer(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))("AnalyticsService test", (it) => {
  it.effect(
    "never records events, creates anonymous-id, or sends HTTP requests even when enabled",
    () =>
      Effect.gen(function* () {
        const requests: Array<string> = [];
        const client = HttpClient.make((request) =>
          Effect.sync(() => {
            requests.push(request.url);
            return HttpClientResponse.fromWeb(request, new Response(null, { status: 204 }));
          }),
        );
        const layerRuntime = AnalyticsService.layer.pipe(
          Layer.provideMerge(
            ServerConfig.ServerConfig.layerTest(process.cwd(), { prefix: "t3-telemetry-noop-" }),
          ),
          Layer.provide(
            ConfigProvider.layer(
              ConfigProvider.fromUnknown({
                T3CODE_TELEMETRY_ENABLED: true,
                T3CODE_POSTHOG_KEY: "phc_test_key",
                T3CODE_POSTHOG_HOST: "http://localhost",
              }),
            ),
          ),
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(HostProcess.Platform, "linux"),
              Layer.succeed(HostProcess.Architecture, "arm64"),
              Layer.succeed(HttpClient.HttpClient, client),
              ManagedPolicy.layerTest({
                schemaVersion: 1,
                organization: "Example Corp",
                limits: { telemetry: true },
              }),
            ),
          ),
        );

        const scope = yield* Scope.make();
        const context = yield* Layer.buildWithScope(layerRuntime, scope);

        yield* Effect.gen(function* () {
          const analytics = yield* AnalyticsService.AnalyticsService;
          const config = yield* ServerConfig.ServerConfig;
          const fileSystem = yield* FileSystem.FileSystem;

          assert.isFalse(yield* analytics.record("test.event", { index: 1 }));
          assert.isFalse(yield* analytics.record("test.anonymous", {}, { anonymous: true }));
          yield* analytics.recordOwners([{ source: "connect", ownerId: "a".repeat(64) }], "server");
          yield* analytics.flush;
          yield* TestClock.adjust("1 minute");

          assert.isFalse(yield* fileSystem.exists(config.anonymousIdPath));
        }).pipe(Effect.provide(context));

        yield* Scope.close(scope, Exit.void);
        assert.deepEqual(requests, []);
      }),
  );

  it.effect("does not send batch requests to an HTTP server even with telemetry env vars set", () =>
    Effect.gen(function* () {
      const capturedPaths: Array<string> = [];
      const layerServerConfig = ServerConfig.ServerConfig.layerTest(process.cwd(), {
        prefix: "t3-telemetry-disabled-",
      });
      const layerTelemetry = AnalyticsService.layer.pipe(Layer.provideMerge(layerServerConfig));
      const layerConfig = ConfigProvider.layer(
        ConfigProvider.fromUnknown({
          T3CODE_TELEMETRY_ENABLED: true,
          T3CODE_POSTHOG_KEY: "phc_test_key",
          T3CODE_POSTHOG_HOST: "http://localhost",
        }),
      );
      const layerBatchServer = HttpServer.serve(
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          capturedPaths.push(request.url);
          return HttpServerResponse.jsonUnsafe({});
        }),
      );
      const layerRuntime = layerTelemetry.pipe(
        Layer.provide(layerConfig),
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(HostProcess.Platform, "linux"),
            Layer.succeed(HostProcess.Architecture, "arm64"),
            ManagedPolicy.layerTest(),
          ),
        ),
        Layer.provideMerge(NodeHttpServer.layerTest),
      );

      yield* Effect.gen(function* () {
        yield* Layer.launch(layerBatchServer).pipe(Effect.forkScoped);
        const analytics = yield* AnalyticsService.AnalyticsService;
        assert.isFalse(yield* analytics.record("test.disabled", { index: 1 }));
        yield* analytics.flush;
      }).pipe(Effect.provide(layerRuntime));

      assert.deepEqual(capturedPaths, []);
    }),
  );
});
