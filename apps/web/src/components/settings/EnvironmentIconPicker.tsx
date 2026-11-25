import {
  AuthSettingsWriteScope,
  ENVIRONMENT_MACHINE_KINDS,
  isEnvironmentMachineKind,
  resolveEnvironmentLabel,
  resolveEnvironmentMachineKind,
  type EnvironmentId,
  type ServerConfig,
} from "@t3tools/contracts";
import { PencilIcon } from "lucide-react";
import { msg, T, useGT, useMessages } from "gt-react";
import { useState } from "react";

import { m, type MessageResolver } from "../../i18n/messages";
import { useUpdateEnvironmentSettings } from "../../hooks/useSettings";
import { useEnvironmentScope } from "../../state/session";
import { ENVIRONMENT_MACHINE_KIND_LABELS, EnvironmentMachineIcon } from "../EnvironmentMachineIcon";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import {
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
} from "../ui/menu";

export function resolveEnvironmentIconPickerLock(
  input: {
    readonly serverConfig: Pick<ServerConfig, "environment"> | null;
    readonly operateAccess: "granted" | "denied" | "pending";
  },
  resolve: MessageResolver = m,
): string | null {
  if (input.serverConfig === null) {
    return resolve(msg("Connect to this environment to change its icon."));
  }
  if (input.operateAccess !== "granted") {
    return resolve(msg("Your session on this environment cannot change its settings."));
  }
  return null;
}

export function EnvironmentIconMenu({
  environmentId,
  serverConfig,
}: {
  readonly environmentId: EnvironmentId;
  readonly serverConfig: Pick<ServerConfig, "environment"> | null;
}) {
  const gt = useGT();
  const resolve = useMessages();
  const updateSettings = useUpdateEnvironmentSettings(environmentId);
  const operateAccess = useEnvironmentScope(environmentId, AuthSettingsWriteScope)
    ? "granted"
    : "denied";
  const lock = resolveEnvironmentIconPickerLock({ serverConfig, operateAccess }, resolve);
  const detected = serverConfig?.environment.platform.machine ?? "server";
  const resolved = resolveEnvironmentMachineKind(serverConfig);

  return (
    <MenuSub>
      <MenuSubTrigger>
        <EnvironmentMachineIcon kind={resolved} />
        <T>Icon</T>
      </MenuSubTrigger>
      <MenuSubPopup>
        {lock !== null ? (
          <>
            <MenuItem disabled className="whitespace-normal">
              {lock}
            </MenuItem>
            <MenuSeparator />
          </>
        ) : null}
        <MenuRadioGroup
          value={resolved}
          onValueChange={(next) => {
            if (lock !== null || !isEnvironmentMachineKind(next)) return;
            updateSettings({ environmentIcon: next === detected ? null : next });
          }}
        >
          {ENVIRONMENT_MACHINE_KINDS.map((kind) => (
            <MenuRadioItem key={kind} value={kind} disabled={lock !== null}>
              <span className="flex min-w-0 items-center gap-2">
                <EnvironmentMachineIcon kind={kind} className="size-3.5 shrink-0" />
                <span className="min-w-0 flex-1 truncate">
                  {resolve(ENVIRONMENT_MACHINE_KIND_LABELS[kind])}
                </span>
                {kind === detected ? (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {serverConfig?.environment.platform.machine
                      ? gt("detected", { $context: "machine kind detected automatically" })
                      : gt("default", { $context: "machine kind used when none is detected" })}
                  </span>
                ) : null}
              </span>
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuSubPopup>
    </MenuSub>
  );
}

export function EnvironmentRenameMenuItem({
  environmentId,
  serverConfig,
  onOpen,
}: {
  readonly environmentId: EnvironmentId;
  readonly serverConfig: Pick<ServerConfig, "environment" | "settings"> | null;
  readonly onOpen: () => void;
}) {
  const resolve = useMessages();
  const operateAccess = useEnvironmentScope(environmentId, AuthSettingsWriteScope)
    ? "granted"
    : "denied";
  const lock = resolveEnvironmentIconPickerLock({ serverConfig, operateAccess }, resolve);

  return (
    <MenuItem disabled={lock !== null} onClick={onOpen}>
      <PencilIcon />
      <T>Rename…</T>
    </MenuItem>
  );
}

export function EnvironmentRenameDialog({
  open,
  onOpenChange,
  environmentId,
  serverConfig,
  fallbackLabel,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly environmentId: EnvironmentId;
  readonly serverConfig: Pick<ServerConfig, "environment" | "settings"> | null;
  readonly fallbackLabel?: string | undefined;
}) {
  const gt = useGT();
  const updateSettings = useUpdateEnvironmentSettings(environmentId);
  const currentLabel = resolveEnvironmentLabel(serverConfig, fallbackLabel);
  const systemLabel = serverConfig?.environment.label ?? fallbackLabel ?? "";
  const hasCustomLabel = Boolean(serverConfig?.settings?.environmentLabel?.trim());
  const [draft, setDraft] = useState(currentLabel);
  const [lastOpen, setLastOpen] = useState(open);

  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) setDraft(currentLabel);
  }

  const commit = () => {
    const trimmed = draft.trim();
    updateSettings({
      environmentLabel: trimmed.length === 0 || trimmed === systemLabel ? null : trimmed,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            <T>Rename environment</T>
          </DialogTitle>
          <DialogDescription>
            {systemLabel
              ? gt("Leave empty to use the system name ({systemLabel}).", { systemLabel })
              : gt("Set a custom display name for this computer.")}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <form
            id={`rename-environment-${environmentId}`}
            onSubmit={(event) => {
              event.preventDefault();
              commit();
            }}
          >
            <Input
              autoFocus
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={systemLabel || gt("Computer name")}
              aria-label={gt("Environment name")}
            />
          </form>
        </DialogPanel>
        <DialogFooter>
          {hasCustomLabel ? (
            <Button
              type="button"
              variant="ghost"
              className="me-auto"
              onClick={() => {
                updateSettings({ environmentLabel: null });
                onOpenChange(false);
              }}
            >
              <T>Reset to system name</T>
            </Button>
          ) : null}
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            <T>Cancel</T>
          </Button>
          <Button type="submit" form={`rename-environment-${environmentId}`}>
            <T>Save</T>
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
