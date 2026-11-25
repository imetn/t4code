import {
  scopeProjectRef,
  scopeThreadRef,
  scopedProjectKey,
} from "@t3tools/client-runtime/environment";
import type { EnvironmentId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { T, useGT } from "gt-react";
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  CircleDotIcon,
  GitBranchIcon,
  KanbanIcon,
  Loader2Icon,
  PinIcon,
  PinOffIcon,
  PlusIcon,
  RotateCcwIcon,
  SearchIcon,
  XIcon,
} from "lucide-react";
import { useState, type DragEvent } from "react";

import { useHandleNewThread } from "../../hooks/useHandleNewThread";
import { useThreadActions } from "../../hooks/useThreadActions";
import { cn } from "../../lib/utils";
import { useDelegatedUnderParent, useProjects, useQuietThreadShells } from "../../state/entities";
import { useEnvironments } from "../../state/environments";
import { buildThreadRouteParams } from "../../threadRoutes";
import { ProjectFavicon } from "../ProjectFavicon";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";
import { ScrollArea } from "../ui/scroll-area";
import { SidebarInset, SidebarTrigger } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  partitionTaskBoardThreads,
  type TaskBoardAttentionReason,
  type TaskBoardCardItem,
  type TaskBoardColumnId,
} from "./taskBoard.logic";

const SETTLED_PAGE_SIZE = 25;

function formatRelativeTime(iso: string): string {
  const diffMs = Math.max(0, Date.now() - Date.parse(iso));
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function attentionReasonLabel(
  reason: TaskBoardAttentionReason,
  gt: ReturnType<typeof useGT>,
): string | null {
  switch (reason) {
    case "approval":
      return gt("Approval needed");
    case "input":
      return gt("Waiting for input");
    case "plan":
      return gt("Plan ready");
    case "subagent":
      return gt("Subagent waiting");
    case "guest":
      return gt("Guest message");
    case "failed":
      return gt("Failed");
    case null:
      return null;
  }
}

export function TaskBoardPage() {
  const gt = useGT();
  const navigate = useNavigate();
  const threads = useQuietThreadShells();
  const projects = useProjects();
  const delegatedUnderParent = useDelegatedUnderParent();
  const { environments: environmentPresentations } = useEnvironments();
  const { pinThread, unpinThread, settleThread, unsettleThread } = useThreadActions();
  const { handleNewThread, defaultProjectRef } = useHandleNewThread();

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedEnvironmentId, setSelectedEnvironmentId] = useState<EnvironmentId | null>(null);
  const [selectedProjectScopedKey, setSelectedProjectScopedKey] = useState<string | null>(null);
  const [showSettled, setShowSettled] = useState(true);
  const [settledLimit, setSettledLimit] = useState(SETTLED_PAGE_SIZE);
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<TaskBoardColumnId | null>(null);

  const environments = environmentPresentations.map((environment) => ({
    id: environment.environmentId,
    label: environment.label,
  }));
  const showEnvironmentFilter = environments.length > 1;

  const projectByScopedKey = new Map(
    projects.map((project) => [
      scopedProjectKey(scopeProjectRef(project.environmentId, project.id)),
      project,
    ]),
  );
  const projectNameByScopedKey = new Map(
    projects.map((project) => [
      scopedProjectKey(scopeProjectRef(project.environmentId, project.id)),
      project.title,
    ]),
  );
  const environmentLabelById = new Map(
    environments.map((environment) => [environment.id, environment.label]),
  );

  const activeProjects = projects.filter(
    (project) =>
      project.archivedAt === null &&
      (selectedEnvironmentId === null || project.environmentId === selectedEnvironmentId),
  );

  const columns = partitionTaskBoardThreads({
    threads,
    delegatedUnderParent,
    projectNameByScopedKey,
    environmentLabelById,
    environmentIds: selectedEnvironmentId ? new Set([selectedEnvironmentId]) : null,
    projectScopedKeys: selectedProjectScopedKey ? new Set([selectedProjectScopedKey]) : null,
    searchQuery,
  });

  const handleOpenThread = (item: TaskBoardCardItem) => {
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(scopeThreadRef(item.thread.environmentId, item.thread.id)),
    });
  };

  const handleCreateNewThread = () => {
    if (selectedProjectScopedKey) {
      const targetProject = projectByScopedKey.get(selectedProjectScopedKey);
      if (targetProject) {
        void handleNewThread(scopeProjectRef(targetProject.environmentId, targetProject.id));
        return;
      }
    }
    if (defaultProjectRef) {
      void handleNewThread(defaultProjectRef);
      return;
    }
    void navigate({ to: "/new" });
  };

  const handleCardDragStart = (event: DragEvent<HTMLDivElement>, item: TaskBoardCardItem) => {
    setDraggingKey(item.key);
    event.dataTransfer.setData("text/plain", item.key);
    event.dataTransfer.effectAllowed = "move";
  };

  const handleCardDragEnd = () => {
    setDraggingKey(null);
    setDragOverColumn(null);
  };

  const handleColumnDragOver = (event: DragEvent<HTMLElement>, columnId: TaskBoardColumnId) => {
    if (columnId !== "active" && columnId !== "settled") return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (dragOverColumn !== columnId) setDragOverColumn(columnId);
  };

  const handleColumnDrop = (event: DragEvent<HTMLElement>, columnId: TaskBoardColumnId) => {
    event.preventDefault();
    setDragOverColumn(null);
    const droppedKey = event.dataTransfer.getData("text/plain") || draggingKey;
    setDraggingKey(null);
    if (!droppedKey) return;
    const allCards = [
      ...columns.working,
      ...columns.attention,
      ...columns.active,
      ...columns.settled,
    ];
    const card = allCards.find((candidate) => candidate.key === droppedKey);
    if (!card) return;
    const threadRef = scopeThreadRef(card.thread.environmentId, card.thread.id);
    if (columnId === "settled" && card.column !== "settled") {
      void settleThread(threadRef);
    } else if (columnId === "active" && card.column === "settled") {
      void unsettleThread(threadRef);
    }
  };

  const columnDefs: ReadonlyArray<{
    readonly id: TaskBoardColumnId;
    readonly title: string;
    readonly icon: React.ReactNode;
    readonly accentClass: string;
    readonly items: ReadonlyArray<TaskBoardCardItem>;
    readonly droppable: boolean;
  }> = [
    {
      id: "working",
      title: gt("Working"),
      icon: <Loader2Icon className="size-3.5 text-info" />,
      accentClass: "border-info/25 bg-info/5",
      items: columns.working,
      droppable: false,
    },
    {
      id: "attention",
      title: gt("Needs attention"),
      icon: <AlertCircleIcon className="size-3.5 text-warning" />,
      accentClass: "border-warning/25 bg-warning/5",
      items: columns.attention,
      droppable: false,
    },
    {
      id: "active",
      title: gt("Active"),
      icon: <CircleDotIcon className="size-3.5 text-foreground/70" />,
      accentClass: "border-border/60 bg-muted/20",
      items: columns.active,
      droppable: true,
    },
    ...(showSettled
      ? [
          {
            id: "settled" as const,
            title: gt("Settled"),
            icon: <CheckCircle2Icon className="size-3.5 text-success" />,
            accentClass: "border-success/20 bg-success/5",
            items: columns.settled.slice(0, settledLimit),
            droppable: true,
          },
        ]
      : []),
  ];

  const hasFilters =
    searchQuery.trim().length > 0 ||
    selectedEnvironmentId !== null ||
    selectedProjectScopedKey !== null;

  return (
    <SidebarInset className="flex h-dvh min-w-0 flex-1 flex-col overflow-hidden">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border/60 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <SidebarTrigger className="md:hidden" aria-label={gt("Toggle main sidebar")} />
          <KanbanIcon className="size-4 shrink-0 text-muted-foreground" />
          <h1 className="truncate text-sm font-semibold tracking-tight">
            <T>Task board</T>
          </h1>
          <div className="hidden items-center gap-1.5 sm:flex">
            {columns.working.length > 0 ? (
              <Badge size="sm" variant="secondary">
                {gt("{count} working", { count: columns.working.length })}
              </Badge>
            ) : null}
            {columns.attention.length > 0 ? (
              <Badge size="sm" variant="warning">
                {gt("{count} waiting", { count: columns.attention.length })}
              </Badge>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <InputGroup className="w-44 sm:w-56">
            <InputGroupAddon align="inline-start">
              <SearchIcon className="size-3.5 text-muted-foreground" />
            </InputGroupAddon>
            <InputGroupInput
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.currentTarget.value)}
              placeholder={gt("Filter tasks...")}
              aria-label={gt("Filter tasks")}
              size="sm"
            />
            {searchQuery.length > 0 ? (
              <InputGroupAddon align="inline-end">
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  aria-label={gt("Clear filter")}
                  onClick={() => setSearchQuery("")}
                >
                  <XIcon className="size-3" />
                </Button>
              </InputGroupAddon>
            ) : null}
          </InputGroup>

          <Button
            type="button"
            size="sm"
            variant={showSettled ? "secondary" : "outline"}
            onClick={() => setShowSettled((prev) => !prev)}
          >
            {showSettled ? gt("Hide settled") : gt("Show settled")}
          </Button>

          <Button type="button" size="sm" onClick={handleCreateNewThread}>
            <PlusIcon className="size-3.5" />
            <span>
              <T>New thread</T>
            </span>
          </Button>
        </div>
      </header>

      {showEnvironmentFilter || activeProjects.length > 1 ? (
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border/50 bg-muted/10 px-4 py-2">
          {showEnvironmentFilter ? (
            <div className="flex flex-wrap items-center gap-1">
              <Button
                type="button"
                size="xs"
                variant={selectedEnvironmentId === null ? "secondary" : "ghost"}
                onClick={() => {
                  setSelectedEnvironmentId(null);
                  setSelectedProjectScopedKey(null);
                }}
              >
                <T>All environments</T>
              </Button>
              {environments.map((environment) => {
                const active = selectedEnvironmentId === environment.id;
                return (
                  <Button
                    key={environment.id}
                    type="button"
                    size="xs"
                    variant={active ? "secondary" : "ghost"}
                    onClick={() => {
                      setSelectedEnvironmentId(active ? null : environment.id);
                      setSelectedProjectScopedKey(null);
                    }}
                  >
                    {environment.label}
                  </Button>
                );
              })}
            </div>
          ) : null}

          {showEnvironmentFilter && activeProjects.length > 1 ? (
            <span className="mx-1 h-4 w-px bg-border/60" aria-hidden />
          ) : null}

          {activeProjects.length > 1 ? (
            <div className="flex flex-wrap items-center gap-1">
              <Button
                type="button"
                size="xs"
                variant={selectedProjectScopedKey === null ? "secondary" : "ghost"}
                onClick={() => setSelectedProjectScopedKey(null)}
              >
                <T>All projects</T>
              </Button>
              {activeProjects.slice(0, 8).map((project) => {
                const key = scopedProjectKey(scopeProjectRef(project.environmentId, project.id));
                const active = selectedProjectScopedKey === key;
                return (
                  <Button
                    key={key}
                    type="button"
                    size="xs"
                    variant={active ? "secondary" : "ghost"}
                    onClick={() => setSelectedProjectScopedKey(active ? null : key)}
                  >
                    <span className="max-w-32 truncate">{project.title}</span>
                  </Button>
                );
              })}
            </div>
          ) : null}

          {hasFilters ? (
            <Button
              type="button"
              size="xs"
              variant="ghost-muted"
              className="ml-auto"
              onClick={() => {
                setSearchQuery("");
                setSelectedEnvironmentId(null);
                setSelectedProjectScopedKey(null);
              }}
            >
              <T>Reset filters</T>
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 overflow-x-auto p-4">
        <div
          className={cn(
            "grid min-h-0 min-w-full flex-1 gap-3",
            showSettled
              ? "grid-cols-[repeat(4,minmax(17rem,1fr))]"
              : "grid-cols-[repeat(3,minmax(18rem,1fr))]",
          )}
        >
          {columnDefs.map((column) => {
            const totalCount =
              column.id === "settled" ? columns.settled.length : column.items.length;
            const isDropTarget = column.droppable && dragOverColumn === column.id;
            return (
              <section
                key={column.id}
                aria-label={column.title}
                onDragOver={(event) => handleColumnDragOver(event, column.id)}
                onDragLeave={() => {
                  if (dragOverColumn === column.id) setDragOverColumn(null);
                }}
                onDrop={(event) => handleColumnDrop(event, column.id)}
                className={cn(
                  "flex min-h-0 flex-col rounded-xl border p-2.5 transition-colors",
                  column.accentClass,
                  isDropTarget && "ring-2 ring-primary/60",
                )}
              >
                <div className="mb-2 flex shrink-0 items-center justify-between gap-2 px-1">
                  <div className="flex min-w-0 items-center gap-1.5">
                    {column.icon}
                    <h2 className="truncate text-xs font-semibold tracking-wide text-foreground/90 uppercase">
                      {column.title}
                    </h2>
                  </div>
                  <Badge size="sm" variant="secondary">
                    {totalCount}
                  </Badge>
                </div>

                <ScrollArea className="min-h-0 flex-1">
                  <div className="flex flex-col gap-2 pr-1">
                    {column.items.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-border/60 px-3 py-6 text-center text-xs text-muted-foreground">
                        <T>No tasks here</T>
                      </div>
                    ) : (
                      column.items.map((item) => {
                        const project = projectByScopedKey.get(
                          `${item.thread.environmentId}:${item.thread.projectId}`,
                        );
                        const attentionText = attentionReasonLabel(item.attentionReason, gt);
                        const threadRef = scopeThreadRef(item.thread.environmentId, item.thread.id);
                        const isPinned = item.thread.pinnedAt !== null;
                        const isSettled = item.column === "settled";
                        return (
                          <div
                            key={item.key}
                            draggable
                            onDragStart={(event) => handleCardDragStart(event, item)}
                            onDragEnd={handleCardDragEnd}
                            onClick={() => handleOpenThread(item)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                handleOpenThread(item);
                              }
                            }}
                            className={cn(
                              "group flex cursor-pointer flex-col gap-2 rounded-lg border border-border/70 bg-card p-3 text-left shadow-2xs transition-colors hover:border-foreground/25 hover:bg-accent/30 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                              draggingKey === item.key && "opacity-50",
                            )}
                          >
                            <div className="flex items-center justify-between gap-1.5 text-2xs text-muted-foreground">
                              <div className="flex min-w-0 items-center gap-1.5">
                                {project ? (
                                  <ProjectFavicon project={project} className="size-3.5 shrink-0" />
                                ) : null}
                                <span className="truncate font-medium">
                                  {item.projectName || gt("No project")}
                                </span>
                                {showEnvironmentFilter && item.environmentLabel ? (
                                  <Badge size="sm" variant="outline" className="shrink-0">
                                    {item.environmentLabel}
                                  </Badge>
                                ) : null}
                              </div>

                              <div
                                className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
                                onClick={(event) => event.stopPropagation()}
                              >
                                <Tooltip>
                                  <TooltipTrigger
                                    render={
                                      <Button
                                        type="button"
                                        size="icon-xs"
                                        variant="ghost"
                                        aria-label={
                                          isPinned ? gt("Unpin thread") : gt("Pin thread")
                                        }
                                        onClick={() =>
                                          void (isPinned
                                            ? unpinThread(threadRef)
                                            : pinThread(threadRef))
                                        }
                                      />
                                    }
                                  >
                                    {isPinned ? (
                                      <PinOffIcon className="size-3" />
                                    ) : (
                                      <PinIcon className="size-3" />
                                    )}
                                  </TooltipTrigger>
                                  <TooltipPopup>
                                    {isPinned ? gt("Unpin thread") : gt("Pin thread")}
                                  </TooltipPopup>
                                </Tooltip>

                                <Tooltip>
                                  <TooltipTrigger
                                    render={
                                      <Button
                                        type="button"
                                        size="icon-xs"
                                        variant="ghost"
                                        aria-label={
                                          isSettled ? gt("Reopen thread") : gt("Settle thread")
                                        }
                                        onClick={() =>
                                          void (isSettled
                                            ? unsettleThread(threadRef)
                                            : settleThread(threadRef))
                                        }
                                      />
                                    }
                                  >
                                    {isSettled ? (
                                      <RotateCcwIcon className="size-3" />
                                    ) : (
                                      <CheckCircle2Icon className="size-3" />
                                    )}
                                  </TooltipTrigger>
                                  <TooltipPopup>
                                    {isSettled ? gt("Reopen thread") : gt("Settle thread")}
                                  </TooltipPopup>
                                </Tooltip>
                              </div>
                            </div>

                            <div className="flex items-start gap-1.5">
                              {isPinned ? (
                                <PinIcon className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
                              ) : null}
                              <p className="line-clamp-2 text-sm font-medium leading-snug text-foreground">
                                {item.thread.title || gt("Untitled thread")}
                              </p>
                            </div>

                            <div className="flex flex-wrap items-center justify-between gap-1.5 pt-0.5 text-2xs text-muted-foreground">
                              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                                {attentionText ? (
                                  <Badge
                                    size="sm"
                                    variant={
                                      item.attentionReason === "failed" ? "error" : "warning"
                                    }
                                  >
                                    {attentionText}
                                  </Badge>
                                ) : null}
                                {item.thread.branch ? (
                                  <span className="inline-flex max-w-32 items-center gap-1 truncate rounded bg-muted/60 px-1.5 py-0.5 font-mono text-3xs">
                                    <GitBranchIcon className="size-2.5 shrink-0" />
                                    <span className="truncate">{item.thread.branch}</span>
                                  </span>
                                ) : null}
                                {item.thread.modelSelection?.model ? (
                                  <span className="max-w-28 truncate text-3xs text-muted-foreground/80">
                                    {item.thread.modelSelection.model}
                                  </span>
                                ) : null}
                              </div>
                              <span className="shrink-0 tabular-nums">
                                {formatRelativeTime(item.thread.updatedAt)}
                              </span>
                            </div>
                          </div>
                        );
                      })
                    )}

                    {column.id === "settled" && columns.settled.length > settledLimit ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="w-full"
                        onClick={() => setSettledLimit((limit) => limit + SETTLED_PAGE_SIZE)}
                      >
                        {gt("Show more ({count})", {
                          count: columns.settled.length - settledLimit,
                        })}
                      </Button>
                    ) : null}
                  </div>
                </ScrollArea>
              </section>
            );
          })}
        </div>
      </div>
    </SidebarInset>
  );
}
