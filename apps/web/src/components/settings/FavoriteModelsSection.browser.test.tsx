import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import "~/index.css";
import { render } from "../../../test/render";
import { FavoriteModelsSection } from "./FavoriteModelsSection";

const providers: ReadonlyArray<ServerProvider> = [
  {
    instanceId: ProviderInstanceId.make("codex"),
    driver: ProviderDriverKind.make("codex"),
    enabled: true,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-01-01T00:00:00.000Z",
    models: [
      { slug: "gpt-6.2-sol", name: "GPT-6.2-Sol", isCustom: false, capabilities: null },
      { slug: "gpt-6.2-astra", name: "GPT-6.2-Astra", isCustom: false, capabilities: null },
    ],
    slashCommands: [],
    skills: [],
  },
  {
    instanceId: ProviderInstanceId.make("claudeAgent"),
    driver: ProviderDriverKind.make("claudeAgent"),
    enabled: true,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-01-01T00:00:00.000Z",
    models: [{ slug: "opus-5.5", name: "Opus 5.5", isCustom: false, capabilities: null }],
    slashCommands: [],
    skills: [],
  },
  {
    instanceId: ProviderInstanceId.make("antigravity"),
    driver: ProviderDriverKind.make("antigravity"),
    enabled: true,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-01-01T00:00:00.000Z",
    models: [{ slug: "gemini-4-neon", name: "Gemini 4 Neon", isCustom: false, capabilities: null }],
    slashCommands: [],
    skills: [],
  },
];

describe("FavoriteModelsSection", () => {
  it("lists cross-provider favorites in persisted order and reorders or removes them in Settings", async () => {
    const onReorderFavorites = vi.fn(async () => true);
    const onToggleFavorite = vi.fn();

    await using _screen = await render(
      <FavoriteModelsSection
        favorites={[
          { provider: ProviderInstanceId.make("antigravity"), model: "gemini-4-neon" },
          { provider: ProviderInstanceId.make("claudeAgent"), model: "opus-5.5" },
          { provider: ProviderInstanceId.make("codex"), model: "gpt-6.2-astra" },
        ]}
        providers={providers}
        providerInstances={undefined}
        readOnly={false}
        canWriteSettings={true}
        onReorderFavorites={onReorderFavorites}
        onToggleFavorite={onToggleFavorite}
      />,
    );

    const rowKeys = () =>
      [...document.querySelectorAll<HTMLElement>("[data-favorite-model-row]")].map(
        (el) => el.dataset.favoriteModelRow,
      );

    expect(rowKeys()).toEqual([
      "antigravity:gemini-4-neon",
      "claudeAgent:opus-5.5",
      "codex:gpt-6.2-astra",
    ]);

    await page.getByRole("button", { name: "Move Opus 5.5 up" }).click();
    expect(onReorderFavorites).toHaveBeenCalledWith([
      { provider: ProviderInstanceId.make("claudeAgent"), model: "opus-5.5" },
      { provider: ProviderInstanceId.make("antigravity"), model: "gemini-4-neon" },
      { provider: ProviderInstanceId.make("codex"), model: "gpt-6.2-astra" },
    ]);
    expect(rowKeys()).toEqual([
      "claudeAgent:opus-5.5",
      "antigravity:gemini-4-neon",
      "codex:gpt-6.2-astra",
    ]);

    await page.getByRole("button", { name: "Remove GPT-6.2-Astra from favorites" }).click();
    expect(onToggleFavorite).toHaveBeenCalledWith(
      ProviderInstanceId.make("codex"),
      "gpt-6.2-astra",
    );
  });

  it("renders a helpful empty state when no favorites exist", async () => {
    await using _screen = await render(
      <FavoriteModelsSection
        favorites={[]}
        providers={providers}
        providerInstances={undefined}
        readOnly={false}
        canWriteSettings={true}
        onReorderFavorites={async () => true}
        onToggleFavorite={() => {}}
      />,
    );

    await expect.element(page.getByText("No favorites yet")).toBeVisible();
  });
});
