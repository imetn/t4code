import * as Schema from "effect/Schema";
import {
  IsoDateTime,
  NonNegativeInt,
  PositiveInt,
  ProviderThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { ThreadId } from "./baseSchemas.ts";
import {
  getProviderAttachmentLimitError,
  PROVIDER_SEND_TURN_MAX_INPUT_CHARS,
  ChatAttachment,
} from "./chatAttachment.ts";
import { ModelSelection } from "./modelSelection.ts";
import { ProviderInteractionMode } from "./providerPolicy.ts";
import { SignInUrl } from "./providerSetup.ts";

export const ProviderSendTurnInput = Schema.Struct({
  threadId: ThreadId,
  /** Internal recovery: permits empty turns only for adapters supporting promptless continuation. */
  continuation: Schema.optional(Schema.Boolean),
  input: Schema.optional(
    TrimmedNonEmptyString.check(Schema.isMaxLength(PROVIDER_SEND_TURN_MAX_INPUT_CHARS)),
  ),
  attachments: Schema.optional(
    Schema.Array(ChatAttachment).check(
      Schema.makeFilter((attachments) => getProviderAttachmentLimitError(attachments) ?? true),
    ),
  ),
  modelSelection: Schema.optional(ModelSelection),
  interactionMode: Schema.optional(ProviderInteractionMode),
});
export type ProviderSendTurnInput = typeof ProviderSendTurnInput.Type;

export const ProviderUploadFeedbackInput = Schema.Struct({
  threadId: ThreadId,
  reason: Schema.optional(TrimmedNonEmptyString),
});
export type ProviderUploadFeedbackInput = typeof ProviderUploadFeedbackInput.Type;

export const ProviderUploadFeedbackResult = Schema.Struct({
  feedbackId: TrimmedNonEmptyString,
});
export type ProviderUploadFeedbackResult = typeof ProviderUploadFeedbackResult.Type;

const McpServerName = TrimmedNonEmptyString.check(Schema.isMaxLength(256));

/** One of an agent's MCP servers, in the thread whose session asked for a sign-in. */
export const ProviderMcpSignInStartInput = Schema.Struct({
  threadId: ThreadId,
  providerThreadId: ProviderThreadId,
  server: McpServerName,
});
export type ProviderMcpSignInStartInput = typeof ProviderMcpSignInStartInput.Type;

export const ProviderMcpSignInStartResult = Schema.Struct({
  /** The page to approve the sign-in on; null when the server needs none any more. */
  authorizationUrl: Schema.NullOr(SignInUrl),
  /** The environment's time when it found the server already signed in. */
  signedInAt: Schema.NullOr(IsoDateTime),
});
export type ProviderMcpSignInStartResult = typeof ProviderMcpSignInStartResult.Type;

export const ProviderMcpSignInCompleteInput = Schema.Struct({
  ...ProviderMcpSignInStartInput.fields,
  /** The address the browser was sent to after approving, usually a localhost page. */
  callbackUrl: TrimmedNonEmptyString.check(Schema.isMaxLength(16_384)),
});
export type ProviderMcpSignInCompleteInput = typeof ProviderMcpSignInCompleteInput.Type;

export const ProviderMcpSignInCompleteResult = Schema.Struct({
  /** The environment's time, so a later notice that needs a sign-in again offers one. */
  signedInAt: IsoDateTime,
});
export type ProviderMcpSignInCompleteResult = typeof ProviderMcpSignInCompleteResult.Type;

/** Safe to show: never carries the callback URL, codes or tokens. */
export class ProviderMcpSignInError extends Schema.TaggedError<ProviderMcpSignInError>()(
  "ProviderMcpSignInError",
  {
    server: Schema.String,
    detail: Schema.String,
  },
) {
  override get message(): string {
    return this.detail;
  }
}

export class ProviderUploadFeedbackError extends Schema.TaggedError<ProviderUploadFeedbackError>()(
  "ProviderUploadFeedbackError",
  {
    threadId: ThreadId,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Failed to upload feedback for thread ${this.threadId}.`;
  }
}

export const ProviderContextCategoryKind = Schema.Literals(["used", "free", "buffer", "deferred"]);
export type ProviderContextCategoryKind = typeof ProviderContextCategoryKind.Type;

export const ProviderContextCategoryId = Schema.Literals([
  "system_prompt",
  "system_tools",
  "mcp_tools",
  "mcp_instructions",
  "mcp_tools_deferred",
  "system_tools_deferred",
  "custom_agents",
  "memory_files",
  "skills",
  "messages",
  "input",
  "cached_input",
  "output",
  "reasoning",
  "autocompact_buffer",
  "compact_buffer",
  "free_space",
  "other",
]);
export type ProviderContextCategoryId = typeof ProviderContextCategoryId.Type;

export const ProviderContextCategory = Schema.Struct({
  id: Schema.optional(ProviderContextCategoryId),
  name: TrimmedNonEmptyString,
  tokens: NonNegativeInt,
  kind: ProviderContextCategoryKind,
});
export type ProviderContextCategory = typeof ProviderContextCategory.Type;

export const ProviderContextMcpTool = Schema.Struct({
  name: TrimmedNonEmptyString,
  serverName: TrimmedNonEmptyString,
  tokens: Schema.optional(NonNegativeInt),
  isLoaded: Schema.optional(Schema.Boolean),
});
export type ProviderContextMcpTool = typeof ProviderContextMcpTool.Type;

export const ProviderContextMemoryFile = Schema.Struct({
  path: TrimmedNonEmptyString,
  type: TrimmedNonEmptyString,
  tokens: Schema.optional(NonNegativeInt),
});
export type ProviderContextMemoryFile = typeof ProviderContextMemoryFile.Type;

export const ProviderContextSkill = Schema.Struct({
  name: TrimmedNonEmptyString,
  source: TrimmedNonEmptyString,
  path: Schema.optional(TrimmedNonEmptyString),
  pluginName: Schema.optional(TrimmedNonEmptyString),
  tokens: Schema.optional(NonNegativeInt),
});
export type ProviderContextSkill = typeof ProviderContextSkill.Type;

export const ProviderContextBreakdown = Schema.Struct({
  source: Schema.Literals(["provider", "estimated"]),
  model: Schema.optional(TrimmedNonEmptyString),
  totalTokens: NonNegativeInt,
  maxTokens: Schema.NullOr(PositiveInt),
  percentage: Schema.NullOr(Schema.Number.check(Schema.isFinite())),
  autoCompactThreshold: Schema.optional(Schema.NullOr(PositiveInt)),
  isAutoCompactEnabled: Schema.optional(Schema.Boolean),
  categories: Schema.Array(ProviderContextCategory),
  mcpTools: Schema.Array(ProviderContextMcpTool),
  memoryFiles: Schema.Array(ProviderContextMemoryFile),
  skills: Schema.Array(ProviderContextSkill),
});
export type ProviderContextBreakdown = typeof ProviderContextBreakdown.Type;

export const ProviderMcpServerConnectionStatus = Schema.Literals([
  "connected",
  "failed",
  "needs-auth",
  "pending",
  "disabled",
]);
export type ProviderMcpServerConnectionStatus = typeof ProviderMcpServerConnectionStatus.Type;

export const ProviderMcpServerToolSummary = Schema.Struct({
  name: TrimmedNonEmptyString,
  description: Schema.optional(Schema.String),
});
export type ProviderMcpServerToolSummary = typeof ProviderMcpServerToolSummary.Type;

export const ProviderMcpServerEntry = Schema.Struct({
  name: McpServerName,
  status: ProviderMcpServerConnectionStatus,
  toolCount: NonNegativeInt,
  tools: Schema.optional(Schema.Array(ProviderMcpServerToolSummary)),
  scope: Schema.optional(TrimmedNonEmptyString),
  source: Schema.optional(TrimmedNonEmptyString),
  error: Schema.optional(Schema.String),
  canReconnect: Schema.Boolean,
  canToggle: Schema.Boolean,
  canSignIn: Schema.Boolean,
});
export type ProviderMcpServerEntry = typeof ProviderMcpServerEntry.Type;

export const ProviderThreadInspectInput = Schema.Struct({
  threadId: ThreadId,
});
export type ProviderThreadInspectInput = typeof ProviderThreadInspectInput.Type;

export const ProviderThreadInspectResult = Schema.Struct({
  providerThreadId: Schema.NullOr(ProviderThreadId),
  sessionActive: Schema.Boolean,
  context: Schema.NullOr(ProviderContextBreakdown),
  mcpServers: Schema.Array(ProviderMcpServerEntry),
  fetchedAt: IsoDateTime,
});
export type ProviderThreadInspectResult = typeof ProviderThreadInspectResult.Type;

export class ProviderThreadInspectError extends Schema.TaggedError<ProviderThreadInspectError>()(
  "ProviderThreadInspectError",
  {
    threadId: ThreadId,
    detail: Schema.String,
  },
) {
  override get message(): string {
    return this.detail;
  }
}

export const ProviderMcpReconnectInput = Schema.Struct({
  threadId: ThreadId,
  providerThreadId: ProviderThreadId,
  server: McpServerName,
});
export type ProviderMcpReconnectInput = typeof ProviderMcpReconnectInput.Type;

export const ProviderMcpReconnectResult = Schema.Struct({
  reconnectedAt: IsoDateTime,
});
export type ProviderMcpReconnectResult = typeof ProviderMcpReconnectResult.Type;

export const ProviderMcpToggleInput = Schema.Struct({
  threadId: ThreadId,
  providerThreadId: ProviderThreadId,
  server: McpServerName,
  enabled: Schema.Boolean,
});
export type ProviderMcpToggleInput = typeof ProviderMcpToggleInput.Type;

export const ProviderMcpToggleResult = Schema.Struct({
  updatedAt: IsoDateTime,
});
export type ProviderMcpToggleResult = typeof ProviderMcpToggleResult.Type;

export class ProviderMcpControlError extends Schema.TaggedError<ProviderMcpControlError>()(
  "ProviderMcpControlError",
  {
    server: Schema.String,
    detail: Schema.String,
  },
) {
  override get message(): string {
    return this.detail;
  }
}
