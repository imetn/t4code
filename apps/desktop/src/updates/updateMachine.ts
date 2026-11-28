import type {
  DesktopRuntimeInfo,
  DesktopUpdateChannel,
  DesktopUpdateReleaseNote,
  DesktopUpdateState,
} from "@t3tools/contracts";

function nextStatusAfterDownloadFailure(
  currentState: DesktopUpdateState,
): DesktopUpdateState["status"] {
  return currentState.availableVersion ? "available" : "error";
}

// A mismatch describes only the check that found it, and `installing` only lasts while restarting.
function withoutTransientFlags({
  trackMismatch: _trackMismatch,
  installing: _installing,
  ...state
}: DesktopUpdateState): DesktopUpdateState {
  return state;
}

export interface DesktopUpdateDownloadProgress {
  readonly percent: number;
  readonly bytesPerSecond?: number | null;
  readonly transferredBytes?: number | null;
  readonly totalBytes?: number | null;
}

const CLEARED_DOWNLOAD_TELEMETRY = {
  downloadBytesPerSecond: null,
  downloadTransferredBytes: null,
  downloadTotalBytes: null,
} as const;

function getCanRetryAfterDownloadFailure(currentState: DesktopUpdateState): boolean {
  return currentState.availableVersion !== null;
}

export function createInitialDesktopUpdateState(
  currentVersion: string,
  runtimeInfo: DesktopRuntimeInfo,
  channel: DesktopUpdateChannel,
): DesktopUpdateState {
  return {
    enabled: false,
    status: "disabled",
    channel,
    currentVersion,
    hostArch: runtimeInfo.hostArch,
    appArch: runtimeInfo.appArch,
    runningUnderArm64Translation: runtimeInfo.runningUnderArm64Translation,
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
}

export function reduceDesktopUpdateStateOnCheckStart(
  state: DesktopUpdateState,
  checkedAt: string,
): DesktopUpdateState {
  const hasDownloadedUpdate = state.downloadedVersion !== null;
  return {
    ...withoutTransientFlags(state),
    status: "checking",
    checkedAt,
    releaseNotes: hasDownloadedUpdate ? state.releaseNotes : [],
    omittedReleaseCount: hasDownloadedUpdate ? state.omittedReleaseCount : 0,
    message: null,
    downloadPercent: hasDownloadedUpdate ? 100 : null,
    ...CLEARED_DOWNLOAD_TELEMETRY,
    errorContext: null,
    canRetry: false,
  };
}

export function reduceDesktopUpdateStateOnCheckFailure(
  state: DesktopUpdateState,
  message: string,
  checkedAt: string,
  trackMismatch?: DesktopUpdateState["trackMismatch"],
): DesktopUpdateState {
  if (state.downloadedVersion !== null) {
    return {
      ...withoutTransientFlags(state),
      status: "downloaded",
      message: null,
      checkedAt,
      downloadPercent: 100,
      ...CLEARED_DOWNLOAD_TELEMETRY,
      errorContext: null,
      canRetry: true,
    };
  }

  return {
    ...withoutTransientFlags(state),
    status: "error",
    message,
    checkedAt,
    downloadPercent: null,
    ...CLEARED_DOWNLOAD_TELEMETRY,
    errorContext: "check",
    canRetry: true,
    ...(trackMismatch === undefined ? {} : { trackMismatch }),
  };
}

export function reduceDesktopUpdateStateOnUpdateAvailable(
  state: DesktopUpdateState,
  version: string,
  checkedAt: string,
  releaseNotes: ReadonlyArray<DesktopUpdateReleaseNote> = [],
  omittedReleaseCount = 0,
): DesktopUpdateState {
  const isDownloadedVersion = state.downloadedVersion === version;
  const preserveReleaseNotes = isDownloadedVersion && releaseNotes.length === 0;
  return {
    ...withoutTransientFlags(state),
    status: isDownloadedVersion ? "downloaded" : "available",
    availableVersion: version,
    downloadedVersion: isDownloadedVersion ? version : null,
    releaseNotes: preserveReleaseNotes ? state.releaseNotes : releaseNotes,
    omittedReleaseCount: preserveReleaseNotes ? state.omittedReleaseCount : omittedReleaseCount,
    downloadPercent: isDownloadedVersion ? 100 : null,
    ...CLEARED_DOWNLOAD_TELEMETRY,
    checkedAt,
    message: null,
    errorContext: null,
    canRetry: isDownloadedVersion,
    ...(isDownloadedVersion ? {} : { autoInstallAt: null }),
  };
}

export function reduceDesktopUpdateStateOnNoUpdate(
  state: DesktopUpdateState,
  checkedAt: string,
): DesktopUpdateState {
  if (state.downloadedVersion !== null) {
    return {
      ...withoutTransientFlags(state),
      status: "downloaded",
      availableVersion: state.downloadedVersion,
      downloadPercent: 100,
      ...CLEARED_DOWNLOAD_TELEMETRY,
      checkedAt,
      message: null,
      errorContext: null,
      canRetry: true,
    };
  }

  return {
    ...withoutTransientFlags(state),
    status: "up-to-date",
    availableVersion: null,
    downloadedVersion: null,
    releaseNotes: [],
    omittedReleaseCount: 0,
    downloadPercent: null,
    ...CLEARED_DOWNLOAD_TELEMETRY,
    checkedAt,
    message: null,
    errorContext: null,
    canRetry: false,
    autoInstallAt: null,
  };
}

export function reduceDesktopUpdateStateOnDownloadStart(
  state: DesktopUpdateState,
  initialPercent: number | null = 0,
): DesktopUpdateState {
  return {
    ...withoutTransientFlags(state),
    status: "downloading",
    downloadPercent: initialPercent,
    ...CLEARED_DOWNLOAD_TELEMETRY,
    message: null,
    errorContext: null,
    canRetry: false,
    autoInstallAt: null,
  };
}

export function reduceDesktopUpdateStateOnDownloadFailure(
  state: DesktopUpdateState,
  message: string,
): DesktopUpdateState {
  return {
    ...withoutTransientFlags(state),
    status: nextStatusAfterDownloadFailure(state),
    message,
    downloadPercent: null,
    ...CLEARED_DOWNLOAD_TELEMETRY,
    errorContext: "download",
    canRetry: getCanRetryAfterDownloadFailure(state),
  };
}

export function reduceDesktopUpdateStateOnDownloadProgress(
  state: DesktopUpdateState,
  progress: number | DesktopUpdateDownloadProgress,
): DesktopUpdateState {
  const normalized: DesktopUpdateDownloadProgress =
    typeof progress === "number" ? { percent: progress } : progress;
  return {
    ...withoutTransientFlags(state),
    status: "downloading",
    downloadPercent: normalized.percent,
    downloadBytesPerSecond: normalized.bytesPerSecond ?? null,
    downloadTransferredBytes: normalized.transferredBytes ?? null,
    downloadTotalBytes: normalized.totalBytes ?? null,
    message: null,
    errorContext: null,
    canRetry: false,
  };
}

export function reduceDesktopUpdateStateOnDownloadComplete(
  state: DesktopUpdateState,
  version: string,
): DesktopUpdateState {
  return {
    ...withoutTransientFlags(state),
    status: "downloaded",
    availableVersion: version,
    downloadedVersion: version,
    downloadPercent: 100,
    ...CLEARED_DOWNLOAD_TELEMETRY,
    message: null,
    errorContext: null,
    canRetry: true,
  };
}

export function reduceDesktopUpdateStateOnDownloadLost(
  state: DesktopUpdateState,
): DesktopUpdateState {
  if (state.downloadedVersion === null) return state;
  return {
    ...withoutTransientFlags(state),
    status: "available",
    availableVersion: state.downloadedVersion,
    downloadedVersion: null,
    downloadPercent: null,
    ...CLEARED_DOWNLOAD_TELEMETRY,
    message: null,
    errorContext: null,
    canRetry: false,
    autoInstallAt: null,
  };
}

export function reduceDesktopUpdateStateOnInstallStart(
  state: DesktopUpdateState,
): DesktopUpdateState {
  return {
    ...withoutTransientFlags(state),
    status: "downloaded",
    installing: true,
    message: null,
    errorContext: null,
    canRetry: false,
  };
}

export function reduceDesktopUpdateStateOnInstallFailure(
  state: DesktopUpdateState,
  message: string,
): DesktopUpdateState {
  return {
    ...withoutTransientFlags(state),
    status: "downloaded",
    message,
    errorContext: "install",
    canRetry: true,
    autoInstallAt: null,
  };
}

export function clearDesktopUpdateInstallingFlag(state: DesktopUpdateState): DesktopUpdateState {
  if (state.installing !== true) return state;
  return {
    ...withoutTransientFlags(state),
    canRetry: state.downloadedVersion !== null,
  };
}

export interface DesktopUpdateInstallRecord {
  readonly fromVersion: string;
  readonly targetVersion: string;
}

export function resolveNotAppliedInstallVersion(
  record: DesktopUpdateInstallRecord,
  appVersion: string,
): string | null {
  return record.fromVersion === appVersion && record.targetVersion !== appVersion
    ? record.targetVersion
    : null;
}
