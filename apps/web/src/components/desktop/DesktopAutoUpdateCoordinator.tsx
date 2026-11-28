import { useGT } from "gt-react";
import { useEffect, useEffectEvent, useRef } from "react";

import { useDesktopUpdateState } from "../../state/desktopUpdate";
import {
  formatDesktopAutoInstallTime,
  getDesktopUpdateDownloadedVersion,
} from "../desktopUpdate.logic";
import { downloadLocalUpdate, installLocalUpdate } from "../sidebar/SidebarUpdatePill";
import { stackedThreadToast, toastManager } from "../ui/toast";

const FINAL_WARNING_LEAD_MS = 60_000;
const MAX_TIMEOUT_MS = 2_147_483_647;

/**
 * Surfaces active reminders when a desktop update is downloaded (or available in manual mode)
 * and shows a 1-minute countdown warning before an automatic forced restart.
 */
export function DesktopAutoUpdateCoordinator() {
  const gt = useGT();
  const state = useDesktopUpdateState();
  const announcedDownloadedRef = useRef<string | null>(null);
  const announcedAvailableRef = useRef<string | null>(null);
  const warnedImminentRef = useRef<string | null>(null);

  const status = state?.status ?? null;
  const autoUpdateMode = state?.autoUpdateMode ?? "auto";
  const autoInstallAt = state?.autoInstallAt ?? null;
  const errorContext = state?.errorContext ?? null;
  const notAppliedVersion = state?.notAppliedVersion ?? null;
  const availableVersion = state?.availableVersion ?? null;
  const downloadedVersion = state ? getDesktopUpdateDownloadedVersion(state) : null;

  const notifyDownloaded = useEffectEvent((version: string) => {
    const bridge = window.desktopBridge;
    const autoTime = autoUpdateMode === "auto" ? formatDesktopAutoInstallTime(autoInstallAt) : null;
    const description =
      autoUpdateMode === "auto"
        ? autoTime !== null
          ? gt("Installs automatically when idle or by {time}.", { time: autoTime })
          : gt("Installs automatically when idle, locked, or after 2 hours.")
        : gt("Restart T4 Code to finish installing.");
    const toastId = toastManager.add(
      stackedThreadToast({
        type: "info",
        title: gt("Update {version} downloaded", { version }),
        description,
        ...(bridge
          ? {
              actionProps: {
                children: gt("Install now"),
                onClick: () => {
                  toastManager.close(toastId);
                  void installLocalUpdate(bridge, undefined, version);
                },
              },
            }
          : {}),
      }),
    );
  });

  const notifyManualAvailable = useEffectEvent((version: string) => {
    const bridge = window.desktopBridge;
    const toastId = toastManager.add(
      stackedThreadToast({
        type: "info",
        title: gt("Update {version} is available.", { version }),
        description: gt("Download the latest version of T4 Code."),
        ...(bridge
          ? {
              actionProps: {
                children: gt("Download"),
                onClick: () => {
                  toastManager.close(toastId);
                  void downloadLocalUpdate(bridge, { notifyDownloaded: false });
                },
              },
            }
          : {}),
      }),
    );
  });

  const notifyImminentRestart = useEffectEvent((version: string) => {
    const bridge = window.desktopBridge;
    const toastId = toastManager.add(
      stackedThreadToast({
        type: "warning",
        title: gt("Restarting in 1 minute to install {version}", { version }),
        description: gt("T4 Code will restart automatically to apply the update."),
        ...(bridge
          ? {
              actionProps: {
                children: gt("Install now"),
                onClick: () => {
                  toastManager.close(toastId);
                  void installLocalUpdate(bridge, undefined, version);
                },
              },
            }
          : {}),
      }),
    );
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- pushes active toast reminders to the external toast manager when desktop updater state changes
  useEffect(() => {
    if (
      status === "downloaded" &&
      downloadedVersion !== null &&
      errorContext !== "install" &&
      notAppliedVersion !== downloadedVersion &&
      announcedDownloadedRef.current !== downloadedVersion
    ) {
      announcedDownloadedRef.current = downloadedVersion;
      notifyDownloaded(downloadedVersion);
      return;
    }

    if (
      status === "available" &&
      autoUpdateMode === "manual" &&
      availableVersion !== null &&
      errorContext !== "download" &&
      notAppliedVersion !== availableVersion &&
      announcedAvailableRef.current !== availableVersion
    ) {
      announcedAvailableRef.current = availableVersion;
      notifyManualAvailable(availableVersion);
    }
  }, [
    status,
    autoUpdateMode,
    availableVersion,
    downloadedVersion,
    errorContext,
    notAppliedVersion,
  ]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- schedules a browser timer for the 60-second warning before the desktop updater forces a restart
  useEffect(() => {
    if (
      status !== "downloaded" ||
      autoUpdateMode !== "auto" ||
      downloadedVersion === null ||
      autoInstallAt === null
    ) {
      return;
    }
    const deadlineMs = Date.parse(autoInstallAt);
    if (Number.isNaN(deadlineMs)) return;

    const fireWarning = () => {
      if (warnedImminentRef.current === downloadedVersion) return;
      warnedImminentRef.current = downloadedVersion;
      notifyImminentRestart(downloadedVersion);
    };

    let timer: number | undefined;
    const schedule = () => {
      const delayMs = deadlineMs - Date.now() - FINAL_WARNING_LEAD_MS;
      if (delayMs <= 0) {
        fireWarning();
        return;
      }
      timer = window.setTimeout(schedule, Math.min(delayMs, MAX_TIMEOUT_MS));
    };
    schedule();
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [status, autoUpdateMode, downloadedVersion, autoInstallAt]);

  return null;
}
