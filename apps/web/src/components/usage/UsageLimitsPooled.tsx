import {
  CHATGPT_USAGE_URL,
  collectHttpQuotaSources,
  collectLimitAccounts,
  collectLimitPools,
  displayLimitWindows,
  type LimitAccount,
  type LimitPool,
  type LimitPoolMember,
  type LimitPoolWindow,
  moveLimitPool,
  orderLimitPools,
  paceRemainingPercent,
  remainingPercent,
  type ResetCreditChoice,
} from "@t3tools/shared/usageLimits";
import { T, Var, useGT, useMessages } from "gt-react";
import type { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { normalizeProviderAccentColor } from "@t3tools/client-runtime/state/provider-instance-display";
import {
  AlertTriangleIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  ExternalLinkIcon,
  MoreHorizontalIcon,
  TicketIcon,
} from "lucide-react";
import {
  createContext,
  Fragment,
  type ReactNode,
  type RefObject,
  use,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { ensureLocalApi } from "../../localApi";
import { usePrimarySettings } from "../../hooks/useSettings";
import { cn } from "../../lib/utils";
import { formatUpcomingTimestamp } from "../../timestampFormat";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { providerClients } from "../settings/providerDriverMeta";
import { RedactedSensitiveText } from "../settings/RedactedSensitiveText";
import { Button } from "../ui/button";
import { OpenAI } from "../Icons";
import { Alert, AlertTitle } from "../ui/alert";
import {
  Menu,
  MenuCheckboxItem,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { Popover, PopoverCreateHandle, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { PaceIcon, ResetCreditDialog, barColor, usePaceMark, useResetCredit } from "./UsageLimits";
import {
  appendLimitHistory,
  buildPaceCurveModel,
  clearHiddenLimitWindowsForDriver,
  limitWindowVisibilityKey,
  readLimitHistory,
  recordUsageLimitHistory,
  toggleHiddenLimitWindow,
  type LimitHistoryStore,
  type PaceCurveModel,
} from "./usageLimitHistory";
import type { UsageLimitsViewMode } from "./usagePagePreferences";
import {
  collectExternalUsageLinks,
  collectLimitNotices,
  cursorUsageWindowDetails,
  formatDuration,
  formatResetsIn,
  resetCreditChoices,
} from "@t3tools/shared/usageLimitsCopy";

function accountInitials(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  return `${local[0] ?? ""}${domain[0] ?? ""}`.toUpperCase() || "?";
}

function accountHue(email: string): number {
  let hash = 0;
  for (let index = 0; index < email.length; index += 1) {
    hash = (hash * 31 + email.charCodeAt(index)) | 0;
  }
  return Math.abs(hash) % 360;
}

function AccountChip({ email }: { readonly email: string }) {
  const hue = accountHue(email);
  const gt = useGT();
  return (
    <span
      role="img"
      aria-label={gt("Account {initials}", { initials: accountInitials(email) })}
      className="inline-flex size-4 shrink-0 items-center justify-center rounded-full text-3xs leading-none font-semibold"
      style={{ backgroundColor: `oklch(0.85 0.08 ${hue})`, color: `oklch(0.35 0.1 ${hue})` }}
    >
      {accountInitials(email)}
    </span>
  );
}

function AccountAvatar({
  account,
  className,
}: {
  readonly account: LimitAccount;
  readonly className?: string;
}) {
  if (account.redeem) {
    return (
      <ProviderInstanceIcon
        driverKind={account.driver}
        displayName={
          account.displayName ??
          providerClients.get(account.driver)?.label ??
          String(account.driver)
        }
        accentColor={account.accentColor}
        showBadge={Boolean(account.displayName)}
        indicatorBackground="var(--popover)"
        className={cn("size-5", className)}
        iconClassName="size-4 text-foreground/80"
      />
    );
  }
  return account.email ? <AccountChip email={account.email} /> : null;
}

function AccountName({
  account,
  className,
}: {
  readonly account: LimitAccount;
  readonly className?: string;
}) {
  if (account.displayName) return <span className={className}>{account.displayName}</span>;
  if (account.email) {
    return (
      <span className={cn("inline-flex min-w-0 items-center", className)}>
        <AccountChip email={account.email} />
      </span>
    );
  }
  return (
    <span className={className}>
      {providerClients.get(account.driver)?.label ?? String(account.driver)}
    </span>
  );
}

function Row({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 text-foreground tabular-nums">{children}</span>
    </div>
  );
}

function SegmentPopover({
  account,
  window,
  reset,
  now,
  redeem,
  onRedeem,
}: {
  readonly account: LimitAccount;
  readonly window: LimitPoolMember["window"];
  readonly reset: LimitPoolWindow["resets"][number] | undefined;
  readonly now: number;
  readonly redeem: ReturnType<typeof useResetCredit> | null;
  readonly onRedeem: (choice: ResetCreditChoice) => void;
}) {
  const timestampFormat = usePrimarySettings((settings) => settings.timestampFormat);
  const gt = useGT();
  const m = useMessages();
  const remaining = remainingPercent(window);
  const timeLeft = paceRemainingPercent(window, now);
  const resetsIn = formatResetsIn(window, now, m, "in");
  const where =
    account.environments.length > 0
      ? account.environments.map((environment) => environment.label).join(", ")
      : account.sourceLabel;
  const choices =
    redeem && account.redeem && account.limits.resetCredits?.availableCount
      ? resetCreditChoices(account.limits.resetCredits, account.redeem.input, now, true, m)
      : [];
  return (
    <div className="flex w-72 max-w-[calc(100vw-3rem)] flex-col gap-2.5 text-xs">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="flex items-center gap-2 text-sm font-medium text-foreground">
          <AccountAvatar account={account} />
          <span className="truncate">
            {account.displayName ?? providerClients.get(account.driver)?.label ?? account.driver}
          </span>
        </span>
        {account.email ? (
          <RedactedSensitiveText
            value={account.email}
            ariaLabel={gt("Toggle account email visibility")}
            revealTooltip={gt("Click to reveal email")}
            hideTooltip={gt("Click to hide email")}
            className="w-fit"
          />
        ) : null}
      </div>
      <div className="flex flex-col gap-1 border-t border-border/60 pt-2.5">
        {account.plan ? (
          <Row label={gt("Plan", { $context: "subscription plan" })}>{account.plan}</Row>
        ) : null}
        {where ? (
          <Row
            label={
              account.environments.length > 0
                ? gt("Signed in")
                : gt("Via", { $context: "signed in through a source" })
            }
          >
            {where}
          </Row>
        ) : null}
      </div>
      <div className="flex flex-col gap-1 border-t border-border/60 pt-2.5">
        <Row label={gt("Left", { $context: "remaining usage" })}>{remaining}%</Row>
        {window.resetsAt ? (
          <Row label={gt("Resets", { $context: "when the usage window resets" })}>
            {formatUpcomingTimestamp(window.resetsAt, timestampFormat, now, undefined, m)}
            {resetsIn ? ` · ${resetsIn}` : ""}
          </Row>
        ) : null}
        {timeLeft !== null ? (
          <Row label={gt("Even pace")}>{gt("{timeLeft}% left by now", { timeLeft })}</Row>
        ) : null}
        {reset && reset.restoresPercent > 0 ? (
          <Row label={gt("Restores", { $context: "a reset credit restores part of the pool" })}>
            {gt("+{percent}% of pool", { percent: reset.restoresPercent })}
          </Row>
        ) : null}
      </div>
      {choices.length > 0 && redeem ? (
        <div className="flex flex-col gap-1.5 border-t border-border/60 pt-2.5 text-muted-foreground">
          {choices.map((choice) => (
            <span key={choice.key} className="flex items-center gap-3">
              <span className="tabular-nums">{choice.summary}</span>
              {choice.availableCount > 0 ? (
                <Button
                  size="xs"
                  variant="outline"
                  disabled={redeem.busy || !redeem.canManageProviders}
                  className="ms-auto"
                  onClick={() => onRedeem(choice)}
                >
                  {redeem.busy ? gt("Using…") : choice.actionLabel}
                </Button>
              ) : null}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Every segment on the page shares one popover, so hovering or clicking another
 * segment moves it instead of opening a second one. The payload is the segment
 * it currently describes.
 */
type SegmentPayload = Omit<Parameters<typeof SegmentPopover>[0], "now" | "onRedeem">;
const SegmentPopoverContext = createContext<ReturnType<
  typeof PopoverCreateHandle<SegmentPayload>
> | null>(null);

function ActiveSegmentPopover({
  handle,
  actions,
  payload,
  pools,
  now,
}: {
  readonly handle: ReturnType<typeof PopoverCreateHandle<SegmentPayload>>;
  readonly actions: RefObject<PopoverPrimitive.Root.Actions | null>;
  readonly payload: SegmentPayload;
  readonly pools: readonly LimitPool[];
  readonly now: number;
}) {
  const available = pools.some((pool) =>
    displayLimitWindows(pool).some((window) =>
      window.members.some(
        (member) =>
          member.account.key === payload.account.key &&
          member.window.id === payload.window.id &&
          member.window.kind === payload.window.kind &&
          Boolean(member.account.redeem) === Boolean(payload.redeem),
      ),
    ),
  );
  // The trigger is gone, so the popup has nothing to anchor to: an exit transition would
  // slide it to the viewport origin. Unmount it outright, which also clears Base UI's
  // active-trigger bookkeeping so the segment can open again when it comes back.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- closes the popover handle and unmounts the Base UI popup before paint when its trigger is gone
  useLayoutEffect(() => {
    if (available) return;
    handle.close();
    actions.current?.unmount();
  }, [available, handle, actions]);
  return (
    <PopoverPopup side="top" sideOffset={6}>
      <SegmentPopover
        {...payload}
        now={now}
        onRedeem={(choice) => {
          handle.close();
          payload.redeem?.confirm(choice);
        }}
      />
    </PopoverPopup>
  );
}

/**
 * The confirm is a sibling of the popover, not a child: dialogs stack under
 * popovers, and the popover closes as the confirm opens.
 */
function PoolSegment({
  account,
  ...props
}: {
  readonly account: LimitAccount;
  readonly window: LimitPoolMember["window"];
  readonly reset: LimitPoolWindow["resets"][number] | undefined;
  readonly refillPercent: number;
  readonly color: string;
  readonly now: number;
  readonly index: number;
  readonly showAccountName: boolean;
  readonly compact?: boolean | undefined;
}) {
  return account.redeem ? (
    <RedeemableSegment account={account} redeemAt={account.redeem} {...props} />
  ) : (
    <SegmentTriggers account={account} redeem={null} {...props} />
  );
}

function RedeemableSegment({
  redeemAt,
  ...props
}: Omit<Parameters<typeof SegmentTriggers>[0], "redeem"> & {
  readonly redeemAt: NonNullable<LimitAccount["redeem"]>;
}) {
  const redeem = useResetCredit(redeemAt.environmentId);
  const gt = useGT();
  return (
    <>
      <SegmentTriggers redeem={redeem} {...props} />
      <ResetCreditDialog
        open={redeem.confirming}
        onOpenChange={redeem.setConfirming}
        choice={redeem.choice}
        onConfirm={() => void redeem.redeem()}
        disabled={!redeem.canManageProviders}
      />
      {/* The popover closed before the confirm, so progress and the outcome need a home outside it. */}
      {redeem.busy || redeem.status ? (
        <span role="status" className="col-span-full text-xs text-muted-foreground">
          <AccountName account={props.account} className="font-medium text-foreground" />{" "}
          {redeem.busy ? gt("Using reset credit…") : redeem.status}
        </span>
      ) : null}
    </>
  );
}

function SegmentTriggers({
  account,
  window,
  reset,
  redeem,
  refillPercent,
  color,
  now,
  index,
  showAccountName,
  compact = false,
}: SegmentPayload & {
  readonly refillPercent: number;
  readonly color: string;
  readonly now: number;
  readonly index: number;
  readonly showAccountName: boolean;
  readonly compact?: boolean | undefined;
}) {
  const popover = use(SegmentPopoverContext) ?? undefined;
  const payload: SegmentPayload = { account, window, reset, redeem };
  const remaining = remainingPercent(window);
  const timeLeft = paceRemainingPercent(window, now);
  const [segmentRef, paceMark] = usePaceMark(timeLeft);
  const m = useMessages();
  const resetsIn = formatResetsIn(window, now, m);
  const refillIn = formatResetsIn(window, now, m, "refill");
  const credits = account.limits.resetCredits?.availableCount ?? 0;
  const gt = useGT();
  const segmentLabel = [
    gt("{name}: {remaining}% left", {
      name:
        account.displayName ?? (account.email ? accountInitials(account.email) : account.driver),
      remaining,
    }),
    resetsIn,
    timeLeft === null ? null : gt("{timeLeft}% of the window left", { timeLeft }),
    credits
      ? gt(
          "{count, plural, one {{count} reset credit banked} other {{count} reset credits banked}}",
          { count: credits },
        )
      : null,
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <>
      <PopoverTrigger
        handle={popover}
        payload={payload}
        openOnHover
        render={
          <button
            ref={segmentRef}
            type="button"
            style={{ gridColumn: index, gridRow: 1, ...paceMark?.gappedTrack }}
            aria-label={segmentLabel}
            className={cn(
              "relative min-w-0 cursor-pointer bg-muted text-start outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background data-[popup-open]:ring-1 data-[popup-open]:ring-inset data-[popup-open]:ring-border",
              compact ? "h-2 rounded-full" : "h-5 rounded-md @2xl/pool:h-8",
            )}
          />
        }
      >
        <div
          aria-hidden
          className={cn(
            "absolute inset-0 overflow-hidden",
            compact ? "rounded-full" : "rounded-md",
          )}
        >
          {/* Clipped inside the rounded clip so the bar's own corners keep their antialiasing. */}
          <div className="absolute inset-0" style={paceMark?.gap}>
            <div
              aria-hidden
              className={cn(
                "absolute inset-y-0 left-0",
                compact ? "rounded-full opacity-80" : "rounded-md opacity-35",
              )}
              style={{ width: `${remaining}%`, backgroundColor: color }}
            />
            {remaining < 100 && reset && refillPercent > 0 ? (
              <div
                aria-hidden
                className="absolute inset-y-0 right-0 opacity-25"
                style={{
                  width: `${Math.min(100 - remaining, refillPercent)}%`,
                  // A bare 45° gradient repeats every 5√2px, so some stripes rasterize thinner; a whole-pixel tile doesn't.
                  backgroundImage: `repeating-linear-gradient(135deg, transparent 0 1px, ${color} 1px 2px, transparent 2px 50%)`,
                  backgroundSize: "7px 7px",
                }}
              />
            ) : null}
          </div>
        </div>
        {paceMark ? (
          <span
            aria-hidden
            className={cn(
              "absolute w-0.5 -translate-x-1/2 rounded-full bg-foreground",
              compact ? "-inset-y-0.5" : "inset-y-0.5",
            )}
            style={paceMark.tick}
          />
        ) : null}
        {compact ? null : (
          <>
            <span
              aria-hidden
              className="absolute inset-0 flex items-center justify-center overflow-hidden rounded-md text-3xs leading-none font-semibold text-foreground/80 tabular-nums @2xl/pool:hidden"
            >
              {index}
            </span>
            <div className="relative hidden h-full min-w-0 items-center gap-1.5 overflow-hidden rounded-md px-2 text-xs @2xl/pool:flex">
              {showAccountName ? (
                <AccountName
                  account={account}
                  className="min-w-0 truncate font-medium text-foreground"
                />
              ) : null}
              {/* A single-account bar repeats the headline percentage. */}
              {showAccountName ? (
                <span className="shrink-0 font-semibold text-foreground tabular-nums">
                  {remaining}%
                </span>
              ) : null}
              {resetsIn || credits ? (
                <span className="ms-auto flex min-w-0 items-center gap-1.5 overflow-hidden rounded-sm bg-background/85 px-1.5 py-0.5 text-2xs whitespace-nowrap text-foreground tabular-nums">
                  {refillIn ?? ""}
                  {credits ? (
                    <>
                      {resetsIn ? (
                        <span aria-hidden className="text-muted-foreground">
                          ·
                        </span>
                      ) : null}
                      <span aria-hidden className="inline-flex items-center gap-0.5 font-semibold">
                        <TicketIcon className="size-3" aria-hidden />
                        {credits}
                      </span>
                    </>
                  ) : null}
                </span>
              ) : null}
            </div>
          </>
        )}
      </PopoverTrigger>
      {compact ? null : <LegendRow payload={payload} color={color} now={now} index={index} />}
    </>
  );
}

function LegendRow({
  payload,
  color,
  now,
  index,
}: {
  readonly payload: SegmentPayload;
  readonly color: string;
  readonly now: number;
  readonly index: number;
}) {
  const popover = use(SegmentPopoverContext) ?? undefined;
  const { account, window } = payload;
  const remaining = remainingPercent(window);
  const m = useMessages();
  const resetsIn = formatResetsIn(window, now, m, "refill");
  const credits = account.limits.resetCredits?.availableCount ?? 0;
  const gt = useGT();
  return (
    <PopoverTrigger
      handle={popover}
      payload={payload}
      style={{ gridColumn: "1 / -1", gridRow: index + 1 }}
      render={<Button variant="ghost" size="compact" />}
      className="min-w-0 @2xl/pool:hidden"
    >
      <span className="relative inline-flex size-4 shrink-0 items-center justify-center rounded-sm text-3xs leading-none font-semibold text-foreground/80 tabular-nums">
        <span
          aria-hidden
          className="absolute inset-0 rounded-sm opacity-35"
          style={{ backgroundColor: color }}
        />
        <span className="sr-only">{`${gt("Segment")} `}</span>
        <span className="relative">{index}</span>
      </span>
      <AccountName account={account} className="min-w-0 truncate font-medium text-foreground" />
      <span className="shrink-0 font-semibold text-foreground tabular-nums">{remaining}%</span>
      <span className="ms-auto flex shrink-0 items-center gap-1.5 text-2xs text-muted-foreground tabular-nums">
        {resetsIn ?? ""}
        {credits ? (
          <>
            {resetsIn ? <span aria-hidden>·</span> : null}
            <span
              aria-hidden
              className="inline-flex items-center gap-0.5 font-semibold text-foreground"
            >
              <TicketIcon className="size-3" aria-hidden />
              {credits}
            </span>
            <span className="sr-only">
              {gt(
                "{count, plural, one {{count} reset credit banked} other {{count} reset credits banked}}",
                { count: credits },
              )}
            </span>
          </>
        ) : null}
      </span>
    </PopoverTrigger>
  );
}

function PoolBar({
  pool,
  color,
  now,
  compact = false,
}: {
  readonly pool: LimitPoolWindow;
  readonly color: string;
  readonly now: number;
  readonly compact?: boolean | undefined;
}) {
  const restores = new Map(pool.resets.map((reset) => [reset.member.account.key, reset]));
  const gt = useGT();
  return (
    <div className="@container/pool min-w-0">
      <div
        className="grid gap-x-1 gap-y-1"
        style={{ gridTemplateColumns: `repeat(${pool.columns.length}, minmax(0, 1fr))` }}
      >
        {pool.columns.map((member, position) =>
          member.window ? (
            <PoolSegment
              key={member.account.key}
              account={member.account}
              window={member.window}
              reset={restores.get(member.account.key)}
              refillPercent={member.refillPercent}
              color={normalizeProviderAccentColor(member.account.accentColor) ?? color}
              now={now}
              index={position + 1}
              showAccountName={pool.columns.length > 1}
              compact={compact}
            />
          ) : pool.kind === "monthly" && member.account.limits.zeroSpendCap ? (
            <div
              key={member.account.key}
              style={{ gridColumn: position + 1, gridRow: 1 }}
              className={cn(
                "flex min-w-0 items-center justify-center overflow-hidden border border-dashed border-border text-3xs whitespace-nowrap text-muted-foreground",
                compact
                  ? "h-2 rounded-full"
                  : "h-5 gap-1.5 rounded-md @2xl/pool:h-8 @2xl/pool:justify-start @2xl/pool:px-2 @2xl/pool:text-xs",
              )}
            >
              {compact ? null : (
                <>
                  <AccountName
                    account={member.account}
                    className="hidden min-w-0 truncate @2xl/pool:inline-flex"
                  />
                  {gt("$0 cap")}
                </>
              )}
            </div>
          ) : null,
        )}
      </div>
    </div>
  );
}

function ProviderVisibilityMenu({
  pool,
  label,
  windows,
  hiddenSet,
  onToggleWindow,
  onShowAll,
}: {
  readonly pool: LimitPool;
  readonly label: string;
  readonly windows: readonly LimitPoolWindow[];
  readonly hiddenSet: ReadonlySet<string>;
  readonly onToggleWindow: (windowId: string) => void;
  readonly onShowAll: () => void;
}) {
  const gt = useGT();
  const m = useMessages();
  const hiddenCount = windows.filter((w) =>
    hiddenSet.has(limitWindowVisibilityKey(String(pool.driver), w.id)),
  ).length;
  if (windows.length === 0) return null;
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            type="button"
            size="icon-xs"
            variant="ghost-muted"
            aria-label={
              hiddenCount > 0
                ? gt("More options for {label} ({count} hidden)", { label, count: hiddenCount })
                : gt("More options for {label}", { label })
            }
            className="relative"
          />
        }
      >
        <MoreHorizontalIcon className="size-3.5" aria-hidden="true" />
        {hiddenCount > 0 ? (
          <span
            aria-hidden
            className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-primary"
          />
        ) : null}
      </MenuTrigger>
      <MenuPopup align="end">
        <MenuGroup>
          <MenuGroupLabel>
            <T context="usage limits window visibility menu header">Shown windows</T>
          </MenuGroupLabel>
          {windows.map((window) => {
            const key = limitWindowVisibilityKey(String(pool.driver), window.id);
            const details =
              pool.driver === "cursor" ? cursorUsageWindowDetails(window.id, pool, m) : undefined;
            const windowLabel = details?.label ?? window.label;
            return (
              <MenuCheckboxItem
                key={key}
                checked={!hiddenSet.has(key)}
                onCheckedChange={() => onToggleWindow(window.id)}
              >
                {windowLabel}
              </MenuCheckboxItem>
            );
          })}
        </MenuGroup>
        {hiddenCount > 0 ? (
          <>
            <MenuSeparator />
            <MenuItem onClick={onShowAll}>
              <T context="restore all hidden quota windows">Show all</T>
            </MenuItem>
          </>
        ) : null}
      </MenuPopup>
    </Menu>
  );
}

function CompactPaceCurve({
  entries,
  color,
  now,
}: {
  readonly entries: ReadonlyArray<{
    readonly label: string;
    readonly model: PaceCurveModel;
  }>;
  readonly color: string;
  readonly now: number;
}) {
  const gt = useGT();
  const m = useMessages();
  const timestampFormat = usePrimarySettings((settings) => settings.timestampFormat);
  const gradientId = useId().replace(/:/g, "");
  const primary = entries[0];
  if (!primary) return null;

  const width = 240;
  const height = 44;
  const padY = 4;
  const usableH = height - padY * 2;
  const toX = (x: number) => Number((Math.max(0, Math.min(1, x)) * width).toFixed(1));
  const toY = (y: number) =>
    Number((padY + (1 - Math.max(0, Math.min(100, y)) / 100) * usableH).toFixed(1));

  const polyline = (points: readonly { readonly x: number; readonly y: number }[]) =>
    points.map((point) => `${toX(point.x)},${toY(point.y)}`).join(" ");

  const primaryPoints = primary.model.actualPoints;
  const lastPrimary = primaryPoints.at(-1)!;
  const areaPath = [
    `M ${toX(primaryPoints[0]!.x)} ${height - padY}`,
    ...primaryPoints.map((point) => `L ${toX(point.x)} ${toY(point.y)}`),
    `L ${toX(lastPrimary.x)} ${height - padY}`,
    "Z",
  ].join(" ");

  const primaryDepletes = primary.model.depletesAtMs;
  const statusText =
    primaryDepletes !== null
      ? gt("Depletes ~{time}", {
          time: formatUpcomingTimestamp(
            new Date(primaryDepletes).toISOString(),
            timestampFormat,
            now,
            undefined,
            m,
          ),
        })
      : gt("On track to reset");

  return (
    <div className="flex flex-col gap-1 border-t border-border/40 pt-2.5">
      <div className="flex items-center justify-between gap-2 text-2xs">
        <span className="truncate text-muted-foreground">
          {entries.length > 1 ? gt("{label} pace", { label: primary.label }) : gt("Pace curve")}
        </span>
        <span
          className={cn(
            "shrink-0 tabular-nums",
            primaryDepletes !== null ? "text-warning-foreground" : "text-muted-foreground",
          )}
        >
          {statusText}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="h-10 w-full overflow-visible"
        aria-hidden
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.22} />
            <stop offset="100%" stopColor={color} stopOpacity={0.0} />
          </linearGradient>
        </defs>
        {/* Even-pace reference diagonal from 100% at window start to 0% at reset */}
        <line
          x1={0}
          y1={toY(100)}
          x2={width}
          y2={toY(0)}
          stroke="currentColor"
          strokeOpacity={0.22}
          strokeWidth={1}
          strokeDasharray="3 3"
          vectorEffect="non-scaling-stroke"
        />
        {/* Secondary timed window (subtle overlay if present) */}
        {entries[1] ? (
          <polyline
            fill="none"
            stroke="currentColor"
            strokeOpacity={0.35}
            strokeWidth={1.25}
            vectorEffect="non-scaling-stroke"
            points={polyline(entries[1].model.actualPoints)}
          />
        ) : null}
        {/* Primary window soft area fill */}
        <path d={areaPath} fill={`url(#${gradientId})`} />
        {/* Primary window actual trajectory */}
        <polyline
          fill="none"
          stroke={color}
          strokeWidth={1.75}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          points={polyline(primaryPoints)}
        />
        {/* Projected burn line from current point to reset / depletion */}
        <line
          x1={toX(lastPrimary.x)}
          y1={toY(lastPrimary.y)}
          x2={toX(primary.model.projectedEnd.x)}
          y2={toY(primary.model.projectedEnd.y)}
          stroke={color}
          strokeOpacity={0.55}
          strokeWidth={1.25}
          strokeDasharray="3 3"
          vectorEffect="non-scaling-stroke"
        />
        <circle cx={toX(lastPrimary.x)} cy={toY(lastPrimary.y)} r={2.25} fill={color} />
      </svg>
    </div>
  );
}

function CompactWindowTile({
  pool,
  window,
  color,
  now,
  fullWidth,
  paceModel,
}: {
  readonly pool: LimitPool;
  readonly window: LimitPoolWindow;
  readonly color: string;
  readonly now: number;
  readonly fullWidth: boolean;
  readonly paceModel: PaceCurveModel | null;
}) {
  const m = useMessages();
  const details =
    pool.driver === "cursor" ? cursorUsageWindowDetails(window.id, pool, m) : undefined;
  const label = details?.label ?? window.label;
  const nextReset = window.resets.find((reset) => reset.at > now);
  const resetCompact = nextReset
    ? `↻ ${formatDuration(nextReset.at - now, m)}`
    : window.members[0]
      ? formatResetsIn(window.members[0].window, now, m, "refill")
      : null;
  const delta = paceModel?.paceDeltaPercent ?? null;
  const deltaText = delta === null ? null : delta > 0 ? `+${delta}%` : `${delta}%`;
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", fullWidth && "sm:col-span-2")}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-xs font-medium text-muted-foreground">{label}</span>
        <span className="shrink-0 text-sm font-semibold text-foreground tabular-nums">
          {window.remainingPercent}%
        </span>
      </div>
      <PoolBar pool={window} color={color} now={now} compact />
      <div className="flex items-center justify-between gap-2 text-2xs tabular-nums">
        <span className="truncate text-muted-foreground">{resetCompact ?? ""}</span>
        {deltaText !== null ? (
          <span
            className={cn(
              "shrink-0",
              delta! <= -15
                ? "text-destructive"
                : delta! < 0
                  ? "text-warning-foreground"
                  : "text-muted-foreground",
            )}
          >
            {deltaText}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function CompactPoolCard({
  pool,
  now,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  hiddenSet,
  onToggleWindow,
  onShowAllWindows,
  history,
}: {
  readonly pool: LimitPool;
  readonly now: number;
  readonly canMoveUp: boolean;
  readonly canMoveDown: boolean;
  readonly onMoveUp?: (() => void) | undefined;
  readonly onMoveDown?: (() => void) | undefined;
  readonly hiddenSet: ReadonlySet<string>;
  readonly onToggleWindow?: ((windowId: string) => void) | undefined;
  readonly onShowAllWindows?: (() => void) | undefined;
  readonly history: LimitHistoryStore;
}) {
  const color = barColor(pool.driver);
  const label = providerClients.get(pool.driver)?.label ?? String(pool.driver);
  const allWindows = displayLimitWindows(pool);
  const visibleWindows = allWindows.filter(
    (window) => !hiddenSet.has(limitWindowVisibilityKey(String(pool.driver), window.id)),
  );
  const gt = useGT();
  const m = useMessages();

  const windowModels = visibleWindows.map((window) => {
    const key = limitWindowVisibilityKey(String(pool.driver), window.id);
    return {
      window,
      model: buildPaceCurveModel(window, history[key], now),
    };
  });

  // Prefer weekly first for the card's primary pace curve, then session/other timed windows.
  const timedCurveEntries = [
    ...windowModels.filter((entry) => entry.window.kind === "weekly" && entry.model !== null),
    ...windowModels.filter((entry) => entry.window.kind !== "weekly" && entry.model !== null),
  ]
    .slice(0, 2)
    .map((entry) => {
      const details =
        pool.driver === "cursor" ? cursorUsageWindowDetails(entry.window.id, pool, m) : undefined;
      return {
        label: details?.label ?? entry.window.label,
        model: entry.model!,
      };
    });

  return (
    <section className="flex min-w-0 flex-col justify-between gap-3 rounded-xl border border-border/60 bg-card/40 p-3.5">
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex min-w-0 items-center gap-2 text-sm font-medium text-foreground">
            <ProviderInstanceIcon
              driverKind={pool.driver}
              displayName={label}
              indicatorBackground="var(--background)"
              className="size-4.5 shrink-0"
              iconClassName="size-3.5 text-foreground/80"
            />
            <span className="truncate">{label}</span>
            {pool.accounts.length > 1 ? (
              <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-3xs font-normal text-muted-foreground tabular-nums">
                {gt("{count} accounts", { count: pool.accounts.length })}
              </span>
            ) : null}
          </h2>
          <div className="flex shrink-0 items-center gap-0.5">
            {onMoveUp || onMoveDown ? (
              <>
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost-muted"
                  disabled={!canMoveUp}
                  onClick={onMoveUp}
                  aria-label={gt("Move {label} up", { label })}
                >
                  <ArrowUpIcon className="size-3.5" aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost-muted"
                  disabled={!canMoveDown}
                  onClick={onMoveDown}
                  aria-label={gt("Move {label} down", { label })}
                >
                  <ArrowDownIcon className="size-3.5" aria-hidden="true" />
                </Button>
              </>
            ) : null}
            {onToggleWindow && onShowAllWindows ? (
              <ProviderVisibilityMenu
                pool={pool}
                label={label}
                windows={allWindows}
                hiddenSet={hiddenSet}
                onToggleWindow={onToggleWindow}
                onShowAll={onShowAllWindows}
              />
            ) : null}
          </div>
        </div>
        {visibleWindows.length === 0 ? (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-dashed border-border/60 px-3 py-2 text-xs text-muted-foreground">
            <span>
              <T>All quota windows hidden.</T>
            </span>
            {onShowAllWindows ? (
              <Button type="button" size="xs" variant="ghost" onClick={onShowAllWindows}>
                <T context="restore all hidden quota windows">Show all</T>
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-x-4 gap-y-2.5 sm:grid-cols-2">
            {windowModels.map(({ window, model }) => (
              <CompactWindowTile
                key={`${window.kind}:${window.id}`}
                pool={pool}
                window={window}
                color={color}
                now={now}
                fullWidth={visibleWindows.length === 1}
                paceModel={model}
              />
            ))}
          </div>
        )}
      </div>
      {timedCurveEntries.length > 0 ? (
        <CompactPaceCurve entries={timedCurveEntries} color={color} now={now} />
      ) : null}
    </section>
  );
}

function PoolWindowCard({
  pool,
  color,
  now,
  label,
  description,
}: {
  readonly pool: LimitPoolWindow;
  readonly color: string;
  readonly now: number;
  readonly label?: string | null | undefined;
  readonly description?: string | undefined;
}) {
  const m = useMessages();
  const nextRefill = pool.resets.find((reset) => reset.at > now && reset.restoresPercent > 0);
  return (
    <div className="grid items-center gap-x-6 gap-y-3 rounded-lg border border-border/60 p-4 md:grid-cols-[11rem_minmax(0,1fr)]">
      <div className="flex flex-col gap-1">
        {label !== null ? (
          <span className="text-sm font-medium text-foreground">{label ?? pool.label}</span>
        ) : null}
        <span className="flex items-baseline gap-2">
          <span className="text-3xl font-semibold text-foreground tabular-nums">
            {pool.remainingPercent}%
          </span>
          <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
            <span>
              <T context="remaining usage percentage">left</T>
            </span>
            {pool.pace ? <PaceIcon pace={pool.pace} /> : null}
          </span>
        </span>
        {nextRefill && pool.columns.length > 1 ? (
          <span className="text-xs text-muted-foreground tabular-nums">
            <T context="usage limit refill">
              <span className="font-medium text-foreground">
                ↻ +<Var>{nextRefill.restoresPercent}</Var>%
              </span>{" "}
              in <Var>{formatDuration(nextRefill.at - now, m)}</Var>
            </T>
          </span>
        ) : null}
      </div>
      <PoolBar pool={pool} color={color} now={now} />
      {description ? (
        <p className="text-xs text-muted-foreground md:col-span-2">{description}</p>
      ) : null}
    </div>
  );
}

function PoolSection({
  pool,
  now,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  hiddenSet,
  onToggleWindow,
  onShowAllWindows,
}: {
  readonly pool: LimitPool;
  readonly now: number;
  readonly canMoveUp: boolean;
  readonly canMoveDown: boolean;
  readonly onMoveUp?: (() => void) | undefined;
  readonly onMoveDown?: (() => void) | undefined;
  readonly hiddenSet: ReadonlySet<string>;
  readonly onToggleWindow?: ((windowId: string) => void) | undefined;
  readonly onShowAllWindows?: (() => void) | undefined;
}) {
  const color = barColor(pool.driver);
  const label = providerClients.get(pool.driver)?.label ?? String(pool.driver);
  const allWindows = displayLimitWindows(pool);
  const windows = allWindows.filter(
    (window) => !hiddenSet.has(limitWindowVisibilityKey(String(pool.driver), window.id)),
  );
  const gt = useGT();
  const m = useMessages();
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-medium text-foreground">
          <ProviderInstanceIcon
            driverKind={pool.driver}
            displayName={label}
            indicatorBackground="var(--background)"
            className="size-5"
            iconClassName="size-4 text-foreground/80"
          />
          {label}
        </h2>
        <div className="flex items-center gap-0.5">
          {onMoveUp || onMoveDown ? (
            <>
              <Button
                type="button"
                size="icon-xs"
                variant="ghost-muted"
                disabled={!canMoveUp}
                onClick={onMoveUp}
                aria-label={gt("Move {label} up", { label })}
              >
                <ArrowUpIcon className="size-3.5" aria-hidden="true" />
              </Button>
              <Button
                type="button"
                size="icon-xs"
                variant="ghost-muted"
                disabled={!canMoveDown}
                onClick={onMoveDown}
                aria-label={gt("Move {label} down", { label })}
              >
                <ArrowDownIcon className="size-3.5" aria-hidden="true" />
              </Button>
            </>
          ) : null}
          {onToggleWindow && onShowAllWindows ? (
            <ProviderVisibilityMenu
              pool={pool}
              label={label}
              windows={allWindows}
              hiddenSet={hiddenSet}
              onToggleWindow={onToggleWindow}
              onShowAll={onShowAllWindows}
            />
          ) : null}
        </div>
      </div>
      {windows.length === 0 ? (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-dashed border-border/60 px-4 py-3 text-xs text-muted-foreground">
          <span>
            <T>All quota windows hidden.</T>
          </span>
          {onShowAllWindows ? (
            <Button type="button" size="xs" variant="ghost" onClick={onShowAllWindows}>
              <T context="restore all hidden quota windows">Show all</T>
            </Button>
          ) : null}
        </div>
      ) : (
        windows.map((window) => {
          const details =
            pool.driver === "cursor" ? cursorUsageWindowDetails(window.id, pool, m) : undefined;
          return (
            <PoolWindowCard
              key={`${window.kind}:${window.id}`}
              pool={window}
              color={color}
              now={now}
              label={details?.label}
              description={details?.description}
            />
          );
        })
      )}
    </section>
  );
}

export function UsageLimitsPooled({
  presentations,
  providerOrder,
  onProviderOrderChange,
  viewMode = "standard",
  hiddenWindowKeys,
  onHiddenWindowKeysChange,
  now,
}: {
  readonly presentations: Parameters<typeof collectLimitAccounts>[0];
  readonly providerOrder?: readonly string[] | undefined;
  readonly onProviderOrderChange?: ((next: readonly string[]) => void) | undefined;
  readonly viewMode?: UsageLimitsViewMode | undefined;
  readonly hiddenWindowKeys?: readonly string[] | undefined;
  readonly onHiddenWindowKeysChange?: ((next: readonly string[]) => void) | undefined;
  readonly now: number;
}) {
  const gt = useGT();
  const m = useMessages();
  const [segmentPopover] = useState(() => PopoverCreateHandle<SegmentPayload>());
  const segmentPopoverActions = useRef<PopoverPrimitive.Root.Actions | null>(null);
  const [initialHistory] = useState<LimitHistoryStore>(() => readLimitHistory());
  const pools = orderLimitPools(
    collectLimitPools(collectLimitAccounts(presentations), now),
    providerOrder,
  );
  const history =
    pools.length > 0 ? appendLimitHistory(initialHistory, pools, now) : initialHistory;
  const hiddenSet = new Set(hiddenWindowKeys ?? []);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- persists sampled usage limits to localStorage for compact pace curves
  useEffect(() => {
    if (pools.length === 0) return;
    recordUsageLimitHistory(pools, now);
  }, [pools, now]);

  const movePool = (index: number, delta: -1 | 1) => {
    if (!onProviderOrderChange) return;
    const nextDrivers = moveLimitPool(pools, providerOrder, index, delta);
    if (nextDrivers) onProviderOrderChange(nextDrivers);
  };
  const toggleWindowVisibility = (driver: string, windowId: string) => {
    if (!onHiddenWindowKeysChange) return;
    onHiddenWindowKeysChange(
      toggleHiddenLimitWindow(hiddenWindowKeys, limitWindowVisibilityKey(driver, windowId)),
    );
  };
  const showAllWindowsForDriver = (driver: string) => {
    if (!onHiddenWindowKeysChange) return;
    onHiddenWindowKeysChange(clearHiddenLimitWindowsForDriver(hiddenWindowKeys, driver));
  };
  const quotaSources = collectHttpQuotaSources(presentations);
  const notices = collectLimitNotices(presentations, m);
  const externalLinks = collectExternalUsageLinks(presentations, m);
  return (
    <div className={cn("flex flex-col", viewMode === "compact" ? "gap-5" : "gap-8")}>
      {pools.length === 0 &&
      notices.length === 0 &&
      externalLinks.length === 0 &&
      quotaSources.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          <T>No provider on the selected environments reports subscription limits.</T>
        </p>
      ) : null}
      <SegmentPopoverContext value={segmentPopover}>
        {viewMode === "compact" ? (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {pools.map((pool, index) => (
              <CompactPoolCard
                key={pool.driver}
                pool={pool}
                now={now}
                canMoveUp={index > 0}
                canMoveDown={index < pools.length - 1}
                onMoveUp={
                  onProviderOrderChange && pools.length > 1 ? () => movePool(index, -1) : undefined
                }
                onMoveDown={
                  onProviderOrderChange && pools.length > 1 ? () => movePool(index, 1) : undefined
                }
                hiddenSet={hiddenSet}
                onToggleWindow={
                  onHiddenWindowKeysChange
                    ? (windowId) => toggleWindowVisibility(String(pool.driver), windowId)
                    : undefined
                }
                onShowAllWindows={
                  onHiddenWindowKeysChange
                    ? () => showAllWindowsForDriver(String(pool.driver))
                    : undefined
                }
                history={history}
              />
            ))}
          </div>
        ) : (
          pools.map((pool, index) => (
            <Fragment key={pool.driver}>
              <PoolSection
                pool={pool}
                now={now}
                canMoveUp={index > 0}
                canMoveDown={index < pools.length - 1}
                onMoveUp={
                  onProviderOrderChange && pools.length > 1 ? () => movePool(index, -1) : undefined
                }
                onMoveDown={
                  onProviderOrderChange && pools.length > 1 ? () => movePool(index, 1) : undefined
                }
                hiddenSet={hiddenSet}
                onToggleWindow={
                  onHiddenWindowKeysChange
                    ? (windowId) => toggleWindowVisibility(String(pool.driver), windowId)
                    : undefined
                }
                onShowAllWindows={
                  onHiddenWindowKeysChange
                    ? () => showAllWindowsForDriver(String(pool.driver))
                    : undefined
                }
              />
            </Fragment>
          ))
        )}
      </SegmentPopoverContext>
      <Popover handle={segmentPopover} actionsRef={segmentPopoverActions}>
        {({ payload }) =>
          payload ? (
            <ActiveSegmentPopover
              handle={segmentPopover}
              actions={segmentPopoverActions}
              payload={payload}
              pools={pools}
              now={now}
            />
          ) : null
        }
      </Popover>
      {quotaSources.map((source) => (
        <section key={source.key} className="space-y-3 rounded-xl border p-4">
          <h2 className="text-sm font-medium">{source.label}</h2>
          {source.quotaAccounts?.map((account) => (
            <div key={account.id} className="space-y-1">
              <h3 className="text-sm font-medium">{account.label}</h3>
              {account.windows.map((window) => {
                const reset = formatResetsIn(window, now, m);
                return (
                  <div
                    key={window.id}
                    className="flex justify-between gap-3 text-sm text-muted-foreground"
                  >
                    <span>{window.label}</span>
                    <span>
                      {gt("{remaining}% left", { remaining: remainingPercent(window) })}
                      {reset ? ` · ${reset}` : ""}
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
        </section>
      ))}
      {externalLinks.map((link) => (
        <section
          key={link.url}
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4"
        >
          <div className="flex min-w-0 flex-1 items-center gap-3">
            {link.url === CHATGPT_USAGE_URL ? (
              <OpenAI className="size-5 shrink-0" aria-hidden="true" />
            ) : null}
            <div className="min-w-0 space-y-1">
              <h2 className="text-sm font-medium">{link.label}</h2>
              <p className="text-xs break-words text-muted-foreground">
                {link.accounts.join(", ")}
              </p>
              {link.url === CHATGPT_USAGE_URL ? (
                <p className="text-xs text-muted-foreground">
                  <T>View usage in ChatGPT with your connected account.</T>
                </p>
              ) : link.message ? (
                <p className="max-w-xl text-xs text-muted-foreground">{link.message}</p>
              ) : null}
            </div>
          </div>
          <Button
            variant="ghost-muted"
            size="xs"
            onClick={() => void ensureLocalApi().shell.openExternal(link.url)}
          >
            {gt("Manage usage")}
            <ExternalLinkIcon className="size-3.5" aria-hidden="true" />
          </Button>
        </section>
      ))}
      <LimitNotices notices={notices} />
    </div>
  );
}

function LimitNotices({ notices }: { readonly notices: readonly string[] }) {
  if (notices.length === 0) return null;
  return (
    <Alert variant="warning" controlAlignment="first-line">
      <AlertTriangleIcon />
      {notices.map((notice) => (
        <AlertTitle key={notice} className="break-words">
          {notice}
        </AlertTitle>
      ))}
    </Alert>
  );
}
