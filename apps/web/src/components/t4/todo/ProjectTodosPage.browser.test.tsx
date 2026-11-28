import {
  buildProjectTodoSummaryDispatchPrompt,
  todayLocalCalendarDay,
  type ProjectTodoDailyReviewTarget,
} from "@t3tools/client-runtime/t4/project-todos";
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
import { page } from "vite-plus/test/browser";

import { SidebarProvider } from "~/components/ui/sidebar";
import { render } from "../../../../test/render";
import { ProjectTodosPage } from "./ProjectTodosPage";

const WORK_ENV_ID = EnvironmentId.make("env-work");
const HOME_ENV_ID = EnvironmentId.make("env-home");
const WORK_PROJECT_ID = ProjectId.make("proj-work");
const HOME_PROJECT_ID = ProjectId.make("proj-home");

const today = todayLocalCalendarDay();
const todayIso = IsoDateTime.make(
  new Date(today.year, today.month - 1, today.day, 10, 0).toISOString(),
);

const workTodo: ProjectTodoSummary = {
  id: ProjectTodoId.make("todo-work-1"),
  projectId: WORK_PROJECT_ID,
  kind: "todo",
  title: "Optimize model picker on Work",
  bodyPreview: "Keep local todos visible across views",
  hasBody: true,
  priority: "high",
  pinned: false,
  sourceThreadId: null,
  linkedThreadId: null,
  fileRefs: [],
  createdBy: "agent",
  revision: PositiveInt.make(1),
  createdAt: todayIso,
  updatedAt: todayIso,
  completedAt: null,
  archivedAt: null,
};

const homeTodo: ProjectTodoSummary = {
  id: ProjectTodoId.make("todo-home-1"),
  projectId: HOME_PROJECT_ID,
  kind: "todo",
  title: "Review PR from Home MBP",
  bodyPreview: "",
  hasBody: false,
  priority: "normal",
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
};

const itemsByEnvironment = new Map<EnvironmentId, ReadonlyArray<ProjectTodoSummary>>([
  [WORK_ENV_ID, [workTodo]],
  [HOME_ENV_ID, [homeTodo]],
]);

const requestedEnvSets: Array<ReadonlyArray<EnvironmentId>> = [];

vi.mock("~/hooks/useHandleNewThread", () => ({
  useNewThreadHandler: () => vi.fn(),
}));

vi.mock(import("~/state/primaryEnvironment"), async (importOriginal) => ({
  ...(await importOriginal()),
  localEnvironmentIdAtom: Atom.make<EnvironmentId | null>("env-work" as EnvironmentId),
}));

vi.mock(import("~/state/entities"), async (importOriginal) => ({
  ...(await importOriginal()),
  useProjects: () =>
    [
      {
        environmentId: WORK_ENV_ID,
        id: WORK_PROJECT_ID,
        title: "t4code",
        archivedAt: null,
      },
      {
        environmentId: HOME_ENV_ID,
        id: HOME_PROJECT_ID,
        title: "t4code",
        archivedAt: null,
      },
    ] as never,
  // Home has a NEWER thread than Work — previously this silently hijacked reviewEnvironmentId
  // away from Work and hid all Work todos when switching Calendar -> Timeline.
  useQuietThreadShells: () =>
    [
      {
        environmentId: WORK_ENV_ID,
        projectId: WORK_PROJECT_ID,
        id: ThreadId.make("thread-work"),
        title: "Work thread",
        archivedAt: null,
        deletedAt: null,
        updatedAt: IsoDateTime.make("2026-11-28T08:00:00.000Z"),
      },
      {
        environmentId: HOME_ENV_ID,
        projectId: HOME_PROJECT_ID,
        id: ThreadId.make("thread-home"),
        title: "Home newer thread",
        archivedAt: null,
        deletedAt: null,
        updatedAt: IsoDateTime.make("2026-11-28T09:59:59.000Z"),
      },
    ] as never,
  useServerConfigs: () =>
    new Map([
      [WORK_ENV_ID, { environment: { capabilities: { projectTodos: true } } }],
      [HOME_ENV_ID, { environment: { capabilities: { projectTodos: true } } }],
    ]) as never,
}));

vi.mock(import("~/state/environments"), async (importOriginal) => ({
  ...(await importOriginal()),
  useProjectTodosSupported: () => true,
  useEnvironments: () =>
    ({
      environments: [
        {
          environmentId: WORK_ENV_ID,
          label: "Work",
          serverConfig: { environment: { capabilities: { projectTodos: true } } },
        },
        {
          environmentId: HOME_ENV_ID,
          label: "Home MBP",
          serverConfig: { environment: { capabilities: { projectTodos: true } } },
        },
      ],
    }) as never,
}));

vi.mock(import("~/state/session"), async (importOriginal) => ({
  ...(await importOriginal()),
  useEnvironmentScope: () => true,
  useEnvironmentsWithScope: () => new Set([WORK_ENV_ID, HOME_ENV_ID]),
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
  useMultiEnvironmentProjectTodoDailyReview: (
    targets: ReadonlyArray<ProjectTodoDailyReviewTarget>,
  ) => {
    requestedEnvSets.push(targets.map((target) => target.environmentId));
    const calendarItems = targets.flatMap((target) =>
      (itemsByEnvironment.get(target.environmentId) ?? []).map((item) => ({
        environmentId: target.environmentId,
        item,
      })),
    );
    return {
      calendarItems,
      linkedActive: [],
      staleOpen: [],
      pinnedNotes: [],
      calendarTruncated: false,
      isPending: false,
      hasLoadedAny: true,
      error: null,
      refresh: vi.fn(),
    };
  },
  useProjectTodoList: () => ({
    data: { items: [workTodo], nextCursor: null, hasMore: false },
    dataUpdatedAt: 0,
    error: null,
    failure: null,
    isPending: false,
    isSuccess: true,
    refresh: vi.fn(),
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
  useAtomCommand: () => vi.fn(),
}));

describe("ProjectTodosPage multi-environment aggregation", () => {
  it("aggregates todos across all connected environments in Calendar and Timeline even when a remote machine has newer thread activity", async () => {
    requestedEnvSets.length = 0;

    await using _screen = await render(
      <SidebarProvider>
        <ProjectTodosPage />
      </SidebarProvider>,
      { router: "/todos" },
    );

    // Calendar view shows both Work and Home todos under "All environments"
    await expect.element(page.getByText("Optimize model picker on Work")).toBeVisible();
    await expect.element(page.getByText("Review PR from Home MBP")).toBeVisible();

    // Switching to Timeline view keeps BOTH machines' todos visible and labels each machine
    await page.getByRole("button", { name: "Timeline" }).click();
    await expect.element(page.getByTestId("project-todos-timeline-by-day")).toBeVisible();
    await expect.element(page.getByText("Optimize model picker on Work")).toBeVisible();
    await expect.element(page.getByText("Review PR from Home MBP")).toBeVisible();
    await expect.element(page.getByText("Work", { exact: true }).first()).toBeVisible();
    await expect.element(page.getByText("Home MBP", { exact: true }).first()).toBeVisible();

    expect(
      requestedEnvSets.some((ids) => ids.includes(WORK_ENV_ID) && ids.includes(HOME_ENV_ID)),
    ).toBe(true);
  });
});
