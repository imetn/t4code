import { describe, expect, it } from "vite-plus/test";
import type { DesktopUpdateState } from "@t3tools/contracts";

import {
  canCheckForUpdate,
  getDesktopAutoUpdateModeDescription,
  getDesktopAutoUpdateModeLabel,
  getDesktopUpdateAboutDescription,
  getDesktopUpdateButtonTooltip,
  getDesktopUpdateReleaseHistoryUrl,
  getDesktopUpdateActionError,
  getDesktopUpdateReleaseUrl,
  installDesktopUpdate,
  resolveDesktopUpdateButtonAction,
} from "./desktopUpdate.logic";

const baseState: DesktopUpdateState = {
  enabled: true,
  status: "idle",
  channel: "latest",
  currentVersion: "1.0.0",
  hostArch: "x64",
  appArch: "x64",
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

describe("desktop update button state", () => {
  it("keeps retry action available after a download error", () => {
    const state: DesktopUpdateState = {
      ...baseState,
      status: "error",
      availableVersion: "1.1.0",
      message: "network timeout",
      errorContext: "download",
      canRetry: true,
    };
    expect(resolveDesktopUpdateButtonAction(state)).toBe("download");
    expect(getDesktopUpdateButtonTooltip(state)).toContain("Click to retry");
  });

  it("shows the download failure after returning to available", () => {
    const state: DesktopUpdateState = {
      ...baseState,
      status: "available",
      availableVersion: "1.1.0",
      message: "network timeout",
      errorContext: "download",
      canRetry: true,
    };
    expect(resolveDesktopUpdateButtonAction(state)).toBe("download");
    expect(getDesktopUpdateButtonTooltip(state)).toBe("Download failed for 1.1.0. Click to retry.");
    expect(getDesktopUpdateButtonTooltip({ ...state, notAppliedVersion: "1.1.0" })).toBe(
      "Update 1.1.0 did not apply. Click to retry.",
    );
  });

  it("shows the install failure after the desktop returns to downloaded", () => {
    // reduceDesktopUpdateStateOnInstallFailure: a refused macOS install prompt lands here.
    const state: DesktopUpdateState = {
      ...baseState,
      status: "downloaded",
      availableVersion: "1.1.0",
      downloadedVersion: "1.1.0",
      message: "Desktop updater install operation reported an error.",
      errorContext: "install",
      canRetry: true,
    };
    expect(resolveDesktopUpdateButtonAction(state)).toBe("install");
    expect(getDesktopUpdateButtonTooltip(state)).toBe("Install failed for 1.1.0. Click to retry.");
  });

  it("reports an install the desktop refuses after accepting it", async () => {
    const downloaded: DesktopUpdateState = {
      ...baseState,
      status: "downloaded",
      availableVersion: "1.1.0",
      downloadedVersion: "1.1.0",
    };
    const failed: DesktopUpdateState = {
      ...downloaded,
      message: "OSStatus error -60006.",
      errorContext: "install",
      canRetry: true,
    };
    const listeners = new Set<(state: DesktopUpdateState) => void>();
    const emit = (state: DesktopUpdateState) => listeners.forEach((listener) => listener(state));
    const install = installDesktopUpdate({
      onUpdateState: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      installUpdate: async () => {
        // A retry's pre-install check can restore the previous failure before the restart starts.
        emit(failed);
        return { accepted: true, completed: false, state: downloaded };
      },
    });
    let settled = false;
    void install.then(() => {
      settled = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);
    emit(failed);
    const result = await install;
    expect(getDesktopUpdateActionError(result)).toBe("OSStatus error -60006.");
    expect(listeners.size).toBe(0);
  });

  it("never calls a build on the other track up to date", () => {
    // A Stable build whose switch to Nightly did not finish; the updater discards every release.
    const state: DesktopUpdateState = {
      ...baseState,
      status: "up-to-date",
      channel: "nightly",
      currentVersion: "0.1.5",
      checkedAt: "2026-11-18T00:00:00.000Z",
    };
    expect(getDesktopUpdateButtonTooltip(state)).not.toBe("Up to date");
    expect(
      getDesktopUpdateButtonTooltip({ ...state, currentVersion: "0.1.6-nightly.20261118.1" }),
    ).toBe("Up to date");
  });

  it("prefers a newly available release over a stale downloaded version", () => {
    const state: DesktopUpdateState = {
      ...baseState,
      status: "available",
      availableVersion: "1.2.0",
      downloadedVersion: "1.1.0",
    };
    expect(resolveDesktopUpdateButtonAction(state)).toBe("download");
  });

  it("includes the target version in downloading tooltips", () => {
    expect(
      getDesktopUpdateButtonTooltip({
        ...baseState,
        status: "downloading",
        availableVersion: "0.1.12-t4.18",
        downloadPercent: 42.9,
      }),
    ).toBe("Downloading update 0.1.12-t4.18 (42%)");
    expect(
      getDesktopUpdateButtonTooltip({
        ...baseState,
        status: "downloading",
        availableVersion: "0.1.12-t4.18",
        downloadPercent: null,
      }),
    ).toBe("Downloading update 0.1.12-t4.18");
    expect(
      getDesktopUpdateButtonTooltip({
        ...baseState,
        status: "downloading",
        availableVersion: null,
        downloadPercent: 18,
      }),
    ).toBe("Downloading update (18%)");
  });

  it("hides the install action while checking for a newer release", () => {
    const state: DesktopUpdateState = {
      ...baseState,
      status: "checking",
      availableVersion: "1.1.0",
      downloadedVersion: "1.1.0",
      downloadPercent: 100,
    };
    expect(resolveDesktopUpdateButtonAction(state)).toBe("none");
  });
});

describe("getDesktopUpdateAboutDescription", () => {
  it("shows the remote target version when an update is available", () => {
    expect(
      getDesktopUpdateAboutDescription({
        ...baseState,
        status: "available",
        availableVersion: "0.1.12-t4.18",
      }),
    ).toBe("Update 0.1.12-t4.18 is available.");
    expect(
      getDesktopUpdateAboutDescription({
        ...baseState,
        status: "available",
        availableVersion: null,
      }),
    ).toBe("Update available.");
  });

  it("shows the target version and download progress while downloading", () => {
    expect(
      getDesktopUpdateAboutDescription({
        ...baseState,
        status: "downloading",
        availableVersion: "0.1.12-t4.18",
        downloadPercent: 67.8,
      }),
    ).toBe("Downloading update 0.1.12-t4.18 (67%)");
    expect(
      getDesktopUpdateAboutDescription({
        ...baseState,
        status: "downloading",
        availableVersion: "0.1.12-t4.18",
        downloadPercent: null,
      }),
    ).toBe("Downloading update 0.1.12-t4.18");
    expect(
      getDesktopUpdateAboutDescription({
        ...baseState,
        status: "downloading",
        availableVersion: null,
        downloadPercent: 25,
      }),
    ).toBe("Downloading update (25%)");
    expect(
      getDesktopUpdateAboutDescription({
        ...baseState,
        status: "downloading",
        availableVersion: null,
        downloadPercent: null,
      }),
    ).toBe("Downloading update");
  });

  it("shows the downloaded target version when ready to install or rechecking", () => {
    expect(
      getDesktopUpdateAboutDescription({
        ...baseState,
        status: "downloaded",
        availableVersion: "0.1.12-t4.18",
        downloadedVersion: "0.1.12-t4.18",
      }),
    ).toBe("Update 0.1.12-t4.18 is ready to install.");
    expect(
      getDesktopUpdateAboutDescription({
        ...baseState,
        status: "checking",
        availableVersion: "0.1.12-t4.18",
        downloadedVersion: "0.1.12-t4.18",
      }),
    ).toBe("Update 0.1.12-t4.18 is ready to install.");
    expect(
      getDesktopUpdateAboutDescription({
        ...baseState,
        status: "downloaded",
        availableVersion: "0.1.12-t4.18",
        downloadedVersion: "0.1.12-t4.18",
        autoUpdateMode: "auto",
        autoInstallAt: "2026-11-28T12:00:00.000Z",
      }),
    ).toContain("Update 0.1.12-t4.18 is ready to install. Installs automatically when idle or by ");
  });

  it("formats automatic update mode labels and descriptions", () => {
    expect(getDesktopAutoUpdateModeLabel("auto")).toBe("Automatic");
    expect(getDesktopAutoUpdateModeLabel("notify")).toBe("Download & notify");
    expect(getDesktopAutoUpdateModeLabel("manual")).toBe("Manual");
    expect(getDesktopAutoUpdateModeDescription("auto")).toContain("2 hours");
    expect(getDesktopAutoUpdateModeDescription("notify")).toContain("notifies you");
    expect(getDesktopAutoUpdateModeDescription("manual")).toContain("waits for you");
  });

  it("surfaces retryable download, install, and not-applied errors with version", () => {
    expect(
      getDesktopUpdateAboutDescription({
        ...baseState,
        status: "error",
        availableVersion: "0.1.12-t4.18",
        errorContext: "download",
        canRetry: true,
      }),
    ).toBe("Download failed for 0.1.12-t4.18. Click to retry.");
    expect(
      getDesktopUpdateAboutDescription({
        ...baseState,
        status: "downloaded",
        availableVersion: "0.1.12-t4.18",
        downloadedVersion: "0.1.12-t4.18",
        errorContext: "install",
        canRetry: true,
      }),
    ).toBe("Install failed for 0.1.12-t4.18. Click to retry.");
    expect(
      getDesktopUpdateAboutDescription({
        ...baseState,
        status: "available",
        availableVersion: "0.1.12-t4.18",
        notAppliedVersion: "0.1.12-t4.18",
      }),
    ).toBe("Update 0.1.12-t4.18 did not apply. Click to retry.");
  });

  it("respects managed denial, disabled updates, and idle state", () => {
    expect(
      getDesktopUpdateAboutDescription(
        {
          ...baseState,
          status: "available",
          availableVersion: "0.1.12-t4.18",
        },
        "Updates are managed by your organization.",
      ),
    ).toBe("Updates are managed by your organization.");
    expect(
      getDesktopUpdateAboutDescription({
        ...baseState,
        enabled: false,
        status: "disabled",
      }),
    ).toBe("Automatic updates are not available in this build.");
    expect(getDesktopUpdateAboutDescription({ ...baseState, status: "up-to-date" })).toBe(
      "Current version of the application.",
    );
    expect(getDesktopUpdateAboutDescription(null)).toBe("Current version of the application.");
  });
});

describe("desktop update UI helpers", () => {
  it.each(["owner/repo/extra", "owner#notes/repo", "owner/repo?tab=notes"])(
    "falls back to upstream for an invalid configured repository: %s",
    (repository) => {
      expect(getDesktopUpdateReleaseHistoryUrl(repository)).toBe(
        "https://github.com/pingdotgg/t3code/releases",
      );
      expect(getDesktopUpdateReleaseUrl("1.2.3", repository)).toBe(
        "https://github.com/pingdotgg/t3code/releases/tag/v1.2.3",
      );
    },
  );
});

describe("canCheckForUpdate", () => {
  it("returns true once an update has been downloaded so newer releases can be found", () => {
    expect(
      canCheckForUpdate({
        ...baseState,
        status: "downloaded",
        availableVersion: "1.1.0",
        downloadedVersion: "1.1.0",
      }),
    ).toBe(true);
  });
});
