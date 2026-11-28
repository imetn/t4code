import { EnvironmentId, IsoDateTime, ThreadId } from "@t3tools/contracts";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { SyncedDraftPayload } from "@t3tools/client-runtime/t4/synced-drafts";
import * as Schema from "effect/Schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
});

vi.mock("react-native", () => ({
  AppState: {
    addEventListener: vi.fn(() => ({ remove: vi.fn() })),
  },
}));
vi.mock("./assets", () => ({
  refreshAssetUrl: vi.fn(async () => null),
}));
vi.mock("../connection/runtime", async () => {
  const { Atom } = await import("effect/reactivity");
  const Layer = await import("effect/Layer");
  return {
    connectionAtomRuntime: Atom.runtime(Layer.empty),
  };
});
vi.mock("./workspace", async () => {
  const { Atom } = await import("effect/reactivity");
  return {
    workspaceConnections: { environmentsAtom: Atom.make([]) },
  };
});
vi.mock("./server", async () => {
  const { Atom } = await import("effect/reactivity");
  return {
    environmentServerConfigsAtom: Atom.make(new Map()),
  };
});
vi.mock("./session", async () => {
  const { Atom } = await import("effect/reactivity");
  const { AsyncResult } = await import("effect/reactivity");
  return {
    environmentSession: {
      sessionStateAtom: Atom.family(() => Atom.make(AsyncResult.initial())),
    },
    readEnvironmentScope: () => true,
    sessionHasScope: () => true,
  };
});
vi.mock("../features/sharing/incoming-share-storage", () => ({
  loadIncomingShareDrafts: async () => [],
}));
vi.mock("expo-file-system", () => {
  class Directory {
    readonly uri: string;
    constructor(parent: string | { uri: string }, name?: string) {
      this.uri = [typeof parent === "string" ? parent : parent.uri, name].filter(Boolean).join("/");
    }
    create() {}
    list() {
      return [];
    }
  }
  class File {
    readonly uri: string;
    readonly name: string;
    readonly parentDirectory: Directory;
    readonly exists = false;
    constructor(parent: string | { uri: string }, name?: string) {
      this.uri = [typeof parent === "string" ? parent : parent.uri, name].filter(Boolean).join("/");
      this.name = this.uri.split("/").at(-1) ?? "file";
      this.parentDirectory = new Directory(this.uri.slice(0, this.uri.lastIndexOf("/")));
    }
    async text() {
      return "";
    }
    write() {}
    moveSync() {}
    delete() {}
  }
  return {
    Directory,
    File,
    Paths: { document: { uri: "file:///documents" }, cache: { uri: "file:///cache" } },
  };
});

import { DraftComposerAttachmentSchema } from "../lib/composer-image-schema";
import { appAtomRegistry } from "./atom-registry";
import { createMobileSyncedDraftBridge } from "./syncedDrafts";
import {
  clearComposerDraftContent,
  composerDraftsAtom,
  setComposerDraftText,
} from "./use-composer-drafts";

const ENV_ID = EnvironmentId.make("env-mobile-sync-test");
const THREAD_ID = ThreadId.make("thread-mobile-sync-1");
const THREAD_KEY = scopedThreadKey(scopeThreadRef(ENV_ID, THREAD_ID));

describe("createMobileSyncedDraftBridge", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    appAtomRegistry.set(composerDraftsAtom, {});
  });

  afterEach(() => {
    vi.useRealTimers();
    appAtomRegistry.set(composerDraftsAtom, {});
  });

  it("accepts remote-synced image and file attachments in the persisted draft schema", () => {
    const decode = Schema.decodeUnknownSync(DraftComposerAttachmentSchema);
    expect(
      decode({
        id: "img-remote",
        type: "image",
        name: "photo.png",
        mimeType: "image/png",
        sizeBytes: 1024,
        previewUri: "https://host.test/api/assets/1",
        uploadedAttachmentId: "pending-11111111-1111-4111-8111-111111111111.png",
        uploadEnvironmentId: ENV_ID,
      }),
    ).toMatchObject({ id: "img-remote", type: "image" });

    expect(
      decode({
        id: "file-remote",
        type: "file",
        name: "notes.pdf",
        mimeType: "application/pdf",
        sizeBytes: 2048,
        uploadedAttachmentId: "pending-22222222-2222-4222-8222-222222222222.pdf",
        uploadEnvironmentId: ENV_ID,
      }),
    ).toMatchObject({ id: "file-remote", type: "file" });
  });

  it("debounces outbound text edits and flushes immediately on clear", () => {
    const flushed: Array<{ payload: SyncedDraftPayload; sourceClientId: string }> = [];
    const bridge = createMobileSyncedDraftBridge({
      selfClientId: "iphone-a",
      debounceMs: 1_500,
      maxWaitMs: 8_000,
      canPush: () => true,
      onFlush: (payload, sourceClientId) => {
        flushed.push({ payload, sourceClientId });
      },
    });

    try {
      setComposerDraftText(THREAD_KEY, "typing on ios");
      expect(flushed).toHaveLength(0);

      vi.advanceTimersByTime(1_500);
      expect(flushed).toHaveLength(1);
      expect(flushed[0]).toEqual({
        sourceClientId: "iphone-a",
        payload: {
          environmentId: ENV_ID,
          threadId: THREAD_ID,
          text: "typing on ios",
          attachments: [],
        },
      });

      clearComposerDraftContent(THREAD_KEY);
      expect(flushed).toHaveLength(2);
      expect(flushed[1]?.payload).toEqual({
        environmentId: ENV_ID,
        threadId: THREAD_ID,
        text: "",
        attachments: [],
      });
    } finally {
      bridge.dispose();
    }
  });

  it("applies remote synced drafts with image preview URLs without echoing back, and clears on remote clear", async () => {
    const flushed: Array<SyncedDraftPayload> = [];
    const bridge = createMobileSyncedDraftBridge({
      selfClientId: "iphone-b",
      canPush: () => true,
      resolveImageUrl: async () => "https://host.test/api/assets/pending-remote.png",
      onFlush: (payload) => {
        flushed.push(payload);
      },
    });

    try {
      bridge.handleEvent(ENV_ID, {
        type: "upserted",
        draft: {
          threadId: THREAD_ID,
          text: "draft from mac",
          revision: 1,
          sourceClientId: "mac-1",
          attachments: [
            {
              id: "mac-img-1",
              type: "image",
              uploadedAttachmentId: "pending-44444444-4444-4444-8444-444444444444.png",
              name: "screen.png",
              mimeType: "image/png",
              sizeBytes: 512,
            },
            {
              id: "mac-file-1",
              type: "file",
              uploadedAttachmentId: "pending-55555555-5555-4555-8555-555555555555.pdf",
              name: "plan.pdf",
              mimeType: "application/pdf",
              sizeBytes: 4096,
            },
          ],
          updatedAt: IsoDateTime.make("2026-11-28T12:00:00.000Z"),
        },
      });

      await vi.advanceTimersByTimeAsync(0);

      const stored = appAtomRegistry.get(composerDraftsAtom)[THREAD_KEY];
      expect(stored?.text).toBe("draft from mac");
      expect(stored?.attachments).toHaveLength(2);
      expect(stored?.attachments[0]).toMatchObject({
        id: "mac-img-1",
        type: "image",
        previewUri: "https://host.test/api/assets/pending-remote.png",
        uploadedAttachmentId: "pending-44444444-4444-4444-8444-444444444444.png",
        uploadEnvironmentId: ENV_ID,
      });
      expect(stored?.attachments[1]).toMatchObject({
        id: "mac-file-1",
        type: "file",
        uploadedAttachmentId: "pending-55555555-5555-4555-8555-555555555555.pdf",
        uploadEnvironmentId: ENV_ID,
      });

      await vi.advanceTimersByTimeAsync(10_000);
      expect(flushed).toHaveLength(0);

      bridge.handleEvent(ENV_ID, {
        type: "cleared",
        threadId: THREAD_ID,
        sourceClientId: null,
        updatedAt: IsoDateTime.make("2026-11-28T12:02:00.000Z"),
      });

      expect(appAtomRegistry.get(composerDraftsAtom)[THREAD_KEY]).toBeUndefined();
      expect(flushed).toHaveLength(0);
    } finally {
      bridge.dispose();
    }
  });
});
