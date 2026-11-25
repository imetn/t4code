import { assert, it, vi } from "@effect/vitest";
import type { ManagedPolicyDocument } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as RelayTracing from "@t3tools/shared/relayTracing";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { FetchHttpClient } from "effect/http";

import * as ManagedPolicy from "../policy/ManagedPolicy.ts";
import { allowedFor, relayLayer } from "./relayTracing.ts";

const tracesTo = (policy?: ManagedPolicyDocument) =>
  Effect.service(RelayTracing.RelayClientTracer).pipe(
    Effect.provide(
      relayLayer(
        { serviceName: "t3code-server", runtime: "node", client: "environment-server" },
        { tracesUrl: "https://traces.example.com", tracesDataset: "relay", tracesToken: "token" },
      ).pipe(Layer.provide(ManagedPolicy.layerTest(policy)), Layer.provide(FetchHttpClient.layer)),
    ),
    Effect.map(Option.isSome),
  );

it.effect("relay tracing is permanently disabled regardless of managed policy", () =>
  Effect.gen(function* () {
    assert.isFalse(yield* tracesTo());
    assert.isFalse(
      yield* tracesTo({
        schemaVersion: 1,
        organization: "Example Corp",
        limits: { telemetry: true },
      }),
    );
  }),
);

it.effect("never sends outbound relay tracing requests even when enabled via environment", () => {
  const fetchFn = vi.fn<typeof fetch>(async () => new Response(null, { status: 202 }));
  const environment: NodeJS.ProcessEnv = { T3CODE_TELEMETRY_ENABLED: "true" };
  return Effect.void.pipe(
    Effect.withSpan("relay.request"),
    RelayTracing.withRelayClientTracing,
    Layer.effectDiscard,
    Layer.provide(
      relayLayer(
        { serviceName: "t3code-server", runtime: "node", client: "environment-server" },
        { tracesUrl: "https://traces.example.com", tracesDataset: "relay", tracesToken: "token" },
      ),
    ),
    Layer.provide(ManagedPolicy.layerTest()),
    Layer.provide(Layer.succeed(HostProcess.Environment, environment)),
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetchFn)),
    Layer.build,
    Effect.scoped,
    Effect.andThen(Effect.sync(() => assert.strictEqual(fetchFn.mock.calls.length, 0))),
  );
});

it("always reports relay tracing as disallowed to clients", () => {
  assert.isFalse(allowedFor({}, undefined));
  assert.isFalse(allowedFor({ T3CODE_TELEMETRY_ENABLED: "true" }, undefined));
  assert.isFalse(allowedFor({ CI: "true", T3CODE_TELEMETRY_ENABLED: "true" }, undefined));
  assert.isFalse(
    allowedFor(
      { T3CODE_TELEMETRY_ENABLED: "true" },
      { organization: "Example Corp", lockedSettings: [], limits: { telemetry: true } },
    ),
  );
});
