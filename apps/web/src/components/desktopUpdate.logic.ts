import { desktopTrackMismatchText } from "@t3tools/client-runtime/state/server";
import type {
  DesktopAutoUpdateMode,
  DesktopBridge,
  DesktopUpdateActionResult,
  DesktopUpdateState,
} from "@t3tools/contracts";
import { desktopUpdateChannelOf } from "@t3tools/shared/cliRelease";
import { msg } from "gt-react";

import { m, type MessageResolver } from "../i18n/messages";
import { channelSwitchLabel } from "./sidebar/updateEverything.logic";

export type DesktopUpdateButtonAction = "download" | "install" | "none";

const DEFAULT_DESKTOP_RELEASE_REPOSITORY = "pingdotgg/t3code";
const GITHUB_REPOSITORY_SEGMENT = /^[A-Za-z0-9._-]+$/u;

function isValidRepositorySegment(value: string | undefined): value is string {
  return (
    value !== undefined && value !== "." && value !== ".." && GITHUB_REPOSITORY_SEGMENT.test(value)
  );
}

function desktopReleaseRepositoryUrl(repository: string | undefined): string {
  const configuredRepository = repository?.trim() ?? "";
  const [owner, name, ...extra] = configuredRepository.split("/");
  const releaseRepository =
    isValidRepositorySegment(owner) && isValidRepositorySegment(name) && extra.length === 0
      ? configuredRepository
      : DEFAULT_DESKTOP_RELEASE_REPOSITORY;
  return `https://github.com/${releaseRepository}/releases`;
}

/** The download RPC can beat the updater's downloadedVersion event; fall back to the requested version. */
export function getDesktopUpdateDownloadedVersion(state: DesktopUpdateState): string | null {
  return state.downloadedVersion ?? state.availableVersion;
}

export function getDesktopUpdateReleaseUrl(
  version: string | null,
  repository: string | undefined = import.meta.env.T3CODE_DESKTOP_UPDATE_REPOSITORY,
): string | null {
  const normalizedVersion = version?.trim();
  if (!normalizedVersion) return null;
  return `${desktopReleaseRepositoryUrl(repository)}/tag/v${encodeURIComponent(normalizedVersion)}`;
}

export function getDesktopUpdateReleaseHistoryUrl(
  repository: string | undefined = import.meta.env.T3CODE_DESKTOP_UPDATE_REPOSITORY,
): string {
  return desktopReleaseRepositoryUrl(repository);
}

export function resolveDesktopUpdateButtonAction(
  state: DesktopUpdateState,
): DesktopUpdateButtonAction {
  if (
    state.downloadedVersion &&
    (state.status === "downloaded" ||
      (state.status === "error" &&
        (state.errorContext === null || state.errorContext === "install")))
  ) {
    return "install";
  }
  if (state.status === "available") {
    return "download";
  }
  if (state.status === "error") {
    if (state.errorContext === "download" && state.availableVersion) {
      return "download";
    }
  }
  return "none";
}

export function shouldShowArm64IntelBuildWarning(state: DesktopUpdateState | null): boolean {
  return state?.hostArch === "arm64" && state.appArch === "x64";
}

export function isDesktopUpdateButtonDisabled(state: DesktopUpdateState | null): boolean {
  return state?.status === "downloading" || state?.installing === true;
}

export interface DesktopUpdateDownloadProgressMeta {
  readonly percent: number | null;
  readonly transferredLabel: string | null;
  readonly totalLabel: string | null;
  readonly speedLabel: string | null;
}

export function formatDesktopUpdateBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) {
    const kb = bytes / 1024;
    return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatDesktopUpdateSpeed(bytesPerSecond: number | null | undefined): string | null {
  if (
    typeof bytesPerSecond !== "number" ||
    !Number.isFinite(bytesPerSecond) ||
    bytesPerSecond <= 0
  ) {
    return null;
  }
  return `${formatDesktopUpdateBytes(bytesPerSecond)}/s`;
}

export function getDesktopUpdateDownloadProgressMeta(
  state: DesktopUpdateState | null,
): DesktopUpdateDownloadProgressMeta | null {
  if (state?.status !== "downloading") return null;
  const percent =
    typeof state.downloadPercent === "number" && Number.isFinite(state.downloadPercent)
      ? Math.min(100, Math.max(0, Math.floor(state.downloadPercent)))
      : null;
  const total =
    typeof state.downloadTotalBytes === "number" &&
    Number.isFinite(state.downloadTotalBytes) &&
    state.downloadTotalBytes > 0
      ? state.downloadTotalBytes
      : null;
  const transferred =
    total !== null &&
    typeof state.downloadTransferredBytes === "number" &&
    Number.isFinite(state.downloadTransferredBytes) &&
    state.downloadTransferredBytes >= 0
      ? Math.min(total, state.downloadTransferredBytes)
      : null;
  return {
    percent,
    transferredLabel: transferred !== null ? formatDesktopUpdateBytes(transferred) : null,
    totalLabel: total !== null ? formatDesktopUpdateBytes(total) : null,
    speedLabel: formatDesktopUpdateSpeed(state.downloadBytesPerSecond),
  };
}

export function getArm64IntelBuildWarningDescription(
  state: DesktopUpdateState,
  resolve: MessageResolver = m,
): string {
  if (!shouldShowArm64IntelBuildWarning(state)) {
    return resolve(msg("This install is using the correct architecture."));
  }

  const action = resolveDesktopUpdateButtonAction(state);
  if (action === "download") {
    return resolve(
      msg(
        "This Mac has Apple Silicon, but T4 Code is still running the Intel build under Rosetta. Download the available update to switch to the native Apple Silicon build.",
      ),
    );
  }
  if (action === "install") {
    return resolve(
      msg(
        "This Mac has Apple Silicon, but T4 Code is still running the Intel build under Rosetta. Restart to install the downloaded Apple Silicon build.",
      ),
    );
  }
  return resolve(
    msg(
      "This Mac has Apple Silicon, but T4 Code is still running the Intel build under Rosetta. The next app update will replace it with the native Apple Silicon build.",
    ),
  );
}

export function getDesktopUpdateButtonTooltip(
  state: DesktopUpdateState,
  resolve: MessageResolver = m,
): string {
  if (state.installing === true) {
    const version = getDesktopUpdateDownloadedVersion(state);
    return version
      ? resolve(msg("Restarting to install update {version}…", { version }))
      : resolve(msg("Restarting to install update…"));
  }
  if (
    state.notAppliedVersion !== undefined &&
    (state.status === "available" || state.status === "downloaded") &&
    getDesktopUpdateDownloadedVersion(state) === state.notAppliedVersion
  ) {
    return resolve(
      msg("Update {version} did not apply. Click to retry.", { version: state.notAppliedVersion }),
    );
  }
  if (
    (state.status === "available" || state.status === "error") &&
    state.errorContext === "download" &&
    state.availableVersion
  ) {
    return resolve(
      msg("Download failed for {version}. Click to retry.", { version: state.availableVersion }),
    );
  }
  if (state.status === "available") {
    return state.availableVersion === null
      ? resolve(msg("Update available ready to download"))
      : resolve(msg("Update {version} ready to download", { version: state.availableVersion }));
  }
  if (state.status === "downloading") {
    const percent =
      typeof state.downloadPercent === "number" ? Math.floor(state.downloadPercent) : null;
    const speed = formatDesktopUpdateSpeed(state.downloadBytesPerSecond);
    if (state.availableVersion) {
      if (percent !== null) {
        return speed !== null
          ? resolve(
              msg("Downloading update {version} ({percent}% · {speed})", {
                version: state.availableVersion,
                percent,
                speed,
              }),
            )
          : resolve(
              msg("Downloading update {version} ({percent}%)", {
                version: state.availableVersion,
                percent,
              }),
            );
      }
      return resolve(msg("Downloading update {version}", { version: state.availableVersion }));
    }
    if (percent !== null) {
      return speed !== null
        ? resolve(msg("Downloading update ({percent}% · {speed})", { percent, speed }))
        : resolve(msg("Downloading update ({percent}%)", { percent }));
    }
    return resolve(msg("Downloading update"));
  }
  if (state.status === "downloaded") {
    if (state.errorContext === "install" && state.downloadedVersion) {
      return resolve(
        msg("Install failed for {version}. Click to retry.", { version: state.downloadedVersion }),
      );
    }
    const version = state.downloadedVersion ?? state.availableVersion;
    return version === null
      ? resolve(msg("Update ready downloaded. Click to restart and install."))
      : resolve(msg("Update {version} downloaded. Click to restart and install.", { version }));
  }
  if (state.status === "error") {
    if (state.errorContext === "install" && state.downloadedVersion) {
      return resolve(
        msg("Install failed for {version}. Click to retry.", { version: state.downloadedVersion }),
      );
    }
    if (state.downloadedVersion) {
      return resolve(
        msg("Update {version} downloaded. Click to restart and install.", {
          version: state.downloadedVersion,
        }),
      );
    }
    if (state.trackMismatch !== undefined) {
      return resolve(
        desktopTrackMismatchText({
          buildChannel: state.trackMismatch.buildChannel,
          savedChannel: state.channel,
        }),
      );
    }
    return state.message ?? resolve(msg("Update failed"));
  }
  // The updater discards every release of the other track, so "up to date" would be false here.
  const buildChannel = desktopUpdateChannelOf(state.currentVersion);
  if (state.status === "up-to-date" && buildChannel !== state.channel) {
    return resolve(
      msg(
        "This {build} build ignores {track} releases. Review the update track in Settings to finish the switch.",
        {
          build: channelSwitchLabel(buildChannel, resolve),
          track: channelSwitchLabel(state.channel, resolve),
        },
      ),
    );
  }
  return resolve(msg("Up to date"));
}

export function getDesktopUpdateInstallConfirmationMessage(
  state: Pick<DesktopUpdateState, "availableVersion" | "downloadedVersion">,
  resolve: MessageResolver = m,
): string {
  const version = state.downloadedVersion ?? state.availableVersion;
  return version
    ? resolve(
        msg(
          "Install update {version} and restart T4 Code?\n\nAny running tasks will be interrupted. Make sure you're ready before continuing.",
          { version },
        ),
      )
    : resolve(
        msg(
          "Install update and restart T4 Code?\n\nAny running tasks will be interrupted. Make sure you're ready before continuing.",
        ),
      );
}

export function getDesktopUpdateActionError(result: DesktopUpdateActionResult): string | null {
  if (!result.accepted || result.completed) return null;
  if (typeof result.state.message !== "string") return null;
  const message = result.state.message.trim();
  return message.length > 0 ? message : null;
}

/**
 * macOS can refuse the restart after installUpdate resolves; the desktop then reports it as a
 * later state with errorContext "install". Success quits the app, so this never resolves then.
 */
export async function installDesktopUpdate(
  bridge: Pick<DesktopBridge, "installUpdate" | "onUpdateState">,
  expectedVersion?: string,
): Promise<DesktopUpdateActionResult> {
  let awaitingFailure = false;
  let reportFailure: (state: DesktopUpdateState) => void = () => {};
  const failure = new Promise<DesktopUpdateState>((resolve) => {
    reportFailure = resolve;
  });
  const unsubscribe = bridge.onUpdateState((state) => {
    if (awaitingFailure && state.errorContext === "install") reportFailure(state);
  });
  try {
    const result = await bridge.installUpdate(expectedVersion);
    if (!result.accepted || result.completed || getDesktopUpdateActionError(result) !== null) {
      return result;
    }
    awaitingFailure = true;
    return { ...result, state: await failure };
  } finally {
    unsubscribe();
  }
}

export function shouldToastDesktopUpdateActionResult(result: DesktopUpdateActionResult): boolean {
  return getDesktopUpdateActionError(result) !== null;
}

export function canCheckForUpdate(state: DesktopUpdateState | null): boolean {
  if (!state || !state.enabled || state.installing === true) return false;
  return (
    state.status !== "checking" && state.status !== "downloading" && state.status !== "disabled"
  );
}

/** `managedDenial` is this machine's policy refusing updates (`managedUpdatesDenial`); it wins. */
export function getDesktopUpdateDisabledReason(
  state: Pick<DesktopUpdateState, "enabled" | "status" | "message"> | null,
  managedDenial?: string,
  resolve: MessageResolver = m,
): string | null {
  if (managedDenial !== undefined) return managedDenial;
  if (!state || (state.enabled && state.status !== "disabled")) return null;
  return (
    state.message?.trim() || resolve(msg("Automatic updates are not available in this build."))
  );
}

export function formatDesktopAutoInstallTime(
  isoTimestamp: string | null | undefined,
): string | null {
  if (!isoTimestamp) return null;
  const parsed = Date.parse(isoTimestamp);
  if (Number.isNaN(parsed)) return null;
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(parsed));
}

export function getDesktopAutoUpdateModeLabel(
  mode: DesktopAutoUpdateMode,
  resolve: MessageResolver = m,
): string {
  switch (mode) {
    case "auto":
      return resolve(msg("Automatic"));
    case "notify":
      return resolve(msg("Download & notify"));
    case "manual":
      return resolve(msg("Manual"));
  }
}

export function getDesktopAutoUpdateModeDescription(
  mode: DesktopAutoUpdateMode,
  resolve: MessageResolver = m,
): string {
  switch (mode) {
    case "auto":
      return resolve(
        msg("Downloads updates automatically and installs when idle, locked, or after 2 hours."),
      );
    case "notify":
      return resolve(
        msg("Downloads updates in the background and notifies you when ready to install."),
      );
    case "manual":
      return resolve(msg("Checks for updates and waits for you to download and install them."));
  }
}

export function getDesktopUpdateAboutDescription(
  state: DesktopUpdateState | null,
  managedDenial?: string,
  resolve: MessageResolver = m,
): string {
  const disabledReason = getDesktopUpdateDisabledReason(state, managedDenial, resolve);
  if (disabledReason !== null) return disabledReason;
  if (!state) return resolve(msg("Current version of the application."));

  if (state.installing === true) {
    const version = getDesktopUpdateDownloadedVersion(state);
    return version
      ? resolve(msg("Restarting to install update {version}…", { version }))
      : resolve(msg("Restarting to install update…"));
  }

  if (state.status === "downloading") {
    const percent =
      typeof state.downloadPercent === "number" ? Math.floor(state.downloadPercent) : null;
    if (state.availableVersion) {
      return percent !== null
        ? resolve(
            msg("Downloading update {version} ({percent}%)", {
              version: state.availableVersion,
              percent,
            }),
          )
        : resolve(msg("Downloading update {version}", { version: state.availableVersion }));
    }
    return percent !== null
      ? resolve(msg("Downloading update ({percent}%)", { percent }))
      : resolve(msg("Downloading update"));
  }

  const formatReadyDescription = (version: string | null): string => {
    if (!version) return resolve(msg("Update ready to install."));
    if (state.autoUpdateMode === "auto") {
      const time = formatDesktopAutoInstallTime(state.autoInstallAt);
      if (time !== null) {
        return resolve(
          msg(
            "Update {version} is ready to install. Installs automatically when idle or by {time}.",
            { version, time },
          ),
        );
      }
    }
    return resolve(msg("Update {version} is ready to install.", { version }));
  };

  const action = resolveDesktopUpdateButtonAction(state);
  if (action === "install") {
    const version = getDesktopUpdateDownloadedVersion(state);
    if (state.errorContext === "install" && state.downloadedVersion) {
      return resolve(
        msg("Install failed for {version}. Click to retry.", { version: state.downloadedVersion }),
      );
    }
    if (state.notAppliedVersion !== undefined && version === state.notAppliedVersion) {
      return resolve(
        msg("Update {version} did not apply. Click to retry.", {
          version: state.notAppliedVersion,
        }),
      );
    }
    return formatReadyDescription(version);
  }

  if (action === "download") {
    if (
      state.notAppliedVersion !== undefined &&
      state.availableVersion === state.notAppliedVersion
    ) {
      return resolve(
        msg("Update {version} did not apply. Click to retry.", {
          version: state.notAppliedVersion,
        }),
      );
    }
    if (state.errorContext === "download" && state.availableVersion) {
      return resolve(
        msg("Download failed for {version}. Click to retry.", { version: state.availableVersion }),
      );
    }
    return state.availableVersion
      ? resolve(msg("Update {version} is available.", { version: state.availableVersion }))
      : resolve(msg("Update available."));
  }

  // Rechecks keep showing the downloaded version until a newer release replaces it.
  if (state.status === "checking" && state.downloadedVersion) {
    return formatReadyDescription(state.downloadedVersion);
  }

  return resolve(msg("Current version of the application."));
}

export function getDesktopUpdateIdleTooltip(
  state: Pick<DesktopUpdateState, "enabled" | "status" | "message"> | null,
  managedDenial?: string,
  resolve: MessageResolver = m,
) {
  const disabledReason = getDesktopUpdateDisabledReason(state, managedDenial, resolve);
  return disabledReason
    ? { title: resolve(msg("Updates unavailable")), detail: disabledReason }
    : { title: resolve(msg("Check for updates")), detail: null };
}
