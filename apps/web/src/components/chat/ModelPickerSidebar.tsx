import { Toolbar } from "@base-ui/react/toolbar";
import { type ProviderInstanceId } from "@t3tools/contracts";
import { memo, type ReactNode } from "react";
import { msg, T, useMessages } from "gt-react";
import { StarIcon } from "lucide-react";
import { ProviderInstanceIcon } from "./ProviderInstanceIcon";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { cn } from "~/lib/utils";
import type { MessageResolver } from "../../i18n/messages";
import {
  isProviderInstancePickerReady,
  shouldShowInstanceBadge,
  type ProviderInstanceEntry,
} from "../../providerInstances";

function describeUnavailableInstance(
  entry: ProviderInstanceEntry,
  resolve: MessageResolver,
): string {
  const label = entry.displayName;
  if ((!entry.enabled && entry.isAvailable) || entry.status === "disabled") {
    return resolve(msg("{label}: Disabled in settings.", { label }));
  }
  if (entry.status === "ready" && entry.isAvailable) {
    return label;
  }
  const message = entry.snapshot.message?.trim();
  if (message) {
    return resolve(
      entry.status === "error"
        ? msg("{label}: Unavailable. {message}", { label, message })
        : entry.status === "warning"
          ? msg("{label}: Limited. {message}", { label, message })
          : msg("{label}: Not ready. {message}", { label, message }),
    );
  }
  return resolve(
    entry.status === "error"
      ? msg("{label}: Unavailable.", { label })
      : entry.status === "warning"
        ? msg("{label}: Limited.", { label })
        : msg("{label}: Not ready.", { label }),
  );
}

const PICKER_TOOLTIP_SIDE = "top" as const;
const PICKER_TOOLTIP_SIDE_OFFSET = 6;

export const ModelPickerSidebar = memo(function ModelPickerSidebar(props: {
  selectedInstanceId: ProviderInstanceId | "favorites";
  onSelectInstance: (instanceId: ProviderInstanceId | "favorites") => void;
  onFocusSearch: () => void;
  instanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  showFavorites?: boolean;
  disabledInstanceIds?: ReadonlySet<ProviderInstanceId>;
  selectableUnavailableInstanceIds?: ReadonlySet<ProviderInstanceId>;
  getDisabledInstanceTooltip?: (entry: ProviderInstanceEntry) => string;
  trailing?: ReactNode;
}) {
  const m = useMessages();
  const handleSelect = (instanceId: ProviderInstanceId | "favorites") => {
    props.onSelectInstance(instanceId);
  };
  const showFavorites = props.showFavorites ?? true;

  return (
    <Toolbar.Root
      className="flex h-11 w-full shrink-0 items-center justify-between gap-1.5 border-b border-border/70 bg-muted/35 px-2.5"
      data-model-picker-sidebar="true"
      aria-label={m(msg("Providers"))}
      orientation="horizontal"
      onKeyDown={(event) => {
        if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        if (event.key === "ArrowDown") {
          event.preventDefault();
          props.onFocusSearch();
        }
      }}
    >
      <div className="model-picker-scrollbar-none flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto overscroll-x-contain py-1">
        {showFavorites ? (
          <>
            <div className="shrink-0" data-model-picker-provider="favorites">
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Toolbar.Button
                      className={cn(
                        "relative isolate flex h-7.5 shrink-0 cursor-pointer items-center justify-center rounded-full text-foreground/70 transition-colors hover:bg-foreground/10 hover:text-foreground focus-visible:bg-foreground/10 focus-visible:outline-none",
                        props.selectedInstanceId === "favorites"
                          ? "gap-1.5 bg-background px-2.5 text-foreground shadow-2xs ring-1 ring-border/75 dark:bg-foreground/14 dark:ring-foreground/12"
                          : "w-7.5",
                      )}
                      onClick={() => handleSelect("favorites")}
                      type="button"
                      aria-label={m(msg("Favorites"))}
                      aria-pressed={props.selectedInstanceId === "favorites"}
                    >
                      <StarIcon
                        className={cn(
                          "size-4 shrink-0 fill-current",
                          props.selectedInstanceId === "favorites" && "text-warning",
                        )}
                        aria-hidden
                      />
                      {props.selectedInstanceId === "favorites" ? (
                        <span className="text-xs font-semibold leading-none">
                          <T>Favorites</T>
                        </span>
                      ) : null}
                    </Toolbar.Button>
                  }
                />
                <TooltipPopup
                  side={PICKER_TOOLTIP_SIDE}
                  sideOffset={PICKER_TOOLTIP_SIDE_OFFSET}
                  align="center"
                >
                  <T>Favorites</T>
                </TooltipPopup>
              </Tooltip>
            </div>
            <div className="mx-1 h-4 w-px shrink-0 bg-border/80" aria-hidden="true" />
          </>
        ) : null}

        {props.instanceEntries.map((entry) => {
          const isUnavailable = !isProviderInstancePickerReady(entry);
          const isContextDisabled = props.disabledInstanceIds?.has(entry.instanceId) ?? false;
          const unavailableSelectionIsReachable =
            props.selectableUnavailableInstanceIds?.has(entry.instanceId) ?? false;
          const isDisabled =
            (isUnavailable && !unavailableSelectionIsReachable) || isContextDisabled;
          const isSelected = props.selectedInstanceId === entry.instanceId;
          const showInstanceBadge = shouldShowInstanceBadge(entry, props.instanceEntries);

          const tooltip = isUnavailable
            ? describeUnavailableInstance(entry, m)
            : isContextDisabled
              ? (props.getDisabledInstanceTooltip?.(entry) ?? entry.displayName)
              : entry.displayName;

          const button = (
            <Toolbar.Button
              className={cn(
                "relative isolate flex h-7.5 shrink-0 cursor-pointer items-center justify-center rounded-full text-foreground/70 transition-colors hover:bg-foreground/10 hover:text-foreground focus-visible:bg-foreground/10 focus-visible:outline-none",
                isSelected
                  ? "gap-1.5 bg-background px-2.5 text-foreground shadow-2xs ring-1 ring-border/75 dark:bg-foreground/14 dark:ring-foreground/12"
                  : "w-7.5",
                isDisabled && "cursor-not-allowed opacity-45 hover:bg-transparent",
              )}
              data-provider-accent-color={entry.accentColor}
              onClick={() => !isDisabled && handleSelect(entry.instanceId)}
              disabled={isDisabled}
              focusableWhenDisabled={!isDisabled}
              aria-pressed={isSelected}
              type="button"
              aria-label={isUnavailable || isContextDisabled ? tooltip : entry.displayName}
            >
              <ProviderInstanceIcon
                driverKind={entry.driverKind}
                displayName={entry.displayName}
                accentColor={entry.accentColor}
                acpRegistryAgentId={entry.acpRegistryAgentId}
                acpRegistryIconUrl={entry.acpRegistryIconUrl}
                showBadge={showInstanceBadge}
                className="z-30 size-4"
                iconClassName="size-4"
                indicatorBackground={isSelected ? "var(--accent)" : "var(--popover)"}
                {...(entry.accentColor
                  ? { badgeClassName: "h-2.5 min-w-2.5 px-0.5 text-5xs" }
                  : {})}
              />
              {isSelected ? (
                <span className="max-w-24 truncate text-xs font-semibold leading-none">
                  {entry.displayName}
                </span>
              ) : null}
            </Toolbar.Button>
          );

          const trigger = isDisabled ? (
            <span className="relative inline-flex shrink-0">{button}</span>
          ) : (
            button
          );

          return (
            <div
              key={entry.instanceId}
              className="shrink-0"
              data-model-picker-provider={entry.instanceId}
            >
              <Tooltip>
                <TooltipTrigger render={trigger} />
                <TooltipPopup
                  side={PICKER_TOOLTIP_SIDE}
                  sideOffset={PICKER_TOOLTIP_SIDE_OFFSET}
                  align="center"
                >
                  {tooltip}
                </TooltipPopup>
              </Tooltip>
            </div>
          );
        })}
      </div>
      {props.trailing ? <div className="flex shrink-0 items-center">{props.trailing}</div> : null}
    </Toolbar.Root>
  );
});
