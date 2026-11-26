import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  hasCloudPublicConfig,
  relayTelemetryEnabled,
  resolveCloudPublicConfig,
  resolveRelayTracingConfig,
  setServerRelayTelemetry,
} from "./publicConfig.ts";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("hasCloudPublicConfig", () => {
  it("rejects an insecure relay URL", () => {
    vi.stubEnv("VITE_CLERK_PUBLISHABLE_KEY", "pk_test_example");
    vi.stubEnv("VITE_CLERK_JWT_TEMPLATE", "t3-relay");
    vi.stubEnv("VITE_T3CODE_RELAY_URL", "http://relay.example.test");

    expect(hasCloudPublicConfig()).toBe(false);
  });

  describe("browser origins", () => {
    beforeEach(() => {
      vi.stubEnv("VITE_CLERK_PUBLISHABLE_KEY", `pk_live_${btoa("clerk.example.com$")}`);
      vi.stubEnv("VITE_CLERK_JWT_TEMPLATE", "t3-relay");
      vi.stubEnv("VITE_T3CODE_RELAY_URL", "https://relay.example.test");
    });

    it.each(["https://example.com", "https://nightly.app.example.com:443"])(
      "enables production auth on the configured root and subdomains: %s",
      (origin) => {
        vi.stubGlobal("window", { location: new URL(origin) });

        expect(hasCloudPublicConfig()).toBe(true);
      },
    );

    it.each(["http://localhost:3773", "https://machine.example.ts.net"])(
      "disables production auth on private browser origins: %s",
      (origin) => {
        vi.stubGlobal("window", { location: new URL(origin) });

        expect(hasCloudPublicConfig()).toBe(false);
      },
    );

    it.each(["http://app.example.com:443", "https://app.example.com:3773"])(
      "rejects unsupported schemes and ports even on the configured domain: %s",
      (origin) => {
        vi.stubGlobal("window", { location: new URL(origin) });

        expect(hasCloudPublicConfig()).toBe(false);
      },
    );

    it.each(["https://notexample.com", "https://example.com.evil.test"])(
      "rejects domain lookalikes: %s",
      (origin) => {
        vi.stubGlobal("window", { location: new URL(origin) });

        expect(hasCloudPublicConfig()).toBe(false);
      },
    );

    it.each([
      ["https://tenant.clerk.accounts.dev", true],
      ["https://other.clerk.accounts.dev", false],
    ])("keeps a provider hostname scoped to its own instance: %s", (origin, expected) => {
      vi.stubEnv("VITE_CLERK_PUBLISHABLE_KEY", `pk_live_${btoa("tenant.clerk.accounts.dev$")}`);
      vi.stubGlobal("window", { location: new URL(origin) });

      expect(hasCloudPublicConfig()).toBe(expected);
    });

    it("keeps production keys available in the Electron auth shell", () => {
      vi.stubGlobal("window", { location: new URL("file:///app/index.html"), desktopBridge: {} });

      expect(hasCloudPublicConfig()).toBe(true);
    });
  });

  it("permanently disables relay telemetry and tracing config even when env vars are set", () => {
    vi.stubEnv("VITE_RELAY_OTLP_TRACES_URL", "https://api.axiom.co/v1/traces");
    vi.stubEnv("VITE_RELAY_OTLP_TRACES_DATASET", "relay-traces");
    vi.stubEnv("VITE_RELAY_OTLP_TRACES_TOKEN", "xaat-test");
    setServerRelayTelemetry(true);

    expect(relayTelemetryEnabled()).toBe(false);
    expect(resolveRelayTracingConfig()).toBeNull();
    expect(resolveCloudPublicConfig().relayTracing).toEqual({
      tracesUrl: null,
      tracesDataset: null,
      tracesToken: null,
    });
  });

  it("defaults clerkJwtTemplate to t3-relay when custom desktop relay and Clerk key are configured without build-time env", () => {
    vi.stubEnv("VITE_CLERK_PUBLISHABLE_KEY", "");
    vi.stubEnv("VITE_CLERK_JWT_TEMPLATE", "");
    vi.stubEnv("VITE_T3CODE_RELAY_URL", "");
    const key = `pk_live_${btoa("clerk.custom.example$")}`;
    vi.stubGlobal("window", {
      location: new URL("t3code://app/settings/access"),
      desktopBridge: {
        getCustomRelayUrl: () => "https://relay.custom.example",
        getCustomClerkPublishableKey: () => key,
      },
    });

    expect(resolveCloudPublicConfig()).toEqual({
      clerkPublishableKey: key,
      clerkJwtTemplate: "t3-relay",
      relayUrl: "https://relay.custom.example",
      relayTracing: {
        tracesUrl: null,
        tracesDataset: null,
        tracesToken: null,
      },
    });
    expect(hasCloudPublicConfig()).toBe(true);
  });

  it("keeps cloud config disabled when neither build-time nor custom relay/Clerk are configured", () => {
    vi.stubEnv("VITE_CLERK_PUBLISHABLE_KEY", "");
    vi.stubEnv("VITE_CLERK_JWT_TEMPLATE", "");
    vi.stubEnv("VITE_T3CODE_RELAY_URL", "");
    vi.stubGlobal("window", {
      location: new URL("t3code://app/settings/access"),
      desktopBridge: {
        getCustomRelayUrl: () => null,
        getCustomClerkPublishableKey: () => null,
      },
    });

    expect(resolveCloudPublicConfig().clerkJwtTemplate).toBeNull();
    expect(hasCloudPublicConfig()).toBe(false);
  });
});
