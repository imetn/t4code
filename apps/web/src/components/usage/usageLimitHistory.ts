import {
  paceRemainingPercent,
  type LimitPool,
  type LimitPoolWindow,
} from "@t3tools/shared/usageLimits";

const HISTORY_STORAGE_KEY = "t3code:usage-limit-history:v1";
const MAX_POINTS_PER_SERIES = 120;
const MAX_SAMPLE_AGE_MS = 8 * 24 * 60 * 60_000;
const MIN_UNCHANGED_SAMPLE_INTERVAL_MS = 10 * 60_000;

export interface LimitHistorySample {
  readonly at: number;
  readonly remaining: number;
}

export type LimitHistoryStore = Record<string, readonly LimitHistorySample[]>;

export interface PaceCurvePoint {
  /** Normalized elapsed time in [0, 1] across the current quota window. */
  readonly x: number;
  /** Remaining quota percentage in [0, 100]. */
  readonly y: number;
}

export interface PaceCurveModel {
  readonly windowStartMs: number;
  readonly resetsAtMs: number;
  readonly elapsedFraction: number;
  readonly remainingPercent: number;
  readonly paceRemainingPercent: number;
  readonly paceDeltaPercent: number;
  readonly actualPoints: readonly PaceCurvePoint[];
  readonly projectedEnd: PaceCurvePoint;
  readonly depletesAtMs: number | null;
}

export function limitWindowVisibilityKey(driver: string, windowId: string): string {
  return `${driver}:${windowId}`;
}

export function toggleHiddenLimitWindow(
  current: readonly string[] | undefined,
  key: string,
): readonly string[] {
  const list = current ?? [];
  return list.includes(key) ? list.filter((entry) => entry !== key) : [...list, key];
}

export function clearHiddenLimitWindowsForDriver(
  current: readonly string[] | undefined,
  driver: string,
): readonly string[] {
  const prefix = `${driver}:`;
  return (current ?? []).filter((entry) => !entry.startsWith(prefix));
}

export function readLimitHistory(): LimitHistoryStore {
  try {
    const raw = globalThis.window?.localStorage?.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const store: Record<string, LimitHistorySample[]> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (!Array.isArray(value)) continue;
      const samples = value.filter(
        (entry): entry is LimitHistorySample =>
          Boolean(entry) &&
          typeof entry === "object" &&
          typeof (entry as LimitHistorySample).at === "number" &&
          Number.isFinite((entry as LimitHistorySample).at) &&
          typeof (entry as LimitHistorySample).remaining === "number" &&
          Number.isFinite((entry as LimitHistorySample).remaining),
      );
      if (samples.length > 0) {
        store[key] = samples;
      }
    }
    return store;
  } catch {
    return {};
  }
}

export function appendLimitHistory(
  store: LimitHistoryStore,
  pools: readonly LimitPool[],
  now: number,
): LimitHistoryStore {
  const cutoff = now - MAX_SAMPLE_AGE_MS;
  let changed = false;
  const next: Record<string, readonly LimitHistorySample[]> = { ...store };

  for (const pool of pools) {
    for (const window of pool.windows) {
      const key = limitWindowVisibilityKey(String(pool.driver), window.id);
      const existing = (next[key] ?? []).filter((point) => point.at >= cutoff && point.at <= now);
      const remaining = Math.max(0, Math.min(100, Math.round(window.remainingPercent)));
      const last = existing.at(-1);
      const shouldAppend =
        last === undefined ||
        last.remaining !== remaining ||
        now - last.at >= MIN_UNCHANGED_SAMPLE_INTERVAL_MS;
      if (!shouldAppend) {
        if (existing.length !== (next[key]?.length ?? 0)) {
          next[key] = existing;
          changed = true;
        }
        continue;
      }
      const updated = [...existing, { at: now, remaining }].slice(-MAX_POINTS_PER_SERIES);
      next[key] = updated;
      changed = true;
    }
  }

  return changed ? next : store;
}

export function recordUsageLimitHistory(
  pools: readonly LimitPool[],
  now: number,
): LimitHistoryStore {
  const current = readLimitHistory();
  const next = appendLimitHistory(current, pools, now);
  if (next !== current) {
    try {
      globalThis.window?.localStorage?.setItem(HISTORY_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Best-effort local history cache; ignore quota errors.
    }
  }
  return next;
}

export function resolveWindowTiming(
  window: LimitPoolWindow,
  now: number,
): {
  readonly windowStartMs: number;
  readonly resetsAtMs: number;
  readonly durationMs: number;
  readonly paceRemaining: number;
} | null {
  const timed = window.members.flatMap((member) => {
    const durationMins = member.window.windowDurationMins;
    const resetsAtMs = member.window.resetsAt ? Date.parse(member.window.resetsAt) : NaN;
    if (!durationMins || durationMins <= 0 || !Number.isFinite(resetsAtMs) || resetsAtMs <= now) {
      return [];
    }
    const paceRemaining = paceRemainingPercent(member.window, now);
    if (paceRemaining === null) return [];
    const durationMs = durationMins * 60_000;
    const windowStartMs = resetsAtMs - durationMs;
    if (now < windowStartMs) return [];
    return [{ windowStartMs, resetsAtMs, durationMs, paceRemaining }];
  });
  if (timed.length === 0) return null;
  const primary = timed[0]!;
  const avgPace = Math.round(
    timed.reduce((sum, entry) => sum + entry.paceRemaining, 0) / timed.length,
  );
  return {
    windowStartMs: primary.windowStartMs,
    resetsAtMs: primary.resetsAtMs,
    durationMs: primary.durationMs,
    paceRemaining: avgPace,
  };
}

export function buildPaceCurveModel(
  window: LimitPoolWindow,
  samples: readonly LimitHistorySample[] | undefined,
  now: number,
): PaceCurveModel | null {
  const timing = resolveWindowTiming(window, now);
  if (!timing) return null;

  const { windowStartMs, resetsAtMs, durationMs, paceRemaining } = timing;
  const elapsedFraction = Math.max(0, Math.min(1, (now - windowStartMs) / durationMs));
  const remaining = Math.max(0, Math.min(100, Math.round(window.remainingPercent)));
  const paceDeltaPercent = remaining - paceRemaining;

  const inWindowSamples = (samples ?? [])
    .filter((sample) => sample.at > windowStartMs && sample.at < now)
    .toSorted((a, b) => a.at - b.at)
    .map((sample) => ({
      x: Math.max(0, Math.min(1, (sample.at - windowStartMs) / durationMs)),
      y: Math.max(0, Math.min(100, sample.remaining)),
    }));

  const actualPoints: PaceCurvePoint[] = [
    { x: 0, y: 100 },
    ...inWindowSamples,
    { x: elapsedFraction, y: remaining },
  ];

  const used = 100 - remaining;
  let projectedEnd: PaceCurvePoint = { x: 1, y: remaining };
  let depletesAtMs: number | null = null;

  if (elapsedFraction >= 0.03 && used > 0) {
    const burnRatePerWindow = used / elapsedFraction;
    const projectedAtReset = 100 - burnRatePerWindow;
    if (projectedAtReset < 0) {
      const zeroFraction = Math.max(elapsedFraction, Math.min(1, 100 / burnRatePerWindow));
      projectedEnd = { x: zeroFraction, y: 0 };
      depletesAtMs = Math.round(windowStartMs + zeroFraction * durationMs);
    } else {
      projectedEnd = { x: 1, y: Math.max(0, Math.round(projectedAtReset)) };
    }
  }

  return {
    windowStartMs,
    resetsAtMs,
    elapsedFraction,
    remainingPercent: remaining,
    paceRemainingPercent: paceRemaining,
    paceDeltaPercent,
    actualPoints,
    projectedEnd,
    depletesAtMs,
  };
}
