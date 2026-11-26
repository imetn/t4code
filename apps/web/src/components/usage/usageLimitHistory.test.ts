import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import { collectLimitAccounts, collectLimitPools } from "@t3tools/shared/usageLimits";
import { describe, expect, it } from "vite-plus/test";

import {
  appendLimitHistory,
  buildPaceCurveModel,
  clearHiddenLimitWindowsForDriver,
  limitWindowVisibilityKey,
  toggleHiddenLimitWindow,
} from "./usageLimitHistory";

function makePool(usedPercent: number, resetsAt: string, windowDurationMins: number) {
  const checkedAt = "2026-11-26T12:00:00.000Z";
  const provider: ServerProvider = {
    instanceId: ProviderInstanceId.make("claude-main"),
    driver: ProviderDriverKind.make("claudeAgent"),
    displayName: "Claude",
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt,
    models: [],
    slashCommands: [],
    skills: [],
    usageLimits: {
      checkedAt,
      windows: [
        {
          id: "weekly",
          kind: "weekly",
          label: "Weekly",
          usedPercent,
          resetsAt,
          windowDurationMins,
        },
      ],
    },
  };
  const presentations = new Map([
    [
      EnvironmentId.make("env-1"),
      {
        entry: { target: { label: "Desk" } },
        serverConfig: { providers: [provider] },
      },
    ],
  ]);
  const now = Date.parse(checkedAt);
  return {
    now,
    pools: collectLimitPools(collectLimitAccounts(presentations), now),
  };
}

describe("usageLimitHistory", () => {
  it("toggles and clears hidden limit window keys by driver", () => {
    const key1 = limitWindowVisibilityKey("antigravity", "3p-5h");
    const key2 = limitWindowVisibilityKey("antigravity", "3p-weekly");
    const key3 = limitWindowVisibilityKey("claudeAgent", "fable");

    const afterAdd = toggleHiddenLimitWindow(toggleHiddenLimitWindow([key3], key1), key2);
    expect(afterAdd).toEqual(["claudeAgent:fable", "antigravity:3p-5h", "antigravity:3p-weekly"]);
    expect(toggleHiddenLimitWindow(afterAdd, key1)).toEqual([
      "claudeAgent:fable",
      "antigravity:3p-weekly",
    ]);
    expect(clearHiddenLimitWindowsForDriver(afterAdd, "antigravity")).toEqual([
      "claudeAgent:fable",
    ]);
  });

  it("projects early depletion when burning faster than even pace", () => {
    // 1000-minute window, 500 minutes elapsed (50% time left), but 80% used (20% remaining)
    const { now, pools } = makePool(80, "2026-11-26T20:20:00.000Z", 1000);
    const window = pools[0]!.windows[0]!;
    const model = buildPaceCurveModel(window, undefined, now);

    expect(model).not.toBeNull();
    expect(model?.remainingPercent).toBe(20);
    expect(model?.paceRemainingPercent).toBe(50);
    expect(model?.paceDeltaPercent).toBe(-30);
    expect(model?.depletesAtMs).not.toBeNull();
    expect(model!.depletesAtMs!).toBeLessThan(model!.resetsAtMs);
    expect(model?.projectedEnd.y).toBe(0);
  });

  it("projects headroom to reset when under pace and preserves recorded samples", () => {
    // 1000-minute window, 500 minutes elapsed (50% time left), 20% used (80% remaining)
    const { now, pools } = makePool(20, "2026-11-26T20:20:00.000Z", 1000);
    const window = pools[0]!.windows[0]!;
    const history = appendLimitHistory(
      { "claudeAgent:weekly": [{ at: now - 150 * 60_000, remaining: 90 }] },
      pools,
      now,
    );
    const model = buildPaceCurveModel(window, history["claudeAgent:weekly"], now);

    expect(model).not.toBeNull();
    expect(model?.paceDeltaPercent).toBe(30);
    expect(model?.depletesAtMs).toBeNull();
    expect(model?.projectedEnd).toEqual({ x: 1, y: 60 });
    expect(model?.actualPoints).toHaveLength(3);
  });
});
