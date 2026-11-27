import type { LegendListRef } from "@legendapp/list/react";
import type { AssistantCitation, MessageId, ScopedThreadRef } from "@t3tools/contracts";
import { msg, useGT } from "gt-react";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import {
  resolveAssistantCitationRange,
  type AssistantCitationSourceAnchor,
} from "~/lib/assistantTextSelection";
import { m } from "~/i18n/messages";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { observeResize } from "~/lib/observeResize";
import {
  computeDraftCitationBadgePositions,
  draftCitationsForMessage,
  type DraftAssistantCitation,
  type DraftCitationBadgeAnchorInput,
  type DraftCitationBadgeLayout,
} from "./draftAssistantCitations";

const CITATION_PULSE_DURATION_MS = 650;
const CITATION_HIGHLIGHT_HOLD_MS = 1575;
const CITATION_HIGHLIGHT_FADE_MS = 450;
const CITATION_HIGHLIGHT_TOTAL_MS =
  1.5 * CITATION_PULSE_DURATION_MS + CITATION_HIGHLIGHT_HOLD_MS + CITATION_HIGHLIGHT_FADE_MS;
const CITATION_HIGHLIGHT_OPACITY = "--assistant-citation-highlight-opacity";
const CITATION_HIGHLIGHT_PEAK = 0.45;
const COMMENT_HIGHLIGHT_NAME = "t3-assistant-citation-comment";
const DRAFT_HIGHLIGHT_NAME = "t3-assistant-citation-draft";

export function observeAssistantCitationCommentSource({
  anchor,
  citation,
  onUnavailable,
}: {
  anchor: AssistantCitationSourceAnchor;
  citation: AssistantCitation;
  onUnavailable: () => void;
}): () => void {
  const { source, range, viewport } = anchor;
  const registry = typeof CSS !== "undefined" ? CSS.highlights : undefined;
  let highlight: Highlight | null = null;
  let stopped = false;
  const observer = new MutationObserver((records) => {
    if (stopped) return;
    const sourceChanged = records.some((record) => source.contains(record.target));
    validate(sourceChanged);
  });
  const dispose = () => {
    if (stopped) return;
    stopped = true;
    observer.disconnect();
    if (!highlight) return;
    highlight.delete(range);
    if (highlight.size === 0 && registry?.get(COMMENT_HIGHLIGHT_NAME) === highlight) {
      registry.delete(COMMENT_HIGHLIGHT_NAME);
    }
  };
  const unavailable = () => {
    if (stopped) return;
    dispose();
    onUnavailable();
  };
  const validate = (sourceChanged: boolean): boolean => {
    if (!source.isConnected || !viewport.contains(source)) {
      unavailable();
      return false;
    }
    if (
      sourceChanged ||
      range.collapsed ||
      !source.contains(range.startContainer) ||
      !source.contains(range.endContainer)
    ) {
      const repaired = resolveAssistantCitationRange(source, citation);
      if (!repaired) {
        unavailable();
        return false;
      }
      range.setStart(repaired.startContainer, repaired.startOffset);
      range.setEnd(repaired.endContainer, repaired.endOffset);
    }
    return true;
  };

  if (!validate(false)) return dispose;
  if (typeof Highlight !== "undefined" && registry) {
    const existing = registry.get(COMMENT_HIGHLIGHT_NAME);
    highlight = existing ?? new Highlight();
    highlight.add(range);
    if (!existing) registry.set(COMMENT_HIGHLIGHT_NAME, highlight);
  }
  observer.observe(viewport, { childList: true, subtree: true, characterData: true });
  return dispose;
}

export interface AssistantCitationRequest {
  citation: AssistantCitation;
  key: string;
}

/** Navigation owns activation state across virtual row remounts. */
export interface AssistantCitationTarget extends AssistantCitationRequest {
  activationRef: RefObject<{
    scrolled: boolean;
    dismissed: boolean;
    cancelScroll?: () => void;
    pulse?: { startedAt: number; reducedMotion: boolean };
  }>;
  onComplete: () => void;
}

function observeAssistantCitationSource({
  root,
  itemKey,
  request,
  list,
}: {
  root: HTMLElement;
  itemKey: string;
  request: AssistantCitationTarget;
  list: LegendListRef;
}) {
  const activation = request.activationRef.current;
  if (activation.dismissed) return;
  const scrollNode = list.getScrollableNode();
  if (!(scrollNode instanceof HTMLElement)) return;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let highlighted: Highlight | null = null;
  let ownedRange: Range | null = null;
  let selected: { range: Range; snapshot: Range } | null = null;
  let frame: number | null = null;
  let scrolling = false;
  let stopped = false;
  let pulseAnimation: Animation | null = null;
  let canReplaceSelection = !activation.scrolled;
  const ownsSelection = (selection: Selection | null) =>
    selected !== null &&
    selection?.rangeCount === 1 &&
    selection.getRangeAt(0) === selected.range &&
    selected.range.startContainer === selected.snapshot.startContainer &&
    selected.range.startOffset === selected.snapshot.startOffset &&
    selected.range.endContainer === selected.snapshot.endContainer &&
    selected.range.endOffset === selected.snapshot.endOffset;
  const clear = () => {
    if (highlighted && CSS.highlights.get("t3-assistant-citation") === highlighted) {
      CSS.highlights.delete("t3-assistant-citation");
    }
    highlighted = null;
    ownedRange = null;
    const selection = selected ? root.ownerDocument.getSelection() : null;
    if (selected && ownsSelection(selection)) selection?.removeRange(selected.range);
    selected = null;
    delete root.dataset.citationHighlighted;
  };
  const finishHighlight = () => {
    if (stopped) return;
    activation.dismissed = true;
    dispose();
  };
  const highlight = () => {
    frame = null;
    if (stopped || activation.dismissed || !root.isConnected || !scrollNode.contains(root)) {
      clear();
      return;
    }
    if (
      activation.pulse &&
      performance.now() - activation.pulse.startedAt >= CITATION_HIGHLIGHT_TOTAL_MS
    ) {
      finishHighlight();
      return;
    }
    const state = list.getState();
    const index = state.indexByKey(itemKey);
    if (index === undefined || !(state.sizeAtIndex(index) > 0)) return;
    const range = resolveAssistantCitationRange(root, request.citation);
    const rect = (range ?? root).getBoundingClientRect();
    if (rect.height <= 0 || scrollNode.clientHeight <= 0) {
      clear();
      return;
    }
    if (!activation.scrolled) {
      if (scrolling) return;
      const scrollRect = scrollNode.getBoundingClientRect();
      const offset = Math.max(
        0,
        Math.min(
          scrollNode.scrollHeight - scrollNode.clientHeight,
          state.scroll + rect.top - scrollRect.top - Math.min(120, scrollNode.clientHeight / 3),
        ),
      );
      if (Math.abs(offset - state.scroll) > 1) {
        scrolling = true;
        void list.scrollToOffset({ offset, animated: !reducedMotion }).then(
          () => {
            scrolling = false;
            if (!stopped && !activation.dismissed) schedule();
          },
          () => {
            scrolling = false;
            if (stopped || activation.dismissed) return;
            activation.dismissed = true;
            clear();
            request.onComplete();
            toastManager.add({
              type: "warning",
              title: m(msg("Could not open the cited response")),
              description: m(msg("Click the citation to try again.")),
            });
          },
        );
        return;
      }
      if (rect.bottom <= scrollRect.top || rect.top >= scrollRect.bottom) return;
      activation.scrolled = true;
      request.onComplete();
      // Screen readers follow focus, not scroll; leave someone already typing alone.
      const active = root.ownerDocument.activeElement;
      if (
        !(active instanceof HTMLElement) ||
        !(active.isContentEditable || active.matches("input, textarea, select"))
      ) {
        root.focus({ preventScroll: true });
      }
      if (!range) {
        toastManager.add({
          type: "warning",
          title: m(msg("The quoted text has changed")),
          description: m(msg("Showing the source response. The saved quote is unchanged.")),
        });
      }
    }
    if (!range) {
      finishHighlight();
      return;
    }
    if (typeof Highlight !== "undefined" && typeof CSS !== "undefined" && CSS.highlights) {
      highlighted = new Highlight(range);
      CSS.highlights.set("t3-assistant-citation", highlighted);
      ownedRange = range;
      root.dataset.citationHighlighted = "true";
    } else {
      const selection = root.ownerDocument.getSelection();
      if (selection && (canReplaceSelection || ownsSelection(selection))) {
        selection.removeAllRanges();
        selection.addRange(range);
        selected = { range: selection.getRangeAt(0), snapshot: range.cloneRange() };
        canReplaceSelection = false;
        ownedRange = range;
        root.dataset.citationHighlighted = "true";
      } else {
        finishHighlight();
        return;
      }
    }
    if (!pulseAnimation) {
      const pulse = (activation.pulse ??= {
        startedAt: performance.now(),
        reducedMotion,
      });
      const at = (milliseconds: number) => milliseconds / CITATION_HIGHLIGHT_TOTAL_MS;
      const holdEnd = at(CITATION_HIGHLIGHT_TOTAL_MS - CITATION_HIGHLIGHT_FADE_MS);
      pulseAnimation = root.animate(
        pulse.reducedMotion
          ? [
              { offset: 0, [CITATION_HIGHLIGHT_OPACITY]: CITATION_HIGHLIGHT_PEAK },
              { offset: holdEnd, [CITATION_HIGHLIGHT_OPACITY]: CITATION_HIGHLIGHT_PEAK },
              { offset: 1, [CITATION_HIGHLIGHT_OPACITY]: 0 },
            ]
          : [
              { offset: 0, [CITATION_HIGHLIGHT_OPACITY]: 0 },
              {
                offset: at(CITATION_PULSE_DURATION_MS * 0.5),
                [CITATION_HIGHLIGHT_OPACITY]: CITATION_HIGHLIGHT_PEAK,
              },
              { offset: at(CITATION_PULSE_DURATION_MS), [CITATION_HIGHLIGHT_OPACITY]: 0 },
              {
                offset: at(CITATION_PULSE_DURATION_MS * 1.5),
                [CITATION_HIGHLIGHT_OPACITY]: CITATION_HIGHLIGHT_PEAK,
              },
              { offset: holdEnd, [CITATION_HIGHLIGHT_OPACITY]: CITATION_HIGHLIGHT_PEAK },
              { offset: 1, [CITATION_HIGHLIGHT_OPACITY]: 0 },
            ],
        { duration: CITATION_HIGHLIGHT_TOTAL_MS, easing: "ease-in-out" },
      );
      pulseAnimation.id = "t3-assistant-citation-pulse";
      pulseAnimation.currentTime = Math.max(0, performance.now() - pulse.startedAt);
      void pulseAnimation.finished.then(finishHighlight, () => {});
    }
  };
  const schedule = () => {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(highlight);
  };
  const observer = new MutationObserver((records) => {
    const rangeMoved =
      ownedRange !== null &&
      (ownedRange.collapsed ||
        !root.contains(ownedRange.startContainer) ||
        !root.contains(ownedRange.endContainer));
    if (rangeMoved) {
      canReplaceSelection ||= selected !== null && ownsSelection(root.ownerDocument.getSelection());
      clear();
    }
    if (
      rangeMoved ||
      records.some(
        (record) =>
          root.contains(record.target) ||
          [...record.addedNodes, ...record.removedNodes].some((node) => node.contains(root)),
      )
    ) {
      schedule();
    }
  });
  observer.observe(scrollNode, { childList: true, characterData: true, subtree: true });
  const stopObservingResize = observeResize([root, scrollNode], schedule);
  const state = list.getState();
  const unsubscribe = [
    state.listenToPosition(itemKey, schedule),
    state.listen("totalSize", schedule),
    state.listen("headerSize", schedule),
  ];
  const cancelScroll = () => {
    if (scrolling) {
      scrolling = false;
      void list.scrollToOffset({
        // Legend may defer reading the offset until after the user scrolls.
        get offset() {
          return scrollNode.scrollTop;
        },
        animated: false,
      });
    }
  };
  activation.cancelScroll = cancelScroll;
  schedule();
  const dispose = () => {
    if (stopped) return;
    stopped = true;
    cancelScroll();
    pulseAnimation?.cancel();
    if (frame !== null) cancelAnimationFrame(frame);
    observer.disconnect();
    stopObservingResize();
    for (const stop of unsubscribe) stop();
    if (activation.cancelScroll === cancelScroll) delete activation.cancelScroll;
    clear();
  };
  return dispose;
}

function badgeLayoutsEqual(
  left: ReadonlyArray<DraftCitationBadgeLayout>,
  right: ReadonlyArray<DraftCitationBadgeLayout>,
): boolean {
  if (left.length !== right.length) return false;
  return left.every(
    (item, index) =>
      item.index === right[index]?.index &&
      item.x === right[index]?.x &&
      item.y === right[index]?.y &&
      item.citation.comment === right[index]?.citation.comment,
  );
}

function DraftCitationBadgeLayer({
  sourceRef,
  citations,
  onOpenComment,
}: {
  sourceRef: RefObject<HTMLDivElement | null>;
  citations: ReadonlyArray<DraftAssistantCitation>;
  onOpenComment?:
    | ((ordinal: number, sourceAnchor: AssistantCitationSourceAnchor) => boolean)
    | undefined;
}) {
  const gt = useGT();
  const [badges, setBadges] = useState<ReadonlyArray<DraftCitationBadgeLayout>>([]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- syncs CSS Custom Highlight ranges and overlay badge coordinates with the cited message DOM
  useEffect(() => {
    const source = sourceRef.current;
    if (!source || citations.length === 0) return;

    const registry = typeof CSS !== "undefined" ? CSS.highlights : undefined;
    const ownedRanges: Range[] = [];
    let frame: number | null = null;
    let stopped = false;

    const clearHighlights = () => {
      if (ownedRanges.length === 0) return;
      const highlight = registry?.get(DRAFT_HIGHLIGHT_NAME);
      if (highlight) {
        for (const range of ownedRanges) highlight.delete(range);
        if (highlight.size === 0) registry?.delete(DRAFT_HIGHLIGHT_NAME);
      }
      ownedRanges.length = 0;
    };

    const sync = () => {
      frame = null;
      if (stopped || !source.isConnected) {
        clearHighlights();
        return;
      }
      clearHighlights();

      const containerRect = source.getBoundingClientRect();
      if (containerRect.width <= 0) {
        setBadges((current) => (current.length === 0 ? current : []));
        return;
      }

      const anchors: DraftCitationBadgeAnchorInput[] = [];
      let highlight = registry?.get(DRAFT_HIGHLIGHT_NAME) ?? null;
      for (const entry of citations) {
        const range = resolveAssistantCitationRange(source, entry.citation);
        if (!range) continue;
        if (typeof Highlight !== "undefined" && registry) {
          if (!highlight) {
            highlight = new Highlight();
            registry.set(DRAFT_HIGHLIGHT_NAME, highlight);
          }
          highlight.add(range);
          ownedRanges.push(range);
        }
        const rects = Array.from(range.getClientRects());
        const fallbackRect = range.getBoundingClientRect();
        anchors.push({
          index: entry.index,
          citation: entry.citation,
          rects: rects.length > 0 ? rects : [fallbackRect],
        });
      }

      const nextBadges = computeDraftCitationBadgePositions({ containerRect, anchors });
      setBadges((current) => (badgeLayoutsEqual(current, nextBadges) ? current : nextBadges));
    };

    const schedule = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(sync);
    };

    const observer = new MutationObserver(schedule);
    observer.observe(source, { childList: true, subtree: true, characterData: true });
    const stopObservingResize = observeResize([source], schedule);
    sync();

    return () => {
      stopped = true;
      if (frame !== null) cancelAnimationFrame(frame);
      observer.disconnect();
      stopObservingResize();
      clearHighlights();
    };
  }, [citations, sourceRef]);

  if (badges.length === 0) return null;

  const openBadgeComment = (badge: DraftCitationBadgeLayout) => {
    const source = sourceRef.current;
    if (!source || !onOpenComment) return;
    const viewport = source.closest<HTMLElement>("[data-assistant-citation-viewport]");
    const range = resolveAssistantCitationRange(source, badge.citation);
    if (!viewport || !range) return;
    onOpenComment(badge.index - 1, { source, range, viewport });
  };

  return (
    <div
      data-assistant-citation-badges="true"
      data-thread-find-ignore
      className="pointer-events-none absolute inset-0"
    >
      {badges.map((badge) => {
        const label = badge.citation.comment
          ? gt("Edit citation {index} comment: {comment}", {
              index: badge.index,
              comment: badge.citation.comment,
            })
          : gt("Edit citation {index} comment", { index: badge.index });
        return (
          <Tooltip key={badge.index}>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  data-assistant-citation-badge={badge.index}
                  aria-label={label}
                  style={{ left: `${badge.x}px`, top: `${badge.y}px` }}
                  className="pointer-events-auto absolute z-10 inline-flex h-5 min-w-5 -translate-x-full cursor-pointer items-center justify-center rounded-full rounded-bl-xs bg-primary px-1.5 text-2xs font-semibold leading-none text-primary-foreground tabular-nums shadow-xs ring-2 ring-background transition-transform hover:scale-105 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none"
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => openBadgeComment(badge)}
                />
              }
            >
              {badge.index}
            </TooltipTrigger>
            <TooltipPopup side="top">{label}</TooltipPopup>
          </Tooltip>
        );
      })}
    </div>
  );
}

export function AssistantCitationSource({
  messageId,
  threadRef,
  itemKey,
  request,
  draftCitations,
  onOpenDraftCitationComment,
  listRef,
  children,
}: {
  messageId: MessageId;
  threadRef?: ScopedThreadRef;
  itemKey: string;
  request: AssistantCitationTarget | null;
  draftCitations?: ReadonlyArray<DraftAssistantCitation> | undefined;
  onOpenDraftCitationComment?:
    | ((ordinal: number, sourceAnchor: AssistantCitationSourceAnchor) => boolean)
    | undefined;
  listRef: RefObject<LegendListRef | null>;
  children: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const messageDraftCitations = draftCitations
    ? draftCitationsForMessage(draftCitations, threadRef, messageId)
    : [];

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- observes this message's DOM for a citation reveal request and scrolls the LegendList to it
  useEffect(() => {
    const root = rootRef.current;
    const list = listRef.current;
    if (!root || !list || !request || request.citation.messageId !== messageId) return;
    return observeAssistantCitationSource({ root, itemKey, request, list });
  }, [itemKey, listRef, messageId, request]);

  return (
    <div className="relative">
      <div
        ref={rootRef}
        tabIndex={-1}
        className="outline-none"
        data-assistant-citation-source={messageId}
        data-assistant-citation-environment={threadRef?.environmentId}
        data-assistant-citation-thread={threadRef?.threadId}
      >
        {children}
      </div>
      {messageDraftCitations.length > 0 ? (
        <DraftCitationBadgeLayer
          sourceRef={rootRef}
          citations={messageDraftCitations}
          onOpenComment={onOpenDraftCitationComment}
        />
      ) : null}
    </div>
  );
}
