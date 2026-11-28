import {
  scopeProjectRef,
  scopeThreadRef,
  scopedProjectKey,
} from "@t3tools/client-runtime/environment";
import {
  localCalendarDayKey,
  localDayWindowForCalendarDay,
  shiftLocalCalendarDay,
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
  CheckCircle2Icon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  ExternalLinkIcon,
  InboxIcon,
  Link2Icon,
  PinIcon,
  RefreshCwIcon,
  SendIcon,
} from "lucide-react";
import { useState } from "react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { ScrollArea } from "~/components/ui/scroll-area";
import { toastManager } from "~/components/ui/toast";
import { useNewThreadHandler } from "~/hooks/useHandleNewThread";
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

interface ProjectTodosDailyReviewProps {
  readonly environmentId: EnvironmentId | null;
  readonly projectId: ProjectId | null;
}

function formatShortDayLabel(day: LocalCalendarDay): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    weekday: "short",
  }).format(new Date(day.year, day.month - 1, day.day));
}

export function ProjectTodosDailyReview(props: ProjectTodosDailyReviewProps) {
  const gt = useGT();
  const navigate = useNavigate();
  const handleNewThread = useNewThreadHandler();
  const projects = useProjects();
  const threads = useQuietThreadShells();

  const [today] = useState(() => todayLocalCalendarDay());
  const [selectedDay, setSelectedDay] = useState<LocalCalendarDay>(() => todayLocalCalendarDay());
  const [editingItem, setEditingItem] = useState<ProjectTodoSummary | null>(null);

  const supported = useEnvironmentSupportsProjectTodos(props.environmentId);
  const canOperate = useEnvironmentScope(props.environmentId, AuthOrchestrationOperateScope);

  const isToday = localCalendarDayKey(selectedDay) === localCalendarDayKey(today);
  const dayBounds = localDayWindowForCalendarDay(selectedDay);

  const reviewQuery = useProjectTodoDailyReview(
    props.environmentId !== null
      ? {
          environmentId: props.environmentId,
          input: {
            ...(props.projectId !== null ? { projectId: props.projectId } : {}),
            dayStartIso: dayBounds.dayStartIso,
            dayEndIso: dayBounds.dayEndIso,
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
        <T>Select a T4 Code environment to view today's daily review.</T>
      </div>
    );
  }

  const handlePatch = async (
    item: ProjectTodoSummary,
    patch: { readonly completed?: boolean; readonly archived?: boolean },
  ) => {
    if (!canOperate) return;
    const result = await updateCommand({
      environmentId: props.environmentId!,
      input: {
        id: item.id,
        projectId: item.projectId,
        expectedRevision: item.revision,
        ...patch,
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

  const data = reviewQuery.data;
  const selectedDayLabel = formatShortDayLabel(selectedDay);
  const sections: ReadonlyArray<{
    readonly key: string;
    readonly title: string;
    readonly emptyText: string;
    readonly icon: React.ReactNode;
    readonly items: ReadonlyArray<ProjectTodoSummary>;
  }> = [
    {
      key: "captured",
      title: isToday ? gt("Captured today") : gt("Captured on {date}", { date: selectedDayLabel }),
      emptyText: isToday
        ? gt("No new todos or notes captured today.")
        : gt("Nothing captured on this date."),
      icon: <InboxIcon className="size-3.5 text-info" />,
      items: data?.capturedToday ?? [],
    },
    {
      key: "completed",
      title: isToday
        ? gt("Completed today")
        : gt("Completed on {date}", { date: selectedDayLabel }),
      emptyText: isToday
        ? gt("Nothing completed yet today.")
        : gt("Nothing completed on this date."),
      icon: <CheckCircle2Icon className="size-3.5 text-success" />,
      items: data?.completedToday ?? [],
    },
    {
      key: "linked",
      title: gt("Linked in progress"),
      emptyText: gt("No open todos linked to active threads."),
      icon: <Link2Icon className="size-3.5 text-foreground/75" />,
      items: data?.linkedActive ?? [],
    },
    {
      key: "stale",
      title: gt("Needs triage (7+ days)"),
      emptyText: gt("No stale todos waiting for triage."),
      icon: <ClockIcon className="size-3.5 text-warning" />,
      items: data?.staleOpen ?? [],
    },
    {
      key: "pinned",
      title: gt("Pinned project memory"),
      emptyText: gt("Pin important notes to keep them on your memory shelf."),
      icon: <PinIcon className="size-3.5 text-primary" />,
      items: data?.pinnedNotes ?? [],
    },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border/50 px-4 py-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            type="button"
            size="icon-xs"
            variant="outline"
            aria-label={gt("Previous day")}
            onClick={() => setSelectedDay((prev) => shiftLocalCalendarDay(prev, -1))}
          >
            <ChevronLeftIcon className="size-3.5" />
          </Button>
          <span className="min-w-28 text-center text-xs font-medium text-foreground">
            {selectedDayLabel}
          </span>
          <Button
            type="button"
            size="icon-xs"
            variant="outline"
            aria-label={gt("Next day")}
            onClick={() => setSelectedDay((prev) => shiftLocalCalendarDay(prev, 1))}
          >
            <ChevronRightIcon className="size-3.5" />
          </Button>
          {!isToday ? (
            <Button
              type="button"
              size="xs"
              variant="secondary"
              onClick={() => setSelectedDay(today)}
            >
              <T>Today</T>
            </Button>
          ) : null}
          {data?.truncated ? (
            <Badge size="sm" variant="secondary">
              <T>Showing top items</T>
            </Badge>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          <span className="hidden text-2xs text-muted-foreground md:inline">
            <T>
              Daily review for today. Click Draft in thread to prefill the composer without sending.
            </T>
          </span>
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

      <ScrollArea className="min-h-0 flex-1">
        <div className="grid grid-cols-1 gap-4 p-4 lg:grid-cols-2 xl:grid-cols-3">
          {sections.map((section) => (
            <section
              key={section.key}
              className="flex min-h-40 flex-col gap-2 rounded-xl border border-border/60 bg-muted/15 p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  {section.icon}
                  <h2 className="text-xs font-semibold uppercase tracking-wide text-foreground/90">
                    {section.title}
                  </h2>
                </div>
                <Badge size="sm" variant="secondary">
                  {section.items.length}
                </Badge>
              </div>

              {reviewQuery.isPending && data === null ? (
                <p className="py-4 text-center text-xs text-muted-foreground">
                  <T>Loading...</T>
                </p>
              ) : section.items.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border/60 px-3 py-5 text-center text-xs text-muted-foreground">
                  {section.emptyText}
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {section.items.map((item) => {
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
                        key={`${section.key}:${scopedProjectKey(scopeProjectRef(props.environmentId!, item.projectId))}:${item.id}`}
                        className="flex flex-col gap-1.5 rounded-lg border border-border/70 bg-card/90 p-2.5"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <button
                            type="button"
                            onClick={() => setEditingItem(item)}
                            className="min-w-0 flex-1 text-left text-xs font-medium text-foreground hover:underline"
                          >
                            {item.title}
                          </button>
                          {item.kind === "note" ? (
                            <BookmarkIcon className="size-3.5 shrink-0 text-muted-foreground" />
                          ) : null}
                        </div>

                        {item.bodyPreview.length > 0 ? (
                          <p className="line-clamp-2 text-2xs text-muted-foreground">
                            {item.bodyPreview}
                          </p>
                        ) : null}

                        <div className="flex flex-wrap items-center justify-between gap-1.5 pt-0.5">
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
                            {item.completedAt === null ? (
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
                            {canOperate && item.completedAt === null ? (
                              <Button
                                type="button"
                                size="xs"
                                variant={linkedSettled ? "secondary" : "ghost"}
                                onClick={() => void handlePatch(item, { completed: true })}
                              >
                                <CheckCircle2Icon className="size-3" />
                                <span>{linkedSettled ? gt("Mark done?") : gt("Done")}</span>
                              </Button>
                            ) : null}
                            {canOperate ? (
                              <Button
                                type="button"
                                size="icon-xs"
                                variant="ghost"
                                aria-label={gt("Archive item")}
                                onClick={() => void handlePatch(item, { archived: true })}
                              >
                                <ArchiveIcon className="size-3" />
                              </Button>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          ))}
        </div>
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
