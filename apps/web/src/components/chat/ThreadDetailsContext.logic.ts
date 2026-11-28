import type {
  ProviderContextBreakdown,
  ProviderContextCategory,
  ProviderContextCategoryId,
  ProviderContextMcpTool,
  ProviderMcpServerEntry,
} from "@t3tools/contracts";
import type { ContextWindowSnapshot } from "@t3tools/client-runtime/state/context-window";

export type ContextSegmentTone =
  | "messages"
  | "mcp"
  | "systemPrompt"
  | "skills"
  | "memory"
  | "tools"
  | "buffer"
  | "free";

export interface ContextBreakdownSegment {
  readonly key: string;
  readonly id?: ProviderContextCategoryId;
  readonly name: string;
  readonly tokens: number;
  readonly percent: number | null;
  readonly barWidthPercent: number;
  readonly kind: ProviderContextCategory["kind"];
  readonly tone: ContextSegmentTone;
}

export interface GroupedMcpTools {
  readonly serverName: string;
  readonly totalTokens: number | null;
  readonly tools: ReadonlyArray<{
    readonly name: string;
    readonly displayName: string;
    readonly tokens?: number;
    readonly isLoaded?: boolean;
  }>;
}

export function toneForContextCategory(
  category: Pick<ProviderContextCategory, "id" | "name" | "kind">,
): ContextSegmentTone {
  if (category.kind === "free") return "free";
  if (category.kind === "buffer") return "buffer";
  switch (category.id) {
    case "messages":
    case "input":
      return "messages";
    case "mcp_tools":
    case "mcp_tools_deferred":
      return "mcp";
    case "system_prompt":
      return "systemPrompt";
    case "skills":
    case "custom_agents":
      return "skills";
    case "memory_files":
    case "cached_input":
      return "memory";
    case "system_tools":
    case "system_tools_deferred":
    case "mcp_instructions":
    case "output":
    case "reasoning":
    case "other":
      return "tools";
    case "autocompact_buffer":
    case "compact_buffer":
      return "buffer";
    case "free_space":
      return "free";
    default: {
      const lower = category.name.toLowerCase();
      if (lower.includes("message") || lower.includes("input")) return "messages";
      if (lower.includes("mcp")) return "mcp";
      if (lower.includes("system prompt")) return "systemPrompt";
      if (lower.includes("skill") || lower.includes("agent")) return "skills";
      if (lower.includes("memory")) return "memory";
      if (lower.includes("buffer") || lower.includes("compact")) return "buffer";
      if (lower.includes("free")) return "free";
      return "tools";
    }
  }
}

export function buildContextBreakdownView(
  breakdown: ProviderContextBreakdown | null,
  fallbackUsage: ContextWindowSnapshot | null,
): {
  readonly totalTokens: number;
  readonly maxTokens: number | null;
  readonly usedPercent: number | null;
  readonly autoCompactThreshold: number | null;
  readonly autoCompactTickPercent: number | null;
  readonly barSegments: ReadonlyArray<ContextBreakdownSegment>;
  readonly activeRows: ReadonlyArray<ContextBreakdownSegment>;
  readonly deferredRows: ReadonlyArray<ContextBreakdownSegment>;
  readonly groupedMcpTools: ReadonlyArray<GroupedMcpTools>;
} | null {
  const totalTokens = breakdown?.totalTokens ?? fallbackUsage?.usedTokens ?? null;
  const maxTokens =
    (breakdown?.maxTokens != null && breakdown.maxTokens > 0 ? breakdown.maxTokens : null) ??
    (fallbackUsage?.maxTokens != null && fallbackUsage.maxTokens > 0
      ? fallbackUsage.maxTokens
      : null);

  if (
    totalTokens === null &&
    (breakdown === null ||
      (breakdown.categories.length === 0 &&
        breakdown.memoryFiles.length === 0 &&
        breakdown.skills.length === 0 &&
        breakdown.mcpTools.length === 0))
  ) {
    return null;
  }

  const effectiveTotal = totalTokens ?? 0;
  const usedPercent =
    breakdown?.percentage != null
      ? Math.round(Math.max(0, Math.min(100, breakdown.percentage)))
      : maxTokens !== null && maxTokens > 0
        ? Math.round(Math.max(0, Math.min(100, (effectiveTotal / maxTokens) * 100)))
        : fallbackUsage?.usedPercentage != null
          ? Math.round(Math.max(0, Math.min(100, fallbackUsage.usedPercentage)))
          : null;

  const autoCompactThreshold =
    breakdown?.autoCompactThreshold ?? fallbackUsage?.autoCompactThreshold ?? null;
  const autoCompactTickPercent =
    maxTokens !== null &&
    autoCompactThreshold !== null &&
    autoCompactThreshold > 0 &&
    autoCompactThreshold < maxTokens
      ? (autoCompactThreshold / maxTokens) * 100
      : null;

  const rawCategories = breakdown?.categories ?? [];
  const denominator =
    maxTokens ??
    Math.max(
      effectiveTotal,
      rawCategories
        .filter((cat) => cat.kind !== "deferred")
        .reduce((sum, cat) => sum + cat.tokens, 0),
    );

  const activeRows: ContextBreakdownSegment[] = [];
  const deferredRows: ContextBreakdownSegment[] = [];
  const barSegments: ContextBreakdownSegment[] = [];

  for (let index = 0; index < rawCategories.length; index++) {
    const cat = rawCategories[index]!;
    if (cat.tokens <= 0 && cat.kind !== "free") continue;
    const percent =
      denominator > 0 && cat.kind !== "deferred"
        ? Math.round((cat.tokens / denominator) * 1000) / 10
        : null;
    const segment: ContextBreakdownSegment = {
      key: `${cat.id ?? cat.name}:${index}`,
      ...(cat.id === undefined ? {} : { id: cat.id }),
      name: cat.name,
      tokens: cat.tokens,
      percent,
      barWidthPercent:
        denominator > 0 ? Math.max(0, Math.min(100, (cat.tokens / denominator) * 100)) : 0,
      kind: cat.kind,
      tone: toneForContextCategory(cat),
    };
    if (cat.kind === "deferred") {
      if (cat.tokens > 0) deferredRows.push(segment);
    } else {
      if (cat.tokens > 0) activeRows.push(segment);
      if (cat.kind !== "free" && cat.tokens > 0) {
        barSegments.push(segment);
      }
    }
  }

  // Clamp segmented bar total width to 100% when over limit.
  const barSum = barSegments.reduce((sum, seg) => sum + seg.barWidthPercent, 0);
  const normalizedBarSegments =
    barSum > 100
      ? barSegments.map((seg) => ({
          ...seg,
          barWidthPercent: (seg.barWidthPercent / barSum) * 100,
        }))
      : barSegments;

  const groupedMcpTools = groupMcpToolsByServer(breakdown?.mcpTools ?? []);

  return {
    totalTokens: effectiveTotal,
    maxTokens,
    usedPercent,
    autoCompactThreshold,
    autoCompactTickPercent,
    barSegments: normalizedBarSegments,
    activeRows,
    deferredRows,
    groupedMcpTools,
  };
}

export function stripMcpToolWirePrefix(toolName: string, serverName: string): string {
  const underscoreServer = serverName.replace(/[^a-zA-Z0-9_]/g, "_");
  const hyphenSafeServer = serverName.replace(/[^a-zA-Z0-9_-]/g, "_");
  for (const prefix of [
    `mcp__${serverName}__`,
    `mcp__${hyphenSafeServer}__`,
    `mcp__${underscoreServer}__`,
  ]) {
    if (toolName.startsWith(prefix) && toolName.length > prefix.length) {
      return toolName.slice(prefix.length);
    }
  }
  return toolName;
}

export function groupMcpToolsByServer(
  tools: ReadonlyArray<ProviderContextMcpTool>,
): ReadonlyArray<GroupedMcpTools> {
  if (tools.length === 0) return [];
  const byServer = new Map<string, ProviderContextMcpTool[]>();
  for (const tool of tools) {
    const list = byServer.get(tool.serverName);
    if (list) {
      list.push(tool);
    } else {
      byServer.set(tool.serverName, [tool]);
    }
  }
  return [...byServer.entries()]
    .map(([serverName, entries]) => {
      const hasAnyTokens = entries.some((entry) => entry.tokens !== undefined);
      const totalTokens = hasAnyTokens
        ? entries.reduce((sum, entry) => sum + (entry.tokens ?? 0), 0)
        : null;
      const sorted = [...entries].toSorted((a, b) => (b.tokens ?? 0) - (a.tokens ?? 0));
      return {
        serverName,
        totalTokens,
        tools: sorted.map((entry) => ({
          name: entry.name,
          displayName: stripMcpToolWirePrefix(entry.name, serverName),
          ...(entry.tokens === undefined ? {} : { tokens: entry.tokens }),
          ...(entry.isLoaded === undefined ? {} : { isLoaded: entry.isLoaded }),
        })),
      };
    })
    .toSorted(
      (a, b) => (b.totalTokens ?? 0) - (a.totalTokens ?? 0) || b.tools.length - a.tools.length,
    );
}

export function formatCompactFilePath(filePath: string, workspacePath: string | null): string {
  const normalized = filePath.replace(/\\/g, "/");
  if (workspacePath) {
    const normalizedRoot = workspacePath.replace(/\\/g, "/").replace(/\/+$/, "");
    if (normalized.startsWith(`${normalizedRoot}/`)) {
      return normalized.slice(normalizedRoot.length + 1);
    }
  }
  return normalized.replace(/^\/(?:Users|home)\/[^/]+\//, "~/");
}

export function summarizeMcpConnectors(servers: ReadonlyArray<ProviderMcpServerEntry>): {
  readonly total: number;
  readonly connected: number;
  readonly attentionCount: number;
  readonly failedCount: number;
  readonly needsAuthCount: number;
  readonly pendingCount: number;
  readonly disabledCount: number;
} {
  let connected = 0;
  let failedCount = 0;
  let needsAuthCount = 0;
  let pendingCount = 0;
  let disabledCount = 0;
  for (const server of servers) {
    switch (server.status) {
      case "connected":
        connected++;
        break;
      case "failed":
        failedCount++;
        break;
      case "needs-auth":
        needsAuthCount++;
        break;
      case "pending":
        pendingCount++;
        break;
      case "disabled":
        disabledCount++;
        break;
    }
  }
  return {
    total: servers.length,
    connected,
    attentionCount: failedCount + needsAuthCount,
    failedCount,
    needsAuthCount,
    pendingCount,
    disabledCount,
  };
}
