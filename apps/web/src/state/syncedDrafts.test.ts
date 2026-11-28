import { EnvironmentId, IsoDateTime, ThreadId } from "@t3tools/contracts";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { SyncedDraftPayload } from "@t3tools/client-runtime/t4/synced-drafts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { useComposerDraftStore } from "../composerDraftStore";
import {
  readAttachmentUpload,
  seedReadyAttachmentUpload,
  useAttachmentUploadStore,
} from "../lib/attachmentUploadQueue";
import { createWebSyncedDraftBridge } from "./syncedDrafts";

const ENV_ID = EnvironmentId.make("env-web-sync-test");
const THREAD_ID = ThreadId.make("thread-web-sync-1");
const THREAD_REF = scopeThreadRef(ENV_ID, THREAD_ID);
const THREAD_KEY = scopedThreadKey(THREAD_REF);

describe("createWebSyncedDraftBridge", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useComposerDraftStore.setState({
      draftsByThreadKey: {},
      draftThreadsByThreadKey: {},
      logicalProjectDraftThreadKeyByLogicalProjectKey: {},
    });
    useAttachmentUploadStore.setState({ uploadsByImageId: {} });
  });

  afterEach(() => {
    vi.useRealTimers();
    useComposerDraftStore.setState({
      draftsByThreadKey: {},
      draftThreadsByThreadKey: {},
      logicalProjectDraftThreadKeyByLogicalProjectKey: {},
    });
    useAttachmentUploadStore.setState({ uploadsByImageId: {} });
  });

  it("debounces outbound text edits and flushes immediately when an attachment becomes ready or draft clears", () => {
    const flushed: Array<{ payload: SyncedDraftPayload; sourceClientId: string }> = [];
    const bridge = createWebSyncedDraftBridge({
      selfClientId: "mac-a",
      debounceMs: 1_500,
      maxWaitMs: 8_000,
      canPush: () => true,
      onFlush: (payload, sourceClientId) => {
        flushed.push({ payload, sourceClientId });
      },
    });

    try {
      useComposerDraftStore.getState().setPrompt(THREAD_REF, "hello");
      expect(flushed).toHaveLength(0);

      vi.advanceTimersByTime(1_499);
      expect(flushed).toHaveLength(0);

      vi.advanceTimersByTime(1);
      expect(flushed).toHaveLength(1);
      expect(flushed[0]).toEqual({
        sourceClientId: "mac-a",
        payload: {
          environmentId: ENV_ID,
          threadId: THREAD_ID,
          text: "hello",
          attachments: [],
        },
      });

      const file = new File(["img"], "shot.png", { type: "image/png" });
      useComposerDraftStore.getState().addImage(THREAD_REF, {
        type: "image",
        id: "img-1",
        name: "shot.png",
        mimeType: "image/png",
        sizeBytes: 3,
        previewUrl: "blob:local-shot",
        file,
      });
      // Not uploaded yet, so nothing pushed yet.
      expect(flushed).toHaveLength(1);

      // Once upload finishes, it syncs immediately without waiting for typing debounce.
      seedReadyAttachmentUpload(
        "img-1",
        ENV_ID,
        "pending-11111111-1111-4111-8111-111111111111.png",
      );
      expect(flushed).toHaveLength(2);
      expect(flushed[1]?.payload.attachments).toEqual([
        {
          id: "img-1",
          type: "image",
          uploadedAttachmentId: "pending-11111111-1111-4111-8111-111111111111.png",
          name: "shot.png",
          mimeType: "image/png",
          sizeBytes: 3,
        },
      ]);

      // Clearing draft flushes an empty payload immediately.
      useComposerDraftStore.getState().clearComposerContent(THREAD_REF);
      expect(flushed).toHaveLength(3);
      expect(flushed[2]?.payload).toEqual({
        environmentId: ENV_ID,
        threadId: THREAD_ID,
        text: "",
        attachments: [],
      });
    } finally {
      bridge.dispose();
    }
  });

  it("hydrates remote synced images and files without echoing back, and clears on remote clear", async () => {
    const flushed: Array<SyncedDraftPayload> = [];
    const fetchMock = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => "blob:remote-img-1");
    URL.revokeObjectURL = vi.fn();

    const bridge = createWebSyncedDraftBridge({
      selfClientId: "mac-b",
      canPush: () => true,
      fetchImpl: fetchMock as unknown as typeof fetch,
      resolveAssetUrl: async () => "https://host.test/api/assets/pending-remote.png",
      onFlush: (payload) => {
        flushed.push(payload);
      },
    });

    try {
      bridge.handleEvent(ENV_ID, {
        type: "upserted",
        draft: {
          threadId: THREAD_ID,
          text: "from phone",
          revision: 1,
          sourceClientId: "iphone-1",
          attachments: [
            {
              id: "remote-img",
              type: "image",
              uploadedAttachmentId: "pending-22222222-2222-4222-8222-222222222222.png",
              name: "photo.png",
              mimeType: "image/png",
              sizeBytes: 3,
            },
            {
              id: "remote-file",
              type: "file",
              uploadedAttachmentId: "pending-33333333-3333-4333-8333-333333333333.pdf",
              name: "spec.pdf",
              mimeType: "application/pdf",
              sizeBytes: 120,
            },
          ],
          updatedAt: IsoDateTime.make("2026-11-28T12:00:00.000Z"),
        },
      });

      await vi.advanceTimersByTimeAsync(0);

      const draft = useComposerDraftStore.getState().draftsByThreadKey[THREAD_KEY];
      expect(draft?.prompt).toBe("from phone");
      expect(draft?.images).toHaveLength(1);
      expect(draft?.images[0]?.name).toBe("photo.png");
      expect(draft?.files).toHaveLength(1);
      expect(draft?.files[0]?.uploadedAttachmentId).toBe(
        "pending-33333333-3333-4333-8333-333333333333.pdf",
      );
      expect(readAttachmentUpload("remote-img")).toEqual({
        status: "ready",
        environmentId: ENV_ID,
        attachmentId: "pending-22222222-2222-4222-8222-222222222222.png",
      });

      // Applying remote draft must NOT echo an outbound upsert back to the server.
      await vi.advanceTimersByTimeAsync(10_000);
      expect(flushed).toHaveLength(0);

      // Remote clear (e.g. sent from iPhone) clears local draft and upload tracking.
      bridge.handleEvent(ENV_ID, {
        type: "cleared",
        threadId: THREAD_ID,
        sourceClientId: null,
        updatedAt: IsoDateTime.make("2026-11-28T12:01:00.000Z"),
      });

      expect(useComposerDraftStore.getState().draftsByThreadKey[THREAD_KEY]).toBeUndefined();
      expect(readAttachmentUpload("remote-img")).toBeUndefined();
      expect(flushed).toHaveLength(0);
    } finally {
      bridge.dispose();
      URL.createObjectURL = originalCreateObjectURL;
      URL.revokeObjectURL = originalRevokeObjectURL;
    }
  });
});
