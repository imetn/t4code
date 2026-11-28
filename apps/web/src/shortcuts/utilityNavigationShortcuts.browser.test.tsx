import { DEFAULT_RESOLVED_KEYBINDINGS } from "@t3tools/shared/keybindings";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { render } from "../../test/render";

const caps = vi.hoisted(() => ({
  todos: true,
  pullRequests: true,
  issues: true,
}));

vi.mock(import("../state/presentation"), async (original) => {
  const actual = await original();
  const { Atom } = await import("effect/reactivity");
  return {
    ...actual,
    environmentSummaries: {
      ...actual.environmentSummaries,
      projectTodosSupportedAtom: Atom.readable(() => caps.todos),
      pullRequestsSupportedAtom: Atom.readable(() => caps.pullRequests),
      issuesSupportedAtom: Atom.readable(() => caps.issues),
    },
  };
});

import { useCommandPaletteMount } from "../commandPaletteStore";
import { startMainAppLocationTracking } from "../components/sidebar/mainAppLocation";
import { installCommandPaletteCommands } from "./commandPaletteCommands";

function MountedPalette() {
  useCommandPaletteMount();
  return null;
}

describe("sidebar utility view shortcuts", () => {
  it("opens and toggles board, todos, pull requests, issues, and settings on macOS", async () => {
    using _platform = vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    await using screen = await render(<MountedPalette />, { router: "/new" });
    const router = screen.router!;
    using stack = new DisposableStack();
    stack.defer(startMainAppLocationTracking(router));
    stack.defer(
      installCommandPaletteCommands(router, {
        keybindings: () => DEFAULT_RESOLVED_KEYBINDINGS,
      }),
    );

    const navigate = vi.spyOn(router, "navigate");

    await userEvent.keyboard("{Meta>}{Alt>}k{/Alt}{/Meta}");
    expect(navigate).toHaveBeenLastCalledWith({ to: "/board" });

    await userEvent.keyboard("{Meta>}{Alt>}t{/Alt}{/Meta}");
    expect(navigate).toHaveBeenLastCalledWith({ to: "/todos" });

    await userEvent.keyboard("{Meta>}{Alt>}p{/Alt}{/Meta}");
    expect(navigate).toHaveBeenLastCalledWith(expect.objectContaining({ to: "/pull-requests" }));

    await userEvent.keyboard("{Meta>}{Shift>}i{/Shift}{/Meta}");
    expect(navigate).toHaveBeenLastCalledWith(expect.objectContaining({ to: "/issues" }));

    await userEvent.keyboard("{Meta>},{/Meta}");
    expect(navigate).toHaveBeenLastCalledWith({ to: "/settings" });
  });

  it("toggles back to the main app view when pressing the same utility shortcut again", async () => {
    using _platform = vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    await using screen = await render(<MountedPalette />, { router: "/board" });
    const router = screen.router!;
    using stack = new DisposableStack();
    stack.defer(
      installCommandPaletteCommands(router, {
        keybindings: () => DEFAULT_RESOLVED_KEYBINDINGS,
      }),
    );

    const navigate = vi.spyOn(router, "navigate");
    await userEvent.keyboard("{Meta>}{Alt>}k{/Alt}{/Meta}");
    expect(navigate).toHaveBeenLastCalledWith({ href: expect.any(String) });
  });
});
