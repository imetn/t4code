import { TAILNET_SIGN_IN_PORT } from "@t3tools/client-runtime/connection";
import { type DesktopServerExposureState, TAILNET_APP_CAPABILITY } from "@t3tools/contracts";
import { T, useGT, Var } from "gt-react";
import { useState } from "react";

import { APP_DISPLAY_NAME } from "~/branding";
import { requestConfirmDialog } from "~/confirmDialog";
import { refreshDesktopNetworkAccessState } from "~/state/desktopNetworkAccess";
import { Switch } from "../ui/switch";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { SettingsRow } from "./settingsLayout";
import { useSearchableSetting } from "./settingsSearch";

/**
 * The desktop switch that lets this user's own Tailscale devices connect with no
 * code. The WSL backend never gets sign-in, so WSL only mode turns it off.
 */
export function TailscaleSignInRow({
  state,
  wslOnly,
  managed,
}: {
  readonly state: DesktopServerExposureState | null;
  readonly wslOnly: boolean;
  /** Why a managed policy keeps it off, if one does. */
  readonly managed: string | undefined;
}) {
  const gt = useGT();
  const searchableSetting = useSearchableSetting();
  const [isUpdating, setIsUpdating] = useState(false);
  const enabled = state?.tailscaleSignInEnabled === true && !wslOnly;
  const port = state?.port;
  const movedPort = enabled && port !== undefined && port !== TAILNET_SIGN_IN_PORT;

  const handleChange = async (next: boolean) => {
    const bridge = window.desktopBridge;
    if (!bridge) return;
    const confirmed = await requestConfirmDialog(
      next
        ? state?.mode === "network-accessible"
          ? gt(
              "Turn on Tailscale sign-in?\nYour own untagged Tailscale devices get full access with no pairing code. Once your tailnet policy grants {capability} here, or grants are required, only the devices it grants get in. {app} will restart.",
              { capability: TAILNET_APP_CAPABILITY, app: APP_DISPLAY_NAME },
            )
          : gt(
              "Turn on Tailscale sign-in?\nYour own untagged Tailscale devices get full access with no pairing code. Once your tailnet policy grants {capability} here, or grants are required, only the devices it grants get in. {app} accepts tailnet connections and refuses LAN connections. {app} will restart.",
              { capability: TAILNET_APP_CAPABILITY, app: APP_DISPLAY_NAME },
            )
        : gt(
            "Turn off Tailscale sign-in?\nDevices that signed in through Tailscale disconnect. {app} will restart.",
            { app: APP_DISPLAY_NAME },
          ),
    );
    if (confirmed !== true) return;
    setIsUpdating(true);
    try {
      await bridge.setTailscaleSignInEnabled(next);
      refreshDesktopNetworkAccessState();
    } catch (error) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: gt("Could not change Tailscale sign-in"),
          description: error instanceof Error ? error.message : gt("The setting was not saved."),
        }),
      );
    }
    setIsUpdating(false);
  };

  return (
    <SettingsRow
      title={searchableSetting("tailscale-sign-in").title}
      description={
        wslOnly
          ? gt("Not available while WSL only is on. Turn off WSL only to use it.")
          : enabled
            ? gt(
                "Devices your tailnet policy grants connect with no pairing code. While it grants no device here, so do your own untagged devices, unless grants are required.",
              )
            : gt(
                "Let devices your tailnet policy grants connect with no pairing code. While it grants no device here, your own untagged devices can too, unless grants are required.",
              )
      }
      status={
        movedPort ? (
          <span className="block text-destructive">
            <T>
              Port <Var>{TAILNET_SIGN_IN_PORT}</Var> is in use, so <Var>{APP_DISPLAY_NAME}</Var>{" "}
              runs on <Var>{port}</Var>. Other devices do not find it on their own; add it by name
              with :<Var>{port}</Var>.
            </T>
          </span>
        ) : null
      }
      control={
        <Switch
          checked={enabled}
          disabled={isUpdating || state === null || wslOnly}
          onCheckedChange={(checked) => void handleChange(checked)}
          aria-label={gt("Enable Tailscale sign-in")}
        />
      }
      managed={enabled ? undefined : managed}
    />
  );
}
