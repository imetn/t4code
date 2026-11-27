import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { isThreadWorking } from "@t3tools/client-runtime/state/thread-inbox";
import { hasUnseenRunFailure } from "@t3tools/client-runtime/state/thread-settled";
import { isShownUnderParent } from "@t3tools/client-runtime/state/threads";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { DesktopTrayState, DesktopTrayThreadSummary, EnvironmentId } from "@t3tools/contracts";

export type TaskBoardColumnId = "working" | "attention" | "active" | "settled";

export type TaskBoardAttentionReason =
  | "approval"
  | "input"
  | "plan"
  | "subagent"
  | "guest"
  | "failed"
  | null;

export interface TaskBoardCardItem {
  readonly thread: EnvironmentThreadShell;
  readonly key: string;
  readonly column: TaskBoardColumnId;
  readonly attentionReason: TaskBoardAttentionReason;
  readonly projectName: string;
  readonly environmentLabel: string;
}

export interface TaskBoardColumns {
  readonly working: ReadonlyArray<TaskBoardCardItem>;
  readonly attention: ReadonlyArray<TaskBoardCardItem>;
  readonly active: ReadonlyArray<TaskBoardCardItem>;
  readonly settled: ReadonlyArray<TaskBoardCardItem>;
}

function resolveThreadAttentionReason(
  thread: Pick<
    EnvironmentThreadShell,
    | "hasPendingApprovals"
    | "hasPendingUserInput"
    | "hasActionableProposedPlan"
    | "pendingSubagentRequest"
    | "pendingGuestMessageCount"
    | "latestRun"
    | "lastVisitedAt"
  >,
): TaskBoardAttentionReason {
  if (thread.hasPendingApprovals) return "approval";
  if (thread.hasPendingUserInput) return "input";
  if (thread.pendingSubagentRequest != null) return "subagent";
  if (thread.hasActionableProposedPlan) return "plan";
  if ((thread.pendingGuestMessageCount ?? 0) > 0) return "guest";
  if (hasUnseenRunFailure(thread)) return "failed";
  return null;
}

export function classifyTaskBoardColumn(thread: EnvironmentThreadShell): {
  readonly column: TaskBoardColumnId;
  readonly attentionReason: TaskBoardAttentionReason;
} {
  const attentionReason = resolveThreadAttentionReason(thread);
  if (
    thread.settledOverride === "settled" &&
    attentionReason === null &&
    !isThreadWorking(thread)
  ) {
    return { column: "settled", attentionReason: null };
  }
  if (attentionReason !== null) {
    return { column: "attention", attentionReason };
  }
  if (isThreadWorking(thread)) {
    return { column: "working", attentionReason: null };
  }
  return { column: "active", attentionReason: null };
}

export function resolveDockedTaskBoardColumn(
  columnId: TaskBoardColumnId,
  showSettled: boolean,
): TaskBoardColumnId {
  if (!showSettled && columnId === "settled") return "working";
  return columnId;
}

function compareBoardCards(left: TaskBoardCardItem, right: TaskBoardCardItem): number {
  const leftPinned = left.thread.pinnedAt !== null ? 1 : 0;
  const rightPinned = right.thread.pinnedAt !== null ? 1 : 0;
  if (left.column === "active" && leftPinned !== rightPinned) {
    return rightPinned - leftPinned;
  }
  return right.thread.updatedAt.localeCompare(left.thread.updatedAt);
}

export function partitionTaskBoardThreads(input: {
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly delegatedUnderParent: ReadonlySet<string>;
  readonly projectNameByScopedKey: ReadonlyMap<string, string>;
  readonly environmentLabelById: ReadonlyMap<EnvironmentId, string>;
  readonly environmentIds?: ReadonlySet<EnvironmentId> | null;
  readonly projectScopedKeys?: ReadonlySet<string> | null;
  readonly searchQuery?: string;
}): TaskBoardColumns {
  const query = (input.searchQuery ?? "").trim().toLowerCase();
  const working: TaskBoardCardItem[] = [];
  const attention: TaskBoardCardItem[] = [];
  const active: TaskBoardCardItem[] = [];
  const settled: TaskBoardCardItem[] = [];

  for (const thread of input.threads) {
    if (thread.archivedAt !== null || thread.deletedAt !== null) continue;
    if (
      isShownUnderParent(
        { environmentId: thread.environmentId, threadId: thread.id },
        thread.lineage,
        input.delegatedUnderParent,
      )
    ) {
      continue;
    }
    if (
      input.environmentIds &&
      input.environmentIds.size > 0 &&
      !input.environmentIds.has(thread.environmentId)
    ) {
      continue;
    }
    const projectScopedKey = `${thread.environmentId}:${thread.projectId}`;
    if (
      input.projectScopedKeys &&
      input.projectScopedKeys.size > 0 &&
      !input.projectScopedKeys.has(projectScopedKey)
    ) {
      continue;
    }

    const projectName = input.projectNameByScopedKey.get(projectScopedKey) ?? "";
    const environmentLabel = input.environmentLabelById.get(thread.environmentId) ?? "";

    if (query.length > 0) {
      const haystack =
        `${thread.title} ${projectName} ${environmentLabel} ${thread.branch ?? ""}`.toLowerCase();
      if (!haystack.includes(query)) continue;
    }

    const { column, attentionReason } = classifyTaskBoardColumn(thread);
    const card: TaskBoardCardItem = {
      thread,
      key: scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
      column,
      attentionReason,
      projectName,
      environmentLabel,
    };

    if (column === "working") working.push(card);
    else if (column === "attention") attention.push(card);
    else if (column === "settled") settled.push(card);
    else active.push(card);
  }

  working.sort(compareBoardCards);
  attention.sort(compareBoardCards);
  active.sort(compareBoardCards);
  settled.sort(compareBoardCards);

  return { working, attention, active, settled };
}

export function buildDesktopTrayState(input: {
  readonly enabled: boolean;
  readonly columns: TaskBoardColumns;
  readonly maxThreads?: number;
}): DesktopTrayState {
  const maxThreads = Math.min(12, Math.max(1, input.maxThreads ?? 8));
  const prioritized = [
    ...input.columns.attention.map((item): DesktopTrayThreadSummary => ({
      environmentId: item.thread.environmentId,
      threadId: item.thread.id,
      title: item.thread.title.slice(0, 200),
      projectName: item.projectName.slice(0, 120),
      environmentLabel: item.environmentLabel.slice(0, 80),
      status: "attention",
    })),
    ...input.columns.working.map((item): DesktopTrayThreadSummary => ({
      environmentId: item.thread.environmentId,
      threadId: item.thread.id,
      title: item.thread.title.slice(0, 200),
      projectName: item.projectName.slice(0, 120),
      environmentLabel: item.environmentLabel.slice(0, 80),
      status: "working",
    })),
    ...input.columns.active.slice(0, 4).map((item): DesktopTrayThreadSummary => ({
      environmentId: item.thread.environmentId,
      threadId: item.thread.id,
      title: item.thread.title.slice(0, 200),
      projectName: item.projectName.slice(0, 120),
      environmentLabel: item.environmentLabel.slice(0, 80),
      status: "active",
    })),
  ].slice(0, maxThreads);

  return {
    enabled: input.enabled,
    workingCount: input.columns.working.length,
    attentionCount: input.columns.attention.length,
    activeCount: input.columns.active.length,
    threads: prioritized,
  };
}
