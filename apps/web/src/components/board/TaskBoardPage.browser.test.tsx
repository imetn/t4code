import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import { EnvironmentId, ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import "~/index.css";
import { act, render } from "../../../test/render";
import { SidebarProvider, useSidebar } from "../ui/sidebar";

const envId = EnvironmentId.make("env-1");
const projId = ProjectId.make("proj-1");

function makeThread(
  id: string,
  title: string,
  overrides: Partial<EnvironmentThreadShell> = {},
): EnvironmentThreadShell {
  return {
    environmentId: envId,
    projectId: projId,
    title,
    providerInstanceId: ProviderInstanceId.make("codex"),
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-6.2-sol" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: "main",
    worktreePath: null,
    lineage: {
      parentThreadId: null,
      relationshipToParent: null,
      sideChat: false,
      workflowStep: false,
    } as unknown as EnvironmentThreadShell["lineage"],
    forkedFrom: null,
    linkOrigin: null,
    delegatedFrom: null,
    workflowRun: null,
    activeProviderThreadId: null,
    latestRun: null,
    runtime: null,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    pendingBackgroundTasks: [],
    providerInstanceHistory: [],
    goal: null,
    itemCount: 1,
    visibleItemCount: 1,
    createdAt: "2026-11-27T10:00:00.000Z",
    updatedAt: "2026-11-27T11:00:00.000Z",
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    unsettledAt: null,
    snoozedUntil: null,
    snoozedAt: null,
    pinnedAt: null,
    pinOrderKey: null,
    activeOrderKey: null,
    pullRequests: [],
    handoff: null,
    deletedAt: null,
    source: {} as EnvironmentThreadShell["source"],
    ...overrides,
    id: ThreadId.make(id),
  };
}

const workingThread = makeThread("t-working", "Build feature", {
  runtime: {
    status: "running",
    activeRunId: null,
    providerInstanceId: ProviderInstanceId.make("codex"),
    providerName: "Codex",
    lastError: null,
    updatedAt: "2026-11-27T11:00:00.000Z",
  },
});
const activeThread = makeThread("t-active", "Review notes");

const project = {
  id: projId,
  environmentId: envId,
  title: "t4code",
  cwd: "/workspace/t4code",
  archivedAt: null,
} as unknown as EnvironmentProject;

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  threads: [] as EnvironmentThreadShell[],
  chatViewProps: [] as Array<{ threadId: string; embedded?: unknown }>,
}));

vi.mock(import("@tanstack/react-router"), async (importOriginal) => ({
  ...(await importOriginal()),
  useNavigate: () => mocks.navigate,
}));

vi.mock(import("../../state/entities"), async (importOriginal) => ({
  ...(await importOriginal()),
  useQuietThreadShells: () => mocks.threads,
  useQuietThreadShell: (ref: { environmentId: string; threadId: string } | null) =>
    ref
      ? (mocks.threads.find(
          (thread) => thread.environmentId === ref.environmentId && thread.id === ref.threadId,
        ) ?? null)
      : null,
  useQuietThreadProjection: () => null,
  useProjects: () => [project],
  useDelegatedUnderParent: () => new Set<string>(),
}));

vi.mock(import("../../state/environments"), async (importOriginal) => ({
  ...(await importOriginal()),
  useEnvironments: () =>
    ({
      environments: [{ environmentId: envId, label: "Work" }],
    }) as never,
}));

vi.mock(import("../../state/shell"), async (importOriginal) => ({
  ...(await importOriginal()),
  useEnvironmentShellStatus: () => "ready" as never,
}));

vi.mock(import("../../state/threads"), async (importOriginal) => ({
  ...(await importOriginal()),
  useEnvironmentThread: () => ({ data: { _tag: "None" }, loading: false, error: null }) as never,
}));

vi.mock(import("../ThreadRouteView"), () => ({
  useOpenThreadFamily: () => {},
}));

vi.mock(import("../../hooks/useThreadActions"), () => ({
  useThreadActions: () =>
    ({
      pinThread: vi.fn(),
      unpinThread: vi.fn(),
      settleThread: vi.fn(),
      unsettleThread: vi.fn(),
    }) as never,
}));

vi.mock(import("../../hooks/useHandleNewThread"), () => ({
  useHandleNewThread: () =>
    ({
      handleNewThread: vi.fn(),
      defaultProjectRef: null,
    }) as never,
}));

vi.mock(import("../ProjectFavicon"), () => ({
  ProjectFavicon: () => <span data-testid="project-favicon" />,
}));

vi.mock(import("../ChatView"), () => ({
  default: (props: {
    threadId: string;
    embedded?: unknown;
    boardHeaderLeading?: React.ReactNode;
    boardHeaderActions?: React.ReactNode;
  }) => {
    mocks.chatViewProps.push({ threadId: props.threadId, embedded: props.embedded });
    return (
      <div data-testid="mock-embedded-chat-view" data-thread-id={props.threadId}>
        <div>
          {props.boardHeaderLeading}
          <button type="button" data-task-board-pane-title="">
            {props.threadId}
          </button>
          {props.boardHeaderActions}
        </div>
        Chat for {props.threadId}
      </div>
    );
  },
}));

import { TaskBoardPage } from "./TaskBoardPage";

describe("TaskBoardPage", () => {
  it("uses unclipped ScrollArea corners and opens clicked cards in inline split view without navigating away", async () => {
    mocks.navigate.mockReset();
    mocks.chatViewProps = [];
    mocks.threads = [workingThread, activeThread];

    await using _screen = await render(
      <SidebarProvider defaultOpen={false}>
        <TaskBoardPage />
      </SidebarProvider>,
    );

    // Bug #1 proof: column ScrollAreas use radius="none" (rounded-none) so top card corners are not clipped.
    const viewports = [
      ...document.querySelectorAll<HTMLElement>('[data-slot="scroll-area-viewport"]'),
    ];
    expect(viewports.length).toBeGreaterThanOrEqual(4);
    for (const viewport of viewports) {
      expect(viewport.parentElement?.className).toContain("rounded-none");
    }

    // Initially renders full 4-column board with no split view; cards sit on crisp bg-card inside tinted column containers.
    expect(document.querySelector('[data-testid="task-board-split-view"]')).toBeNull();
    expect(document.querySelectorAll("[data-task-board-column]").length).toBe(4);
    expect(
      document
        .querySelector<HTMLElement>(`[data-task-board-card="${envId}:t-working"]`)
        ?.className.split(/\s+/),
    ).toContain("bg-card");

    // Clicking a card in the Active column shifts Active to the left rail and opens the thread inline.
    const activeCard = document.querySelector<HTMLElement>(
      `[data-task-board-card="${envId}:t-active"]`,
    )!;
    await act(async () => {
      activeCard.click();
    });

    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(document.querySelector('[data-testid="task-board-split-view"]')).not.toBeNull();
    const dockedSection = document.querySelector<HTMLElement>(
      '[data-testid="task-board-docked-column"] [data-task-board-column="active"]',
    );
    expect(dockedSection).not.toBeNull();
    // Docked split-view renders session cards directly with status-tinted fills instead of a nested outer column card.
    expect(dockedSection?.className.split(/\s+/)).not.toContain("border");
    expect(dockedSection?.querySelector("h2")).toBeNull();
    expect(dockedSection?.querySelector('[data-slot="scroll-area-scrollbar"]')).toBeNull();
    const dockedActiveCard = document.querySelector<HTMLElement>(
      `[data-task-board-card="${envId}:t-active"]`,
    );
    expect(dockedActiveCard?.getAttribute("data-selected")).toBe("true");
    expect(dockedActiveCard?.className.split(/\s+/)).toContain("bg-accent/85");
    expect(dockedActiveCard?.className.split(/\s+/)).not.toContain("bg-card");
    const chat = document.querySelector<HTMLElement>('[data-testid="mock-embedded-chat-view"]');
    expect(chat?.dataset.threadId).toBe("t-active");
    expect(mocks.chatViewProps.at(-1)).toEqual({ threadId: "t-active", embedded: "board" });

    // Switching the docked column tab to Working brings the Working status tint into the docked cards and active tab.
    const workingTab = document.querySelector<HTMLButtonElement>(
      '[data-task-board-column-tab="working"]',
    )!;
    await act(async () => {
      workingTab.click();
    });
    expect(workingTab.className.split(/\s+/)).toContain("bg-info/12");
    const workingCard = document.querySelector<HTMLElement>(
      `[data-task-board-card="${envId}:t-working"]`,
    )!;
    expect(workingCard.className.split(/\s+/)).toContain("bg-info/6");
    await act(async () => {
      workingCard.click();
    });
    expect(workingCard.className.split(/\s+/)).toContain("bg-info/12");
    expect(
      document.querySelector<HTMLElement>('[data-testid="mock-embedded-chat-view"]')?.dataset
        .threadId,
    ).toBe("t-working");

    // Pressing Escape outside an input exits split view and restores all 4 columns.
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(document.querySelector('[data-testid="task-board-split-view"]')).toBeNull();
    expect(document.querySelectorAll("[data-task-board-column]").length).toBe(4);

    // Re-opening and clicking "Open full thread view" navigates to the full thread route.
    await act(async () => {
      document.querySelector<HTMLElement>(`[data-task-board-card="${envId}:t-working"]`)!.click();
    });
    const openFullButton = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Open full thread view"]',
    )!;
    await act(async () => {
      openFullButton.click();
    });
    expect(mocks.navigate).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: "/$environmentId/$threadId",
      params: { environmentId: envId, threadId: ThreadId.make("t-working") },
    });

    // Keyboard open moves focus into the opened thread pane, and Escape restores focus to the card.
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    const activeCardAgain = document.querySelector<HTMLElement>(
      `[data-task-board-card="${envId}:t-active"]`,
    )!;
    activeCardAgain.focus();
    await act(async () => {
      activeCardAgain.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(document.activeElement).toBe(document.querySelector("[data-task-board-pane-title]"));

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(document.activeElement?.getAttribute("data-task-board-card")).toBe(`${envId}:t-active`);

    // If the open card is filtered out before closing, focus falls back to the column instead of body.
    await act(async () => {
      document
        .querySelector<HTMLElement>(`[data-task-board-card="${envId}:t-active"]`)!
        .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    const filterInput = document.querySelector<HTMLInputElement>(
      'input[aria-label="Filter tasks"]',
    )!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(filterInput, "Build feature");
      filterInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(document.activeElement?.getAttribute("data-task-board-column")).toBe("active");
  });

  it("keeps an open main sidebar untouched when entering and leaving split view", async () => {
    await page.viewport(1280, 800);
    mocks.navigate.mockReset();
    mocks.chatViewProps = [];
    mocks.threads = [workingThread, activeThread];

    function SidebarStateProbe() {
      const { open } = useSidebar();
      return <span data-testid="sidebar-open-probe">{String(open)}</span>;
    }

    await using _screen = await render(
      <SidebarProvider defaultOpen={true}>
        <SidebarStateProbe />
        <TaskBoardPage />
      </SidebarProvider>,
    );

    expect(document.querySelector('[data-testid="sidebar-open-probe"]')?.textContent).toBe("true");

    const workingCard = document.querySelector<HTMLElement>(
      `[data-task-board-card="${envId}:t-working"]`,
    )!;
    await act(async () => {
      workingCard.click();
    });

    expect(document.querySelector('[data-testid="sidebar-open-probe"]')?.textContent).toBe("true");
    expect(document.querySelector('[data-testid="task-board-split-view"]')).not.toBeNull();

    const closeButton = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Back to board"]',
    )!;
    await act(async () => {
      closeButton.click();
    });

    expect(document.querySelector('[data-testid="sidebar-open-probe"]')?.textContent).toBe("true");
    expect(document.querySelector('[data-testid="task-board-split-view"]')).toBeNull();
  });
});
