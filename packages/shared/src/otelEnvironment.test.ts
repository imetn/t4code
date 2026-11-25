import { assert, describe, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as OtlpResource from "effect/observability/OtlpResource";

import * as OtelEnvironment from "./otelEnvironment.ts";

const load = (env: Record<string, string>) =>
  OtelEnvironment.load.pipe(Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env }))));

describe("OtelEnvironment", () => {
  it.effect("permanently disables outbound OTLP export regardless of environment variables", () =>
    Effect.gen(function* () {
      const resolved = yield* load({
        T3CODE_OTEL_SDK_DISABLED: "false",
        OTEL_SDK_DISABLED: "false",
        OTEL_EXPORTER_OTLP_ENDPOINT: "https://collector:4318/base",
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "https://tempo:4318/custom",
        OTEL_RESOURCE_ATTRIBUTES: "team=core",
      });
      assert.strictEqual(resolved.disabled, true);
      assert.deepStrictEqual(resolved.warnings, []);
      assert.deepStrictEqual(resolved.resourceAttributes, {});
      assert.deepStrictEqual(resolved.traces, OtelEnvironment.OtelSignal.Off());
      assert.deepStrictEqual(resolved.metrics, OtelEnvironment.OtelSignal.Off());
      assert.deepStrictEqual(resolved.logs, OtelEnvironment.OtelSignal.Off());
    }),
  );

  it("resolveSignalEndpoint always returns undefined even when URLs are supplied", () => {
    const t3Export = {
      protocol: "http/json",
      headers: { "x-key": "t3" },
      exportIntervalMs: 5_000,
    } as const;
    const enabledOtel: OtelEnvironment.OtelEnvironment = {
      disabled: false,
      warnings: [],
      resourceAttributes: {},
      traces: OtelEnvironment.OtelSignal.Export({
        url: "http://otel:4318/v1/traces",
        variable: "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
        protocol: "http/protobuf",
        headers: undefined,
      }),
      metrics: OtelEnvironment.OtelSignal.Unset(),
      logs: OtelEnvironment.OtelSignal.Unset(),
    };

    for (const signal of ["traces", "metrics", "logs"] as const) {
      assert.strictEqual(
        OtelEnvironment.resolveSignalEndpoint(
          enabledOtel,
          signal,
          { url: `http://t3:4318/v1/${signal}`, export: t3Export },
          {
            bootstrapUrl: `http://desktop:4318/v1/${signal}`,
            settingsUrl: `http://settings:4318/v1/${signal}`,
          },
        ),
        undefined,
      );
    }
  });

  describe("layerResourceAttributes", () => {
    it.effect("provides encoded attributes safely", () =>
      Effect.gen(function* () {
        const layerEnv = ConfigProvider.layer(ConfigProvider.fromEnv({ env: {} }));
        const resource = yield* OtlpResource.fromConfig({ serviceName: "t3" }).pipe(
          Effect.provide(
            Layer.provide(
              OtelEnvironment.layerResourceAttributes({ "a,b": "x=y" }),
              layerEnv,
            ),
          ),
        );
        assert.deepStrictEqual(
          resource.attributes
            .map((attribute) => attribute.key)
            .filter((key) => !key.startsWith("telemetry.sdk.")),
          ["a,b", "service.name"],
        );
      }),
    );
  });
});

describe("isCiEnvironment", () => {
  it("treats a set CI variable as CI, except empty, false, and 0", () => {
    assert.isFalse(OtelEnvironment.isCiEnvironment({}));
    assert.isTrue(OtelEnvironment.isCiEnvironment({ CI: "1" }));
    assert.isTrue(OtelEnvironment.isCiEnvironment({ TF_BUILD: "True" }));
    assert.isTrue(OtelEnvironment.isCiEnvironment({ BITBUCKET_BUILD_NUMBER: "42" }));
    for (const value of ["", " ", "false", "FALSE", "0"]) {
      assert.isFalse(OtelEnvironment.isCiEnvironment({ CI: value }), `CI=${value}`);
    }
    assert.isTrue(OtelEnvironment.isCiEnvironment({ CI: "false", GITLAB_CI: "true" }));
  });
});

describe("isRelayTracingEnabled", () => {
  it("is permanently false regardless of environment variables", () => {
    assert.isFalse(OtelEnvironment.isRelayTracingEnabled({}));
    assert.isFalse(OtelEnvironment.isRelayTracingEnabled({ T3CODE_TELEMETRY_ENABLED: "true" }));
    assert.isFalse(
      OtelEnvironment.isRelayTracingEnabled({
        T3CODE_TELEMETRY_ENABLED: "1",
        T3CODE_OTEL_SDK_DISABLED: "false",
        OTEL_SDK_DISABLED: "false",
        DO_NOT_TRACK: "0",
      }),
    );
  });
});
