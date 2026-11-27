import { ProviderInstanceId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { moveProviderInstance, orderProviderInstances } from "./providerInstanceOrder.logic";

const id = ProviderInstanceId.make;
const row = (instanceId: string, enabled = true) => ({ instanceId: id(instanceId), enabled });
const ids = (rows: ReadonlyArray<{ readonly instanceId: ProviderInstanceId }>) =>
  rows.map((entry) => entry.instanceId);

describe("orderProviderInstances", () => {
  it("sinks disabled providers below enabled ones by default", () => {
    const rows = [row("codex"), row("grok", false), row("claude"), row("antigravity")];
    expect(ids(orderProviderInstances(rows, []))).toEqual([
      "codex",
      "claude",
      "antigravity",
      "grok",
    ]);
  });

  it("applies the saved order within each group and keeps new providers last", () => {
    const rows = [row("codex"), row("claude"), row("grok", false), row("cursor"), row("new")];
    const saved = [id("cursor"), id("grok"), id("claude"), id("codex")];
    expect(ids(orderProviderInstances(rows, saved))).toEqual([
      "cursor",
      "claude",
      "codex",
      "new",
      "grok",
    ]);
  });
});

describe("moveProviderInstance", () => {
  const ordered = [
    row("codex"),
    row("claude"),
    row("cursor"),
    row("grok", false),
    row("pi", false),
  ];

  it("moves a provider onto another provider's slot", () => {
    expect(moveProviderInstance(ordered, id("cursor"), id("codex"))).toEqual(
      ids([row("cursor"), row("codex"), row("claude"), row("grok"), row("pi")]),
    );
  });

  it("keeps a provider inside its enabled or disabled group", () => {
    expect(moveProviderInstance(ordered, id("codex"), id("pi"))).toEqual(
      ids([row("claude"), row("cursor"), row("codex"), row("grok"), row("pi")]),
    );
    expect(moveProviderInstance(ordered, id("pi"), id("codex"))).toEqual(
      ids([row("codex"), row("claude"), row("cursor"), row("pi"), row("grok")]),
    );
    expect(moveProviderInstance(ordered, id("cursor"), id("grok"))).toBeUndefined();
  });
});
