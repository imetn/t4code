import type { EnvironmentId, ProviderThreadInspectResult, ThreadId } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { useEffect, useEffectEvent, useState } from "react";

import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";

interface ThreadInspectorState {
  readonly key: string;
  readonly completedToken: string;
  readonly data: ProviderThreadInspectResult | null;
}

export function useThreadInspector({
  environmentId,
  threadId,
  enabled,
  refreshKey,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly enabled: boolean;
  /** Changes when the thread's usage snapshot updates, triggering a quiet refresh. */
  readonly refreshKey: string;
}): {
  readonly data: ProviderThreadInspectResult | null;
  readonly loading: boolean;
  readonly refresh: () => void;
} {
  const allowed = useAtomValue(threadEnvironment.inspectThread.permissionAtom(environmentId));
  const runInspect = useAtomCommand(threadEnvironment.inspectThread, { reportFailure: false });
  const key = `${environmentId}:${threadId}`;
  const [manualRefreshCount, setManualRefreshCount] = useState(0);
  const requestToken = `${key}:${refreshKey}:${manualRefreshCount}`;
  const [state, setState] = useState<ThreadInspectorState>({
    key,
    completedToken: "",
    data: null,
  });

  const fetchInspect = useEffectEvent(() => runInspect({ environmentId, input: { threadId } }));

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- fetches live context breakdown and MCP connector statuses from the server RPC when the thread or usage snapshot changes
  useEffect(() => {
    if (!enabled || !allowed) return;
    let cancelled = false;
    void fetchInspect().then((result) => {
      if (cancelled) return;
      if (result._tag === "Success") {
        setState({ key, completedToken: requestToken, data: result.value });
      } else {
        setState((current) =>
          current.key === key
            ? { ...current, completedToken: requestToken }
            : { key, completedToken: requestToken, data: null },
        );
      }
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, allowed, key, requestToken]);

  const active = enabled && allowed;
  const currentData = active && state.key === key ? state.data : null;
  const currentLoading = active && state.completedToken !== requestToken;

  return {
    data: currentData,
    loading: currentLoading,
    refresh: () => setManualRefreshCount((count) => count + 1),
  };
}
