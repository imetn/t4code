import {
  Capsule,
  Circle,
  HStack,
  ProgressView,
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
  containerBackground,
  environment,
  fixedSize,
  font,
  foregroundStyle,
  frame,
  layoutPriority,
  lineLimit,
  monospacedDigit,
  opacity,
  progressViewStyle,
  tint,
  widgetURL,
} from "@expo/ui/swift-ui/modifiers";
import { createWidget, type WidgetEnvironment } from "expo-widgets";

import type { SubscriptionUsageSnapshot as SubscriptionUsageProps } from "./subscriptionUsageSnapshot";

type UsageConfiguration = {
  provider?: "all" | "codex" | "claudeAgent" | "antigravity" | "cursor" | "grok";
  period?: "auto" | "weekly" | "session" | "both";
};

type WidgetModifier = ReturnType<typeof frame>;

function SubscriptionUsage(
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
    widgetEnvironment.widgetRenderingMode !== "fullColor" || widgetEnvironment.isLuminanceReduced;
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
  const trackColor = palette?.track ?? (appearance === "dark" ? "#2c2c2e" : "#e5e5ea");
  const dangerColor = palette?.danger ?? (appearance === "light" ? "#dc2626" : "#fca5a5");

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

  const maxProviders = accessory ? 2 : small || medium ? 4 : family === "systemExtraLarge" ? 6 : 5;
  const visibleProviders = filteredProviders.slice(0, maxProviders);

  const defaultProviderColor = (driver: string) => {
    if (driver === "claudeAgent") return "#d97757";
    if (driver === "antigravity") return "#8c7bd1";
    if (driver === "cursor") return "#8b8b8b";
    if (driver === "grok") return appearance === "dark" ? "#a1a1aa" : "#52525b";
    return appearance === "dark" ? "#e6e6e6" : "#3c3c43";
  };

  type SnapshotProvider = SubscriptionUsageProps["providers"][number];
  type SnapshotWindow = SnapshotProvider["windows"][number];

  const livePacePercent = (win: SnapshotWindow): number | undefined => {
    if (win.resetsAt && win.durationMs && win.durationMs > 0) {
      const fraction = (win.resetsAt - now) / win.durationMs;
      if (fraction > 0 && fraction < 1) return Math.round(fraction * 100);
    }
    return win.paceTimeLeft;
  };

  const widthFraction = (fraction: number): WidgetModifier =>
    ({ $type: "universalLayout", widthFraction: fraction }) as unknown as WidgetModifier;

  const renderPaceBar = (
    remaining: number,
    barColor: string,
    pacePct: number | undefined,
    barHeight: number,
  ) => {
    const clampedRemaining = Math.max(0, Math.min(100, remaining));
    const fillColor = monochrome ? primary : clampedRemaining <= 10 ? dangerColor : barColor;
    const showTick = !accessory && pacePct !== undefined && pacePct > 2 && pacePct < 98;
    const clampedPace = showTick ? Math.max(2, Math.min(96, pacePct!)) : 0;
    const tickHeight = barHeight + 4;
    // ParentAwareHStackLayout only resolves child widthFraction when its parent opts into universal percentages.
    // ZStack resets that environment flag, so wrap each percentage HStack in a VStack(resolvesChildPercentages).
    return (
      <ZStack
        alignment="leading"
        modifiers={[frame({ maxWidth: Infinity }), frame({ height: tickHeight })]}
      >
        <Capsule
          modifiers={[
            foregroundStyle(trackColor),
            frame({ maxWidth: Infinity }),
            frame({ height: barHeight }),
          ]}
        />
        {clampedRemaining > 0 ? (
          <VStack
            alignment="leading"
            spacing={0}
            resolvesChildPercentages
            modifiers={[frame({ maxWidth: Infinity }), frame({ height: barHeight })]}
          >
            <HStack
              spacing={0}
              resolvesChildPercentages
              modifiers={[frame({ maxWidth: Infinity }), frame({ height: barHeight })]}
            >
              <Capsule
                modifiers={[
                  foregroundStyle(fillColor),
                  frame({ height: barHeight }),
                  widthFraction(clampedRemaining / 100),
                ]}
              />
              <Spacer minLength={0} />
            </HStack>
          </VStack>
        ) : null}
        {showTick ? (
          <VStack
            alignment="leading"
            spacing={0}
            resolvesChildPercentages
            modifiers={[frame({ maxWidth: Infinity }), frame({ height: tickHeight })]}
          >
            <HStack
              spacing={0}
              resolvesChildPercentages
              modifiers={[frame({ maxWidth: Infinity }), frame({ height: tickHeight })]}
            >
              <Rectangle
                modifiers={[opacity(0), frame({ height: 1 }), widthFraction(clampedPace / 100)]}
              />
              <RoundedRectangle
                cornerRadius={1}
                modifiers={[foregroundStyle(primary), frame({ width: 2, height: tickHeight })]}
              />
              <Spacer minLength={0} />
            </HStack>
          </VStack>
        ) : null}
      </ZStack>
    );
  };

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
    // Both / Auto: keep Weekly first so high-level quota leads, then 5h session if present.
    const pair = [weekly, session].filter((w): w is SnapshotWindow => w !== undefined);
    const extras = provider.windows.filter((w) => !pair.includes(w));
    return {
      stale: false,
      weekly,
      session,
      shown: pair.length > 0 ? [...pair, ...extras] : fallback ? [fallback] : [],
    };
  };

  const providerColor = (provider: SnapshotProvider) =>
    provider.colors?.[appearance] ?? defaultProviderColor(provider.driver);

  const percentColor = (remaining: number) =>
    remaining <= 10 && !monochrome ? dangerColor : primary;

  const shortKindTag = (win: SnapshotWindow) =>
    win.kind === "weekly" ? text.shortWeekly : win.kind === "session" ? text.shortSession : "";

  // Lock Screen (accessoryRectangular)
  if (accessory) {
    return (
      <VStack alignment="leading" spacing={4} modifiers={props.url ? [widgetURL(props.url)] : []}>
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
                  : picked.shown.reduce<SnapshotWindow | undefined>(
                      (best, w) => (!best || w.remaining < best.remaining ? w : best),
                      undefined,
                    );
            return (
              <VStack key={provider.driver} alignment="leading" spacing={2}>
                <HStack spacing={4}>
                  <Text
                    modifiers={[
                      font({ textStyle: "caption", weight: "semibold" }),
                      lineLimit(1),
                      foregroundStyle(primary),
                    ]}
                  >
                    {provider.name}
                    {target && shortKindTag(target) ? ` · ${shortKindTag(target)}` : ""}
                  </Text>
                  <Spacer minLength={2} />
                  <Text
                    modifiers={[
                      font({ textStyle: "caption", weight: "semibold" }),
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
                {target ? (
                  <ProgressView
                    value={target.remaining / 100}
                    modifiers={[progressViewStyle("linear"), frame({ height: 4 }), tint(primary)]}
                  />
                ) : null}
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

  const compactTimeFooter = (
    <HStack spacing={4}>
      <Spacer minLength={0} />
      <Text
        modifiers={[font({ size: 9 }), monospacedDigit(), foregroundStyle(secondary), lineLimit(1)]}
      >
        {props.checkedAt
          ? new Date(props.checkedAt).toLocaleTimeString(undefined, {
              hour: "numeric",
              minute: "2-digit",
            })
          : text.tapToConnect}
      </Text>
    </HStack>
  );

  // Small Widget — Single Provider Detailed View
  if (small && visibleProviders.length === 1) {
    const provider = visibleProviders[0]!;
    const color = providerColor(provider);
    const picked = pickWindows(provider);
    const shown = picked.shown.slice(0, 2);
    return (
      <VStack alignment="leading" spacing={6} modifiers={rootModifiers}>
        <HStack spacing={6} alignment="center">
          <Circle
            modifiers={[
              foregroundStyle(monochrome ? primary : color),
              frame({ width: 7, height: 7 }),
            ]}
          />
          <Text
            modifiers={[font({ size: 13, weight: "bold" }), foregroundStyle(primary), lineLimit(1)]}
          >
            {provider.name}
          </Text>
          <Spacer minLength={0} />
        </HStack>
        {shown.length === 0 ? (
          <Text modifiers={[font({ size: 11 }), foregroundStyle(secondary), lineLimit(2)]}>
            {picked.stale
              ? text.refresh
              : period === "session" && provider.windows.length > 0
                ? text.noSessionLimit
                : provider.detail}
          </Text>
        ) : (
          <VStack alignment="leading" spacing={8}>
            {shown.map((win) => (
              <VStack
                key={`${win.kind}:${win.label}`}
                alignment="leading"
                spacing={2}
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
                <HStack spacing={4}>
                  <Text
                    modifiers={[
                      font({ size: 11, weight: "medium" }),
                      foregroundStyle(secondary),
                      lineLimit(1),
                    ]}
                  >
                    {win.label}
                  </Text>
                  <Spacer minLength={2} />
                  <Text
                    modifiers={[
                      font({ size: 12, weight: "bold" }),
                      monospacedDigit(),
                      layoutPriority(1),
                      foregroundStyle(percentColor(win.remaining)),
                    ]}
                  >
                    {`${win.remaining}%`}
                  </Text>
                </HStack>
                {renderPaceBar(win.remaining, color, livePacePercent(win), 6)}
                {win.shortReset ? (
                  <Text modifiers={[font({ size: 9 }), foregroundStyle(secondary), lineLimit(1)]}>
                    {win.shortReset}
                  </Text>
                ) : null}
              </VStack>
            ))}
          </VStack>
        )}
        <Spacer minLength={0} />
        {compactTimeFooter}
      </VStack>
    );
  }

  // Small Widget — Dense Multi-Provider Stack (fits up to 4 core subscriptions cleanly!)
  if (small || simplified) {
    return (
      <VStack alignment="leading" spacing={5} modifiers={rootModifiers}>
        {visibleProviders.length === 0 ? (
          <Text modifiers={[font({ textStyle: "caption" }), foregroundStyle(secondary)]}>
            {text.noLimits}
          </Text>
        ) : (
          <VStack alignment="leading" spacing={visibleProviders.length >= 4 ? 5 : 7}>
            {visibleProviders.map((provider) => {
              const color = providerColor(provider);
              const picked = pickWindows(provider);
              // Small multi-provider defaults to Weekly (falls back to first available window).
              const target =
                period === "session" ? picked.session : (picked.weekly ?? picked.shown[0]);
              const showPeriodHint =
                target !== undefined &&
                (period === "session" || (period === "auto" && target.kind === "session"));
              return (
                <VStack
                  key={provider.driver}
                  alignment="leading"
                  spacing={2}
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
                    <Circle
                      modifiers={[
                        foregroundStyle(monochrome ? primary : color),
                        frame({ width: 5, height: 5 }),
                      ]}
                    />
                    <Text
                      modifiers={[
                        font({ size: 11, weight: "semibold" }),
                        foregroundStyle(primary),
                        lineLimit(1),
                      ]}
                    >
                      {provider.name}
                    </Text>
                    {showPeriodHint ? (
                      <Text
                        modifiers={[
                          font({ size: 9, weight: "medium" }),
                          foregroundStyle(secondary),
                          lineLimit(1),
                        ]}
                      >
                        {shortKindTag(target)}
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
                  {target ? (
                    renderPaceBar(target.remaining, color, livePacePercent(target), 5)
                  ) : (
                    <Capsule
                      modifiers={[
                        foregroundStyle(trackColor),
                        frame({ maxWidth: Infinity }),
                        frame({ height: 5 }),
                      ]}
                    />
                  )}
                </VStack>
              );
            })}
          </VStack>
        )}
        <Spacer minLength={0} />
        {compactTimeFooter}
      </VStack>
    );
  }

  // Medium Widget — 2x2 Matrix for 3-4 Providers (Weekly + 5h neatly aligned, graceful 1-window fallback!)
  const renderMediumCell = (provider: SnapshotProvider) => {
    const color = providerColor(provider);
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
          : [picked.weekly, picked.session].filter((w): w is SnapshotWindow => w !== undefined);
    const effectiveRows = rows.length > 0 ? rows : picked.shown.slice(0, 2);
    const singleWindow = effectiveRows.length === 1 ? effectiveRows[0] : undefined;

    return (
      <VStack
        key={provider.driver}
        alignment="leading"
        spacing={singleWindow ? 4 : 3}
        modifiers={[
          frame({ maxWidth: Infinity, alignment: "leading" }),
          fixedSize({ horizontal: false, vertical: true }),
        ]}
      >
        <HStack spacing={5} alignment="center">
          <Circle
            modifiers={[
              foregroundStyle(monochrome ? primary : color),
              frame({ width: 6, height: 6 }),
            ]}
          />
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
            spacing={2}
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
            {renderPaceBar(singleWindow.remaining, color, livePacePercent(singleWindow), 6)}
            <Text modifiers={[font({ size: 9.5 }), foregroundStyle(secondary), lineLimit(1)]}>
              {singleWindow.shortReset
                ? `${singleWindow.label} · ${singleWindow.shortReset}`
                : singleWindow.label}
            </Text>
          </VStack>
        ) : (
          <VStack alignment="leading" spacing={3}>
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
                    frame({ width: 16, alignment: "leading" }),
                  ]}
                >
                  {shortKindTag(win) || "•"}
                </Text>
                {renderPaceBar(win.remaining, color, livePacePercent(win), 5)}
                <Text
                  modifiers={[
                    font({ size: 10, weight: "semibold" }),
                    monospacedDigit(),
                    lineLimit(1),
                    layoutPriority(1),
                    frame({ width: 29, alignment: "trailing" }),
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
      <VStack alignment="leading" spacing={6} modifiers={rootModifiers}>
        <HStack alignment="top" spacing={14}>
          {topRow.map(renderMediumCell)}
        </HStack>
        <HStack alignment="top" spacing={14}>
          {bottomRow.map(renderMediumCell)}
          {bottomRow.length === 1 ? (
            <VStack modifiers={[frame({ maxWidth: Infinity })]}>
              <Spacer minLength={0} />
            </VStack>
          ) : null}
        </HStack>
        <Spacer minLength={0} />
        {compactTimeFooter}
      </VStack>
    );
  }

  // Spacious Column/Row Layout (Medium with 1-2 providers, Large, ExtraLarge)
  const windowLimit = large ? 2 : 2;
  const renderDetailedProvider = (provider: SnapshotProvider) => {
    const color = providerColor(provider);
    const picked = pickWindows(provider);
    const shown = picked.shown.slice(0, windowLimit);
    return (
      <VStack
        key={provider.driver}
        alignment="leading"
        spacing={large ? 4 : 5}
        modifiers={[
          frame({ maxWidth: Infinity, alignment: "leading" }),
          fixedSize({ horizontal: false, vertical: true }),
        ]}
      >
        <HStack spacing={6} alignment="center">
          <Circle
            modifiers={[
              foregroundStyle(monochrome ? primary : color),
              frame({ width: 7, height: 7 }),
            ]}
          />
          <Text
            modifiers={[
              font({ size: large ? 13 : 14, weight: "bold" }),
              foregroundStyle(primary),
              lineLimit(1),
            ]}
          >
            {provider.name}
          </Text>
          <Spacer minLength={4} />
          {large ? (
            <Text modifiers={[font({ size: 10 }), foregroundStyle(secondary), lineLimit(1)]}>
              {picked.stale
                ? text.refresh
                : provider.detail === text.subscriptionRemaining
                  ? ""
                  : provider.detail}
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
        ) : (
          <VStack alignment="leading" spacing={large ? 4 : 6}>
            {shown.map((win) => (
              <VStack
                key={`${win.kind}:${win.label}`}
                alignment="leading"
                spacing={2}
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
                <HStack spacing={4}>
                  <Text
                    modifiers={[
                      font({ size: 11, weight: "medium" }),
                      foregroundStyle(secondary),
                      lineLimit(1),
                    ]}
                  >
                    {win.label}
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
                {renderPaceBar(win.remaining, color, livePacePercent(win), 6)}
                {!large || visibleProviders.length <= 3 ? (
                  <Text modifiers={[font({ size: 9.5 }), foregroundStyle(secondary), lineLimit(1)]}>
                    {win.reset}
                  </Text>
                ) : null}
              </VStack>
            ))}
          </VStack>
        )}
      </VStack>
    );
  };

  return (
    <VStack alignment="leading" spacing={large ? 8 : 6} modifiers={rootModifiers}>
      {visibleProviders.length === 0 ? (
        <Text modifiers={[font({ textStyle: "caption" }), foregroundStyle(secondary)]}>
          {text.noLimits}
        </Text>
      ) : large ? (
        <VStack alignment="leading" spacing={10}>
          {visibleProviders.map(renderDetailedProvider)}
        </VStack>
      ) : (
        <HStack alignment="top" spacing={16}>
          {visibleProviders.map(renderDetailedProvider)}
        </HStack>
      )}
      <Spacer minLength={0} />
      <Text modifiers={[font({ textStyle: "caption2" }), foregroundStyle(secondary), lineLimit(1)]}>
        {props.checkedAt
          ? text.asOf.replace(
              "{time}",
              new Date(props.checkedAt).toLocaleString(undefined, {
                hour: "numeric",
                minute: "2-digit",
                month: "short",
                day: "numeric",
              }),
            )
          : text.tapToConnect}
      </Text>
    </VStack>
  );
}

export default createWidget("SubscriptionUsage", SubscriptionUsage);
