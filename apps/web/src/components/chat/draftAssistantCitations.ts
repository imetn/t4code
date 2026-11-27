import type { AssistantCitation, MessageId, ScopedThreadRef } from "@t3tools/contracts";
import { collectAssistantCitations } from "@t3tools/shared/assistantCitations";

const CITATION_HREF_MARKER = "t3-citation://v1/";
const CITATION_SIGNATURE_SEPARATOR = "\0";
const BADGE_MIN_X = 20;
const BADGE_VERTICAL_LIFT = 8;
const BADGE_COLLISION_X = 22;
const BADGE_COLLISION_Y = 20;
const BADGE_COLLISION_STEP = 24;

export interface DraftAssistantCitation {
  readonly index: number;
  readonly citation: AssistantCitation;
  readonly source: string;
}

export interface DraftCitationBadgeAnchorInput {
  readonly index: number;
  readonly citation: AssistantCitation;
  readonly rects: ReadonlyArray<
    Pick<DOMRectReadOnly, "left" | "right" | "top" | "bottom" | "width" | "height">
  >;
}

export interface DraftCitationBadgeLayout {
  readonly index: number;
  readonly citation: AssistantCitation;
  readonly x: number;
  readonly y: number;
}

const EMPTY_DRAFT_CITATIONS: ReadonlyArray<DraftAssistantCitation> = [];

/** Stable primitive signature of a draft's citations; unchanged by plain text edits. */
export function draftAssistantCitationsSignature(prompt: string): string {
  if (!prompt.includes(CITATION_HREF_MARKER)) return "";
  const matches = collectAssistantCitations(prompt);
  if (matches.length === 0) return "";
  return matches.map((entry) => entry.source).join(CITATION_SIGNATURE_SEPARATOR);
}

export function parseDraftAssistantCitationsSignature(
  signature: string,
): ReadonlyArray<DraftAssistantCitation> {
  if (signature.length === 0) return EMPTY_DRAFT_CITATIONS;
  return collectAssistantCitations(signature.replaceAll(CITATION_SIGNATURE_SEPARATOR, " ")).map(
    (entry, offset) => ({
      index: offset + 1,
      citation: entry.citation,
      source: entry.source,
    }),
  );
}

export function draftCitationsForMessage(
  citations: ReadonlyArray<DraftAssistantCitation>,
  threadRef: ScopedThreadRef | undefined,
  messageId: MessageId,
): ReadonlyArray<DraftAssistantCitation> {
  if (citations.length === 0 || !threadRef) return EMPTY_DRAFT_CITATIONS;
  const filtered = citations.filter(
    ({ citation }) =>
      citation.messageId === messageId &&
      citation.environmentId === threadRef.environmentId &&
      citation.threadId === threadRef.threadId,
  );
  return filtered.length === 0 ? EMPTY_DRAFT_CITATIONS : filtered;
}

export function computeDraftCitationBadgePositions(input: {
  readonly containerRect: Pick<DOMRectReadOnly, "left" | "top" | "width">;
  readonly anchors: ReadonlyArray<DraftCitationBadgeAnchorInput>;
}): ReadonlyArray<DraftCitationBadgeLayout> {
  const { containerRect, anchors } = input;
  if (anchors.length === 0 || containerRect.width <= 0) return [];
  const placed: DraftCitationBadgeLayout[] = [];
  const maxX = Math.max(BADGE_MIN_X, Math.round(containerRect.width));

  for (const anchor of anchors) {
    const visibleRects = anchor.rects.filter((rect) => rect.width > 0 || rect.height > 0);
    const rects = visibleRects.length > 0 ? visibleRects : anchor.rects;
    const first = rects[0];
    if (!first) continue;

    let maxRight = first.right;
    let minTop = first.top;
    for (const rect of rects) {
      if (rect.right > maxRight) maxRight = rect.right;
      if (rect.top < minTop) minTop = rect.top;
    }

    let x = Math.max(BADGE_MIN_X, Math.min(Math.round(maxRight - containerRect.left + 8), maxX));
    const y = Math.max(0, Math.round(minTop - containerRect.top - BADGE_VERTICAL_LIFT));

    // Nudge left when another badge occupies the same top-right anchor.
    let attempts = 0;
    while (
      attempts < 8 &&
      placed.some(
        (other) =>
          Math.abs(other.x - x) < BADGE_COLLISION_X && Math.abs(other.y - y) < BADGE_COLLISION_Y,
      )
    ) {
      const nextX = x - BADGE_COLLISION_STEP;
      if (nextX < BADGE_MIN_X) break;
      x = nextX;
      attempts += 1;
    }

    placed.push({ index: anchor.index, citation: anchor.citation, x, y });
  }

  return placed;
}
