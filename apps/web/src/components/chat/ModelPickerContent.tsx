import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { restrictToParentElement, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { T, useGT, useLocale, useMessages } from "gt-react";
import { useLegendListRef } from "~/hooks/useLegendListRef";
import {
  ANTIGRAVITY_DEFAULT_MODEL,
  type ProviderInstanceId,
  type EnvironmentId,
  type ProviderDriverKind,
  type ResolvedKeybindingsConfig,
  MODEL_PICKER_JUMP_KEYBINDING_COMMANDS,
} from "@t3tools/contracts";
import type { ModelPreferences } from "@t3tools/contracts/settings";
import { resolveSelectableModel } from "@t3tools/shared/model";
import { modelFavoriteListsEqual, reorderModelFavorites } from "@t3tools/shared/serverSettings";
import { useAtomValue } from "@effect/atom-react";
import {
  formatProviderUpdateRequiredNotice,
  providerUpdateChannelLags,
} from "@t3tools/client-runtime/providerUpdateRequiredModels";
import { groupModelsBySubProvider } from "@t3tools/client-runtime/providerSubProviders";
import { useNavigate } from "@tanstack/react-router";
import { LegendList, type LegendListRef } from "@legendapp/list/react";
import {
  memo,
  useState,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  type ReactNode,
  type RefObject,
} from "react";
import { ChevronRightIcon, GripVerticalIcon, SearchIcon, XIcon } from "lucide-react";
import { ModelListRow } from "./ModelListRow";
import { ModelPickerSidebar } from "./ModelPickerSidebar";
import { useProviderWorkspaceSnapshotRefresh } from "./useProviderWorkspaceSnapshotRefresh";
import { getProviderStatusMessage, hasProviderSetup } from "./ProviderStatusBanner";
import {
  modelPickerModelKey,
  modelPickerSubProviderSectionKey,
  parseModelPickerModelKey,
} from "./modelPickerKeys";
import { rankModelPickerSearch } from "@t3tools/client-runtime/model-search";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxListVirtualized,
} from "../ui/combobox";
import { ModelEsque } from "./providerIconUtils";
import { isCommandPaletteOpen } from "../../commandPaletteBus";
import { registerModelPickerContent } from "../../modelPickerVisibility";
import { primaryServerKeybindingsAtom } from "../../state/server";
import {
  modelPickerJumpCommandForIndex,
  modelPickerJumpIndexFromCommand,
  resolveShortcutCommand,
  shortcutLabelForCommand,
} from "../../keybindings";
import {
  useEnvironmentModelPreferences,
  useToggleEnvironmentModelFavorite,
  useUpdateEnvironmentModelPreferences,
} from "~/hooks/useSettings";
import { announce } from "~/lib/announce";
import { cn } from "~/lib/utils";
import { TooltipProvider } from "../ui/tooltip";
import { InlineButton } from "../ui/button";
import { Badge } from "../ui/badge";
import {
  isProviderInstancePickerReady,
  isProviderInstancePickerVisible,
  shouldShowInstanceBadge,
  type ProviderInstanceEntry,
} from "../../providerInstances";
import { providerModelKey, sortProviderModelItems } from "../../modelOrdering";
import { hasRuntimeModelCatalog } from "../../providerModels";

type ModelPickerItem = {
  slug: string;
  name: string;
  shortName?: string;
  subProvider?: string;
  badge?: "new";
  instanceId: ProviderInstanceId;
  driverKind: ProviderDriverKind;
  instanceDisplayName: string;
  instanceAccentColor?: string | undefined;
  acpRegistryAgentId?: string | undefined;
  acpRegistryIconUrl?: string | undefined;
  continuationGroupKey?: string | undefined;
  isLegacy?: boolean | undefined;
  isUnavailable?: boolean | undefined;
};

export function resolveModelPickerSelectedModel(input: {
  driverKind: ProviderDriverKind | undefined;
  model: string;
  options: ReadonlyArray<ModelEsque>;
}) {
  if (input.driverKind === "antigravity" && input.model === ANTIGRAVITY_DEFAULT_MODEL) {
    const availableModels = input.options.filter(
      (option) => option.slug !== ANTIGRAVITY_DEFAULT_MODEL && !option.isUnavailable,
    );
    return (
      availableModels.find((option) => option.aliases?.includes(ANTIGRAVITY_DEFAULT_MODEL)) ??
      availableModels.find((option) => option.isDefault)
    );
  }
  return input.options.find((option) => option.slug === input.model);
}

function shouldIncludeModelPickerOption(input: {
  readonly entry: ProviderInstanceEntry;
  readonly option: ModelEsque;
  readonly activeInstanceId: ProviderInstanceId;
  readonly activeModel: string;
}): boolean {
  if (input.entry.driverKind === "antigravity" && input.option.slug === ANTIGRAVITY_DEFAULT_MODEL) {
    return false;
  }
  if (isProviderInstancePickerReady(input.entry)) return true;
  return (
    input.entry.enabled &&
    hasRuntimeModelCatalog(input.entry.driverKind) &&
    input.entry.instanceId === input.activeInstanceId &&
    input.option.slug === input.activeModel &&
    input.option.isUnavailable === true
  );
}

function shouldOfferModelPickerSetup(
  entry: ProviderInstanceEntry,
  options: ReadonlyArray<ModelEsque>,
): boolean {
  return (
    entry.enabled &&
    entry.status !== "disabled" &&
    hasProviderSetup(entry.snapshot) &&
    (!isProviderInstancePickerReady(entry) ||
      !entry.installed ||
      entry.snapshot.auth.status === "unauthenticated" ||
      !options.some((option) => !option.isUnavailable))
  );
}

function adjacentModelPickerProvider(input: {
  entries: ReadonlyArray<ProviderInstanceEntry>;
  selectedInstanceId: ProviderInstanceId | "favorites";
  direction: 1 | -1;
  disabledInstanceIds: ReadonlySet<ProviderInstanceId> | undefined;
  selectableUnavailableInstanceIds: ReadonlySet<ProviderInstanceId> | undefined;
}) {
  const providers: Array<ProviderInstanceId | "favorites"> = [
    "favorites",
    ...input.entries
      .filter(
        (entry) =>
          !input.disabledInstanceIds?.has(entry.instanceId) &&
          (isProviderInstancePickerReady(entry) ||
            input.selectableUnavailableInstanceIds?.has(entry.instanceId)),
      )
      .map((entry) => entry.instanceId),
  ];
  const index = providers.indexOf(input.selectedInstanceId);
  return providers[
    index < 0
      ? input.direction === 1
        ? 0
        : providers.length - 1
      : (index + input.direction + providers.length) % providers.length
  ]!;
}

const EMPTY_MODEL_JUMP_LABELS = new Map<string, string>();
const MODEL_LIST_ESTIMATED_ITEM_SIZE = 32;
export const MODEL_PICKER_LAST_TAB_STORAGE_KEY = "t4code:model-picker-last-tab:v1";

function readLastModelPickerTab(): string | null {
  try {
    const raw = window.localStorage.getItem(MODEL_PICKER_LAST_TAB_STORAGE_KEY);
    return raw && raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

function writeLastModelPickerTab(tab: string): void {
  try {
    window.localStorage.setItem(MODEL_PICKER_LAST_TAB_STORAGE_KEY, tab);
  } catch {
    // Ignore storage quota or private-browsing failures.
  }
}

function ModelListSeparator() {
  return <div className="h-0.5" />;
}

function modelJumpLabelsByKey(
  modelKeys: ReadonlyArray<string>,
  keybindings: ResolvedKeybindingsConfig,
  terminalOpen: boolean,
): ReadonlyMap<string, string> {
  const shortcutLabelOptions = {
    platform: navigator.platform,
    context: { terminalFocus: false, terminalOpen, modelPickerOpen: true },
  };
  const mapping = new Map<string, string>();
  for (const [index, modelKey] of modelKeys.entries()) {
    const command = modelPickerJumpCommandForIndex(index);
    const label = command && shortcutLabelForCommand(keybindings, command, shortcutLabelOptions);
    if (label) {
      mapping.set(modelKey, label);
    }
  }
  return mapping.size > 0 ? mapping : EMPTY_MODEL_JUMP_LABELS;
}

function ModelPickerProviderNotices({
  setupEntries,
  updateRequiredNotices,
  emptyLabel,
  onRequestClose,
  onOpenProviderSetup,
}: {
  setupEntries: ReadonlyArray<ProviderInstanceEntry>;
  emptyLabel: string;
  updateRequiredNotices: ReadonlyArray<{
    instanceId: ProviderInstanceId;
    notice: string;
    canUpdateInSettings: boolean;
  }>;
  onRequestClose: (() => void) | undefined;
  onOpenProviderSetup: ((instanceId: ProviderInstanceId) => void) | undefined;
}) {
  const gt = useGT();
  const messages = useMessages();
  const navigate = useNavigate();
  return (
    <>
      {setupEntries.length > 0 ? (
        <div className="max-h-40 shrink-0 overflow-y-auto border-t border-border/60 p-2.5">
          {setupEntries.map((entry) => (
            <div key={entry.instanceId} className="px-1 py-1 text-xs leading-snug">
              <p className="line-clamp-3 text-muted-foreground">
                {getProviderStatusMessage(entry.snapshot, messages)}
              </p>
              <InlineButton
                className="mt-1"
                onClick={() => {
                  onRequestClose?.();
                  onOpenProviderSetup?.(entry.instanceId);
                }}
              >
                {setupEntries.length > 1
                  ? gt("Set up {provider}", { provider: entry.displayName })
                  : gt("Open provider setup")}
              </InlineButton>
            </div>
          ))}
        </div>
      ) : (
        <ComboboxEmpty className="empty:h-0">{emptyLabel}</ComboboxEmpty>
      )}
      {updateRequiredNotices.map(({ instanceId, notice, canUpdateInSettings }) => (
        <p
          key={instanceId}
          className="shrink-0 border-t border-border/60 px-3 py-2 text-xs leading-snug text-muted-foreground"
        >
          {notice}
          {canUpdateInSettings ? (
            <>
              {" "}
              <InlineButton
                onClick={() => {
                  onRequestClose?.();
                  void navigate({ to: "/settings/providers" });
                }}
              >
                <T>Provider settings</T>
              </InlineButton>
            </>
          ) : null}
        </p>
      ))}
    </>
  );
}

function ModelPickerList({
  listRef,
  itemKeys,
  extraData,
  renderItem,
}: {
  listRef: RefObject<LegendListRef | null>;
  itemKeys: ReadonlyArray<string>;
  extraData: unknown;
  renderItem: (props: { item: string; index: number }) => ReactNode;
}) {
  const [showBottomScrollFade, setShowBottomScrollFade] = useState(false);
  const updateScrollFades = () => {
    const metrics = listRef.current?.getState();
    if (!metrics) return;
    setShowBottomScrollFade(!metrics.isAtEnd);
  };
  const scrollRef = useLegendListRef(listRef, updateScrollFades);

  return (
    <div
      data-scroll-bottom={showBottomScrollFade && itemKeys.length > 8 ? "true" : undefined}
      className={cn(
        "model-picker-list-fade relative min-h-0 overflow-hidden",
        itemKeys.length > 0 ? "h-80 max-h-80 shrink-0" : "h-0",
      )}
    >
      <ComboboxListVirtualized>
        <LegendList<string>
          ref={scrollRef}
          data={itemKeys}
          extraData={extraData}
          keyExtractor={(modelKey) => modelKey}
          renderItem={renderItem}
          estimatedItemSize={MODEL_LIST_ESTIMATED_ITEM_SIZE}
          drawDistance={480}
          recycleItems
          contentContainerClassName="px-2 py-1.5"
          ItemSeparatorComponent={ModelListSeparator}
          onLayout={updateScrollFades}
          onScroll={updateScrollFades}
          onReady={updateScrollFades}
          className="model-picker-scrollbar-none h-full overflow-x-hidden overscroll-y-contain"
        />
      </ComboboxListVirtualized>
    </div>
  );
}

function SortableFavoriteModelRow(props: {
  readonly sortableId: string;
  readonly modelName: string;
  readonly renderRow: (dragHandle: ReactNode) => ReactNode;
}) {
  const gt = useGT();
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: props.sortableId });

  const handle = (
    <span
      ref={setActivatorNodeRef}
      {...attributes}
      {...listeners}
      role="button"
      tabIndex={-1}
      aria-label={gt("Drag to reorder {name}", { name: props.modelName })}
      onPointerDown={(event) => {
        event.stopPropagation();
        listeners?.onPointerDown?.(event);
      }}
      onClick={(event) => event.stopPropagation()}
      className="flex size-4 shrink-0 cursor-grab touch-none items-center justify-center rounded text-muted-foreground/35 transition-colors hover:text-foreground active:cursor-grabbing group-hover:text-muted-foreground/75 group-data-highlighted:text-muted-foreground/75"
    >
      <GripVerticalIcon className="size-3" aria-hidden="true" />
    </span>
  );

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(isDragging && "relative z-20 rounded-lg bg-popover shadow-md")}
    >
      {props.renderRow(handle)}
    </div>
  );
}

function SortableFavoritesModelList(props: {
  readonly models: ReadonlyArray<ModelPickerItem>;
  readonly onReorder: (fromKey: string, toKey: string) => void;
  readonly renderModel: (model: ModelPickerItem, index: number, dragHandle: ReactNode) => ReactNode;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const sortableKeys = props.models.map((model) => providerModelKey(model.instanceId, model.slug));

  const handleDragEnd = (event: DragEndEvent) => {
    if (event.over === null || event.active.id === event.over.id) return;
    props.onReorder(String(event.active.id), String(event.over.id));
  };

  return (
    <div className="relative h-80 max-h-80 min-h-0 shrink-0 overflow-hidden">
      <ComboboxListVirtualized>
        <div className="model-picker-scrollbar-none h-full space-y-0.5 overflow-x-hidden overflow-y-auto overscroll-y-contain px-2 py-1.5">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToVerticalAxis, restrictToParentElement]}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={sortableKeys} strategy={verticalListSortingStrategy}>
              {props.models.map((model, index) => {
                const sortableId = providerModelKey(model.instanceId, model.slug);
                return (
                  <SortableFavoriteModelRow
                    key={modelPickerModelKey(model.instanceId, model.slug)}
                    sortableId={sortableId}
                    modelName={model.name}
                    renderRow={(dragHandle) => props.renderModel(model, index, dragHandle)}
                  />
                );
              })}
            </SortableContext>
          </DndContext>
        </div>
      </ComboboxListVirtualized>
    </div>
  );
}

// Capture gives picker shortcuts priority over the composer.
function WindowKeyDownListener({ onKeyDown }: { onKeyDown: (event: KeyboardEvent) => void }) {
  const handleKeyDown = useEffectEvent(onKeyDown);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes a capture-phase window keydown listener for the picker's lifetime
  useEffect(() => {
    const listener = (event: KeyboardEvent) => handleKeyDown(event);
    window.addEventListener("keydown", listener, true);
    return () => {
      window.removeEventListener("keydown", listener, true);
    };
  }, []);
  return null;
}

export const ModelPickerContent = memo(function ModelPickerContent(props: {
  environmentId: EnvironmentId | null;
  workspaceCwd?: string | null;
  activeInstanceId: ProviderInstanceId;
  model: string;
  selectedModels?: ReadonlyArray<{ instanceId: ProviderInstanceId; model: string }>;
  onToggleModel?: (instanceId: ProviderInstanceId, model: string) => void;
  lockedProvider: ProviderDriverKind | null;
  lockedContinuationGroupKey?: string | null;
  instanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  keybindings?: ResolvedKeybindingsConfig;
  modelOptionsByInstance: ReadonlyMap<ProviderInstanceId, ReadonlyArray<ModelEsque>>;
  terminalOpen: boolean;
  onRequestClose?: () => void;
  onOpenProviderSetup?: (instanceId: ProviderInstanceId) => void;
  getModelDisabledReason?: (instanceId: ProviderInstanceId, model: string) => string | null;
  onInstanceModelChange: (instanceId: ProviderInstanceId, model: string) => void;
  searchInputRef: RefObject<HTMLInputElement | null>;
  docked?: boolean;
  onFocusEffort?: () => void;
  listFooter?: ReactNode;
}) {
  const gt = useGT();
  const messages = useMessages();
  const locale = useLocale();
  const {
    searchInputRef,
    keybindings: providedKeybindings,
    modelOptionsByInstance,
    instanceEntries,
    getModelDisabledReason,
    onInstanceModelChange,
    onToggleModel,
    onRequestClose,
    onOpenProviderSetup,
  } = props;
  const [searchQuery, setSearchQuery] = useState("");
  const [searchExpanded, setSearchExpanded] = useState(false);
  const modelListRef = useRef<LegendListRef | null>(null);
  const pickerContentRef = useRef<HTMLDivElement>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- publishes this picker's mount to global keydown handlers
  useLayoutEffect(() => registerModelPickerContent(), []);
  const highlightedModelKeyRef = useRef<string | null>(null);
  const { favorites: savedFavorites } = useEnvironmentModelPreferences(props.environmentId);
  const [pendingFavoriteOrder, setPendingFavoriteOrder] = useState<
    ModelPreferences["favorites"] | null
  >(null);
  if (
    pendingFavoriteOrder !== null &&
    modelFavoriteListsEqual(pendingFavoriteOrder, savedFavorites)
  ) {
    setPendingFavoriteOrder(null);
  }
  const favorites = pendingFavoriteOrder ?? savedFavorites;
  const activeEntry = props.instanceEntries.find(
    (entry) => entry.instanceId === props.activeInstanceId,
  );
  const activeModel = resolveModelPickerSelectedModel({
    driverKind: activeEntry?.driverKind,
    model: props.model,
    options: modelOptionsByInstance.get(props.activeInstanceId) ?? [],
  });
  const activeModelSlug =
    activeModel?.slug ?? (props.model === ANTIGRAVITY_DEFAULT_MODEL ? "" : props.model);
  const activeModelKey = activeModelSlug
    ? modelPickerModelKey(props.activeInstanceId, activeModelSlug)
    : null;
  const selectedModelKeys = props.selectedModels?.map((selection) => {
    const entry = instanceEntries.find((entry) => entry.instanceId === selection.instanceId);
    const model = resolveModelPickerSelectedModel({
      driverKind: entry?.driverKind,
      model: selection.model,
      options: modelOptionsByInstance.get(selection.instanceId) ?? [],
    });
    return modelPickerModelKey(selection.instanceId, model?.slug ?? selection.model);
  });
  const selectedModelKeySet = new Set(
    selectedModelKeys ?? (activeModelKey ? [activeModelKey] : []),
  );
  const activeInstanceHasSelectableUnavailableModel =
    activeEntry !== undefined &&
    (modelOptionsByInstance.get(props.activeInstanceId) ?? []).some((option) =>
      shouldIncludeModelPickerOption({
        entry: activeEntry,
        option,
        activeInstanceId: props.activeInstanceId,
        activeModel: activeModelSlug,
      }),
    ) &&
    !isProviderInstancePickerReady(activeEntry);
  const activeInstanceNeedsSetup =
    onOpenProviderSetup !== undefined &&
    activeEntry !== undefined &&
    shouldOfferModelPickerSetup(
      activeEntry,
      modelOptionsByInstance.get(props.activeInstanceId) ?? [],
    );
  const [selectedInstanceId, setSelectedInstanceId] = useState<ProviderInstanceId | "favorites">(
    () => {
      if (
        props.lockedProvider !== null ||
        activeInstanceHasSelectableUnavailableModel ||
        activeInstanceNeedsSetup
      ) {
        return props.activeInstanceId;
      }
      const savedTab = readLastModelPickerTab();
      if (savedTab === "favorites") {
        return "favorites";
      }
      if (savedTab !== null) {
        const savedEntry = instanceEntries.find((entry) => entry.instanceId === savedTab);
        if (
          savedEntry !== undefined &&
          (isProviderInstancePickerReady(savedEntry) ||
            savedEntry.instanceId === props.activeInstanceId)
        ) {
          return savedEntry.instanceId;
        }
      }
      const hasPickableFavorite = favorites.some((favorite) => {
        const entry = instanceEntries.find((entry) => entry.instanceId === favorite.provider);
        return (
          entry !== undefined &&
          (modelOptionsByInstance.get(favorite.provider) ?? []).some(
            (option) =>
              option.slug === favorite.model &&
              shouldIncludeModelPickerOption({
                entry,
                option,
                activeInstanceId: props.activeInstanceId,
                activeModel: activeModelSlug,
              }),
          )
        );
      });
      return hasPickableFavorite ? "favorites" : props.activeInstanceId;
    },
  );
  const { scanning: workspaceModelsScanning } = useProviderWorkspaceSnapshotRefresh({
    environmentId: props.environmentId,
    gitCwd: props.workspaceCwd ?? null,
    instanceId: selectedInstanceId === "favorites" ? undefined : selectedInstanceId,
  });
  const favoriteOrderKeys = favorites.map((fav) => providerModelKey(fav.provider, fav.model));
  const favoritesSet = new Set(favoriteOrderKeys);
  const [expandedSubProviderKeys, setExpandedSubProviderKeys] = useState(
    () =>
      new Set<string>(
        activeModel?.subProvider
          ? [modelPickerSubProviderSectionKey(props.activeInstanceId, activeModel.subProvider)]
          : [],
      ),
  );
  const serverKeybindings = useAtomValue(primaryServerKeybindingsAtom);
  const keybindings = providedKeybindings ?? serverKeybindings;
  const rawToggleFavorite = useToggleEnvironmentModelFavorite(props.environmentId);
  const updateModelPreferences = useUpdateEnvironmentModelPreferences(props.environmentId);
  const toggleFavorite = (provider: ProviderInstanceId, slug: string) => {
    setPendingFavoriteOrder(null);
    return rawToggleFavorite(provider, slug);
  };
  const reorderFavorites = (visibleKeys: ReadonlyArray<string>, fromKey: string, toKey: string) => {
    if (!props.environmentId) return;
    const nextFavorites = reorderModelFavorites(favorites, visibleKeys, fromKey, toKey);
    if (modelFavoriteListsEqual(nextFavorites, favorites)) return;
    setPendingFavoriteOrder(nextFavorites);
    void updateModelPreferences({ favorites: nextFavorites }).then((result) => {
      if (result && result._tag === "Failure") {
        setPendingFavoriteOrder(null);
      }
    });
  };

  const focusSearchInput = () => {
    searchInputRef.current?.focus({ preventScroll: true });
  };

  const handleSelectInstance = (instanceId: ProviderInstanceId | "favorites") => {
    setSelectedInstanceId(instanceId);
    if (props.lockedProvider === null) {
      writeLastModelPickerTab(instanceId);
    }
    if (window.matchMedia("(pointer: coarse)").matches) return;
    window.requestAnimationFrame(() => {
      focusSearchInput();
    });
  };

  const toggleSubProviderSection = (key: string) => {
    setExpandedSubProviderKeys((expanded) => {
      const next = new Set(expanded);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  };

  const handleModelSelect = (
    modelSlug: string,
    instanceId: ProviderInstanceId,
    additive = false,
  ): string | null => {
    if (getModelDisabledReason?.(instanceId, modelSlug)) {
      return null;
    }
    const options = modelOptionsByInstance.get(instanceId);
    if (!options) {
      return null;
    }
    const entry = instanceEntries.find((candidate) => candidate.instanceId === instanceId);
    if (!entry) {
      return null;
    }
    const resolvedModel = resolveSelectableModel(entry.driverKind, modelSlug, options);
    if (!resolvedModel) return null;
    if (additive && onToggleModel) {
      onToggleModel(instanceId, resolvedModel);
    } else {
      onInstanceModelChange(instanceId, resolvedModel);
    }
    return resolvedModel;
  };

  const modelJumpShortcutContext = {
    terminalFocus: false,
    terminalOpen: props.terminalOpen,
    modelPickerOpen: true,
  } as const;
  const lockedProvider = props.lockedProvider;
  const lockedContinuationGroupKey = props.lockedContinuationGroupKey;
  const canOpenProviderSetup = onOpenProviderSetup !== undefined;

  const entryByInstanceId = new Map(instanceEntries.map((entry) => [entry.instanceId, entry]));
  const matchesLockedProvider = (
    entry: Pick<ProviderInstanceEntry, "driverKind" | "continuationGroupKey">,
  ): boolean => {
    if (lockedProvider === null) return true;
    if (entry.driverKind !== lockedProvider) return false;
    if (!lockedContinuationGroupKey) return true;
    return entry.continuationGroupKey === lockedContinuationGroupKey;
  };

  const selectableUnavailableInstanceIds = (() => {
    const instanceIds = new Set<ProviderInstanceId>();
    if (activeInstanceHasSelectableUnavailableModel) {
      instanceIds.add(props.activeInstanceId);
    }
    if (canOpenProviderSetup) {
      for (const entry of instanceEntries) {
        if (
          shouldOfferModelPickerSetup(entry, modelOptionsByInstance.get(entry.instanceId) ?? [])
        ) {
          instanceIds.add(entry.instanceId);
        }
      }
    }
    return instanceIds.size > 0 ? instanceIds : undefined;
  })();

  const flatModels = (() => {
    const out: ModelPickerItem[] = [];
    const seenKeys = new Set<string>();
    for (const [instanceId, models] of modelOptionsByInstance) {
      const entry = entryByInstanceId.get(instanceId);
      if (!entry) {
        continue;
      }
      for (const model of models) {
        const key = modelPickerModelKey(instanceId, model.slug);
        if (
          seenKeys.has(key) ||
          !shouldIncludeModelPickerOption({
            entry,
            option: model,
            activeInstanceId: props.activeInstanceId,
            activeModel: activeModelSlug,
          })
        ) {
          continue;
        }
        seenKeys.add(key);
        out.push({
          slug: model.slug,
          name: model.name,
          ...(model.shortName ? { shortName: model.shortName } : {}),
          ...(model.subProvider ? { subProvider: model.subProvider } : {}),
          ...(model.badge ? { badge: model.badge } : {}),
          ...(model.isLegacy ? { isLegacy: true } : {}),
          ...(model.isUnavailable ? { isUnavailable: true } : {}),
          instanceId,
          driverKind: entry.driverKind,
          instanceDisplayName: entry.displayName,
          ...(entry.accentColor ? { instanceAccentColor: entry.accentColor } : {}),
          ...(entry.acpRegistryAgentId ? { acpRegistryAgentId: entry.acpRegistryAgentId } : {}),
          ...(entry.acpRegistryIconUrl ? { acpRegistryIconUrl: entry.acpRegistryIconUrl } : {}),
          ...(entry.continuationGroupKey
            ? { continuationGroupKey: entry.continuationGroupKey }
            : {}),
        });
      }
    }
    return out;
  })();

  const subProvidersByInstance = new Map(
    instanceEntries.flatMap((entry) =>
      entry.snapshot.subProviders?.length
        ? [[entry.instanceId, entry.snapshot.subProviders] as const]
        : [],
    ),
  );
  const isLocked = lockedProvider !== null;
  const isSearching = searchQuery.trim().length > 0;
  const showSearchBar = isSearching || searchExpanded;

  const lockedDisabledInstanceIds = (() => {
    if (!isLocked) {
      return undefined;
    }
    const disabled = new Set<ProviderInstanceId>();
    for (const entry of instanceEntries) {
      if (!matchesLockedProvider(entry)) {
        disabled.add(entry.instanceId);
      }
    }
    return disabled;
  })();
  const sidebarInstanceEntries = (() => {
    const enabledEntries = instanceEntries.filter(isProviderInstancePickerVisible);
    if (!isLocked) {
      return enabledEntries;
    }
    const available: ProviderInstanceEntry[] = [];
    const disabled: ProviderInstanceEntry[] = [];
    for (const entry of enabledEntries) {
      if (matchesLockedProvider(entry)) {
        available.push(entry);
      } else {
        disabled.push(entry);
      }
    }
    return [...available, ...disabled];
  })();
  const showSidebar = !showSearchBar && sidebarInstanceEntries.length > 0;
  const instanceOrder = instanceEntries.map((entry) => entry.instanceId);

  const filteredModels = (() => {
    let result = flatModels;

    if (isSearching) {
      const candidates =
        lockedProvider !== null ? result.filter((m) => matchesLockedProvider(m)) : result;
      return rankModelPickerSearch(candidates, searchQuery, (model) => ({
        name: model.name,
        slug: model.slug,
        ...(model.shortName ? { shortName: model.shortName } : {}),
        ...(model.subProvider ? { subProvider: model.subProvider } : {}),
        driverKind: model.driverKind,
        providerDisplayName: model.instanceDisplayName,
        isFavorite: favoritesSet.has(providerModelKey(model.instanceId, model.slug)),
      }));
    }

    if (lockedProvider !== null) {
      result = result.filter((m) => matchesLockedProvider(m));
      if (selectedInstanceId === "favorites") {
        result = result.filter((m) => favoritesSet.has(providerModelKey(m.instanceId, m.slug)));
      } else {
        result = result.filter((m) => m.instanceId === selectedInstanceId);
      }
    } else if (selectedInstanceId === "favorites") {
      result = result.filter((m) => favoritesSet.has(providerModelKey(m.instanceId, m.slug)));
    } else {
      result = result.filter((m) => m.instanceId === selectedInstanceId);
    }

    const sorted = sortProviderModelItems(result, {
      favoriteModelKeys: favoritesSet,
      ...(selectedInstanceId === "favorites" ? { favoriteOrderKeys } : {}),
      groupFavorites: selectedInstanceId !== "favorites",
      instanceOrder: selectedInstanceId === "favorites" ? instanceOrder : [],
    });
    if (selectedInstanceId === "favorites") return sorted;
    // Keep non-legacy models first and trail legacy models below so direct scrolling reveals all.
    const current: ModelPickerItem[] = [];
    const legacy: ModelPickerItem[] = [];
    for (const model of sorted) {
      const isLegacy =
        model.isLegacy && !favoritesSet.has(providerModelKey(model.instanceId, model.slug));
      (isLegacy ? legacy : current).push(model);
    }
    return [...current, ...legacy];
  })();

  const subProviderSections = (() => {
    const subProviders =
      isSearching || selectedInstanceId === "favorites"
        ? undefined
        : subProvidersByInstance.get(selectedInstanceId);
    if (!subProviders || selectedInstanceId === "favorites") return null;
    const { ungrouped, groups } = groupModelsBySubProvider(
      filteredModels,
      subProviders,
      (model) => model.subProvider,
    );
    return {
      ungrouped,
      sections: groups.map(({ subProvider, models }) => {
        const key = modelPickerSubProviderSectionKey(selectedInstanceId, subProvider.name);
        return {
          key,
          name: subProvider.name,
          unavailableReason: subProvider.unavailableReason,
          models,
          isExpanded: expandedSubProviderKeys.has(key),
        };
      }),
    };
  })();
  const subProviderSectionByKey = new Map(
    subProviderSections?.sections.map((section) => [section.key, section] as const),
  );

  const visibleModels = (() => {
    if (subProviderSections) {
      return [
        ...subProviderSections.ungrouped,
        ...subProviderSections.sections.flatMap((section) =>
          section.isExpanded ? section.models : [],
        ),
      ];
    }
    return filteredModels;
  })();

  const selectedEntry =
    selectedInstanceId === "favorites" ? undefined : entryByInstanceId.get(selectedInstanceId);
  const providerSetupEntries =
    !isSearching && canOpenProviderSetup
      ? instanceEntries.filter(
          (entry) =>
            matchesLockedProvider(entry) &&
            shouldOfferModelPickerSetup(
              entry,
              modelOptionsByInstance.get(entry.instanceId) ?? [],
            ) &&
            (selectedEntry
              ? entry.instanceId === selectedEntry.instanceId
              : filteredModels.length === 0),
        )
      : [];

  const updateRequiredNotices = instanceEntries.flatMap((entry) => {
    const shown = isSearching
      ? matchesLockedProvider(entry)
      : entry.instanceId === selectedEntry?.instanceId;
    const notice = shown
      ? formatProviderUpdateRequiredNotice(entry.snapshot, searchQuery, messages, locale)
      : null;
    return notice
      ? [
          {
            instanceId: entry.instanceId,
            notice,
            canUpdateInSettings: !providerUpdateChannelLags(entry.snapshot, searchQuery),
          },
        ]
      : [];
  });

  const modelJumpModelKeys = visibleModels
    .filter((model) => !getModelDisabledReason?.(model.instanceId, model.slug))
    .slice(0, MODEL_PICKER_JUMP_KEYBINDING_COMMANDS.length)
    .map((model) => modelPickerModelKey(model.instanceId, model.slug));
  const allItemKeys = ((): string[] => [
    ...flatModels.map((model) => modelPickerModelKey(model.instanceId, model.slug)),
    ...[...subProvidersByInstance].flatMap(([instanceId, subProviders]) =>
      subProviders.map((subProvider) =>
        modelPickerSubProviderSectionKey(instanceId, subProvider.name),
      ),
    ),
  ])();
  const filteredItemKeys = ((): string[] => {
    const keyOf = (model: ModelPickerItem) => modelPickerModelKey(model.instanceId, model.slug);
    if (subProviderSections) {
      return [
        ...subProviderSections.ungrouped.map(keyOf),
        ...subProviderSections.sections.flatMap((section) => [
          section.key,
          ...(section.isExpanded ? section.models.map(keyOf) : []),
        ]),
      ];
    }
    return visibleModels.map(keyOf);
  })();
  const filteredModelByKey = ((): ReadonlyMap<string, ModelPickerItem> =>
    new Map(
      visibleModels.map(
        (model) => [modelPickerModelKey(model.instanceId, model.slug), model] as const,
      ),
    ))();

  const modelJumpLabelByKey = modelJumpLabelsByKey(
    modelJumpModelKeys,
    keybindings,
    props.terminalOpen,
  );
  const badgedInstanceIds = new Set(
    instanceEntries
      .filter((entry) => shouldShowInstanceBadge(entry, instanceEntries))
      .map((entry) => entry.instanceId),
  );
  const modelListExtraData = {
    badgedInstanceIds,
    favoritesSet,
    modelJumpLabelByKey,
    activeModelKey,
    selectedModelKeySet,
    showProviderIcon: isSearching || selectedInstanceId === "favorites",
  };

  const onWindowKeyDown = (event: globalThis.KeyboardEvent) => {
    if (
      event.defaultPrevented ||
      event.repeat ||
      event.isComposing ||
      event.keyCode === 229 ||
      isCommandPaletteOpen()
    ) {
      return;
    }

    const command = resolveShortcutCommand(event, keybindings, {
      platform: navigator.platform,
      context: modelJumpShortcutContext,
    });
    if (command === "modelPicker.previousProvider" || command === "modelPicker.nextProvider") {
      event.preventDefault();
      event.stopPropagation();
      const next = adjacentModelPickerProvider({
        entries: sidebarInstanceEntries,
        selectedInstanceId,
        direction: command === "modelPicker.nextProvider" ? 1 : -1,
        disabledInstanceIds: lockedDisabledInstanceIds,
        selectableUnavailableInstanceIds,
      });
      setSearchQuery("");
      setSearchExpanded(false);
      handleSelectInstance(next);
      announce(
        next === "favorites" ? gt("Favorites") : (entryByInstanceId.get(next)?.displayName ?? next),
        "model-picker",
      );
      return;
    }
    const jumpIndex = modelPickerJumpIndexFromCommand(command ?? "");
    if (jumpIndex === null) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();

    const targetModelKey = modelJumpModelKeys[jumpIndex];
    if (!targetModelKey) {
      return;
    }
    const model = parseModelPickerModelKey(targetModelKey);
    if (!model) {
      return;
    }
    const selectedSlug = handleModelSelect(model.slug, model.instanceId);
    if (selectedSlug === null) return;
    const name = flatModels.find(
      (item) => item.slug === selectedSlug && item.instanceId === model.instanceId,
    )?.name;
    announce(gt("Model: {name}", { name: name ?? selectedSlug }), "model-picker");
  };

  const openSearch = () => {
    setSearchExpanded(true);
    window.requestAnimationFrame(() => {
      focusSearchInput();
    });
  };

  const closeSearch = () => {
    setSearchQuery("");
    setSearchExpanded(false);
    if (!window.matchMedia("(pointer: coarse)").matches) {
      window.requestAnimationFrame(() => {
        focusSearchInput();
      });
    }
  };

  return (
    <TooltipProvider delay={0}>
      <WindowKeyDownListener onKeyDown={onWindowKeyDown} />
      <div
        ref={pickerContentRef}
        className={cn(
          "relative flex flex-col overflow-hidden bg-popover",
          props.docked ? "w-full" : "w-84 max-w-full",
        )}
        data-model-picker-content="true"
      >
        <Combobox<string, boolean>
          inline
          items={allItemKeys}
          filteredItems={filteredItemKeys}
          filter={null}
          autoHighlight
          open
          virtualized
          multiple={onToggleModel !== undefined}
          value={onToggleModel ? [...selectedModelKeySet] : activeModelKey}
          onItemHighlighted={(modelKey, eventDetails) => {
            highlightedModelKeyRef.current = typeof modelKey === "string" ? modelKey : null;
            if (eventDetails.reason === "keyboard" && eventDetails.index >= 0) {
              void modelListRef.current?.scrollIndexIntoView?.({
                index: eventDetails.index,
                animated: false,
              });
            }
          }}
          onValueChange={(value, details) => {
            const modelKey = Array.isArray(value)
              ? (value.find((key) => !selectedModelKeySet.has(key)) ??
                [...selectedModelKeySet].find((key) => !value.includes(key)))
              : value;
            if (typeof modelKey !== "string") {
              return;
            }
            if (subProviderSectionByKey.has(modelKey)) {
              toggleSubProviderSection(modelKey);
              return;
            }
            const model = parseModelPickerModelKey(modelKey);
            if (model) {
              handleModelSelect(
                model.slug,
                model.instanceId,
                "shiftKey" in details.event && details.event.shiftKey === true,
              );
            }
          }}
        >
          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
            {showSidebar ? (
              <ModelPickerSidebar
                selectedInstanceId={selectedInstanceId}
                onSelectInstance={handleSelectInstance}
                onFocusSearch={focusSearchInput}
                instanceEntries={sidebarInstanceEntries}
                showFavorites
                {...(selectableUnavailableInstanceIds ? { selectableUnavailableInstanceIds } : {})}
                {...(lockedDisabledInstanceIds
                  ? {
                      disabledInstanceIds: lockedDisabledInstanceIds,
                      getDisabledInstanceTooltip: (entry: ProviderInstanceEntry) =>
                        gt(
                          "{provider} is unavailable in this thread. Start a new thread to switch providers.",
                          { provider: entry.displayName },
                        ),
                    }
                  : {})}
                trailing={
                  <button
                    type="button"
                    aria-label={gt("Search models")}
                    onClick={openSearch}
                    className="flex size-7.5 cursor-pointer items-center justify-center rounded-full text-foreground/70 transition-colors hover:bg-foreground/10 hover:text-foreground focus-visible:bg-foreground/10 focus-visible:outline-none"
                  >
                    <SearchIcon className="size-3.5" aria-hidden="true" />
                  </button>
                }
              />
            ) : null}

            {/* Persistent input keeps initialFocus and type-to-search active even while provider pills are shown. */}
            <div
              className={cn(
                showSearchBar || sidebarInstanceEntries.length === 0
                  ? "flex h-11 shrink-0 items-center gap-2 border-b border-border/60 px-3"
                  : "sr-only",
              )}
            >
              <SearchIcon
                aria-hidden="true"
                className="size-3.5 shrink-0 text-muted-foreground/70"
              />
              <ComboboxInput
                ref={searchInputRef}
                placeholder={gt("Search models...")}
                value={searchQuery}
                showTrigger={false}
                size="sm"
                unstyled
                className="flex min-w-0 flex-1 [&_input]:h-7"
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  if (e.target.value.length > 0 && !searchExpanded) {
                    setSearchExpanded(true);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing || e.keyCode === 229) {
                    (
                      e as typeof e & { preventBaseUIHandler?: () => void }
                    ).preventBaseUIHandler?.();
                    e.stopPropagation();
                    return;
                  }
                  if (
                    showSidebar &&
                    !e.altKey &&
                    !e.ctrlKey &&
                    !e.metaKey &&
                    ((e.key === "ArrowLeft" && !e.shiftKey && searchQuery.length === 0) ||
                      (e.key === "Tab" && e.shiftKey))
                  ) {
                    const sidebar = e.currentTarget
                      .closest("[data-model-picker-content]")
                      ?.querySelector("[data-model-picker-sidebar]");
                    const button =
                      sidebar?.querySelector<HTMLButtonElement>(
                        'button[aria-pressed="true"]:not(:disabled)',
                      ) ?? sidebar?.querySelector<HTMLButtonElement>("button:not(:disabled)");
                    if (button) {
                      e.preventDefault();
                      e.stopPropagation();
                      button.focus();
                      return;
                    }
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    if (isSearching) {
                      closeSearch();
                      return;
                    }
                    onRequestClose?.();
                    return;
                  }
                  if (
                    props.onFocusEffort &&
                    e.key === "ArrowRight" &&
                    !e.altKey &&
                    !e.ctrlKey &&
                    !e.metaKey &&
                    !e.shiftKey &&
                    e.currentTarget.selectionStart === searchQuery.length
                  ) {
                    e.preventDefault();
                    e.stopPropagation();
                    const highlighted = highlightedModelKeyRef.current
                      ? parseModelPickerModelKey(highlightedModelKeyRef.current)
                      : null;
                    const pickedNew =
                      highlighted !== null &&
                      highlightedModelKeyRef.current !== activeModelKey &&
                      handleModelSelect(highlighted.slug, highlighted.instanceId) !== null;
                    if (!pickedNew) props.onFocusEffort();
                    return;
                  }
                  if (e.key === "Enter" && highlightedModelKeyRef.current) {
                    (
                      e as typeof e & { preventBaseUIHandler?: () => void }
                    ).preventBaseUIHandler?.();
                    e.preventDefault();
                    e.stopPropagation();
                    if (subProviderSectionByKey.has(highlightedModelKeyRef.current)) {
                      toggleSubProviderSection(highlightedModelKeyRef.current);
                      return;
                    }
                    const model = parseModelPickerModelKey(highlightedModelKeyRef.current);
                    if (model) {
                      handleModelSelect(model.slug, model.instanceId, e.shiftKey);
                    }
                    return;
                  }
                  e.stopPropagation();
                }}
                onMouseDown={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
              />
              {showSearchBar ? (
                <button
                  type="button"
                  aria-label={gt("Clear search")}
                  onClick={closeSearch}
                  className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
                >
                  <XIcon className="size-3.5" aria-hidden="true" />
                </button>
              ) : null}
            </div>

            {selectedInstanceId === "favorites" &&
            !isSearching &&
            visibleModels.length > 1 &&
            props.environmentId !== null ? (
              <SortableFavoritesModelList
                models={visibleModels}
                onReorder={(fromKey, toKey) =>
                  reorderFavorites(
                    visibleModels.map((model) => providerModelKey(model.instanceId, model.slug)),
                    fromKey,
                    toKey,
                  )
                }
                renderModel={(model, index, dragHandle) => {
                  const modelKey = modelPickerModelKey(model.instanceId, model.slug);
                  const disabledReason =
                    getModelDisabledReason?.(model.instanceId, model.slug) ?? null;
                  return (
                    <ModelListRow
                      key={modelKey}
                      index={index}
                      slug={model.slug}
                      name={model.name}
                      subProvider={model.subProvider}
                      instanceId={model.instanceId}
                      driverKind={model.driverKind}
                      providerDisplayName={model.instanceDisplayName}
                      providerAccentColor={model.instanceAccentColor}
                      acpRegistryAgentId={model.acpRegistryAgentId}
                      acpRegistryIconUrl={model.acpRegistryIconUrl}
                      isFavorite={favoritesSet.has(providerModelKey(model.instanceId, model.slug))}
                      isSelected={
                        selectedModelKeys !== undefined
                          ? selectedModelKeySet.has(modelKey)
                          : modelKey === activeModelKey
                      }
                      favoriteStarOnHover
                      showProviderIcon
                      showInstanceBadge={badgedInstanceIds.has(model.instanceId)}
                      showNewBadge={model.badge === "new"}
                      unavailable={model.isUnavailable === true}
                      jumpLabel={modelJumpLabelByKey.get(modelKey) ?? null}
                      disabledReason={disabledReason}
                      leadingAccessory={dragHandle}
                      onToggleFavorite={toggleFavorite}
                    />
                  );
                }}
              />
            ) : (
              <ModelPickerList
                listRef={modelListRef}
                itemKeys={filteredItemKeys}
                extraData={modelListExtraData}
                renderItem={({ item: modelKey, index }) => {
                  const subProviderSection = subProviderSectionByKey.get(modelKey);
                  if (subProviderSection) {
                    const unavailable = subProviderSection.unavailableReason !== undefined;
                    return (
                      <ComboboxItem
                        hideIndicator
                        variant="picker"
                        index={index}
                        value={modelKey}
                        disabled={unavailable}
                        aria-expanded={unavailable ? undefined : subProviderSection.isExpanded}
                        className="group w-full cursor-pointer"
                      >
                        <div className="min-w-0 flex-1 text-left">
                          <div className="flex min-w-0 items-center gap-2">
                            <div className="min-w-0 truncate font-normal leading-snug">
                              {subProviderSection.name}
                            </div>
                            {unavailable ? (
                              <Badge variant="outline" size="sm">
                                {gt("Unavailable", {
                                  $context: "backend cannot be used right now",
                                })}
                              </Badge>
                            ) : null}
                          </div>
                          <div className="mt-0.5 text-xs font-normal leading-snug text-muted-foreground">
                            {subProviderSection.unavailableReason ??
                              gt("{count, plural, one {{count} model} other {{count} models}}", {
                                count: subProviderSection.models.length,
                              })}
                          </div>
                        </div>
                        {unavailable ? null : (
                          <ChevronRightIcon
                            className={cn(
                              "size-4 shrink-0 transition-transform",
                              subProviderSection.isExpanded && "rotate-90",
                            )}
                          />
                        )}
                      </ComboboxItem>
                    );
                  }
                  const model = filteredModelByKey.get(modelKey);
                  if (!model) {
                    return null;
                  }
                  const disabledReason =
                    getModelDisabledReason?.(model.instanceId, model.slug) ?? null;
                  return (
                    <ModelListRow
                      key={modelKey}
                      index={index}
                      slug={model.slug}
                      name={model.name}
                      subProvider={model.subProvider}
                      instanceId={model.instanceId}
                      driverKind={model.driverKind}
                      providerDisplayName={model.instanceDisplayName}
                      providerAccentColor={model.instanceAccentColor}
                      acpRegistryAgentId={model.acpRegistryAgentId}
                      acpRegistryIconUrl={model.acpRegistryIconUrl}
                      isFavorite={favoritesSet.has(providerModelKey(model.instanceId, model.slug))}
                      isSelected={
                        selectedModelKeys !== undefined
                          ? selectedModelKeySet.has(modelKey)
                          : modelKey === activeModelKey
                      }
                      favoriteStarOnHover={selectedInstanceId === "favorites" && !isSearching}
                      showProviderIcon={isSearching || selectedInstanceId === "favorites"}
                      showInstanceBadge={badgedInstanceIds.has(model.instanceId)}
                      showNewBadge={model.badge === "new"}
                      unavailable={model.isUnavailable === true}
                      jumpLabel={modelJumpLabelByKey.get(modelKey) ?? null}
                      disabledReason={disabledReason}
                      onToggleFavorite={toggleFavorite}
                    />
                  );
                }}
              />
            )}
            <ModelPickerProviderNotices
              setupEntries={providerSetupEntries}
              updateRequiredNotices={updateRequiredNotices}
              emptyLabel={
                selectedInstanceId === "favorites" && !isSearching
                  ? gt("No favorites yet")
                  : workspaceModelsScanning
                    ? gt("Searching project models...")
                    : gt("No models found")
              }
              onRequestClose={onRequestClose}
              onOpenProviderSetup={onOpenProviderSetup}
            />
            {props.listFooter}
          </div>
        </Combobox>
      </div>
    </TooltipProvider>
  );
});
