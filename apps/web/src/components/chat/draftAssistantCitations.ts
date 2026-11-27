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

    const baseX = Math.max(
      BADGE_MIN_X,
      Math.min(Math.round(maxRight - containerRect.left + 8), maxX),
    );
    const baseY = Math.max(0, Math.round(minTop - containerRect.top - BADGE_VERTICAL_LIFT));
    const collides = (candidateX: number, candidateY: number) =>
      placed.some(
        (other) =>
          Math.abs(other.x - candidateX) < BADGE_COLLISION_X &&
          Math.abs(other.y - candidateY) < BADGE_COLLISION_Y,
      );

    let x = baseX;
    let y = baseY;
    // Prefer shifting left on the same row, then right, then wrapping down if a narrow line is full.
    for (let row = 0; row < 8 && collides(x, y); row += 1) {
      const candidateY = baseY + row * BADGE_COLLISION_Y;
      let resolved = false;
      for (let step = 0; step <= 8; step += 1) {
        const leftX = baseX - step * BADGE_COLLISION_STEP;
        if (leftX >= BADGE_MIN_X && !collides(leftX, candidateY)) {
          x = leftX;
          y = candidateY;
          resolved = true;
          break;
        }
      }
      if (resolved) break;
      for (let step = 1; step <= 8; step += 1) {
        const rightX = baseX + step * BADGE_COLLISION_STEP;
        if (rightX <= maxX && !collides(rightX, candidateY)) {
          x = rightX;
          y = candidateY;
          resolved = true;
          break;
        }
      }
      if (resolved) break;
      y = candidateY + BADGE_COLLISION_Y;
      x = baseX;
    }

    placed.push({ index: anchor.index, citation: anchor.citation, x, y });
  }

  return placed;
}
