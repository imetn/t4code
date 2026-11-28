import type { DesktopUpdateState } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

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
  it("shows the remote target version across available, downloading, and downloaded states", async () => {
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
    });
    await expect.element(page.getByText("Downloading update 0.1.12-t4.18 (48%)")).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Downloading…" })).toBeDisabled();

    await publish({
      ...baseState,
      status: "downloaded",
      availableVersion: "0.1.12-t4.18",
      downloadedVersion: "0.1.12-t4.18",
      downloadPercent: 100,
    });
    await expect.element(page.getByText("Update 0.1.12-t4.18 is ready to install.")).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Install" })).toBeVisible();
  });
});
