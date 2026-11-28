import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  EnvironmentId,
  ProviderThreadId,
  ThreadId,
  type ProviderContextBreakdown,
  type ProviderMcpServerEntry,
} from "@t3tools/contracts";
import { StrictMode } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

const mocks = vi.hoisted(() => ({
  reconnect: vi.fn(),
  toggle: vi.fn(),
}));

vi.mock(import("~/state/threads"), async () => {
  const { Atom } = await import("effect/reactivity");
  const allowed = Atom.make(true);
  const signedIn = Atom.make(false);
  return {
    threadEnvironment: {
      mcpReconnect: { __mock: "reconnect", permissionAtom: () => allowed },
      mcpToggle: { __mock: "toggle", permissionAtom: () => allowed },
      mcpSignInStart: { permissionAtom: () => allowed },
      mcpSignInComplete: { permissionAtom: () => allowed },
      mcpSignedInAtom: () => signedIn,
    },
  } as never;
});

vi.mock(import("~/state/use-atom-command"), () => ({
  useAtomCommand: ((command: { readonly __mock?: string }) => {
    return async (args: unknown) => {
      if (command?.__mock === "reconnect") {
        mocks.reconnect(args);
        return { _tag: "Success", value: { reconnectedAt: "2026-11-28T00:00:00.000Z" } };
      }
      mocks.toggle(args);
      return { _tag: "Success", value: { updatedAt: "2026-11-28T00:00:00.000Z" } };
    };
  }) as never,
}));

import { render } from "../../../test/render";
import "../../index.css";
import { useRightPanelStore } from "../../rightPanelStore";
import { ThreadDetailsConnectors } from "./ThreadDetailsConnectors";
import { ThreadDetailsContext } from "./ThreadDetailsContext";

const environmentId = EnvironmentId.make("env:test");
const threadId = ThreadId.make("thread:test");
const providerThreadId = ProviderThreadId.make("provider-thread:test");
const threadRef = { environmentId, threadId };

const SAMPLE_BREAKDOWN: ProviderContextBreakdown = {
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
    { id: "free_space", name: "Free space", tokens: 101_100, kind: "free" },
    { id: "mcp_tools_deferred", name: "MCP tools (deferred)", tokens: 124_900, kind: "deferred" },
  ],
  mcpTools: [{ name: "mcp__linear__list_issues", serverName: "linear", tokens: 900 }],
  memoryFiles: [{ path: "/repo/CLAUDE.md", type: "Project", tokens: 2_100 }],
  skills: [
    {
      name: "review",
      source: "project",
      path: "/repo/.agents/skills/review/SKILL.md",
      tokens: 800,
    },
  ],
};

const SAMPLE_SERVERS: ReadonlyArray<ProviderMcpServerEntry> = [
  {
    name: "linear",
    status: "failed",
    toolCount: 0,
    error: "Connection timed out",
    canReconnect: true,
    canToggle: true,
    canSignIn: false,
  },
  {
    name: "t3-code",
    status: "connected",
    toolCount: 12,
    canReconnect: true,
    canToggle: false,
    canSignIn: false,
  },
];

function resetState() {
  mocks.reconnect.mockReset();
  mocks.toggle.mockReset();
  useRightPanelStore.setState({ byThreadKey: {} });
}

describe("ThreadDetailsContext & ThreadDetailsConnectors", () => {
  it("stays collapsed by default and reveals category breakdown and clickable memory files on click", async () => {
    resetState();
    const onRefresh = vi.fn();
    await using _screen = await render(
      <StrictMode>
        <div className="w-72">
          <ThreadDetailsContext
            threadRef={threadRef}
            usage={null}
            breakdown={SAMPLE_BREAKDOWN}
            workspacePath="/repo"
            loading={false}
            onRefresh={onRefresh}
          />
        </div>
      </StrictMode>,
    );

    const toggle = page.getByRole("button", { name: "Context: 44% used" });
    await expect.element(toggle).toHaveAttribute("aria-expanded", "false");
    await expect.element(page.getByText("System prompt")).not.toBeInTheDocument();

    await userEvent.click(toggle);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    await expect.element(page.getByText("44% used")).toBeVisible();
    await expect.element(page.getByText("System prompt")).toBeVisible();
    await expect.element(page.getByText("MCP tools (deferred)")).toBeVisible();

    await userEvent.click(page.getByRole("button", { name: /Memory files/i }));
    const memoryFile = page.getByRole("button", { name: /CLAUDE\.md/i });
    await expect.element(memoryFile).toBeVisible();
    await userEvent.click(memoryFile);

    const threadState = useRightPanelStore.getState().byThreadKey[scopedThreadKey(threadRef)];
    expect(
      threadState?.surfaces.some(
        (surface) => surface.kind === "file" && surface.relativePath === "/repo/CLAUDE.md",
      ),
    ).toBe(true);
  });

  it("shows connector attention count collapsed and supports reconnect and toggle when expanded", async () => {
    resetState();
    const onRefresh = vi.fn();
    await using _screen = await render(
      <StrictMode>
        <div className="w-72">
          <ThreadDetailsConnectors
            environmentId={environmentId}
            threadId={threadId}
            providerThreadId={providerThreadId}
            servers={SAMPLE_SERVERS}
            fetchedAt="2026-11-28T00:00:00.000Z"
            loading={false}
            onRefresh={onRefresh}
          />
        </div>
      </StrictMode>,
    );

    const header = page.getByRole("button", { name: /Connectors/i });
    await expect.element(header).toHaveAttribute("aria-expanded", "false");
    await expect.element(page.getByText("1 to reconnect")).toBeVisible();
    await expect.element(page.getByText("Connection timed out")).not.toBeInTheDocument();

    await userEvent.click(header);
    await expect.element(page.getByText("Connection timed out")).toBeVisible();

    await userEvent.click(page.getByRole("button", { name: "Reconnect linear" }));
    expect(mocks.reconnect).toHaveBeenCalledWith({
      environmentId,
      input: { threadId, providerThreadId, server: "linear" },
    });

    await userEvent.click(page.getByRole("switch", { name: "Toggle linear" }));
    expect(mocks.toggle).toHaveBeenCalledWith({
      environmentId,
      input: { threadId, providerThreadId, server: "linear", enabled: false },
    });
  });
});
