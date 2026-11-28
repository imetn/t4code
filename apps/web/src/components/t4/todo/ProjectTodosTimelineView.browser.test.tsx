import {
  buildProjectTodoSummaryDispatchPrompt,
  localCalendarDayKey,
  shiftLocalCalendarDay,
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
import { ProjectTodosTimelineView } from "./ProjectTodosTimelineView";

const ENV_ID = EnvironmentId.make("env-local");
const PROJECT_ID = ProjectId.make("proj-1");

const mockUpdateRun = vi.fn();
const mockHandleNewThread = vi.fn();
const mockRefresh = vi.fn();

const today = todayLocalCalendarDay();
const yesterday = shiftLocalCalendarDay(today, -1);
const todayKey = localCalendarDayKey(today);
const yesterdayKey = localCalendarDayKey(yesterday);
const todayIso = IsoDateTime.make(
  new Date(today.year, today.month - 1, today.day, 9, 30).toISOString(),
);
const yesterdayIso = IsoDateTime.make(
  new Date(yesterday.year, yesterday.month - 1, yesterday.day, 15, 0).toISOString(),
);

const mockItems: ProjectTodoSummary[] = [
  {
    id: ProjectTodoId.make("todo-today-open"),
    projectId: PROJECT_ID,
    kind: "todo",
    title: "Add timeline grouped by day",
    bodyPreview: "Keep chronological history easy to scan",
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
    id: ProjectTodoId.make("todo-yesterday-done"),
    projectId: PROJECT_ID,
    kind: "todo",
    title: "Ship full-screen calendar grid",
    bodyPreview: "",
    hasBody: false,
    priority: "normal",
    pinned: false,
    sourceThreadId: null,
    linkedThreadId: null,
    fileRefs: [],
    createdBy: "user",
    revision: PositiveInt.make(2),
    createdAt: yesterdayIso,
    updatedAt: yesterdayIso,
    completedAt: yesterdayIso,
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
      capturedToday: [mockItems[0]!],
      completedToday: [],
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
  useAtomCommand: () => mockUpdateRun,
}));

describe("ProjectTodosTimelineView", () => {
  it("groups items by day in timeline mode and switches to status grouping with creation dates", async () => {
    mockUpdateRun.mockReset();
    mockHandleNewThread.mockReset();
    mockHandleNewThread.mockResolvedValue({ draftId: "draft-1", threadId: "thread-2" });

    await using _screen = await render(
      <ProjectTodosTimelineView environmentId={ENV_ID} projectId={null} />,
      { router: "/todos" },
    );

    await expect.element(page.getByTestId("project-todos-timeline-by-day")).toBeVisible();
    await expect.element(page.getByText(todayKey)).toBeVisible();
    await expect.element(page.getByText(yesterdayKey)).toBeVisible();
    await expect.element(page.getByText("Add timeline grouped by day")).toBeVisible();
    await expect.element(page.getByText("Ship full-screen calendar grid")).toBeVisible();

    // Switch to Group by status and verify creation date badge is visibly rendered on items
    await page.getByRole("button", { name: "Group by status" }).click();
    await expect.element(page.getByTestId("project-todos-timeline-by-status")).toBeVisible();
    await expect.element(page.getByText(/Created /).first()).toBeVisible();

    // Draft in thread prefills composer without auto-sending
    await page.getByRole("button", { name: "Draft in thread" }).first().click();
    expect(mockHandleNewThread).toHaveBeenCalledTimes(1);
    expect(mockHandleNewThread.mock.calls[0]?.[1]).toEqual({
      prompt: "Add timeline grouped by day\n\nKeep chronological history easy to scan",
    });
  });
});
