import { threadHandoffNotice } from "@t3tools/client-runtime/state/peerLinks";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { useNavigation } from "@react-navigation/native";
import { useGT, useMessages } from "gt-react-native";
import { useState } from "react";
import { View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { cn } from "../../lib/cn";
import { useEnvironments } from "../../state/environments";
import { threadHandoffEnvironment } from "../../state/threadHandoff";
import { useAtomCommand } from "../../state/use-atom-command";
import { RequestActionButton } from "./RequestActionButton";

/** Whether the composer is closed because the thread is moving or has moved away. */
export function threadHandoffClosesComposer(
  thread: Pick<EnvironmentThreadShell, "handoff">,
): boolean {
  return thread.handoff?.state === "departing" || thread.handoff?.state === "departed";
}

/**
 * A thread's move to a linked environment: waiting for its turn to end (with
 * Keep it here), under way, moved (with a link there when this app is
 * connected to it), or failed (with Dismiss).
 */
export function ThreadHandoffCard({ thread }: { thread: EnvironmentThreadShell }) {
  const gt = useGT();
  const messages = useMessages();
  const navigation = useNavigation();
  const cancel = useAtomCommand(threadHandoffEnvironment.cancel, {
    label: "cancel thread move",
    reportFailure: false,
  });
  const [cancellingKey, setCancellingKey] = useState<string | null>(null);
  const [errorState, setErrorState] = useState<{
    readonly key: string;
    readonly message: string;
  } | null>(null);
  const { presentationById } = useEnvironments();
  const handoff = thread.handoff;
  const notice = threadHandoffNotice(handoff, messages);
  if (handoff === null || notice === null) return null;

  const cancellationKey = `${thread.id}:${handoff.handoffId}`;
  const cancelling = cancellingKey === cancellationKey;
  const error = errorState?.key === cancellationKey ? errorState.message : null;

  const requestCancel = async () => {
    setCancellingKey(cancellationKey);
    setErrorState((current) => (current?.key === cancellationKey ? null : current));
    const result = await cancel({
      environmentId: thread.environmentId,
      input: { threadId: thread.id },
    });
    setCancellingKey((current) => (current === cancellationKey ? null : current));
    if (result._tag === "Failure") {
      setErrorState({
        key: cancellationKey,
        message: String(squashAtomCommandFailure(result)),
      });
    }
  };

  return (
    <View className="mx-3 mb-2 gap-2 rounded-xl border border-border-subtle bg-screen p-3">
      <Text
        className={cn(
          "text-sm font-t3-bold",
          notice.tone === "error" ? "text-danger-foreground" : "text-foreground",
        )}
      >
        {notice.title}
      </Text>
      {notice.detail !== null ? (
        <Text className="text-sm text-foreground-secondary">{notice.detail}</Text>
      ) : null}
      {handoff.state === "pending" ? (
        <View className="flex-row">
          <RequestActionButton
            label={cancelling ? gt("Cancelling…") : gt("Keep it here")}
            tone="secondary"
            disabled={cancelling}
            onPress={() => void requestCancel()}
          />
        </View>
      ) : handoff.state === "failed" ? (
        <View className="flex-row">
          <RequestActionButton
            label={cancelling ? gt("Dismissing…") : gt("Dismiss")}
            tone="secondary"
            disabled={cancelling}
            onPress={() => void requestCancel()}
          />
        </View>
      ) : handoff.state === "departed" &&
        presentationById.get(handoff.environmentId)?.connection.phase === "connected" ? (
        <View className="flex-row">
          <RequestActionButton
            label={gt("Open on {label}", { label: handoff.label })}
            tone="secondary"
            onPress={() =>
              navigation.navigate("Thread", {
                environmentId: handoff.environmentId,
                threadId: handoff.threadId,
              })
            }
          />
        </View>
      ) : null}
      {error !== null ? (
        <Text accessibilityRole="alert" className="text-sm text-danger-foreground">
          {error}
        </Text>
      ) : null}
    </View>
  );
}
