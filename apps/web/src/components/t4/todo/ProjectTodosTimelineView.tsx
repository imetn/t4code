import {
  scopeProjectRef,
  scopeThreadRef,
  scopedProjectKey,
} from "@t3tools/client-runtime/environment";
import {
  localCalendarDayKey,
  localDateKeyFromIso,
  localDayWindowForCalendarDay,
  localMonthRangeForCalendar,
  shiftLocalCalendarDay,
  shiftLocalCalendarMonth,
  todayLocalCalendarDay,
} from "@t3tools/client-runtime/t4/project-todos";
import { isThreadWorking } from "@t3tools/client-runtime/state/thread-inbox";
import {
  AuthOrchestrationOperateScope,
  type EnvironmentId,
  type IsoDateTime,
  type ProjectId,
  type ProjectTodoSummary,
  type ThreadId,
} from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { T, useGT } from "gt-react";
import {
  ArchiveIcon,
  BookmarkIcon,
  CalendarDaysIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleIcon,
  ExternalLinkIcon,
  FileCode2Icon,
  LayersIcon,
  Link2Icon,
  PencilIcon,
  PinIcon,
  RefreshCwIcon,
  SearchIcon,
  SendIcon,
  XIcon,
} from "lucide-react";
import { useState } from "react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "~/components/ui/input-group";
import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "~/components/ui/menu";
import { ScrollArea } from "~/components/ui/scroll-area";
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
import { ProjectTodoFormDialog } from "./ProjectTodoFormDialog";

interface ProjectTodosTimelineViewProps {
  readonly environmentId: EnvironmentId | null;
  readonly projectId: ProjectId | null;
}

type TimelineGroupMode = "by-day" | "by-status";
type TimelineStatusFilter = "all" | "unfinished" | "completed";

function formatMonthLabel(year: number, month: number): string {
  return new Intl.DateTimeFormat(undefined, { year: "numeric", month: "long" }).format(
    new Date(year, month - 1, 1),
  );
}

function formatDateKeyHeading(
  dateKey: string,
  todayKey: string,
  yesterdayKey: string,
  gt: ReturnType<typeof useGT>,
): string {
  const [yearStr, monthStr, dayStr] = dateKey.split("-");
  const date = new Date(Number(yearStr), Number(monthStr) - 1, Number(dayStr));
  const formatted = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    weekday: "short",
  }).format(date);
  if (dateKey === todayKey) return gt("Today ({date})", { date: formatted });
  if (dateKey === yesterdayKey) return gt("Yesterday ({date})", { date: formatted });
  return formatted;
}

function formatShortDateFromIso(iso: IsoDateTime): string {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return iso.slice(0, 10);
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(new Date(parsed));
}

function formatTimeFromIso(iso: IsoDateTime): string {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return "";
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(parsed));
}

export function ProjectTodosTimelineView(props: ProjectTodosTimelineViewProps) {
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
  const [groupMode, setGroupMode] = useState<TimelineGroupMode>("by-day");
  const [statusFilter, setStatusFilter] = useState<TimelineStatusFilter>("all");
  const [searchText, setSearchText] = useState("");
  const [editingItem, setEditingItem] = useState<ProjectTodoSummary | null>(null);

  const supported = useEnvironmentSupportsProjectTodos(props.environmentId);
  const canOperate = useEnvironmentScope(props.environmentId, AuthOrchestrationOperateScope);

  const todayKey = localCalendarDayKey(today);
  const yesterdayKey = localCalendarDayKey(shiftLocalCalendarDay(today, -1));
  const dayBounds = localDayWindowForCalendarDay(today);
  const monthBounds = localMonthRangeForCalendar(visibleMonth.year, visibleMonth.month);

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

  const updateCommand = useAtomCommand(projectTodoEnvironment.update, { reportFailure: false });

  const projectNameById = new Map(
    projects
      .filter(
        (project) => props.environmentId !== null && project.environmentId === props.environmentId,
      )
      .map((project) => [project.id, project.title] as const),
  );
  const threadById = new Map(
    threads
      .filter(
        (thread) => props.environmentId !== null && thread.environmentId === props.environmentId,
      )
      .map((thread) => [thread.id, thread] as const),
  );

  if (props.environmentId === null || !supported) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-xs text-muted-foreground">
        <T>Select a T4 Code environment to view the project todo timeline.</T>
      </div>
    );
  }

  const data = reviewQuery.data;
  // Combine month items with all-time linked/stale/pinned items so status grouping never drops older unfinished tasks.
  const mergedMap = new Map<string, ProjectTodoSummary>();
  for (const item of data?.calendarItems ?? []) {
    mergedMap.set(item.id, item);
  }
  if (groupMode === "by-status") {
    for (const item of [
      ...(data?.linkedActive ?? []),
      ...(data?.staleOpen ?? []),
      ...(data?.pinnedNotes ?? []),
    ]) {
      if (!mergedMap.has(item.id)) {
        mergedMap.set(item.id, item);
      }
    }
  }

  const normalizedSearch = searchText.trim().toLowerCase();
  const filteredItems = [...mergedMap.values()].filter((item) => {
    if (statusFilter === "unfinished" && item.completedAt !== null) return false;
    if (statusFilter === "completed" && item.completedAt === null) return false;
    if (normalizedSearch.length > 0) {
      const projectTitle = projectNameById.get(item.projectId)?.toLowerCase() ?? "";
      const haystack = `${item.title}\n${item.bodyPreview}\n${projectTitle}`.toLowerCase();
      if (!haystack.includes(normalizedSearch)) return false;
    }
    return true;
  });

  // Group 1: Timeline grouped by local day (newest day first).
  const dayBucketsMap = new Map<
    string,
    { readonly dateKey: string; readonly items: ProjectTodoSummary[] }
  >();
  for (const item of filteredItems) {
    const key =
      item.completedAt !== null
        ? localDateKeyFromIso(item.completedAt)
        : localDateKeyFromIso(item.createdAt);
    let bucket = dayBucketsMap.get(key);
    if (bucket === undefined) {
      bucket = { dateKey: key, items: [] };
      dayBucketsMap.set(key, bucket);
    }
    bucket.items.push(item);
  }
  const dayGroups = [...dayBucketsMap.values()]
    .toSorted((left, right) => right.dateKey.localeCompare(left.dateKey))
    .map((group) => ({
      ...group,
      items: group.items.toSorted((left, right) => {
        const leftDone = left.completedAt !== null;
        const rightDone = right.completedAt !== null;
        if (leftDone !== rightDone) return leftDone ? 1 : -1;
        if (left.priority !== right.priority) return left.priority === "high" ? -1 : 1;
        return right.createdAt.localeCompare(left.createdAt);
      }),
    }));

  // Group 2: Grouped by task status (every item explicitly displays its creation date).
  const statusUnfinished = filteredItems
    .filter(
      (item) => item.completedAt === null && item.linkedThreadId === null && item.kind === "todo",
    )
    .toSorted((left, right) => {
      if (left.priority !== right.priority) return left.priority === "high" ? -1 : 1;
      return right.createdAt.localeCompare(left.createdAt);
    });
  const statusInProgress = filteredItems
    .filter((item) => item.completedAt === null && item.linkedThreadId !== null)
    .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const statusCompleted = filteredItems
    .filter((item) => item.completedAt !== null)
    .toSorted((left, right) =>
      (right.completedAt ?? right.updatedAt).localeCompare(left.completedAt ?? left.updatedAt),
    );
  const statusNotes = filteredItems
    .filter((item) => item.completedAt === null && item.kind === "note")
    .toSorted((left, right) => {
      if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
      return right.updatedAt.localeCompare(left.updatedAt);
    });

  const statusGroups: ReadonlyArray<{
    readonly key: string;
    readonly title: string;
    readonly emptyText: string;
    readonly badgeVariant: "warning" | "info" | "success" | "secondary";
    readonly icon: React.ReactNode;
    readonly items: ReadonlyArray<ProjectTodoSummary>;
  }> = [
    {
      key: "unfinished",
      title: gt("Unfinished"),
      emptyText: gt("No unfinished todos in this range."),
      badgeVariant: "warning",
      icon: <CircleIcon className="size-3.5 text-warning" />,
      items: statusUnfinished,
    },
    {
      key: "in-progress",
      title: gt("Linked in progress"),
      emptyText: gt("No open todos linked to active threads."),
      badgeVariant: "info",
      icon: <Link2Icon className="size-3.5 text-info" />,
      items: statusInProgress,
    },
    {
      key: "completed",
      title: gt("Completed"),
      emptyText: gt("No completed todos in this range."),
      badgeVariant: "success",
      icon: <CheckCircle2Icon className="size-3.5 text-success" />,
      items: statusCompleted,
    },
    {
      key: "notes",
      title: gt("Project memory notes"),
      emptyText: gt("No active project memory notes."),
      badgeVariant: "secondary",
      icon: <PinIcon className="size-3.5 text-primary" />,
      items: statusNotes,
    },
  ];

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

  const renderCard = (item: ProjectTodoSummary, showFullDateBadge: boolean) => {
    const isCompleted = item.completedAt !== null;
    const projectTitle = projectNameById.get(item.projectId);
    const linkedThread =
      item.linkedThreadId !== null ? (threadById.get(item.linkedThreadId) ?? null) : null;
    const linkedSettled =
      linkedThread !== null &&
      linkedThread.settledOverride === "settled" &&
      !isThreadWorking(linkedThread);
    const createdDateLabel = formatShortDateFromIso(item.createdAt);
    const createdTimeLabel = formatTimeFromIso(item.createdAt);
    const completedDateLabel =
      item.completedAt !== null ? formatShortDateFromIso(item.completedAt) : null;

    return (
      <div
        key={`${groupMode}:${scopedProjectKey(scopeProjectRef(props.environmentId!, item.projectId))}:${item.id}`}
        data-timeline-item={item.id}
        className={cn(
          "flex flex-col gap-1.5 rounded-lg border p-3 transition-colors",
          isCompleted
            ? "border-success/25 bg-success/5"
            : item.priority === "high"
              ? "border-warning/40 bg-warning/5"
              : "border-border/70 bg-card/95",
        )}
      >
        <div className="flex items-start gap-2">
          {canOperate ? (
            <button
              type="button"
              aria-label={isCompleted ? gt("Mark as open") : gt("Mark as completed")}
              onClick={() => void handleToggleCompleted(item)}
              className="mt-0.5 shrink-0 text-muted-foreground transition-colors hover:text-foreground"
            >
              {isCompleted ? (
                <CheckCircle2Icon className="size-4 text-success" />
              ) : (
                <CircleIcon className="size-4 text-warning" />
              )}
            </button>
          ) : (
            <span className="mt-0.5 shrink-0">
              {isCompleted ? (
                <CheckCircle2Icon className="size-4 text-success" />
              ) : (
                <CircleIcon className="size-4 text-warning" />
              )}
            </span>
          )}

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setEditingItem(item)}
                className={cn(
                  "text-left text-xs font-medium leading-snug hover:underline",
                  isCompleted ? "text-muted-foreground line-through" : "text-foreground",
                )}
              >
                {item.title}
              </button>
              {item.kind === "note" ? (
                <Badge size="sm" variant="secondary">
                  <BookmarkIcon className="size-2.5" />
                  <span>
                    <T>Note</T>
                  </span>
                </Badge>
              ) : null}
              {item.priority === "high" && !isCompleted ? (
                <Badge size="sm" variant="warning">
                  <T>High</T>
                </Badge>
              ) : null}
              {item.pinned ? (
                <Badge size="sm" variant="outline">
                  <PinIcon className="size-2.5" />
                  <span>
                    <T>Pinned</T>
                  </span>
                </Badge>
              ) : null}
            </div>

            {item.bodyPreview.length > 0 ? (
              <p className="mt-1 line-clamp-2 text-2xs leading-relaxed text-muted-foreground">
                {item.bodyPreview}
              </p>
            ) : null}

            {item.fileRefs.length > 0 ? (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {item.fileRefs.slice(0, 3).map((ref) => (
                  <span
                    key={ref}
                    className="inline-flex max-w-full items-center gap-1 truncate rounded bg-muted px-1.5 py-0.5 font-mono text-3xs text-muted-foreground"
                  >
                    <FileCode2Icon className="size-2.5 shrink-0" />
                    <span className="truncate">{ref}</span>
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pl-6 pt-0.5">
          <div className="flex flex-wrap items-center gap-1.5 text-2xs text-muted-foreground">
            {projectTitle ? (
              <Badge size="sm" variant="secondary">
                {projectTitle}
              </Badge>
            ) : null}

            {showFullDateBadge ? (
              <Badge size="sm" variant="outline">
                {gt("Created {date}", { date: createdDateLabel })}
              </Badge>
            ) : (
              <span>
                {gt("Created {date} {time}", {
                  date: createdDateLabel,
                  time: createdTimeLabel,
                })}
              </span>
            )}

            {completedDateLabel !== null ? (
              <Badge size="sm" variant="success">
                {gt("Completed {date}", { date: completedDateLabel })}
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
                <span className="max-w-32 truncate">
                  {linkedThread ? linkedThread.title : gt("Linked thread")}
                </span>
              </Button>
            ) : null}
          </div>

          <div className="flex items-center gap-1">
            {!isCompleted ? (
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
            ) : null}
            {canOperate && linkedSettled && !isCompleted ? (
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
  };

  const statusFilterLabel =
    statusFilter === "unfinished"
      ? gt("Unfinished")
      : statusFilter === "completed"
        ? gt("Completed")
        : gt("All", { $context: "todo filter" });

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="mx-auto flex w-full max-w-5xl shrink-0 flex-wrap items-center justify-between gap-2 px-5 pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-0.5">
            <Button
              type="button"
              size="xs"
              variant={groupMode === "by-day" ? "secondary" : "ghost"}
              onClick={() => setGroupMode("by-day")}
            >
              <CalendarDaysIcon className="size-3.5" />
              <span>
                <T>Group by day</T>
              </span>
            </Button>
            <Button
              type="button"
              size="xs"
              variant={groupMode === "by-status" ? "secondary" : "ghost"}
              onClick={() => setGroupMode("by-status")}
            >
              <LayersIcon className="size-3.5" />
              <span>
                <T>Group by status</T>
              </span>
            </Button>
          </div>

          <div className="flex items-center gap-0.5">
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              aria-label={gt("Previous month")}
              onClick={() =>
                setVisibleMonth((prev) => shiftLocalCalendarMonth(prev.year, prev.month, -1))
              }
            >
              <ChevronLeftIcon className="size-3.5" />
            </Button>
            <span className="min-w-24 text-center text-xs font-medium text-foreground">
              {formatMonthLabel(visibleMonth.year, visibleMonth.month)}
            </span>
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              aria-label={gt("Next month")}
              onClick={() =>
                setVisibleMonth((prev) => shiftLocalCalendarMonth(prev.year, prev.month, 1))
              }
            >
              <ChevronRightIcon className="size-3.5" />
            </Button>
            <Button
              type="button"
              size="xs"
              variant="ghost"
              onClick={() => setVisibleMonth({ year: today.year, month: today.month })}
            >
              <T>Today</T>
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <Menu>
            <MenuTrigger
              render={
                <Button type="button" size="xs" variant="outline">
                  <span>{statusFilterLabel}</span>
                  <ChevronDownIcon className="size-3 opacity-70" />
                </Button>
              }
            />
            <MenuPopup align="end">
              <MenuRadioGroup
                value={statusFilter}
                onValueChange={(value) => setStatusFilter(value as TimelineStatusFilter)}
              >
                <MenuRadioItem value="all">
                  <T context="todo filter">All</T>
                </MenuRadioItem>
                <MenuRadioItem value="unfinished">
                  <T>Unfinished</T>
                </MenuRadioItem>
                <MenuRadioItem value="completed">
                  <T>Completed</T>
                </MenuRadioItem>
              </MenuRadioGroup>
            </MenuPopup>
          </Menu>

          <InputGroup className="w-44 sm:w-52">
            <InputGroupAddon align="inline-start">
              <SearchIcon className="size-3.5 text-muted-foreground" />
            </InputGroupAddon>
            <InputGroupInput
              value={searchText}
              onChange={(event) => setSearchText(event.currentTarget.value)}
              placeholder={gt("Search todos & notes...")}
              aria-label={gt("Search project todos")}
              size="sm"
            />
            {searchText.length > 0 ? (
              <InputGroupAddon align="inline-end">
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  aria-label={gt("Clear search")}
                  onClick={() => setSearchText("")}
                >
                  <XIcon className="size-3" />
                </Button>
              </InputGroupAddon>
            ) : null}
          </InputGroup>

          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            aria-label={gt("Refresh project todos")}
            onClick={() => reviewQuery.refresh()}
          >
            <RefreshCwIcon className="size-3.5" />
          </Button>
        </div>
      </div>

      {reviewQuery.error ? (
        <div className="mx-auto mb-3 w-full max-w-5xl px-5">
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {reviewQuery.error}
          </div>
        </div>
      ) : null}

      <ScrollArea className="min-h-0 flex-1">
        {reviewQuery.isPending && data === null ? (
          <div className="p-8 text-center text-xs text-muted-foreground">
            <T>Loading project todos...</T>
          </div>
        ) : groupMode === "by-day" ? (
          <div
            data-testid="project-todos-timeline-by-day"
            className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-5 pt-1 pb-6"
          >
            {dayGroups.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border/60 px-4 py-10 text-center text-xs text-muted-foreground">
                <T>No todos or memory notes recorded in this month.</T>
              </div>
            ) : (
              dayGroups.map((group) => {
                const openCount = group.items.filter((item) => item.completedAt === null).length;
                const doneCount = group.items.length - openCount;
                return (
                  <section
                    key={group.dateKey}
                    data-timeline-day={group.dateKey}
                    className="flex flex-col gap-2"
                  >
                    <div className="flex items-center justify-between gap-2 border-b border-border/50 pb-1.5">
                      <div className="flex items-center gap-2">
                        <CalendarDaysIcon className="size-3.5 text-muted-foreground" />
                        <h2 className="text-xs font-semibold text-foreground">
                          {formatDateKeyHeading(group.dateKey, todayKey, yesterdayKey, gt)}
                        </h2>
                        <span className="font-mono text-3xs text-muted-foreground">
                          {group.dateKey}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {openCount > 0 ? (
                          <Badge size="sm" variant="warning">
                            {gt("{count} unfinished", { count: openCount })}
                          </Badge>
                        ) : null}
                        {doneCount > 0 ? (
                          <Badge size="sm" variant="success">
                            {gt("{count} completed", { count: doneCount })}
                          </Badge>
                        ) : null}
                      </div>
                    </div>

                    <div className="flex flex-col gap-2">
                      {group.items.map((item) => renderCard(item, false))}
                    </div>
                  </section>
                );
              })
            )}
          </div>
        ) : (
          <div
            data-testid="project-todos-timeline-by-status"
            className="mx-auto grid w-full max-w-5xl grid-cols-1 gap-4 px-5 pt-1 pb-6 lg:grid-cols-2"
          >
            {statusGroups.map((group) => (
              <section
                key={group.key}
                data-status-group={group.key}
                className="flex min-h-40 flex-col gap-2 rounded-xl border border-border/60 bg-muted/15 p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    {group.icon}
                    <h2 className="text-xs font-semibold uppercase tracking-wide text-foreground/90">
                      {group.title}
                    </h2>
                  </div>
                  <Badge size="sm" variant={group.badgeVariant}>
                    {group.items.length}
                  </Badge>
                </div>

                {group.items.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-border/60 px-3 py-5 text-center text-xs text-muted-foreground">
                    {group.emptyText}
                  </p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {group.items.map((item) => renderCard(item, true))}
                  </div>
                )}
              </section>
            ))}
          </div>
        )}
      </ScrollArea>

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
