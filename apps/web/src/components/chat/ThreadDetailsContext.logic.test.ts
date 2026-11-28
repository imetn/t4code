import { describe, expect, it } from "vite-plus/test";

import {
  buildContextBreakdownView,
  formatCompactFilePath,
  groupMcpToolsByServer,
  stripMcpToolWirePrefix,
  summarizeMcpConnectors,
} from "./ThreadDetailsContext.logic";

describe("ThreadDetailsContext.logic", () => {
  it("computes segments, deferred rows, autocompact tick, and bar widths", () => {
    const view = buildContextBreakdownView(
      {
        source: "provider",
        model: "claude-opus-4-6",
        totalTokens: 105_900,
        maxTokens: 240_000,
        percentage: 44.1,
        autoCompactThreshold: 207_000,
        isAutoCompactEnabled: true,
        categories: [
          { id: "messages", name: "Messages", tokens: 44_500, kind: "used" },
          { id: "mcp_tools", name: "MCP tools", tokens: 18_300, kind: "used" },
          { id: "system_prompt", name: "System prompt", tokens: 11_800, kind: "used" },
          { id: "autocompact_buffer", name: "Autocompact buffer", tokens: 33_000, kind: "buffer" },
          { id: "free_space", name: "Free space", tokens: 101_100, kind: "free" },
          {
            id: "mcp_tools_deferred",
            name: "MCP tools (deferred)",
            tokens: 124_900,
            kind: "deferred",
          },
        ],
        mcpTools: [
          { name: "mcp__linear__create_issue", serverName: "linear", tokens: 600 },
          { name: "mcp__linear__list_issues", serverName: "linear", tokens: 900 },
          { name: "mcp__github__open_pr", serverName: "github", tokens: 400 },
        ],
        memoryFiles: [{ path: "/repo/CLAUDE.md", type: "Project", tokens: 2_100 }],
        skills: [{ name: "review", source: "project", tokens: 1_000 }],
      },
      null,
    );

    expect(view).not.toBeNull();
    expect(view!.usedPercent).toBe(44);
    expect(view!.autoCompactTickPercent).toBeCloseTo(86.25, 2);
    expect(view!.activeRows.map((row) => row.id)).toEqual([
      "messages",
      "mcp_tools",
      "system_prompt",
      "autocompact_buffer",
      "free_space",
    ]);
    expect(view!.deferredRows.map((row) => row.id)).toEqual(["mcp_tools_deferred"]);
    expect(view!.barSegments.map((seg) => seg.tone)).toEqual([
      "messages",
      "mcp",
      "systemPrompt",
      "buffer",
    ]);
    expect(view!.groupedMcpTools.map((group) => [group.serverName, group.totalTokens])).toEqual([
      ["linear", 1_500],
      ["github", 400],
    ]);
    expect(view!.groupedMcpTools[0]?.tools.map((tool) => tool.displayName)).toEqual([
      "list_issues",
      "create_issue",
    ]);
  });

  it("strips wire prefixes and groups tools without token counts cleanly", () => {
    expect(stripMcpToolWirePrefix("mcp__my-server__run_query", "my-server")).toBe("run_query");
    expect(stripMcpToolWirePrefix("mcp__my_server__run_query", "my-server")).toBe("run_query");
    expect(stripMcpToolWirePrefix("plain_tool", "my-server")).toBe("plain_tool");

    const grouped = groupMcpToolsByServer([
      { name: "mcp__a__one", serverName: "a" },
      { name: "mcp__b__one", serverName: "b" },
      { name: "mcp__b__two", serverName: "b" },
    ]);
    expect(grouped.map((g) => [g.serverName, g.totalTokens, g.tools.length])).toEqual([
      ["b", null, 2],
      ["a", null, 1],
    ]);
  });

  it("formats workspace-relative and home-relative paths", () => {
    expect(formatCompactFilePath("/work/project/CLAUDE.md", "/work/project")).toBe("CLAUDE.md");
    expect(formatCompactFilePath("/Users/alice/Projects/app", null)).toBe("~/Projects/app");
    expect(formatCompactFilePath("/home/bob/.claude/CLAUDE.md", "/work/project")).toBe(
      "~/.claude/CLAUDE.md",
    );
  });

  it("summarizes MCP connector health counts", () => {
    const summary = summarizeMcpConnectors([
      {
        name: "a",
        status: "connected",
        toolCount: 5,
        canReconnect: true,
        canToggle: true,
        canSignIn: false,
      },
      {
        name: "b",
        status: "failed",
        toolCount: 0,
        canReconnect: true,
        canToggle: true,
        canSignIn: false,
      },
      {
        name: "c",
        status: "needs-auth",
        toolCount: 0,
        canReconnect: true,
        canToggle: true,
        canSignIn: true,
      },
      {
        name: "d",
        status: "disabled",
        toolCount: 0,
        canReconnect: true,
        canToggle: true,
        canSignIn: false,
      },
    ]);
    expect(summary).toEqual({
      total: 4,
      connected: 1,
      attentionCount: 2,
      failedCount: 1,
      needsAuthCount: 1,
      pendingCount: 0,
      disabledCount: 1,
    });
  });
});
