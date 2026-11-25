import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { threadHandoffNotice } from "@t3tools/client-runtime/state/peerLinks";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { useNavigate } from "@tanstack/react-router";
import { msg, useGT, useMessages } from "gt-react";
import { ArrowUpRightIcon, MonitorUpIcon, TriangleAlertIcon } from "lucide-react";
import { useState } from "react";

import { m, type MessageResolver } from "~/i18n/messages";
import { useConnectedEnvironmentIds } from "~/state/environments";
import { threadHandoffEnvironment } from "~/state/threadHandoff";
import { useAtomCommand } from "~/state/use-atom-command";
import { buildThreadRouteParams } from "../../threadRoutes";
import { Button } from "../ui/button";
import { stackedThreadToast, toastManager } from "../ui/toast";
import type { ComposerBannerStackItem } from "./ComposerBannerStack";

/** Why the composer is closed while a thread moves away, or null when it is open. */
export function threadHandoffSendBlockReason(
  shell: Pick<EnvironmentThreadShell, "handoff"> | null | undefined,
  resolve: MessageResolver = m,
): string | null {
  const handoff = shell?.handoff;
  if (handoff?.state === "departing") {
    return resolve(msg("Moving to {label}", { label: handoff.label }));
  }
  if (handoff?.state === "departed") {
    return resolve(msg("Continues on {label}", { label: handoff.label }));
  }
  return null;
}

/**
 * The banner for a thread's move to a linked environment: waiting (with
 * Keep it here), under way, moved (with a link to it there when this client is
 * connected to that environment), or failed (with Dismiss).
 */
export function useThreadHandoffBannerItem(
  shell: Pick<EnvironmentThreadShell, "environmentId" | "id" | "handoff"> | null | undefined,
): ComposerBannerStackItem | null {
  const gt = useGT();
  const messages = useMessages();
  const navigate = useNavigate();
  const cancel = useAtomCommand(threadHandoffEnvironment.cancel, { label: "cancel thread move" });
  const [cancellingKey, setCancellingKey] = useState<string | null>(null);
  const handoff = shell?.handoff ?? null;
  const cancellationKey =
    shell == null || handoff === null ? null : `${shell.id}:${handoff.handoffId}`;
  const cancelling = cancellationKey !== null && cancellingKey === cancellationKey;
  const connectedEnvironmentIds = useConnectedEnvironmentIds();
  const canOpenThere =
    handoff?.state === "departed" && connectedEnvironmentIds.includes(handoff.environmentId);
  const notice = threadHandoffNotice(handoff, messages);
  if (shell == null || handoff === null || notice === null) return null;

  const requestCancel = (failureTitle: string) => {
    if (cancellationKey !== null) setCancellingKey(cancellationKey);
    void cancel({ environmentId: shell.environmentId, input: { threadId: shell.id } }).then(
      (result) => {
        setCancellingKey((current) => (current === cancellationKey ? null : current));
        if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: failureTitle,
              description: String(squashAtomCommandFailure(result)),
            }),
          );
        }
      },
    );
  };

  const actions =
    handoff.state === "pending" ? (
      <Button
        size="xs"
        variant="ghost"
        disabled={cancelling}
        onClick={() => requestCancel(gt("Could not cancel the move"))}
      >
        {cancelling ? gt("Cancelling…") : gt("Keep it here")}
      </Button>
    ) : handoff.state === "failed" ? (
      <Button
        size="xs"
        variant="ghost"
        disabled={cancelling}
        onClick={() => requestCancel(gt("Could not dismiss the move"))}
      >
        {cancelling ? gt("Dismissing…") : gt("Dismiss")}
      </Button>
    ) : handoff.state === "departed" && canOpenThere ? (
      <Button
        size="xs"
        variant="ghost"
        onClick={() =>
          void navigate({
            to: "/$environmentId/$threadId",
            params: buildThreadRouteParams(scopeThreadRef(handoff.environmentId, handoff.threadId)),
          })
        }
      >
        {gt("Open on {label}", { label: handoff.label })}
        <ArrowUpRightIcon />
      </Button>
    ) : undefined;
  return {
    id: `thread-handoff:${shell.id}:${handoff.handoffId}:${handoff.state}`,
    variant: notice.tone,
    icon: notice.tone === "error" ? <TriangleAlertIcon /> : <MonitorUpIcon />,
    title: notice.title,
    ...(notice.detail === null ? {} : { description: notice.detail }),
    ...(actions === undefined ? {} : { actions }),
  };
}
