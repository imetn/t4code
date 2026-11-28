import type { DesktopAutoUpdateMode, DesktopUpdateState } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";

const mocks = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  return {
    update: null as DesktopUpdateState | null,
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

vi.mock(import("../../env"), async (importOriginal) => ({
  ...(await importOriginal()),
  isElectron: true,
}));

vi.mock(
  import("../../state/environments"),
  () =>
    ({
      useEnvironments: () => ({ environments: [] }),
      usePrimaryEnvironment: () => null,
      usePrimaryEnvironmentId: () => null,
      useEnvironmentProviders: () => [],
    }) as never,
);

vi.mock(
  import("../../state/managedPolicy"),
  () =>
    ({
      usePrimaryManagedPolicy: () => null,
    }) as never,
);

vi.mock(
  import("../sidebar/updateEverythingRun"),
  () =>
    ({
      useUpdateEverythingRun: () => null,
    }) as never,
);

vi.mock(
  import("../ProviderUpdatesAction"),
  () =>
    ({
      useCheckProviderUpdates: () => async () => {},
    }) as never,
);

import { act, render } from "../../../test/render";
import { AboutSettingsPanel } from "./SettingsPanels";

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
};

function publish(update: DesktopUpdateState | null) {
  return act(() => {
    mocks.update = update;
    mocks.notify();
  });
}

describe("AboutSettingsPanel version update status", () => {
  it("shows live download progress, speed, and ready-to-restart hierarchy across states", async () => {
    mocks.update = {
      ...baseState,
      status: "available",
      availableVersion: "0.1.12-t4.18",
    };

    await using _screen = await render(<AboutSettingsPanel />);

    await expect.element(page.getByText("Update 0.1.12-t4.18 is available.")).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Download" })).toBeVisible();

    await publish({
      ...baseState,
      status: "downloading",
      availableVersion: "0.1.12-t4.18",
      downloadPercent: 48.6,
      downloadBytesPerSecond: 4.2 * 1024 * 1024,
      downloadTransferredBytes: 52.4 * 1024 * 1024,
      downloadTotalBytes: 109.2 * 1024 * 1024,
    });
    await expect.element(page.getByText("Downloading update 0.1.12-t4.18 (48%)")).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Downloading 48%" })).toBeDisabled();
    const progressBar = page.getByRole("progressbar", { name: "Update download progress" });
    await expect.element(progressBar).toHaveAttribute("aria-valuenow", "48");
    await expect.element(page.getByText("52.4 MB / 109.2 MB")).toBeVisible();
    await expect.element(page.getByText("4.2 MB/s")).toBeVisible();

    await publish({
      ...baseState,
      status: "downloaded",
      availableVersion: "0.1.12-t4.18",
      downloadedVersion: "0.1.12-t4.18",
      downloadPercent: 100,
    });
    await expect.element(page.getByText("Update 0.1.12-t4.18 is ready to install.")).toBeVisible();
    await expect.element(page.getByText("Downloaded and ready to restart")).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Restart to Update" })).toBeVisible();
  });

  it("shows immediate loading feedback on download and restarts directly when no thread is running", async () => {
    let resolveDownload:
      | ((value: { accepted: boolean; completed: boolean; state: DesktopUpdateState }) => void)
      | undefined;
    const downloadUpdate = vi.fn(
      () =>
        new Promise<{ accepted: boolean; completed: boolean; state: DesktopUpdateState }>(
          (resolve) => {
            resolveDownload = resolve;
          },
        ),
    );
    let resolveInstall:
      | ((value: { accepted: boolean; completed: boolean; state: DesktopUpdateState }) => void)
      | undefined;
    const installUpdate = vi.fn(
      () =>
        new Promise<{ accepted: boolean; completed: boolean; state: DesktopUpdateState }>(
          (resolve) => {
            resolveInstall = resolve;
          },
        ),
    );
    const originalBridge = window.desktopBridge;
    Object.defineProperty(window, "desktopBridge", {
      value: {
        downloadUpdate,
        installUpdate,
        onUpdateState: () => () => {},
      },
      configurable: true,
    });

    try {
      mocks.update = {
        ...baseState,
        status: "available",
        availableVersion: "0.1.12-t4.19",
      };

      await using _screen = await render(<AboutSettingsPanel />);

      await userEvent.click(page.getByRole("button", { name: "Download" }));
      expect(downloadUpdate).toHaveBeenCalledTimes(1);
      await expect.element(page.getByRole("button", { name: "Starting…" })).toBeDisabled();
      await expect.element(page.getByText("Starting download for 0.1.12-t4.19…")).toBeVisible();
      await expect.element(page.getByText("Connecting to release server…")).toBeVisible();

      const downloadedState: DesktopUpdateState = {
        ...baseState,
        status: "downloaded",
        availableVersion: "0.1.12-t4.19",
        downloadedVersion: "0.1.12-t4.19",
        downloadPercent: 100,
      };
      await publish(downloadedState);
      resolveDownload?.({ accepted: true, completed: true, state: downloadedState });

      const restartButton = page.getByRole("button", { name: "Restart to Update" });
      await expect.element(restartButton).toBeEnabled();
      await userEvent.click(restartButton);
      expect(installUpdate).toHaveBeenCalledTimes(1);
      await expect.element(page.getByRole("button", { name: "Restarting…" })).toBeDisabled();
      await expect
        .element(page.getByText("Stopping services and restarting T4 Code…"))
        .toBeVisible();

      resolveInstall?.({ accepted: true, completed: true, state: downloadedState });
    } finally {
      Object.defineProperty(window, "desktopBridge", {
        value: originalBridge,
        configurable: true,
      });
    }
  });

  it("lets the user configure the automatic update mode from Settings -> About", async () => {
    const setAutoUpdateMode = vi.fn(async (mode: DesktopAutoUpdateMode) => {
      const next: DesktopUpdateState = {
        ...baseState,
        autoUpdateMode: mode,
      };
      await publish(next);
      return next;
    });
    const originalBridge = window.desktopBridge;
    Object.defineProperty(window, "desktopBridge", {
      value: { setAutoUpdateMode },
      configurable: true,
    });
    try {
      mocks.update = {
        ...baseState,
        autoUpdateMode: "auto",
      };
      await using _screen = await render(<AboutSettingsPanel />);

      const trigger = page.getByRole("combobox", { name: "Automatic updates" });
      await expect.element(trigger).toHaveTextContent("Automatic");
      await userEvent.click(trigger);
      await userEvent.click(page.getByRole("option", { name: "Download & notify" }));

      expect(setAutoUpdateMode).toHaveBeenCalledWith("notify");
      await expect.element(trigger).toHaveTextContent("Download & notify");
    } finally {
      Object.defineProperty(window, "desktopBridge", {
        value: originalBridge,
        configurable: true,
      });
    }
  });
});
