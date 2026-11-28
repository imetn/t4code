import {
  scopeProjectRef,
  scopeThreadRef,
  scopedProjectKey,
} from "@t3tools/client-runtime/environment";
import {
  buildCalendarMonthGrid,
  localCalendarDayKey,
  localDateKeyFromIso,
  localDayWindowForCalendarDay,
  localMonthRangeForCalendar,
  shiftLocalCalendarMonth,
  todayLocalCalendarDay,
  type LocalCalendarDay,
} from "@t3tools/client-runtime/t4/project-todos";
import { isThreadWorking } from "@t3tools/client-runtime/state/thread-inbox";
import {
  AuthOrchestrationOperateScope,
  type EnvironmentId,
  type ProjectId,
  type ProjectTodoSummary,
  type ThreadId,
} from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { T, useGT } from "gt-react";
import {
  ArchiveIcon,
  BookmarkIcon,
  CalendarIcon,
  CheckCircle2Icon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleIcon,
  ExternalLinkIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  SendIcon,
} from "lucide-react";
import { useState, type FormEvent } from "react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { ScrollArea } from "~/components/ui/scroll-area";
import {
  Sheet,
  SheetDescription,
  SheetHeader,
  SheetPopup,
  SheetTitle,
} from "~/components/ui/sheet";
import { toastManager } from "~/components/ui/toast";
import { useNewThreadHandler } from "~/hooks/useHandleNewThread";
import { cn } from "~/lib/utils";
import { useProjects, useQuietThreadShells } from "~/state/entities";
import {
  loadProjectTodoDispatchPrompt,
  projectTodoEnvironment,
  useEnvironmentSupportsProjectTodos,
  useProjectTodoDailyReview,
} from "~/state/projectTodos";
import { formatEnvironmentQueryError } from "~/state/query";
import { useEnvironmentScope } from "~/state/session";
import { useAtomCommand } from "~/state/use-atom-command";
import { buildThreadRouteParams } from "~/threadRoutes";
import { newProjectTodoId, ProjectTodoFormDialog } from "./ProjectTodoFormDialog";

interface ProjectTodosCalendarViewProps {
  readonly environmentId: EnvironmentId | null;
  readonly projectId: ProjectId | null;
  readonly onRequestNewTodo?: (projectId?: ProjectId) => void;
}

const WEEKDAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const MAX_CELL_ITEMS = 3;

function formatMonthLabel(year: number, month: number): string {
  return new Intl.DateTimeFormat(undefined, { year: "numeric", month: "long" }).format(
    new Date(year, month - 1, 1),
  );
}

function formatFullDayLabel(day: LocalCalendarDay): string {
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    weekday: "short",
  }).format(new Date(day.year, day.month - 1, day.day));
}

function buildWeekdayHeaders(): ReadonlyArray<{ readonly key: string; readonly label: string }> {
  const formatter = new Intl.DateTimeFormat(undefined, { weekday: "short" });
  // 2026-01-05 is a Monday.
  return WEEKDAY_KEYS.map((key, offset) => ({
    key,
    label: formatter.format(new Date(2026, 0, 5 + offset)),
  }));
}

interface CalendarDayBucket {
  readonly unfinished: ProjectTodoSummary[];
  readonly completed: ProjectTodoSummary[];
}

export function ProjectTodosCalendarView(props: ProjectTodosCalendarViewProps) {
  const gt = useGT();
  const navigate = useNavigate();
  const handleNewThread = useNewThreadHandler();
  const projects = useProjects();
  const threads = useQuietThreadShells();

  const [today] = useState(() => todayLocalCalendarDay());
  const [visibleMonth, setVisibleMonth] = useState<{
    readonly year: number;
    readonly month: number;
  }>(() => ({ year: today.year, month: today.month }));
  const [activeDay, setActiveDay] = useState<LocalCalendarDay | null>(null);
  const [editingItem, setEditingItem] = useState<ProjectTodoSummary | null>(null);
  const [quickTitle, setQuickTitle] = useState("");
  const [quickProjectId, setQuickProjectId] = useState<ProjectId | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const supported = useEnvironmentSupportsProjectTodos(props.environmentId);
  const canOperate = useEnvironmentScope(props.environmentId, AuthOrchestrationOperateScope);

  const todayKey = localCalendarDayKey(today);
  const dayBounds = localDayWindowForCalendarDay(activeDay ?? today);
  const monthBounds = localMonthRangeForCalendar(visibleMonth.year, visibleMonth.month);
  const calendarCells = buildCalendarMonthGrid(visibleMonth.year, visibleMonth.month);
  const weekdayHeaders = buildWeekdayHeaders();

  const reviewQuery = useProjectTodoDailyReview(
    props.environmentId !== null
      ? {
          environmentId: props.environmentId,
          input: {
            ...(props.projectId !== null ? { projectId: props.projectId } : {}),
            dayStartIso: dayBounds.dayStartIso,
            dayEndIso: dayBounds.dayEndIso,
            rangeStartIso: monthBounds.rangeStartIso,
            rangeEndIso: monthBounds.rangeEndIso,
          },
        }
      : null,
  );

  const createCommand = useAtomCommand(projectTodoEnvironment.create, { reportFailure: false });
  const updateCommand = useAtomCommand(projectTodoEnvironment.update, { reportFailure: false });

  const envProjects = projects.filter(
    (project) =>
      props.environmentId !== null &&
      project.environmentId === props.environmentId &&
      project.archivedAt === null &&
      !project.isScratch,
  );
  const projectNameById = new Map(
    envProjects.map((project) => [project.id, project.title] as const),
  );
  const threadById = new Map(
    threads
      .filter(
        (thread) => props.environmentId !== null && thread.environmentId === props.environmentId,
      )
      .map((thread) => [thread.id, thread] as const),
  );

  const byDayKey = new Map<string, CalendarDayBucket>();
  let monthUnfinishedCount = 0;
  let monthCompletedCount = 0;

  for (const item of reviewQuery.data?.calendarItems ?? []) {
    const isCompleted = item.completedAt !== null;
    const targetKey = isCompleted
      ? localDateKeyFromIso(item.completedAt!)
      : localDateKeyFromIso(item.createdAt);
    let bucket = byDayKey.get(targetKey);
    if (bucket === undefined) {
      bucket = { unfinished: [], completed: [] };
      byDayKey.set(targetKey, bucket);
    }
    if (isCompleted) {
      bucket.completed.push(item);
      monthCompletedCount += 1;
    } else {
      bucket.unfinished.push(item);
      monthUnfinishedCount += 1;
    }
  }

  for (const bucket of byDayKey.values()) {
    bucket.unfinished.sort((left, right) => {
      if (left.priority !== right.priority) return left.priority === "high" ? -1 : 1;
      if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
      return right.createdAt.localeCompare(left.createdAt);
    });
    bucket.completed.sort((left, right) =>
      (right.completedAt ?? right.updatedAt).localeCompare(left.completedAt ?? left.updatedAt),
    );
  }

  if (props.environmentId === null || !supported) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-xs text-muted-foreground">
        <T>Select a T4 Code environment to view the project todo calendar.</T>
      </div>
    );
  }

  const effectiveQuickProjectId = props.projectId ?? quickProjectId ?? envProjects[0]?.id ?? null;

  const handleToggleCompleted = async (item: ProjectTodoSummary) => {
    if (!canOperate) return;
    const result = await updateCommand({
      environmentId: props.environmentId!,
      input: {
        id: item.id,
        projectId: item.projectId,
        expectedRevision: item.revision,
        completed: item.completedAt === null,
      },
    });
    if (result._tag === "Failure") {
      toastManager.add({
        type: "error",
        title: gt("Update failed"),
        description: formatEnvironmentQueryError(result.cause),
      });
    }
    reviewQuery.refresh();
  };

  const handleArchive = async (item: ProjectTodoSummary) => {
    if (!canOperate) return;
    const result = await updateCommand({
      environmentId: props.environmentId!,
      input: {
        id: item.id,
        projectId: item.projectId,
        expectedRevision: item.revision,
        archived: true,
      },
    });
    if (result._tag === "Failure") {
      toastManager.add({
        type: "error",
        title: gt("Update failed"),
        description: formatEnvironmentQueryError(result.cause),
      });
    }
    reviewQuery.refresh();
  };

  const handleDispatch = async (item: ProjectTodoSummary) => {
    const prompt = await loadProjectTodoDispatchPrompt(props.environmentId!, item);
    await handleNewThread(scopeProjectRef(props.environmentId!, item.projectId), {
      prompt,
    });
  };

  const handleOpenThread = (threadId: ThreadId) => {
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(scopeThreadRef(props.environmentId!, threadId)),
    });
  };

  const handleQuickAddInSheet = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = quickTitle.trim();
    if (trimmed.length === 0 || effectiveQuickProjectId === null || !canOperate || isCreating) {
      return;
    }
    setIsCreating(true);
    const result = await createCommand({
      environmentId: props.environmentId!,
      input: {
        id: newProjectTodoId(),
        projectId: effectiveQuickProjectId,
        title: trimmed,
        kind: "todo",
      },
    });
    setIsCreating(false);
    if (result._tag === "Success") {
      setQuickTitle("");
      toastManager.add({ type: "success", title: gt("Todo added") });
      reviewQuery.refresh();
      return;
    }
    toastManager.add({
      type: "error",
      title: gt("Could not save item"),
      description: formatEnvironmentQueryError(result.cause),
    });
  };

  const activeDayKey = activeDay !== null ? localCalendarDayKey(activeDay) : null;
  const activeDayBucket =
    activeDayKey !== null
      ? (byDayKey.get(activeDayKey) ?? { unfinished: [], completed: [] })
      : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border/50 px-4 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            <Button
              type="button"
              size="icon-xs"
              variant="outline"
              aria-label={gt("Previous month")}
              onClick={() =>
                setVisibleMonth((prev) => shiftLocalCalendarMonth(prev.year, prev.month, -1))
              }
            >
              <ChevronLeftIcon className="size-3.5" />
            </Button>
            <Button
              type="button"
              size="xs"
              variant="outline"
              onClick={() => setVisibleMonth({ year: today.year, month: today.month })}
            >
              <T>Today</T>
            </Button>
            <Button
              type="button"
              size="icon-xs"
              variant="outline"
              aria-label={gt("Next month")}
              onClick={() =>
                setVisibleMonth((prev) => shiftLocalCalendarMonth(prev.year, prev.month, 1))
              }
            >
              <ChevronRightIcon className="size-3.5" />
            </Button>
          </div>

          <h2 className="text-sm font-semibold tracking-tight text-foreground">
            {formatMonthLabel(visibleMonth.year, visibleMonth.month)}
          </h2>

          <div className="hidden items-center gap-1.5 sm:flex">
            <Badge size="sm" variant="warning">
              {gt("{count} unfinished", { count: monthUnfinishedCount })}
            </Badge>
            <Badge size="sm" variant="success">
              {gt("{count} completed", { count: monthCompletedCount })}
            </Badge>
          </div>

          {reviewQuery.data?.calendarTruncated ? (
            <Badge size="sm" variant="secondary">
              <T>Showing latest 200 items</T>
            </Badge>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          <div className="hidden items-center gap-3 text-2xs text-muted-foreground lg:flex">
            <span className="inline-flex items-center gap-1">
              <CircleIcon className="size-3 text-warning" />
              <span>
                <T>Unfinished</T>
              </span>
            </span>
            <span className="inline-flex items-center gap-1">
              <CheckCircle2Icon className="size-3 text-success" />
              <span>
                <T>Completed</T>
              </span>
            </span>
          </div>

          <Button type="button" size="xs" variant="outline" onClick={() => reviewQuery.refresh()}>
            <RefreshCwIcon className="size-3" />
            <span>
              <T>Refresh</T>
            </span>
          </Button>
        </div>
      </div>

      {reviewQuery.error ? (
        <div className="mx-4 mt-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {reviewQuery.error}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col overflow-auto">
        <div className="grid min-w-180 shrink-0 grid-cols-7 border-b border-border/60 bg-muted/20">
          {weekdayHeaders.map((weekday) => (
            <div
              key={weekday.key}
              className="border-r border-border/40 px-2.5 py-1.5 text-xs font-medium text-muted-foreground last:border-r-0"
            >
              {weekday.label}
            </div>
          ))}
        </div>

        <div
          data-testid="project-todos-calendar-grid"
          className="grid min-h-0 min-w-180 flex-1 grid-cols-7 grid-rows-6"
        >
          {calendarCells.map((cell) => {
            const isTodayCell = cell.key === todayKey;
            const bucket = byDayKey.get(cell.key);
            const unfinished = bucket?.unfinished ?? [];
            const completed = bucket?.completed ?? [];
            const combined = [...unfinished, ...completed];
            const visibleItems = combined.slice(0, MAX_CELL_ITEMS);
            const overflowCount = Math.max(0, combined.length - visibleItems.length);

            return (
              <div
                key={cell.key}
                data-calendar-day={cell.key}
                onClick={() => setActiveDay(cell)}
                className={cn(
                  "group/day relative flex min-h-28 cursor-pointer flex-col gap-1 border-r border-b border-border/50 p-1.5 transition-colors hover:bg-accent/25",
                  !cell.inMonth && "bg-muted/20 text-muted-foreground/60",
                  isTodayCell && "bg-primary/5",
                )}
              >
                <div className="flex items-center justify-between gap-1">
                  <button
                    type="button"
                    aria-label={cell.key}
                    onClick={(event) => {
                      event.stopPropagation();
                      setActiveDay(cell);
                    }}
                    className={cn(
                      "inline-flex size-6 items-center justify-center rounded-full text-xs font-medium transition-colors",
                      isTodayCell
                        ? "bg-primary font-semibold text-primary-foreground"
                        : cell.inMonth
                          ? "text-foreground hover:bg-accent"
                          : "text-muted-foreground/60 hover:bg-accent",
                    )}
                  >
                    {cell.day}
                  </button>

                  <div className="flex items-center gap-1">
                    {unfinished.length > 0 ? (
                      <span
                        aria-label={gt("{count} unfinished", { count: unfinished.length })}
                        className="inline-flex items-center gap-0.5 rounded-full bg-warning/15 px-1.5 py-0.5 text-3xs font-medium text-warning"
                      >
                        <CircleIcon className="size-2.5" />
                        <span>{unfinished.length}</span>
                      </span>
                    ) : null}
                    {completed.length > 0 ? (
                      <span
                        aria-label={gt("{count} completed", { count: completed.length })}
                        className="inline-flex items-center gap-0.5 rounded-full bg-success/15 px-1.5 py-0.5 text-3xs font-medium text-success"
                      >
                        <CheckCircle2Icon className="size-2.5" />
                        <span>{completed.length}</span>
                      </span>
                    ) : null}
                    {canOperate && props.onRequestNewTodo !== undefined ? (
                      <button
                        type="button"
                        aria-label={gt("Add todo on {date}", { date: cell.key })}
                        onClick={(event) => {
                          event.stopPropagation();
                          props.onRequestNewTodo?.(props.projectId ?? undefined);
                        }}
                        className="inline-flex size-5 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover/day:opacity-100 focus-visible:opacity-100"
                      >
                        <PlusIcon className="size-3" />
                      </button>
                    ) : null}
                  </div>
                </div>

                <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-hidden">
                  {visibleItems.map((item) => {
                    const isCompleted = item.completedAt !== null;
                    const projectTitle =
                      props.projectId === null ? projectNameById.get(item.projectId) : undefined;
                    return (
                      <div
                        key={item.id}
                        onClick={(event) => event.stopPropagation()}
                        className={cn(
                          "flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-left text-2xs transition-colors",
                          isCompleted
                            ? "border-success/25 bg-success/10 text-muted-foreground"
                            : item.priority === "high"
                              ? "border-warning/40 bg-warning/10 text-foreground"
                              : "border-border/70 bg-card/95 text-foreground hover:border-border",
                        )}
                      >
                        {canOperate ? (
                          <button
                            type="button"
                            aria-label={isCompleted ? gt("Mark as open") : gt("Mark as completed")}
                            onClick={() => void handleToggleCompleted(item)}
                            className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
                          >
                            {isCompleted ? (
                              <CheckCircle2Icon className="size-3 text-success" />
                            ) : (
                              <CircleIcon className="size-3 text-warning" />
                            )}
                          </button>
                        ) : (
                          <span className="shrink-0">
                            {isCompleted ? (
                              <CheckCircle2Icon className="size-3 text-success" />
                            ) : (
                              <CircleIcon className="size-3 text-warning" />
                            )}
                          </span>
                        )}

                        <button
                          type="button"
                          onClick={() => setEditingItem(item)}
                          className="flex min-w-0 flex-1 items-center gap-1 text-left"
                        >
                          {item.kind === "note" ? (
                            <BookmarkIcon className="size-2.5 shrink-0 text-muted-foreground" />
                          ) : null}
                          <span
                            className={cn(
                              "min-w-0 flex-1 truncate leading-snug",
                              isCompleted && "line-through",
                            )}
                          >
                            {item.title}
                          </span>
                          {projectTitle ? (
                            <span className="hidden max-w-14 shrink-0 truncate rounded bg-muted px-1 text-3xs text-muted-foreground xl:inline">
                              {projectTitle}
                            </span>
                          ) : null}
                        </button>
                      </div>
                    );
                  })}

                  {overflowCount > 0 ? (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setActiveDay(cell);
                      }}
                      className="px-1 text-left text-3xs font-medium text-muted-foreground hover:text-foreground"
                    >
                      {gt("+{count} more", { count: overflowCount })}
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <Sheet
        open={activeDay !== null}
        onOpenChange={(open) => {
          if (!open) setActiveDay(null);
        }}
      >
        <SheetPopup side="right" className="w-full max-w-md">
          <SheetHeader>
            <SheetTitle>
              <span className="inline-flex items-center gap-2">
                <CalendarIcon className="size-4 text-muted-foreground" />
                <span>{activeDay !== null ? formatFullDayLabel(activeDay) : ""}</span>
              </span>
            </SheetTitle>
            <SheetDescription>
              <T>
                Review unfinished and completed items for this day. Draft in thread prefills the
                composer without sending.
              </T>
            </SheetDescription>
          </SheetHeader>

          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden px-4 pb-4">
            {canOperate && effectiveQuickProjectId !== null ? (
              <form
                onSubmit={(event) => void handleQuickAddInSheet(event)}
                className="flex flex-col gap-2 rounded-lg border border-border/60 bg-muted/15 p-2.5"
              >
                {props.projectId === null && envProjects.length > 1 ? (
                  <select
                    aria-label={gt("Project")}
                    value={effectiveQuickProjectId}
                    onChange={(event) => setQuickProjectId(event.currentTarget.value as ProjectId)}
                    className="h-7 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:ring-2 focus:ring-inset focus:ring-ring"
                  >
                    {envProjects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.title}
                      </option>
                    ))}
                  </select>
                ) : null}
                <div className="flex items-center gap-1.5">
                  <Input
                    value={quickTitle}
                    onChange={(event) => setQuickTitle(event.currentTarget.value)}
                    placeholder={gt("Capture idea or todo, press Enter...")}
                    size="sm"
                    className="min-w-0 flex-1"
                    disabled={isCreating}
                  />
                  <Button
                    type="submit"
                    size="xs"
                    disabled={isCreating || quickTitle.trim().length === 0}
                  >
                    <PlusIcon className="size-3.5" />
                    <span>
                      <T>Add</T>
                    </span>
                  </Button>
                </div>
              </form>
            ) : null}

            <ScrollArea className="min-h-0 flex-1">
              <div className="flex flex-col gap-4 pr-1">
                <section className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-foreground/90">
                      <CircleIcon className="size-3.5 text-warning" />
                      <span>
                        <T>Unfinished</T>
                      </span>
                    </div>
                    <Badge size="sm" variant="warning">
                      {activeDayBucket?.unfinished.length ?? 0}
                    </Badge>
                  </div>

                  {(activeDayBucket?.unfinished.length ?? 0) === 0 ? (
                    <p className="rounded-lg border border-dashed border-border/60 px-3 py-4 text-center text-xs text-muted-foreground">
                      <T>No unfinished items recorded on this day.</T>
                    </p>
                  ) : (
                    activeDayBucket!.unfinished.map((item) => {
                      const projectTitle = projectNameById.get(item.projectId);
                      const linkedThread =
                        item.linkedThreadId !== null
                          ? (threadById.get(item.linkedThreadId) ?? null)
                          : null;
                      const linkedSettled =
                        linkedThread !== null &&
                        linkedThread.settledOverride === "settled" &&
                        !isThreadWorking(linkedThread);
                      return (
                        <div
                          key={`open:${scopedProjectKey(scopeProjectRef(props.environmentId!, item.projectId))}:${item.id}`}
                          className="flex flex-col gap-1.5 rounded-lg border border-border/70 bg-card/95 p-2.5"
                        >
                          <div className="flex items-start gap-2">
                            {canOperate ? (
                              <button
                                type="button"
                                aria-label={gt("Mark as completed")}
                                onClick={() => void handleToggleCompleted(item)}
                                className="mt-0.5 shrink-0 text-warning transition-colors hover:text-success"
                              >
                                <CircleIcon className="size-4" />
                              </button>
                            ) : (
                              <CircleIcon className="mt-0.5 size-4 shrink-0 text-warning" />
                            )}
                            <div className="min-w-0 flex-1">
                              <button
                                type="button"
                                onClick={() => setEditingItem(item)}
                                className="text-left text-xs font-medium text-foreground hover:underline"
                              >
                                {item.title}
                              </button>
                              {item.bodyPreview.length > 0 ? (
                                <p className="mt-0.5 line-clamp-2 text-2xs text-muted-foreground">
                                  {item.bodyPreview}
                                </p>
                              ) : null}
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center justify-between gap-1.5 pl-6">
                            <div className="flex flex-wrap items-center gap-1.5">
                              {projectTitle ? (
                                <Badge size="sm" variant="secondary">
                                  {projectTitle}
                                </Badge>
                              ) : null}
                              {item.linkedThreadId !== null ? (
                                <Button
                                  type="button"
                                  size="xs"
                                  variant="ghost"
                                  onClick={() => handleOpenThread(item.linkedThreadId!)}
                                >
                                  <ExternalLinkIcon className="size-3" />
                                  <span className="max-w-28 truncate">
                                    {linkedThread ? linkedThread.title : gt("Linked thread")}
                                  </span>
                                </Button>
                              ) : null}
                            </div>

                            <div className="flex items-center gap-1">
                              <Button
                                type="button"
                                size="xs"
                                variant="outline"
                                onClick={() => void handleDispatch(item)}
                              >
                                <SendIcon className="size-3" />
                                <span>
                                  <T>Draft in thread</T>
                                </span>
                              </Button>
                              {canOperate && linkedSettled ? (
                                <Button
                                  type="button"
                                  size="xs"
                                  variant="secondary"
                                  onClick={() => void handleToggleCompleted(item)}
                                >
                                  <T>Mark done?</T>
                                </Button>
                              ) : null}
                              {canOperate ? (
                                <Button
                                  type="button"
                                  size="icon-xs"
                                  variant="ghost"
                                  aria-label={gt("Edit item")}
                                  onClick={() => setEditingItem(item)}
                                >
                                  <PencilIcon className="size-3" />
                                </Button>
                              ) : null}
                              {canOperate ? (
                                <Button
                                  type="button"
                                  size="icon-xs"
                                  variant="ghost"
                                  aria-label={gt("Archive item")}
                                  onClick={() => void handleArchive(item)}
                                >
                                  <ArchiveIcon className="size-3" />
                                </Button>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </section>

                <section className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-foreground/90">
                      <CheckCircle2Icon className="size-3.5 text-success" />
                      <span>
                        <T>Completed</T>
                      </span>
                    </div>
                    <Badge size="sm" variant="success">
                      {activeDayBucket?.completed.length ?? 0}
                    </Badge>
                  </div>

                  {(activeDayBucket?.completed.length ?? 0) === 0 ? (
                    <p className="rounded-lg border border-dashed border-border/60 px-3 py-4 text-center text-xs text-muted-foreground">
                      <T>Nothing completed on this date.</T>
                    </p>
                  ) : (
                    activeDayBucket!.completed.map((item) => {
                      const projectTitle = projectNameById.get(item.projectId);
                      return (
                        <div
                          key={`done:${scopedProjectKey(scopeProjectRef(props.environmentId!, item.projectId))}:${item.id}`}
                          className="flex items-center justify-between gap-2 rounded-lg border border-success/25 bg-success/5 p-2.5"
                        >
                          <div className="flex min-w-0 flex-1 items-start gap-2">
                            {canOperate ? (
                              <button
                                type="button"
                                aria-label={gt("Mark as open")}
                                onClick={() => void handleToggleCompleted(item)}
                                className="mt-0.5 shrink-0 text-success transition-colors hover:text-muted-foreground"
                              >
                                <CheckCircle2Icon className="size-4" />
                              </button>
                            ) : (
                              <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-success" />
                            )}
                            <div className="min-w-0 flex-1">
                              <button
                                type="button"
                                onClick={() => setEditingItem(item)}
                                className="text-left text-xs text-muted-foreground line-through hover:text-foreground"
                              >
                                {item.title}
                              </button>
                              {projectTitle ? (
                                <div className="mt-1">
                                  <Badge size="sm" variant="secondary">
                                    {projectTitle}
                                  </Badge>
                                </div>
                              ) : null}
                            </div>
                          </div>

                          {canOperate ? (
                            <div className="flex shrink-0 items-center gap-0.5">
                              <Button
                                type="button"
                                size="icon-xs"
                                variant="ghost"
                                aria-label={gt("Edit item")}
                                onClick={() => setEditingItem(item)}
                              >
                                <PencilIcon className="size-3" />
                              </Button>
                              <Button
                                type="button"
                                size="icon-xs"
                                variant="ghost"
                                aria-label={gt("Archive item")}
                                onClick={() => void handleArchive(item)}
                              >
                                <ArchiveIcon className="size-3" />
                              </Button>
                            </div>
                          ) : null}
                        </div>
                      );
                    })
                  )}
                </section>
              </div>
            </ScrollArea>
          </div>
        </SheetPopup>
      </Sheet>

      {editingItem !== null ? (
        <ProjectTodoFormDialog
          open
          onOpenChange={(open) => {
            if (!open) setEditingItem(null);
          }}
          environmentId={props.environmentId}
          projectId={editingItem.projectId}
          {...(projectNameById.get(editingItem.projectId) !== undefined
            ? { projectName: projectNameById.get(editingItem.projectId)! }
            : {})}
          editSummary={editingItem}
          onSaved={() => reviewQuery.refresh()}
          onDeleted={() => reviewQuery.refresh()}
        />
      ) : null}
    </div>
  );
}
