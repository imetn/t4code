import type { DesktopUpdateState } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";

const mocks = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  return {
    update: null as DesktopUpdateState | null,
    installLocalUpdate: vi.fn(async () => true),
    downloadLocalUpdate: vi.fn(async () => true),
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    notify: () => {
      for (const listener of listeners) listener();
    },
  };
});

vi.mock(
  import("../../state/desktopUpdate"),
  async () =>
    ({
      useDesktopUpdateState: (await import("react")).useSyncExternalStore.bind(
        null,
        mocks.subscribe,
        () => mocks.update,
      ),
    }) as never,
);

vi.mock(
  import("../sidebar/SidebarUpdatePill"),
  () =>
    ({
      installLocalUpdate: mocks.installLocalUpdate,
      downloadLocalUpdate: mocks.downloadLocalUpdate,
    }) as never,
);

import { act, render } from "../../../test/render";
import { ToastProvider } from "../ui/toast";
import { DesktopAutoUpdateCoordinator } from "./DesktopAutoUpdateCoordinator";

const baseState: DesktopUpdateState = {
  enabled: true,
  status: "idle",
  channel: "latest",
  currentVersion: "0.1.12-t4.17",
  hostArch: "arm64",
  appArch: "arm64",
  runningUnderArm64Translation: false,
  availableVersion: null,
  downloadedVersion: null,
  releaseNotes: [],
  omittedReleaseCount: 0,
  downloadPercent: null,
  checkedAt: null,
  message: null,
  errorContext: null,
  canRetry: false,
  autoUpdateMode: "auto",
  autoInstallAt: null,
};

function publish(update: DesktopUpdateState | null) {
  return act(() => {
    mocks.update = update;
    mocks.notify();
  });
}

describe("DesktopAutoUpdateCoordinator", () => {
  it("pops an active downloaded reminder toast and a 1-minute countdown warning", async () => {
    mocks.installLocalUpdate.mockReset();
    mocks.downloadLocalUpdate.mockReset();
    const originalBridge = window.desktopBridge;
    Object.defineProperty(window, "desktopBridge", {
      value: { installUpdate: vi.fn(), downloadUpdate: vi.fn() },
      configurable: true,
    });
    try {
      mocks.update = {
        ...baseState,
        status: "downloaded",
        availableVersion: "0.1.12-t4.18",
        downloadedVersion: "0.1.12-t4.18",
        downloadPercent: 100,
        autoUpdateMode: "auto",
        autoInstallAt: "2099-01-01T12:00:00.000Z",
      };

      await using _screen = await render(
        <ToastProvider>
          <DesktopAutoUpdateCoordinator />
        </ToastProvider>,
      );

      await expect.element(page.getByText("Update 0.1.12-t4.18 downloaded")).toBeVisible();
      const installButton = page.getByRole("button", { name: "Install now" });
      await expect.element(installButton).toBeVisible();
      await userEvent.click(installButton);
      expect(mocks.installLocalUpdate).toHaveBeenCalledWith(
        window.desktopBridge,
        undefined,
        "0.1.12-t4.18",
      );

      // Move deadline inside the 60-second lead window to fire the imminent restart warning.
      await publish({
        ...baseState,
        status: "downloaded",
        availableVersion: "0.1.12-t4.18",
        downloadedVersion: "0.1.12-t4.18",
        downloadPercent: 100,
        autoUpdateMode: "auto",
        autoInstallAt: "2020-01-01T00:00:00.000Z",
      });
      await expect
        .element(page.getByText("Restarting in 1 minute to install 0.1.12-t4.18"))
        .toBeVisible();
    } finally {
      Object.defineProperty(window, "desktopBridge", {
        value: originalBridge,
        configurable: true,
      });
    }
  });
});
