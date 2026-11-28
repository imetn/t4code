import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("@expo/ui/swift-ui", () => ({
  Circle: "Circle",
  HStack: "HStack",
  Image: "Image",
  Rectangle: "Rectangle",
  RoundedRectangle: "RoundedRectangle",
  Spacer: "Spacer",
  Text: "Text",
  VStack: "VStack",
  ZStack: "ZStack",
}));

vi.mock("@expo/ui/swift-ui/modifiers", () => {
  const named = (name: string) => (value?: unknown) => ({ $modifier: name, value });
  return {
    accessibilityElement: named("accessibilityElement"),
    accessibilityLabel: named("accessibilityLabel"),
    clipped: named("clipped"),
    containerBackground: named("containerBackground"),
    environment: named("environment"),
    fixedSize: named("fixedSize"),
    font: named("font"),
    foregroundStyle: named("foregroundStyle"),
    frame: named("frame"),
    layoutPriority: named("layoutPriority"),
    lineLimit: named("lineLimit"),
    monospacedDigit: named("monospacedDigit"),
    offset: named("offset"),
    opacity: named("opacity"),
    padding: named("padding"),
    resizable: named("resizable"),
    widgetAccentedRenderingMode: named("widgetAccentedRenderingMode"),
    widgetURL: named("widgetURL"),
  };
});

vi.mock("expo-widgets", () => ({
  createWidget: (_name: string, layout: unknown) => layout,
}));

import { SubscriptionUsage } from "./SubscriptionUsage";
import type { SubscriptionUsageSnapshot } from "./subscriptionUsageSnapshot";

const now = Date.parse("2026-11-27T02:24:00.000Z");

function makeSnapshot(
  providers: SubscriptionUsageSnapshot["providers"],
  checkedAt = now,
): SubscriptionUsageSnapshot {
  return {
    checkedAt,
    providers,
  };
}

function makeProvider(
  driver: string,
  name: string,
  remaining: number,
): SubscriptionUsageSnapshot["providers"][number] {
  return {
    driver,
    name,
    detail: "Subscription remaining",
    expiresAt: now + 60 * 60_000,
    totalWindows: 2,
    windows: [
      {
        id: "weekly",
        kind: "weekly",
        label: "Weekly",
        remaining,
        reset: "Next reset Mon 9:00 AM",
        shortReset: "Mon",
        resetsAt: now + (3 * 24 + 5) * 60 * 60_000,
        pace: "on",
        paceTimeLeft: 50,
      },
      {
        id: "session",
        kind: "session",
        label: "5-hour",
        remaining: Math.min(100, remaining + 10),
        reset: "Next reset 3:00 PM",
        shortReset: "3:00 PM",
        resetsAt: now + (4 * 60 + 13) * 60_000,
        pace: "under",
        paceTimeLeft: 40,
      },
    ],
  };
}

describe("SubscriptionUsage iOS widget", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const coreProviders = [
    makeProvider("codex", "Codex", 60),
    makeProvider("antigravity", "Antigravity", 94),
    makeProvider("cursor", "Cursor", 100),
    makeProvider("claudeAgent", "Claude", 11),
  ];

  it("renders mini provider icons and segmented scales without timestamps in small 4-in-1 layout", () => {
    const tree = SubscriptionUsage(makeSnapshot(coreProviders), {
      widgetFamily: "systemSmall",
      colorScheme: "light",
      widgetRenderingMode: "fullColor",
      isLuminanceReduced: false,
      date: new Date(now),
      configuration: {},
    });
    const serialized = JSON.stringify(tree);

    expect(serialized).toContain('"assetName":"ProviderCodex"');
    expect(serialized).toContain('"assetName":"ProviderAntigravity"');
    expect(serialized).toContain('"assetName":"ProviderCursor"');
    expect(serialized).toContain('"assetName":"ProviderClaude"');
    expect(serialized).toContain('"type":"RoundedRectangle"');
    expect(serialized).toContain('{"$modifier":"widgetAccentedRenderingMode","value":"accented"}');
    expect(serialized).toContain('{"$modifier":"foregroundStyle","value":"#d97757"}');
    expect(serialized).not.toContain('"type":"Circle"');
    expect(serialized).not.toContain("As of");
  });

  it("renders 5h above weekly, compact live countdowns, and corner watermark across widget families", () => {
    const families = [
      "systemSmall",
      "systemMedium",
      "systemLarge",
      "accessoryRectangular",
    ] as const;
    for (const widgetFamily of families) {
      const providers = widgetFamily === "systemSmall" ? [coreProviders[3]!] : coreProviders;
      const tree = SubscriptionUsage(makeSnapshot(providers), {
        widgetFamily,
        colorScheme: "dark",
        widgetRenderingMode: "fullColor",
        isLuminanceReduced: false,
        date: new Date(now),
        configuration: {},
      });
      const serialized = JSON.stringify(tree);

      expect(serialized).toContain('"type":"Image"');
      expect(serialized).toContain('"type":"RoundedRectangle"');
      expect(serialized).not.toContain("As of");
      if (widgetFamily === "systemMedium") {
        expect(serialized.indexOf('"5h"')).toBeGreaterThan(-1);
        expect(serialized.indexOf('"W"')).toBeGreaterThan(serialized.indexOf('"5h"'));
        expect(serialized).toContain('"4h13m"');
      }
      if (widgetFamily === "systemSmall") {
        expect(serialized).toContain('{"$modifier":"offset","value":{"x":20,"y":20}}');
        expect(serialized).toContain('"4h13m"');
        expect(serialized).toContain('"3d 5h"');
      }
      if (widgetFamily === "systemLarge") {
        expect(serialized).toContain('"5-hour · 4h13m"');
        expect(serialized).toContain('"Weekly · 3d 5h"');
      }
    }
  });

  it("uses primary foreground in monochrome mode and falls back to Circle for unknown drivers", () => {
    const tree = SubscriptionUsage(
      makeSnapshot([
        makeProvider("claudeAgent", "Claude", 50),
        makeProvider("custom", "Custom", 80),
      ]),
      {
        widgetFamily: "systemSmall",
        colorScheme: "dark",
        widgetRenderingMode: "accented",
        isLuminanceReduced: false,
        date: new Date(now),
        configuration: {},
      },
    );
    const serialized = JSON.stringify(tree);

    expect(serialized).toContain('"assetName":"ProviderClaude"');
    expect(serialized).not.toContain('{"$modifier":"foregroundStyle","value":"#d97757"}');
    expect(serialized).toContain('"type":"Circle"');
  });
});
