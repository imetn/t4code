import { EnvironmentId, MessageId, ThreadId, type AssistantCitation } from "@t3tools/contracts";
import { serializeAssistantCitation } from "@t3tools/shared/assistantCitations";
import { describe, expect, it } from "vite-plus/test";

import {
  computeDraftCitationBadgePositions,
  draftAssistantCitationsSignature,
  draftCitationsForMessage,
  parseDraftAssistantCitationsSignature,
} from "./draftAssistantCitations";

const envId = EnvironmentId.make("env-1");
const threadId = ThreadId.make("thread-1");

function makeCitation(
  messageId: string,
  text: string,
  start: number,
  comment?: string,
): AssistantCitation {
  return {
    version: 1,
    environmentId: envId,
    threadId,
    messageId: MessageId.make(messageId),
    text,
    start,
    end: start + text.length,
    prefix: "",
    suffix: "",
    ...(comment ? { comment } : {}),
  };
}

describe("draftAssistantCitations", () => {
  it("keeps the signature stable across plain-text edits and updates when citations change", () => {
    const c1 = makeCitation("msg-1", "first quote", 0);
    const c2 = makeCitation("msg-2", "second quote", 10, "check this");
    const m1 = serializeAssistantCitation(c1);
    const m2 = serializeAssistantCitation(c2);

    const sigBefore = draftAssistantCitationsSignature(`intro ${m1} middle ${m2} end`);
    const sigAfterTyping = draftAssistantCitationsSignature(
      `much longer intro ${m1} edited middle ${m2} trailing words`,
    );
    expect(sigAfterTyping).toBe(sigBefore);

    const parsed = parseDraftAssistantCitationsSignature(sigBefore);
    expect(parsed.map((item) => ({ index: item.index, text: item.citation.text }))).toEqual([
      { index: 1, text: "first quote" },
      { index: 2, text: "second quote" },
    ]);
    expect(parsed[1]?.citation.comment).toBe("check this");

    const sigRemovedFirst = draftAssistantCitationsSignature(`intro ${m2}`);
    expect(sigRemovedFirst).not.toBe(sigBefore);
    const renumbered = parseDraftAssistantCitationsSignature(sigRemovedFirst);
    expect(renumbered.map((item) => ({ index: item.index, text: item.citation.text }))).toEqual([
      { index: 1, text: "second quote" },
    ]);

    expect(draftAssistantCitationsSignature("plain text without citations")).toBe("");
    expect(parseDraftAssistantCitationsSignature("")).toEqual([]);
  });

  it("filters citations to the target message while preserving draft-wide 1-based numbering", () => {
    const c1 = makeCitation("msg-1", "alpha", 0);
    const c2 = makeCitation("msg-2", "beta", 0);
    const c3 = makeCitation("msg-1", "gamma", 20);
    const sig = draftAssistantCitationsSignature(
      `${serializeAssistantCitation(c1)} ${serializeAssistantCitation(c2)} ${serializeAssistantCitation(c3)}`,
    );
    const all = parseDraftAssistantCitationsSignature(sig);
    const threadRef = { environmentId: envId, threadId };

    expect(
      draftCitationsForMessage(all, threadRef, MessageId.make("msg-1")).map((x) => x.index),
    ).toEqual([1, 3]);
    expect(
      draftCitationsForMessage(all, threadRef, MessageId.make("msg-2")).map((x) => x.index),
    ).toEqual([2]);
    expect(
      draftCitationsForMessage(
        all,
        { environmentId: envId, threadId: ThreadId.make("other-thread") },
        MessageId.make("msg-1"),
      ),
    ).toEqual([]);
  });

  it("computes clamped top-right badge positions and separates overlapping badges on the same line", () => {
    const c1 = makeCitation("msg-1", "first", 0);
    const c2 = makeCitation("msg-1", "second", 6);
    const positions = computeDraftCitationBadgePositions({
      containerRect: { left: 100, top: 200, width: 400 },
      anchors: [
        {
          index: 1,
          citation: c1,
          rects: [{ left: 110, right: 560, top: 202, bottom: 220, width: 450, height: 18 }],
        },
        {
          index: 2,
          citation: c2,
          rects: [{ left: 120, right: 550, top: 204, bottom: 222, width: 430, height: 18 }],
        },
      ],
    });

    expect(positions).toHaveLength(2);
    // Clamped to container width (400) and top >= 0.
    expect(positions[0]).toMatchObject({ index: 1, x: 400, y: 0 });
    // Second overlapping badge shifts left so both stay clickable.
    expect(positions[1]).toMatchObject({ index: 2, x: 376, y: 0 });
  });

  it("avoids stacking badges on identical coordinates at the left edge", () => {
    const c1 = makeCitation("msg-1", "a", 0);
    const c2 = makeCitation("msg-1", "b", 2);
    const c3 = makeCitation("msg-1", "c", 4);
    const positions = computeDraftCitationBadgePositions({
      containerRect: { left: 100, top: 200, width: 60 },
      anchors: [
        {
          index: 1,
          citation: c1,
          rects: [{ left: 100, right: 105, top: 202, bottom: 220, width: 5, height: 18 }],
        },
        {
          index: 2,
          citation: c2,
          rects: [{ left: 100, right: 105, top: 202, bottom: 220, width: 5, height: 18 }],
        },
        {
          index: 3,
          citation: c3,
          rects: [{ left: 100, right: 105, top: 202, bottom: 220, width: 5, height: 18 }],
        },
      ],
    });

    expect(positions).toHaveLength(3);
    for (let i = 0; i < positions.length; i += 1) {
      for (let j = i + 1; j < positions.length; j += 1) {
        const dx = Math.abs(positions[i]!.x - positions[j]!.x);
        const dy = Math.abs(positions[i]!.y - positions[j]!.y);
        expect(dx >= 22 || dy >= 20).toBe(true);
      }
    }
  });
});
