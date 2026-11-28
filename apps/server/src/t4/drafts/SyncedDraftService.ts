// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";

import {
  IsoDateTime,
  PositiveInt,
  SyncedComposerDraft,
  SyncedComposerDraftAttachment,
  type SyncedDraftClearInput,
  type SyncedDraftClearResult,
  type SyncedDraftError,
  type SyncedDraftEvent,
  SyncedDraftOperationError,
  SyncedDraftUnavailableError,
  type SyncedDraftUpsertInput,
  type SyncedDraftUpsertResult,
  SyncedDraftValidationError,
  ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import {
  PENDING_ATTACHMENT_THREAD_SEGMENT,
  parseAttachmentUuid,
  parseThreadSegmentFromAttachmentId,
  resolveAttachmentPathById,
} from "../../attachmentStore.ts";
import * as ServerConfig from "../../config.ts";
import * as T4Sqlite from "../persistence/T4Sqlite.ts";

interface SyncedDraftRow {
  readonly thread_id: string;
  readonly text: string;
  readonly attachments_json: string;
  readonly revision: number;
  readonly source_client_id: string | null;
  readonly updated_at: string;
}

const SyncedDraftAttachmentsSchema = Schema.Array(SyncedComposerDraftAttachment);
const decodeAttachmentsJson = Schema.decodeUnknownSync(
  Schema.fromJsonString(SyncedDraftAttachmentsSchema),
);
const encodeAttachmentsJson = Schema.encodeSync(
  Schema.fromJsonString(SyncedDraftAttachmentsSchema),
);

function parseAttachments(raw: string): ReadonlyArray<SyncedComposerDraftAttachment> {
  try {
    return decodeAttachmentsJson(raw);
  } catch {
    return [];
  }
}

function rowToDraft(row: SyncedDraftRow): SyncedComposerDraft {
  return {
    threadId: ThreadId.make(row.thread_id),
    text: row.text,
    attachments: parseAttachments(row.attachments_json),
    revision: PositiveInt.make(Math.max(1, Number(row.revision) || 1)),
    updatedAt: IsoDateTime.make(row.updated_at),
    sourceClientId: row.source_client_id,
  };
}

function isValidPendingAttachmentId(attachmentId: string): boolean {
  return (
    parseAttachmentUuid(attachmentId) !== null &&
    parseThreadSegmentFromAttachmentId(attachmentId) === PENDING_ATTACHMENT_THREAD_SEGMENT
  );
}

function touchPendingAttachments(
  attachmentsDir: string | null,
  attachments: ReadonlyArray<SyncedComposerDraftAttachment>,
): void {
  if (!attachmentsDir || attachments.length === 0) return;
  const now = new Date();
  for (const attachment of attachments) {
    const resolved = resolveAttachmentPathById({
      attachmentsDir,
      attachmentId: attachment.uploadedAttachmentId,
    });
    if (!resolved) continue;
    try {
      NodeFS.utimesSync(resolved, now, now);
    } catch {
      // Best-effort mtime refresh so active draft uploads survive the 24h sweep.
    }
  }
}

export class SyncedDraftService extends Context.Service<
  SyncedDraftService,
  {
    readonly listAll: () => Effect.Effect<ReadonlyArray<SyncedComposerDraft>, SyncedDraftError>;
    readonly subscribe: () => Stream.Stream<SyncedDraftEvent, SyncedDraftError>;
    readonly upsert: (
      input: SyncedDraftUpsertInput,
    ) => Effect.Effect<SyncedDraftUpsertResult, SyncedDraftError>;
    readonly clear: (
      input: SyncedDraftClearInput,
    ) => Effect.Effect<SyncedDraftClearResult, SyncedDraftError>;
  }
>()("t3/t4/drafts/SyncedDraftService") {}

const make = Effect.gen(function* () {
  const t4Sqlite = yield* T4Sqlite.T4Sqlite;
  const serverConfig = yield* Effect.serviceOption(ServerConfig.ServerConfig);
  const attachmentsDir = serverConfig._tag === "Some" ? serverConfig.value.attachmentsDir : null;
  const eventsPubSub = yield* PubSub.unbounded<SyncedDraftEvent>();

  const requireSql = t4Sqlite.getClient.pipe(
    Effect.mapError(
      (error) =>
        new SyncedDraftUnavailableError({
          detail: error.message,
        }),
    ),
  );

  const listAll = Effect.fn("SyncedDraftService.listAll")(function* () {
    const sql = yield* requireSql;
    const rows = yield* sql<SyncedDraftRow>`
      SELECT thread_id, text, attachments_json, revision, source_client_id, updated_at
      FROM t4_synced_composer_drafts
      ORDER BY updated_at DESC
    `.pipe(
      Effect.mapError(
        (cause) =>
          new SyncedDraftOperationError({
            operation: "listAll",
            detail: String(cause),
          }),
      ),
    );
    return rows.map(rowToDraft);
  });

  const clear = Effect.fn("SyncedDraftService.clear")(function* (input: SyncedDraftClearInput) {
    const sql = yield* requireSql;
    const existing = yield* sql<{ readonly thread_id: string }>`
      SELECT thread_id FROM t4_synced_composer_drafts WHERE thread_id = ${input.threadId} LIMIT 1
    `.pipe(
      Effect.mapError(
        (cause) =>
          new SyncedDraftOperationError({
            operation: "clear.lookup",
            detail: String(cause),
          }),
      ),
    );
    if (existing.length === 0) {
      return { cleared: false };
    }
    yield* sql`
      DELETE FROM t4_synced_composer_drafts WHERE thread_id = ${input.threadId}
    `.pipe(
      Effect.mapError(
        (cause) =>
          new SyncedDraftOperationError({
            operation: "clear.delete",
            detail: String(cause),
          }),
      ),
    );
    const updatedAt = IsoDateTime.make(DateTime.formatIso(yield* DateTime.now));
    yield* PubSub.publish(eventsPubSub, {
      type: "cleared",
      threadId: input.threadId,
      updatedAt,
      sourceClientId: input.sourceClientId ?? null,
    });
    return { cleared: true };
  });

  const upsert = Effect.fn("SyncedDraftService.upsert")(function* (input: SyncedDraftUpsertInput) {
    if (input.text.trim().length === 0 && input.attachments.length === 0) {
      yield* clear({
        threadId: input.threadId,
        ...(input.sourceClientId !== undefined ? { sourceClientId: input.sourceClientId } : {}),
      });
      return { draft: null };
    }

    for (const attachment of input.attachments) {
      if (!isValidPendingAttachmentId(attachment.uploadedAttachmentId)) {
        return yield* new SyncedDraftValidationError({
          detail: `Attachment '${attachment.name}' must reference a pending upload id.`,
        });
      }
    }

    const sql = yield* requireSql;
    const updatedAt = IsoDateTime.make(DateTime.formatIso(yield* DateTime.now));
    const attachmentsJson = encodeAttachmentsJson(input.attachments);
    const sourceClientId = input.sourceClientId ?? null;

    const rows = yield* sql<SyncedDraftRow>`
      INSERT INTO t4_synced_composer_drafts (
        thread_id, text, attachments_json, revision, source_client_id, updated_at
      )
      VALUES (
        ${input.threadId}, ${input.text}, ${attachmentsJson}, 1, ${sourceClientId}, ${updatedAt}
      )
      ON CONFLICT(thread_id) DO UPDATE SET
        text = excluded.text,
        attachments_json = excluded.attachments_json,
        revision = t4_synced_composer_drafts.revision + 1,
        source_client_id = excluded.source_client_id,
        updated_at = excluded.updated_at
      RETURNING thread_id, text, attachments_json, revision, source_client_id, updated_at
    `.pipe(
      Effect.mapError(
        (cause) =>
          new SyncedDraftOperationError({
            operation: "upsert",
            detail: String(cause),
          }),
      ),
    );

    const row = rows[0];
    if (!row) {
      return yield* new SyncedDraftOperationError({
        operation: "upsert",
        detail: "Upsert returned no row.",
      });
    }

    touchPendingAttachments(attachmentsDir, input.attachments);
    const draft = rowToDraft(row);
    yield* PubSub.publish(eventsPubSub, {
      type: "upserted",
      draft,
    });
    return { draft };
  });

  const subscribe = (): Stream.Stream<SyncedDraftEvent, SyncedDraftError> =>
    Stream.unwrap(
      Effect.gen(function* () {
        // Subscribe before reading the snapshot so live updates cannot slip through the gap.
        const subscription = yield* PubSub.subscribe(eventsPubSub);
        const drafts = yield* listAll();
        return Stream.concat(
          Stream.make<SyncedDraftEvent>({ type: "snapshot", drafts }),
          Stream.fromSubscription(subscription),
        );
      }),
    );

  return SyncedDraftService.of({
    listAll,
    subscribe,
    upsert,
    clear,
  });
});

export const layer = Layer.effect(SyncedDraftService, make);
