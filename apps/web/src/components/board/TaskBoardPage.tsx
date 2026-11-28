import {
  scopeProjectRef,
  scopeThreadRef,
  scopedProjectKey,
  scopedThreadKey,
} from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { T, useGT } from "gt-react";
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  CircleDotIcon,
  Columns4Icon,
  GitBranchIcon,
  Loader2Icon,
  PinIcon,
  PinOffIcon,
  PlusIcon,
  RotateCcwIcon,
  SearchIcon,
  XIcon,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent,
  type ReactNode,
} from "react";

import { isElectron } from "~/env";
import { useHandleNewThread } from "../../hooks/useHandleNewThread";
import { useThreadActions } from "../../hooks/useThreadActions";
import { cn } from "../../lib/utils";
import {
  useDelegatedUnderParent,
  useProjects,
  useQuietThreadShell,
  useQuietThreadShells,
} from "../../state/entities";
import { useEnvironments } from "../../state/environments";
import { registerCommands } from "../../shortcuts/dispatcher";
import { buildThreadRouteParams } from "../../threadRoutes";
import { ProjectFavicon } from "../ProjectFavicon";
import { WorkspaceBreadcrumb, WorkspaceBreadcrumbItem } from "../WorkspaceBreadcrumb";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";
import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "../ui/menu";
import { ScrollArea } from "../ui/scroll-area";
import { SidebarInset } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  classifyTaskBoardColumn,
  partitionTaskBoardThreads,
  resolveDockedTaskBoardColumn,
  type TaskBoardAttentionReason,
  type TaskBoardCardItem,
  type TaskBoardColumnId,
} from "./taskBoard.logic";
import { TaskBoardThreadPane, type TaskBoardStatusBadge } from "./TaskBoardThreadPane";

const SETTLED_PAGE_SIZE = 25;
const ALL_FILTER_VALUE = "__all__";

interface TaskBoardColumnDef {
  readonly id: TaskBoardColumnId;
  readonly title: string;
  readonly icon: ReactNode;
  readonly accentClass: string;
  readonly items: ReadonlyArray<TaskBoardCardItem>;
  readonly totalCount: number;
  readonly droppable: boolean;
}

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

function isEscapeCapturedTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return (
    target.closest(
      'input, textarea, select, [contenteditable="true"], [role="dialog"], [role="menu"], [data-slot="popover-popup"]',
    ) !== null
  );
}

function focusTaskBoardThreadPane(root: HTMLElement | null) {
  if (!root) return;
  const target =
    root.querySelector<HTMLElement>("[data-task-board-pane-title]") ??
    root.querySelector<HTMLElement>('[data-testid="task-board-thread-pane"]');
  target?.focus();
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
  const [selectedThreadRef, setSelectedThreadRef] = useState<ScopedThreadRef | null>(null);
  const [dockedColumnId, setDockedColumnId] = useState<TaskBoardColumnId>("working");
  const boardBodyRef = useRef<HTMLDivElement | null>(null);
  const pendingFocusRef = useRef<
    | { readonly kind: "pane" }
    | { readonly kind: "card"; readonly key: string; readonly columnId: TaskBoardColumnId }
    | null
  >(null);

  const selectedThreadShell = useQuietThreadShell(selectedThreadRef);
  const selectedThreadKey = selectedThreadRef ? scopedThreadKey(selectedThreadRef) : null;
  const activeDockedColumnId = resolveDockedTaskBoardColumn(dockedColumnId, showSettled);

  const closeSplitView = () => {
    if (selectedThreadKey !== null) {
      pendingFocusRef.current = {
        kind: "card",
        key: selectedThreadKey,
        columnId: activeDockedColumnId,
      };
    }
    setSelectedThreadRef(null);
  };

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- moves DOM focus into the opened thread pane or back onto the originating board card across split-view mount/unmount
  useEffect(() => {
    const pending = pendingFocusRef.current;
    const root = boardBodyRef.current;
    if (!pending || !root) return;
    if (pending.kind === "pane" && selectedThreadKey !== null) {
      focusTaskBoardThreadPane(root);
      pendingFocusRef.current = null;
      return;
    }
    if (pending.kind === "card" && selectedThreadKey === null) {
      const escapedKey =
        typeof CSS !== "undefined" && typeof CSS.escape === "function"
          ? CSS.escape(pending.key)
          : pending.key.replaceAll('"', '\\"');
      const card = root.querySelector<HTMLElement>(`[data-task-board-card="${escapedKey}"]`);
      const fallback =
        card ??
        root.querySelector<HTMLElement>(`[data-task-board-column="${pending.columnId}"]`) ??
        root.querySelector<HTMLElement>("[data-task-board-column]");
      fallback?.focus();
      pendingFocusRef.current = null;
    }
  }, [selectedThreadKey]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes to Escape in the command dispatcher so exiting split view runs before the utility-page Escape observer
  useEffect(() => {
    if (selectedThreadKey === null) return;
    return registerCommands(
      {},
      {
        onKeyDown: (event) => {
          if (
            event.key !== "Escape" ||
            event.defaultPrevented ||
            event.repeat ||
            event.isComposing ||
            event.keyCode === 229 ||
            isEscapeCapturedTarget(event.target)
          ) {
            return false;
          }
          event.preventDefault();
          pendingFocusRef.current = {
            kind: "card",
            key: selectedThreadKey,
            columnId: activeDockedColumnId,
          };
          setSelectedThreadRef(null);
          return true;
        },
      },
    );
  }, [activeDockedColumnId, selectedThreadKey]);

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

  const navigateToThreadRoute = (threadRef: ScopedThreadRef) => {
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(threadRef),
    });
  };

  const handleSelectCard = (item: TaskBoardCardItem, event?: MouseEvent<HTMLElement>) => {
    const threadRef = scopeThreadRef(item.thread.environmentId, item.thread.id);
    if (event && (event.metaKey || event.ctrlKey)) {
      navigateToThreadRoute(threadRef);
      return;
    }
    if (event) {
      pendingFocusRef.current = null;
    }
    setDockedColumnId(item.column);
    setSelectedThreadRef(threadRef);
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

  const columnDefs: ReadonlyArray<TaskBoardColumnDef> = [
    {
      id: "working",
      title: gt("Working"),
      icon: <Loader2Icon className="size-3.5 text-info" />,
      accentClass: "border-info/25 bg-info/5",
      items: columns.working,
      totalCount: columns.working.length,
      droppable: false,
    },
    {
      id: "attention",
      title: gt("Needs attention"),
      icon: <AlertCircleIcon className="size-3.5 text-warning" />,
      accentClass: "border-warning/25 bg-warning/5",
      items: columns.attention,
      totalCount: columns.attention.length,
      droppable: false,
    },
    {
      id: "active",
      title: gt("Active"),
      icon: <CircleDotIcon className="size-3.5 text-foreground/70" />,
      accentClass: "border-border/60 bg-muted/20",
      items: columns.active,
      totalCount: columns.active.length,
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
            totalCount: columns.settled.length,
            droppable: true,
          },
        ]
      : []),
  ];

  const dockedColumn =
    columnDefs.find((column) => column.id === activeDockedColumnId) ?? columnDefs[0]!;

  const selectedStatusBadge: TaskBoardStatusBadge | null = (() => {
    if (!selectedThreadShell) return null;
    const status = classifyTaskBoardColumn(selectedThreadShell);
    if (status.attentionReason !== null) {
      const label = attentionReasonLabel(status.attentionReason, gt);
      if (label) {
        return {
          icon: <AlertCircleIcon className="size-3" />,
          label,
          variant: status.attentionReason === "failed" ? "error" : "warning",
        };
      }
    }
    const matchingColumn = columnDefs.find((column) => column.id === status.column);
    if (!matchingColumn) return null;
    return {
      icon: matchingColumn.icon,
      label: matchingColumn.title,
      variant: "secondary",
    };
  })();

  const selectedProject =
    selectedThreadShell !== null
      ? (projectByScopedKey.get(
          `${selectedThreadShell.environmentId}:${selectedThreadShell.projectId}`,
        ) ?? null)
      : null;

  const hasFilters =
    searchQuery.trim().length > 0 ||
    selectedEnvironmentId !== null ||
    selectedProjectScopedKey !== null;

  const renderColumnSection = (column: TaskBoardColumnDef, docked: boolean) => {
    const isDropTarget = column.droppable && dragOverColumn === column.id;
    return (
      <section
        key={column.id}
        tabIndex={-1}
        aria-label={column.title}
        data-task-board-column={column.id}
        onDragOver={(event) => handleColumnDragOver(event, column.id)}
        onDragLeave={() => {
          if (dragOverColumn === column.id) setDragOverColumn(null);
        }}
        onDrop={(event) => handleColumnDrop(event, column.id)}
        className={cn(
          "flex min-h-0 flex-col transition-colors focus:outline-hidden",
          docked ? "flex-1 rounded-lg" : cn("rounded-xl border p-2.5", column.accentClass),
          isDropTarget && "ring-2 ring-primary/60",
        )}
      >
        {!docked ? (
          <div className="mb-2 flex shrink-0 items-center justify-between gap-2 px-1">
            <div className="flex min-w-0 items-center gap-1.5">
              {column.icon}
              <h2 className="truncate text-xs font-semibold tracking-wide text-foreground/90 uppercase">
                {column.title}
              </h2>
            </div>
            <Badge size="sm" variant="secondary">
              {column.totalCount}
            </Badge>
          </div>
        ) : null}

        <ScrollArea radius="none" hideScrollbars className="min-h-0 flex-1">
          <div className="flex flex-col gap-2 py-0.5">
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
                const isSelected = selectedThreadKey === item.key;
                return (
                  <div
                    key={item.key}
                    draggable
                    onDragStart={(event) => handleCardDragStart(event, item)}
                    onDragEnd={handleCardDragEnd}
                    onClick={(event) => handleSelectCard(item, event)}
                    role="button"
                    tabIndex={0}
                    aria-pressed={selectedThreadRef !== null ? isSelected : undefined}
                    data-task-board-card={item.key}
                    data-selected={isSelected ? "true" : undefined}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        if (isSelected) {
                          focusTaskBoardThreadPane(boardBodyRef.current);
                        } else {
                          pendingFocusRef.current = { kind: "pane" };
                          handleSelectCard(item);
                        }
                      }
                    }}
                    className={cn(
                      "group flex cursor-pointer flex-col gap-2 rounded-lg border bg-card p-3 text-left shadow-2xs transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                      isSelected
                        ? "border-primary/60 bg-accent/50 ring-1 ring-inset ring-primary/35"
                        : "border-border/70 hover:border-foreground/25 hover:bg-accent/30",
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
                          <Badge size="sm" variant="outline">
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
                                aria-label={isPinned ? gt("Unpin thread") : gt("Pin thread")}
                                onClick={() =>
                                  void (isPinned ? unpinThread(threadRef) : pinThread(threadRef))
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
                                aria-label={isSettled ? gt("Reopen thread") : gt("Settle thread")}
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
                            variant={item.attentionReason === "failed" ? "error" : "warning"}
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
  };

  const currentFilterMenuLabel =
    selectedProjectScopedKey !== null
      ? (projectNameByScopedKey.get(selectedProjectScopedKey) ?? gt("All projects"))
      : selectedEnvironmentId !== null
        ? (environmentLabelById.get(selectedEnvironmentId) ?? gt("All environments"))
        : gt("All projects");

  return (
    <SidebarInset className="flex h-dvh min-w-0 flex-1 flex-col overflow-hidden">
      <WorkspacePageHeader electron={isElectron} className="relative bg-background">
        <WorkspaceBreadcrumb ariaLabel={gt("Task board breadcrumb")}>
          <WorkspaceBreadcrumbItem current>
            <h1 className="truncate">
              <T>Task board</T>
            </h1>
          </WorkspaceBreadcrumbItem>
        </WorkspaceBreadcrumb>

        {selectedThreadRef !== null ? (
          <Button
            type="button"
            size="xs"
            variant="ghost"
            className="[-webkit-app-region:no-drag]"
            onClick={closeSplitView}
          >
            <Columns4Icon className="size-3.5" />
            <span>
              <T>All columns</T>
            </span>
          </Button>
        ) : columns.working.length > 0 || columns.attention.length > 0 ? (
          <span className="hidden shrink-0 items-center gap-1.5 text-xs text-muted-foreground sm:inline-flex">
            {columns.working.length > 0 ? (
              <span>{gt("{count} working", { count: columns.working.length })}</span>
            ) : null}
            {columns.working.length > 0 && columns.attention.length > 0 ? (
              <span aria-hidden>·</span>
            ) : null}
            {columns.attention.length > 0 ? (
              <span className="text-warning">
                {gt("{count} waiting", { count: columns.attention.length })}
              </span>
            ) : null}
          </span>
        ) : null}

        <div className="min-w-0 flex-1" />

        <div className="flex shrink-0 items-center gap-1.5 [-webkit-app-region:no-drag]">
          <InputGroup className="w-36 sm:w-48">
            <InputGroupAddon align="inline-start">
              <SearchIcon className="size-3.5 text-muted-foreground" />
            </InputGroupAddon>
            <InputGroupInput
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (
                  event.key === "Escape" &&
                  !event.nativeEvent.isComposing &&
                  event.keyCode !== 229 &&
                  searchQuery.length > 0
                ) {
                  event.preventDefault();
                  setSearchQuery("");
                }
              }}
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

          {showEnvironmentFilter || activeProjects.length > 1 ? (
            <Menu>
              <MenuTrigger
                render={
                  <Button
                    type="button"
                    size="xs"
                    variant={
                      selectedEnvironmentId !== null || selectedProjectScopedKey !== null
                        ? "secondary"
                        : "outline"
                    }
                  >
                    <span className="max-w-28 truncate">{currentFilterMenuLabel}</span>
                    <ChevronDownIcon className="size-3 opacity-70" />
                  </Button>
                }
              />
              <MenuPopup align="end">
                {showEnvironmentFilter ? (
                  <MenuRadioGroup
                    value={selectedEnvironmentId ?? ALL_FILTER_VALUE}
                    onValueChange={(value) => {
                      setSelectedEnvironmentId(
                        value === ALL_FILTER_VALUE ? null : (value as EnvironmentId),
                      );
                      setSelectedProjectScopedKey(null);
                    }}
                  >
                    <MenuRadioItem value={ALL_FILTER_VALUE}>
                      <T>All environments</T>
                    </MenuRadioItem>
                    {environments.map((environment) => (
                      <MenuRadioItem key={environment.id} value={environment.id}>
                        {environment.label}
                      </MenuRadioItem>
                    ))}
                  </MenuRadioGroup>
                ) : null}
                {activeProjects.length > 1 ? (
                  <MenuRadioGroup
                    value={selectedProjectScopedKey ?? ALL_FILTER_VALUE}
                    onValueChange={(value) => {
                      setSelectedProjectScopedKey(value === ALL_FILTER_VALUE ? null : value);
                    }}
                  >
                    <MenuRadioItem value={ALL_FILTER_VALUE}>
                      <T>All projects</T>
                    </MenuRadioItem>
                    {activeProjects.map((project) => {
                      const key = scopedProjectKey(
                        scopeProjectRef(project.environmentId, project.id),
                      );
                      return (
                        <MenuRadioItem key={key} value={key}>
                          {project.title}
                        </MenuRadioItem>
                      );
                    })}
                  </MenuRadioGroup>
                ) : null}
              </MenuPopup>
            </Menu>
          ) : null}

          {hasFilters ? (
            <Button
              type="button"
              size="xs"
              variant="ghost-muted"
              onClick={() => {
                setSearchQuery("");
                setSelectedEnvironmentId(null);
                setSelectedProjectScopedKey(null);
              }}
            >
              <T>Reset filters</T>
            </Button>
          ) : null}

          <Button
            type="button"
            size="xs"
            variant={showSettled ? "secondary" : "ghost"}
            onClick={() => setShowSettled((prev) => !prev)}
          >
            {showSettled ? gt("Hide settled") : gt("Show settled")}
          </Button>

          <Button type="button" size="xs" onClick={handleCreateNewThread}>
            <PlusIcon className="size-3.5" />
            <span>
              <T>New thread</T>
            </span>
          </Button>
        </div>
      </WorkspacePageHeader>

      <div ref={boardBodyRef} className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {selectedThreadRef !== null ? (
          <div
            data-testid="task-board-split-view"
            className="flex min-h-0 flex-1 gap-3 overflow-hidden px-4 pt-1 pb-4"
          >
            <div
              data-testid="task-board-docked-column"
              className={cn(
                "hidden min-h-0 shrink-0 flex-col gap-2 md:flex",
                showSettled
                  ? "w-[clamp(16rem,calc((100%-2.25rem)/4),21rem)]"
                  : "w-[clamp(16rem,calc((100%-1.5rem)/3),21rem)]",
              )}
            >
              <div
                role="tablist"
                aria-label={gt("Task board columns")}
                className={cn(
                  "grid shrink-0 gap-1",
                  columnDefs.length === 4 ? "grid-cols-4" : "grid-cols-3",
                )}
              >
                {columnDefs.map((column) => {
                  const isActive = column.id === dockedColumn.id;
                  const isDropTarget = column.droppable && dragOverColumn === column.id;
                  return (
                    <Tooltip key={column.id}>
                      <TooltipTrigger
                        render={
                          <button
                            type="button"
                            role="tab"
                            aria-selected={isActive}
                            aria-label={`${column.title} (${column.totalCount})`}
                            data-task-board-column-tab={column.id}
                            onClick={() => setDockedColumnId(column.id)}
                            onDragOver={(event) => handleColumnDragOver(event, column.id)}
                            onDragLeave={() => {
                              if (dragOverColumn === column.id) setDragOverColumn(null);
                            }}
                            onDrop={(event) => handleColumnDrop(event, column.id)}
                            className={cn(
                              "flex min-w-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                              isActive
                                ? cn("text-foreground shadow-2xs", column.accentClass)
                                : "border-border/50 bg-background text-muted-foreground hover:border-border hover:bg-accent/40 hover:text-foreground",
                              isDropTarget && "ring-2 ring-inset ring-primary/60",
                            )}
                          />
                        }
                      >
                        {column.icon}
                        <span className="tabular-nums">{column.totalCount}</span>
                      </TooltipTrigger>
                      <TooltipPopup side="bottom">{column.title}</TooltipPopup>
                    </Tooltip>
                  );
                })}
              </div>
              {renderColumnSection(dockedColumn, true)}
            </div>

            <TaskBoardThreadPane
              key={selectedThreadKey ?? undefined}
              threadRef={selectedThreadRef}
              project={selectedProject}
              environmentLabel={environmentLabelById.get(selectedThreadRef.environmentId) ?? null}
              showEnvironmentBadge={showEnvironmentFilter}
              statusBadge={selectedStatusBadge}
              onClose={closeSplitView}
              onOpenFullView={() => navigateToThreadRoute(selectedThreadRef)}
            />
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 overflow-x-auto px-4 pt-1 pb-4">
            <div
              className={cn(
                "grid min-h-0 min-w-full flex-1 gap-3",
                showSettled
                  ? "grid-cols-[repeat(4,minmax(17rem,1fr))]"
                  : "grid-cols-[repeat(3,minmax(18rem,1fr))]",
              )}
            >
              {columnDefs.map((column) => renderColumnSection(column, false))}
            </div>
          </div>
        )}
      </div>
    </SidebarInset>
  );
}
