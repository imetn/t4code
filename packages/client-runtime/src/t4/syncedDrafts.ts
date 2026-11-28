import {
  type EnvironmentId,
  type SyncedComposerDraft,
  type SyncedComposerDraftAttachment,
  type SyncedDraftEvent,
  type ThreadId,
  WS_METHODS,
} from "@t3tools/contracts";
import * as Stream from "effect/Stream";
import type { Atom } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "../state/runtime.ts";

export const SYNCED_DRAFT_DEBOUNCE_MS = 1_500;
export const SYNCED_DRAFT_MAX_WAIT_MS = 8_000;

export function createSyncedDraftClientId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    // @effect-diagnostics-next-line cryptoRandomUUID:off - Ephemeral client id constructed outside an Effect runtime.
    return crypto.randomUUID();
  }
  // @effect-diagnostics-next-line globalDate:off globalRandom:off - Fallback id outside an Effect runtime.
  return `client-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export interface SyncedDraftPayload {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly text: string;
  readonly attachments: ReadonlyArray<SyncedComposerDraftAttachment>;
}

export function syncedDraftFingerprint(
  text: string,
  attachments: ReadonlyArray<SyncedComposerDraftAttachment>,
): string {
  return JSON.stringify([
    text,
    attachments.map((attachment) => [
      attachment.id,
      attachment.type,
      attachment.uploadedAttachmentId,
      attachment.name,
      attachment.mimeType,
      attachment.sizeBytes,
      attachment.source?._tag ?? null,
    ]),
  ]);
}

export function isSyncedDraftEmpty(
  text: string,
  attachments: ReadonlyArray<SyncedComposerDraftAttachment>,
): boolean {
  return text.trim().length === 0 && attachments.length === 0;
}

export interface SyncedDraftStreamEnvelope {
  readonly seq: number;
  readonly event: SyncedDraftEvent;
}

export function createSyncedDraftEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  let seq = 0;
  return {
    upsert: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:synced-drafts:upsert",
      tag: WS_METHODS.syncedDraftsUpsert,
      concurrency: {
        mode: "latest",
        key: (target) => `${target.environmentId}:${target.input.threadId}`,
      },
    }),
    clear: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:synced-drafts:clear",
      tag: WS_METHODS.syncedDraftsClear,
      concurrency: {
        mode: "latest",
        key: (target) => `${target.environmentId}:${target.input.threadId}`,
      },
    }),
    subscribe: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-subscription:synced-drafts",
      tag: WS_METHODS.syncedDraftsSubscribe,
      idleTtlMs: 5_000,
      transform: (stream) =>
        Stream.map(stream, (event): SyncedDraftStreamEnvelope => {
          seq += 1;
          return { seq, event };
        }),
    }),
  };
}

interface PendingEntry {
  payload: SyncedDraftPayload;
  fingerprint: string;
  debounceTimer: ReturnType<typeof setTimeout> | null;
  maxWaitTimer: ReturnType<typeof setTimeout> | null;
}

export interface SyncedDraftSchedulerOptions {
  readonly selfClientId: string;
  readonly debounceMs?: number;
  readonly maxWaitMs?: number;
  readonly now?: () => number;
  readonly onFlush: (payload: SyncedDraftPayload, sourceClientId: string) => void | Promise<void>;
}

export interface SyncedDraftScheduler {
  readonly schedule: (
    key: string,
    payload: SyncedDraftPayload,
    options?: { readonly immediate?: boolean },
  ) => void;
  readonly flushKey: (key: string) => void;
  readonly flushAll: () => void;
  readonly shouldApplyRemote: (
    key: string,
    sourceClientId: string | null,
    remoteUpdatedAtIso: string,
  ) => boolean;
  readonly shouldApplyRemoteClear: (key: string, sourceClientId: string | null) => boolean;
  readonly markRemoteApplied: (
    key: string,
    draft: Pick<SyncedComposerDraft, "text" | "attachments"> | null,
  ) => void;
  readonly forgetKey: (key: string) => void;
  readonly withRemoteSuppression: <T>(key: string, fn: () => T) => T;
  readonly isSuppressed: (key: string) => boolean;
  readonly dispose: () => void;
}

export function createSyncedDraftScheduler(
  options: SyncedDraftSchedulerOptions,
): SyncedDraftScheduler {
  const debounceMs = options.debounceMs ?? SYNCED_DRAFT_DEBOUNCE_MS;
  const maxWaitMs = options.maxWaitMs ?? SYNCED_DRAFT_MAX_WAIT_MS;
  const now = options.now ?? Date.now;

  const pendingByKey = new Map<string, PendingEntry>();
  const lastPushedFingerprintByKey = new Map<string, string>();
  const dirtySinceMsByKey = new Map<string, number>();
  const suppressedKeys = new Set<string>();

  const clearTimers = (entry: PendingEntry) => {
    if (entry.debounceTimer !== null) {
      clearTimeout(entry.debounceTimer);
      entry.debounceTimer = null;
    }
    if (entry.maxWaitTimer !== null) {
      clearTimeout(entry.maxWaitTimer);
      entry.maxWaitTimer = null;
    }
  };

  const executeFlush = (key: string) => {
    const entry = pendingByKey.get(key);
    if (!entry) return;
    clearTimers(entry);
    pendingByKey.delete(key);
    dirtySinceMsByKey.delete(key);

    if (lastPushedFingerprintByKey.get(key) === entry.fingerprint) {
      return;
    }
    lastPushedFingerprintByKey.set(key, entry.fingerprint);
    void options.onFlush(entry.payload, options.selfClientId);
  };

  return {
    schedule: (key, payload, scheduleOptions) => {
      if (suppressedKeys.has(key)) return;
      const fingerprint = syncedDraftFingerprint(payload.text, payload.attachments);
      const lastFingerprint = lastPushedFingerprintByKey.get(key);

      if (fingerprint === lastFingerprint) {
        const existing = pendingByKey.get(key);
        if (existing) {
          clearTimers(existing);
          pendingByKey.delete(key);
        }
        dirtySinceMsByKey.delete(key);
        return;
      }

      // Avoid pushing an initial empty draft for a thread we have never synced.
      if (lastFingerprint === undefined && isSyncedDraftEmpty(payload.text, payload.attachments)) {
        return;
      }

      if (!dirtySinceMsByKey.has(key)) {
        dirtySinceMsByKey.set(key, now());
      }

      const existing = pendingByKey.get(key);
      if (scheduleOptions?.immediate === true) {
        if (existing) clearTimers(existing);
        pendingByKey.set(key, {
          payload,
          fingerprint,
          debounceTimer: null,
          maxWaitTimer: null,
        });
        executeFlush(key);
        return;
      }

      if (existing) {
        existing.payload = payload;
        existing.fingerprint = fingerprint;
        if (existing.debounceTimer !== null) {
          clearTimeout(existing.debounceTimer);
        }
        // @effect-diagnostics-next-line globalTimers:off - Synchronous UI debounce outside an Effect runtime.
        existing.debounceTimer = setTimeout(() => executeFlush(key), debounceMs);
        return;
      }

      const entry: PendingEntry = {
        payload,
        fingerprint,
        // @effect-diagnostics-next-line globalTimers:off - Synchronous UI debounce outside an Effect runtime.
        debounceTimer: setTimeout(() => executeFlush(key), debounceMs),
        // @effect-diagnostics-next-line globalTimers:off - Synchronous UI max-wait cap outside an Effect runtime.
        maxWaitTimer: setTimeout(() => executeFlush(key), maxWaitMs),
      };
      pendingByKey.set(key, entry);
    },

    flushKey: (key) => {
      executeFlush(key);
    },

    flushAll: () => {
      for (const key of Array.from(pendingByKey.keys())) {
        executeFlush(key);
      }
    },

    shouldApplyRemote: (key, sourceClientId, remoteUpdatedAtIso) => {
      if (sourceClientId !== null && sourceClientId === options.selfClientId) {
        return false;
      }
      const dirtySince = dirtySinceMsByKey.get(key);
      if (dirtySince !== undefined) {
        const remoteMs = Date.parse(remoteUpdatedAtIso);
        if (!Number.isNaN(remoteMs) && remoteMs <= dirtySince) {
          return false;
        }
      }
      return true;
    },

    shouldApplyRemoteClear: (_key, sourceClientId) => {
      return sourceClientId === null || sourceClientId !== options.selfClientId;
    },

    markRemoteApplied: (key, draft) => {
      const existing = pendingByKey.get(key);
      if (existing) {
        clearTimers(existing);
        pendingByKey.delete(key);
      }
      dirtySinceMsByKey.delete(key);
      if (draft === null) {
        lastPushedFingerprintByKey.set(key, syncedDraftFingerprint("", []));
      } else {
        lastPushedFingerprintByKey.set(key, syncedDraftFingerprint(draft.text, draft.attachments));
      }
    },

    forgetKey: (key) => {
      const existing = pendingByKey.get(key);
      if (existing) {
        clearTimers(existing);
        pendingByKey.delete(key);
      }
      dirtySinceMsByKey.delete(key);
      lastPushedFingerprintByKey.delete(key);
    },

    withRemoteSuppression: (key, fn) => {
      suppressedKeys.add(key);
      try {
        return fn();
      } finally {
        suppressedKeys.delete(key);
      }
    },

    isSuppressed: (key) => suppressedKeys.has(key),

    dispose: () => {
      for (const entry of pendingByKey.values()) {
        clearTimers(entry);
      }
      pendingByKey.clear();
      dirtySinceMsByKey.clear();
      suppressedKeys.clear();
    },
  };
}
