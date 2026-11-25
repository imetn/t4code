# Product analytics

Outbound product analytics, crash reporting, and external OpenTelemetry/relay tracing are
permanently disabled across all surfaces (server, desktop, web, and mobile).

- [`AnalyticsService.ts`](../../apps/server/src/telemetry/AnalyticsService.ts) is a no-op that never
  buffers, flushes, or sends HTTP requests regardless of environment variables or settings.
- [`Identify.ts`](../../apps/server/src/telemetry/Identify.ts) never reads or writes `anonymous-id`
  on disk and never collects owner IDs; clients never generate or send analytics device IDs.
- [`otelEnvironment.ts`](../../packages/shared/src/otelEnvironment.ts) and
  [`relayTracing.ts`](../../packages/shared/src/relayTracing.ts) permanently disable outbound OTLP
  and Axiom relay tracing exports.
- Mobile crash upload (`expo-observe`) and connection tracing are permanently disabled.
- Local-only diagnostics (local `server.trace.ndjson`, `desktop.trace.ndjson`, local process and
  resource monitoring) remain enabled for in-app troubleshooting.
