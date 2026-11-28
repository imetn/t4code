import * as Schema from "effect/Schema";

import { IsoDateTime, PositiveInt, ThreadId } from "../baseSchemas.ts";
import {
  PastedTextAttachmentSource,
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
} from "../chatAttachment.ts";

export const SYNCED_DRAFT_MAX_TEXT_CHARS = 65_536;
export const SYNCED_DRAFT_MAX_CLIENT_ID_CHARS = 128;

export const SyncedComposerDraftAttachment = Schema.Struct({
  id: Schema.String.check(Schema.isNonEmpty()),
  type: Schema.Literals(["image", "file"]),
  name: Schema.String.check(Schema.isNonEmpty()),
  mimeType: Schema.String.check(Schema.isNonEmpty()),
  sizeBytes: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  uploadedAttachmentId: Schema.String.check(Schema.isNonEmpty()),
  source: Schema.optionalKey(PastedTextAttachmentSource),
});
export type SyncedComposerDraftAttachment = typeof SyncedComposerDraftAttachment.Type;

export const SyncedComposerDraft = Schema.Struct({
  threadId: ThreadId,
  text: Schema.String,
  attachments: Schema.Array(SyncedComposerDraftAttachment),
  revision: PositiveInt,
  updatedAt: IsoDateTime,
  sourceClientId: Schema.NullOr(Schema.String),
});
export type SyncedComposerDraft = typeof SyncedComposerDraft.Type;

export const SyncedDraftUpsertInput = Schema.Struct({
  threadId: ThreadId,
  text: Schema.String.check(Schema.isMaxLength(SYNCED_DRAFT_MAX_TEXT_CHARS)),
  attachments: Schema.Array(SyncedComposerDraftAttachment).check(
    Schema.isMaxLength(PROVIDER_SEND_TURN_MAX_ATTACHMENTS),
  ),
  sourceClientId: Schema.optionalKey(
    Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(SYNCED_DRAFT_MAX_CLIENT_ID_CHARS)),
  ),
});
export type SyncedDraftUpsertInput = typeof SyncedDraftUpsertInput.Type;

export const SyncedDraftUpsertResult = Schema.Struct({
  draft: Schema.NullOr(SyncedComposerDraft),
});
export type SyncedDraftUpsertResult = typeof SyncedDraftUpsertResult.Type;

export const SyncedDraftClearInput = Schema.Struct({
  threadId: ThreadId,
  sourceClientId: Schema.optionalKey(
    Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(SYNCED_DRAFT_MAX_CLIENT_ID_CHARS)),
  ),
});
export type SyncedDraftClearInput = typeof SyncedDraftClearInput.Type;

export const SyncedDraftClearResult = Schema.Struct({
  cleared: Schema.Boolean,
});
export type SyncedDraftClearResult = typeof SyncedDraftClearResult.Type;

export const SyncedDraftSnapshotEvent = Schema.Struct({
  type: Schema.Literal("snapshot"),
  drafts: Schema.Array(SyncedComposerDraft),
});
export type SyncedDraftSnapshotEvent = typeof SyncedDraftSnapshotEvent.Type;

export const SyncedDraftUpsertedEvent = Schema.Struct({
  type: Schema.Literal("upserted"),
  draft: SyncedComposerDraft,
});
export type SyncedDraftUpsertedEvent = typeof SyncedDraftUpsertedEvent.Type;

export const SyncedDraftClearedEvent = Schema.Struct({
  type: Schema.Literal("cleared"),
  threadId: ThreadId,
  updatedAt: IsoDateTime,
  sourceClientId: Schema.NullOr(Schema.String),
});
export type SyncedDraftClearedEvent = typeof SyncedDraftClearedEvent.Type;

export const SyncedDraftEvent = Schema.Union([
  SyncedDraftSnapshotEvent,
  SyncedDraftUpsertedEvent,
  SyncedDraftClearedEvent,
]);
export type SyncedDraftEvent = typeof SyncedDraftEvent.Type;

export class SyncedDraftUnavailableError extends Schema.TaggedError<SyncedDraftUnavailableError>()(
  "SyncedDraftUnavailableError",
  {
    detail: Schema.String,
  },
) {
  override get message(): string {
    return this.detail;
  }
}

export class SyncedDraftValidationError extends Schema.TaggedError<SyncedDraftValidationError>()(
  "SyncedDraftValidationError",
  {
    detail: Schema.String,
  },
) {
  override get message(): string {
    return this.detail;
  }
}

export class SyncedDraftOperationError extends Schema.TaggedError<SyncedDraftOperationError>()(
  "SyncedDraftOperationError",
  {
    operation: Schema.String,
    detail: Schema.String,
  },
) {
  override get message(): string {
    return `Synced draft ${this.operation} failed: ${this.detail}`;
  }
}

export const SyncedDraftError = Schema.Union([
  SyncedDraftUnavailableError,
  SyncedDraftValidationError,
  SyncedDraftOperationError,
]);
export type SyncedDraftError = typeof SyncedDraftError.Type;
