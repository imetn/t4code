import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  type EnvironmentId,
  type ScopedThreadRef,
  type SyncedComposerDraft,
  type SyncedComposerDraftAttachment,
  type SyncedDraftEvent,
} from "@t3tools/contracts";
import {
  parseScopedThreadKey,
  scopedThreadKey,
  scopeThreadRef,
} from "@t3tools/client-runtime/environment";
import { assetUrlStateFromResult } from "@t3tools/client-runtime/state/assets";
import { executeAtomQuery, runAtomCommand } from "@t3tools/client-runtime/state/runtime";
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

import {
  useComposerDraftStore,
  type ComposerFileAttachment,
  type ComposerImageAttachment,
  type ComposerThreadDraftState,
} from "../composerDraftStore";
import { environmentCatalog } from "../connection/catalog";
import { connectionAtomRuntime } from "../connection/runtime";
import {
  forgetAttachmentUploadLocal,
  readAttachmentUpload,
  seedReadyAttachmentUpload,
  useAttachmentUploadStore,
} from "../lib/attachmentUploadQueue";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { assetEnvironment } from "./assets";
import { environmentServerConfigsAtom, serverEnvironment } from "./server";
import {
  environmentSession,
  readEnvironmentScope,
  readPreparedConnection,
  sessionHasScope,
} from "./session";

export const syncedDraftEnvironment = createSyncedDraftEnvironmentAtoms(connectionAtomRuntime);

const subscribableSyncedDraftEnvironmentIdsAtom = Atom.make((get): ReadonlyArray<EnvironmentId> => {
  const configs = get(environmentServerConfigsAtom);
  const ids: EnvironmentId[] = [];
  for (const [environmentId, config] of configs) {
    if (config?.environment.capabilities.syncedDrafts !== true) continue;
    const connection = AsyncResult.getOrElse(
      get(environmentCatalog.stateAtom(environmentId)),
      () => null,
    );
    if (connection?.phase !== "connected") continue;
    if (
      !sessionHasScope(
        get(environmentSession.sessionStateAtom(environmentId)),
        AuthOrchestrationReadScope,
      )
    ) {
      continue;
    }
    ids.push(environmentId);
  }
  return ids;
}).pipe(Atom.withLabel("web:synced-draft-environments"));

function extractWebSyncedAttachments(
  environmentId: EnvironmentId,
  draft: ComposerThreadDraftState,
): ReadonlyArray<SyncedComposerDraftAttachment> {
  const uploadsByImageId = useAttachmentUploadStore.getState().uploadsByImageId;
  const result: SyncedComposerDraftAttachment[] = [];
  for (const image of draft.images) {
    const upload = uploadsByImageId[image.id];
    if (upload?.status === "ready" && upload.environmentId === environmentId) {
      result.push({
        id: image.id,
        type: "image",
        uploadedAttachmentId: upload.attachmentId,
        name: image.name,
        mimeType: image.mimeType,
        sizeBytes: image.sizeBytes,
      });
    }
  }
  for (const file of draft.files) {
    const upload = uploadsByImageId[file.id];
    const uploadedAttachmentId =
      upload?.status === "ready" && upload.environmentId === environmentId
        ? upload.attachmentId
        : file.uploadEnvironmentId === environmentId
          ? file.uploadedAttachmentId
          : undefined;
    if (uploadedAttachmentId !== undefined) {
      result.push({
        id: file.id,
        type: "file",
        uploadedAttachmentId,
        name: file.name,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        ...(file.source ? { source: file.source } : {}),
      });
    }
  }
  return result;
}

function attachmentsFingerprint(attachments: ReadonlyArray<SyncedComposerDraftAttachment>): string {
  return syncedDraftFingerprint("", attachments);
}

function canPushSyncedDraft(environmentId: EnvironmentId): boolean {
  const config = appAtomRegistry.get(serverEnvironment.configValueAtom(environmentId));
  if (config?.environment.capabilities.syncedDrafts !== true) return false;
  const connection = AsyncResult.getOrElse(
    appAtomRegistry.get(environmentCatalog.stateAtom(environmentId)),
    () => null,
  );
  if (connection?.phase !== "connected") return false;
  return readEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
}

async function resolveAttachmentAssetUrl(
  environmentId: EnvironmentId,
  attachmentId: string,
): Promise<string | null> {
  const connection = readPreparedConnection(environmentId);
  if (!connection) return null;
  const result = await executeAtomQuery(
    appAtomRegistry,
    assetEnvironment.createUrl({
      environmentId,
      input: { resource: { _tag: "attachment", attachmentId } },
    }),
    { refresh: true, reportFailure: false, reportDefect: false },
  );
  const state = assetUrlStateFromResult(result, connection.httpBaseUrl);
  return state._tag === "Success" ? state.url : null;
}

async function hydrateWebRemoteAttachments(
  environmentId: EnvironmentId,
  existingDraft: ComposerThreadDraftState | undefined,
  remoteAttachments: ReadonlyArray<SyncedComposerDraftAttachment>,
  resolveUrl: (environmentId: EnvironmentId, attachmentId: string) => Promise<string | null>,
  fetchImpl: typeof fetch,
): Promise<{
  readonly images: ReadonlyArray<ComposerImageAttachment>;
  readonly files: ReadonlyArray<ComposerFileAttachment>;
  readonly createdBlobUrls: ReadonlyArray<string>;
}> {
  const images: ComposerImageAttachment[] = [];
  const files: ComposerFileAttachment[] = [];
  const createdBlobUrls: string[] = [];

  for (const attachment of remoteAttachments) {
    if (attachment.type === "image") {
      const existing = existingDraft?.images.find((candidate) => candidate.id === attachment.id);
      const existingUpload = existing ? readAttachmentUpload(existing.id) : undefined;
      if (
        existing &&
        existingUpload?.status === "ready" &&
        existingUpload.environmentId === environmentId &&
        existingUpload.attachmentId === attachment.uploadedAttachmentId
      ) {
        images.push(existing);
        continue;
      }
      const assetUrl = await resolveUrl(environmentId, attachment.uploadedAttachmentId);
      if (!assetUrl) continue;
      try {
        const response = await fetchImpl(assetUrl);
        if (!response.ok) continue;
        const blob = await response.blob();
        const file = new File([blob], attachment.name, { type: attachment.mimeType });
        const previewUrl = URL.createObjectURL(file);
        createdBlobUrls.push(previewUrl);
        seedReadyAttachmentUpload(attachment.id, environmentId, attachment.uploadedAttachmentId);
        images.push({
          type: "image",
          id: attachment.id,
          name: attachment.name,
          mimeType: attachment.mimeType,
          sizeBytes: attachment.sizeBytes,
          previewUrl,
          file,
        });
      } catch {
        continue;
      }
      continue;
    }

    const existingFile = existingDraft?.files.find((candidate) => candidate.id === attachment.id);
    if (
      existingFile &&
      existingFile.uploadEnvironmentId === environmentId &&
      existingFile.uploadedAttachmentId === attachment.uploadedAttachmentId
    ) {
      seedReadyAttachmentUpload(attachment.id, environmentId, attachment.uploadedAttachmentId);
      files.push(existingFile);
      continue;
    }
    seedReadyAttachmentUpload(attachment.id, environmentId, attachment.uploadedAttachmentId);
    files.push({
      type: "file",
      id: attachment.id,
      name: attachment.name,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      file: null,
      uploadedAttachmentId: attachment.uploadedAttachmentId,
      uploadEnvironmentId: environmentId,
      ...(attachment.source ? { source: attachment.source } : {}),
    });
  }

  return { images, files, createdBlobUrls };
}

export interface WebSyncedDraftBridgeOptions {
  readonly selfClientId?: string;
  readonly debounceMs?: number;
  readonly maxWaitMs?: number;
  readonly fetchImpl?: typeof fetch;
  readonly resolveAssetUrl?: (
    environmentId: EnvironmentId,
    attachmentId: string,
  ) => Promise<string | null>;
  readonly canPush?: (environmentId: EnvironmentId) => boolean;
  readonly onFlush?: (payload: SyncedDraftPayload, sourceClientId: string) => void | Promise<void>;
}

let activeFlushAll: (() => void) | null = null;

export function flushWebSyncedComposerDrafts(): void {
  activeFlushAll?.();
}

export function createWebSyncedDraftBridge(options: WebSyncedDraftBridgeOptions = {}) {
  const selfClientId = options.selfClientId ?? createSyncedDraftClientId();
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const resolveUrl = options.resolveAssetUrl ?? resolveAttachmentAssetUrl;
  const canPush = options.canPush ?? canPushSyncedDraft;
  const previousAttachmentFpByKey = new Map<string, string>();
  const trackedNonEmptyKeys = new Set<string>();
  const applyGenerationByKey = new Map<string, number>();
  const snapshotReceivedEnvs = new Set<EnvironmentId>();

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
    const store = useComposerDraftStore.getState();
    const seenKeys = new Set<string>();

    for (const [key, draft] of Object.entries(store.draftsByThreadKey)) {
      if (store.draftThreadsByThreadKey[key] !== undefined) continue;
      if (key.startsWith("queued-edit:")) continue;
      const threadRef = parseScopedThreadKey(key);
      if (!threadRef) continue;
      if (filterEnvironmentId !== undefined && threadRef.environmentId !== filterEnvironmentId) {
        continue;
      }
      if (!canPush(threadRef.environmentId)) continue;
      if (scheduler.isSuppressed(key)) continue;

      seenKeys.add(key);
      const attachments = extractWebSyncedAttachments(threadRef.environmentId, draft);
      const nextAttachmentFp = attachmentsFingerprint(attachments);
      const prevAttachmentFp = previousAttachmentFpByKey.get(key);
      const attachmentsChanged =
        prevAttachmentFp !== undefined && prevAttachmentFp !== nextAttachmentFp;
      previousAttachmentFpByKey.set(key, nextAttachmentFp);

      const empty = isSyncedDraftEmpty(draft.prompt, attachments);
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
          text: draft.prompt,
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
    const threadRef: ScopedThreadRef = scopeThreadRef(environmentId, draft.threadId);
    const key = scopedThreadKey(threadRef);
    if (!scheduler.shouldApplyRemote(key, sourceClientId, draft.updatedAt)) {
      return;
    }

    const currentDraft = useComposerDraftStore.getState().draftsByThreadKey[key];
    const currentSyncedAttachments = currentDraft
      ? extractWebSyncedAttachments(environmentId, currentDraft)
      : [];
    const currentFp = syncedDraftFingerprint(currentDraft?.prompt ?? "", currentSyncedAttachments);
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

    const hydrated = await hydrateWebRemoteAttachments(
      environmentId,
      currentDraft,
      draft.attachments,
      resolveUrl,
      fetchImpl,
    );

    if (
      applyGenerationByKey.get(key) !== generation ||
      !scheduler.shouldApplyRemote(key, sourceClientId, draft.updatedAt)
    ) {
      for (const url of hydrated.createdBlobUrls) {
        URL.revokeObjectURL(url);
      }
      return;
    }

    const latestDraft = useComposerDraftStore.getState().draftsByThreadKey[key];
    const retainedIds = new Set([
      ...hydrated.images.map((image) => image.id),
      ...hydrated.files.map((file) => file.id),
    ]);

    scheduler.withRemoteSuppression(key, () => {
      if (latestDraft) {
        for (const image of latestDraft.images) {
          if (!retainedIds.has(image.id)) forgetAttachmentUploadLocal(image.id);
        }
        for (const file of latestDraft.files) {
          if (!retainedIds.has(file.id)) forgetAttachmentUploadLocal(file.id);
        }
      }
      useComposerDraftStore.getState().applySyncedDraft(threadRef, {
        prompt: draft.text,
        images: hydrated.images,
        files: hydrated.files,
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
    const threadRef = scopeThreadRef(environmentId, threadId);
    const key = scopedThreadKey(threadRef);
    if (!scheduler.shouldApplyRemoteClear(key, sourceClientId)) {
      return;
    }
    const generation = (applyGenerationByKey.get(key) ?? 0) + 1;
    applyGenerationByKey.set(key, generation);

    const existingDraft = useComposerDraftStore.getState().draftsByThreadKey[key];
    scheduler.withRemoteSuppression(key, () => {
      if (existingDraft) {
        for (const image of existingDraft.images) forgetAttachmentUploadLocal(image.id);
        for (const file of existingDraft.files) forgetAttachmentUploadLocal(file.id);
      }
      useComposerDraftStore.getState().applySyncedDraft(threadRef, null);
      scheduler.markRemoteApplied(key, null);
      previousAttachmentFpByKey.set(key, attachmentsFingerprint([]));
      trackedNonEmptyKeys.delete(key);
    });
  };

  const handleEvent = (environmentId: EnvironmentId, event: SyncedDraftEvent) => {
    switch (event.type) {
      case "snapshot": {
        snapshotReceivedEnvs.add(environmentId);
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
        snapshotReceivedEnvs.delete(envId);
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
  const unsubscribeDraftStore = useComposerDraftStore.subscribe(() => {
    scanOutbound();
  });
  const unsubscribeUploadStore = useAttachmentUploadStore.subscribe(() => {
    scanOutbound();
  });

  const onVisibilityChange = () => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      scheduler.flushAll();
    }
  };
  const onPageHide = () => {
    scheduler.flushAll();
  };

  if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
    document.addEventListener("visibilitychange", onVisibilityChange);
  }
  if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
    window.addEventListener("pagehide", onPageHide);
  }

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
      unsubscribeDraftStore();
      unsubscribeUploadStore();
      for (const dispose of streamDisposers.values()) dispose();
      streamDisposers.clear();
      if (typeof document !== "undefined" && typeof document.removeEventListener === "function") {
        document.removeEventListener("visibilitychange", onVisibilityChange);
      }
      if (typeof window !== "undefined" && typeof window.removeEventListener === "function") {
        window.removeEventListener("pagehide", onPageHide);
      }
    },
  };
}

export function installWebSyncedDrafts(): () => void {
  return createWebSyncedDraftBridge().dispose;
}
