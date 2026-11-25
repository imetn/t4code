import { describe, expect, it, vi } from "vite-plus/test";

import {
  clerkHostFromPublishableKey,
  latencyToneClassName,
  probeRelayHealth,
  relayHostLabel,
  resolveRelayVerificationState,
} from "./CustomRelayUrlSetting.logic";

const SAMPLE_CLERK_KEY = `pk_live_${btoa("clerk.example.com$")}`;

describe("CustomRelayUrlSetting.logic", () => {
  it("extracts host labels and Clerk frontend API hostnames safely", () => {
    expect(relayHostLabel("https://relay.example.com")).toBe("relay.example.com");
    expect(relayHostLabel("https://relay.example.com:8443")).toBe("relay.example.com:8443");
    expect(relayHostLabel("not-a-url")).toBeNull();
    expect(relayHostLabel(null)).toBeNull();

    expect(clerkHostFromPublishableKey(SAMPLE_CLERK_KEY)).toBe("clerk.example.com");
    expect(clerkHostFromPublishableKey("invalid-key")).toBeNull();
    expect(clerkHostFromPublishableKey(null)).toBeNull();
  });

  it("maps latency thresholds to emerald, amber, and destructive tones", () => {
    expect(latencyToneClassName(12)).toContain("emerald");
    expect(latencyToneClassName(99)).toContain("emerald");
    expect(latencyToneClassName(100)).toContain("amber");
    expect(latencyToneClassName(300)).toContain("amber");
    expect(latencyToneClassName(301)).toBe("text-destructive");
  });

  it("classifies relay verification alignment and missing credential warnings", () => {
    const matched = resolveRelayVerificationState({
      savedRelayUrl: "https://relay.example.com",
      defaultRelayUrl: "https://relay.t3.codes",
      savedClerkKey: SAMPLE_CLERK_KEY,
      savedCliClientId: "cli_123",
      isDesktop: true,
      cloudLink: {
        linked: true,
        linkRevoked: false,
        relayUrl: "https://relay.example.com/",
      },
    });
    expect(matched).toMatchObject({
      isCustomRelay: true,
      activeHost: "relay.example.com",
      linkedHost: "relay.example.com",
      clerkHostname: "clerk.example.com",
      linkAlignment: "matched",
      missingClerkKeyWarning: false,
      missingCliClientIdHint: false,
    });

    const mismatched = resolveRelayVerificationState({
      savedRelayUrl: "https://relay.example.com",
      defaultRelayUrl: "https://relay.t3.codes",
      savedClerkKey: null,
      savedCliClientId: null,
      isDesktop: true,
      cloudLink: {
        linked: true,
        linkRevoked: false,
        relayUrl: "https://relay.t3.codes",
      },
    });
    expect(mismatched).toMatchObject({
      isCustomRelay: true,
      linkAlignment: "mismatched",
      linkedHost: "relay.t3.codes",
      missingClerkKeyWarning: true,
      missingCliClientIdHint: false,
    });

    const desktopMissingCli = resolveRelayVerificationState({
      savedRelayUrl: "https://relay.example.com",
      defaultRelayUrl: "https://relay.t3.codes",
      savedClerkKey: SAMPLE_CLERK_KEY,
      savedCliClientId: null,
      isDesktop: true,
      cloudLink: {
        linked: false,
        linkRevoked: false,
        relayUrl: null,
      },
    });
    expect(desktopMissingCli).toMatchObject({
      linkAlignment: "unlinked",
      missingClerkKeyWarning: false,
      missingCliClientIdHint: true,
    });

    const revoked = resolveRelayVerificationState({
      savedRelayUrl: "https://relay.example.com",
      defaultRelayUrl: "https://relay.t3.codes",
      savedClerkKey: SAMPLE_CLERK_KEY,
      savedCliClientId: "cli_123",
      isDesktop: false,
      cloudLink: {
        linked: true,
        linkRevoked: true,
        relayUrl: "https://relay.example.com",
      },
    });
    expect(revoked.linkAlignment).toBe("revoked");
  });

  it("probes relay health via desktop bridge when available and falls back to fetch on web", async () => {
    expect(await probeRelayHealth("http://relay.example.com")).toEqual({
      ok: false,
      latencyMs: null,
      status: null,
      reason: "invalid-url",
    });

    const desktopProbe = vi.fn(async () => ({ ok: true as const, latencyMs: 18, status: 200 }));
    expect(await probeRelayHealth("https://relay.example.com/", { desktopProbe })).toEqual({
      ok: true,
      latencyMs: 18,
      status: 200,
    });
    expect(desktopProbe).toHaveBeenCalledWith("https://relay.example.com");

    const okFetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: true, service: "relay" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const okResult = await probeRelayHealth("https://relay.example.com", {
      fetchImpl: okFetch as unknown as typeof fetch,
    });
    expect(okResult.ok).toBe(true);
    expect(okResult.status).toBe(200);
    expect(okResult.latencyMs).toBeGreaterThanOrEqual(0);

    const wrongBodyFetch = vi.fn(async () => new Response("<html>ok</html>", { status: 200 }));
    expect(
      await probeRelayHealth("https://relay.example.com", {
        fetchImpl: wrongBodyFetch as unknown as typeof fetch,
      }),
    ).toMatchObject({ ok: false, status: 200, reason: "invalid-response" });

    const errorFetch = vi.fn(async () => new Response("bad gateway", { status: 502 }));
    expect(
      await probeRelayHealth("https://relay.example.com", {
        fetchImpl: errorFetch as unknown as typeof fetch,
      }),
    ).toMatchObject({ ok: false, status: 502, reason: "http-error" });

    const timeoutFetch = vi.fn(async () => {
      const error = new Error("timed out");
      error.name = "TimeoutError";
      throw error;
    });
    expect(
      await probeRelayHealth("https://relay.example.com", {
        fetchImpl: timeoutFetch as unknown as typeof fetch,
      }),
    ).toEqual({ ok: false, latencyMs: null, status: null, reason: "timeout" });

    const unreachableFetch = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(
      await probeRelayHealth("https://relay.example.com", {
        fetchImpl: unreachableFetch as unknown as typeof fetch,
      }),
    ).toEqual({ ok: false, latencyMs: null, status: null, reason: "unreachable" });
  });
});
