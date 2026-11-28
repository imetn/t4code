import { ThreadId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import { createPendingAttachmentId } from "../../attachmentStore.ts";
import * as T4Sqlite from "../persistence/T4Sqlite.ts";
import * as SyncedDraftService from "./SyncedDraftService.ts";

const layerMemoryService = SyncedDraftService.layer.pipe(Layer.provide(T4Sqlite.layerMemory));

it.layer(layerMemoryService)("SyncedDraftService", (it) => {
  it.effect("upserts, bumps revision, streams live updates, and clears on empty content", () =>
    Effect.gen(function* () {
      const service = yield* SyncedDraftService.SyncedDraftService;
      const threadId = ThreadId.make("thread-sync-1");
      const attachmentId = createPendingAttachmentId(".png");

      const collectedFiber = yield* service.subscribe().pipe(Stream.take(4), Stream.runCollect, Effect.forkChild);
      yield* Effect.yieldNow;

      const first = yield* service.upsert({
        threadId,
        text: "Draft from iPhone",
        attachments: [
          {
            id: "img-1",
            type: "image",
            name: "screenshot.png",
            mimeType: "image/png",
            sizeBytes: 1234,
            uploadedAttachmentId: attachmentId,
          },
        ],
        sourceClientId: "client-ios",
      });
      assert.isNotNull(first.draft);
      assert.equal(first.draft?.revision, 1);
      assert.equal(first.draft?.attachments.length, 1);

      const second = yield* service.upsert({
        threadId,
        text: "Draft updated on Mac",
        attachments: [],
        sourceClientId: "client-mac",
      });
      assert.equal(second.draft?.revision, 2);
      assert.equal(second.draft?.text, "Draft updated on Mac");

      // Empty text + empty attachments clears the stored draft and broadcasts cleared.
      const cleared = yield* service.upsert({
        threadId,
        text: "   ",
        attachments: [],
        sourceClientId: "client-mac",
      });
      assert.isNull(cleared.draft);

      const events = yield* Fiber.join(collectedFiber);
      assert.equal(events.length, 4);
      assert.equal(events[0]?.type, "snapshot");
      assert.equal(events[1]?.type, "upserted");
      assert.equal(events[2]?.type, "upserted");
      assert.equal(events[3]?.type, "cleared");
      if (events[3]?.type === "cleared") {
        assert.equal(events[3].threadId, threadId);
      }

      const remaining = yield* service.listAll();
      assert.equal(remaining.length, 0);
    }),
  );

  it.effect("rejects non-pending attachment ids", () =>
    Effect.gen(function* () {
      const service = yield* SyncedDraftService.SyncedDraftService;
      const result = yield* service
        .upsert({
          threadId: ThreadId.make("thread-sync-bad"),
          text: "hello",
          attachments: [
            {
              id: "bad-1",
              type: "image",
              name: "evil.png",
              mimeType: "image/png",
              sizeBytes: 100,
              uploadedAttachmentId: "../etc/passwd",
            },
          ],
        })
        .pipe(Effect.result);
      assert.equal(result._tag, "Failure");
    }),
  );
});
