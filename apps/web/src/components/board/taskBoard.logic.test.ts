import { EnvironmentId, ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { describe, expect, it } from "vite-plus/test";

import { buildDesktopTrayState, partitionTaskBoardThreads } from "./taskBoard.logic";

function makeThread(
  overrides: Omit<Partial<EnvironmentThreadShell>, "id"> & { id: string },
): EnvironmentThreadShell {
  const { id, ...rest } = overrides;
  return {
    environmentId: EnvironmentId.make("env-1"),
    projectId: ProjectId.make("proj-1"),
    title: overrides.title ?? `Thread ${id}`,
    providerInstanceId: ProviderInstanceId.make("codex"),
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-6.2-sol" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    lineage: {
      parentThreadId: null,
      relationshipToParent: null,
      sideChat: false,
      workflowStep: false,
    } as unknown as EnvironmentThreadShell["lineage"],
    forkedFrom: null,
    linkOrigin: null,
    delegatedFrom: null,
    workflowRun: null,
    activeProviderThreadId: null,
    latestRun: null,
    runtime: null,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    pendingBackgroundTasks: [],
    providerInstanceHistory: [],
    goal: null,
    itemCount: 1,
    visibleItemCount: 1,
    createdAt: "2026-11-25T10:00:00.000Z",
    updatedAt: "2026-11-25T11:00:00.000Z",
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    unsettledAt: null,
    snoozedUntil: null,
    snoozedAt: null,
    pinnedAt: null,
    pinOrderKey: null,
    activeOrderKey: null,
    pullRequests: [],
    deletedAt: null,
    source: {} as EnvironmentThreadShell["source"],
    ...rest,
    id: ThreadId.make(id),
  };
}

describe("taskBoard.logic", () => {
  const env1 = EnvironmentId.make("env-1");
  const env2 = EnvironmentId.make("env-2");
  const proj1 = ProjectId.make("proj-1");

  it("partitions threads into working, attention, active, and settled columns", () => {
    const working = makeThread({
      id: "t-working",
      runtime: {
        status: "running",
        activeRunId: null,
        providerInstanceId: ProviderInstanceId.make("codex"),
        providerName: "Codex",
        lastError: null,
        updatedAt: "2026-11-25T12:00:00.000Z",
      },
    });
    const attention = makeThread({
      id: "t-attention",
      hasPendingApprovals: true,
    });
    const active = makeThread({
      id: "t-active",
      environmentId: env2,
    });
    const settled = makeThread({
      id: "t-settled",
      settledOverride: "settled",
    });

    const columns = partitionTaskBoardThreads({
      threads: [working, attention, active, settled],
      delegatedUnderParent: new Set(),
      projectNameByScopedKey: new Map([
        [`${env1}:${proj1}`, "t4code"],
        [`${env2}:${proj1}`, "t4code"],
      ]),
      environmentLabelById: new Map([
        [env1, "Work"],
        [env2, "MBP16"],
      ]),
    });

    expect(columns.working.map((c) => c.thread.id)).toEqual(["t-working"]);
    expect(columns.attention.map((c) => c.thread.id)).toEqual(["t-attention"]);
    expect(columns.attention[0]?.attentionReason).toBe("approval");
    expect(columns.active.map((c) => c.thread.id)).toEqual(["t-active"]);
    expect(columns.settled.map((c) => c.thread.id)).toEqual(["t-settled"]);

    const tray = buildDesktopTrayState({ enabled: true, columns });
    expect(tray.workingCount).toBe(1);
    expect(tray.attentionCount).toBe(1);
    expect(tray.activeCount).toBe(1);
    expect(tray.threads[0]?.status).toBe("attention");
    expect(tray.threads[1]?.status).toBe("working");
  });

  it("filters by environment and search query", () => {
    const t1 = makeThread({ id: "t-1", environmentId: env1, title: "Fix sidebar filter" });
    const t2 = makeThread({ id: "t-2", environmentId: env2, title: "Deploy relay" });

    const columns = partitionTaskBoardThreads({
      threads: [t1, t2],
      delegatedUnderParent: new Set(),
      projectNameByScopedKey: new Map(),
      environmentLabelById: new Map([
        [env1, "Work"],
        [env2, "MBP16"],
      ]),
      environmentIds: new Set([env2]),
      searchQuery: "relay",
    });

    expect(columns.active.map((c) => c.thread.id)).toEqual(["t-2"]);
  });
});
