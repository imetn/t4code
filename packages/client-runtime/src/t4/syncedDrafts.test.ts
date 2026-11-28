import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  createSyncedDraftScheduler,
  SYNCED_DRAFT_DEBOUNCE_MS,
  SYNCED_DRAFT_MAX_WAIT_MS,
  type SyncedDraftPayload,
} from "./syncedDrafts.ts";

const envId = EnvironmentId.make("env-1");
const threadId = ThreadId.make("thread-1");
const key = `${envId}:${threadId}`;

describe("createSyncedDraftScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2026-11-28T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("debounces typing by 1.5s and enforces an 8s max-wait ceiling during continuous typing", () => {
    const flushed: Array<{ payload: SyncedDraftPayload; sourceClientId: string }> = [];
    const scheduler = createSyncedDraftScheduler({
      selfClientId: "client-mac",
      onFlush: (payload, sourceClientId) => {
        flushed.push({ payload, sourceClientId });
      },
    });

    // Type continuously every 1s for 9s; max-wait flushes at 8s.
    for (let i = 1; i <= 8; i += 1) {
      scheduler.schedule(key, {
        environmentId: envId,
        threadId,
        text: `draft-${i}`,
        attachments: [],
      });
      vi.advanceTimersByTime(1_000);
    }

    expect(flushed).toHaveLength(1);
    expect(flushed[0]?.payload.text).toBe("draft-8");
    expect(flushed[0]?.sourceClientId).toBe("client-mac");

    // Another edit flushes 1.5s after stopping.
    scheduler.schedule(key, {
      environmentId: envId,
      threadId,
      text: "draft-final",
      attachments: [],
    });
    vi.advanceTimersByTime(SYNCED_DRAFT_DEBOUNCE_MS - 1);
    expect(flushed).toHaveLength(1);

    vi.advanceTimersByTime(1);
    expect(flushed).toHaveLength(2);
    expect(flushed[1]?.payload.text).toBe("draft-final");

    // Identical content is deduplicated.
    scheduler.schedule(key, {
      environmentId: envId,
      threadId,
      text: "draft-final",
      attachments: [],
    });
    vi.advanceTimersByTime(SYNCED_DRAFT_MAX_WAIT_MS);
    expect(flushed).toHaveLength(2);
    scheduler.dispose();
  });

  it("flushes immediately on attachment changes or explicit flushAll, and suppresses remote echo", () => {
    const flushed: SyncedDraftPayload[] = [];
    const scheduler = createSyncedDraftScheduler({
      selfClientId: "client-ios",
      onFlush: (payload) => {
        flushed.push(payload);
      },
    });

    // Never sends initial empty draft.
    scheduler.schedule(key, { environmentId: envId, threadId, text: "   ", attachments: [] });
    scheduler.flushAll();
    expect(flushed).toHaveLength(0);

    // Immediate flush when attachment becomes ready.
    scheduler.schedule(
      key,
      {
        environmentId: envId,
        threadId,
        text: "check this screenshot",
        attachments: [
          {
            id: "att-1",
            type: "image",
            name: "screen.png",
            mimeType: "image/png",
            sizeBytes: 2048,
            uploadedAttachmentId: "pending-00000000-0000-4000-8000-000000000001-png",
          },
        ],
      },
      { immediate: true },
    );
    expect(flushed).toHaveLength(1);

    // Own echo is ignored; other device update is accepted.
    expect(scheduler.shouldApplyRemote(key, "client-ios", "2026-11-28T12:00:05.000Z")).toBe(false);
    expect(scheduler.shouldApplyRemote(key, "client-mac", "2026-11-28T12:00:05.000Z")).toBe(true);
    expect(scheduler.shouldApplyRemoteClear(key, null)).toBe(true);

    // Applying remote draft inside suppression does not echo back.
    scheduler.withRemoteSuppression(key, () => {
      scheduler.schedule(key, {
        environmentId: envId,
        threadId,
        text: "from mac",
        attachments: [],
      });
    });
    scheduler.markRemoteApplied(key, { text: "from mac", attachments: [] });
    vi.advanceTimersByTime(SYNCED_DRAFT_MAX_WAIT_MS);
    expect(flushed).toHaveLength(1);
    scheduler.dispose();
  });
});
