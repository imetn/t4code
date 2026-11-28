import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  type EnvironmentId,
  type SyncedComposerDraft,
  type SyncedComposerDraftAttachment,
  type SyncedDraftEvent,
} from "@t3tools/contracts";
import {
  parseScopedThreadKey,
  scopedThreadKey,
  scopeThreadRef,
} from "@t3tools/client-runtime/environment";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import {
  createSyncedDraftClientId,
  createSyncedDraftEnvironmentAtoms,
  createSyncedDraftScheduler,
  isSyncedDraftEmpty,
  syncedDraftFingerprint,
  type SyncedDraftPayload,
  type SyncedDraftScheduler,
} from "@t3tools/client-runtime/t4/synced-drafts";
import { AsyncResult, Atom } from "effect/reactivity";
import { AppState, type AppStateStatus } from "react-native";

import { connectionAtomRuntime } from "../connection/runtime";
import type { DraftComposerAttachment } from "../lib/composerImages";
import { refreshAssetUrl } from "./assets";
import { appAtomRegistry } from "./atom-registry";
import { isNewTaskDraftKey } from "./new-task-draft-key";
import { isQueuedEditDraftKey } from "./queued-edit-draft-key";
import { environmentServerConfigsAtom } from "./server";
import { environmentSession, readEnvironmentScope, sessionHasScope } from "./session";
import {
  applyRemoteSyncedComposerDraft,
  composerDraftsAtom,
  ensureComposerDraftsLoaded,
  type ComposerDraft,
} from "./use-composer-drafts";
import { workspaceConnections } from "./workspace";

export const syncedDraftEnvironment = createSyncedDraftEnvironmentAtoms(connectionAtomRuntime);

const subscribableSyncedDraftEnvironmentIdsAtom = Atom.make((get): ReadonlyArray<EnvironmentId> => {
  const environments = get(workspaceConnections.environmentsAtom);
  const configs = get(environmentServerConfigsAtom);
  const ids: EnvironmentId[] = [];
  for (const environment of environments) {
    if (environment.connectionState !== "connected") continue;
    const config = configs.get(environment.environmentId);
    if (config?.environment.capabilities.syncedDrafts !== true) continue;
    if (
      !sessionHasScope(
        get(environmentSession.sessionStateAtom(environment.environmentId)),
        AuthOrchestrationReadScope,
      )
    ) {
      continue;
    }
    ids.push(environment.environmentId);
  }
  return ids;
}).pipe(Atom.withLabel("mobile:synced-draft-environments"));

function extractMobileSyncedAttachments(
  environmentId: EnvironmentId,
  draft: ComposerDraft,
): ReadonlyArray<SyncedComposerDraftAttachment> {
  const result: SyncedComposerDraftAttachment[] = [];
  for (const attachment of draft.attachments) {
    if (
      attachment.uploadedAttachmentId === undefined ||
      attachment.uploadEnvironmentId !== environmentId
    ) {
      continue;
    }
    if (attachment.type === "image") {
      result.push({
        id: attachment.id,
        type: "image",
        uploadedAttachmentId: attachment.uploadedAttachmentId,
        name: attachment.name,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes,
      });
    } else {
      result.push({
        id: attachment.id,
        type: "file",
        uploadedAttachmentId: attachment.uploadedAttachmentId,
        name: attachment.name,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes,
        ...(attachment.source ? { source: attachment.source } : {}),
      });
    }
  }
  return result;
}

function attachmentsFingerprint(attachments: ReadonlyArray<SyncedComposerDraftAttachment>): string {
  return syncedDraftFingerprint("", attachments);
}

function canPushSyncedDraft(environmentId: EnvironmentId): boolean {
  const environment = appAtomRegistry
    .get(workspaceConnections.environmentsAtom)
    .find((candidate) => candidate.environmentId === environmentId);
  if (environment?.connectionState !== "connected") return false;
  const config = appAtomRegistry.get(environmentServerConfigsAtom).get(environmentId);
  if (config?.environment.capabilities.syncedDrafts !== true) return false;
  return readEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
}

async function hydrateMobileRemoteAttachments(
  environmentId: EnvironmentId,
  existingDraft: ComposerDraft | undefined,
  remoteAttachments: ReadonlyArray<SyncedComposerDraftAttachment>,
  resolveImageUrl: (environmentId: EnvironmentId, attachmentId: string) => Promise<string | null>,
): Promise<ReadonlyArray<DraftComposerAttachment>> {
  const hydrated: DraftComposerAttachment[] = [];
  for (const attachment of remoteAttachments) {
    const existing = existingDraft?.attachments.find((candidate) => candidate.id === attachment.id);
    if (
      existing &&
      existing.type === attachment.type &&
      existing.uploadEnvironmentId === environmentId &&
      existing.uploadedAttachmentId === attachment.uploadedAttachmentId
    ) {
      hydrated.push(existing);
      continue;
    }

    if (attachment.type === "image") {
      const previewUri =
        (await resolveImageUrl(environmentId, attachment.uploadedAttachmentId).catch(() => null)) ??
        "";
      hydrated.push({
        id: attachment.id,
        type: "image",
        name: attachment.name,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes,
        previewUri,
        uploadedAttachmentId: attachment.uploadedAttachmentId,
        uploadEnvironmentId: environmentId,
      });
    } else {
      hydrated.push({
        id: attachment.id,
        type: "file",
        name: attachment.name,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes,
        ...(attachment.source ? { source: attachment.source } : {}),
        uploadedAttachmentId: attachment.uploadedAttachmentId,
        uploadEnvironmentId: environmentId,
      });
    }
  }
  return hydrated;
}

export interface MobileSyncedDraftBridgeOptions {
  readonly selfClientId?: string;
  readonly debounceMs?: number;
  readonly maxWaitMs?: number;
  readonly resolveImageUrl?: (
    environmentId: EnvironmentId,
    attachmentId: string,
  ) => Promise<string | null>;
  readonly onFlush?: (payload: SyncedDraftPayload, sourceClientId: string) => void | Promise<void>;
  readonly canPush?: (environmentId: EnvironmentId) => boolean;
}

let activeFlushAll: (() => void) | null = null;

export function flushMobileSyncedComposerDrafts(): void {
  activeFlushAll?.();
}

export function createMobileSyncedDraftBridge(options: MobileSyncedDraftBridgeOptions = {}) {
  ensureComposerDraftsLoaded();
  const selfClientId = options.selfClientId ?? createSyncedDraftClientId();
  const canPush = options.canPush ?? canPushSyncedDraft;
  const resolveImageUrl =
    options.resolveImageUrl ??
    ((environmentId: EnvironmentId, attachmentId: string) =>
      refreshAssetUrl(environmentId, { _tag: "attachment", attachmentId }));

  const previousAttachmentFpByKey = new Map<string, string>();
  const trackedNonEmptyKeys = new Set<string>();
  const applyGenerationByKey = new Map<string, number>();

  const defaultFlush = async (payload: SyncedDraftPayload, sourceClientId: string) => {
    if (!canPush(payload.environmentId)) return;
    if (isSyncedDraftEmpty(payload.text, payload.attachments)) {
      await runAtomCommand(
        appAtomRegistry,
        syncedDraftEnvironment.clear,
        {
          environmentId: payload.environmentId,
          input: { threadId: payload.threadId, sourceClientId },
        },
        { reportFailure: false, reportDefect: false },
      );
      return;
    }
    await runAtomCommand(
      appAtomRegistry,
      syncedDraftEnvironment.upsert,
      {
        environmentId: payload.environmentId,
        input: {
          threadId: payload.threadId,
          text: payload.text,
          attachments: payload.attachments,
          sourceClientId,
        },
      },
      { reportFailure: false, reportDefect: false },
    );
  };

  const scheduler: SyncedDraftScheduler = createSyncedDraftScheduler({
    selfClientId,
    ...(options.debounceMs !== undefined ? { debounceMs: options.debounceMs } : {}),
    ...(options.maxWaitMs !== undefined ? { maxWaitMs: options.maxWaitMs } : {}),
    onFlush: options.onFlush ?? defaultFlush,
  });

  const scanOutbound = (filterEnvironmentId?: EnvironmentId) => {
    const drafts = appAtomRegistry.get(composerDraftsAtom);
    const seenKeys = new Set<string>();

    for (const [key, draft] of Object.entries(drafts)) {
      if (isNewTaskDraftKey(key) || isQueuedEditDraftKey(key) || key.startsWith("pending-task:")) {
        continue;
      }
      const threadRef = parseScopedThreadKey(key);
      if (!threadRef) continue;
      if (filterEnvironmentId !== undefined && threadRef.environmentId !== filterEnvironmentId) {
        continue;
      }
      if (!canPush(threadRef.environmentId)) continue;
      if (scheduler.isSuppressed(key)) continue;

      seenKeys.add(key);
      const attachments = extractMobileSyncedAttachments(threadRef.environmentId, draft);
      const nextAttachmentFp = attachmentsFingerprint(attachments);
      const prevAttachmentFp = previousAttachmentFpByKey.get(key);
      const attachmentsChanged =
        prevAttachmentFp !== undefined && prevAttachmentFp !== nextAttachmentFp;
      previousAttachmentFpByKey.set(key, nextAttachmentFp);

      const empty = isSyncedDraftEmpty(draft.text, attachments);
      if (!empty) {
        trackedNonEmptyKeys.add(key);
      } else {
        trackedNonEmptyKeys.delete(key);
      }

      scheduler.schedule(
        key,
        {
          environmentId: threadRef.environmentId,
          threadId: threadRef.threadId,
          text: draft.text,
          attachments,
        },
        { immediate: attachmentsChanged || empty },
      );
    }

    for (const key of Array.from(trackedNonEmptyKeys)) {
      if (seenKeys.has(key)) continue;
      const threadRef = parseScopedThreadKey(key);
      if (!threadRef) {
        trackedNonEmptyKeys.delete(key);
        continue;
      }
      if (filterEnvironmentId !== undefined && threadRef.environmentId !== filterEnvironmentId) {
        continue;
      }
      if (!canPush(threadRef.environmentId)) continue;
      if (scheduler.isSuppressed(key)) continue;

      trackedNonEmptyKeys.delete(key);
      previousAttachmentFpByKey.set(key, attachmentsFingerprint([]));
      scheduler.schedule(
        key,
        {
          environmentId: threadRef.environmentId,
          threadId: threadRef.threadId,
          text: "",
          attachments: [],
        },
        { immediate: true },
      );
    }
  };

  const applyRemoteUpsert = async (
    environmentId: EnvironmentId,
    draft: SyncedComposerDraft,
    sourceClientId: string | null,
  ) => {
    const key = scopedThreadKey(scopeThreadRef(environmentId, draft.threadId));
    if (!scheduler.shouldApplyRemote(key, sourceClientId, draft.updatedAt)) {
      return;
    }

    const currentDraft = appAtomRegistry.get(composerDraftsAtom)[key];
    const currentSyncedAttachments = currentDraft
      ? extractMobileSyncedAttachments(environmentId, currentDraft)
      : [];
    const currentFp = syncedDraftFingerprint(currentDraft?.text ?? "", currentSyncedAttachments);
    const remoteFp = syncedDraftFingerprint(draft.text, draft.attachments);
    if (currentFp === remoteFp) {
      scheduler.markRemoteApplied(key, draft);
      previousAttachmentFpByKey.set(key, attachmentsFingerprint(draft.attachments));
      if (isSyncedDraftEmpty(draft.text, draft.attachments)) {
        trackedNonEmptyKeys.delete(key);
      } else {
        trackedNonEmptyKeys.add(key);
      }
      return;
    }

    const generation = (applyGenerationByKey.get(key) ?? 0) + 1;
    applyGenerationByKey.set(key, generation);

    const hydratedAttachments = await hydrateMobileRemoteAttachments(
      environmentId,
      currentDraft,
      draft.attachments,
      resolveImageUrl,
    );

    if (
      applyGenerationByKey.get(key) !== generation ||
      !scheduler.shouldApplyRemote(key, sourceClientId, draft.updatedAt)
    ) {
      return;
    }

    scheduler.withRemoteSuppression(key, () => {
      applyRemoteSyncedComposerDraft(key, {
        text: draft.text,
        attachments: hydratedAttachments,
      });
      scheduler.markRemoteApplied(key, draft);
      previousAttachmentFpByKey.set(key, attachmentsFingerprint(draft.attachments));
      if (isSyncedDraftEmpty(draft.text, draft.attachments)) {
        trackedNonEmptyKeys.delete(key);
      } else {
        trackedNonEmptyKeys.add(key);
      }
    });
  };

  const applyRemoteClear = (
    environmentId: EnvironmentId,
    threadId: SyncedComposerDraft["threadId"],
    sourceClientId: string | null,
  ) => {
    const key = scopedThreadKey(scopeThreadRef(environmentId, threadId));
    if (!scheduler.shouldApplyRemoteClear(key, sourceClientId)) {
      return;
    }
    const generation = (applyGenerationByKey.get(key) ?? 0) + 1;
    applyGenerationByKey.set(key, generation);

    scheduler.withRemoteSuppression(key, () => {
      applyRemoteSyncedComposerDraft(key, null);
      scheduler.markRemoteApplied(key, null);
      previousAttachmentFpByKey.set(key, attachmentsFingerprint([]));
      trackedNonEmptyKeys.delete(key);
    });
  };

  const handleEvent = (environmentId: EnvironmentId, event: SyncedDraftEvent) => {
    switch (event.type) {
      case "snapshot": {
        for (const draft of event.drafts) {
          void applyRemoteUpsert(environmentId, draft, null);
        }
        scanOutbound(environmentId);
        return;
      }
      case "upserted": {
        void applyRemoteUpsert(environmentId, event.draft, event.draft.sourceClientId);
        return;
      }
      case "cleared": {
        applyRemoteClear(environmentId, event.threadId, event.sourceClientId);
        return;
      }
    }
  };

  const streamDisposers = new Map<EnvironmentId, () => void>();
  const lastSeqByEnv = new Map<EnvironmentId, number>();

  const syncSubscriptions = (environmentIds: ReadonlyArray<EnvironmentId>) => {
    const activeSet = new Set(environmentIds);
    for (const [envId, dispose] of Array.from(streamDisposers.entries())) {
      if (!activeSet.has(envId)) {
        dispose();
        streamDisposers.delete(envId);
        lastSeqByEnv.delete(envId);
      }
    }
    for (const envId of environmentIds) {
      if (streamDisposers.has(envId)) continue;
      const streamAtom = syncedDraftEnvironment.subscribe({
        environmentId: envId,
        input: undefined,
      });
      const unsubscribe = appAtomRegistry.subscribe(
        streamAtom,
        (result) => {
          if (!AsyncResult.isSuccess(result)) return;
          const { seq, event } = result.value;
          if ((lastSeqByEnv.get(envId) ?? 0) >= seq) return;
          lastSeqByEnv.set(envId, seq);
          handleEvent(envId, event);
        },
        { immediate: true },
      );
      streamDisposers.set(envId, unsubscribe);
    }
  };

  const unsubscribeEnvs = appAtomRegistry.subscribe(
    subscribableSyncedDraftEnvironmentIdsAtom,
    syncSubscriptions,
    { immediate: true },
  );
  const unsubscribeDrafts = appAtomRegistry.subscribe(composerDraftsAtom, () => {
    scanOutbound();
  });

  const appStateSubscription =
    typeof AppState?.addEventListener === "function"
      ? AppState.addEventListener("change", (nextState: AppStateStatus) => {
          if (nextState !== "active") {
            scheduler.flushAll();
          }
        })
      : null;

  activeFlushAll = scheduler.flushAll;

  return {
    selfClientId,
    handleEvent,
    scanOutbound,
    flushAll: scheduler.flushAll,
    dispose: () => {
      if (activeFlushAll === scheduler.flushAll) {
        activeFlushAll = null;
      }
      scheduler.flushAll();
      scheduler.dispose();
      unsubscribeEnvs();
      unsubscribeDrafts();
      appStateSubscription?.remove();
      for (const dispose of streamDisposers.values()) dispose();
      streamDisposers.clear();
    },
  };
}

export function installMobileSyncedDrafts(): () => void {
  return createMobileSyncedDraftBridge().dispose;
}
