import * as Schema from "effect/Schema";
import { EnvironmentId, PastedTextAttachmentSource } from "@t3tools/contracts";

export const DraftComposerImageAttachmentSchema = Schema.Struct({
  id: Schema.String,
  previewUri: Schema.String,
  type: Schema.Literal("image"),
  name: Schema.String,
  mimeType: Schema.String,
  sizeBytes: Schema.Number,
  fileUri: Schema.optional(Schema.String.check(Schema.isNonEmpty())),
  dataUrl: Schema.optional(Schema.String.check(Schema.isNonEmpty())),
  contentDigest: Schema.optional(Schema.String),
  uploadedAttachmentId: Schema.optional(Schema.String),
  uploadEnvironmentId: Schema.optional(EnvironmentId),
}).check(
  Schema.makeFilter(
    ({ fileUri, dataUrl, uploadedAttachmentId }) =>
      fileUri !== undefined ||
      dataUrl !== undefined ||
      uploadedAttachmentId !== undefined ||
      "Image attachment has no file, inline bytes, or uploaded reference.",
  ),
);

export const DraftComposerFileAttachmentSchema = Schema.Struct({
  id: Schema.String,
  type: Schema.Literal("file"),
  name: Schema.String,
  mimeType: Schema.String,
  sizeBytes: Schema.Number,
  fileUri: Schema.optional(Schema.String.check(Schema.isNonEmpty())),
  source: Schema.optional(PastedTextAttachmentSource),
  uploadedAttachmentId: Schema.optional(Schema.String),
  uploadEnvironmentId: Schema.optional(EnvironmentId),
}).check(
  Schema.makeFilter(
    ({ fileUri, uploadedAttachmentId }) =>
      fileUri !== undefined ||
      uploadedAttachmentId !== undefined ||
      "File attachment has no local file or uploaded reference.",
  ),
);

export const DraftComposerAttachmentSchema = Schema.Union([
  DraftComposerImageAttachmentSchema,
  DraftComposerFileAttachmentSchema,
]);
