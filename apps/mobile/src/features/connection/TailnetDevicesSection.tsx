import { useAtomValue } from "@effect/atom-react";
import { errorDisplayMessage } from "@t3tools/client-runtime/errors";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, TailnetDevice } from "@t3tools/contracts";
import { useGT } from "gt-react-native";
import { useState } from "react";
import { View } from "react-native";

import * as Dialog from "../../components/ui/Dialog";
import { ListActionRow } from "../../components/ui/ListActionRow";
import { m } from "../../i18n/messages";
import { useEnvironmentServerConfig } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { tailnetEnvironment } from "../../state/tailnet";
import { useAtomCommand } from "../../state/use-atom-command";
import { SettingsSection } from "../settings/components/SettingsSection";

const failureMessage = (result: Parameters<typeof squashAtomCommandFailure>[0]) => {
  const error = squashAtomCommandFailure(result);
  return error instanceof Error ? (errorDisplayMessage(error, m) ?? error.message) : String(error);
};

/**
 * Devices that signed in to a host through Tailscale, with Block and Unblock.
 * Block ends the device's sessions there and refuses its sign-in until Unblock.
 */
export function TailnetDevicesSection(props: {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
  /** Outer spacing. Defaults to the environment list's. */
  readonly className?: string;
}) {
  const gt = useGT();
  const config = useEnvironmentServerConfig(props.environmentId);
  const offered = config?.environment.capabilities.tailnetSignIn === true;
  const canManage = useAtomValue(
    tailnetEnvironment.blockDevice.permissionAtom(props.environmentId),
  );
  const listed = useEnvironmentQuery(
    offered && canManage
      ? tailnetEnvironment.devices({ environmentId: props.environmentId, input: {} })
      : null,
  );
  const blockDevice = useAtomCommand(tailnetEnvironment.blockDevice, { reportFailure: false });
  const unblockDevice = useAtomCommand(tailnetEnvironment.unblockDevice, { reportFailure: false });
  const [busyId, setBusyId] = useState<string | null>(null);
  const devices = listed.data?.devices ?? [];

  if (devices.length === 0) return null;

  const apply = async (device: TailnetDevice) => {
    setBusyId(device.stableNodeId);
    const input = {
      environmentId: props.environmentId,
      input: { stableNodeId: device.stableNodeId },
    };
    const result = await (device.blockedAt === null ? blockDevice(input) : unblockDevice(input));
    setBusyId(null);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      Dialog.alert(
        device.blockedAt === null ? gt("Could not block the device") : gt("Could not unblock it"),
        failureMessage(result),
      );
    }
  };

  const toggle = (device: TailnetDevice) => {
    const name = device.label ?? device.stableNodeId;
    if (device.blockedAt !== null) {
      void apply(device);
      return;
    }
    const currentNote = device.current
      ? gt(
          "This is the device you are using, so it loses Tailscale access to {environment} until it is unblocked.",
          { environment: props.environmentLabel },
        )
      : null;
    const body = gt(
      "Its Tailscale sessions on {environment} end now, and it cannot sign in through Tailscale until you unblock it. Sessions it made with a pairing code stay until you revoke them in Settings > Sharing & access on {environment}. A device that rejoins Tailscale gets a new ID, so block it again or remove it from your tailnet.",
      { environment: props.environmentLabel },
    );
    Dialog.confirm({
      title: gt("Block {name}?", { name }),
      message: `${currentNote ? `${currentNote} ` : ""}${body}`,
      confirmText: gt("Block"),
      destructive: true,
      onConfirm: () => void apply(device),
    });
  };

  return (
    <View className={props.className ?? "mt-5 gap-3"}>
      <SettingsSection
        title={gt("Tailscale devices on {environment}", { environment: props.environmentLabel })}
      >
        {devices.map((device) => (
          <ListActionRow
            key={device.stableNodeId}
            label={device.label ?? device.stableNodeId}
            description={
              device.current
                ? device.blockedAt !== null
                  ? gt("This device · Blocked")
                  : gt(
                      "This device · {count, plural, one {{count} session} other {{count} sessions}}",
                      { count: device.activeSessionCount },
                    )
                : device.blockedAt !== null
                  ? gt("Blocked")
                  : gt("{count, plural, one {{count} session} other {{count} sessions}}", {
                      count: device.activeSessionCount,
                    })
            }
            detail={device.blockedAt === null ? gt("Block") : gt("Unblock")}
            loading={busyId === device.stableNodeId}
            onPress={() => toggle(device)}
          />
        ))}
      </SettingsSection>
    </View>
  );
}
