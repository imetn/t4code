import type {
  ProviderContextBreakdown,
  ProviderContextCategoryId,
  ScopedThreadRef,
} from "@t3tools/contracts";
import type { ContextWindowSnapshot } from "@t3tools/client-runtime/state/context-window";
import { msg, T, useGT, useLocale, useMessages, Var } from "gt-react";
import {
  BookOpenIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  FileTextIcon,
  RefreshCwIcon,
  WrenchIcon,
} from "lucide-react";
import { useState } from "react";

import { formatContextWindowTokens } from "../../lib/contextWindow";
import { cn } from "../../lib/utils";
import { useRightPanelStore } from "../../rightPanelStore";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { formatContextWindowCompactionMessage } from "./compaction.logic";
import {
  buildContextBreakdownView,
  formatCompactFilePath,
  type ContextBreakdownSegment,
  type ContextSegmentTone,
} from "./ThreadDetailsContext.logic";
import { ThreadDetailsSection } from "./ThreadDetailsSection";

const TONE_DOT_CLASS: Record<ContextSegmentTone, string> = {
  messages: "bg-blue-500",
  mcp: "bg-amber-500",
  systemPrompt: "bg-emerald-500",
  skills: "bg-violet-500",
  memory: "bg-sky-500",
  tools: "bg-zinc-400 dark:bg-zinc-500",
  buffer: "bg-muted-foreground/35",
  free: "bg-muted-foreground/15",
};

const CATEGORY_LABELS: Partial<Record<ProviderContextCategoryId, string>> = {
  system_prompt: msg("System prompt"),
  system_tools: msg("System tools"),
  mcp_tools: msg("MCP tools"),
  mcp_instructions: msg("MCP server instructions"),
  mcp_tools_deferred: msg("MCP tools (deferred)"),
  system_tools_deferred: msg("System tools (deferred)"),
  custom_agents: msg("Custom agents"),
  memory_files: msg("Memory files"),
  skills: msg("Skills"),
  messages: msg("Messages"),
  input: msg("Input"),
  cached_input: msg("Cached input"),
  output: msg("Output"),
  reasoning: msg("Reasoning"),
  autocompact_buffer: msg("Autocompact buffer"),
  compact_buffer: msg("Compact buffer"),
  free_space: msg("Free space"),
};

function categoryDisplayName(
  segment: ContextBreakdownSegment,
  resolve: ReturnType<typeof useMessages>,
): string {
  if (segment.id !== undefined) {
    const known = CATEGORY_LABELS[segment.id];
    if (known !== undefined) return resolve(known);
  }
  return segment.name;
}

export function ThreadDetailsContext({
  threadRef,
  usage,
  breakdown,
  workspacePath,
  loading,
  onRefresh,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly usage: ContextWindowSnapshot | null;
  readonly breakdown: ProviderContextBreakdown | null;
  readonly workspacePath: string | null;
  readonly loading: boolean;
  readonly onRefresh?: () => void;
}) {
  const gt = useGT();
  const m = useMessages();
  const locale = useLocale();
  const [expanded, setExpanded] = useState(false);
  const [mcpToolsOpen, setMcpToolsOpen] = useState(false);
  const [memoryFilesOpen, setMemoryFilesOpen] = useState(false);
  const [skillsOpen, setSkillsOpen] = useState(false);

  const view = buildContextBreakdownView(breakdown, usage);
  if (view === null) return null;

  const usedTokensText = formatContextWindowTokens(view.totalTokens);
  const maxTokensText = view.maxTokens !== null ? formatContextWindowTokens(view.maxTokens) : null;
  const compactValue =
    maxTokensText !== null ? `${usedTokensText} / ${maxTokensText}` : usedTokensText;
  const tone =
    view.usedPercent === null
      ? null
      : view.usedPercent >= 90
        ? "error"
        : view.usedPercent >= 80
          ? "warning"
          : null;

  const mcpTools = breakdown?.mcpTools ?? [];
  const memoryFiles = breakdown?.memoryFiles ?? [];
  const skills = breakdown?.skills ?? [];
  const hasExpandableDetails =
    view.activeRows.length > 0 ||
    view.deferredRows.length > 0 ||
    mcpTools.length > 0 ||
    memoryFiles.length > 0 ||
    skills.length > 0;

  const openFile = (filePath: string) => {
    useRightPanelStore.getState().openFile(threadRef, filePath);
  };

  const renderProgressBar = (heightClass: string) => (
    <span
      className={cn(
        "relative flex w-full overflow-hidden rounded-full bg-muted-foreground/20 dark:bg-muted-foreground/18",
        heightClass,
      )}
    >
      {view.barSegments.length > 0 ? (
        view.barSegments.map((segment) => (
          <span
            key={segment.key}
            className={cn("h-full shrink-0", TONE_DOT_CLASS[segment.tone])}
            style={{ width: `${segment.barWidthPercent}%` }}
          />
        ))
      ) : view.usedPercent !== null && view.usedPercent > 0 ? (
        <span
          className={cn(
            "h-full rounded-full",
            tone === "error"
              ? "bg-error"
              : tone === "warning"
                ? "bg-warning"
                : "bg-muted-foreground",
          )}
          style={{ width: `max(${view.usedPercent}%, 6px)` }}
        />
      ) : null}
      {view.autoCompactTickPercent !== null ? (
        <span
          aria-hidden
          className="absolute inset-y-0 w-px -translate-x-1/2 bg-foreground/75"
          style={{ left: `clamp(0.5px, ${view.autoCompactTickPercent}%, calc(100% - 0.5px))` }}
        />
      ) : null}
    </span>
  );

  return (
    <ThreadDetailsSection
      headingId="thread-details-context-heading"
      title={gt("Context window")}
      showHeading={false}
    >
      <div className="flex flex-col text-xs">
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-expanded={hasExpandableDetails ? expanded : undefined}
                aria-label={
                  view.usedPercent !== null
                    ? gt("Context: {used}% used", { used: view.usedPercent })
                    : gt("Context: {usedTokens} tokens used", { usedTokens: usedTokensText })
                }
                disabled={!hasExpandableDetails}
                onClick={() => {
                  if (!hasExpandableDetails) return;
                  const next = !expanded;
                  setExpanded(next);
                  if (next) onRefresh?.();
                }}
                className={cn(
                  "grid h-7 w-full grid-cols-[auto_minmax(2.5rem,1fr)_auto_auto] items-center gap-x-2.5 rounded-lg px-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  hasExpandableDetails
                    ? "cursor-pointer hover:bg-black/[0.035] dark:hover:bg-white/[0.08]"
                    : "cursor-default",
                )}
              />
            }
          >
            <span className="truncate text-muted-foreground">
              {gt("Context", { $context: "context window row label" })}
            </span>
            {renderProgressBar("h-1")}
            <span
              className={cn(
                "text-end font-medium tabular-nums",
                tone === "error"
                  ? "text-error-foreground"
                  : tone === "warning"
                    ? "text-warning-foreground"
                    : "text-foreground/80",
              )}
            >
              {view.usedPercent !== null ? `${view.usedPercent}%` : usedTokensText}
            </span>
            {hasExpandableDetails ? (
              expanded ? (
                <ChevronUpIcon className="size-3.5 text-muted-foreground" aria-hidden />
              ) : (
                <ChevronDownIcon className="size-3.5 text-muted-foreground" aria-hidden />
              )
            ) : (
              <span className="size-0" />
            )}
          </TooltipTrigger>
          <TooltipPopup side="left" sideOffset={16}>
            <div className="flex flex-col gap-0.5">
              <span className="text-foreground">
                {view.usedPercent !== null
                  ? gt("Context: {used}% used", { used: view.usedPercent })
                  : gt("Context: {usedTokens} tokens used", { usedTokens: usedTokensText })}
              </span>
              {view.maxTokens !== null ? (
                <span className="text-muted-foreground">
                  {gt("{used} of {max} tokens", {
                    used: view.totalTokens.toLocaleString(locale),
                    max: view.maxTokens.toLocaleString(locale),
                  })}
                </span>
              ) : null}
              {view.autoCompactThreshold !== null && view.autoCompactThreshold > 0 ? (
                <span className="text-muted-foreground">
                  {formatContextWindowCompactionMessage(view.autoCompactThreshold, m)}
                </span>
              ) : null}
              {hasExpandableDetails ? (
                <span className="text-muted-foreground">
                  {expanded ? gt("Click to collapse breakdown") : gt("Click to inspect breakdown")}
                </span>
              ) : null}
            </div>
          </TooltipPopup>
        </Tooltip>

        {expanded && hasExpandableDetails ? (
          <div
            data-thread-details-context-overflow
            className="mt-1.5 flex flex-col gap-2.5 px-2.5 pb-1"
          >
            <div className="flex items-center justify-between gap-2 text-2xs text-muted-foreground">
              <span className="font-medium text-foreground/85 tabular-nums">
                {view.usedPercent !== null
                  ? gt("{used}% used", { used: view.usedPercent })
                  : gt("{usedTokens} tokens used", { usedTokens: usedTokensText })}
              </span>
              <div className="flex items-center gap-1.5">
                <span className="tabular-nums">{compactValue}</span>
                {onRefresh ? (
                  <button
                    type="button"
                    aria-label={gt("Refresh context breakdown")}
                    disabled={loading}
                    onClick={onRefresh}
                    className="inline-flex size-5 items-center justify-center rounded-md text-muted-foreground hover:bg-black/[0.04] hover:text-foreground disabled:opacity-50 dark:hover:bg-white/[0.08]"
                  >
                    <RefreshCwIcon
                      className={cn("size-3", loading && "animate-spin")}
                      aria-hidden
                    />
                  </button>
                ) : null}
              </div>
            </div>

            {renderProgressBar("h-1.5")}

            {view.activeRows.length > 0 ? (
              <div className="flex flex-col gap-1">
                {view.activeRows.map((segment) => (
                  <div
                    key={segment.key}
                    className="grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-x-2 text-2xs leading-4"
                  >
                    <span
                      aria-hidden
                      className={cn("size-2 shrink-0 rounded-xs", TONE_DOT_CLASS[segment.tone])}
                    />
                    <span className="truncate text-muted-foreground">
                      {categoryDisplayName(segment, m)}
                    </span>
                    <span className="text-end font-medium text-foreground/80 tabular-nums">
                      {formatContextWindowTokens(segment.tokens)}
                    </span>
                    <span className="w-10 text-end text-muted-foreground tabular-nums">
                      {segment.percent !== null ? `${segment.percent.toFixed(1)}%` : "-"}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}

            {view.deferredRows.length > 0 ? (
              <div className="flex flex-col gap-1 border-t border-border/50 pt-1.5">
                {view.deferredRows.map((segment) => (
                  <div
                    key={segment.key}
                    className="grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-x-2 text-2xs leading-4 text-muted-foreground"
                  >
                    <span
                      aria-hidden
                      className="size-2 shrink-0 rounded-xs bg-muted-foreground/30"
                    />
                    <span className="truncate">{categoryDisplayName(segment, m)}</span>
                    <span className="text-end tabular-nums">
                      {formatContextWindowTokens(segment.tokens)}
                    </span>
                    <span className="w-10 text-end tabular-nums">-</span>
                  </div>
                ))}
              </div>
            ) : null}

            {mcpTools.length > 0 || memoryFiles.length > 0 || skills.length > 0 ? (
              <div className="flex flex-col gap-0.5 border-t border-border/50 pt-1.5">
                {mcpTools.length > 0 ? (
                  <div>
                    <button
                      type="button"
                      aria-expanded={mcpToolsOpen}
                      onClick={() => setMcpToolsOpen((open) => !open)}
                      className="flex h-6 w-full items-center justify-between gap-2 rounded-md px-1 text-2xs text-muted-foreground hover:bg-black/[0.035] hover:text-foreground dark:hover:bg-white/[0.08]"
                    >
                      <span className="flex min-w-0 items-center gap-1.5">
                        {mcpToolsOpen ? (
                          <ChevronDownIcon className="size-3 shrink-0" aria-hidden />
                        ) : (
                          <ChevronRightIcon className="size-3 shrink-0" aria-hidden />
                        )}
                        <WrenchIcon className="size-3 shrink-0" aria-hidden />
                        <span className="truncate">
                          <T>MCP tools</T>
                        </span>
                      </span>
                      <span className="shrink-0 tabular-nums">{mcpTools.length}</span>
                    </button>
                    {mcpToolsOpen ? (
                      <div className="mt-1 max-h-40 space-y-1.5 overflow-y-auto pl-4 pr-1">
                        {view.groupedMcpTools.map((group) => (
                          <div key={group.serverName} className="space-y-0.5">
                            <div className="flex items-center justify-between gap-2 text-3xs font-medium text-foreground/75">
                              <span className="truncate">{group.serverName}</span>
                              <span className="shrink-0 text-muted-foreground tabular-nums">
                                {group.totalTokens !== null
                                  ? formatContextWindowTokens(group.totalTokens)
                                  : group.tools.length}
                              </span>
                            </div>
                            {group.tools.map((tool) => (
                              <div
                                key={`${group.serverName}:${tool.name}`}
                                className="flex items-center justify-between gap-2 pl-2 text-3xs text-muted-foreground"
                              >
                                <span className="truncate font-mono">{tool.displayName}</span>
                                {tool.tokens !== undefined && tool.tokens > 0 ? (
                                  <span className="shrink-0 tabular-nums">
                                    {formatContextWindowTokens(tool.tokens)}
                                  </span>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {memoryFiles.length > 0 ? (
                  <div>
                    <button
                      type="button"
                      aria-expanded={memoryFilesOpen}
                      onClick={() => setMemoryFilesOpen((open) => !open)}
                      className="flex h-6 w-full items-center justify-between gap-2 rounded-md px-1 text-2xs text-muted-foreground hover:bg-black/[0.035] hover:text-foreground dark:hover:bg-white/[0.08]"
                    >
                      <span className="flex min-w-0 items-center gap-1.5">
                        {memoryFilesOpen ? (
                          <ChevronDownIcon className="size-3 shrink-0" aria-hidden />
                        ) : (
                          <ChevronRightIcon className="size-3 shrink-0" aria-hidden />
                        )}
                        <FileTextIcon className="size-3 shrink-0" aria-hidden />
                        <span className="truncate">
                          <T>Memory files</T>
                        </span>
                      </span>
                      <span className="shrink-0 tabular-nums">{memoryFiles.length}</span>
                    </button>
                    {memoryFilesOpen ? (
                      <div className="mt-1 max-h-36 space-y-0.5 overflow-y-auto pl-4 pr-1">
                        {memoryFiles.map((file) => {
                          const displayPath = formatCompactFilePath(file.path, workspacePath);
                          return (
                            <Tooltip key={`${file.type}:${file.path}`}>
                              <TooltipTrigger
                                render={
                                  <button
                                    type="button"
                                    onClick={() => openFile(file.path)}
                                    className="flex w-full items-center justify-between gap-2 rounded px-1 py-0.5 text-left text-3xs text-muted-foreground hover:bg-black/[0.04] hover:text-foreground dark:hover:bg-white/[0.08]"
                                  />
                                }
                              >
                                <span className="min-w-0 truncate font-mono">{displayPath}</span>
                                <span className="shrink-0 tabular-nums">
                                  {file.tokens !== undefined && file.tokens > 0
                                    ? formatContextWindowTokens(file.tokens)
                                    : file.type}
                                </span>
                              </TooltipTrigger>
                              <TooltipPopup side="left" sideOffset={8}>
                                <span className="font-mono">{file.path}</span>
                              </TooltipPopup>
                            </Tooltip>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {skills.length > 0 ? (
                  <div>
                    <button
                      type="button"
                      aria-expanded={skillsOpen}
                      onClick={() => setSkillsOpen((open) => !open)}
                      className="flex h-6 w-full items-center justify-between gap-2 rounded-md px-1 text-2xs text-muted-foreground hover:bg-black/[0.035] hover:text-foreground dark:hover:bg-white/[0.08]"
                    >
                      <span className="flex min-w-0 items-center gap-1.5">
                        {skillsOpen ? (
                          <ChevronDownIcon className="size-3 shrink-0" aria-hidden />
                        ) : (
                          <ChevronRightIcon className="size-3 shrink-0" aria-hidden />
                        )}
                        <BookOpenIcon className="size-3 shrink-0" aria-hidden />
                        <span className="truncate">
                          <T>Skills</T>
                        </span>
                      </span>
                      <span className="shrink-0 tabular-nums">{skills.length}</span>
                    </button>
                    {skillsOpen ? (
                      <div className="mt-1 max-h-36 space-y-0.5 overflow-y-auto pl-4 pr-1">
                        {skills.map((skill) => {
                          const key = `${skill.source}:${skill.pluginName ?? ""}:${skill.name}`;
                          const rightLabel =
                            skill.tokens !== undefined && skill.tokens > 0
                              ? formatContextWindowTokens(skill.tokens)
                              : (skill.pluginName ?? skill.source);
                          return skill.path ? (
                            <Tooltip key={key}>
                              <TooltipTrigger
                                render={
                                  <button
                                    type="button"
                                    onClick={() => openFile(skill.path!)}
                                    className="flex w-full items-center justify-between gap-2 rounded px-1 py-0.5 text-left text-3xs text-muted-foreground hover:bg-black/[0.04] hover:text-foreground dark:hover:bg-white/[0.08]"
                                  />
                                }
                              >
                                <span className="min-w-0 truncate">{skill.name}</span>
                                <span className="shrink-0 tabular-nums">{rightLabel}</span>
                              </TooltipTrigger>
                              <TooltipPopup side="left" sideOffset={8}>
                                <span className="font-mono">{skill.path}</span>
                              </TooltipPopup>
                            </Tooltip>
                          ) : (
                            <div
                              key={key}
                              className="flex items-center justify-between gap-2 px-1 py-0.5 text-3xs text-muted-foreground"
                            >
                              <span className="min-w-0 truncate">{skill.name}</span>
                              <span className="shrink-0 tabular-nums">{rightLabel}</span>
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}

            {breakdown?.source === "estimated" ? (
              <p className="text-3xs leading-snug text-muted-foreground/80">
                <T>Estimated from session usage and workspace files.</T>
              </p>
            ) : null}
            {breakdown?.model ? (
              <p className="truncate text-3xs leading-snug text-muted-foreground/70">
                <T>
                  Model: <Var>{breakdown.model}</Var>
                </T>
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </ThreadDetailsSection>
  );
}
