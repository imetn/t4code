import { buildProjectTodoSummaryDispatchPrompt } from "@t3tools/client-runtime/t4/project-todos";
import {
  EnvironmentId,
  IsoDateTime,
  PositiveInt,
  ProjectId,
  ProjectTodoId,
  ThreadId,
  type ProjectTodoSummary,
} from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { render } from "../../../../test/render";
import { ProjectTodosSection } from "./ProjectTodosSection";

const ENV_ID = EnvironmentId.make("env-local");
const PROJECT_ID = ProjectId.make("proj-1");
const THREAD_ID = ThreadId.make("thread-1");

const mockCreateRun = vi.fn();
const mockUpdateRun = vi.fn();
const mockHandleNewThread = vi.fn();
const mockReload = vi.fn();

const mockState = {
  supported: true,
  canOperate: true,
  items: [] as ProjectTodoSummary[],
  threads: [
    {
      environmentId: ENV_ID,
      id: THREAD_ID,
      projectId: PROJECT_ID,
      title: "Refactor cache layer",
      settledOverride: "settled",
      latestRun: null,
      hasPendingApprovals: false,
      hasPendingUserInput: false,
      hasActionableProposedPlan: false,
      pendingSubagentRequest: null,
      pendingGuestMessageCount: 0,
      archivedAt: null,
      deletedAt: null,
      pinnedAt: null,
      updatedAt: "2026-11-27T10:00:00.000Z",
    },
  ],
};

vi.mock("~/hooks/useHandleNewThread", () => ({
  useNewThreadHandler: () => mockHandleNewThread,
}));

vi.mock(import("~/state/entities"), async (importOriginal) => ({
  ...(await importOriginal()),
  useQuietThreadShells: () => mockState.threads as never,
}));

vi.mock(import("~/state/session"), async (importOriginal) => ({
  ...(await importOriginal()),
  useEnvironmentScope: () => mockState.canOperate,
}));

const emptyDetailAtom = Atom.make({ _tag: "Initial" } as const);

vi.mock("~/state/projectTodos", () => ({
  projectTodoEnvironment: {
    create: { _tag: "create" },
    update: { _tag: "update" },
    remove: { _tag: "remove" },
    detail: () => emptyDetailAtom,
    list: () => emptyDetailAtom,
  },
  useEnvironmentSupportsProjectTodos: () => mockState.supported,
  loadProjectTodoDispatchPrompt: async (_envId: EnvironmentId, item: ProjectTodoSummary) =>
    buildProjectTodoSummaryDispatchPrompt(item),
  useProjectTodoList: () => ({
    data: { items: mockState.items, nextCursor: null, hasMore: false },
    dataUpdatedAt: 0,
    error: null,
    failure: null,
    isPending: false,
    isSuccess: true,
    refresh: mockReload,
  }),
  useProjectTodoDetail: () => ({
    data: null,
    dataUpdatedAt: 0,
    error: null,
    failure: null,
    isPending: false,
    isSuccess: false,
    refresh: vi.fn(),
  }),
}));

vi.mock("~/state/use-atom-command", () => ({
  useAtomCommand: (cmd: { readonly _tag?: string }) =>
    cmd?._tag === "create" ? mockCreateRun : mockUpdateRun,
}));

describe("ProjectTodosSection", () => {
  it("degrades cleanly when the host environment does not support projectTodos", async () => {
    mockState.supported = false;
    mockState.items = [];

    await using _screen = await render(
      <ProjectTodosSection environmentId={ENV_ID} projectId={PROJECT_ID} projectName="T4 Code" />,
      { router: "/todos" },
    );

    await expect.element(page.getByText("Project todos unavailable on this host")).toBeVisible();
  });

  it("captures a quick todo, shows linked settled hint, and dispatches a prefilled draft", async () => {
    mockState.supported = true;
    mockState.canOperate = true;
    mockCreateRun.mockReset();
    mockUpdateRun.mockReset();
    mockHandleNewThread.mockReset();
    mockCreateRun.mockResolvedValue({
      _tag: "Success",
      value: { created: true, item: { id: "todo_new" } },
    });
    mockUpdateRun.mockResolvedValue({
      _tag: "Success",
      value: { item: { id: "todo-1" } },
    });
    mockHandleNewThread.mockResolvedValue({ draftId: "draft-1", threadId: "thread-2" });

    mockState.items = [
      {
        id: ProjectTodoId.make("todo-1"),
        projectId: PROJECT_ID,
        kind: "todo",
        title: "Add LRU cap to diff cache",
        bodyPreview: "Keep max 500 entries in memory",
        hasBody: true,
        priority: "high",
        pinned: true,
        sourceThreadId: null,
        linkedThreadId: THREAD_ID,
        fileRefs: ["apps/server/src/cache.ts"],
        createdBy: "agent",
        revision: PositiveInt.make(2),
        createdAt: IsoDateTime.make("2026-11-27T08:00:00.000Z"),
        updatedAt: IsoDateTime.make("2026-11-27T09:00:00.000Z"),
        completedAt: null,
        archivedAt: null,
      },
    ];

    await using _screen = await render(
      <ProjectTodosSection environmentId={ENV_ID} projectId={PROJECT_ID} projectName="T4 Code" />,
      { router: "/todos" },
    );

    await expect.element(page.getByText("Add LRU cap to diff cache")).toBeVisible();
    await expect.element(page.getByText("Refactor cache layer")).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Mark done?" })).toBeVisible();

    const input = page.getByPlaceholder("Capture idea or todo, press Enter...");
    await input.fill("Polish sidebar filter persistence");
    await userEvent.keyboard("{Enter}");

    expect(mockCreateRun).toHaveBeenCalledTimes(1);
    expect(mockCreateRun.mock.calls[0]?.[0]).toMatchObject({
      environmentId: ENV_ID,
      input: {
        projectId: PROJECT_ID,
        title: "Polish sidebar filter persistence",
        kind: "todo",
      },
    });

    await page.getByRole("button", { name: "Draft in thread" }).click();
    expect(mockHandleNewThread).toHaveBeenCalledTimes(1);
    expect(mockHandleNewThread.mock.calls[0]?.[1]).toEqual({
      prompt:
        "Add LRU cap to diff cache\n\nKeep max 500 entries in memory\n\nRelevant files:\n- apps/server/src/cache.ts",
    });

    await page.getByRole("button", { name: "Mark done?" }).click();
    expect(mockUpdateRun).toHaveBeenCalledWith({
      environmentId: ENV_ID,
      input: {
        id: ProjectTodoId.make("todo-1"),
        projectId: PROJECT_ID,
        expectedRevision: PositiveInt.make(2),
        completed: true,
      },
    });
  });
});
