import {
  buildProjectTodoSummaryDispatchPrompt,
  localCalendarDayKey,
  todayLocalCalendarDay,
} from "@t3tools/client-runtime/t4/project-todos";
import {
  EnvironmentId,
  IsoDateTime,
  PositiveInt,
  ProjectId,
  ProjectTodoId,
  type ProjectTodoSummary,
} from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { render } from "../../../../test/render";
import { ProjectTodosCalendarView } from "./ProjectTodosCalendarView";

const ENV_ID = EnvironmentId.make("env-local");
const PROJECT_ID = ProjectId.make("proj-1");

const mockCreateRun = vi.fn();
const mockUpdateRun = vi.fn();
const mockHandleNewThread = vi.fn();
const mockRefresh = vi.fn();

const today = todayLocalCalendarDay();
const todayKey = localCalendarDayKey(today);
const todayIso = IsoDateTime.make(
  new Date(today.year, today.month - 1, today.day, 10, 0).toISOString(),
);

const mockItems: ProjectTodoSummary[] = [
  {
    id: ProjectTodoId.make("todo-open-1"),
    projectId: PROJECT_ID,
    kind: "todo",
    title: "Finish full-screen calendar layout",
    bodyPreview: "Display completed and unfinished entries per day",
    hasBody: true,
    priority: "high",
    pinned: false,
    sourceThreadId: null,
    linkedThreadId: null,
    fileRefs: [],
    createdBy: "user",
    revision: PositiveInt.make(1),
    createdAt: todayIso,
    updatedAt: todayIso,
    completedAt: null,
    archivedAt: null,
  },
  {
    id: ProjectTodoId.make("todo-done-1"),
    projectId: PROJECT_ID,
    kind: "todo",
    title: "Sync origin/main before release",
    bodyPreview: "",
    hasBody: false,
    priority: "normal",
    pinned: false,
    sourceThreadId: null,
    linkedThreadId: null,
    fileRefs: [],
    createdBy: "user",
    revision: PositiveInt.make(2),
    createdAt: todayIso,
    updatedAt: todayIso,
    completedAt: todayIso,
    archivedAt: null,
  },
];

vi.mock("~/hooks/useHandleNewThread", () => ({
  useNewThreadHandler: () => mockHandleNewThread,
}));

vi.mock(import("~/state/entities"), async (importOriginal) => ({
  ...(await importOriginal()),
  useProjects: () =>
    [
      {
        environmentId: ENV_ID,
        id: PROJECT_ID,
        title: "t4code",
        archivedAt: null,
        isScratch: false,
      },
    ] as never,
  useQuietThreadShells: () => [] as never,
}));

vi.mock(import("~/state/session"), async (importOriginal) => ({
  ...(await importOriginal()),
  useEnvironmentScope: () => true,
}));

const emptyAtom = Atom.make({ _tag: "Initial" } as const);

vi.mock("~/state/projectTodos", () => ({
  projectTodoEnvironment: {
    create: { _tag: "create" },
    update: { _tag: "update" },
    remove: { _tag: "remove" },
    detail: () => emptyAtom,
    list: () => emptyAtom,
    dailyReview: () => emptyAtom,
  },
  useEnvironmentSupportsProjectTodos: () => true,
  loadProjectTodoDispatchPrompt: async (_envId: EnvironmentId, item: ProjectTodoSummary) =>
    buildProjectTodoSummaryDispatchPrompt(item),
  useProjectTodoDailyReview: () => ({
    data: {
      capturedToday: mockItems,
      completedToday: [mockItems[1]!],
      linkedActive: [],
      staleOpen: [],
      pinnedNotes: [],
      calendarItems: mockItems,
      calendarTruncated: false,
      truncated: false,
    },
    dataUpdatedAt: 0,
    error: null,
    failure: null,
    isPending: false,
    isSuccess: true,
    refresh: mockRefresh,
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

describe("ProjectTodosCalendarView", () => {
  it("renders unfinished and completed items inside day cells, toggles completion, and prefills drafts from day sheet", async () => {
    mockCreateRun.mockReset();
    mockUpdateRun.mockReset();
    mockHandleNewThread.mockReset();
    mockUpdateRun.mockResolvedValue({ _tag: "Success", value: { item: mockItems[0] } });
    mockHandleNewThread.mockResolvedValue({ draftId: "draft-1", threadId: "thread-2" });

    await using _screen = await render(
      <ProjectTodosCalendarView environmentId={ENV_ID} projectId={null} />,
      { router: "/todos" },
    );

    const todayCell = page.getByTestId("project-todos-calendar-grid");
    await expect.element(todayCell).toBeVisible();
    await expect.element(page.getByText("Finish full-screen calendar layout")).toBeVisible();
    await expect.element(page.getByText("Sync origin/main before release")).toBeVisible();

    // Direct 1-click completion toggle right from the calendar grid cell
    await page.getByRole("button", { name: "Mark as completed" }).first().click();
    expect(mockUpdateRun).toHaveBeenCalledWith({
      environmentId: ENV_ID,
      input: {
        id: ProjectTodoId.make("todo-open-1"),
        projectId: PROJECT_ID,
        expectedRevision: PositiveInt.make(1),
        completed: true,
      },
    });

    // Click the day cell header to open the Day Detail Sheet and dispatch draft
    await page.getByRole("button", { name: todayKey, exact: true }).click();
    await expect.element(page.getByRole("button", { name: "Draft in thread" })).toBeVisible();
    await page.getByRole("button", { name: "Draft in thread" }).click();
    expect(mockHandleNewThread).toHaveBeenCalledTimes(1);
    expect(mockHandleNewThread.mock.calls[0]?.[1]).toEqual({
      prompt:
        "Finish full-screen calendar layout\n\nDisplay completed and unfinished entries per day",
    });
    expect(todayKey).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
