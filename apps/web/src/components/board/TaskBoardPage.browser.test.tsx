import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import { EnvironmentId, ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import "~/index.css";
import { act, render } from "../../../test/render";
import { SidebarProvider } from "../ui/sidebar";

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
  default: (props: { threadId: string; embedded?: unknown }) => {
    mocks.chatViewProps.push({ threadId: props.threadId, embedded: props.embedded });
    return (
      <div data-testid="mock-embedded-chat-view" data-thread-id={props.threadId}>
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

    // Initially renders full 4-column board with no split view.
    expect(document.querySelector('[data-testid="task-board-split-view"]')).toBeNull();
    expect(document.querySelectorAll("[data-task-board-column]").length).toBe(4);

    // Clicking a card in the Active column shifts Active to the left rail and opens the thread inline.
    const activeCard = document.querySelector<HTMLElement>(
      `[data-task-board-card="${envId}:t-active"]`,
    )!;
    await act(async () => {
      activeCard.click();
    });

    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(document.querySelector('[data-testid="task-board-split-view"]')).not.toBeNull();
    expect(
      document.querySelector(
        '[data-testid="task-board-docked-column"] [data-task-board-column="active"]',
      ),
    ).not.toBeNull();
    expect(
      document
        .querySelector(`[data-task-board-card="${envId}:t-active"]`)
        ?.getAttribute("data-selected"),
    ).toBe("true");
    const chat = document.querySelector<HTMLElement>('[data-testid="mock-embedded-chat-view"]');
    expect(chat?.dataset.threadId).toBe("t-active");
    expect(mocks.chatViewProps.at(-1)).toEqual({ threadId: "t-active", embedded: "board" });

    // Switching the docked column tab to Working lets the user select a Working session inline.
    const workingTab = document.querySelector<HTMLButtonElement>(
      '[data-task-board-column-tab="working"]',
    )!;
    await act(async () => {
      workingTab.click();
    });
    const workingCard = document.querySelector<HTMLElement>(
      `[data-task-board-card="${envId}:t-working"]`,
    )!;
    await act(async () => {
      workingCard.click();
    });
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
  });
});
