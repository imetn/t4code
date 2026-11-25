import type { ManagedPolicySummary } from "@t3tools/contracts";
import * as RelayTracing from "@t3tools/shared/relayTracing";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

export const allowedFor = (
  _env: Readonly<Record<string, string | undefined>>,
  _policy: ManagedPolicySummary | undefined,
) => false;

// Outbound relay tracing is permanently disabled.
export const relayLayer = (
  _resource: Omit<RelayTracing.RelayClientTracingResource, "serviceInstanceId">,
  _tracingConfig?: RelayTracing.RelayClientTracingConfig | null,
) => Layer.succeed(RelayTracing.RelayClientTracer, Option.none());

export const layerHeadlessRelayClient = Layer.succeed(
  RelayTracing.RelayClientTracer,
  Option.none(),
);

export const layerServerRelayBroker = Layer.succeed(RelayTracing.RelayClientTracer, Option.none());
