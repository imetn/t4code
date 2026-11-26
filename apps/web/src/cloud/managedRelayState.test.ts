import { DEFAULT_MANAGED_TUNNEL_LIMIT, T3CHAT_PLAN_TUNNEL_LIMITS } from "@t3tools/contracts/relay";
import { describe, expect, it } from "vite-plus/test";

import { managedTunnelCap } from "./managedRelayState";

describe("managedTunnelCap", () => {
  it("hides the default managed tunnel limit for self-hosted relays without T3 Chat billing", () => {
    expect(managedTunnelCap({ available: false, link: null }, { isCustomRelay: true })).toEqual({
      limit: null,
      upgrade: null,
    });
  });

  it("keeps the default limit on the official relay when T3 Chat is unavailable", () => {
    expect(managedTunnelCap({ available: false, link: null }, { isCustomRelay: false })).toEqual({
      limit: DEFAULT_MANAGED_TUNNEL_LIMIT,
      upgrade: null,
    });
  });

  it("honors an explicit maxTunnelsOverride even on a self-hosted relay", () => {
    expect(
      managedTunnelCap(
        { available: false, link: null, maxTunnelsOverride: 25 },
        { isCustomRelay: true },
      ),
    ).toEqual({
      limit: 25,
      upgrade: null,
    });
  });

  it("maps T3 Chat plan tiers when available", () => {
    expect(
      managedTunnelCap(
        { available: true, link: { email: "user@example.com", plan: "pro" } },
        { isCustomRelay: false },
      ),
    ).toEqual({
      limit: T3CHAT_PLAN_TUNNEL_LIMITS.pro,
      upgrade: "premier",
    });
  });
});
