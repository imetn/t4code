import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { isThreadWorking } from "@t3tools/client-runtime/state/thread-inbox";
import {
  AuthOrchestrationOperateScope,
  PROJECT_TODO_MAX_LIST_LIMIT,
  type EnvironmentId,
  type ProjectId,
  type ProjectTodoCursor,
  type ProjectTodoKind,
  type ProjectTodoStateFilter,
  type ProjectTodoSummary,
  type ThreadId,
} from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { T, useGT } from "gt-react";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  BookmarkIcon,
  BotIcon,
  CheckCircle2Icon,
  CircleIcon,
  ExternalLinkIcon,
  FileCode2Icon,
  PencilIcon,
  PinIcon,
  PinOffIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
  SendIcon,
  XIcon,
} from "lucide-react";
import { useState, type FormEvent } from "react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "~/components/ui/input-group";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { toastManager } from "~/components/ui/toast";
import { useNewThreadHandler } from "~/hooks/useHandleNewThread";
import { cn } from "~/lib/utils";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { useQuietThreadShells } from "~/state/entities";
import {
  loadProjectTodoDispatchPrompt,
  projectTodoEnvironment,
  useEnvironmentSupportsProjectTodos,
  useProjectTodoList,
} from "~/state/projectTodos";
import { useDebouncedValue } from "~/state/queries";
import { formatEnvironmentQueryError } from "~/state/query";
import { useEnvironmentScope } from "~/state/session";
import { useAtomCommand } from "~/state/use-atom-command";
import { buildThreadRouteParams } from "~/threadRoutes";
import { newProjectTodoId, ProjectTodoFormDialog } from "./ProjectTodoFormDialog";

interface ProjectTodosSectionProps {
  readonly environmentId: EnvironmentId | null;
  readonly projectId: ProjectId | null;
  readonly projectName?: string;
  readonly sourceThreadId?: ThreadId | null;
  readonly compact?: boolean;
  readonly onAfterDispatch?: () => void;
}

function formatRelativeAge(iso: string): string {
  const diffMs = Math.max(0, Date.now() - Date.parse(iso));
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function ProjectTodosSection(props: ProjectTodosSectionProps) {
  const gt = useGT();
  const navigate = useNavigate();
  const handleNewThread = useNewThreadHandler();
  const threads = useQuietThreadShells();

  const [stateFilter, setStateFilter] = useState<ProjectTodoStateFilter>("open");
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [quickTitle, setQuickTitle] = useState("");
  const [quickKind, setQuickKind] = useState<ProjectTodoKind>("todo");
  const [extraPages, setExtraPages] = useState<{
    readonly filterKey: string;
    readonly items: ReadonlyArray<ProjectTodoSummary>;
    readonly nextCursor: ProjectTodoCursor | null;
    readonly hasMore: boolean;
  } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [dialogState, setDialogState] = useState<
    | { readonly mode: "closed" }
    | { readonly mode: "create" }
    | { readonly mode: "edit"; readonly item: ProjectTodoSummary }
  >({ mode: "closed" });

  const supported = useEnvironmentSupportsProjectTodos(props.environmentId);
  const canOperate = useEnvironmentScope(props.environmentId, AuthOrchestrationOperateScope);
  const debouncedSearch = useDebouncedValue(searchText.trim(), 250);

  const queryInput =
    props.environmentId !== null && props.projectId !== null
      ? {
          environmentId: props.environmentId,
          input: {
            projectId: props.projectId,
            state: stateFilter,
            ...(pinnedOnly ? { pinnedOnly: true } : {}),
            ...(debouncedSearch.length > 0 ? { query: debouncedSearch } : {}),
            limit: PROJECT_TODO_MAX_LIST_LIMIT,
          },
        }
      : null;

  const filterKey = JSON.stringify(queryInput);
  const listQuery = useProjectTodoList(queryInput);

  const createCommand = useAtomCommand(projectTodoEnvironment.create, { reportFailure: false });
  const updateCommand = useAtomCommand(projectTodoEnvironment.update, { reportFailure: false });

  const activeExtra = extraPages !== null && extraPages.filterKey === filterKey ? extraPages : null;
  const firstPageItems = listQuery.data?.items ?? [];
  const mergedItems = (() => {
    if (activeExtra === null || activeExtra.items.length === 0) return firstPageItems;
    const seen = new Set(firstPageItems.map((item) => item.id));
    return [...firstPageItems, ...activeExtra.items.filter((item) => !seen.has(item.id))];
  })();
  const sortedItems = [...mergedItems].toSorted((left, right) => {
    if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
    if (left.priority !== right.priority) return left.priority === "high" ? -1 : 1;
    return right.createdAt.localeCompare(left.createdAt);
  });

  const effectiveHasMore =
    activeExtra !== null ? activeExtra.hasMore : (listQuery.data?.hasMore ?? false);
  const effectiveNextCursor =
    activeExtra !== null ? activeExtra.nextCursor : (listQuery.data?.nextCursor ?? null);

  const threadById = new Map(
    threads
      .filter(
        (thread) => props.environmentId !== null && thread.environmentId === props.environmentId,
      )
      .map((thread) => [thread.id, thread] as const),
  );

  const handleQuickAdd = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = quickTitle.trim();
    if (
      trimmed.length === 0 ||
      props.environmentId === null ||
      props.projectId === null ||
      !canOperate ||
      isCreating
    ) {
      return;
    }
    setIsCreating(true);
    const result = await createCommand({
      environmentId: props.environmentId,
      input: {
        id: newProjectTodoId(),
        projectId: props.projectId,
        title: trimmed,
        kind: quickKind,
        pinned: quickKind === "note",
        sourceThreadId: props.sourceThreadId ?? null,
      },
    });
    setIsCreating(false);
    if (result._tag === "Success") {
      setQuickTitle("");
      setExtraPages(null);
      toastManager.add({
        type: "success",
        title: quickKind === "note" ? gt("Memory note saved") : gt("Todo added"),
      });
      return;
    }
    toastManager.add({
      type: "error",
      title: gt("Could not save item"),
      description: formatEnvironmentQueryError(result.cause),
    });
  };

  const handleQuickToggle = async (
    item: ProjectTodoSummary,
    patch: { readonly completed?: boolean; readonly archived?: boolean; readonly pinned?: boolean },
  ) => {
    if (props.environmentId === null || !canOperate) return;
    const result = await updateCommand({
      environmentId: props.environmentId,
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
      listQuery.refresh();
      return;
    }
    setExtraPages(null);
  };

  const handleDispatchDraft = async (item: ProjectTodoSummary) => {
    if (props.environmentId === null) return;
    const prompt = await loadProjectTodoDispatchPrompt(props.environmentId, item);
    await handleNewThread(scopeProjectRef(props.environmentId, item.projectId), { prompt });
    props.onAfterDispatch?.();
  };

  const handleOpenThread = (threadId: ThreadId) => {
    if (props.environmentId === null) return;
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(scopeThreadRef(props.environmentId, threadId)),
    });
    props.onAfterDispatch?.();
  };

  const handleLoadMore = async () => {
    if (
      props.environmentId === null ||
      props.projectId === null ||
      effectiveNextCursor === null ||
      loadingMore
    ) {
      return;
    }
    setLoadingMore(true);
    const nextPageAtom = projectTodoEnvironment.list({
      environmentId: props.environmentId,
      input: {
        projectId: props.projectId,
        state: stateFilter,
        ...(pinnedOnly ? { pinnedOnly: true } : {}),
        ...(debouncedSearch.length > 0 ? { query: debouncedSearch } : {}),
        cursor: effectiveNextCursor,
        limit: PROJECT_TODO_MAX_LIST_LIMIT,
      },
    });
    const nextResult = await new Promise<typeof listQuery.data | null>((resolve) => {
      const unmount = appAtomRegistry.subscribe(
        nextPageAtom,
        (value) => {
          if (value._tag === "Success") {
            unmount();
            resolve(value.value);
          } else if (value._tag === "Failure") {
            unmount();
            resolve(null);
          }
        },
        { immediate: true },
      );
    });
    setLoadingMore(false);
    if (nextResult === null) return;
    setExtraPages({
      filterKey,
      items: [...(activeExtra?.items ?? []), ...nextResult.items],
      nextCursor: nextResult.nextCursor,
      hasMore: nextResult.hasMore,
    });
  };

  if (props.environmentId === null || props.projectId === null) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-border/60 p-6 text-center text-xs text-muted-foreground">
        <T>Select a project to view and capture its todos and memory notes.</T>
      </div>
    );
  }

  if (!supported) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-border/60 p-6 text-center text-xs text-muted-foreground">
        <p className="font-medium text-foreground">
          <T>Project todos unavailable on this host</T>
        </p>
        <p>
          <T>Upgrade this machine to T4 Code to store project todos and agent memory notes.</T>
        </p>
      </div>
    );
  }

  const stateTabs: ReadonlyArray<{
    readonly value: ProjectTodoStateFilter;
    readonly label: string;
  }> = [
    { value: "open", label: gt("Open", { $context: "todo filter" }) },
    { value: "completed", label: gt("Done") },
    { value: "archived", label: gt("Archived") },
    { value: "all", label: gt("All", { $context: "todo filter" }) },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2.5">
      {canOperate ? (
        <form
          onSubmit={(event) => void handleQuickAdd(event)}
          className="flex items-center gap-1.5"
        >
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  size="icon-sm"
                  variant={quickKind === "note" ? "secondary" : "outline"}
                  aria-label={
                    quickKind === "note" ? gt("Switch to todo") : gt("Switch to memory note")
                  }
                  onClick={() => setQuickKind((prev) => (prev === "todo" ? "note" : "todo"))}
                />
              }
            >
              {quickKind === "note" ? (
                <BookmarkIcon className="size-3.5" />
              ) : (
                <CircleIcon className="size-3.5" />
              )}
            </TooltipTrigger>
            <TooltipPopup side="bottom">
              {quickKind === "note"
                ? gt("Capturing pinned memory note (click for todo)")
                : gt("Capturing todo (click for memory note)")}
            </TooltipPopup>
          </Tooltip>

          <Input
            value={quickTitle}
            onChange={(event) => setQuickTitle(event.currentTarget.value)}
            placeholder={
              quickKind === "note"
                ? gt("Save project memory note...")
                : gt("Capture idea or todo, press Enter...")
            }
            size="sm"
            className="min-w-0 flex-1"
            disabled={isCreating}
          />

          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  size="icon-sm"
                  variant="outline"
                  aria-label={gt("Add with details")}
                  onClick={() => setDialogState({ mode: "create" })}
                />
              }
            >
              <PlusIcon className="size-3.5" />
            </TooltipTrigger>
            <TooltipPopup side="bottom">
              <T>Add with details</T>
            </TooltipPopup>
          </Tooltip>
        </form>
      ) : null}

      <div className="flex items-center gap-0.5">
        {stateTabs.map((tab) => (
          <Button
            key={tab.value}
            type="button"
            size="xs"
            variant={stateFilter === tab.value ? "secondary" : "ghost"}
            onClick={() => {
              setStateFilter(tab.value);
              setExtraPages(null);
            }}
          >
            {tab.label}
          </Button>
        ))}

        <div className="ml-auto flex items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  size="icon-xs"
                  variant={pinnedOnly ? "secondary" : "ghost"}
                  aria-label={gt("Pinned")}
                  onClick={() => {
                    setPinnedOnly((prev) => !prev);
                    setExtraPages(null);
                  }}
                />
              }
            >
              <PinIcon className="size-3" />
            </TooltipTrigger>
            <TooltipPopup side="bottom">
              <T>Pinned</T>
            </TooltipPopup>
          </Tooltip>

          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            aria-label={gt("Refresh project todos")}
            onClick={() => {
              setExtraPages(null);
              listQuery.refresh();
            }}
          >
            <RefreshCwIcon className="size-3" />
          </Button>
        </div>
      </div>

      {!props.compact || searchText.length > 0 || sortedItems.length > 5 ? (
        <InputGroup>
          <InputGroupAddon align="inline-start">
            <SearchIcon className="size-3.5 text-muted-foreground" />
          </InputGroupAddon>
          <InputGroupInput
            value={searchText}
            onChange={(event) => {
              setSearchText(event.currentTarget.value);
              setExtraPages(null);
            }}
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
                onClick={() => {
                  setSearchText("");
                  setExtraPages(null);
                }}
              >
                <XIcon className="size-3" />
              </Button>
            </InputGroupAddon>
          ) : null}
        </InputGroup>
      ) : null}

      {listQuery.error ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {listQuery.error}
        </div>
      ) : null}

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-2 pr-1">
          {listQuery.isPending && sortedItems.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/60 px-3 py-6 text-center text-xs text-muted-foreground">
              <T>Loading project todos...</T>
            </div>
          ) : sortedItems.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/60 px-3 py-6 text-center text-xs text-muted-foreground">
              <T>Nothing saved here yet. Capture an idea above without starting a thread.</T>
            </div>
          ) : (
            sortedItems.map((item) => {
              const isCompleted = item.completedAt !== null;
              const isArchived = item.archivedAt !== null;
              const linkedThread =
                item.linkedThreadId !== null ? (threadById.get(item.linkedThreadId) ?? null) : null;
              const linkedSettled =
                linkedThread !== null &&
                linkedThread.settledOverride === "settled" &&
                !isThreadWorking(linkedThread);
              const linkedWorking = linkedThread !== null && isThreadWorking(linkedThread);

              return (
                <div
                  key={item.id}
                  className={cn(
                    "group flex flex-col gap-1.5 rounded-lg border border-border/70 bg-card/90 p-2.5 text-left shadow-xs transition-colors hover:border-border",
                    item.pinned && "border-primary/30 bg-primary/5",
                    isCompleted && "opacity-75",
                  )}
                >
                  <div className="flex items-start gap-2">
                    {canOperate ? (
                      <button
                        type="button"
                        aria-label={isCompleted ? gt("Mark as open") : gt("Mark as completed")}
                        onClick={() => void handleQuickToggle(item, { completed: !isCompleted })}
                        className="mt-0.5 shrink-0 text-muted-foreground transition-colors hover:text-foreground"
                      >
                        {isCompleted ? (
                          <CheckCircle2Icon className="size-4 text-success" />
                        ) : (
                          <CircleIcon className="size-4" />
                        )}
                      </button>
                    ) : (
                      <span className="mt-0.5 shrink-0 text-muted-foreground">
                        {isCompleted ? (
                          <CheckCircle2Icon className="size-4 text-success" />
                        ) : (
                          <CircleIcon className="size-4" />
                        )}
                      </span>
                    )}

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span
                          className={cn(
                            "text-xs font-medium leading-snug text-foreground break-words",
                            isCompleted && "line-through text-muted-foreground",
                          )}
                        >
                          {item.title}
                        </span>
                        {item.kind === "note" ? (
                          <Badge size="sm" variant="secondary">
                            <T>Note</T>
                          </Badge>
                        ) : null}
                        {item.priority === "high" ? (
                          <Badge size="sm" variant="warning">
                            <T>High</T>
                          </Badge>
                        ) : null}
                        {item.createdBy === "agent" ? (
                          <Badge size="sm" variant="outline">
                            <BotIcon className="size-3" />
                            <span>
                              <T>Agent</T>
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

                  {item.linkedThreadId !== null ? (
                    <div className="flex flex-wrap items-center gap-1.5 pl-6">
                      <Button
                        type="button"
                        size="xs"
                        variant="outline"
                        onClick={() => handleOpenThread(item.linkedThreadId!)}
                      >
                        <ExternalLinkIcon className="size-3" />
                        <span className="max-w-40 truncate">
                          {linkedThread ? linkedThread.title : gt("Linked thread (status unknown)")}
                        </span>
                        {linkedWorking ? (
                          <Badge size="sm" variant="info">
                            <T>Working</T>
                          </Badge>
                        ) : linkedSettled ? (
                          <Badge size="sm" variant="success">
                            <T>Settled</T>
                          </Badge>
                        ) : null}
                      </Button>

                      {linkedSettled && !isCompleted && canOperate ? (
                        <Button
                          type="button"
                          size="xs"
                          variant="secondary"
                          onClick={() => void handleQuickToggle(item, { completed: true })}
                        >
                          <T>Mark done?</T>
                        </Button>
                      ) : null}
                    </div>
                  ) : null}

                  <div className="flex items-center justify-between gap-2 pl-6 pt-0.5">
                    <div className="flex items-center gap-2 text-2xs text-muted-foreground">
                      <span>{formatRelativeAge(item.createdAt)}</span>
                      {item.sourceThreadId !== null ? (
                        <button
                          type="button"
                          onClick={() => handleOpenThread(item.sourceThreadId!)}
                          className="underline-offset-2 hover:text-foreground hover:underline"
                        >
                          <T>Source thread</T>
                        </button>
                      ) : null}
                    </div>

                    <div className="flex items-center gap-0.5">
                      {!isArchived ? (
                        props.compact ? (
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <Button
                                  type="button"
                                  size="icon-xs"
                                  variant="ghost"
                                  aria-label={gt("Draft in new thread")}
                                  onClick={() => void handleDispatchDraft(item)}
                                />
                              }
                            >
                              <SendIcon className="size-3" />
                            </TooltipTrigger>
                            <TooltipPopup side="top">
                              <T>Draft in new thread</T>
                            </TooltipPopup>
                          </Tooltip>
                        ) : (
                          <Button
                            type="button"
                            size="xs"
                            variant="outline"
                            onClick={() => void handleDispatchDraft(item)}
                          >
                            <SendIcon className="size-3" />
                            <span>
                              <T>Draft in thread</T>
                            </span>
                          </Button>
                        )
                      ) : null}

                      {canOperate ? (
                        <>
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <Button
                                  type="button"
                                  size="icon-xs"
                                  variant="ghost"
                                  aria-label={item.pinned ? gt("Unpin") : gt("Pin")}
                                  onClick={() =>
                                    void handleQuickToggle(item, { pinned: !item.pinned })
                                  }
                                />
                              }
                            >
                              {item.pinned ? (
                                <PinOffIcon className="size-3" />
                              ) : (
                                <PinIcon className="size-3" />
                              )}
                            </TooltipTrigger>
                            <TooltipPopup side="top">
                              {item.pinned ? gt("Unpin") : gt("Pin to project memory")}
                            </TooltipPopup>
                          </Tooltip>

                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <Button
                                  type="button"
                                  size="icon-xs"
                                  variant="ghost"
                                  aria-label={gt("Edit item")}
                                  onClick={() => setDialogState({ mode: "edit", item })}
                                />
                              }
                            >
                              <PencilIcon className="size-3" />
                            </TooltipTrigger>
                            <TooltipPopup side="top">
                              <T>Edit & link thread</T>
                            </TooltipPopup>
                          </Tooltip>

                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <Button
                                  type="button"
                                  size="icon-xs"
                                  variant="ghost"
                                  aria-label={isArchived ? gt("Restore item") : gt("Archive item")}
                                  onClick={() =>
                                    void handleQuickToggle(item, { archived: !isArchived })
                                  }
                                />
                              }
                            >
                              {isArchived ? (
                                <ArchiveRestoreIcon className="size-3" />
                              ) : (
                                <ArchiveIcon className="size-3" />
                              )}
                            </TooltipTrigger>
                            <TooltipPopup side="top">
                              {isArchived ? gt("Restore") : gt("Archive")}
                            </TooltipPopup>
                          </Tooltip>
                        </>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })
          )}

          {effectiveHasMore ? (
            <Button
              type="button"
              size="xs"
              variant="outline"
              disabled={loadingMore}
              onClick={() => void handleLoadMore()}
            >
              {loadingMore ? gt("Loading...") : gt("Load more")}
            </Button>
          ) : null}
        </div>
      </ScrollArea>

      <ProjectTodoFormDialog
        open={dialogState.mode !== "closed"}
        onOpenChange={(open) => {
          if (!open) setDialogState({ mode: "closed" });
        }}
        environmentId={props.environmentId}
        projectId={props.projectId}
        {...(props.projectName !== undefined ? { projectName: props.projectName } : {})}
        sourceThreadId={props.sourceThreadId ?? null}
        editSummary={dialogState.mode === "edit" ? dialogState.item : null}
        initialKind={quickKind}
        onSaved={() => setExtraPages(null)}
        onDeleted={() => setExtraPages(null)}
      />
    </div>
  );
}
