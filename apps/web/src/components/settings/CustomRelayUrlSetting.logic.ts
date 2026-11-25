import type {
  DesktopBridge,
  DesktopRelayProbeResult,
  EnvironmentCloudLinkStateResult,
} from "@t3tools/contracts";
import { clerkFrontendApiHostnameFromPublishableKey } from "@t3tools/shared/relayAuth";
import { normalizeSecureRelayUrl } from "@t3tools/shared/relayUrl";

export type RelayProbeResult = DesktopRelayProbeResult;

export type RelayLinkAlignment = "matched" | "mismatched" | "unlinked" | "revoked" | "unknown";

export interface RelayVerificationState {
  readonly isCustomRelay: boolean;
  readonly activeRelayUrl: string | null;
  readonly activeHost: string | null;
  readonly linkedRelayUrl: string | null;
  readonly linkedHost: string | null;
  readonly clerkHostname: string | null;
  readonly linkAlignment: RelayLinkAlignment;
  readonly missingClerkKeyWarning: boolean;
  readonly missingCliClientIdHint: boolean;
}

const DEFAULT_PROBE_TIMEOUT_MS = 5_000;

export function relayHostLabel(url: string | null): string | null {
  if (!url) return null;
  return URL.parse(url)?.host ?? null;
}

export function clerkHostFromPublishableKey(key: string | null): string | null {
  const trimmed = key?.trim() ?? "";
  if (!trimmed) return null;
  try {
    return clerkFrontendApiHostnameFromPublishableKey(trimmed);
  } catch {
    return null;
  }
}

export function latencyToneClassName(latencyMs: number): string {
  if (latencyMs < 100) return "text-emerald-600 dark:text-emerald-400";
  if (latencyMs <= 300) return "text-amber-600 dark:text-amber-400";
  return "text-destructive";
}

export function resolveRelayVerificationState(input: {
  readonly savedRelayUrl: string | null;
  readonly defaultRelayUrl: string | null;
  readonly savedClerkKey: string | null;
  readonly savedCliClientId: string | null;
  readonly isDesktop: boolean;
  readonly cloudLink: Pick<
    EnvironmentCloudLinkStateResult,
    "linked" | "linkRevoked" | "relayUrl"
  > | null;
}): RelayVerificationState {
  const normalizedSavedRelay = input.savedRelayUrl
    ? normalizeSecureRelayUrl(input.savedRelayUrl)
    : null;
  const normalizedDefaultRelay = input.defaultRelayUrl
    ? normalizeSecureRelayUrl(input.defaultRelayUrl)
    : null;
  const activeRelayUrl = normalizedSavedRelay ?? normalizedDefaultRelay;
  const isCustomRelay =
    normalizedSavedRelay !== null && normalizedSavedRelay !== normalizedDefaultRelay;
  const linkedRelayUrl =
    input.cloudLink?.linked && input.cloudLink.relayUrl
      ? normalizeSecureRelayUrl(input.cloudLink.relayUrl)
      : null;

  let linkAlignment: RelayLinkAlignment;
  if (input.cloudLink === null) {
    linkAlignment = "unknown";
  } else if (input.cloudLink.linkRevoked === true) {
    linkAlignment = "revoked";
  } else if (!input.cloudLink.linked) {
    linkAlignment = "unlinked";
  } else if (activeRelayUrl !== null && linkedRelayUrl === activeRelayUrl) {
    linkAlignment = "matched";
  } else {
    linkAlignment = "mismatched";
  }

  return {
    isCustomRelay,
    activeRelayUrl,
    activeHost: relayHostLabel(activeRelayUrl),
    linkedRelayUrl,
    linkedHost: relayHostLabel(linkedRelayUrl),
    clerkHostname: clerkHostFromPublishableKey(input.savedClerkKey),
    linkAlignment,
    missingClerkKeyWarning: isCustomRelay && input.savedClerkKey === null,
    missingCliClientIdHint:
      isCustomRelay &&
      input.isDesktop &&
      input.savedClerkKey !== null &&
      input.savedCliClientId === null,
  };
}

function isRelayHealthPayload(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "ok" in value &&
    value.ok === true &&
    "service" in value &&
    value.service === "relay"
  );
}

export async function probeRelayHealth(
  relayUrl: string,
  options?: {
    readonly desktopProbe?: DesktopBridge["probeRelay"];
    readonly fetchImpl?: typeof fetch;
    readonly timeoutMs?: number;
  },
): Promise<RelayProbeResult> {
  const origin = normalizeSecureRelayUrl(relayUrl);
  if (origin === null) {
    return { ok: false, latencyMs: null, status: null, reason: "invalid-url" };
  }
  if (options?.desktopProbe) {
    try {
      return await options.desktopProbe(origin);
    } catch {
      return { ok: false, latencyMs: null, status: null, reason: "unreachable" };
    }
  }
  const fetchImpl = options?.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  const startedAt = performance.now();
  try {
    const response = await fetchImpl(`${origin}/health`, {
      method: "GET",
      mode: "cors",
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
    const latencyMs = Math.max(0, Math.round(performance.now() - startedAt));
    if (!response.ok) {
      return { ok: false, latencyMs, status: response.status, reason: "http-error" };
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return { ok: false, latencyMs, status: response.status, reason: "invalid-response" };
    }
    if (!isRelayHealthPayload(payload)) {
      return { ok: false, latencyMs, status: response.status, reason: "invalid-response" };
    }
    return { ok: true, latencyMs, status: response.status };
  } catch (cause) {
    const isTimeout =
      cause instanceof Error && (cause.name === "TimeoutError" || cause.name === "AbortError");
    return {
      ok: false,
      latencyMs: null,
      status: null,
      reason: isTimeout ? "timeout" : "unreachable",
    };
  }
}
