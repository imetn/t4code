import type {
  EnvironmentId,
  ProviderMcpServerConnectionStatus,
  ProviderMcpServerEntry,
  ProviderThreadId,
  ThreadId,
} from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { msg, T, useGT, useMessages } from "gt-react";
import { ChevronDownIcon, ChevronRightIcon, PlugIcon, RefreshCwIcon } from "lucide-react";
import { useState } from "react";

import { cn } from "../../lib/utils";
import { formatEnvironmentQueryError } from "../../state/query";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { Switch } from "../ui/switch";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { McpSignInAction } from "./McpSignInAction";
import { summarizeMcpConnectors } from "./ThreadDetailsContext.logic";
import { ThreadDetailsControl } from "./ThreadDetailsControl";
import { ThreadDetailsSection } from "./ThreadDetailsSection";
import {
  THREAD_DETAILS_PANEL_CHEVRON_CLASS,
  THREAD_DETAILS_PANEL_ICON_CLASS,
  THREAD_DETAILS_PANEL_LABEL_CLASS,
} from "./threadDetailsPanelStyles";

const STATUS_DOT_CLASS: Record<ProviderMcpServerConnectionStatus, string> = {
  connected: "bg-emerald-500",
  "needs-auth": "bg-amber-500",
  pending: "bg-amber-400",
  failed: "bg-rose-500",
  disabled: "bg-muted-foreground/40",
};

const STATUS_LABEL: Record<ProviderMcpServerConnectionStatus, string> = {
  connected: msg("Connected"),
  "needs-auth": msg("Needs sign-in"),
  pending: msg("Connecting"),
  failed: msg("Failed"),
  disabled: msg("Disabled"),
};

export function ThreadDetailsConnectors({
  environmentId,
  threadId,
  providerThreadId,
  servers,
  fetchedAt,
  loading,
  onRefresh,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly providerThreadId: ProviderThreadId | null;
  readonly servers: ReadonlyArray<ProviderMcpServerEntry>;
  readonly fetchedAt: string | null;
  readonly loading: boolean;
  readonly onRefresh: () => void;
}) {
  const gt = useGT();
  const m = useMessages();
  const [expanded, setExpanded] = useState(false);
  const [pendingServer, setPendingServer] = useState<string | null>(null);
  const canReconnect = useAtomValue(threadEnvironment.mcpReconnect.permissionAtom(environmentId));
  const canToggle = useAtomValue(threadEnvironment.mcpToggle.permissionAtom(environmentId));
  const reconnect = useAtomCommand(threadEnvironment.mcpReconnect, { reportFailure: false });
  const toggle = useAtomCommand(threadEnvironment.mcpToggle, { reportFailure: false });

  if (servers.length === 0) return null;

  const summary = summarizeMcpConnectors(servers);
  const noticeAt = fetchedAt ? Date.parse(fetchedAt) || 0 : 0;

  const summaryBadge =
    summary.attentionCount > 0
      ? summary.failedCount > 0
        ? gt("{count} to reconnect", { count: summary.attentionCount })
        : gt("{count} needs sign-in", { count: summary.needsAuthCount })
      : summary.pendingCount > 0
        ? gt("Connecting…")
        : String(summary.connected);

  const handleReconnect = async (server: string) => {
    if (!providerThreadId || pendingServer !== null) return;
    setPendingServer(server);
    const result = await reconnect({
      environmentId,
      input: { threadId, providerThreadId, server },
    });
    setPendingServer(null);
    if (result._tag === "Failure") {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: gt("Couldn’t reconnect {server}", { server }),
          description: formatEnvironmentQueryError(result.cause),
        }),
      );
      return;
    }
    toastManager.add(
      stackedThreadToast({
        type: "success",
        title: gt("Reconnected {server}", { server }),
      }),
    );
    onRefresh();
  };

  const handleToggle = async (server: string, enabled: boolean) => {
    if (!providerThreadId || pendingServer !== null) return;
    setPendingServer(server);
    const result = await toggle({
      environmentId,
      input: { threadId, providerThreadId, server, enabled },
    });
    setPendingServer(null);
    if (result._tag === "Failure") {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: enabled
            ? gt("Couldn’t enable {server}", { server })
            : gt("Couldn’t disable {server}", { server }),
          description: formatEnvironmentQueryError(result.cause),
        }),
      );
      return;
    }
    onRefresh();
  };

  return (
    <ThreadDetailsSection
      headingId="thread-details-connectors-heading"
      title={gt("Connectors")}
      showHeading={false}
    >
      <div className="flex flex-col">
        <ThreadDetailsControl
          variant="ghost"
          size="sm"
          part="row"
          aria-expanded={expanded}
          onClick={() => {
            const next = !expanded;
            setExpanded(next);
            if (next) onRefresh();
          }}
        >
          <PlugIcon className={THREAD_DETAILS_PANEL_ICON_CLASS} aria-hidden />
          <span className={cn("min-w-0 flex-1 truncate", THREAD_DETAILS_PANEL_LABEL_CLASS)}>
            <T>Connectors</T>
          </span>
          <span
            className={cn(
              "shrink-0 text-xs tabular-nums",
              summary.attentionCount > 0
                ? "font-medium text-warning-foreground"
                : "text-muted-foreground",
            )}
          >
            {summaryBadge}
          </span>
          {expanded ? (
            <ChevronDownIcon className={THREAD_DETAILS_PANEL_CHEVRON_CLASS} aria-hidden />
          ) : (
            <ChevronRightIcon className={THREAD_DETAILS_PANEL_CHEVRON_CLASS} aria-hidden />
          )}
        </ThreadDetailsControl>

        {expanded ? (
          <div
            data-thread-details-connectors-overflow
            className="mt-1 flex max-h-56 flex-col gap-1 overflow-y-auto px-2 pb-1"
          >
            <div className="flex items-center justify-between px-0.5 text-3xs text-muted-foreground">
              <span>
                {gt("{connected} of {total} connected", {
                  connected: summary.connected,
                  total: summary.total,
                })}
              </span>
              <button
                type="button"
                aria-label={gt("Refresh connectors")}
                disabled={loading}
                onClick={onRefresh}
                className="inline-flex size-5 items-center justify-center rounded-md text-muted-foreground hover:bg-black/[0.04] hover:text-foreground disabled:opacity-50 dark:hover:bg-white/[0.08]"
              >
                <RefreshCwIcon className={cn("size-3", loading && "animate-spin")} aria-hidden />
              </button>
            </div>

            {servers.map((server) => {
              const busy = pendingServer === server.name;
              const statusText = m(STATUS_LABEL[server.status]);
              const showReconnect =
                server.canReconnect && canReconnect && providerThreadId !== null;
              const showToggle = server.canToggle && canToggle && providerThreadId !== null;
              const showSignIn =
                server.status === "needs-auth" && server.canSignIn && providerThreadId !== null;

              return (
                <div
                  key={server.name}
                  className="flex flex-col gap-0.5 rounded-lg px-1.5 py-1 hover:bg-black/[0.03] dark:hover:bg-white/[0.05]"
                >
                  <div className="flex items-center gap-2">
                    <Tooltip>
                      <TooltipTrigger render={<span className="inline-flex shrink-0" />}>
                        <span
                          aria-label={statusText}
                          className={cn("size-2 rounded-full", STATUS_DOT_CLASS[server.status])}
                        />
                      </TooltipTrigger>
                      <TooltipPopup side="left" sideOffset={8}>
                        <span>{statusText}</span>
                        {server.scope ? (
                          <span className="ml-1.5 text-muted-foreground">({server.scope})</span>
                        ) : null}
                      </TooltipPopup>
                    </Tooltip>

                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium text-foreground/85">
                        {server.name}
                      </div>
                      <div className="truncate text-3xs text-muted-foreground">
                        {server.status === "connected"
                          ? gt("{count, plural, one {{count} tool} other {{count} tools}}", {
                              count: server.toolCount,
                            })
                          : statusText}
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-1.5">
                      {showSignIn ? (
                        <McpSignInAction
                          environmentId={environmentId}
                          threadId={threadId}
                          providerThreadId={providerThreadId}
                          server={server.name}
                          noticeAt={noticeAt}
                          onSignedIn={onRefresh}
                        />
                      ) : null}
                      {showReconnect ? (
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <button
                                type="button"
                                aria-label={gt("Reconnect {server}", { server: server.name })}
                                disabled={pendingServer !== null}
                                onClick={() => void handleReconnect(server.name)}
                                className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-black/[0.05] hover:text-foreground disabled:opacity-50 dark:hover:bg-white/[0.1]"
                              />
                            }
                          >
                            <RefreshCwIcon
                              className={cn("size-3", busy && "animate-spin")}
                              aria-hidden
                            />
                          </TooltipTrigger>
                          <TooltipPopup side="top">
                            <T>Reconnect</T>
                          </TooltipPopup>
                        </Tooltip>
                      ) : null}
                      {showToggle ? (
                        <Switch
                          size="sm"
                          checked={server.status !== "disabled"}
                          disabled={pendingServer !== null}
                          aria-label={gt("Toggle {server}", { server: server.name })}
                          onCheckedChange={(checked) =>
                            void handleToggle(server.name, Boolean(checked))
                          }
                        />
                      ) : null}
                    </div>
                  </div>

                  {server.error && server.status === "failed" ? (
                    <Tooltip>
                      <TooltipTrigger
                        render={<p className="truncate pl-4 text-3xs text-error-foreground/90" />}
                      >
                        {server.error}
                      </TooltipTrigger>
                      <TooltipPopup side="left" sideOffset={8}>
                        {server.error}
                      </TooltipPopup>
                    </Tooltip>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    </ThreadDetailsSection>
  );
}
