import { normalizeProviderAccentColor } from "@t3tools/client-runtime/state/provider-instance-display";
import {
  collectLimitAccounts,
  collectLimitPools,
  displayLimitWindows,
  orderLimitPools,
  paceRemainingPercent,
  remainingPercent,
  type LimitAccount,
  type LimitPoolWindow,
  type LimitPresentations,
} from "@t3tools/shared/usageLimits";
import { msg } from "gt-react-native";

import { m, type MessageResolver } from "../i18n/messages";

import { providerColors } from "../features/usage/providerColors";
import type { WidgetTheme } from "./widgetTheme";

/**
 * Copy for the widget, which runs without the app's catalogs. `{name}` tokens are filled in by the
 * widget; `moreInApp` is keyed by count.
 */
export interface SubscriptionUsageText {
  refresh: string;
  noSessionLimit: string;
  noWeeklyLimit: string;
  subscriptionRemaining: string;
  percentLeft: string;
  windowPercentLeft: string;
  left: string;
  notApplicable: string;
  openApp: string;
  noLimits: string;
  asOf: string;
  tapToConnect: string;
  shortWeekly: string;
  shortSession: string;
  providerAccessibility: string;
  windowAccessibility: string;
  moreInApp: Record<string, string>;
}

export interface WidgetLimitAccount {
  name: string;
  color?: string;
  /** Absent when this account does not report the window. */
  remaining?: number;
  refill?: number;
  resetsAt?: number;
  reset?: string;
  durationMs?: number;
}

export interface SubscriptionUsageSnapshot {
  theme?: WidgetTheme;
  url?: string;
  text?: SubscriptionUsageText;
  checkedAt: number;
  providers: Array<{
    driver: string;
    name: string;
    colors?: { light: string; dark: string };
    detail: string;
    windows: Array<{
      id?: string;
      kind?: string;
      label: string;
      remaining: number;
      reset: string;
      shortReset?: string;
      paceTimeLeft?: number;
      resetsAt?: number;
      durationMs?: number;
      accounts?: WidgetLimitAccount[];
    }>;
    expiresAt: number;
    totalWindows: number;
  }>;
}

export interface SubscriptionUsageSnapshotOptions {
  readonly providerOrder?: readonly string[];
  readonly antigravityOwnModelsOnly?: boolean;
}

// Core subscription providers prioritized in the widget when the user has not customized order.
const CORE_WIDGET_DRIVERS = ["codex", "claudeAgent", "antigravity", "cursor", "grok"] as const;

const WIDGET_PROVIDER_NAMES: Readonly<Record<string, string>> = {
  codex: "Codex",
  claudeAgent: "Claude",
  antigravity: "Antigravity",
  cursor: "Cursor",
  grok: "Grok",
  opencode: "OpenCode",
  pi: "Pi",
  muse: "Muse",
};

function widgetProviderColorKind(driver: string): keyof ReturnType<typeof providerColors> {
  switch (driver) {
    case "claudeAgent":
      return "claude";
    case "codex":
    case "grok":
    case "cursor":
    case "opencode":
    case "antigravity":
    case "pi":
    case "muse":
      return driver;
    default:
      return "codex";
  }
}

// Snapshots expire after 15 minutes; suspended refresh requires a separate authenticated transport.
const SNAPSHOT_MAX_AGE = 15 * 60_000;
export const WIDGET_REFRESH_INTERVAL = 5 * 60_000;

export function createWidgetRefresher<Id>(refresh: (id: Id) => Promise<unknown>) {
  const attempted = new Map<Id, number>();
  const pending = new Set<Id>();
  return async (connected: readonly Id[], now: number) => {
    await Promise.allSettled(
      connected.map(async (id) => {
        if (pending.has(id) || now - (attempted.get(id) ?? -Infinity) < WIDGET_REFRESH_INTERVAL)
          return;
        attempted.set(id, now);
        pending.add(id);
        try {
          await refresh(id);
        } finally {
          pending.delete(id);
        }
      }),
    );
  };
}

// Widget snapshots must not persist account emails.
function accountName(account: LimitAccount, resolve: MessageResolver) {
  if (account.displayName && !account.displayName.includes("@")) return account.displayName;
  const email = account.email ?? account.displayName;
  if (!email?.includes("@"))
    return resolve(msg("Account", { $context: "an unnamed provider account" }));
  const [local = "", domain = ""] = email.split("@");
  return `${local[0] ?? ""}${domain[0] ?? ""}`.toUpperCase();
}

function clockLabel(at: number, from: number) {
  const time = { hour: "numeric", minute: "2-digit" } as const;
  if (new Date(at).toDateString() === new Date(from).toDateString())
    return new Date(at).toLocaleTimeString(undefined, time);
  return new Date(at).toLocaleString(
    undefined,
    at - from < 6 * 86_400_000 ? { weekday: "short", ...time } : { month: "short", day: "numeric" },
  );
}

function widgetAccounts(window: LimitPoolWindow, resolve: MessageResolver): WidgetLimitAccount[] {
  const seen = new Map<string, number>();
  return window.columns.map((column) => {
    // Redacted initials can collide, and the widget keys segments by name.
    const base = accountName(column.account, resolve);
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    const color = normalizeProviderAccentColor(column.account.accentColor);
    // expo-widgets cannot convert an explicit undefined into a Kotlin value.
    const account = { name: count > 1 ? `${base}${count}` : base, ...(color && { color }) };
    if (column.window === null) return account;
    const checkedAt = Date.parse(column.account.limits.checkedAt);
    const resetsAt = column.window.resetsAt ? Date.parse(column.window.resetsAt) : NaN;
    // A reset at or before the observation already happened.
    const reset = resetsAt > checkedAt;
    return {
      ...account,
      remaining: remainingPercent(column.window),
      refill: reset ? column.refillPercent : 0,
      ...(reset && {
        resetsAt,
        reset: clockLabel(resetsAt, checkedAt),
      }),
      ...(column.window.windowDurationMins && {
        durationMs: column.window.windowDurationMins * 60_000,
      }),
    };
  });
}

function windowPaceTiming(window: LimitPoolWindow) {
  const timed = window.members.flatMap((member) => {
    const checkedAt = Date.parse(member.account.limits.checkedAt);
    const resetsAt = member.window.resetsAt ? Date.parse(member.window.resetsAt) : NaN;
    const durationMins = member.window.windowDurationMins;
    if (!Number.isFinite(checkedAt) || !Number.isFinite(resetsAt) || !durationMins) return [];
    if (resetsAt <= checkedAt) return [];
    const paceTimeLeft = paceRemainingPercent(member.window, checkedAt);
    if (paceTimeLeft === null) return [];
    return [{ paceTimeLeft, resetsAt, durationMs: durationMins * 60_000 }];
  });
  if (timed.length === 0) return {};
  const paceTimeLeft = Math.round(
    timed.reduce((sum, entry) => sum + entry.paceTimeLeft, 0) / timed.length,
  );
  if (timed.length === 1) {
    return {
      paceTimeLeft,
      resetsAt: timed[0]!.resetsAt,
      durationMs: timed[0]!.durationMs,
    };
  }
  return { paceTimeLeft };
}

// A reset at or before its account's observation already happened, so it cannot expire the snapshot.
const isUpcoming = (reset: LimitPoolWindow["resets"][number]) =>
  reset.at > Date.parse(reset.member.account.limits.checkedAt);

const resetTime = (at: number) =>
  new Date(at).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

function subscriptionUsageText(
  resolve: MessageResolver,
  maxHiddenWindows: number,
): SubscriptionUsageText {
  return {
    refresh: resolve(msg("Open {app} to refresh", { app: "T4" })),
    noSessionLimit: resolve(msg("No session limit reported")),
    noWeeklyLimit: resolve(msg("No weekly limit reported")),
    subscriptionRemaining: resolve(msg("Subscription remaining")),
    percentLeft: resolve(msg("{remaining}% left", { remaining: "{remaining}" })),
    windowPercentLeft: resolve(
      msg("{window} · {remaining}% left", { window: "{window}", remaining: "{remaining}" }),
    ),
    left: resolve(msg("left", { $context: "follows a bold percentage, as in 40% left" })),
    notApplicable: resolve(msg("N/A", { $context: "no usage limit for the chosen period" })),
    openApp: resolve(msg("Open {app}", { app: "T4" })),
    noLimits: resolve(msg("No subscription limits available.")),
    asOf: resolve(msg("As of {time}", { time: "{time}" })),
    tapToConnect: resolve(msg("Tap to connect in {app}", { app: "T4" })),
    shortWeekly: resolve(msg("W", { $context: "ultra-short weekly badge in compact widget row" })),
    shortSession: resolve(
      msg("5h", { $context: "ultra-short 5-hour badge in compact widget row" }),
    ),
    providerAccessibility: resolve(
      // oxlint-disable-next-line t3code/no-untranslated-copy -- placeholders the widget fills in
      msg("{provider}. {detail}.", { provider: "{provider}", detail: "{detail}" }),
    ),
    windowAccessibility: resolve(
      msg("{provider}, {window}, {remaining} percent remaining. {reset}. {detail}.", {
        provider: "{provider}",
        window: "{window}",
        remaining: "{remaining}",
        reset: "{reset}",
        // oxlint-disable-next-line t3code/no-untranslated-copy -- placeholders the widget fills in
        detail: "{detail}",
      }),
    ),
    moreInApp: Object.fromEntries(
      Array.from({ length: maxHiddenWindows }, (_, index) => [
        String(index + 1),
        resolve(
          msg("{count, plural, one {{count} more in {app}} other {{count} more in {app}}}", {
            count: index + 1,
            app: "T4",
          }),
        ),
      ]),
    ),
  };
}

function resolveWidgetDrivers(
  accounts: readonly LimitAccount[],
  configuredDrivers: ReadonlySet<string>,
  providerOrder: readonly string[] | undefined,
): readonly string[] {
  const activeDrivers = new Set<string>();
  for (const driver of CORE_WIDGET_DRIVERS) {
    if (configuredDrivers.has(driver) || accounts.some((account) => account.driver === driver)) {
      activeDrivers.add(driver);
    }
  }
  for (const account of accounts) {
    activeDrivers.add(String(account.driver));
  }
  const ordered = orderLimitPools(
    [...activeDrivers].map((driver) => ({ driver })),
    providerOrder && providerOrder.length > 0 ? providerOrder : CORE_WIDGET_DRIVERS,
  );
  const driversWithAccounts = new Set(accounts.map((account) => String(account.driver)));
  // Prioritize providers that actually have live quota pools so empty ones do not evict them from small widgets.
  return [
    ...ordered.filter((entry) => driversWithAccounts.has(entry.driver)),
    ...ordered.filter((entry) => !driversWithAccounts.has(entry.driver)),
  ].map((entry) => entry.driver);
}

function subscriptionUsageProps(
  accounts: readonly LimitAccount[],
  now: number,
  configuredDrivers: ReadonlySet<string>,
  maxWindowsPerProvider: number,
  resolve: MessageResolver,
  options: SubscriptionUsageSnapshotOptions,
): SubscriptionUsageSnapshot {
  const pools = collectLimitPools(accounts, now);
  const drivers = resolveWidgetDrivers(accounts, configuredDrivers, options.providerOrder);
  const driverSet = new Set(drivers);
  const checked = accounts
    .filter((account) => driverSet.has(String(account.driver)))
    .map((account) => Date.parse(account.limits.checkedAt));
  const antigravityOwnModelsOnly = options.antigravityOwnModelsOnly ?? true;
  return {
    checkedAt: checked.length > 0 && checked.every(Number.isFinite) ? Math.min(...checked) : 0,
    providers: drivers.map((driver) => {
      const pool = pools.find((candidate) => String(candidate.driver) === driver);
      const name = WIDGET_PROVIDER_NAMES[driver] ?? driver;
      const kind = widgetProviderColorKind(driver);
      const colors = { light: providerColors("light")[kind], dark: providerColors("dark")[kind] };
      if (!pool)
        return {
          driver,
          name,
          colors,
          detail: resolve(msg("No limits available")),
          windows: [],
          expiresAt: 0,
          totalWindows: 0,
        };
      const visibleWindows = displayLimitWindows(pool, { antigravityOwnModelsOnly });
      const checkedAt = Math.min(...pool.accounts.map((a) => Date.parse(a.limits.checkedAt)));
      const expiresAt = Math.min(
        checkedAt + SNAPSHOT_MAX_AGE,
        ...visibleWindows.flatMap((window) =>
          window.resets.filter(isUpcoming).map((reset) => reset.at),
        ),
      );
      const fresh = Number.isFinite(expiresAt) && expiresAt > now;
      // Preserve displayLimitWindows priority (e.g. primary Gemini before Argon/Carbon) for the
      // primary session/weekly picks, then order the remaining windows by most constrained first.
      const preserveModelPriority = driver === "antigravity" || driver === "cursor";
      const primaryWeekly = visibleWindows.find((window) => window.kind === "weekly");
      const primarySession = visibleWindows.find((window) => window.kind === "session");
      const sortedByRemaining = [...visibleWindows].sort(
        (a, b) => a.remainingPercent - b.remainingPercent,
      );
      const selectedWindows = preserveModelPriority
        ? [...new Set([primaryWeekly, primarySession, ...visibleWindows])]
            .filter((window) => window !== undefined)
            .slice(0, maxWindowsPerProvider)
        : [...new Set([primarySession, primaryWeekly, ...sortedByRemaining])]
            .filter((window) => window !== undefined)
            .slice(0, maxWindowsPerProvider)
            .sort((a, b) => a.remainingPercent - b.remainingPercent);
      return {
        driver,
        name,
        colors,
        detail: !fresh
          ? resolve(msg("Open {app} to refresh", { app: "T4" }))
          : pool.accounts.length > 1
            ? resolve(
                msg(
                  "{count, plural, one {{count} account · pooled} other {{count} accounts · pooled}}",
                  {
                    count: pool.accounts.length,
                  },
                ),
              )
            : resolve(msg("Subscription remaining")),
        expiresAt: fresh ? expiresAt : 0,
        totalWindows: fresh ? visibleWindows.length : 0,
        windows: fresh
          ? selectedWindows.map((window) => {
              const firstReset = window.resets[0];
              const upcoming = firstReset !== undefined && isUpcoming(firstReset);
              const pace = windowPaceTiming(window);
              return {
                id: window.id,
                kind: window.kind,
                label: window.label,
                remaining: Math.round(window.remainingPercent),
                reset: firstReset
                  ? upcoming
                    ? resolve(msg("Next reset {time}", { time: resetTime(firstReset.at) }))
                    : resolve(msg("Reset {time}", { time: resetTime(firstReset.at) }))
                  : resolve(msg("Reset time unavailable")),
                ...(firstReset && upcoming && { shortReset: clockLabel(firstReset.at, checkedAt) }),
                ...pace,
                accounts: widgetAccounts(window, resolve),
              };
            })
          : [],
      };
    }),
  };
}

export function buildSubscriptionUsageSnapshot(
  presentations: LimitPresentations,
  url: string,
  maxWindowsPerProvider = 6,
  resolve: MessageResolver = m,
  options: SubscriptionUsageSnapshotOptions = {},
): SubscriptionUsageSnapshot {
  const configuredDrivers = new Set(
    [...presentations.values()].flatMap((presentation) =>
      (presentation.serverConfig?.providers ?? [])
        // Servers report default-enabled drivers even when their CLI is missing.
        .filter(
          (provider) =>
            provider.enabled &&
            provider.installed &&
            provider.usageLimits?.unavailable?.reason !== "unsupported",
        )
        .map((provider) => String(provider.driver)),
    ),
  );
  const props = subscriptionUsageProps(
    collectLimitAccounts(presentations),
    0,
    configuredDrivers,
    maxWindowsPerProvider,
    resolve,
    options,
  );
  return {
    ...props,
    url,
    // The Android widget counts hidden rows across providers, a note row included.
    text: subscriptionUsageText(
      resolve,
      props.providers.reduce((sum, provider) => sum + Math.max(1, provider.totalWindows), 0),
    ),
  };
}

export function subscriptionUsageTimeline(snapshot: SubscriptionUsageSnapshot, now: number) {
  const deadlines = [...new Set(snapshot.providers.map((p) => p.expiresAt))]
    .filter((deadline) => deadline > now)
    .sort((a, b) => a - b);
  return [now, ...deadlines].map((date) => ({
    date: new Date(date),
    props: {
      ...snapshot,
      providers: snapshot.providers.map((provider) =>
        provider.windows.length > 0 && provider.expiresAt <= date
          ? {
              ...provider,
              detail: snapshot.text?.refresh ?? m(msg("Open {app} to refresh", { app: "T4" })),
              windows: [],
              totalWindows: 0,
            }
          : provider,
      ),
    },
  }));
}
