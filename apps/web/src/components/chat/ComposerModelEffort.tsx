import {
  buildTraitsTriggerDisplay,
  getDescriptorStringValue,
  isReasoningControl,
  selectableProviderOptionChoices,
} from "@t3tools/client-runtime/model-traits";
import type { ProviderOptionDescriptor, RuntimeMode } from "@t3tools/contracts";
import type { EffortDisplay } from "@t3tools/contracts/settings";
import { getProviderOptionCurrentLabel } from "@t3tools/shared/model";
import { msg, T, useGT, useMessages } from "gt-react";
import { ChevronDownIcon, ChevronUpIcon, WorkflowIcon } from "lucide-react";
import { type KeyboardEvent, type PointerEvent, type ReactNode, useRef, useState } from "react";

import { m, type MessageResolver } from "~/i18n/messages";
import { cn } from "~/lib/utils";
import {
  Menu,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRadioItemIndicator,
  MenuTrigger,
} from "../ui/menu";
import { Switch } from "../ui/switch";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import type { ComposerControlSize } from "./ComposerControl";
import { ComposerPermissionsSection, type RuntimeModeOption } from "./ComposerFooterControls";
import { composerFloatingLayerProps, focusCheckedPermission } from "./composerEventScope";
import { EffortGlyph, FastBolt, resolveEffortGlyph } from "./EffortGlyph";
import {
  getTraitsSectionVisibility,
  type TraitsSelectionInput,
  ULTRATHINK_IN_BODY_NOTE,
  useTraitsSelection,
} from "./TraitsPicker";

type SelectDescriptor = Extract<ProviderOptionDescriptor, { type: "select" }>;
type BooleanDescriptor = Extract<ProviderOptionDescriptor, { type: "boolean" }>;

function splitSpeed(
  selects: ReadonlyArray<SelectDescriptor>,
  toggles: ReadonlyArray<BooleanDescriptor>,
) {
  const speedSelect = selects.find((descriptor) => descriptor.id === "serviceTier") ?? null;
  const fastToggle = toggles.find((descriptor) => descriptor.id === "fastMode") ?? null;
  const ultracodeToggle = toggles.find((descriptor) => descriptor.id === "ultracode") ?? null;
  return {
    speedSelect,
    fastToggle,
    ultracodeToggle,
    columnSelects: selects.filter((descriptor) => descriptor !== speedSelect),
    columnToggles: toggles.filter(
      (descriptor) => descriptor !== fastToggle && descriptor !== ultracodeToggle,
    ),
  };
}

type ColumnControl =
  | { kind: "select"; descriptor: SelectDescriptor }
  | { kind: "boolean"; descriptor: BooleanDescriptor };

function columnControls(
  selects: ReadonlyArray<SelectDescriptor>,
  toggles: ReadonlyArray<BooleanDescriptor>,
) {
  const { columnSelects, columnToggles } = splitSpeed(selects, toggles);
  const controls: ReadonlyArray<ColumnControl> = [
    ...columnSelects.map((descriptor) => ({ kind: "select" as const, descriptor })),
    ...columnToggles.map((descriptor) => ({ kind: "boolean" as const, descriptor })),
  ];
  const effort = controls.find((control) => isReasoningControl(control.descriptor)) ?? null;
  return { effort, others: controls.filter((control) => control !== effort) };
}

type PowerTier = "neutral" | "cobalt" | "prism";
type StarfieldDensity = "low" | "med" | "high" | "max";

const PRISM_LEVEL_IDS = new Set(["max", "ultra", "ultracode", "ultrathink"]);
const COBALT_LEVEL_IDS = new Set(["high", "xhigh", "extra_high", "extra-high", "extrahigh"]);
const LOW_LEVEL_IDS = new Set(["none", "off", "minimal", "low"]);

function resolvePowerVisuals(input: {
  selectedId: string | undefined;
  selectedIndex: number;
  count: number;
}): {
  tier: PowerTier;
  density: StarfieldDensity;
  percent: number;
} {
  const normalizedId = input.selectedId?.toLowerCase() ?? "";
  const safeCount = Math.max(input.count, 1);
  const ratio =
    safeCount <= 1 ? 1 : Math.max(0, Math.min(1, input.selectedIndex / (safeCount - 1)));
  // Keep minimum fill wide enough for the 22px circular thumb; full width on the final stop.
  const percent =
    safeCount <= 1
      ? 100
      : input.selectedIndex <= 0
        ? LOW_LEVEL_IDS.has(normalizedId) && (normalizedId === "none" || normalizedId === "off")
          ? 12
          : 24
        : Math.round(24 + ratio * 76);

  if (
    PRISM_LEVEL_IDS.has(normalizedId) ||
    (safeCount >= 4 && input.selectedIndex === safeCount - 1 && !COBALT_LEVEL_IDS.has(normalizedId))
  ) {
    return { tier: "prism", density: "max", percent };
  }
  if (COBALT_LEVEL_IDS.has(normalizedId) || ratio >= 0.65) {
    return { tier: "cobalt", density: "high", percent };
  }
  if (LOW_LEVEL_IDS.has(normalizedId) || ratio <= 0.25) {
    return { tier: "neutral", density: "low", percent };
  }
  return { tier: "neutral", density: "med", percent };
}

/**
 * Pure circular particle starfield flowing left-to-right (zero 4-point sparkles).
 * Tiled twice across 0..600 so translating -50% -> 0% loops seamlessly.
 */
function PowerSliderStarfield(props: { density: StarfieldDensity }) {
  const showMedium = props.density !== "low";
  const showHigh = props.density === "high" || props.density === "max";
  const showMax = props.density === "max";
  return (
    <svg
      aria-hidden="true"
      className="model-picker-starfield"
      data-density={props.density}
      viewBox="0 0 600 28"
      preserveAspectRatio="none"
    >
      {[0, 300].map((offset) => (
        <g key={offset} transform={`translate(${offset} 0)`}>
          <circle cx="24" cy="9" r="0.95" fill="currentColor" opacity="0.55" />
          <circle cx="76" cy="20" r="1.05" fill="currentColor" opacity="0.65" />
          <circle cx="142" cy="11" r="0.9" fill="currentColor" opacity="0.5" />
          <circle cx="212" cy="19" r="1.15" fill="currentColor" opacity="0.72" />
          <circle cx="268" cy="10" r="1.0" fill="currentColor" opacity="0.6" />
          {showMedium ? (
            <>
              <circle cx="48" cy="18" r="0.85" fill="currentColor" opacity="0.52" />
              <circle cx="110" cy="8" r="1.1" fill="currentColor" opacity="0.7" />
              <circle cx="176" cy="21" r="0.95" fill="currentColor" opacity="0.6" />
              <circle cx="240" cy="14" r="1.15" fill="currentColor" opacity="0.76" />
            </>
          ) : null}
          {showHigh ? (
            <>
              <line
                x1="60"
                y1="10"
                x2="72"
                y2="10"
                stroke="currentColor"
                strokeOpacity="0.34"
                strokeWidth="1"
                strokeLinecap="round"
              />
              <line
                x1="158"
                y1="19"
                x2="174"
                y2="19"
                stroke="currentColor"
                strokeOpacity="0.4"
                strokeWidth="1.1"
                strokeLinecap="round"
              />
              <line
                x1="234"
                y1="9"
                x2="248"
                y2="9"
                stroke="currentColor"
                strokeOpacity="0.38"
                strokeWidth="1.05"
                strokeLinecap="round"
              />
              <circle cx="94" cy="16" r="1.2" fill="currentColor" opacity="0.84" />
              <circle cx="192" cy="8" r="1.25" fill="currentColor" opacity="0.86" />
              <circle cx="284" cy="18" r="1.15" fill="currentColor" opacity="0.8" />
            </>
          ) : null}
          {showMax ? (
            <>
              <line
                x1="16"
                y1="20"
                x2="32"
                y2="20"
                stroke="currentColor"
                strokeOpacity="0.45"
                strokeWidth="1.15"
                strokeLinecap="round"
              />
              <line
                x1="106"
                y1="12"
                x2="124"
                y2="12"
                stroke="currentColor"
                strokeOpacity="0.5"
                strokeWidth="1.2"
                strokeLinecap="round"
              />
              <line
                x1="200"
                y1="16"
                x2="220"
                y2="16"
                stroke="currentColor"
                strokeOpacity="0.54"
                strokeWidth="1.25"
                strokeLinecap="round"
              />
              <circle cx="34" cy="20" r="1.3" fill="currentColor" opacity="0.94" />
              <circle cx="126" cy="12" r="1.4" fill="currentColor" opacity="0.96" />
              <circle cx="222" cy="16" r="1.45" fill="currentColor" opacity="0.96" />
              <circle cx="152" cy="8" r="1.15" fill="currentColor" opacity="0.85" />
              <circle cx="260" cy="22" r="1.2" fill="currentColor" opacity="0.88" />
            </>
          ) : null}
        </g>
      ))}
    </svg>
  );
}

/**
 * What the model trigger shows after the model name: the effort word (or bars, per the
 * Appearance setting), a bolt for Fast, a workflow icon for Ultracode, and other traits such as a
 * context window.
 */
export function describeComposerEffort(
  traits: TraitsSelectionInput | null,
  effortDisplay: EffortDisplay,
  size: ComposerControlSize,
  resolve: MessageResolver = m,
): { suffix: ReactNode; detail: string | null } {
  if (!traits) return { suffix: null, detail: null };
  const visibility = getTraitsSectionVisibility({ ...traits, resolve });
  if (!visibility.hasAnyControls) return { suffix: null, detail: null };
  const modelSelection =
    traits.instanceId && traits.model
      ? { instanceId: traits.instanceId, model: traits.model, options: traits.modelOptions ?? [] }
      : null;
  const primary = visibility.primarySelectDescriptor;
  const display = buildTraitsTriggerDisplay(
    {
      descriptors: visibility.descriptors,
      primarySelectDescriptorId: primary?.id ?? null,
      ultrathinkPromptControlled: visibility.ultrathinkPromptControlled,
      modelSelection,
      reportedModelSelection: traits.reportedModelSelection,
    },
    resolve,
  );
  const reasoning =
    columnControls(visibility.selectDescriptors, visibility.booleanDescriptors).effort
      ?.descriptor ?? null;
  const ultrathink = visibility.ultrathinkPromptControlled && reasoning === primary;
  const glyph =
    reasoning?.type === "select"
      ? resolveEffortGlyph(
          reasoning,
          ultrathink
            ? "ultrathink"
            : getDescriptorStringValue(reasoning, modelSelection, traits.reportedModelSelection),
        )
      : null;
  const word = glyph
    ? (glyph.special ?? (effortDisplay === "label" ? glyph.label : null))
    : !reasoning
      ? null
      : reasoning.type === "boolean"
        ? reasoning.currentValue === true
          ? resolve(msg("{option} On", { option: reasoning.label }))
          : resolve(msg("{option} Off", { option: reasoning.label }))
        : ultrathink
          ? "Ultrathink"
          : (getProviderOptionCurrentLabel(
              reasoning,
              modelSelection,
              traits.reportedModelSelection,
            ) ?? (reasoning.id === "thinking" ? reasoning.label : null));
  const fast = display.speedLabel === "Fast" || display.speedLabel === "Ultrafast";
  const contextWindow =
    visibility.contextWindowDescriptor &&
    getProviderOptionCurrentLabel(
      visibility.contextWindowDescriptor,
      modelSelection,
      traits.reportedModelSelection,
    );
  if (!word && !glyph && !fast && !display.ultracode && !contextWindow)
    return { suffix: null, detail: display.label };
  return {
    detail: display.label,
    suffix: (
      <span
        className={cn(
          "flex shrink-0 items-center gap-1.5 text-muted-foreground group-hover/model-trigger:text-foreground group-data-pressed/model-trigger:text-foreground group-data-popup-open/model-trigger:text-foreground",
          size === "sm" && "-ms-0.5",
        )}
      >
        {word ? (
          <span data-composer-control-label className="max-w-24 truncate">
            {word}
          </span>
        ) : glyph ? (
          <EffortGlyph count={glyph.count} filled={glyph.filled} size={size} />
        ) : null}
        {fast ? <FastBolt ultra={display.speedLabel === "Ultrafast"} /> : null}
        {display.ultracode ? (
          <WorkflowIcon aria-hidden="true" data-composer-control-icon className="size-3" />
        ) : null}
        {contextWindow ? (
          <span
            data-composer-control-label
            data-composer-secondary-trait
            className="max-w-24 truncate text-xs"
          >
            {contextWindow}
          </span>
        ) : null}
      </span>
    ),
  };
}

function moveBetweenRows(event: KeyboardEvent<HTMLElement>) {
  const arrow = event.key === "ArrowDown" || event.key === "ArrowUp";
  if (
    !arrow &&
    (event.key.length !== 1 ||
      event.key.trim() === "" ||
      event.ctrlKey ||
      event.altKey ||
      event.metaKey ||
      event.nativeEvent.isComposing)
  )
    return;
  if (!event.currentTarget.contains(event.target as Node)) return;
  const rows = Array.from(
    event.currentTarget.querySelectorAll<HTMLButtonElement>("[data-effort-row]:not(:disabled)"),
  );
  const index = rows.findIndex((row) => row === document.activeElement);
  const next = arrow
    ? rows[Math.min(rows.length - 1, Math.max(0, index + (event.key === "ArrowDown" ? 1 : -1)))]
    : [...rows.slice(index + 1), ...rows.slice(0, index + 1)].find((row) =>
        row.dataset.effortLevel?.toLowerCase().startsWith(event.key.toLowerCase()),
      );
  if (!next) return;
  event.preventDefault();
  event.stopPropagation();
  next.focus();
  next.scrollIntoView({ block: "nearest" });
}

type SliderChoice = {
  readonly id: string;
  readonly label: string;
  readonly description?: string | undefined;
};

function ReasoningPowerSlider(props: {
  ariaLabel: string;
  choices: ReadonlyArray<SliderChoice>;
  selectedId: string;
  disabled?: boolean;
  onSelect: (id: string) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const selectedIndex = Math.max(
    0,
    props.choices.findIndex((choice) => choice.id === props.selectedId),
  );
  const shown = props.choices.some((choice) => choice.id === props.selectedId);
  const activeChoice = props.choices[selectedIndex];
  const visuals = resolvePowerVisuals({
    selectedId: activeChoice?.id,
    selectedIndex,
    count: props.choices.length,
  });
  const labelFitsInside = visuals.percent >= 28;

  const pickAtClientX = (clientX: number) => {
    if (props.disabled || props.choices.length === 0) return;
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const nextIndex =
      props.choices.length <= 1 ? 0 : Math.round(ratio * (props.choices.length - 1));
    const target = props.choices[nextIndex];
    if (target && target.id !== props.selectedId) {
      props.onSelect(target.id);
    }
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (props.disabled || event.button !== 0) return;
    draggingRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    pickAtClientX(event.clientX);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current || props.disabled) return;
    pickAtClientX(event.clientX);
  };

  const handlePointerUp = () => {
    draggingRef.current = false;
  };

  return (
    <div
      ref={trackRef}
      role="radiogroup"
      aria-label={props.ariaLabel}
      className={cn(
        "model-picker-power-track w-full",
        props.disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
      )}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-1 flex items-center justify-between px-3.5"
      >
        {props.choices.map((choice) => (
          <span key={choice.id} className="size-1 rounded-full bg-foreground/20" />
        ))}
      </div>

      <div
        className="model-picker-power-fill pointer-events-none"
        data-power-tier={visuals.tier}
        style={{ width: `${visuals.percent}%` }}
      >
        <PowerSliderStarfield density={visuals.density} />
        {labelFitsInside && activeChoice ? (
          <span className="model-picker-power-label">{activeChoice.label}</span>
        ) : null}
        <span className="model-picker-power-thumb" />
      </div>

      {!labelFitsInside && activeChoice ? (
        <span className="model-picker-power-label-outside">{activeChoice.label}</span>
      ) : null}

      {/* Accessible radio stops span the track so click, Tab, arrows, and first-letter focus work natively. */}
      <div className="absolute inset-0 z-5 flex">
        {props.choices.map((choice, index) => {
          const isChecked = choice.id === props.selectedId;
          return (
            <button
              key={choice.id}
              type="button"
              role="radio"
              aria-checked={isChecked}
              aria-label={choice.label}
              disabled={props.disabled}
              data-effort-row
              data-effort-level={choice.label}
              tabIndex={shown ? (isChecked ? 0 : -1) : index === 0 ? 0 : -1}
              className="h-full flex-1 cursor-pointer rounded-full bg-transparent outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset disabled:cursor-not-allowed"
              onClick={() => props.onSelect(choice.id)}
            />
          );
        })}
      </div>
    </div>
  );
}

type TraitsSelection = ReturnType<typeof useTraitsSelection>;

function EffortSliderSection(props: {
  control: ColumnControl;
  traits: TraitsSelection;
  locked: boolean;
}) {
  const gt = useGT();
  const messages = useMessages();
  const { control, traits, locked } = props;
  if (control.kind === "boolean") {
    const choices: ReadonlyArray<SliderChoice> = [
      { id: "false", label: gt("Off", { $context: "option state" }) },
      { id: "true", label: gt("On", { $context: "option state" }) },
    ];
    return (
      <ReasoningPowerSlider
        ariaLabel={control.descriptor.label}
        choices={choices}
        selectedId={control.descriptor.currentValue === true ? "true" : "false"}
        onSelect={(id) => traits.changeBoolean(control.descriptor.id, id === "true")}
      />
    );
  }
  const value = traits.selectValue(control.descriptor);
  const choices = selectableProviderOptionChoices(control.descriptor);
  return (
    <div className="flex flex-col gap-1.5">
      {locked ? (
        <div className="text-xs text-muted-foreground/80">{messages(ULTRATHINK_IN_BODY_NOTE)}</div>
      ) : null}
      <ReasoningPowerSlider
        ariaLabel={control.descriptor.label}
        choices={choices}
        selectedId={value}
        disabled={locked}
        onSelect={(id) => traits.changeSelect(control.descriptor, id)}
      />
    </div>
  );
}

const OPTION_CHIP =
  "flex h-7 max-w-full cursor-pointer items-center gap-1.5 rounded-md px-2 text-left text-xs text-muted-foreground outline-none transition-colors hover:bg-foreground/8 hover:text-foreground focus-visible:bg-foreground/8 focus-visible:text-foreground";

function OptionMenuRow(props: {
  descriptor: SelectDescriptor;
  traits: TraitsSelection;
  tabStop: boolean;
}) {
  const gt = useGT();
  const { descriptor, traits } = props;
  const [open, setOpen] = useState(false);
  const popupRef = useRef<HTMLDivElement>(null);
  const choices = selectableProviderOptionChoices(descriptor);
  const value = traits.selectValue(descriptor);
  const current = choices.find((choice) => choice.id === value)?.label ?? "";
  return (
    <Menu
      open={open}
      modal={false}
      onOpenChange={setOpen}
      onOpenChangeComplete={(isOpen) => {
        if (!isOpen) return;
        const checked = popupRef.current?.querySelector<HTMLElement>(
          '[role="menuitemradio"][aria-checked="true"]',
        );
        checked?.focus({ preventScroll: true });
        checked?.scrollIntoView({ block: "nearest" });
      }}
    >
      <MenuTrigger
        render={
          <button
            type="button"
            data-effort-row
            tabIndex={props.tabStop ? 0 : -1}
            aria-label={`${descriptor.label}: ${current}`}
            className={cn(
              OPTION_CHIP,
              "data-popup-open:bg-foreground/8 data-popup-open:text-foreground",
            )}
            onKeyDown={(event) => {
              if (event.key !== "ArrowRight") return;
              event.preventDefault();
              event.stopPropagation();
              setOpen(true);
            }}
          />
        }
      >
        <span className="truncate text-muted-foreground">{descriptor.label}</span>
        <span className="text-muted-foreground/50" aria-hidden="true">
          ·
        </span>
        <span className="truncate font-medium text-foreground">{current}</span>
        <ChevronDownIcon aria-hidden="true" className="size-3 shrink-0 text-muted-foreground" />
      </MenuTrigger>
      <MenuPopup
        ref={popupRef}
        side="top"
        align="start"
        sideOffset={6}
        collisionAvoidance={{ fallbackAxisSide: "end" }}
        className="max-w-72"
        data-model-picker-option-menu
        {...composerFloatingLayerProps}
        onKeyDown={(event) => {
          if (event.key !== "ArrowLeft") return;
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
        }}
      >
        <MenuRadioGroup
          aria-label={descriptor.label}
          value={value}
          onValueChange={(next: string) => {
            if (next !== value) traits.changeSelect(descriptor, next);
          }}
        >
          {choices.map((choice) => (
            <MenuRadioItem key={choice.id} value={choice.id} closeOnClick>
              <span className="flex items-center gap-3">
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{choice.label}</span>
                  {choice.description ? (
                    <span className="line-clamp-2 text-xs text-muted-foreground">
                      {choice.description}
                    </span>
                  ) : null}
                </span>
                {choice.isDefault ? (
                  <span className="text-xs text-muted-foreground/70">
                    {gt("Default", { $context: "marks the default option" })}
                  </span>
                ) : null}
                <MenuRadioItemIndicator />
              </span>
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
}

function OptionSwitchRow(props: {
  descriptor: BooleanDescriptor;
  traits: TraitsSelection;
  tabStop: boolean;
}) {
  const { descriptor, traits } = props;
  const checked = descriptor.currentValue === true;
  return (
    <label className={cn(OPTION_CHIP, "has-focus-visible:bg-foreground/8")}>
      <span className="truncate text-foreground/85">{descriptor.label}</span>
      <Switch
        size="sm"
        checked={checked}
        onCheckedChange={(next) => traits.changeBoolean(descriptor.id, next)}
        aria-label={descriptor.label}
        data-effort-row
        tabIndex={props.tabStop ? 0 : -1}
      />
    </label>
  );
}

function SpeedSegment(props: {
  checked: boolean;
  label: string;
  compact?: boolean;
  speed?: string;
  description?: string | undefined;
  onPick: () => void;
}) {
  const speed = props.speed ?? props.label;
  const isFast = speed === "Fast" || speed === "Ultrafast";
  const shortLabel =
    props.compact && speed === "Standard"
      ? "Std"
      : props.compact && speed === "Ultrafast" && !props.checked
        ? ""
        : props.compact && speed === "Fast" && !props.checked
          ? ""
          : props.compact && speed === "Ultrafast"
            ? "Ultra"
            : speed === "Standard"
              ? "Std"
              : props.label;
  const buttonProps = {
    type: "button",
    role: "radio",
    "aria-checked": props.checked,
    "aria-label": props.label,
    "data-checked": props.checked ? "true" : undefined,
    className:
      "model-picker-speed-option focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
    onClick: props.onPick,
  } as const;
  const content = (
    <>
      {isFast ? (
        <span className={cn("inline-flex items-center", props.checked && "text-warning")}>
          <FastBolt ultra={speed === "Ultrafast"} />
        </span>
      ) : null}
      {shortLabel ? <span>{shortLabel}</span> : null}
    </>
  );
  if (!props.description) return <button {...buttonProps}>{content}</button>;
  return (
    <Tooltip>
      <TooltipTrigger render={<button {...buttonProps} />}>{content}</TooltipTrigger>
      <TooltipPopup side="top">{props.description}</TooltipPopup>
    </Tooltip>
  );
}

function SpeedControl(props: { traits: TraitsSelection }) {
  const gt = useGT();
  const { traits } = props;
  const { speedSelect, fastToggle } = splitSpeed(
    traits.selectDescriptors,
    traits.booleanDescriptors,
  );
  if (traits.modelIsUnavailable || (!speedSelect && !fastToggle)) return null;
  const choices = speedSelect ? selectableProviderOptionChoices(speedSelect) : [];
  const compact = choices.length >= 3;
  return (
    <div
      role="radiogroup"
      aria-label={speedSelect?.label ?? fastToggle?.label}
      className="model-picker-speed-group shrink-0"
    >
      {speedSelect
        ? choices.map((option) => (
            <SpeedSegment
              key={option.id}
              checked={option.id === traits.selectValue(speedSelect)}
              label={option.label}
              compact={compact}
              description={option.description}
              onPick={() => traits.changeSelect(speedSelect, option.id)}
            />
          ))
        : fastToggle
          ? ([false, true] as const).map((value) => (
              <SpeedSegment
                key={String(value)}
                checked={(fastToggle.currentValue === true) === value}
                speed={value ? "Fast" : "Standard"}
                label={
                  value
                    ? gt("Fast", { $context: "response speed" })
                    : gt("Standard", { $context: "response speed" })
                }
                onPick={() => traits.changeBoolean(fastToggle.id, value)}
              />
            ))
          : null}
    </div>
  );
}

function UltracodeControl(props: { traits: TraitsSelectionInput }) {
  const traits = useTraitsSelection(props.traits);
  const { ultracodeToggle } = splitSpeed(traits.selectDescriptors, traits.booleanDescriptors);
  if (traits.modelIsUnavailable || !ultracodeToggle) return null;
  const on = ultracodeToggle.currentValue === true;
  return (
    <div className="model-picker-speed-group">
      <button
        type="button"
        aria-pressed={on}
        data-checked={on ? "true" : undefined}
        className="model-picker-speed-option focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        onClick={() => traits.changeBoolean(ultracodeToggle.id, !on)}
      >
        <WorkflowIcon aria-hidden="true" className="size-3" />
        {ultracodeToggle.label}
      </button>
    </div>
  );
}

function EffortSectionContent(props: { traits: TraitsSelectionInput }) {
  const gt = useGT();
  const traits = useTraitsSelection(props.traits);
  const { effort, others } = columnControls(traits.selectDescriptors, traits.booleanDescriptors);
  const { speedSelect, fastToggle } = splitSpeed(
    traits.selectDescriptors,
    traits.booleanDescriptors,
  );
  const hasSpeed = !traits.modelIsUnavailable && (speedSelect !== null || fastToggle !== null);

  if (traits.modelIsUnavailable) {
    if (traits.descriptors.length === 0) return null;
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-2.5">
        {traits.descriptors.map((descriptor) => {
          const value = traits.currentLabel(descriptor);
          return value ? (
            <div key={descriptor.id} className="flex items-center gap-1.5 text-xs">
              <span className="text-muted-foreground">{descriptor.label}</span>
              <span className="font-medium text-foreground/85">{value}</span>
            </div>
          ) : null;
        })}
      </div>
    );
  }

  if (!effort && !hasSpeed && others.length === 0) {
    return (
      <div className="flex h-8 items-center px-3.5 text-xs text-muted-foreground">
        <T>No effort levels</T>
      </div>
    );
  }

  const locked =
    effort?.descriptor.id === traits.primarySelectDescriptor?.id && traits.ultrathinkInBodyText;
  const heading =
    effort?.descriptor.label ??
    (hasSpeed
      ? gt("Speed", { $context: "heading for model speed control" })
      : gt("Options", { $context: "heading for model options" }));

  return (
    <div
      className="flex flex-col gap-2.5 border-t border-border/60 bg-muted/20 px-3.5 py-2.5"
      onKeyDownCapture={moveBetweenRows}
    >
      {effort || hasSpeed ? (
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-foreground/80">{heading}</span>
          <SpeedControl traits={traits} />
        </div>
      ) : null}

      {effort ? <EffortSliderSection control={effort} traits={traits} locked={locked} /> : null}

      {others.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1 pt-0.5">
          {others.map((control, index) =>
            control.kind === "boolean" ? (
              <OptionSwitchRow
                key={control.descriptor.id}
                descriptor={control.descriptor}
                traits={traits}
                tabStop={(!effort || locked) && index === 0}
              />
            ) : (
              <OptionMenuRow
                key={control.descriptor.id}
                descriptor={control.descriptor}
                traits={traits}
                tabStop={(!effort || locked) && index === 0}
              />
            ),
          )}
        </div>
      ) : null}
    </div>
  );
}

/** The model picker's power zone: full-capsule reasoning slider, inline speed toggle, and extra options. */
export function ComposerEffortColumn(props: { traits: TraitsSelectionInput | null }) {
  if (!props.traits) {
    return (
      <div className="flex h-8 items-center border-t border-border/60 bg-muted/20 px-3.5 text-xs text-muted-foreground">
        <T>No effort levels</T>
      </div>
    );
  }
  return <EffortSectionContent traits={props.traits} />;
}

/** Permissions change rarely, so the footer names the mode and nests the choice in a menu. */
function PermissionsMenu(props: {
  runtimeMode: RuntimeMode;
  options: ReadonlyArray<RuntimeModeOption>;
  onChange: (mode: RuntimeMode) => void;
}) {
  const gt = useGT();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const current = props.options.find((option) => option.mode === props.runtimeMode);
  if (!current) return null;
  const CurrentIcon = current.icon;
  return (
    <Menu
      onOpenChangeComplete={(open) => {
        if (open) focusCheckedPermission(triggerRef.current);
      }}
    >
      <MenuTrigger
        render={
          <button
            ref={triggerRef}
            type="button"
            data-composer-permissions-trigger
            aria-label={gt("Permissions: {mode}", { mode: current.label })}
            className="ms-auto flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground outline-none transition-colors hover:bg-foreground/8 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset data-popup-open:bg-foreground/8 data-popup-open:text-foreground"
          />
        }
      >
        <CurrentIcon aria-hidden="true" className="size-3.5" />
        <span className="font-medium text-foreground/85">{current.label}</span>
        <ChevronUpIcon aria-hidden="true" className="size-3" />
      </MenuTrigger>
      <MenuPopup side="top" align="end" {...composerFloatingLayerProps}>
        <ComposerPermissionsSection
          runtimeMode={props.runtimeMode}
          runtimeModeOptions={props.options}
          onRuntimeModeChange={props.onChange}
        />
      </MenuPopup>
    </Menu>
  );
}

/** The model picker's quiet bottom strip: Ultracode (when present) and permissions menu. */
export function ComposerPickerFooter(props: {
  traits: TraitsSelectionInput | null;
  runtimeMode: RuntimeMode;
  runtimeModeOptions: ReadonlyArray<RuntimeModeOption>;
  onRuntimeModeChange: (mode: RuntimeMode) => void;
}) {
  return (
    <div className="flex min-h-9 flex-wrap items-center gap-2 border-t border-border/60 bg-muted/30 px-3 py-1">
      {props.traits ? <UltracodeControl traits={props.traits} /> : null}
      <PermissionsMenu
        runtimeMode={props.runtimeMode}
        options={props.runtimeModeOptions}
        onChange={props.onRuntimeModeChange}
      />
    </div>
  );
}
