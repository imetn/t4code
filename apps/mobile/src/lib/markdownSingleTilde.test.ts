import { describe, expect, it } from "vite-plus/test";
import {
  markdownWithEscapedSingleTildes,
  parseMarkdownDocument,
} from "./markdownDocument";

describe("markdownWithEscapedSingleTildes", () => {
  it("escapes standalone single tildes in prose while preserving double-tilde strikethrough", () => {
    expect(
      markdownWithEscapedSingleTildes(
        "Latency is 10~20ms (about 80~90% faster), under com~apple~CloudDocs.",
      ),
    ).toBe("Latency is 10\\~20ms (about 80\\~90% faster), under com\\~apple\\~CloudDocs.");

    expect(markdownWithEscapedSingleTildes("Keep ~~removed text~~ as strikethrough.")).toBe(
      "Keep ~~removed text~~ as strikethrough.",
    );
    expect(markdownWithEscapedSingleTildes("Mix 10~20ms and ~~old~~ values.")).toBe(
      "Mix 10\\~20ms and ~~old~~ values.",
    );
  });

  it("leaves code spans, fenced blocks, links, math, and already-escaped tildes alone", () => {
    expect(markdownWithEscapedSingleTildes("Inline `10~20ms` and ~/a ~ ~/b")).toBe(
      "Inline `10~20ms` and \\~/a \\~ \\~/b",
    );
    expect(markdownWithEscapedSingleTildes("```\n10~20ms\n```\nAfter 1~2")).toBe(
      "```\n10~20ms\n```\nAfter 1\\~2",
    );
    expect(
      markdownWithEscapedSingleTildes("See [home](https://example.com/~user/a~b) and \\~kept."),
    ).toBe("See [home](https://example.com/~user/a~b) and \\~kept.");
    expect(markdownWithEscapedSingleTildes("Math $a ~ b$ and $$x ~ y$$ outside 1~2")).toBe(
      "Math $a ~ b$ and $$x ~ y$$ outside 1\\~2",
    );
  });

  it("does not parse single tildes as GFM delete nodes", () => {
    const doc = parseMarkdownDocument("About 10~20ms and ~~deleted~~");
    const serialized = JSON.stringify(doc);
    expect(serialized).toContain('"type":"delete"');
    expect(serialized).toContain("About 10~20ms and ");
  });
});
