import { describe, expect, it } from "vite-plus/test";

import {
  clearDesktopUpdateInstallingFlag,
  createInitialDesktopUpdateState,
  reduceDesktopUpdateStateOnCheckFailure,
  reduceDesktopUpdateStateOnCheckStart,
  reduceDesktopUpdateStateOnDownloadComplete,
  reduceDesktopUpdateStateOnDownloadFailure,
  reduceDesktopUpdateStateOnDownloadProgress,
  reduceDesktopUpdateStateOnDownloadStart,
  reduceDesktopUpdateStateOnInstallFailure,
  reduceDesktopUpdateStateOnInstallStart,
  reduceDesktopUpdateStateOnNoUpdate,
} from "./updateMachine.ts";

const runtimeInfo = {
  hostArch: "x64",
  appArch: "x64",
  runningUnderArm64Translation: false,
} as const;

describe("updateMachine", () => {
  it("preserves an already-downloaded update while checking the feed", () => {
    const downloadedState = {
      ...createInitialDesktopUpdateState("1.0.0", runtimeInfo, "latest"),
      enabled: true,
      status: "downloaded" as const,
      availableVersion: "1.1.0",
      downloadedVersion: "1.1.0",
      releaseNotes: [{ version: "1.1.0", items: ["fix: queued update"], totalItems: 1 }],
      omittedReleaseCount: 2,
      downloadPercent: 100,
    };
    const checking = reduceDesktopUpdateStateOnCheckStart(
      downloadedState,
      "2026-03-04T00:00:00.000Z",
    );
    const failed = reduceDesktopUpdateStateOnCheckFailure(
      checking,
      "network unavailable",
      "2026-03-04T00:00:01.000Z",
    );

    expect(checking.status).toBe("checking");
    expect(checking.downloadedVersion).toBe("1.1.0");
    expect(checking.releaseNotes).toEqual(downloadedState.releaseNotes);
    expect(checking.omittedReleaseCount).toBe(2);
    expect(failed.status).toBe("downloaded");
    expect(failed.downloadedVersion).toBe("1.1.0");
    expect(failed.releaseNotes).toEqual(downloadedState.releaseNotes);
    expect(failed.omittedReleaseCount).toBe(2);
    expect(failed.message).toBeNull();
  });

  it("preserves available version on download failure for retry", () => {
    const state = reduceDesktopUpdateStateOnDownloadFailure(
      {
        ...createInitialDesktopUpdateState("1.0.0", runtimeInfo, "latest"),
        enabled: true,
        status: "downloading",
        availableVersion: "1.1.0",
        downloadPercent: 43,
      },
      "checksum mismatch",
    );

    expect(state.status).toBe("available");
    expect(state.availableVersion).toBe("1.1.0");
    expect(state.errorContext).toBe("download");
    expect(state.canRetry).toBe(true);
  });

  it("transitions to downloaded and then preserves install retry state", () => {
    const downloaded = reduceDesktopUpdateStateOnDownloadComplete(
      {
        ...createInitialDesktopUpdateState("1.0.0", runtimeInfo, "latest"),
        enabled: true,
        status: "downloading",
        availableVersion: "1.1.0",
      },
      "1.1.0",
    );
    const failedInstall = reduceDesktopUpdateStateOnInstallFailure(
      downloaded,
      "backend shutdown timed out",
    );

    expect(downloaded.status).toBe("downloaded");
    expect(downloaded.downloadedVersion).toBe("1.1.0");
    expect(failedInstall.status).toBe("downloaded");
    expect(failedInstall.errorContext).toBe("install");
    expect(failedInstall.canRetry).toBe(true);
  });

  it("clears stale available state when no update is available", () => {
    const state = reduceDesktopUpdateStateOnNoUpdate(
      {
        ...createInitialDesktopUpdateState("1.0.0", runtimeInfo, "latest"),
        enabled: true,
        status: "error",
        availableVersion: "1.1.0",
        releaseNotes: [{ version: "1.1.0", items: ["fix: stale update"], totalItems: 1 }],
        omittedReleaseCount: 2,
        message: "old failure",
        errorContext: "download",
        canRetry: true,
      },
      "2026-03-04T00:00:00.000Z",
    );

    expect(state.status).toBe("up-to-date");
    expect(state.availableVersion).toBeNull();
    expect(state.downloadedVersion).toBeNull();
    expect(state.releaseNotes).toEqual([]);
    expect(state.omittedReleaseCount).toBe(0);
    expect(state.message).toBeNull();
    expect(state.errorContext).toBeNull();
  });

  it("tracks download speed and byte telemetry and clears them after completion", () => {
    const started = reduceDesktopUpdateStateOnDownloadStart(
      {
        ...createInitialDesktopUpdateState("1.0.0", runtimeInfo, "latest"),
        enabled: true,
        status: "available",
        availableVersion: "1.1.0",
      },
      null,
    );
    expect(started.status).toBe("downloading");
    expect(started.downloadPercent).toBeNull();
    expect(started.downloadBytesPerSecond).toBeNull();

    const progress = reduceDesktopUpdateStateOnDownloadProgress(started, {
      percent: 42.5,
      bytesPerSecond: 4_404_019,
      transferredBytes: 44_040_192,
      totalBytes: 104_857_600,
    });
    expect(progress.downloadPercent).toBe(42.5);
    expect(progress.downloadBytesPerSecond).toBe(4_404_019);
    expect(progress.downloadTransferredBytes).toBe(44_040_192);
    expect(progress.downloadTotalBytes).toBe(104_857_600);

    const downloaded = reduceDesktopUpdateStateOnDownloadComplete(progress, "1.1.0");
    expect(downloaded.downloadPercent).toBe(100);
    expect(downloaded.downloadBytesPerSecond).toBeNull();
    expect(downloaded.downloadTransferredBytes).toBeNull();
    expect(downloaded.downloadTotalBytes).toBeNull();
  });

  it("marks installing during restart and clears it on failure or cancellation", () => {
    const downloaded = {
      ...createInitialDesktopUpdateState("1.0.0", runtimeInfo, "latest"),
      enabled: true,
      status: "downloaded" as const,
      availableVersion: "1.1.0",
      downloadedVersion: "1.1.0",
      downloadPercent: 100,
    };
    const installing = reduceDesktopUpdateStateOnInstallStart(downloaded);
    expect(installing.installing).toBe(true);
    expect(installing.canRetry).toBe(false);

    const cleared = clearDesktopUpdateInstallingFlag(installing);
    expect(cleared.installing).toBeUndefined();
    expect(cleared.canRetry).toBe(true);

    const failed = reduceDesktopUpdateStateOnInstallFailure(installing, "restart refused");
    expect(failed.installing).toBeUndefined();
    expect(failed.errorContext).toBe("install");
    expect(failed.canRetry).toBe(true);
  });
});
