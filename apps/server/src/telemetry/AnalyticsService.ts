import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { TelemetryOwner } from "./Identify.ts";

export class AnalyticsService extends Context.Service<
  AnalyticsService,
  {
    /** Whether the event was queued to send; always false because telemetry is disabled. */
    readonly record: (
      event: string,
      properties?: Readonly<Record<string, unknown>>,
      options?: { readonly anonymous?: boolean },
    ) => Effect.Effect<boolean>;

    readonly flush: Effect.Effect<void>;

    readonly recordOwners: (
      owners: ReadonlyArray<TelemetryOwner>,
      observedBy: "server" | "client",
    ) => Effect.Effect<void>;
  }
>()("t3/telemetry/AnalyticsService") {}

const noopService = AnalyticsService.of({
  record: Effect.fn("AnalyticsService.record")(function* () {
    return false;
  }),
  flush: Effect.void,
  recordOwners: Effect.fn("AnalyticsService.recordOwners")(function* () {}),
});

/** @public */
export const make = Effect.succeed(noopService);

export const layer = Layer.succeed(AnalyticsService, noopService);
