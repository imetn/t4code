import {
  clerkFrontendApiHostnameFromPublishableKey,
  relayClerkTokenOptions,
} from "@t3tools/shared/relayAuth";
import { normalizeSecureRelayUrl } from "@t3tools/shared/relayUrl";
import * as Schema from "effect/Schema";

export class CloudPublicConfigMissingError extends Schema.TaggedError<CloudPublicConfigMissingError>()(
  "CloudPublicConfigMissingError",
  {
    key: Schema.Literal("T3CODE_CLERK_JWT_TEMPLATE"),
  },
) {
  override get message(): string {
    return `${this.key} is not configured.`;
  }
}

export interface CloudPublicConfig {
  readonly clerkPublishableKey: string | null;
  readonly clerkJwtTemplate: string | null;
  readonly relayUrl: string | null;
  readonly relayTracing: {
    readonly tracesUrl: string | null;
    readonly tracesDataset: string | null;
    readonly tracesToken: string | null;
  };
}

export function trimNonEmpty(value: string | undefined): string | null {
  return value?.trim() || null;
}

const CUSTOM_RELAY_URL_STORAGE_KEY = "t3code:custom-relay-url";
const CUSTOM_CLERK_KEY_STORAGE_KEY = "t3code:custom-clerk-publishable-key";

export function resolveDefaultRelayUrl(): string | null {
  return normalizeSecureRelayUrl(
    (import.meta.env.VITE_T3CODE_RELAY_URL as string | undefined) ?? "",
  );
}

export function normalizeClerkPublishableKey(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    clerkFrontendApiHostnameFromPublishableKey(trimmed);
    return trimmed;
  } catch {
    return null;
  }
}

export function readCustomRelayUrlOverride(): string | null {
  if (typeof window === "undefined") return null;
  const desktopOverride = window.desktopBridge?.getCustomRelayUrl?.();
  if (typeof desktopOverride === "string") {
    return normalizeSecureRelayUrl(desktopOverride);
  }
  if (window.desktopBridge) {
    return null;
  }
  try {
    const stored = window.localStorage.getItem(CUSTOM_RELAY_URL_STORAGE_KEY);
    return stored ? normalizeSecureRelayUrl(stored) : null;
  } catch {
    return null;
  }
}

export function readCustomClerkPublishableKeyOverride(): string | null {
  if (typeof window === "undefined") return null;
  const desktopOverride = window.desktopBridge?.getCustomClerkPublishableKey?.();
  if (typeof desktopOverride === "string") {
    return normalizeClerkPublishableKey(desktopOverride);
  }
  if (window.desktopBridge) {
    return null;
  }
  try {
    const stored = window.localStorage.getItem(CUSTOM_CLERK_KEY_STORAGE_KEY);
    return stored ? normalizeClerkPublishableKey(stored) : null;
  } catch {
    return null;
  }
}

export function readCustomClerkCliOAuthClientIdOverride(): string | null {
  if (typeof window === "undefined") return null;
  const desktopOverride = window.desktopBridge?.getCustomClerkCliOAuthClientId?.();
  return typeof desktopOverride === "string" && desktopOverride.trim().length > 0
    ? desktopOverride.trim()
    : null;
}

export function writeWebCustomCloudConfigOverride(config: {
  readonly relayUrl: string | null;
  readonly clerkPublishableKey: string | null;
}): void {
  if (typeof window === "undefined") return;
  try {
    if (config.relayUrl === null) {
      window.localStorage.removeItem(CUSTOM_RELAY_URL_STORAGE_KEY);
    } else {
      window.localStorage.setItem(CUSTOM_RELAY_URL_STORAGE_KEY, config.relayUrl);
    }
    if (config.clerkPublishableKey === null) {
      window.localStorage.removeItem(CUSTOM_CLERK_KEY_STORAGE_KEY);
    } else {
      window.localStorage.setItem(CUSTOM_CLERK_KEY_STORAGE_KEY, config.clerkPublishableKey);
    }
  } catch {
    // Ignore restricted storage contexts.
  }
}

export function resolveCloudPublicConfig(): CloudPublicConfig {
  return {
    clerkPublishableKey:
      readCustomClerkPublishableKeyOverride() ??
      trimNonEmpty(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined),
    clerkJwtTemplate: trimNonEmpty(import.meta.env.VITE_CLERK_JWT_TEMPLATE as string | undefined),
    relayUrl: readCustomRelayUrlOverride() ?? resolveDefaultRelayUrl(),
    relayTracing: {
      tracesUrl: null,
      tracesDataset: null,
      tracesToken: null,
    },
  };
}

export function setServerRelayTelemetry(_allowed: boolean | null): void {}

export function relayTelemetryEnabled(): boolean | null {
  return false;
}

export function resolveRelayTracingConfig(): {
  readonly tracesUrl: string;
  readonly tracesDataset: string;
  readonly tracesToken: string;
} | null {
  return null;
}

export function hasCloudPublicConfig(): boolean {
  const config = resolveCloudPublicConfig();
  if (!config.clerkPublishableKey || !config.clerkJwtTemplate || !config.relayUrl) {
    return false;
  }

  // Electron has its own auth runtime; development keys also support private browser origins.
  if (
    typeof window === "undefined" ||
    window.desktopBridge !== undefined ||
    !config.clerkPublishableKey.startsWith("pk_live_")
  ) {
    return true;
  }

  try {
    // Custom Frontend API hosts use clerk.<production domain>.
    const domain = clerkFrontendApiHostnameFromPublishableKey(config.clerkPublishableKey).replace(
      /^clerk\./u,
      "",
    );
    const { hostname, protocol, port } = window.location;
    return (
      protocol === "https:" &&
      port === "" &&
      (hostname === domain || hostname.endsWith(`.${domain}`))
    );
  } catch {
    return false;
  }
}

export function resolveRelayClerkTokenOptions() {
  const { clerkJwtTemplate } = resolveCloudPublicConfig();
  if (!clerkJwtTemplate) {
    throw new CloudPublicConfigMissingError({ key: "T3CODE_CLERK_JWT_TEMPLATE" });
  }
  return relayClerkTokenOptions(clerkJwtTemplate);
}
