import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { DEFAULT_SIGNAL_EXPORT } from "@t3tools/shared/observability";
import * as OtelEnvironment from "@t3tools/shared/otelEnvironment";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpClient, HttpClientResponse } from "effect/http";
import { describe } from "vite-plus/test";

import * as ServerConfig from "../config.ts";
import * as OtlpEndpointCheck from "./OtlpEndpointCheck.ts";

describe("OtlpEndpointCheck", () => {
  it.effect("never sends outbound HTTP probes and always reports Unreachable", () => {
    const requests: Array<string> = [];
    const httpClient = HttpClient.make((request) =>
      Effect.sync(() => {
        requests.push(request.url);
        return HttpClientResponse.fromWeb(request, new Response(null, { status: 200 }));
      }),
    );
    const configLayer = Layer.effect(
      ServerConfig.ServerConfig,
      Effect.gen(function* () {
        const config = yield* ServerConfig.ServerConfig;
        return ServerConfig.make({
          ...config,
          otlpTracesUrl: "https://collector.example.com/v1/traces",
          otlpMetricsUrl: "https://collector.example.com/v1/metrics",
          otlpLogsUrl: "https://collector.example.com/v1/logs",
          otlpTracesExport: { ...DEFAULT_SIGNAL_EXPORT, headers: { "x-api-key": "secret" } },
          otelEnvironment: OtelEnvironment.none,
        });
      }),
    ).pipe(Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-otlp-check-" })));

    const layer = OtlpEndpointCheck.layer.pipe(
      Layer.provide(Layer.succeed(HttpClient.HttpClient, httpClient)),
      Layer.provide(configLayer),
      Layer.provide(NodeServices.layer),
    );

    return Effect.gen(function* () {
      const service = yield* OtlpEndpointCheck.OtlpEndpointCheck;
      for (const signal of ["traces", "metrics", "logs"] as const) {
        const result = yield* service.check({
          signal,
          url: `https://collector.example.com/v1/${signal}`,
        });
        assert.deepStrictEqual(result, { _tag: "Unreachable", timedOut: false });
      }
      assert.lengthOf(requests, 0);
    }).pipe(Effect.provide(layer));
  });
});
