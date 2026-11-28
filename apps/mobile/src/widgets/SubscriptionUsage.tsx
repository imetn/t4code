import {
  Circle,
  HStack,
  Image,
  Rectangle,
  RoundedRectangle,
  Spacer,
  Text,
  VStack,
  ZStack,
} from "@expo/ui/swift-ui";
import {
  accessibilityElement,
  accessibilityLabel,
  clipped,
  containerBackground,
  environment,
  fixedSize,
  font,
  foregroundStyle,
  frame,
  layoutPriority,
  lineLimit,
  monospacedDigit,
  offset,
  opacity,
  padding,
  resizable,
  widgetAccentedRenderingMode,
  widgetURL,
} from "@expo/ui/swift-ui/modifiers";
import { createWidget, type WidgetEnvironment } from "expo-widgets";

import type { SubscriptionUsageSnapshot as SubscriptionUsageProps } from "./subscriptionUsageSnapshot";

type UsageConfiguration = {
  provider?: "all" | "codex" | "claudeAgent" | "antigravity" | "cursor" | "grok";
  period?: "auto" | "weekly" | "session" | "both";
};

export function SubscriptionUsage(
  props: SubscriptionUsageProps,
  widgetEnvironment: WidgetEnvironment<UsageConfiguration> & {
    showsContainerBackground?: boolean;
  },
) {
  "widget";
  // The extension evaluates this function without the app's module scope.
  const family = widgetEnvironment.widgetFamily;
  // Gallery snapshots can render an old timeline entry after it has expired.
  const now = Math.max(widgetEnvironment.date?.getTime() ?? 0, Date.now());
  const accessory = family === "accessoryRectangular";
  const small = family === "systemSmall";
  const medium = family === "systemMedium";
  const large = family === "systemLarge" || family === "systemExtraLarge";
  const simplified = widgetEnvironment.levelOfDetail === "simplified";
  const monochrome =
    (widgetEnvironment.widgetRenderingMode !== undefined &&
      widgetEnvironment.widgetRenderingMode !== "fullColor") ||
    widgetEnvironment.isLuminanceReduced === true;
  const mode = props.theme?.mode;
  const appearance =
    mode === "light" || mode === "dark"
      ? mode
      : widgetEnvironment.colorScheme === "dark"
        ? "dark"
        : "light";
  // StandBy can remove the card even in full color; text must then follow the host.
  const palette =
    !accessory && !monochrome && widgetEnvironment.showsContainerBackground !== false
      ? props.theme?.[appearance]
      : undefined;
  const primary = palette?.foreground ?? "primary";
  const secondary = palette?.secondary ?? "secondary";
  const trackColor = palette?.track ?? (appearance === "dark" ? "#26262a" : "#e8e8ed");
  const dividerColor = appearance === "dark" ? "#26262a" : "#e6e6eb";
  const dangerColor = palette?.danger ?? (appearance === "light" ? "#dc2626" : "#f87171");

  // English until the app publishes its first snapshot in the UI language.
  const text = props.text ?? {
    refresh: "Open T4 to refresh",
    noSessionLimit: "No session limit reported",
    noWeeklyLimit: "No weekly limit reported",
    subscriptionRemaining: "Subscription remaining",
    percentLeft: "{remaining}% left",
    windowPercentLeft: "{window} · {remaining}% left",
    left: "left",
    notApplicable: "N/A",
    openApp: "Open T4",
    noLimits: "No subscription limits available.",
    asOf: "As of {time}",
    tapToConnect: "Tap to connect in T4",
    shortWeekly: "W",
    shortSession: "5h",
    // oxlint-disable-next-line t3code/no-untranslated-copy -- widget fallback until the app publishes translated text
    weeklyLabel: "Weekly",
    sessionLabel: "5-hour",
    // oxlint-disable-next-line t3code/no-untranslated-copy -- widget fallback until the app publishes translated text
    weeklyQuotaLabel: "Weekly",
    unitDay: "d",
    unitDayHour: "h",
    // oxlint-disable-next-line t3code/no-untranslated-copy -- widget fallback until the app publishes translated text
    paceTitle: "Pace",
    paceAhead: "Fast",
    paceOn: "Steady",
    paceUnder: "Slow",
    providerAccessibility: "{provider}. {detail}.",
    windowAccessibility: "{provider}, {window}, {remaining} percent remaining. {reset}. {detail}.",
    moreInApp: {} as Record<string, string>,
  };

  const rawProviders = props.providers ?? [
    {
      driver: "codex",
      name: "Codex",
      // oxlint-disable-next-line t3code/no-untranslated-copy -- widget fallback until the app publishes translated text
      detail: "Open T4 to connect",
      windows: [],
      expiresAt: 0,
      totalWindows: 0,
    },
    {
      driver: "claudeAgent",
      name: "Claude",
      // oxlint-disable-next-line t3code/no-untranslated-copy -- widget fallback until the app publishes translated text
      detail: "Open T4 to connect",
      windows: [],
      expiresAt: 0,
      totalWindows: 0,
    },
    {
      driver: "antigravity",
      name: "Antigravity",
      // oxlint-disable-next-line t3code/no-untranslated-copy -- widget fallback until the app publishes translated text
      detail: "Open T4 to connect",
      windows: [],
      expiresAt: 0,
      totalWindows: 0,
    },
    {
      driver: "cursor",
      name: "Cursor",
      // oxlint-disable-next-line t3code/no-untranslated-copy -- widget fallback until the app publishes translated text
      detail: "Open T4 to connect",
      windows: [],
      expiresAt: 0,
      totalWindows: 0,
    },
  ];

  const selectedProviderFilter = widgetEnvironment.configuration?.provider ?? "all";
  const period = widgetEnvironment.configuration?.period ?? "auto";

  const filteredProviders =
    selectedProviderFilter === "all"
      ? rawProviders
      : rawProviders.filter((p) => p.driver === selectedProviderFilter);

  const maxProviders = accessory ? 2 : small || medium ? 4 : family === "systemExtraLarge" ? 6 : 4;
  const visibleProviders = filteredProviders.slice(0, maxProviders);

  type SnapshotProvider = (typeof rawProviders)[number];
  type SnapshotWindow = SnapshotProvider["windows"][number];

  const providerBarColor = (provider: SnapshotProvider) => {
    switch (provider.driver) {
      case "claudeAgent":
        return "#d97757";
      case "antigravity":
        return "#8b7cf6";
      case "codex":
        return "#339cff";
      case "cursor":
        return appearance === "dark" ? "#34d399" : "#10b981";
      case "grok":
        return appearance === "dark" ? "#b4b7bf" : "#52525b";
      case "opencode":
        return "#38bdf8";
      case "pi":
        return "#f59e0b";
      case "muse":
        return "#0081fb";
      default:
        return provider.colors?.[appearance] ?? "#339cff";
    }
  };

  const providerIconAsset = (driver: string) => {
    switch (driver) {
      case "codex":
        return { assetName: "ProviderCodex", original: false, tintColor: primary };
      case "claudeAgent":
        return {
          assetName: "ProviderClaude",
          original: false,
          tintColor: monochrome ? primary : "#d97757",
        };
      case "antigravity":
        return { assetName: "ProviderAntigravity", original: true, tintColor: primary };
      case "cursor":
        return { assetName: "ProviderCursor", original: false, tintColor: primary };
      case "grok":
        return { assetName: "ProviderGrok", original: false, tintColor: primary };
      case "opencode":
        return { assetName: "ProviderOpenCode", original: false, tintColor: primary };
      case "pi":
        return { assetName: "ProviderPi", original: false, tintColor: primary };
      case "muse":
        return {
          assetName: "ProviderMuse",
          original: false,
          tintColor: monochrome ? primary : "#0081fb",
        };
      default:
        return null;
    }
  };

  // Image views ignore frame/foregroundStyle directly, so size and tint via a square HStack container.
  const renderProviderIcon = (provider: SnapshotProvider, size: number) => {
    const icon = providerIconAsset(provider.driver);
    if (!icon) {
      const dotSize = Math.max(5, Math.round(size * 0.5));
      return (
        <Circle
          modifiers={[
            foregroundStyle(monochrome ? primary : providerBarColor(provider)),
            frame({ width: dotSize, height: dotSize }),
          ]}
        />
      );
    }
    return (
      <HStack
        modifiers={[
          frame({ width: size, height: size }),
          ...(icon.original ? [] : [foregroundStyle(icon.tintColor)]),
        ]}
      >
        <Image
          assetName={icon.assetName}
          modifiers={
            icon.original ? [resizable(), widgetAccentedRenderingMode("accented")] : [resizable()]
          }
        />
      </HStack>
    );
  };

  const renderWatermark = (provider: SnapshotProvider) => {
    const icon = providerIconAsset(provider.driver);
    if (!icon) return null;
    return (
      <HStack
        modifiers={[
          frame({ width: 112, height: 112 }),
          ...(icon.original ? [] : [foregroundStyle(icon.tintColor)]),
          opacity(icon.original ? 0.065 : 0.045),
          offset({ x: 20, y: 20 }),
        ]}
      >
        <Image assetName={icon.assetName} modifiers={[resizable()]} />
      </HStack>
    );
  };

  const renderResetChip = (label: string, size = 9) => (
    <HStack spacing={2} alignment="center">
      <Image
        systemName="clock"
        modifiers={[
          font({ size: Math.max(7.5, size - 1), weight: "medium" }),
          foregroundStyle(secondary),
          opacity(0.75),
        ]}
      />
      <Text
        modifiers={[
          font({ size }),
          monospacedDigit(),
          lineLimit(1),
          layoutPriority(1),
          foregroundStyle(secondary),
        ]}
      >
        {label}
      </Text>
    </HStack>
  );

  const paceRemainingFor = (win: SnapshotWindow): number | undefined => {
    if (win.resetsAt !== undefined && win.durationMs !== undefined && win.durationMs > 0) {
      const leftMs = win.resetsAt - now;
      if (leftMs <= 0) return 0;
      return Math.max(0, Math.min(100, (leftMs / win.durationMs) * 100));
    }
    return win.paceTimeLeft;
  };

  const renderSegmentedScale = (
    remaining: number,
    barColor: string,
    segments: number,
    height: number,
    spacing = 2,
    cornerRadius = 1.4,
    monochromeBar = false,
    paceLeft?: number,
  ) => {
    const clamped = Math.max(0, Math.min(100, remaining));
    const fillColor =
      monochromeBar || monochrome ? primary : clamped <= 10 ? dangerColor : barColor;
    const filled = (clamped / 100) * segments;
    const showPaceTick = !monochromeBar && paceLeft !== undefined && paceLeft > 3 && paceLeft < 97;
    const paceSlot = showPaceTick
      ? Math.max(1, Math.min(segments - 1, Math.round((paceLeft / 100) * segments)))
      : -1;
    const tickHeight = height + 4;
    return (
      <HStack
        spacing={spacing}
        alignment="center"
        modifiers={[
          frame({ maxWidth: Infinity }),
          frame({ height: showPaceTick ? tickHeight : height }),
        ]}
      >
        {Array.from({ length: segments }, (_, index) => index).flatMap((index) => {
          const lit = Math.max(0, Math.min(1, filled - index));
          const inDeficit = showPaceTick && index < paceSlot && lit < 1;
          const segmentNode = (
            <ZStack key={index} modifiers={[frame({ maxWidth: Infinity }), frame({ height })]}>
              <RoundedRectangle
                cornerRadius={cornerRadius}
                modifiers={[
                  foregroundStyle(monochromeBar ? primary : trackColor),
                  ...(monochromeBar ? [opacity(0.22)] : []),
                  frame({ maxWidth: Infinity }),
                  frame({ height }),
                ]}
              />
              {inDeficit ? (
                <RoundedRectangle
                  cornerRadius={cornerRadius}
                  modifiers={[
                    foregroundStyle(fillColor),
                    opacity(0.28),
                    frame({ maxWidth: Infinity }),
                    frame({ height }),
                  ]}
                />
              ) : null}
              {lit > 0 ? (
                <RoundedRectangle
                  cornerRadius={cornerRadius}
                  modifiers={[
                    foregroundStyle(fillColor),
                    opacity(lit * (monochromeBar ? 0.92 : 0.9)),
                    frame({ maxWidth: Infinity }),
                    frame({ height }),
                  ]}
                />
              ) : null}
            </ZStack>
          );
          if (index === paceSlot) {
            return [
              <RoundedRectangle
                key="pace-tick"
                cornerRadius={1}
                modifiers={[foregroundStyle(fillColor), frame({ width: 2, height: tickHeight })]}
              />,
              segmentNode,
            ];
          }
          return [segmentNode];
        })}
      </HStack>
    );
  };

  const formatCountdown = (win: SnapshotWindow): string | undefined => {
    if (win.resetsAt !== undefined) {
      const remainingMs = win.resetsAt - now;
      if (remainingMs > 0) {
        const totalMinutes = Math.max(1, Math.round(remainingMs / 60_000));
        const days = Math.floor(totalMinutes / (24 * 60));
        const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
        const minutes = totalMinutes % 60;
        if (days > 0) {
          const dayUnit = text.unitDay ?? "d";
          const hourUnit = text.unitDayHour ?? "h";
          const sep = dayUnit === "d" ? " " : "";
          return hours > 0 ? `${days}${dayUnit}${sep}${hours}${hourUnit}` : `${days}${dayUnit}`;
        }
        if (hours > 0) {
          return minutes > 0 ? `${hours}h${minutes}m` : `${hours}h`;
        }
        return `${minutes}m`;
      }
    }
    return win.shortReset;
  };

  const windowDisplayLabel = (provider: SnapshotProvider, win: SnapshotWindow) => {
    if (provider.driver === "antigravity") {
      // oxlint-disable-next-line t3code/no-untranslated-copy -- brand name + localized short badge
      if (win.kind === "session") return `Gemini · ${text.shortSession}`;
      // oxlint-disable-next-line t3code/no-untranslated-copy -- brand name + localized short badge
      if (win.kind === "weekly") return `Gemini · ${text.shortWeekly}`;
    }
    if (win.kind === "session") return text.sessionLabel;
    if (win.kind === "weekly") return text.weeklyLabel;
    return win.label;
  };

  const paceDisplayText = (pace: SnapshotWindow["pace"]) => {
    if (pace === "ahead") return text.paceAhead;
    if (pace === "on") return text.paceOn;
    if (pace === "under") return text.paceUnder;
    return undefined;
  };

  const percentColor = (remaining: number) =>
    remaining <= 10 && !monochrome ? dangerColor : primary;

  const shortKindTag = (win: SnapshotWindow) =>
    win.kind === "weekly" ? text.shortWeekly : win.kind === "session" ? text.shortSession : "";

  const pickWindows = (provider: SnapshotProvider) => {
    const stale = provider.windows.length > 0 && now >= provider.expiresAt;
    if (stale)
      return { stale: true, weekly: undefined, session: undefined, shown: [] as SnapshotWindow[] };
    const isOwnGemini = (w: SnapshotWindow) =>
      provider.driver !== "antigravity" || !w.id || /^gemini-/i.test(w.id);
    const weekly =
      provider.windows.find(
        (w) =>
          w.kind === "weekly" && (provider.driver !== "antigravity" || w.id === "gemini-weekly"),
      ) ??
      provider.windows.find((w) => w.kind === "weekly" && isOwnGemini(w)) ??
      provider.windows.find((w) => w.kind === "weekly");
    const session =
      provider.windows.find(
        (w) => w.kind === "session" && (provider.driver !== "antigravity" || w.id === "gemini-5h"),
      ) ??
      provider.windows.find((w) => w.kind === "session" && isOwnGemini(w)) ??
      provider.windows.find((w) => w.kind === "session");
    const fallback = provider.windows.find((w) => isOwnGemini(w)) ?? provider.windows[0];
    if (period === "weekly") {
      return {
        stale: false,
        weekly,
        session: undefined,
        shown: weekly ? [weekly] : [],
      };
    }
    if (period === "session") {
      return { stale: false, weekly: undefined, session, shown: session ? [session] : [] };
    }
    // Both / Auto: keep 5h session first, then weekly, matching the in-app Limits layout.
    const pair = [session, weekly].filter((w): w is SnapshotWindow => w !== undefined);
    const extras = provider.windows.filter((w) => !pair.includes(w));
    return {
      stale: false,
      weekly,
      session,
      shown: pair.length > 0 ? [...pair, ...extras] : fallback ? [fallback] : [],
    };
  };

  // Lock Screen (accessoryRectangular) — Crisp monochrome 2-row segmented scale
  if (accessory) {
    return (
      <VStack alignment="leading" spacing={6} modifiers={props.url ? [widgetURL(props.url)] : []}>
        {visibleProviders.length === 0 ? (
          <Text modifiers={[font({ textStyle: "caption" }), foregroundStyle(secondary)]}>
            {text.noLimits}
          </Text>
        ) : (
          visibleProviders.map((provider) => {
            const picked = pickWindows(provider);
            const target =
              period === "session"
                ? picked.session
                : period === "weekly"
                  ? (picked.weekly ?? picked.shown[0])
                  : (picked.session ?? picked.weekly ?? picked.shown[0]);
            const kindTag = target ? shortKindTag(target) : "";
            return (
              <VStack key={provider.driver} alignment="leading" spacing={3}>
                <HStack spacing={4} alignment="center">
                  {renderProviderIcon(provider, 11)}
                  <Text
                    modifiers={[
                      font({ size: 11, weight: "semibold" }),
                      lineLimit(1),
                      foregroundStyle(primary),
                    ]}
                  >
                    {kindTag ? `${provider.name} · ${kindTag}` : provider.name}
                  </Text>
                  <Spacer minLength={2} />
                  <Text
                    modifiers={[
                      font({ size: 11, weight: "bold" }),
                      monospacedDigit(),
                      lineLimit(1),
                      layoutPriority(1),
                      foregroundStyle(primary),
                    ]}
                  >
                    {target
                      ? `${target.remaining}%`
                      : picked.stale
                        ? text.openApp
                        : text.notApplicable}
                  </Text>
                </HStack>
                {target
                  ? renderSegmentedScale(target.remaining, primary, 14, 4.5, 1.5, 1, true)
                  : null}
              </VStack>
            );
          })
        )}
      </VStack>
    );
  }

  const rootModifiers = [
    ...(props.url ? [widgetURL(props.url)] : []),
    ...(palette
      ? [containerBackground(palette.background, "widget"), environment("colorScheme", appearance)]
      : []),
  ];

  const disconnectedFooter = !props.checkedAt ? (
    <Text modifiers={[font({ size: 9.5 }), foregroundStyle(secondary), lineLimit(1)]}>
      {text.tapToConnect}
    </Text>
  ) : null;

  // Small Widget — Single Provider Hero Card (Nowdex Segmented Style + Subtle Corner Watermark)
  if (small && visibleProviders.length === 1) {
    const provider = visibleProviders[0]!;
    const color = providerBarColor(provider);
    const picked = pickWindows(provider);
    const isCursorMulti = provider.driver === "cursor" && picked.shown.length > 1;
    const shown = isCursorMulti ? picked.shown.slice(0, 3) : picked.shown.slice(0, 2);
    const soloWindow = shown.length === 1 ? shown[0] : undefined;
    const soloPace = soloWindow ? paceDisplayText(soloWindow.pace) : undefined;

    return (
      <ZStack
        alignment="bottomTrailing"
        modifiers={[
          ...rootModifiers,
          frame({ maxWidth: Infinity, maxHeight: Infinity }),
          clipped(),
        ]}
      >
        {renderWatermark(provider)}
        <VStack
          alignment="leading"
          spacing={0}
          modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: "topLeading" })]}
        >
          <HStack spacing={5} alignment="center">
            {renderProviderIcon(provider, 14)}
            <Text
              modifiers={[
                font({ size: 12, weight: "semibold" }),
                foregroundStyle(primary),
                lineLimit(1),
              ]}
            >
              {provider.name}
            </Text>
            <Spacer minLength={0} />
          </HStack>

          {shown.length === 0 ? (
            <VStack alignment="leading" spacing={4}>
              <Spacer minLength={0} />
              <Text modifiers={[font({ size: 11 }), foregroundStyle(secondary), lineLimit(2)]}>
                {picked.stale
                  ? text.refresh
                  : period === "session" && provider.windows.length > 0
                    ? text.noSessionLimit
                    : provider.detail}
              </Text>
              <Spacer minLength={0} />
              {disconnectedFooter}
            </VStack>
          ) : isCursorMulti ? (
            <VStack alignment="leading" spacing={0}>
              {(() => {
                const lead = shown[0]!;
                const subRows = shown.slice(1, 3);
                const leadCountdown = formatCountdown(lead);
                return (
                  <>
                    <Spacer minLength={6} />
                    <HStack alignment="bottom" spacing={4}>
                      <VStack alignment="leading" spacing={2}>
                        <Text
                          modifiers={[
                            font({ size: 10, weight: "semibold" }),
                            foregroundStyle(primary),
                            opacity(0.85),
                            lineLimit(1),
                          ]}
                        >
                          {lead.label}
                        </Text>
                        {leadCountdown ? renderResetChip(leadCountdown, 8.5) : null}
                      </VStack>
                      <Spacer minLength={2} />
                      <HStack alignment="bottom" spacing={1}>
                        <Text
                          modifiers={[
                            font({ size: 26, weight: "regular" }),
                            monospacedDigit(),
                            lineLimit(1),
                            layoutPriority(1),
                            foregroundStyle(percentColor(lead.remaining)),
                          ]}
                        >
                          {String(lead.remaining)}
                        </Text>
                        <Text
                          modifiers={[
                            font({ size: 9.5, weight: "medium" }),
                            foregroundStyle(secondary),
                            padding({ bottom: 3 }),
                          ]}
                        >
                          %
                        </Text>
                      </HStack>
                    </HStack>
                    <Spacer minLength={5} />
                    {renderSegmentedScale(
                      lead.remaining,
                      color,
                      16,
                      10,
                      2,
                      1.4,
                      false,
                      paceRemainingFor(lead),
                    )}
                    <Spacer minLength={8} />
                    <VStack alignment="leading" spacing={5}>
                      {subRows.map((sub) => (
                        <HStack key={sub.id ?? sub.label} spacing={5} alignment="center">
                          <Text
                            modifiers={[
                              font({ size: 9, weight: "medium" }),
                              foregroundStyle(secondary),
                              lineLimit(1),
                              frame({ width: 36, alignment: "leading" }),
                            ]}
                          >
                            {sub.label.replace(/ Models$/i, "")}
                          </Text>
                          {renderSegmentedScale(
                            sub.remaining,
                            color,
                            10,
                            5.5,
                            1.5,
                            1,
                            false,
                            paceRemainingFor(sub),
                          )}
                          <Text
                            modifiers={[
                              font({ size: 10, weight: "semibold" }),
                              monospacedDigit(),
                              lineLimit(1),
                              fixedSize({ horizontal: true, vertical: false }),
                              layoutPriority(1),
                              frame({ minWidth: 34, alignment: "trailing" }),
                              foregroundStyle(percentColor(sub.remaining)),
                            ]}
                          >
                            {`${sub.remaining}%`}
                          </Text>
                        </HStack>
                      ))}
                    </VStack>
                  </>
                );
              })()}
            </VStack>
          ) : soloWindow ? (
            <VStack
              alignment="leading"
              spacing={0}
              modifiers={[
                frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: "topLeading" }),
                accessibilityElement("ignore"),
                accessibilityLabel(
                  text.windowAccessibility
                    .replace("{provider}", provider.name)
                    .replace("{window}", soloWindow.label)
                    .replace("{remaining}", String(soloWindow.remaining))
                    .replace("{reset}", soloWindow.reset)
                    .replace("{detail}", provider.detail),
                ),
              ]}
            >
              <Spacer minLength={8} />
              <HStack alignment="bottom" spacing={4}>
                <VStack alignment="leading" spacing={2}>
                  <Text
                    modifiers={[
                      font({ size: 10, weight: "semibold" }),
                      foregroundStyle(primary),
                      opacity(0.85),
                      lineLimit(1),
                    ]}
                  >
                    {windowDisplayLabel(provider, soloWindow)}
                  </Text>
                  {(() => {
                    const countdown = formatCountdown(soloWindow);
                    return countdown ? renderResetChip(countdown, 8.5) : null;
                  })()}
                </VStack>
                <Spacer minLength={2} />
                <HStack alignment="bottom" spacing={1}>
                  <Text
                    modifiers={[
                      font({ size: 36, weight: "regular" }),
                      monospacedDigit(),
                      lineLimit(1),
                      layoutPriority(1),
                      foregroundStyle(percentColor(soloWindow.remaining)),
                    ]}
                  >
                    {String(soloWindow.remaining)}
                  </Text>
                  <Text
                    modifiers={[
                      font({ size: 10, weight: "medium" }),
                      foregroundStyle(secondary),
                      padding({ bottom: 5 }),
                    ]}
                  >
                    %
                  </Text>
                </HStack>
              </HStack>
              <Spacer minLength={10} />
              {renderSegmentedScale(
                soloWindow.remaining,
                color,
                16,
                11,
                2,
                1.5,
                false,
                paceRemainingFor(soloWindow),
              )}
              <Spacer minLength={0} />
              {soloPace ? (
                <VStack alignment="leading" spacing={6}>
                  <Rectangle
                    modifiers={[
                      foregroundStyle(dividerColor),
                      frame({ maxWidth: Infinity }),
                      frame({ height: 1 }),
                    ]}
                  />
                  <HStack alignment="center">
                    <Text modifiers={[font({ size: 9.5 }), foregroundStyle(secondary)]}>
                      {text.paceTitle}
                    </Text>
                    <Spacer minLength={2} />
                    <Text
                      modifiers={[
                        font({ size: 9.5, weight: "semibold" }),
                        foregroundStyle(primary),
                      ]}
                    >
                      {soloPace}
                    </Text>
                  </HStack>
                </VStack>
              ) : null}
            </VStack>
          ) : (
            <VStack alignment="leading" spacing={0}>
              <Spacer minLength={4} />
              <VStack alignment="leading" spacing={10}>
                {shown.map((win) => {
                  const countdown = formatCountdown(win);
                  return (
                    <VStack
                      key={`${win.kind}:${win.label}`}
                      alignment="leading"
                      spacing={4}
                      modifiers={[
                        accessibilityElement("ignore"),
                        accessibilityLabel(
                          text.windowAccessibility
                            .replace("{provider}", provider.name)
                            .replace("{window}", win.label)
                            .replace("{remaining}", String(win.remaining))
                            .replace("{reset}", win.reset)
                            .replace("{detail}", provider.detail),
                        ),
                      ]}
                    >
                      <HStack alignment="bottom" spacing={4}>
                        <VStack alignment="leading" spacing={1.5}>
                          <Text
                            modifiers={[
                              font({ size: 10, weight: "semibold" }),
                              foregroundStyle(primary),
                              opacity(0.85),
                              lineLimit(1),
                            ]}
                          >
                            {windowDisplayLabel(provider, win)}
                          </Text>
                          {countdown ? renderResetChip(countdown, 8.5) : null}
                        </VStack>
                        <Spacer minLength={2} />
                        <HStack alignment="bottom" spacing={1}>
                          <Text
                            modifiers={[
                              font({ size: 25, weight: "regular" }),
                              monospacedDigit(),
                              lineLimit(1),
                              layoutPriority(1),
                              foregroundStyle(percentColor(win.remaining)),
                            ]}
                          >
                            {String(win.remaining)}
                          </Text>
                          <Text
                            modifiers={[
                              font({ size: 9, weight: "medium" }),
                              foregroundStyle(secondary),
                              padding({ bottom: 3 }),
                            ]}
                          >
                            %
                          </Text>
                        </HStack>
                      </HStack>
                      {renderSegmentedScale(
                        win.remaining,
                        color,
                        16,
                        10,
                        2,
                        1.4,
                        false,
                        paceRemainingFor(win),
                      )}
                    </VStack>
                  );
                })}
              </VStack>
              <Spacer minLength={0} />
            </VStack>
          )}
        </VStack>
      </ZStack>
    );
  }

  // Small Widget — Compact 4-in-1 Multi-Provider Stack (Nowdex Mini Segmented Scale)
  if (small || simplified) {
    const renderSmallRow = (provider: SnapshotProvider) => {
      const color = providerBarColor(provider);
      const picked = pickWindows(provider);
      const target =
        period === "session"
          ? picked.session
          : period === "weekly"
            ? (picked.weekly ?? picked.shown[0])
            : (picked.session ?? picked.weekly ?? picked.shown[0]);
      const kindTag = target ? shortKindTag(target) : "";
      return (
        <VStack
          key={provider.driver}
          alignment="leading"
          spacing={3}
          modifiers={[
            frame({ maxWidth: Infinity, alignment: "leading" }),
            accessibilityElement("ignore"),
            accessibilityLabel(
              target
                ? text.windowAccessibility
                    .replace("{provider}", provider.name)
                    .replace("{window}", target.label)
                    .replace("{remaining}", String(target.remaining))
                    .replace("{reset}", target.reset)
                    .replace("{detail}", provider.detail)
                : text.providerAccessibility
                    .replace("{provider}", provider.name)
                    .replace("{detail}", picked.stale ? text.refresh : provider.detail),
            ),
          ]}
        >
          <HStack spacing={4} alignment="center">
            {renderProviderIcon(provider, 11.5)}
            <Text
              modifiers={[
                font({ size: 11, weight: "semibold" }),
                foregroundStyle(primary),
                lineLimit(1),
              ]}
            >
              {provider.name}
            </Text>
            {kindTag ? (
              <Text
                modifiers={[
                  font({ size: 9, weight: "medium" }),
                  foregroundStyle(secondary),
                  lineLimit(1),
                ]}
              >
                {kindTag}
              </Text>
            ) : null}
            <Spacer minLength={2} />
            <Text
              modifiers={[
                font({ size: 11, weight: "bold" }),
                monospacedDigit(),
                layoutPriority(1),
                foregroundStyle(target ? percentColor(target.remaining) : secondary),
              ]}
            >
              {target ? `${target.remaining}%` : "-"}
            </Text>
          </HStack>
          {renderSegmentedScale(
            target ? target.remaining : 0,
            color,
            16,
            5.5,
            1.5,
            1,
            false,
            target ? paceRemainingFor(target) : undefined,
          )}
        </VStack>
      );
    };

    const evenlyDistribute = visibleProviders.length >= 4;
    return (
      <VStack alignment="leading" spacing={0} modifiers={rootModifiers}>
        {visibleProviders.length === 0 ? (
          <VStack alignment="leading" spacing={4}>
            <Spacer minLength={0} />
            <Text modifiers={[font({ textStyle: "caption" }), foregroundStyle(secondary)]}>
              {text.noLimits}
            </Text>
            <Spacer minLength={0} />
          </VStack>
        ) : evenlyDistribute ? (
          visibleProviders.flatMap((provider, index) => [
            index > 0 ? <Spacer key={`gap-${provider.driver}`} minLength={2} /> : null,
            renderSmallRow(provider),
          ])
        ) : (
          <VStack alignment="leading" spacing={0}>
            <Spacer minLength={0} />
            <VStack alignment="leading" spacing={visibleProviders.length === 3 ? 10 : 12}>
              {visibleProviders.map(renderSmallRow)}
            </VStack>
            <Spacer minLength={0} />
          </VStack>
        )}
        {!props.checkedAt && visibleProviders.every((p) => p.windows.length === 0) ? (
          <VStack alignment="leading" spacing={0}>
            <Spacer minLength={4} />
            {disconnectedFooter}
          </VStack>
        ) : null}
      </VStack>
    );
  }

  // Medium Widget — 2x2 Matrix for 3-4 Providers (Nowdex Segmented Scale, 5h above Weekly)
  const renderMediumCell = (provider: SnapshotProvider) => {
    const color = providerBarColor(provider);
    const picked = pickWindows(provider);
    const rows =
      period === "weekly"
        ? picked.weekly
          ? [picked.weekly]
          : picked.shown.slice(0, 1)
        : period === "session"
          ? picked.session
            ? [picked.session]
            : []
          : [picked.session, picked.weekly].filter((w): w is SnapshotWindow => w !== undefined);
    const effectiveRows = rows.length > 0 ? rows : picked.shown.slice(0, 2);
    const singleWindow = effectiveRows.length === 1 ? effectiveRows[0] : undefined;
    const sessionCountdown = picked.session ? formatCountdown(picked.session) : undefined;
    const weeklyCountdown = picked.weekly ? formatCountdown(picked.weekly) : undefined;
    const headerCountdown =
      !singleWindow && effectiveRows.length > 0
        ? picked.weekly && picked.weekly.remaining <= 10
          ? (weeklyCountdown ?? sessionCountdown)
          : (sessionCountdown ?? weeklyCountdown)
        : undefined;
    const singleCountdown = singleWindow ? formatCountdown(singleWindow) : undefined;

    return (
      <VStack
        key={provider.driver}
        alignment="leading"
        spacing={singleWindow ? 5 : 4.5}
        modifiers={[
          frame({ maxWidth: Infinity, alignment: "leading" }),
          fixedSize({ horizontal: false, vertical: true }),
        ]}
      >
        <HStack spacing={4.5} alignment="center">
          {renderProviderIcon(provider, 13)}
          <Text
            modifiers={[
              font({ size: 11.5, weight: "bold" }),
              foregroundStyle(primary),
              lineLimit(1),
            ]}
          >
            {provider.name}
          </Text>
          <Spacer minLength={2} />
          {singleWindow ? (
            <Text
              modifiers={[
                font({ size: 11.5, weight: "bold" }),
                monospacedDigit(),
                layoutPriority(1),
                foregroundStyle(percentColor(singleWindow.remaining)),
              ]}
            >
              {`${singleWindow.remaining}%`}
            </Text>
          ) : headerCountdown ? (
            renderResetChip(headerCountdown, 8.5)
          ) : null}
        </HStack>
        {effectiveRows.length === 0 ? (
          <Text modifiers={[font({ size: 10 }), foregroundStyle(secondary), lineLimit(1)]}>
            {picked.stale
              ? text.refresh
              : period === "session" && provider.windows.length > 0
                ? text.noSessionLimit
                : provider.detail}
          </Text>
        ) : singleWindow ? (
          <VStack
            alignment="leading"
            spacing={4}
            modifiers={[
              accessibilityElement("ignore"),
              accessibilityLabel(
                text.windowAccessibility
                  .replace("{provider}", provider.name)
                  .replace("{window}", singleWindow.label)
                  .replace("{remaining}", String(singleWindow.remaining))
                  .replace("{reset}", singleWindow.reset)
                  .replace("{detail}", provider.detail),
              ),
            ]}
          >
            {renderSegmentedScale(
              singleWindow.remaining,
              color,
              14,
              8,
              2,
              1.4,
              false,
              paceRemainingFor(singleWindow),
            )}
            <HStack spacing={4} alignment="center">
              <Text modifiers={[font({ size: 9.5 }), foregroundStyle(secondary), lineLimit(1)]}>
                {singleWindow.kind === "weekly"
                  ? (text.weeklyQuotaLabel ?? singleWindow.label)
                  : singleWindow.label}
              </Text>
              <Spacer minLength={2} />
              {singleCountdown ? renderResetChip(singleCountdown, 8.5) : null}
            </HStack>
          </VStack>
        ) : (
          <VStack alignment="leading" spacing={4}>
            {effectiveRows.map((win) => (
              <HStack
                key={`${win.kind}:${win.label}`}
                spacing={5}
                alignment="center"
                modifiers={[
                  accessibilityElement("ignore"),
                  accessibilityLabel(
                    text.windowAccessibility
                      .replace("{provider}", provider.name)
                      .replace("{window}", win.label)
                      .replace("{remaining}", String(win.remaining))
                      .replace("{reset}", win.reset)
                      .replace("{detail}", provider.detail),
                  ),
                ]}
              >
                <Text
                  modifiers={[
                    font({ size: 9.5, weight: "semibold" }),
                    foregroundStyle(secondary),
                    lineLimit(1),
                    frame({ width: 15, alignment: "leading" }),
                  ]}
                >
                  {shortKindTag(win) || "•"}
                </Text>
                {renderSegmentedScale(
                  win.remaining,
                  color,
                  12,
                  6.5,
                  1.8,
                  1.2,
                  false,
                  paceRemainingFor(win),
                )}
                <Text
                  modifiers={[
                    font({ size: 10, weight: "semibold" }),
                    monospacedDigit(),
                    lineLimit(1),
                    fixedSize({ horizontal: true, vertical: false }),
                    layoutPriority(1),
                    frame({ minWidth: 34, alignment: "trailing" }),
                    foregroundStyle(percentColor(win.remaining)),
                  ]}
                >
                  {`${win.remaining}%`}
                </Text>
              </HStack>
            ))}
          </VStack>
        )}
      </VStack>
    );
  };

  if (medium && visibleProviders.length >= 3) {
    const topRow = visibleProviders.slice(0, 2);
    const bottomRow = visibleProviders.slice(2, 4);
    return (
      <VStack
        alignment="leading"
        spacing={14}
        modifiers={[
          ...rootModifiers,
          frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: "center" }),
        ]}
      >
        <HStack alignment="top" spacing={16}>
          {topRow.map(renderMediumCell)}
        </HStack>
        <HStack alignment="top" spacing={16}>
          {bottomRow.map(renderMediumCell)}
          {bottomRow.length === 1 ? (
            <VStack modifiers={[frame({ maxWidth: Infinity })]}>
              <Spacer minLength={0} />
            </VStack>
          ) : null}
        </HStack>
      </VStack>
    );
  }

  // Large Widget — 4-Provider Detailed Card (Side-by-side 5h / Weekly for 2-window providers)
  const renderLargeProvider = (provider: SnapshotProvider, index: number) => {
    const color = providerBarColor(provider);
    const picked = pickWindows(provider);
    const shown = picked.shown.slice(0, 2);
    const paceLabel = paceDisplayText(shown[0]?.pace ?? shown[1]?.pace);
    return (
      <VStack
        key={provider.driver}
        alignment="leading"
        spacing={6}
        modifiers={[
          frame({ maxWidth: Infinity, alignment: "leading" }),
          fixedSize({ horizontal: false, vertical: true }),
        ]}
      >
        {index > 0 ? (
          <Rectangle
            modifiers={[
              foregroundStyle(dividerColor),
              frame({ maxWidth: Infinity }),
              frame({ height: 1 }),
            ]}
          />
        ) : null}
        <HStack spacing={6} alignment="center">
          {renderProviderIcon(provider, 14)}
          <Text
            modifiers={[
              font({ size: 12.5, weight: "bold" }),
              foregroundStyle(primary),
              lineLimit(1),
            ]}
          >
            {provider.name}
          </Text>
          <Spacer minLength={4} />
          {paceLabel ? (
            <Text modifiers={[font({ size: 10 }), foregroundStyle(secondary), lineLimit(1)]}>
              {paceLabel}
            </Text>
          ) : null}
        </HStack>
        {shown.length === 0 ? (
          <Text modifiers={[font({ size: 11 }), foregroundStyle(secondary), lineLimit(1)]}>
            {picked.stale
              ? text.refresh
              : period === "session" && provider.windows.length > 0
                ? text.noSessionLimit
                : period === "weekly" && provider.windows.length > 0
                  ? text.noWeeklyLimit
                  : provider.detail}
          </Text>
        ) : shown.length === 2 ? (
          <HStack alignment="top" spacing={12}>
            {shown.map((win) => {
              const countdown = formatCountdown(win);
              const label =
                win.kind === "session"
                  ? (text.sessionLabel ?? win.label)
                  : win.kind === "weekly"
                    ? (text.weeklyLabel ?? win.label)
                    : win.label;
              return (
                <VStack
                  key={`${win.kind}:${win.label}`}
                  alignment="leading"
                  spacing={4}
                  modifiers={[
                    frame({ maxWidth: Infinity, alignment: "leading" }),
                    accessibilityElement("ignore"),
                    accessibilityLabel(
                      text.windowAccessibility
                        .replace("{provider}", provider.name)
                        .replace("{window}", win.label)
                        .replace("{remaining}", String(win.remaining))
                        .replace("{reset}", win.reset)
                        .replace("{detail}", provider.detail),
                    ),
                  ]}
                >
                  <HStack spacing={4} alignment="center">
                    <Text
                      modifiers={[
                        font({ size: 10, weight: "medium" }),
                        foregroundStyle(secondary),
                        lineLimit(1),
                      ]}
                    >
                      {countdown ? `${label} · ${countdown}` : label}
                    </Text>
                    <Spacer minLength={2} />
                    <Text
                      modifiers={[
                        font({ size: 11.5, weight: "bold" }),
                        monospacedDigit(),
                        layoutPriority(1),
                        foregroundStyle(percentColor(win.remaining)),
                      ]}
                    >
                      {`${win.remaining}%`}
                    </Text>
                  </HStack>
                  {renderSegmentedScale(
                    win.remaining,
                    color,
                    12,
                    8,
                    2,
                    1.4,
                    false,
                    paceRemainingFor(win),
                  )}
                </VStack>
              );
            })}
          </HStack>
        ) : (
          (() => {
            const win = shown[0]!;
            const countdown = formatCountdown(win);
            return (
              <VStack
                alignment="leading"
                spacing={4}
                modifiers={[
                  frame({ maxWidth: Infinity, alignment: "leading" }),
                  accessibilityElement("ignore"),
                  accessibilityLabel(
                    text.windowAccessibility
                      .replace("{provider}", provider.name)
                      .replace("{window}", win.label)
                      .replace("{remaining}", String(win.remaining))
                      .replace("{reset}", win.reset)
                      .replace("{detail}", provider.detail),
                  ),
                ]}
              >
                <HStack spacing={6} alignment="center">
                  <Text
                    modifiers={[
                      font({ size: 10, weight: "medium" }),
                      foregroundStyle(secondary),
                      lineLimit(1),
                    ]}
                  >
                    {win.kind === "weekly" ? (text.weeklyQuotaLabel ?? win.label) : win.label}
                  </Text>
                  <Spacer minLength={2} />
                  {countdown ? renderResetChip(countdown, 9) : null}
                  <Text
                    modifiers={[
                      font({ size: 11.5, weight: "bold" }),
                      monospacedDigit(),
                      layoutPriority(1),
                      foregroundStyle(percentColor(win.remaining)),
                    ]}
                  >
                    {`${win.remaining}%`}
                  </Text>
                </HStack>
                {renderSegmentedScale(
                  win.remaining,
                  color,
                  24,
                  8,
                  2,
                  1.4,
                  false,
                  paceRemainingFor(win),
                )}
              </VStack>
            );
          })()
        )}
      </VStack>
    );
  };

  // Medium Widget — 1-2 Providers Detailed Columns
  const renderDetailedMediumProvider = (provider: SnapshotProvider) => {
    const color = providerBarColor(provider);
    const picked = pickWindows(provider);
    const shown = picked.shown.slice(0, 2);
    return (
      <VStack
        key={provider.driver}
        alignment="leading"
        spacing={6}
        modifiers={[
          frame({ maxWidth: Infinity, alignment: "leading" }),
          fixedSize({ horizontal: false, vertical: true }),
        ]}
      >
        <HStack spacing={6} alignment="center">
          {renderProviderIcon(provider, 15)}
          <Text
            modifiers={[
              font({ size: 13.5, weight: "bold" }),
              foregroundStyle(primary),
              lineLimit(1),
            ]}
          >
            {provider.name}
          </Text>
          <Spacer minLength={2} />
        </HStack>
        {shown.length === 0 ? (
          <Text modifiers={[font({ size: 11 }), foregroundStyle(secondary), lineLimit(1)]}>
            {picked.stale ? text.refresh : provider.detail}
          </Text>
        ) : (
          <VStack alignment="leading" spacing={8}>
            {shown.map((win) => {
              const countdown = formatCountdown(win);
              return (
                <VStack key={`${win.kind}:${win.label}`} alignment="leading" spacing={3.5}>
                  <HStack spacing={4} alignment="center">
                    <Text
                      modifiers={[
                        font({ size: 10.5, weight: "medium" }),
                        foregroundStyle(secondary),
                        lineLimit(1),
                      ]}
                    >
                      {windowDisplayLabel(provider, win)}
                    </Text>
                    <Spacer minLength={2} />
                    {countdown ? renderResetChip(countdown, 8.5) : null}
                    <Text
                      modifiers={[
                        font({ size: 11.5, weight: "bold" }),
                        monospacedDigit(),
                        layoutPriority(1),
                        foregroundStyle(percentColor(win.remaining)),
                      ]}
                    >
                      {`${win.remaining}%`}
                    </Text>
                  </HStack>
                  {renderSegmentedScale(
                    win.remaining,
                    color,
                    16,
                    8,
                    2,
                    1.4,
                    false,
                    paceRemainingFor(win),
                  )}
                </VStack>
              );
            })}
          </VStack>
        )}
      </VStack>
    );
  };

  if (large) {
    return (
      <VStack
        alignment="leading"
        spacing={0}
        modifiers={[
          ...rootModifiers,
          frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: "center" }),
        ]}
      >
        {visibleProviders.length === 0 ? (
          <Text modifiers={[font({ textStyle: "caption" }), foregroundStyle(secondary)]}>
            {text.noLimits}
          </Text>
        ) : (
          visibleProviders.flatMap((provider, index) => [
            index > 0 ? <Spacer key={`lg-gap-${provider.driver}`} minLength={6} /> : null,
            renderLargeProvider(provider, index),
          ])
        )}
        {disconnectedFooter}
      </VStack>
    );
  }

  return (
    <VStack
      alignment="leading"
      spacing={6}
      modifiers={[
        ...rootModifiers,
        frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: "center" }),
      ]}
    >
      {visibleProviders.length === 0 ? (
        <Text modifiers={[font({ textStyle: "caption" }), foregroundStyle(secondary)]}>
          {text.noLimits}
        </Text>
      ) : (
        <HStack alignment="top" spacing={16}>
          {visibleProviders.map(renderDetailedMediumProvider)}
        </HStack>
      )}
      {disconnectedFooter}
    </VStack>
  );
}

export default createWidget("SubscriptionUsage", SubscriptionUsage);
