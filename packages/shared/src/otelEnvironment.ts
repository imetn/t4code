import * as ConfigProvider from "effect/ConfigProvider";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";

import type { OtlpEndpointSource } from "@t3tools/contracts";

import type { OtlpProtocol, SignalExport } from "./observability.ts";

export type OtelSignal = Data.TaggedEnum<{
  Unset: {};
  Off: {};
  Export: {
    readonly url: string;
    readonly variable: string;
    readonly protocol: OtlpProtocol;
    readonly headers: Readonly<Record<string, string>> | undefined;
  };
}>;
export const OtelSignal = Data.taggedEnum<OtelSignal>();

export interface OtelEnvironment {
  readonly disabled: boolean;
  readonly warnings: ReadonlyArray<string>;
  readonly resourceAttributes: Readonly<Record<string, string>>;
  readonly traces: OtelSignal;
  readonly metrics: OtelSignal;
  readonly logs: OtelSignal;
}

const T3CODE_TRUE = ["true", "yes", "on", "1", "y"];
const RESOURCE_ATTRIBUTES = "OTEL_RESOURCE_ATTRIBUTES";

export const none: OtelEnvironment = {
  disabled: true,
  warnings: [],
  resourceAttributes: {},
  traces: OtelSignal.Off(),
  metrics: OtelSignal.Off(),
  logs: OtelSignal.Off(),
};

// Outbound OpenTelemetry export is permanently disabled in this build.
export const load: Effect.Effect<OtelEnvironment> = Effect.succeed(none);

const CI_VARIABLES = [
  "CI",
  "GITHUB_ACTIONS",
  "GITLAB_CI",
  "CIRCLECI",
  "TRAVIS",
  "BUILDKITE",
  "JENKINS_URL",
  "TEAMCITY_VERSION",
  "TF_BUILD",
  "BITBUCKET_BUILD_NUMBER",
  "CODEBUILD_BUILD_ID",
  "DRONE",
  "APPVEYOR",
] as const;

export const isCiEnvironment = (env: Readonly<Record<string, string | undefined>>) =>
  CI_VARIABLES.some((name) => {
    const value = env[name]?.trim().toLowerCase();
    return value !== undefined && value !== "" && value !== "false" && value !== "0";
  });

export const isDoNotTrackSet = (env: Readonly<Record<string, string | undefined>>) =>
  T3CODE_TRUE.includes(env.DO_NOT_TRACK?.trim().toLowerCase() ?? "");

export const isRelayTracingEnabled = (_env: Readonly<Record<string, string | undefined>>) => false;

export type SignalName = "traces" | "metrics" | "logs";

export interface SignalEndpoint {
  readonly url: string;
  readonly export: SignalExport;
  readonly source: OtlpEndpointSource;
  readonly variable?: string;
}

export const resolveSignalEndpoint = (
  _otel: OtelEnvironment,
  _signal: SignalName,
  _t3: { readonly url: string | undefined; readonly export: SignalExport },
  _fallback: { readonly bootstrapUrl: string | undefined; readonly settingsUrl: string | undefined },
): SignalEndpoint | undefined => undefined;

export const layerResourceAttributes = (attributes: Readonly<Record<string, string>>) =>
  ConfigProvider.layerAdd(
    ConfigProvider.fromEnv({
      env: {
        [RESOURCE_ATTRIBUTES]: Object.entries(attributes)
          .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
          .join(","),
      },
      preserveEmptyStrings: true,
    }),
    { asPrimary: true },
  );
