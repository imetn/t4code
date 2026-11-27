import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { T, useGT } from "gt-react";
import { ArrowLeftIcon, GitBranchIcon, Maximize2Icon, XIcon } from "lucide-react";
import type { ReactNode } from "react";

import { ComposerHandleContext } from "../../composerHandleContext";
import { useQuietThreadProjection, useQuietThreadShell } from "../../state/entities";
import { useEnvironmentShellStatus } from "../../state/shell";
import { useEnvironmentThread } from "../../state/threads";
import {
  isThreadRouteSnapshotAuthoritative,
  resolveThreadRouteRenderState,
} from "../../threadRoutes";
import ChatView from "../ChatView";
import { ProjectFavicon } from "../ProjectFavicon";
import { useOpenThreadFamily } from "../ThreadRouteView";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export interface TaskBoardStatusBadge {
  readonly icon: ReactNode;
  readonly label: string;
  readonly variant: "secondary" | "warning" | "outline" | "error";
}

export function TaskBoardThreadPane({
  threadRef,
  project,
  environmentLabel,
  showEnvironmentBadge,
  statusBadge,
  onClose,
  onOpenFullView,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly project: EnvironmentProject | null;
  readonly environmentLabel: string | null;
  readonly showEnvironmentBadge: boolean;
  readonly statusBadge: TaskBoardStatusBadge | null;
  readonly onClose: () => void;
  readonly onOpenFullView: () => void;
}) {
  const gt = useGT();
  const shell = useQuietThreadShell(threadRef);
  const bootstrapComplete = isThreadRouteSnapshotAuthoritative(
    useEnvironmentShellStatus(threadRef.environmentId),
  );
  const unlistedDetail = useEnvironmentThread(
    shell === null ? threadRef.environmentId : null,
    shell === null ? threadRef.threadId : null,
  );
  useOpenThreadFamily(threadRef, bootstrapComplete && shell === null);
  const renderState = resolveThreadRouteRenderState({
    bootstrapComplete,
    serverThreadExists: shell !== null,
    serverThreadDeleted: shell?.deletedAt != null,
    unlistedThreadDetail: unlistedDetail,
    draftThreadExists: false,
  });
  const projection = useQuietThreadProjection(threadRef)?.projection;
  const thread = shell ?? projection?.thread ?? null;
  const title = thread?.title || gt("Untitled thread");

  return (
    <div
      data-board-thread-pane={threadRef.threadId}
      data-testid="task-board-thread-pane"
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-border/70 bg-background"
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/60 bg-muted/10 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 md:hidden">
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={gt("Back to board")}
              onClick={onClose}
            >
              <ArrowLeftIcon className="size-3.5" />
            </Button>
          </span>
          {project ? <ProjectFavicon project={project} className="size-4 shrink-0" /> : null}
          <h2
            tabIndex={-1}
            data-task-board-pane-title=""
            className="min-w-0 truncate text-sm font-medium text-foreground focus:outline-hidden"
          >
            {title}
          </h2>
          {statusBadge ? (
            <Badge size="sm" variant={statusBadge.variant}>
              <span className="inline-flex items-center gap-1">
                {statusBadge.icon}
                <span>{statusBadge.label}</span>
              </span>
            </Badge>
          ) : null}
          {showEnvironmentBadge && environmentLabel ? (
            <Badge size="sm" variant="outline">
              {environmentLabel}
            </Badge>
          ) : null}
          {thread?.branch ? (
            <span className="hidden max-w-40 items-center gap-1 truncate rounded bg-muted/60 px-1.5 py-0.5 font-mono text-3xs text-muted-foreground lg:inline-flex">
              <GitBranchIcon className="size-2.5 shrink-0" />
              <span className="truncate">{thread.branch}</span>
            </span>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={gt("Open full thread view")}
                  onClick={onOpenFullView}
                />
              }
            >
              <Maximize2Icon className="size-3.5" />
            </TooltipTrigger>
            <TooltipPopup side="bottom">
              <T>Open full thread view</T>
            </TooltipPopup>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={gt("Back to board")}
                  onClick={onClose}
                />
              }
            >
              <XIcon className="size-3.5" />
            </TooltipTrigger>
            <TooltipPopup side="bottom">
              <T>Back to board</T>
            </TooltipPopup>
          </Tooltip>
        </div>
      </div>

      {renderState === "missing" ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <p className="text-sm text-muted-foreground">
            <T>This thread is no longer available.</T>
          </p>
          <Button type="button" size="sm" variant="outline" onClick={onClose}>
            <T>Back to board</T>
          </Button>
        </div>
      ) : renderState === "loading" && thread === null ? null : (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <ComposerHandleContext value={null}>
            <ChatView
              environmentId={threadRef.environmentId}
              threadId={threadRef.threadId}
              routeKind="server"
              embedded="board"
            />
          </ComposerHandleContext>
        </div>
      )}
    </div>
  );
}
