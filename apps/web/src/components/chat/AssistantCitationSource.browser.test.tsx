import type { LegendListRef } from "@legendapp/list/react";
import { EnvironmentId, MessageId, ThreadId, type AssistantCitation } from "@t3tools/contracts";
import { serializeAssistantCitation } from "@t3tools/shared/assistantCitations";
import { describe, expect, it, vi } from "vite-plus/test";
import { useRef } from "react";

import "~/index.css";
import { act, render } from "../../../test/render";
import { AssistantCitationSource } from "./AssistantCitationSource";
import type { DraftAssistantCitation } from "./draftAssistantCitations";

const envId = EnvironmentId.make("env-1");
const threadId = ThreadId.make("thread-1");
const messageId = MessageId.make("msg-1");
const threadRef = { environmentId: envId, threadId };

function makeDraftCitation(index: number, text: string, start: number): DraftAssistantCitation {
  const citation: AssistantCitation = {
    version: 1,
    environmentId: envId,
    threadId,
    messageId,
    text,
    start,
    end: start + text.length,
    prefix: "",
    suffix: "",
  };
  return {
    index,
    citation,
    source: serializeAssistantCitation(citation),
  };
}

function Harness({
  draftCitations,
  onOpenDraftCitationComment,
}: {
  draftCitations: ReadonlyArray<DraftAssistantCitation>;
  onOpenDraftCitationComment?: (ordinal: number, anchor: { range: Range }) => boolean;
}) {
  const listRef = useRef<LegendListRef | null>(null);
  return (
    <div data-assistant-citation-viewport="true" style={{ width: 480, padding: 16 }}>
      <AssistantCitationSource
        messageId={messageId}
        threadRef={threadRef}
        itemKey="row-1"
        request={null}
        draftCitations={draftCitations}
        onOpenDraftCitationComment={onOpenDraftCitationComment}
        listRef={listRef}
      >
        <p>Alpha first cited passage sits on this line.</p>
        <p>Beta second cited passage appears below.</p>
      </AssistantCitationSource>
    </div>
  );
}

describe("AssistantCitationSource draft highlights and numbered badges", () => {
  it("renders numbered badges outside the source DOM, registers draft highlights, renumbers on delete, and opens comments on click", async () => {
    const first = makeDraftCitation(1, "first cited passage", 6);
    const second = makeDraftCitation(2, "second cited passage", 50);
    const onOpenComment = vi.fn((_ordinal: number, _anchor: { range: Range }) => true);

    await using screen = await render(
      <Harness draftCitations={[first, second]} onOpenDraftCitationComment={onOpenComment} />,
    );

    await vi.waitFor(() => {
      expect(document.querySelector('[data-assistant-citation-badge="1"]')).not.toBeNull();
      expect(document.querySelector('[data-assistant-citation-badge="2"]')).not.toBeNull();
    });

    const source = document.querySelector<HTMLElement>("[data-assistant-citation-source]")!;
    const badge1 = document.querySelector<HTMLButtonElement>(
      '[data-assistant-citation-badge="1"]',
    )!;
    const badge2 = document.querySelector<HTMLButtonElement>(
      '[data-assistant-citation-badge="2"]',
    )!;
    expect(source.contains(badge1)).toBe(false);
    expect(source.contains(badge2)).toBe(false);
    expect(badge1.textContent?.trim()).toBe("1");
    expect(badge2.textContent?.trim()).toBe("2");

    if (typeof CSS !== "undefined" && CSS.highlights) {
      expect(CSS.highlights.get("t3-assistant-citation-draft")?.size).toBe(2);
    }

    await act(async () => {
      badge2.click();
    });
    expect(onOpenComment).toHaveBeenCalledTimes(1);
    const [ordinal, anchor] = onOpenComment.mock.calls[0]!;
    expect(ordinal).toBe(1);
    expect(anchor.range.toString()).toBe("second cited passage");

    // Removing the first citation renumbers the second to 1.
    const renumbered = makeDraftCitation(1, "second cited passage", 50);
    await screen.rerender(
      <Harness draftCitations={[renumbered]} onOpenDraftCitationComment={onOpenComment} />,
    );
    await vi.waitFor(() => {
      expect(document.querySelector('[data-assistant-citation-badge="1"]')).not.toBeNull();
      expect(document.querySelector('[data-assistant-citation-badge="2"]')).toBeNull();
    });
    if (typeof CSS !== "undefined" && CSS.highlights) {
      expect(CSS.highlights.get("t3-assistant-citation-draft")?.size).toBe(1);
    }

    // Clearing draft citations removes all badges and draft highlights.
    await screen.rerender(
      <Harness draftCitations={[]} onOpenDraftCitationComment={onOpenComment} />,
    );
    await vi.waitFor(() => {
      expect(document.querySelector('[data-assistant-citation-badges="true"]')).toBeNull();
    });
    if (typeof CSS !== "undefined" && CSS.highlights) {
      expect(CSS.highlights.get("t3-assistant-citation-draft")).toBeUndefined();
    }
  });
});
