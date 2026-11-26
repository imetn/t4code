import { describe, expect, it, vi } from "vite-plus/test";

import { hasTracingPublicConfig, resolveCloudPublicConfig } from "./publicConfig";

vi.mock("expo-constants", () => ({
  default: {
    expoConfig: {
      extra: {},
    },
  },
}));

describe("resolveCloudPublicConfig", () => {
  it("rejects an insecure relay URL", () => {
    expect(
      resolveCloudPublicConfig({
        clerk: { publishableKey: "pk_test_example", jwtTemplate: "t3-relay" },
        relay: { url: "http://relay.example.test" },
      }),
    ).toEqual({
      clerk: {
        publishableKey: "pk_test_example",
        jwtTemplate: "t3-relay",
      },
      relay: {
        url: null,
      },
      observability: {
        tracesUrl: null,
        tracesDataset: null,
        tracesToken: null,
      },
    });
  });

  it("permanently strips outbound observability tracing config even when extra provides it", () => {
    const config = resolveCloudPublicConfig({
      observability: {
        tracesUrl: "https://api.axiom.co/v1/traces",
        tracesDataset: "mobile-traces",
        tracesToken: "xaat-test",
      },
    });

    expect(config.observability).toEqual({
      tracesUrl: null,
      tracesDataset: null,
      tracesToken: null,
    });
    expect(hasTracingPublicConfig(config)).toBe(false);
  });

  it("defaults jwtTemplate to t3-relay when publishableKey and secure relay URL are set", () => {
    const config = resolveCloudPublicConfig({
      clerk: { publishableKey: "pk_live_example" },
      relay: { url: "https://relay.example.test" },
    });

    expect(config.clerk.jwtTemplate).toBe("t3-relay");
  });
});
