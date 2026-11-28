import {
  scopeProjectRef,
  scopeThreadRef,
  scopedProjectKey,
  scopedThreadKey,
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
import { useProjects, useQuietThreadShells, useServerConfigs } from "~/state/entities";
import { useEnvironments } from "~/state/environments";
import {
  loadProjectTodoDispatchPrompt,
  projectTodoEnvironment,
  useMultiEnvironmentProjectTodoDailyReview,
  type ScopedProjectTodoSummary,
} from "~/state/projectTodos";
import { formatEnvironmentQueryError } from "~/state/query";
import { useEnvironmentsWithScope } from "~/state/session";
import { useAtomCommand } from "~/state/use-atom-command";
import { buildThreadRouteParams } from "~/threadRoutes";
import { ProjectTodoFormDialog } from "./ProjectTodoFormDialog";

interface ProjectTodosTimelineViewProps {
  readonly environmentId: EnvironmentId | null;
  readonly environmentIds?: ReadonlyArray<EnvironmentId>;
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
  const serverConfigs = useServerConfigs();
  const { environments } = useEnvironments();

  const [today] = useState(() => todayLocalCalendarDay());
  const [visibleMonth, setVisibleMonth] = useState<{
    readonly year: number;
    readonly month: number;
  }>(() => ({ year: today.year, month: today.month }));
  const [groupMode, setGroupMode] = useState<TimelineGroupMode>("by-day");
  const [statusFilter, setStatusFilter] = useState<TimelineStatusFilter>("all");
  const [searchText, setSearchText] = useState("");
  const [editingEntry, setEditingEntry] = useState<ScopedProjectTodoSummary | null>(null);

  const requestedEnvironmentIds =
    props.environmentIds !== undefined
      ? props.environmentIds
      : props.environmentId !== null
        ? [props.environmentId]
        : [];
  const targetEnvironmentIds = requestedEnvironmentIds.filter(
    (environmentId) =>
      serverConfigs.get(environmentId)?.environment.capabilities.projectTodos === true,
  );
  const targetEnvironmentIdSet = new Set(targetEnvironmentIds);
  const isMultiEnvironment = targetEnvironmentIds.length > 1;

  const operableEnvironmentIds = useEnvironmentsWithScope(
    targetEnvironmentIds.map((environmentId) => ({ environmentId })),
    AuthOrchestrationOperateScope,
  );
  const environmentLabelById = new Map(
    environments.map((environment) => [environment.environmentId, environment.label] as const),
  );

  const todayKey = localCalendarDayKey(today);
  const yesterdayKey = localCalendarDayKey(shiftLocalCalendarDay(today, -1));
  const dayBounds = localDayWindowForCalendarDay(today);
  const monthBounds = localMonthRangeForCalendar(visibleMonth.year, visibleMonth.month);

  const reviewTargets = targetEnvironmentIds.map((environmentId) => ({
    environmentId,
    input: {
      ...(props.projectId !== null ? { projectId: props.projectId } : {}),
      dayStartIso: dayBounds.dayStartIso,
      dayEndIso: dayBounds.dayEndIso,
      rangeStartIso: monthBounds.rangeStartIso,
      rangeEndIso: monthBounds.rangeEndIso,
    },
  }));
  const reviewQuery = useMultiEnvironmentProjectTodoDailyReview(reviewTargets);

  const updateCommand = useAtomCommand(projectTodoEnvironment.update, { reportFailure: false });

  const projectNameByScopedKey = new Map(
    projects
      .filter((project) => targetEnvironmentIdSet.has(project.environmentId))
      .map(
        (project) =>
          [
            scopedProjectKey(scopeProjectRef(project.environmentId, project.id)),
            project.title,
          ] as const,
      ),
  );
  const threadByScopedKey = new Map(
    threads
      .filter((thread) => targetEnvironmentIdSet.has(thread.environmentId))
      .map(
        (thread) =>
          [scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)), thread] as const,
      ),
  );

  if (targetEnvironmentIds.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-xs text-muted-foreground">
        <T>Select a T4 Code environment to view the project todo timeline.</T>
      </div>
    );
  }

  // Combine month items with all-time linked/stale/pinned items so status grouping never drops older unfinished tasks.
  const mergedMap = new Map<string, ScopedProjectTodoSummary>();
  for (const entry of reviewQuery.calendarItems) {
    mergedMap.set(`${entry.environmentId}:${entry.item.id}`, entry);
  }
  if (groupMode === "by-status") {
    for (const entry of [
      ...reviewQuery.linkedActive,
      ...reviewQuery.staleOpen,
      ...reviewQuery.pinnedNotes,
    ]) {
      const key = `${entry.environmentId}:${entry.item.id}`;
      if (!mergedMap.has(key)) {
        mergedMap.set(key, entry);
      }
    }
  }

  const normalizedSearch = searchText.trim().toLowerCase();
  const filteredEntries = [...mergedMap.values()].filter(({ environmentId, item }) => {
    if (statusFilter === "unfinished" && item.completedAt !== null) return false;
    if (statusFilter === "completed" && item.completedAt === null) return false;
    if (normalizedSearch.length > 0) {
      const projectTitle =
        projectNameByScopedKey
          .get(scopedProjectKey(scopeProjectRef(environmentId, item.projectId)))
          ?.toLowerCase() ?? "";
      const envLabel = environmentLabelById.get(environmentId)?.toLowerCase() ?? "";
      const haystack =
        `${item.title}\n${item.bodyPreview}\n${projectTitle}\n${envLabel}`.toLowerCase();
      if (!haystack.includes(normalizedSearch)) return false;
    }
    return true;
  });

  // Group 1: Timeline grouped by local day (newest day first).
  const dayBucketsMap = new Map<
    string,
    { readonly dateKey: string; readonly items: ScopedProjectTodoSummary[] }
  >();
  for (const entry of filteredEntries) {
    const key =
      entry.item.completedAt !== null
        ? localDateKeyFromIso(entry.item.completedAt)
        : localDateKeyFromIso(entry.item.createdAt);
    let bucket = dayBucketsMap.get(key);
    if (bucket === undefined) {
      bucket = { dateKey: key, items: [] };
      dayBucketsMap.set(key, bucket);
    }
    bucket.items.push(entry);
  }
  const dayGroups = [...dayBucketsMap.values()]
    .toSorted((left, right) => right.dateKey.localeCompare(left.dateKey))
    .map((group) => ({
      ...group,
      items: group.items.toSorted((left, right) => {
        const leftDone = left.item.completedAt !== null;
        const rightDone = right.item.completedAt !== null;
        if (leftDone !== rightDone) return leftDone ? 1 : -1;
        if (left.item.priority !== right.item.priority)
          return left.item.priority === "high" ? -1 : 1;
        return right.item.createdAt.localeCompare(left.item.createdAt);
      }),
    }));

  // Group 2: Grouped by task status (every item explicitly displays its creation date).
  const statusUnfinished = filteredEntries
    .filter(
      ({ item }) =>
        item.completedAt === null && item.linkedThreadId === null && item.kind === "todo",
    )
    .toSorted((left, right) => {
      if (left.item.priority !== right.item.priority) return left.item.priority === "high" ? -1 : 1;
      return right.item.createdAt.localeCompare(left.item.createdAt);
    });
  const statusInProgress = filteredEntries
    .filter(({ item }) => item.completedAt === null && item.linkedThreadId !== null)
    .toSorted((left, right) => right.item.updatedAt.localeCompare(left.item.updatedAt));
  const statusCompleted = filteredEntries
    .filter(({ item }) => item.completedAt !== null)
    .toSorted((left, right) =>
      (right.item.completedAt ?? right.item.updatedAt).localeCompare(
        left.item.completedAt ?? left.item.updatedAt,
      ),
    );
  const statusNotes = filteredEntries
    .filter(({ item }) => item.completedAt === null && item.kind === "note")
    .toSorted((left, right) => {
      if (left.item.pinned !== right.item.pinned) return left.item.pinned ? -1 : 1;
      return right.item.updatedAt.localeCompare(left.item.updatedAt);
    });

  const statusGroups: ReadonlyArray<{
    readonly key: string;
    readonly title: string;
    readonly emptyText: string;
    readonly badgeVariant: "warning" | "info" | "success" | "secondary";
    readonly icon: React.ReactNode;
    readonly items: ReadonlyArray<ScopedProjectTodoSummary>;
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

  const handleToggleCompleted = async (entry: ScopedProjectTodoSummary) => {
    if (!operableEnvironmentIds.has(entry.environmentId)) return;
    const result = await updateCommand({
      environmentId: entry.environmentId,
      input: {
        id: entry.item.id,
        projectId: entry.item.projectId,
        expectedRevision: entry.item.revision,
        completed: entry.item.completedAt === null,
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

  const handleArchive = async (entry: ScopedProjectTodoSummary) => {
    if (!operableEnvironmentIds.has(entry.environmentId)) return;
    const result = await updateCommand({
      environmentId: entry.environmentId,
      input: {
        id: entry.item.id,
        projectId: entry.item.projectId,
        expectedRevision: entry.item.revision,
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

  const handleDispatch = async (entry: ScopedProjectTodoSummary) => {
    const prompt = await loadProjectTodoDispatchPrompt(entry.environmentId, entry.item);
    await handleNewThread(scopeProjectRef(entry.environmentId, entry.item.projectId), {
      prompt,
    });
  };

  const handleOpenThread = (environmentId: EnvironmentId, threadId: ThreadId) => {
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(scopeThreadRef(environmentId, threadId)),
    });
  };

  const renderCard = (entry: ScopedProjectTodoSummary, showFullDateBadge: boolean) => {
    const { item, environmentId } = entry;
    const canOperateEntry = operableEnvironmentIds.has(environmentId);
    const isCompleted = item.completedAt !== null;
    const projectTitle = projectNameByScopedKey.get(
      scopedProjectKey(scopeProjectRef(environmentId, item.projectId)),
    );
    const envLabel = isMultiEnvironment ? environmentLabelById.get(environmentId) : undefined;
    const linkedThread =
      item.linkedThreadId !== null
        ? (threadByScopedKey.get(
            scopedThreadKey(scopeThreadRef(environmentId, item.linkedThreadId)),
          ) ?? null)
        : null;
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
        key={`${groupMode}:${scopedProjectKey(scopeProjectRef(environmentId, item.projectId))}:${item.id}`}
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
          {canOperateEntry ? (
            <button
              type="button"
              aria-label={isCompleted ? gt("Mark as open") : gt("Mark as completed")}
              onClick={() => void handleToggleCompleted(entry)}
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
                onClick={() => setEditingEntry(entry)}
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
            {envLabel ? (
              <Badge size="sm" variant="outline">
                {envLabel}
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
                onClick={() => handleOpenThread(environmentId, item.linkedThreadId!)}
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
                onClick={() => void handleDispatch(entry)}
              >
                <SendIcon className="size-3" />
                <span>
                  <T>Draft in thread</T>
                </span>
              </Button>
            ) : null}
            {canOperateEntry && linkedSettled && !isCompleted ? (
              <Button
                type="button"
                size="xs"
                variant="secondary"
                onClick={() => void handleToggleCompleted(entry)}
              >
                <T>Mark done?</T>
              </Button>
            ) : null}
            {canOperateEntry ? (
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                aria-label={gt("Edit item")}
                onClick={() => setEditingEntry(entry)}
              >
                <PencilIcon className="size-3" />
              </Button>
            ) : null}
            {canOperateEntry ? (
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                aria-label={gt("Archive item")}
                onClick={() => void handleArchive(entry)}
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
        {reviewQuery.isPending && !reviewQuery.hasLoadedAny ? (
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
                const openCount = group.items.filter(
                  (entry) => entry.item.completedAt === null,
                ).length;
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
                      {group.items.map((entry) => renderCard(entry, false))}
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
                    {group.items.map((entry) => renderCard(entry, true))}
                  </div>
                )}
              </section>
            ))}
          </div>
        )}
      </ScrollArea>

      {editingEntry !== null ? (
        <ProjectTodoFormDialog
          open
          onOpenChange={(open) => {
            if (!open) setEditingEntry(null);
          }}
          environmentId={editingEntry.environmentId}
          projectId={editingEntry.item.projectId}
          {...(projectNameByScopedKey.get(
            scopedProjectKey(
              scopeProjectRef(editingEntry.environmentId, editingEntry.item.projectId),
            ),
          ) !== undefined
            ? {
                projectName: projectNameByScopedKey.get(
                  scopedProjectKey(
                    scopeProjectRef(editingEntry.environmentId, editingEntry.item.projectId),
                  ),
                )!,
              }
            : {})}
          editSummary={editingEntry.item}
          onSaved={() => reviewQuery.refresh()}
          onDeleted={() => reviewQuery.refresh()}
        />
      ) : null}
    </div>
  );
}
