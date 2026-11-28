import { render } from "../../../test/render";
import { DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts/settings";
import { StrictMode } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "../../index.css";
import type { ScopedSettingsPatch } from "./scopedSettings";

type SenderNote = typeof DEFAULT_UNIFIED_SETTINGS.agentMessageSenderNote;
const state = vi.hoisted(() => ({
  notes: [] as SenderNote[],
  updateSettings: vi.fn<(patch: ScopedSettingsPatch) => void>(),
}));

vi.mock(import("./useScopedSettings"), async (original) => ({
  ...(await original()),
  useScopedSettings: (() => ({
    ...DEFAULT_UNIFIED_SETTINGS,
    agentMessageSenderNote: state.notes[0],
  })) as never,
  useUpdateScopedSettings: () => state.updateSettings,
}));
vi.mock(import("./SettingsScopeContext"), async (original) => ({
  ...(await original()),
  useSettingsScope: (() => ({
    scope: { kind: "all", environmentIds: [] },
    environment: null,
    connectedEnvironments: [],
    targets: state.notes.map((note, index) => ({
      environmentId: `env-${index}`,
      projectId: null,
      settings: { ...DEFAULT_UNIFIED_SETTINGS, agentMessageSenderNote: note },
    })),
    target: null,
  })) as never,
}));
vi.mock(import("./settingsLayout"), async (original) => ({
  ...(await original()),
  SettingsRow: ({ title, description, control, resetAction, children }) => (
    <div>
      <h3>{title}</h3>
      {description ? <p>{description}</p> : null}
      {control}
      {resetAction}
      {children}
    </div>
  ),
}));

import { AgentMessageSenderNoteSettings } from "./AgentMessageSenderNoteSettings";

const content = () => (
  <StrictMode>
    <AgentMessageSenderNoteSettings />
  </StrictMode>
);

async function setup(notes: SenderNote[]) {
  state.notes = notes;
  const screen = await render(content());
  state.updateSettings.mockReset().mockImplementation((patch) => {
    state.notes = state.notes.map((note) => ({
      ...note,
      ...patch.agentMessageSenderNote,
    }));
    void screen.rerender(content());
  });
  return screen;
}

describe("AgentMessageSenderNoteSettings", () => {
  it("defaults to off, allows configuring a custom prefix, and resets to defaults", async () => {
    await using _screen = await setup([{ ...DEFAULT_UNIFIED_SETTINGS.agentMessageSenderNote }]);

    const trigger = page.getByRole("combobox", { name: "Agent message sender note" });
    await expect.element(trigger).toHaveTextContent("Off (treat as user)");
    await expect
      .element(page.getByRole("textbox", { name: "Custom agent message prefix" }))
      .not.toBeInTheDocument();
    await expect
      .element(page.getByRole("button", { name: "Reset agent message sender note to default" }))
      .not.toBeInTheDocument();

    await userEvent.click(trigger);
    await userEvent.click(page.getByRole("option", { name: "Custom prefix" }));

    expect(state.updateSettings).toHaveBeenLastCalledWith({
      agentMessageSenderNote: { mode: "custom" },
    });
    const textbox = page.getByRole("textbox", { name: "Custom agent message prefix" });
    await expect.element(textbox).toBeVisible();

    await userEvent.fill(textbox, "  [External Skill]  ");
    await userEvent.tab();

    expect(state.updateSettings).toHaveBeenLastCalledWith({
      agentMessageSenderNote: { customPrefix: "[External Skill]" },
    });

    const reset = page.getByRole("button", { name: "Reset agent message sender note to default" });
    await expect.element(reset).toBeVisible();
    await userEvent.click(reset);

    expect(state.updateSettings).toHaveBeenLastCalledWith({
      agentMessageSenderNote: { mode: "off", customPrefix: "" },
    });
    await expect.element(trigger).toHaveTextContent("Off (treat as user)");
    await expect.element(textbox).not.toBeInTheDocument();
  });

  it("shows Mixed across environments with different modes and applies a shared selection", async () => {
    await using _screen = await setup([
      { mode: "off", customPrefix: "" },
      { mode: "default", customPrefix: "" },
    ]);

    const trigger = page.getByRole("combobox", { name: "Agent message sender note" });
    await expect.element(trigger).toHaveTextContent("Mixed");

    await userEvent.click(trigger);
    await userEvent.click(page.getByRole("option", { name: "Default source notice" }));

    expect(state.updateSettings).toHaveBeenLastCalledWith({
      agentMessageSenderNote: { mode: "default" },
    });
    await expect.element(trigger).toHaveTextContent("Default source notice");
  });
});
