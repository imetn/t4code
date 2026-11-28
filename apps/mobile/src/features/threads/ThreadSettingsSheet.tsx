import {
  getPromptControlledTraits,
  getTraitSelectChange,
  isReasoningControl,
} from "@t3tools/client-runtime/model-traits";
import type { MenuAction } from "@react-native-menu/menu";
import { useGT, useLocale, useMessages } from "gt-react-native";
import * as Dialog from "../../components/ui/Dialog";
import { DEFAULT_SERVER_SETTINGS, ProviderInstanceId } from "@t3tools/contracts";
import {
  modelPreferencesMigrationPatch,
  resolveModelPreferences,
} from "@t3tools/shared/serverSettings";
import type {
  EnvironmentId,
  ModelSelection,
  ProjectId,
  ProviderOptionDescriptor,
  ProviderOptionSelection,
  RuntimeMode,
  ServerSettings,
  ThreadId,
} from "@t3tools/contracts";
import { LegendList, type LegendListRenderItemProps } from "@legendapp/list/react-native";
import { RegistryContext, useAtomMount, useAtomValue } from "@effect/atom-react";
import {
  getProviderOptionCurrentLabel,
  getProviderOptionCurrentValue,
} from "@t3tools/shared/model";
import { useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { type NativeStackNavigationProp } from "@react-navigation/native-stack";
import * as Haptics from "expo-haptics";
import { GlassView } from "expo-glass-effect";
import { AsyncResult } from "effect/reactivity";
import {
  createContext,
  use,
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  type ScrollViewInstance,
  TextInput,
  type TextInputInstance,
  View,
} from "react-native";
import { withUniwind } from "uniwind";
import { READABLE_WIDTH_STYLE, ROW_MIN_HEIGHT } from "../../components/ui/listMetrics";
import { RefreshControl } from "../../components/ui/RefreshControl";
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";

import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { Menu } from "../../components/ui/Menu";
import { ProviderIcon } from "../../components/ProviderIcon";
import { NATIVE_LIQUID_GLASS_SUPPORTED } from "../../native/native-glass";
import { cn } from "../../lib/cn";
import { useReduceMotionEnabled } from "../../lib/appState";
import {
  buildModelOptions,
  groupByProvider,
  serverConfigForCwd,
  type ModelOption,
  type ProviderGroup,
  withStoredThreadModelOptions,
} from "../../lib/modelOptions";
import { groupModelsBySubProvider } from "@t3tools/client-runtime/providerSubProviders";
import {
  applyProviderOptionSelection,
  resolveProviderOptionDescriptors,
} from "../../lib/providerOptions";
import {
  rememberModelOptions,
  withRememberedModelOptions,
} from "../../state/use-model-option-memory";
import { ChatGptSharingStatus } from "./ChatGptSharingStatus";
import { environmentCatalog } from "../../connection/catalog";
import { useEnvironmentQuery } from "../../state/query";
import { scopedThreadKey } from "../../lib/scopedEntities";
import { useThreadReportedModelSelection } from "../../state/entities";
import {
  setComposerDraftText,
  updateComposerDraftSettings,
  useComposerDraft,
  useComposerDraftSettings,
} from "../../state/use-composer-drafts";
import { useQuietThreadStructure } from "../../state/use-thread-detail";
import { activeComposerDraftKey, useQueuedRunEdit } from "../../state/queued-run-edit";
import { selectThreadModel } from "../../state/thread-model-selection";
import { useThreadSelection } from "../../state/use-thread-selection";
import { useSelectedThreadWorktree } from "../../state/use-selected-thread-worktree";
import { providerWorkspaceSnapshotRefresh } from "../../state/provider-workspace-snapshot-refresh";
import { threadAllowsProviderSwitch } from "../../state/thread-provider-switching";
import { environmentServerConfigsAtom, serverEnvironment } from "../../state/server";
import { mobilePreferencesAtom, saveMobilePreferences } from "../../state/preferences";
import { useAtomCommand } from "../../state/use-atom-command";
import { useNewTaskFlow } from "./new-task-flow-provider";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";
import {
  createProviderCatalogRefreshRunner,
  providerCatalogRefreshError,
} from "./provider-catalog-refresh";
import { ModelRow } from "./ThreadSettingsRows";
import { MobileReasoningPowerSlider, type MobileSliderChoice } from "./MobileReasoningPowerSlider";
import {
  compatibleRuntimeModeForChoices,
  runtimeModeChoicesForSupportedModes,
  withManagedRuntimeModeLimits,
  type RuntimeModeChoice,
  selectableChoices,
} from "./thread-settings-options";
import {
  modelFavoriteKey,
  orderFavoriteCatalogModels,
  providerSectionIsCollapsed,
  visibleCatalogModels,
} from "./thread-settings-sheet-state";
import { formatProviderUpdateRequiredNotice } from "@t3tools/client-runtime/providerUpdateRequiredModels";
import type { MessageResolver } from "../../i18n/messages";

const THREAD_SETTINGS_MAINTAIN_VISIBLE_CONTENT_POSITION = {
  data: false,
  size: true,
} as const;
const EMPTY_MODEL_FAVORITES: ReadonlyArray<{
  readonly provider: ProviderInstanceId;
  readonly model: string;
}> = [];
const attemptedMigrationGenerations = new Map<EnvironmentId, number>();
let lastModelPickerTabInMemory: string | null = null;

type SelectDescriptor = Extract<ProviderOptionDescriptor, { type: "select" }>;
type BooleanDescriptor = Extract<ProviderOptionDescriptor, { type: "boolean" }>;

type DeckControl =
  | { readonly kind: "select"; readonly descriptor: SelectDescriptor }
  | { readonly kind: "boolean"; readonly descriptor: BooleanDescriptor };

function splitMobileDescriptors(descriptors: ReadonlyArray<ProviderOptionDescriptor>) {
  const selects = descriptors.filter(
    (descriptor): descriptor is SelectDescriptor => descriptor.type === "select",
  );
  const booleans = descriptors.filter(
    (descriptor): descriptor is BooleanDescriptor => descriptor.type === "boolean",
  );
  const speedSelect = selects.find((descriptor) => descriptor.id === "serviceTier") ?? null;
  const fastToggle = booleans.find((descriptor) => descriptor.id === "fastMode") ?? null;
  const remaining: ReadonlyArray<DeckControl> = [
    ...selects
      .filter((descriptor) => descriptor !== speedSelect)
      .map((descriptor) => ({ kind: "select" as const, descriptor })),
    ...booleans
      .filter((descriptor) => descriptor !== fastToggle)
      .map((descriptor) => ({ kind: "boolean" as const, descriptor })),
  ];
  const reasoning = remaining.find((control) => isReasoningControl(control.descriptor)) ?? null;
  const others = remaining.filter((control) => control !== reasoning);
  return { reasoning, speedSelect, fastToggle, others };
}

function SubProviderSectionHeader(props: {
  readonly label: string;
  readonly detail?: string | undefined;
  readonly collapsible: boolean;
  readonly collapsed: boolean;
  readonly modelCount: number;
  readonly onToggle: () => void;
}) {
  const gt = useGT();
  const content = (
    <>
      {props.detail ? (
        <View className="min-w-0 flex-1 py-1">
          <Text className="text-xs font-t3-medium text-foreground-muted">{props.label}</Text>
          <Text className="text-2xs text-foreground-muted">{props.detail}</Text>
        </View>
      ) : (
        <Text className="text-xs font-t3-medium text-foreground-muted">{props.label}</Text>
      )}
      {props.collapsible ? (
        <>
          <View className="flex-1" />
          {props.collapsed ? (
            <Text className="text-2xs font-t3-medium text-foreground-muted">
              {props.modelCount}
            </Text>
          ) : null}
          <SymbolView
            name={props.collapsed ? "chevron.down" : "chevron.up"}
            size={11}
            tintColorClassName="accent-icon-subtle"
            type="monochrome"
          />
        </>
      ) : null}
    </>
  );

  if (props.collapsible) {
    return (
      <Pressable
        accessibilityLabel={gt(
          "{provider}, {count, plural, one {{count} model} other {{count} models}}",
          { provider: props.label, count: props.modelCount },
        )}
        accessibilityRole="button"
        accessibilityState={{ expanded: !props.collapsed }}
        className="mx-4 mt-1 flex-row items-center gap-2 rounded-xl px-1 pt-2 active:opacity-60"
        style={{ minHeight: ROW_MIN_HEIGHT.control }}
        onPress={props.onToggle}
      >
        {content}
      </Pressable>
    );
  }

  return (
    <View accessibilityRole="header" className="mx-4 mt-1 min-h-8 flex-row items-center gap-2 px-1">
      {content}
    </View>
  );
}

type ThreadSettingsSessionProps = {
  readonly environmentId: EnvironmentId | null;
  readonly projectId: ProjectId | null;
  readonly cwd: string | null;
  readonly providerInstanceId?: ProviderInstanceId;
  readonly lockedProviderInstanceId?: ProviderInstanceId;
  readonly providerGroups: ReadonlyArray<ProviderGroup>;
  readonly selectedModel: ModelSelection | null;
  readonly prompt: string;
  readonly onPromptChange: (prompt: string) => void;
  readonly reportedModelSelection?: ModelSelection | null;
  readonly onSelectModel: (option: ModelOption) => void;
  readonly restoreSelection?: (selection: ModelSelection) => ModelSelection;
  readonly optionDescriptors: ReadonlyArray<ProviderOptionDescriptor>;
  readonly onUpdateOptionSelections: (selections: ReadonlyArray<ProviderOptionSelection>) => void;
  readonly runtimeMode: RuntimeMode;
  readonly onUpdateRuntimeMode: (mode: RuntimeMode) => void;
};

/** The composer draft the sheet edits: the thread's own, or a queued message being edited. */
export type ExistingThreadSettingsRouteParams = {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly draftKey: string;
};

type ActiveTab = "favorites" | string;

type ThreadSettingsSessionValue = {
  readonly environmentId: EnvironmentId | null;
  readonly providerInstanceId?: ProviderInstanceId;
  readonly providerGroups: ReadonlyArray<ProviderGroup>;
  readonly favoriteKeys: ReadonlySet<string>;
  readonly favoriteOrderKeys: ReadonlyArray<string>;
  readonly favoritesLoaded: boolean;
  readonly toggleFavorite: (option: ModelOption) => void;
  readonly toggleHidden: (option: ModelOption) => void;
  readonly pendingHiddenKeys: ReadonlySet<string>;
  readonly manageHidden: boolean;
  readonly setManageHidden: (value: boolean) => void;
  readonly runtimeMode: RuntimeMode;
  readonly runtimeModeChoices: ReadonlyArray<RuntimeModeChoice>;
  readonly onUpdateRuntimeMode: (mode: RuntimeMode) => void;
  readonly displayedDescriptors: ReadonlyArray<ProviderOptionDescriptor>;
  readonly promptTraits: ReturnType<typeof getPromptControlledTraits>;
  readonly displayedModelSelection: ModelSelection | null;
  readonly reportedModelSelection: ModelSelection | null;
  readonly providerExpansionOverrides: ReadonlySet<string>;
  readonly hasLegacyModels: boolean;
  readonly activeTab: ActiveTab;
  readonly setActiveTab: (tab: ActiveTab) => void;
  readonly searchQuery: string;
  readonly setSearchQuery: (query: string) => void;
  readonly showLegacy: boolean;
  readonly setShowLegacy: (showLegacy: boolean) => void;
  readonly applyOptionChange: (id: string, value: string | boolean) => void;
  readonly isApplied: (option: ModelOption) => boolean;
  readonly pressModel: (option: ModelOption) => void;
  readonly toggleProvider: (providerKey: string) => void;
  readonly workspaceScan: { readonly instanceId: ProviderInstanceId; readonly cwd: string } | null;
};

const ThreadSettingsSessionContext = createContext<ThreadSettingsSessionValue | null>(null);

function ThreadSettingsSessionProvider(
  props: ThreadSettingsSessionProps & { readonly children: ReactNode },
) {
  const messages = useMessages();
  const registry = use(RegistryContext);
  const preferences = useAtomValue(mobilePreferencesAtom);
  const configs = useAtomValue(environmentServerConfigsAtom);
  const config = props.environmentId ? configs.get(props.environmentId) : undefined;
  const settings = config?.settings;
  const connection = useEnvironmentQuery(
    props.environmentId ? environmentCatalog.stateAtom(props.environmentId) : null,
  ).data;
  const connectionGeneration = connection?.phase === "connected" ? connection.generation : null;
  const [manageHidden, setManageHidden] = useState(false);
  const pendingHidden = useRef(new Set<string>());
  const pendingFavorites = useRef(
    new Map<string, { favorite: boolean; settings: ServerSettings; pending: boolean }>(),
  );
  const [pendingHiddenKeys, setPendingHiddenKeys] = useState<ReadonlySet<string>>(() => new Set());
  const providerGroups =
    manageHidden && config
      ? groupByProvider(
          buildModelOptions(
            serverConfigForCwd(config, props.cwd),
            props.selectedModel,
            props.lockedProviderInstanceId,
            props.projectId,
            true,
          ),
        )
      : props.providerGroups;
  const legacyFavorites = AsyncResult.isSuccess(preferences)
    ? (preferences.value.modelFavorites ?? EMPTY_MODEL_FAVORITES)
    : EMPTY_MODEL_FAVORITES;
  const favoritesLoaded =
    settings !== undefined && (settings.favorites !== null || AsyncResult.isSuccess(preferences));
  const modelFavorites = resolveModelPreferences(settings ?? DEFAULT_SERVER_SETTINGS, {
    favorites: legacyFavorites,
  }).favorites;
  const saveSettings = useAtomCommand(serverEnvironment.updateSettings, "model favorites update");
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- writes the one-time legacy model favorites migration to server settings once per connection
  useEffect(() => {
    if (
      !props.environmentId ||
      !settings ||
      !AsyncResult.isSuccess(preferences) ||
      connectionGeneration === null ||
      attemptedMigrationGenerations.get(props.environmentId) === connectionGeneration
    )
      return;
    const patch = modelPreferencesMigrationPatch(settings, { favorites: legacyFavorites });
    if (!patch) return;
    attemptedMigrationGenerations.set(props.environmentId, connectionGeneration);
    void saveSettings({ environmentId: props.environmentId, input: { patch } });
  }, [
    connectionGeneration,
    legacyFavorites,
    preferences,
    props.environmentId,
    saveSettings,
    settings,
  ]);
  const favoriteOrderKeys = modelFavorites.map((favorite) =>
    modelFavoriteKey(favorite.provider, favorite.model),
  );
  const favoriteKeys = new Set(favoriteOrderKeys);
  const toggleFavorite = async (option: ModelOption) => {
    const environmentId = props.environmentId;
    if (!favoritesLoaded || !environmentId) return;
    const currentSettings = registry.get(environmentServerConfigsAtom).get(environmentId)?.settings;
    if (!currentSettings) return;
    const favorites = resolveModelPreferences(currentSettings, {
      favorites: legacyFavorites,
    }).favorites;
    const key = JSON.stringify([
      environmentId,
      option.selection.instanceId,
      option.selection.model,
    ]);
    const previous = pendingFavorites.current.get(key);
    const previousFavorite =
      previous && (previous.pending || previous.settings.favorites === currentSettings.favorites)
        ? previous.favorite
        : favorites.some(
            (favorite) =>
              favorite.provider === option.selection.instanceId &&
              favorite.model === option.selection.model,
          );
    const pending = { favorite: !previousFavorite, settings: currentSettings, pending: true };
    pendingFavorites.current.set(key, pending);
    void Haptics.selectionAsync();
    const result = await saveSettings({
      environmentId,
      input: {
        patch: {
          setModelFavorites: [
            {
              provider: option.selection.instanceId,
              model: option.selection.model,
              favorite: pending.favorite,
            },
          ],
          ...(currentSettings.favorites === null ? { migrateModelPreferences: { favorites } } : {}),
        },
      },
    });
    if (
      AsyncResult.isSuccess(result) &&
      registry.get(environmentServerConfigsAtom).get(environmentId)?.settings.favorites ===
        currentSettings.favorites
    ) {
      pending.pending = false;
    }
    if (pending.pending && pendingFavorites.current.get(key) === pending) {
      if (
        previous &&
        !previous.pending &&
        registry.get(environmentServerConfigsAtom).get(environmentId)?.settings.favorites ===
          previous.settings.favorites
      ) {
        pendingFavorites.current.set(key, previous);
      } else {
        pendingFavorites.current.delete(key);
      }
    }
  };
  const toggleHidden = (option: ModelOption) => {
    if (
      !settings ||
      !props.environmentId ||
      !option.canHide ||
      pendingHidden.current.has(option.key)
    )
      return;
    pendingHidden.current.add(option.key);
    setPendingHiddenKeys(new Set(pendingHidden.current));
    void Haptics.selectionAsync();
    void saveSettings({
      environmentId: props.environmentId,
      input: {
        patch: {
          setModelsHidden: [
            {
              provider: option.selection.instanceId,
              model: option.selection.model,
              hidden: !option.isHidden,
            },
          ],
        },
      },
    }).then(() => {
      pendingHidden.current.delete(option.key);
      setPendingHiddenKeys(new Set(pendingHidden.current));
    });
  };

  const [showLegacyToggle, setShowLegacyToggle] = useState(false);
  const savePreferences = useAtomCommand(saveMobilePreferences, "model picker last tab");
  const savedLastTab = AsyncResult.isSuccess(preferences)
    ? (preferences.value.modelPickerLastTab ?? lastModelPickerTabInMemory)
    : lastModelPickerTabInMemory;
  const [activeTab, setActiveTabState] = useState<ActiveTab>(() => {
    if (props.lockedProviderInstanceId !== undefined) {
      return props.lockedProviderInstanceId;
    }
    if (savedLastTab === "favorites") {
      return "favorites";
    }
    if (savedLastTab && props.providerGroups.some((group) => group.providerKey === savedLastTab)) {
      return savedLastTab;
    }
    const initialProviderKey =
      props.providerGroups.find((group) =>
        group.models.some(
          (option) =>
            option.selection.instanceId === props.selectedModel?.instanceId &&
            option.selection.model === props.selectedModel.model,
        ),
      )?.providerKey ??
      props.providerInstanceId ??
      props.providerGroups[0]?.providerKey;
    return initialProviderKey ?? "favorites";
  });
  const setActiveTab = (nextTab: ActiveTab) => {
    setActiveTabState(nextTab);
    if (props.lockedProviderInstanceId === undefined) {
      lastModelPickerTabInMemory = nextTab;
      void savePreferences({ modelPickerLastTab: nextTab });
    }
  };
  const [searchQuery, setSearchQuery] = useState("");
  const [providerExpansionOverrides, setProviderExpansionOverrides] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  const isApplied = (option: ModelOption) =>
    option.selection.instanceId === props.selectedModel?.instanceId &&
    option.selection.model === props.selectedModel.model;

  const displayedDescriptors = props.optionDescriptors;
  const promptTraits = getPromptControlledTraits(displayedDescriptors, props.prompt);
  const displayedModel =
    providerGroups.flatMap((group) => group.models).find((option) => isApplied(option)) ?? null;
  const runtimeModeChoices = withManagedRuntimeModeLimits(
    runtimeModeChoicesForSupportedModes(displayedModel?.supportedRuntimeModes),
    [config?.managedPolicy],
    messages,
  );
  const compatibleRuntimeMode = compatibleRuntimeModeForChoices(
    props.runtimeMode,
    runtimeModeChoices,
  );
  const hasLegacyModels = providerGroups.some((group) =>
    group.models.some((model) => model.isLegacy),
  );

  const applyOptionChange = (id: string, value: string | boolean) => {
    const descriptor = displayedDescriptors.find((entry) => entry.id === id);
    const change =
      descriptor?.type === "select" && typeof value === "string"
        ? getTraitSelectChange(
            { ...promptTraits, descriptors: displayedDescriptors },
            descriptor,
            props.prompt,
            value,
          )
        : null;
    if (descriptor?.type === "select") {
      if (!change) return;
      if (change.prompt !== props.prompt) {
        props.onPromptChange(change.prompt);
      }
    }
    const next = change
      ? (change.modelOptions ?? [])
      : applyProviderOptionSelection(displayedDescriptors, { id, value });
    if (!next) {
      return;
    }
    props.onUpdateOptionSelections(next);
  };

  const toggleProvider = (providerKey: string) => {
    setProviderExpansionOverrides((current) => {
      const next = new Set(current);
      if (!next.delete(providerKey)) {
        next.add(providerKey);
      }
      return next;
    });
  };

  // Selecting a model applies immediately so there is no Save/Cancel ceremony on mobile.
  const pressModel = (option: ModelOption) => {
    if (option.isUnavailable || option.isHidden) return;
    void Haptics.selectionAsync();
    if (isApplied(option)) return;
    const restored = props.restoreSelection
      ? { ...option, selection: props.restoreSelection(option.selection) }
      : option;
    props.onSelectModel(restored);
  };

  const effectiveTab: ActiveTab =
    activeTab === "favorites" || providerGroups.some((group) => group.providerKey === activeTab)
      ? activeTab
      : (providerGroups[0]?.providerKey ?? "favorites");

  const environmentId = props.environmentId;
  const scannedInstanceId =
    effectiveTab !== "favorites" ? ProviderInstanceId.make(effectiveTab) : props.providerInstanceId;
  const workspaceScan =
    props.cwd && scannedInstanceId ? { instanceId: scannedInstanceId, cwd: props.cwd } : null;

  const value = {
    environmentId,
    providerInstanceId: props.providerInstanceId,
    providerGroups,
    manageHidden,
    setManageHidden,
    toggleHidden,
    pendingHiddenKeys,
    runtimeMode: compatibleRuntimeMode,
    runtimeModeChoices,
    onUpdateRuntimeMode: props.onUpdateRuntimeMode,
    displayedDescriptors,
    promptTraits,
    displayedModelSelection: props.selectedModel,
    reportedModelSelection: props.reportedModelSelection ?? null,
    favoriteKeys,
    favoriteOrderKeys,
    favoritesLoaded,
    providerExpansionOverrides,
    hasLegacyModels,
    activeTab: effectiveTab,
    setActiveTab,
    searchQuery,
    setSearchQuery,
    showLegacy: showLegacyToggle,
    setShowLegacy: setShowLegacyToggle,
    applyOptionChange,
    isApplied,
    pressModel,
    toggleFavorite,
    toggleProvider,
    workspaceScan,
  } satisfies ThreadSettingsSessionValue;

  return (
    <ThreadSettingsSessionContext.Provider value={value}>
      {environmentId && workspaceScan ? (
        <ProviderWorkspaceSnapshotScan
          key={workspaceScan.instanceId}
          environmentId={environmentId}
          instanceId={workspaceScan.instanceId}
          cwd={workspaceScan.cwd}
        />
      ) : null}
      {props.children}
    </ThreadSettingsSessionContext.Provider>
  );
}

function ProviderWorkspaceSnapshotScan(props: {
  readonly environmentId: EnvironmentId;
  readonly instanceId: ProviderInstanceId;
  readonly cwd: string;
}) {
  useAtomMount(providerWorkspaceSnapshotRefresh(props));
  return null;
}

function useThreadSettingsSession() {
  const value = use(ThreadSettingsSessionContext);
  if (!value) {
    throw new Error("useThreadSettingsSession must be used inside ThreadSettingsSessionProvider.");
  }
  return value;
}

type ThreadSettingsCatalogItem =
  | {
      readonly kind: "subProvider";
      readonly key: string;
      readonly expansionKey: string;
      readonly label: string;
      readonly detail: string | undefined;
      readonly collapsed: boolean;
      readonly modelCount: number;
    }
  | {
      readonly kind: "model";
      readonly key: string;
      readonly option: ModelOption;
      readonly showProviderIcon: boolean;
      readonly isFirst: boolean;
      readonly isLast: boolean;
    }
  | {
      readonly kind: "notice";
      readonly key: string;
      readonly text: string;
    }
  | {
      readonly kind: "empty";
      readonly key: string;
    };

const modelItems = (models: ReadonlyArray<ModelOption>, showProviderIcon: boolean) =>
  models.map((option, index) => ({
    kind: "model" as const,
    key: `model:${option.key}`,
    option,
    showProviderIcon,
    isFirst: index === 0,
    isLast: index === models.length - 1,
  }));

function subProviderCatalogItems(
  session: ThreadSettingsSessionValue,
  group: ProviderGroup,
  models: ReadonlyArray<ModelOption>,
): ReadonlyArray<ThreadSettingsCatalogItem> | null {
  if (!group.subProviders?.length || session.searchQuery.trim().length > 0) {
    return null;
  }
  const { ungrouped, groups } = groupModelsBySubProvider(
    models,
    group.subProviders,
    (option) => option.subtitle,
  );
  return [
    ...modelItems(ungrouped, false),
    ...groups.flatMap(({ subProvider, models: backendModels }) => {
      const expansionKey = `${group.providerKey}:sub-provider:${subProvider.name}`;
      const collapsed =
        subProvider.unavailableReason !== undefined ||
        providerSectionIsCollapsed({
          defaultExpanded: backendModels.some(session.isApplied),
          hasExpansionOverride: session.providerExpansionOverrides.has(expansionKey),
          isNarrowed: false,
        });
      return [
        {
          kind: "subProvider" as const,
          key: `sub-provider:${expansionKey}`,
          expansionKey,
          label: subProvider.name,
          detail: subProvider.unavailableReason,
          collapsed,
          modelCount: backendModels.length,
        },
        ...(collapsed
          ? []
          : modelItems(
              backendModels.map((option) => ({ ...option, subtitle: "" })),
              false,
            )),
      ];
    }),
  ];
}

function buildCatalogItemsForTab(
  session: ThreadSettingsSessionValue,
  tab: ActiveTab,
  resolve: MessageResolver,
  locale: string,
): ReadonlyArray<ThreadSettingsCatalogItem> {
  const isSearching = session.searchQuery.trim().length > 0;
  const isFavorites = !isSearching && tab === "favorites";

  if (isSearching || isFavorites) {
    const models = session.providerGroups.flatMap((group) =>
      visibleCatalogModels({
        models: group.models,
        providerLabel: group.providerLabel,
        query: session.searchQuery,
        favoriteKeys: session.favoriteKeys,
        favoritesOnly: isFavorites,
        showLegacy: session.manageHidden || session.showLegacy,
        isDisplayed: session.isApplied,
      }),
    );
    return modelItems(
      isFavorites ? orderFavoriteCatalogModels(models, session.favoriteOrderKeys) : models,
      true,
    );
  }

  const group = session.providerGroups.find((entry) => entry.providerKey === tab);
  if (!group) return [];

  const visibleModels = visibleCatalogModels({
    models: group.models,
    providerLabel: group.providerLabel,
    query: "",
    favoriteKeys: session.favoriteKeys,
    favoritesOnly: false,
    showLegacy: session.manageHidden || session.showLegacy,
    isDisplayed: session.isApplied,
  });
  const updateRequiredNotice = group.updateRequired
    ? formatProviderUpdateRequiredNotice(group.updateRequired, "", resolve, locale)
    : null;

  return [
    ...(subProviderCatalogItems(session, group, visibleModels) ?? modelItems(visibleModels, false)),
    ...(updateRequiredNotice
      ? [
          {
            kind: "notice" as const,
            key: `notice:${group.providerKey}`,
            text: updateRequiredNotice,
          },
        ]
      : []),
  ];
}

const PillGlass = withUniwind(GlassView, {
  style: { fromClassName: "className" },
});

function NativeGlassCapsule(props: {
  readonly isDarkMode: boolean;
  readonly fallbackBackgroundColor: string;
  readonly interactive?: boolean;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  if (NATIVE_LIQUID_GLASS_SUPPORTED) {
    return (
      <PillGlass
        glassEffectStyle="regular"
        isInteractive={props.interactive ?? true}
        colorScheme={props.isDarkMode ? "dark" : "light"}
        className={props.className}
        style={{ borderRadius: 9999, overflow: "hidden" }}
      >
        {props.children}
      </PillGlass>
    );
  }
  return (
    <View
      className={props.className}
      style={{
        backgroundColor: props.fallbackBackgroundColor,
        borderRadius: 9999,
        overflow: "hidden",
      }}
    >
      {props.children}
    </View>
  );
}

function modelSheetSurface(isDarkMode: boolean, useNativeGlass = NATIVE_LIQUID_GLASS_SUPPORTED) {
  if (useNativeGlass) {
    return isDarkMode
      ? {
          canvas: "transparent",
          card: "rgba(30,30,36,0.52)",
          cardBorder: "rgba(255,255,255,0.18)",
          tabTrack: "rgba(255,255,255,0.12)",
          tabTrackBorder: "rgba(255,255,255,0.18)",
          activeTab: "rgba(255,255,255,0.22)",
          activeTabBorder: "rgba(255,255,255,0.28)",
          actionBtn: "rgba(255,255,255,0.14)",
          selectedRow: "rgba(255,255,255,0.15)",
          dragRow: "rgba(44,44,52,0.92)",
          divider: "rgba(255,255,255,0.22)",
          pill: "rgba(255,255,255,0.18)",
          speedActive: "rgba(255,255,255,0.28)",
        }
      : {
          canvas: "transparent",
          card: "rgba(255,255,255,0.62)",
          cardBorder: "rgba(255,255,255,0.84)",
          tabTrack: "rgba(255,255,255,0.50)",
          tabTrackBorder: "rgba(255,255,255,0.78)",
          activeTab: "rgba(255,255,255,0.92)",
          activeTabBorder: "rgba(0,0,0,0.08)",
          actionBtn: "rgba(255,255,255,0.62)",
          selectedRow: "rgba(24,24,27,0.08)",
          dragRow: "rgba(255,255,255,0.96)",
          divider: "rgba(0,0,0,0.12)",
          pill: "rgba(24,24,27,0.09)",
          speedActive: "rgba(255,255,255,0.96)",
        };
  }
  return isDarkMode
    ? {
        canvas: "#111114",
        card: "#1A1A1E",
        cardBorder: "rgba(255,255,255,0.08)",
        tabTrack: "#1B1B20",
        tabTrackBorder: "rgba(255,255,255,0.09)",
        activeTab: "#2B2B31",
        activeTabBorder: "rgba(255,255,255,0.12)",
        actionBtn: "rgba(255,255,255,0.09)",
        selectedRow: "rgba(255,255,255,0.095)",
        dragRow: "#26262C",
        divider: "rgba(255,255,255,0.08)",
        pill: "rgba(255,255,255,0.09)",
        speedActive: "#323238",
      }
    : {
        canvas: "#F2F2F7",
        card: "#FFFFFF",
        cardBorder: "rgba(0,0,0,0.055)",
        tabTrack: "rgba(0,0,0,0.055)",
        tabTrackBorder: "rgba(0,0,0,0.06)",
        activeTab: "#FFFFFF",
        activeTabBorder: "rgba(0,0,0,0.07)",
        actionBtn: "rgba(0,0,0,0.06)",
        selectedRow: "rgba(24,24,27,0.06)",
        dragRow: "#FFFFFF",
        divider: "rgba(0,0,0,0.075)",
        pill: "rgba(24,24,27,0.06)",
        speedActive: "#FFFFFF",
      };
}

function ThreadSettingsTopBar(props: {
  readonly searchExpanded: boolean;
  readonly onOpenSearch: () => void;
  readonly onCloseSearch: () => void;
  readonly onRefresh: () => void;
  readonly onClose: () => void;
}) {
  const gt = useGT();
  const insets = useSafeAreaInsets();
  const session = useThreadSettingsSession();
  const { themeAppearance } = useAppearancePreferences();
  const isDarkMode = themeAppearance === "dark";
  const searchRef = useRef<TextInputInstance>(null);
  const showSearch = props.searchExpanded || session.searchQuery.trim().length > 0;

  const moreActions: MenuAction[] = [
    ...(session.hasLegacyModels
      ? [
          {
            id: "show-legacy",
            title: gt("Show legacy models"),
            image: Platform.OS === "ios" ? "clock.arrow.circlepath" : undefined,
            state: session.showLegacy ? ("on" as const) : ("off" as const),
          },
        ]
      : []),
    {
      id: "manage-hidden",
      title: gt("Manage hidden models"),
      image: Platform.OS === "ios" ? "eye.slash" : undefined,
      state: session.manageHidden ? ("on" as const) : ("off" as const),
    },
    ...(session.environmentId
      ? [
          {
            id: "refresh-models",
            title: gt("Refresh models"),
            image: Platform.OS === "ios" ? "arrow.clockwise" : undefined,
          },
        ]
      : []),
  ];

  const handleMoreAction = (event: { readonly nativeEvent: { readonly event: string } }) => {
    const id = event.nativeEvent.event;
    void Haptics.selectionAsync();
    if (id === "show-legacy") {
      session.setShowLegacy(!session.showLegacy);
    } else if (id === "manage-hidden") {
      session.setManageHidden(!session.manageHidden);
    } else if (id === "refresh-models") {
      props.onRefresh();
    }
  };

  const topPadding = Platform.OS === "ios" ? 20 : insets.top + 8;
  const surface = modelSheetSurface(isDarkMode);
  const tabsScrollRef = useRef<ScrollViewInstance>(null);
  const tabLayoutsRef = useRef(new Map<string, { readonly x: number; readonly width: number }>());
  const tabsViewportWidthRef = useRef(0);

  const reducedMotion = useReducedMotion();
  const reduceMotionEnabled = useReduceMotionEnabled();
  const animateIndicator = !reducedMotion && !reduceMotionEnabled;
  const indicatorX = useSharedValue(0);
  const indicatorWidth = useSharedValue(0);
  const indicatorOpacity = useSharedValue(0);
  const indicatorReadyRef = useRef(false);

  const syncIndicatorToTab = useEffectEvent((tabKey: string, animated: boolean) => {
    const layout = tabLayoutsRef.current.get(tabKey);
    if (!layout || layout.width <= 0) return;
    if (!indicatorReadyRef.current || !animated || !animateIndicator) {
      indicatorReadyRef.current = true;
      indicatorX.set(layout.x);
      indicatorWidth.set(layout.width);
      indicatorOpacity.set(1);
    } else {
      indicatorX.set(withTiming(layout.x, { duration: 150, reduceMotion: ReduceMotion.System }));
      indicatorWidth.set(
        withTiming(layout.width, { duration: 150, reduceMotion: ReduceMotion.System }),
      );
      indicatorOpacity.set(1);
    }
    if (tabsViewportWidthRef.current > 0) {
      const targetX = Math.max(0, layout.x + layout.width / 2 - tabsViewportWidthRef.current / 2);
      tabsScrollRef.current?.scrollTo({ x: targetX, animated });
    }
  });

  const indicatorStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: indicatorX.get() }],
    width: indicatorWidth.get(),
    opacity: indicatorOpacity.get(),
  }));

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- glides the persistent native Liquid Glass pill and scrolls the horizontal tab bar when activeTab changes
  useEffect(() => {
    syncIndicatorToTab(session.activeTab, true);
  }, [session.activeTab]);

  if (showSearch) {
    return (
      <View
        className="px-[22px] pb-2.5"
        style={{
          paddingTop: topPadding,
        }}
      >
        <View className="h-[34px] flex-row items-center gap-2">
          <View
            className="h-[34px] min-w-0 flex-1 flex-row items-center gap-2 rounded-full px-3"
            style={{ backgroundColor: surface.pill }}
          >
            <SymbolView
              name="magnifyingglass"
              size={14}
              tintColorClassName="accent-foreground-muted"
              type="monochrome"
            />
            <TextInput
              ref={searchRef}
              autoFocus
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              placeholder={gt("Find a model")}
              placeholderTextColorClassName="accent-placeholder"
              className="min-w-0 flex-1 py-0.5 font-sans text-sm text-foreground"
              value={session.searchQuery}
              onChangeText={session.setSearchQuery}
            />
            {session.searchQuery.length > 0 ? (
              <Pressable
                accessibilityLabel={gt("Clear model search")}
                accessibilityRole="button"
                hitSlop={8}
                onPress={() => {
                  session.setSearchQuery("");
                  searchRef.current?.focus();
                }}
              >
                <SymbolView
                  name="xmark.circle.fill"
                  size={16}
                  tintColorClassName="accent-foreground-muted"
                  type="monochrome"
                />
              </Pressable>
            ) : null}
          </View>
          <Pressable
            accessibilityRole="button"
            className="h-[34px] items-center justify-center px-1 active:opacity-60"
            onPress={() => {
              session.setSearchQuery("");
              props.onCloseSearch();
            }}
          >
            <Text className="text-sm font-t3-medium text-foreground-muted">{gt("Cancel")}</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const favoritesActive = session.activeTab === "favorites";

  return (
    <View
      className="px-[22px] pb-2.5"
      style={{
        paddingTop: topPadding,
      }}
    >
      {/* Row 1: Aligned Title + Bare Action Icons (exact 34pt row height) */}
      <View className="mb-2.5 h-[34px] flex-row items-center justify-between gap-2">
        <Text className="text-[17px] leading-[22px] font-t3-bold text-foreground" numberOfLines={1}>
          {gt("Choose model")}
        </Text>
        <View className="flex-row items-center gap-0.5">
          <Pressable
            accessibilityLabel={gt("Find a model")}
            accessibilityRole="button"
            hitSlop={4}
            onPress={() => {
              void Haptics.selectionAsync();
              props.onOpenSearch();
            }}
            className="size-[34px] items-center justify-center rounded-full active:opacity-60"
          >
            <SymbolView
              name="magnifyingglass"
              size={16}
              tintColorClassName="accent-foreground"
              style={{ opacity: 0.88 }}
              type="monochrome"
            />
          </Pressable>

          {moreActions.length > 0 ? (
            <Menu actions={moreActions} onPressAction={handleMoreAction}>
              <Pressable
                accessibilityLabel={gt("Model options")}
                accessibilityRole="button"
                hitSlop={4}
                className="size-[34px] items-center justify-center rounded-full active:opacity-60"
              >
                <SymbolView
                  name="ellipsis"
                  size={16}
                  tintColorClassName="accent-foreground"
                  style={{ opacity: 0.88 }}
                  type="monochrome"
                />
              </Pressable>
            </Menu>
          ) : null}

          {Platform.OS === "android" ? (
            <Pressable
              accessibilityLabel={gt("Close")}
              accessibilityRole="button"
              hitSlop={4}
              onPress={props.onClose}
              className="size-[34px] items-center justify-center rounded-full active:opacity-60"
            >
              <SymbolView
                name="xmark"
                size={16}
                tintColorClassName="accent-foreground"
                style={{ opacity: 0.88 }}
                type="monochrome"
              />
            </Pressable>
          ) : null}
        </View>
      </View>

      {/* Row 2: Zero-nesting flat provider tabs (NO outer capsule track) */}
      <ScrollView
        ref={tabsScrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        onLayout={(event) => {
          tabsViewportWidthRef.current = event.nativeEvent.layout.width;
          syncIndicatorToTab(session.activeTab, false);
        }}
        contentContainerStyle={{
          position: "relative",
          alignItems: "center",
          gap: 6,
          paddingVertical: 1,
        }}
      >
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: "absolute",
              top: 1,
              left: 0,
              height: 30,
              borderRadius: 9999,
            },
            indicatorStyle,
          ]}
        >
          <NativeGlassCapsule
            isDarkMode={isDarkMode}
            fallbackBackgroundColor={surface.activeTab}
            interactive={false}
            className="size-full"
          >
            <View className="size-full" />
          </NativeGlassCapsule>
        </Animated.View>

        <Pressable
          accessibilityLabel={gt("Favorites")}
          accessibilityRole="tab"
          accessibilityState={{ selected: favoritesActive }}
          onLayout={(event) => {
            tabLayoutsRef.current.set("favorites", {
              x: event.nativeEvent.layout.x,
              width: event.nativeEvent.layout.width,
            });
            if (session.activeTab === "favorites") {
              syncIndicatorToTab("favorites", indicatorReadyRef.current);
            }
          }}
          onPress={() => {
            void Haptics.selectionAsync();
            session.setActiveTab("favorites");
          }}
          className={cn(
            "h-[30px] flex-row items-center justify-center rounded-full active:opacity-70",
            favoritesActive ? "gap-1.5 px-3" : "w-[34px]",
          )}
        >
          <SymbolView
            name="star.fill"
            size={15}
            tintColor={favoritesActive ? "#f59e0b" : undefined}
            tintColorClassName={favoritesActive ? undefined : "accent-foreground"}
            style={favoritesActive ? undefined : { opacity: 0.84 }}
            type="monochrome"
          />
          {favoritesActive ? (
            <Text className="text-[13px] font-t3-semibold text-foreground">{gt("Favorites")}</Text>
          ) : null}
        </Pressable>

        <View
          className="mx-0.5 h-3.5 w-px"
          style={{ backgroundColor: surface.divider }}
          accessible={false}
        />

        {session.providerGroups.map((group) => {
          const isActive = session.activeTab === group.providerKey;
          const driver = group.models[0]?.providerDriver ?? group.providerKey;
          const iconUrl = group.models[0]?.providerIconUrl;
          return (
            <Pressable
              key={group.providerKey}
              accessibilityLabel={group.providerLabel}
              accessibilityRole="tab"
              accessibilityState={{ selected: isActive }}
              onLayout={(event) => {
                tabLayoutsRef.current.set(group.providerKey, {
                  x: event.nativeEvent.layout.x,
                  width: event.nativeEvent.layout.width,
                });
                if (session.activeTab === group.providerKey) {
                  syncIndicatorToTab(group.providerKey, indicatorReadyRef.current);
                }
              }}
              onPress={() => {
                void Haptics.selectionAsync();
                session.setActiveTab(group.providerKey);
              }}
              className={cn(
                "h-[30px] flex-row items-center justify-center rounded-full active:opacity-70",
                isActive ? "gap-1.5 px-3" : "w-[34px]",
              )}
            >
              <ProviderIcon iconUrl={iconUrl} provider={driver} size={17} />
              {isActive ? (
                <Text className="text-[13px] font-t3-semibold text-foreground" numberOfLines={1}>
                  {group.providerLabel}
                </Text>
              ) : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

function MobileSpeedSwitcher(props: {
  readonly speedSelect: SelectDescriptor | null;
  readonly fastToggle: BooleanDescriptor | null;
  readonly isDarkMode: boolean;
}) {
  const gt = useGT();
  const session = useThreadSettingsSession();
  const { speedSelect, fastToggle, isDarkMode } = props;
  if (!speedSelect && !fastToggle) return null;

  const choices = speedSelect ? selectableChoices(speedSelect) : [];
  const compact = choices.length >= 3;
  const activeSelectId = speedSelect
    ? getProviderOptionCurrentValue(
        speedSelect,
        session.displayedModelSelection,
        session.reportedModelSelection,
      )
    : null;

  const surface = modelSheetSurface(isDarkMode);
  const renderPill = (item: {
    readonly key: string;
    readonly label: string;
    readonly speed: string;
    readonly checked: boolean;
    readonly onPress: () => void;
  }) => {
    const isFast = item.speed === "Fast" || item.speed === "Ultrafast";
    const shortLabel =
      compact && item.speed === "Standard"
        ? "Std"
        : compact && isFast && !item.checked
          ? ""
          : compact && item.speed === "Ultrafast"
            ? "Ultra"
            : item.label;
    return (
      <Pressable
        key={item.key}
        accessibilityRole="radio"
        accessibilityLabel={item.label}
        accessibilityState={{ checked: item.checked }}
        onPress={() => {
          void Haptics.selectionAsync();
          item.onPress();
        }}
        className={cn(
          "h-[22px] flex-row items-center justify-center gap-1 rounded-full",
          compact ? "px-2" : "px-2.5",
        )}
        style={
          item.checked
            ? {
                backgroundColor: surface.speedActive,
                shadowColor: "#000000",
                shadowOffset: { width: 0, height: 1 },
                shadowOpacity: isDarkMode ? 0.35 : 0.1,
                shadowRadius: 2,
                elevation: 1,
              }
            : undefined
        }
      >
        {isFast ? (
          <SymbolView
            name="bolt.fill"
            size={11}
            tintColor={item.checked ? (isDarkMode ? "#fbbf24" : "#d97706") : undefined}
            tintColorClassName={item.checked ? undefined : "accent-foreground-muted"}
            type="monochrome"
          />
        ) : null}
        {shortLabel ? (
          <Text
            className={cn(
              "text-xs",
              item.checked
                ? "font-t3-bold text-foreground"
                : "font-t3-medium text-foreground-muted",
            )}
          >
            {shortLabel}
          </Text>
        ) : null}
      </Pressable>
    );
  };

  return (
    <NativeGlassCapsule
      isDarkMode={isDarkMode}
      fallbackBackgroundColor={surface.pill}
      interactive={false}
      className="h-[26px]"
    >
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={speedSelect?.label ?? fastToggle?.label}
        className="h-[26px] flex-row items-center gap-0.5 rounded-full p-0.5"
      >
        {speedSelect
          ? choices.map((choice) =>
              renderPill({
                key: choice.id,
                label: choice.label,
                speed: choice.label,
                checked: choice.id === activeSelectId,
                onPress: () => session.applyOptionChange(speedSelect.id, choice.id),
              }),
            )
          : fastToggle
            ? ([false, true] as const).map((value) =>
                renderPill({
                  key: String(value),
                  label: value
                    ? gt("Fast", { $context: "response speed" })
                    : gt("Standard", { $context: "response speed" }),
                  speed: value ? "Fast" : "Standard",
                  checked: (fastToggle.currentValue === true) === value,
                  onPress: () => session.applyOptionChange(fastToggle.id, value),
                }),
              )
            : null}
      </View>
    </NativeGlassCapsule>
  );
}

function ThreadSettingsThumbDeck() {
  const gt = useGT();
  const m = useMessages();
  const insets = useSafeAreaInsets();
  const session = useThreadSettingsSession();
  const { themeAppearance } = useAppearancePreferences();
  const isDarkMode = themeAppearance === "dark";
  const configs = useAtomValue(environmentServerConfigsAtom);
  const selectedProvider = session.environmentId
    ? (configs
        .get(session.environmentId)
        ?.providers.find((provider) => provider.instanceId === session.providerInstanceId) ?? null)
    : null;

  const { reasoning, speedSelect, fastToggle, others } = splitMobileDescriptors(
    session.displayedDescriptors,
  );
  const hasSpeed = speedSelect !== null || fastToggle !== null;

  const reasoningChoices: ReadonlyArray<MobileSliderChoice> =
    reasoning?.kind === "select"
      ? selectableChoices(reasoning.descriptor).map((choice) => ({
          id: choice.id,
          label: choice.label,
        }))
      : reasoning?.kind === "boolean"
        ? [
            { id: "false", label: gt("Off", { $context: "option state" }) },
            { id: "true", label: gt("On", { $context: "option state" }) },
          ]
        : [];

  const reasoningSelectedId: string =
    reasoning?.kind === "select"
      ? session.promptTraits.ultrathinkPromptControlled &&
        reasoning.descriptor.id === session.promptTraits.primarySelectDescriptor?.id
        ? "ultrathink"
        : (() => {
            const current = getProviderOptionCurrentValue(
              reasoning.descriptor,
              session.displayedModelSelection,
              session.reportedModelSelection,
            );
            return typeof current === "string" ? current : (reasoningChoices[0]?.id ?? "");
          })()
      : reasoning?.kind === "boolean"
        ? reasoning.descriptor.currentValue === true
          ? "true"
          : "false"
        : "";

  const reasoningLocked =
    reasoning?.kind === "select" &&
    session.promptTraits.ultrathinkInBodyText &&
    reasoning.descriptor.id === session.promptTraits.primarySelectDescriptor?.id;

  const currentRuntimeLabel = (() => {
    const found = session.runtimeModeChoices.find((choice) => choice.mode === session.runtimeMode);
    return found ? m(found.label) : gt("Runtime", { $context: "agent permission mode setting" });
  })();

  const runtimeMenuActions: MenuAction[] = session.runtimeModeChoices.map((choice) => ({
    id: choice.mode,
    title: m(choice.label),
    subtitle: choice.disabledReason ?? m(choice.description),
    state: choice.mode === session.runtimeMode ? ("on" as const) : ("off" as const),
    attributes: choice.disabledReason ? { disabled: true } : undefined,
  }));

  const heading =
    reasoning?.descriptor.label ??
    (hasSpeed ? gt("Speed", { $context: "heading for model speed control" }) : null);
  const reasoningIndex = Math.max(
    0,
    reasoningChoices.findIndex((choice) => choice.id === reasoningSelectedId),
  );
  const activeReasoningLabel = reasoningChoices[reasoningIndex]?.label ?? "";
  const surface = modelSheetSurface(isDarkMode);
  const bottomInset =
    Platform.OS === "ios"
      ? Math.max(18, Math.min(insets.bottom > 16 ? insets.bottom - 6 : insets.bottom + 6, 26))
      : Math.max(insets.bottom, 14);

  return (
    <View
      className="px-[22px] pt-3"
      style={{
        backgroundColor: "transparent",
        paddingBottom: bottomInset,
      }}
    >
      <ChatGptSharingStatus provider={selectedProvider} />

      {heading ? (
        <View className="mb-1 flex-row items-center justify-between gap-2">
          <View className="flex-row items-baseline gap-1.5">
            <Text className="text-[12.5px] font-t3-semibold text-foreground/95">{heading}</Text>
            {hasSpeed && reasoningChoices.length > 1 ? (
              <Text className="text-[11.5px] font-t3-medium tabular-nums text-foreground/80">
                {`${reasoningIndex + 1} / ${reasoningChoices.length}`}
              </Text>
            ) : null}
          </View>
          {hasSpeed ? (
            <MobileSpeedSwitcher
              speedSelect={speedSelect}
              fastToggle={fastToggle}
              isDarkMode={isDarkMode}
            />
          ) : reasoningChoices.length > 1 ? (
            <Text className="text-[12px] font-t3-medium tabular-nums text-foreground/82">
              {activeReasoningLabel
                ? `${activeReasoningLabel} · ${reasoningIndex + 1} / ${reasoningChoices.length}`
                : `${reasoningIndex + 1} / ${reasoningChoices.length}`}
            </Text>
          ) : null}
        </View>
      ) : null}

      {reasoning && reasoningChoices.length > 0 ? (
        <View className="mb-1.5">
          {reasoningLocked ? (
            <Text className="mb-1 text-2xs text-foreground-muted">
              {gt(
                'Your prompt contains "ultrathink" in the text. Remove it to change this option.',
              )}
            </Text>
          ) : null}
          <MobileReasoningPowerSlider
            ariaLabel={reasoning.descriptor.label}
            choices={reasoningChoices}
            selectedId={reasoningSelectedId}
            isDarkMode={isDarkMode}
            disabled={reasoningLocked}
            onSelect={(nextId) => {
              if (reasoning.kind === "boolean") {
                session.applyOptionChange(reasoning.descriptor.id, nextId === "true");
                return;
              }
              if (reasoningLocked) {
                Dialog.alert(
                  gt("Reasoning controlled by prompt"),
                  gt(
                    'Your prompt contains "ultrathink" in the text. Remove it to change this option.',
                  ),
                );
                return;
              }
              session.applyOptionChange(reasoning.descriptor.id, nextId);
            }}
          />
        </View>
      ) : null}

      {/* Unified bottom row: extra model options (e.g. Cyber Access) on left, Runtime Permissions on right */}
      <View className="flex-row items-center justify-between gap-2 pt-1.5">
        {others.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            className="min-w-0 flex-1"
            contentContainerStyle={{ alignItems: "center", gap: 6 }}
          >
            {others.map((control) => {
              if (control.kind === "boolean") {
                const checked = control.descriptor.currentValue === true;
                return (
                  <NativeGlassCapsule
                    key={control.descriptor.id}
                    isDarkMode={isDarkMode}
                    fallbackBackgroundColor={checked ? surface.activeTab : surface.pill}
                  >
                    <Pressable
                      accessibilityRole="switch"
                      accessibilityState={{ checked }}
                      onPress={() => {
                        void Haptics.selectionAsync();
                        session.applyOptionChange(control.descriptor.id, !checked);
                      }}
                      className="h-[30px] flex-row items-center gap-1.5 rounded-full px-3 active:opacity-75"
                    >
                      <Text className="text-[12px] font-t3-medium text-foreground/85">
                        {control.descriptor.label}
                      </Text>
                      <Text className="text-[12px] font-t3-semibold text-foreground">
                        {checked
                          ? gt("On", { $context: "option state" })
                          : gt("Off", { $context: "option state" })}
                      </Text>
                    </Pressable>
                  </NativeGlassCapsule>
                );
              }

              const choices = selectableChoices(control.descriptor);
              const currentValue = getProviderOptionCurrentValue(
                control.descriptor,
                session.displayedModelSelection,
                session.reportedModelSelection,
              );
              const currentLabel =
                getProviderOptionCurrentLabel(
                  control.descriptor,
                  session.displayedModelSelection,
                  session.reportedModelSelection,
                ) ?? "";
              const actions: MenuAction[] = choices.map((choice) => ({
                id: choice.id,
                title: choice.label,
                subtitle: choice.description,
                state: choice.id === currentValue ? ("on" as const) : ("off" as const),
              }));
              return (
                <Menu
                  key={control.descriptor.id}
                  title={control.descriptor.label}
                  actions={actions}
                  onPressAction={({ nativeEvent }) => {
                    void Haptics.selectionAsync();
                    session.applyOptionChange(control.descriptor.id, nativeEvent.event);
                  }}
                >
                  <NativeGlassCapsule
                    isDarkMode={isDarkMode}
                    fallbackBackgroundColor={surface.pill}
                  >
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`${control.descriptor.label}: ${currentLabel}`}
                      className="h-[30px] flex-row items-center gap-1.5 rounded-full px-3 active:opacity-75"
                    >
                      <Text
                        className="text-[12px] font-t3-medium text-foreground/85"
                        numberOfLines={1}
                      >
                        {control.descriptor.label}
                      </Text>
                      <Text
                        className="text-[12px] font-t3-semibold text-foreground"
                        numberOfLines={1}
                      >
                        {currentLabel}
                      </Text>
                      <SymbolView
                        name="chevron.down"
                        size={10}
                        tintColorClassName="accent-foreground"
                        style={{ opacity: 0.85 }}
                        type="monochrome"
                      />
                    </Pressable>
                  </NativeGlassCapsule>
                </Menu>
              );
            })}
          </ScrollView>
        ) : (
          <View className="min-w-0 flex-row items-center gap-1.5">
            <SymbolView
              name="shield"
              size={13}
              tintColorClassName="accent-foreground"
              style={{ opacity: 0.88 }}
              type="monochrome"
            />
            <Text className="text-[12.5px] font-t3-medium text-foreground/90" numberOfLines={1}>
              {gt("Runtime", { $context: "agent permission mode setting" })}
            </Text>
          </View>
        )}

        <Menu
          title={gt("Runtime", { $context: "agent permission mode setting" })}
          actions={runtimeMenuActions}
          onPressAction={({ nativeEvent }) => {
            const match = session.runtimeModeChoices.find(
              (choice) => choice.mode === nativeEvent.event && !choice.disabledReason,
            );
            if (!match) return;
            void Haptics.selectionAsync();
            session.onUpdateRuntimeMode(match.mode);
          }}
        >
          <NativeGlassCapsule
            isDarkMode={isDarkMode}
            fallbackBackgroundColor={surface.pill}
            className="shrink-0"
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={gt("Runtime: {mode}", { mode: currentRuntimeLabel })}
              className="h-[30px] shrink-0 flex-row items-center gap-1.5 rounded-full px-3 active:opacity-70"
            >
              {others.length > 0 ? (
                <SymbolView
                  name="shield"
                  size={12}
                  tintColorClassName="accent-foreground"
                  style={{ opacity: 0.88 }}
                  type="monochrome"
                />
              ) : null}
              <Text className="text-[12.5px] font-t3-semibold text-foreground" numberOfLines={1}>
                {currentRuntimeLabel}
              </Text>
              <SymbolView
                name="chevron.down"
                size={10}
                tintColorClassName="accent-foreground"
                style={{ opacity: 0.85 }}
                type="monochrome"
              />
            </Pressable>
          </NativeGlassCapsule>
        </Menu>
      </View>
    </View>
  );
}

function ThreadSettingsModelListRow(props: {
  readonly option: ModelOption;
  readonly showProviderIcon: boolean;
  readonly isFirst: boolean;
  readonly isLast: boolean;
}) {
  const session = useThreadSettingsSession();
  return (
    <ModelRow
      isFirst={props.isFirst}
      isLast={props.isLast}
      showProviderIcon={props.showProviderIcon}
      onPress={() => session.pressModel(props.option)}
      isFavorite={session.favoriteKeys.has(props.option.key)}
      favoritesLoaded={session.favoritesLoaded}
      onToggleFavorite={() => session.toggleFavorite(props.option)}
      onToggleHidden={
        session.manageHidden && props.option.canHide
          ? () => session.toggleHidden(props.option)
          : undefined
      }
      hiddenUpdatePending={session.pendingHiddenKeys.has(props.option.key)}
      option={props.option}
      selected={session.isApplied(props.option)}
    />
  );
}

function ThreadSettingsSheetBody(props: { readonly onClose: () => void }) {
  const gt = useGT();
  const m = useMessages();
  const locale = useLocale();
  const fadeGradientId = useId();
  const session = useThreadSettingsSession();
  const { themeAppearance } = useAppearancePreferences();
  const isDarkMode = themeAppearance === "dark";
  const surface = modelSheetSurface(isDarkMode);
  const [searchExpanded, setSearchExpanded] = useState(false);

  const refreshProvidersCommand = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });
  const refreshProviderCatalog = createProviderCatalogRefreshRunner(refreshProvidersCommand);
  const registry = use(RegistryContext);
  const refreshModelCatalog = useEffectEvent(() => {
    const environmentId = session.environmentId;
    if (!environmentId) return;
    const config = registry.get(environmentServerConfigsAtom).get(environmentId);
    if (config?.environment.capabilities.modelCatalogRefresh !== true) return;
    void refreshProvidersCommand({ environmentId, input: { modelCatalogOnly: true } });
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- asks the server for newly released models when the model list opens
  useEffect(() => {
    refreshModelCatalog();
  }, []);

  const [isRefreshingProviders, setIsRefreshingProviders] = useState(false);
  const refreshProviders = () => {
    if (!session.environmentId || isRefreshingProviders) return;
    setIsRefreshingProviders(true);
    const environmentId = session.environmentId;
    const workspaceScan = session.workspaceScan;
    void refreshProviderCatalog(environmentId)
      .then(async (result) => {
        if (result._tag === "Success" && workspaceScan) {
          await refreshProvidersCommand({
            environmentId,
            input: { ...workspaceScan, fresh: true },
          });
        }
        return result;
      })
      .then((result) => {
        setIsRefreshingProviders(false);
        const error = providerCatalogRefreshError(result);
        if (error) Dialog.alert(gt("Could not refresh models"), error);
      });
  };

  const isSearching = session.searchQuery.trim().length > 0;
  const tabKeys: readonly ActiveTab[] = [
    "favorites",
    ...session.providerGroups.map((group) => group.providerKey),
  ];
  const pagerRef = useRef<ScrollViewInstance>(null);
  const [pagerWidth, setPagerWidth] = useState(0);
  const lastPagerWidthRef = useRef(0);
  const lastScrolledTabRef = useRef<ActiveTab>(session.activeTab);
  const programmaticTargetIndexRef = useRef<number | null>(null);
  const didInitialScrollRef = useRef(false);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps the native paging ScrollView aligned when the user taps a top provider tab or rotates the screen
  useEffect(() => {
    if (isSearching || pagerWidth <= 0) return;
    const targetIndex = Math.max(0, tabKeys.indexOf(session.activeTab));
    const widthChanged = lastPagerWidthRef.current !== pagerWidth;
    const tabChangedProgrammatically =
      didInitialScrollRef.current && lastScrolledTabRef.current !== session.activeTab;
    const isInitial = !didInitialScrollRef.current;
    didInitialScrollRef.current = true;
    lastPagerWidthRef.current = pagerWidth;
    lastScrolledTabRef.current = session.activeTab;
    if (tabChangedProgrammatically) {
      programmaticTargetIndexRef.current = targetIndex;
      pagerRef.current?.scrollTo({ x: targetIndex * pagerWidth, animated: true });
    } else if (isInitial || widthChanged) {
      programmaticTargetIndexRef.current = null;
      pagerRef.current?.scrollTo({ x: targetIndex * pagerWidth, animated: false });
    }
  }, [isSearching, pagerWidth, session.activeTab, tabKeys]);

  const commitLiveTabForOffset = (offsetX: number, withHaptic: boolean) => {
    if (pagerWidth <= 0) return;
    const nextIndex = Math.max(0, Math.min(tabKeys.length - 1, Math.round(offsetX / pagerWidth)));
    const nextTab = tabKeys[nextIndex];
    if (nextTab && nextTab !== lastScrolledTabRef.current) {
      lastScrolledTabRef.current = nextTab;
      if (withHaptic) void Haptics.selectionAsync();
      session.setActiveTab(nextTab);
    }
  };

  const handlePagerScroll = (offsetX: number) => {
    if (pagerWidth <= 0) return;
    const target = programmaticTargetIndexRef.current;
    if (target !== null) {
      if (Math.abs(offsetX - target * pagerWidth) <= 2) {
        programmaticTargetIndexRef.current = null;
      }
      return;
    }
    commitLiveTabForOffset(offsetX, true);
  };

  const handlePagerEndDrag = (offsetX: number, targetOffsetX: number | undefined) => {
    if (pagerWidth <= 0) return;
    programmaticTargetIndexRef.current = null;
    commitLiveTabForOffset(targetOffsetX ?? offsetX, true);
  };

  const handlePagerSettled = (offsetX: number) => {
    programmaticTargetIndexRef.current = null;
    commitLiveTabForOffset(offsetX, false);
  };

  const renderCatalogItem = (itemProps: LegendListRenderItemProps<ThreadSettingsCatalogItem>) => {
    const item = itemProps.item;
    let content: ReactNode;

    if (item.kind === "subProvider") {
      content = (
        <SubProviderSectionHeader
          collapsible={item.detail === undefined}
          collapsed={item.collapsed}
          detail={item.detail}
          label={item.label}
          modelCount={item.modelCount}
          onToggle={() => session.toggleProvider(item.expansionKey)}
        />
      );
    } else if (item.kind === "model") {
      content = (
        <ThreadSettingsModelListRow
          isFirst={item.isFirst}
          isLast={item.isLast}
          showProviderIcon={item.showProviderIcon}
          option={item.option}
        />
      );
    } else if (item.kind === "notice") {
      content = <Text className="mx-6 mt-2 text-xs text-foreground-muted">{item.text}</Text>;
    } else {
      content = (
        <View className="items-center px-8 py-14">
          <Text className="text-center text-sm text-foreground-muted">
            {!isSearching && item.key === "empty:favorites"
              ? gt("No favorite models")
              : isSearching
                ? gt("No matching models")
                : gt("No available models")}
          </Text>
        </View>
      );
    }

    return content;
  };

  const favoriteOrderSignature = session.favoriteOrderKeys.join(",");

  const renderCardList = (tab: ActiveTab) => {
    const items = buildCatalogItemsForTab(session, tab, m, locale);
    const data: ReadonlyArray<ThreadSettingsCatalogItem> =
      items.length === 0 ? [{ kind: "empty", key: `empty:${tab}` }] : items;
    const extraData = `${tab}:${session.displayedModelSelection?.model ?? ""}:${favoriteOrderSignature}:${isDarkMode ? "d" : "l"}`;
    return (
      <View className="relative min-h-0 flex-1 overflow-hidden">
        {/* oxlint-disable-next-line t3code/require-registered-list-scroll -- Sheet content; sits above the sticky thumb deck. */}
        <LegendList
          alwaysBounceVertical
          nestedScrollEnabled
          className="flex-1"
          style={[READABLE_WIDTH_STYLE, { backgroundColor: "transparent" }]}
          contentContainerStyle={{ paddingTop: 4, paddingBottom: 10 }}
          data={data}
          estimatedItemSize={39}
          extraData={extraData}
          getItemType={(item) => item.kind}
          keyExtractor={(item) => item.key}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          maintainVisibleContentPosition={THREAD_SETTINGS_MAINTAIN_VISIBLE_CONTENT_POSITION}
          recycleItems
          refreshControl={
            session.environmentId ? (
              <RefreshControl refreshing={isRefreshingProviders} onRefresh={refreshProviders} />
            ) : undefined
          }
          renderItem={renderCatalogItem}
          showsVerticalScrollIndicator={false}
        />

        {!NATIVE_LIQUID_GLASS_SUPPORTED ? (
          <View
            pointerEvents="none"
            style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 20 }}
          >
            <Svg width="100%" height={20}>
              <Defs>
                <LinearGradient id={fadeGradientId} x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0%" stopColor={surface.canvas} stopOpacity={0} />
                  <Stop offset="70%" stopColor={surface.canvas} stopOpacity={0.85} />
                  <Stop offset="100%" stopColor={surface.canvas} stopOpacity={1} />
                </LinearGradient>
              </Defs>
              <Rect x={0} y={0} width="100%" height={20} fill={`url(#${fadeGradientId})`} />
            </Svg>
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <View className="flex-1" style={{ backgroundColor: surface.canvas }}>
      <ThreadSettingsTopBar
        searchExpanded={searchExpanded}
        onOpenSearch={() => setSearchExpanded(true)}
        onCloseSearch={() => setSearchExpanded(false)}
        onRefresh={refreshProviders}
        onClose={props.onClose}
      />
      <View
        className="mx-[22px]"
        style={{ height: 0.5, backgroundColor: surface.divider }}
        accessible={false}
      />

      {isSearching ? (
        <View className="min-h-0 flex-1 px-[18px]">{renderCardList(session.activeTab)}</View>
      ) : (
        <View
          className="min-h-0 flex-1"
          onLayout={(event) => {
            const nextWidth = Math.round(event.nativeEvent.layout.width);
            if (nextWidth > 0 && nextWidth !== pagerWidth) {
              setPagerWidth(nextWidth);
            }
          }}
        >
          {pagerWidth > 0 ? (
            <ScrollView
              ref={pagerRef}
              horizontal
              pagingEnabled
              directionalLockEnabled
              decelerationRate="fast"
              scrollEventThrottle={16}
              showsHorizontalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              onScrollBeginDrag={() => {
                programmaticTargetIndexRef.current = null;
              }}
              onScroll={(event) => handlePagerScroll(event.nativeEvent.contentOffset.x)}
              onScrollEndDrag={(event) =>
                handlePagerEndDrag(
                  event.nativeEvent.contentOffset.x,
                  event.nativeEvent.targetContentOffset?.x,
                )
              }
              onMomentumScrollEnd={(event) => handlePagerSettled(event.nativeEvent.contentOffset.x)}
              className="flex-1"
            >
              {tabKeys.map((tab) => (
                <View key={tab} className="h-full px-[18px]" style={{ width: pagerWidth }}>
                  {renderCardList(tab)}
                </View>
              ))}
            </ScrollView>
          ) : (
            <View className="min-h-0 flex-1 px-[18px]">{renderCardList(session.activeTab)}</View>
          )}
        </View>
      )}

      <View
        className="mx-[22px]"
        style={{ height: 0.5, backgroundColor: surface.divider }}
        accessible={false}
      />
      {/* Permanently pinned thumb-zone bottom deck */}
      <ThreadSettingsThumbDeck />
    </View>
  );
}

export function ThreadSettingsPickerScreen(
  props: ThreadSettingsSessionProps & { readonly onClose: () => void },
) {
  return (
    <ThreadSettingsSessionProvider {...props}>
      <ThreadSettingsSheetBody onClose={props.onClose} />
    </ThreadSettingsSessionProvider>
  );
}

export function ExistingThreadSettingsRouteScreen({
  route,
}: StaticScreenProps<ExistingThreadSettingsRouteParams>) {
  const navigation = useNavigation<NativeStackNavigationProp<Record<string, object | undefined>>>();
  const { selectedThread, selectedThreadDetailRef, selectedEnvironmentRuntime } =
    useThreadSelection();
  const { selectedThreadCwd } = useSelectedThreadWorktree();
  const structure = useQuietThreadStructure(selectedThreadDetailRef);
  const reportedModelSelection = useThreadReportedModelSelection(selectedThreadDetailRef);
  const threadKey = scopedThreadKey(route.params.environmentId, route.params.threadId);
  const queuedRunEdit = useQueuedRunEdit(threadKey);
  const draftKey = activeComposerDraftKey(threadKey, route.params.draftKey, queuedRunEdit);
  const draftSettings = useComposerDraftSettings(draftKey);
  const threadDraftSettings = useComposerDraftSettings(threadKey);
  const prompt = useComposerDraft(draftKey).text;

  if (!selectedThread) {
    return <View className="flex-1 bg-sheet" />;
  }

  const serverConfig = serverConfigForCwd(
    selectedEnvironmentRuntime?.serverConfig ?? null,
    selectedThreadCwd,
  );
  const modelSelection = draftSettings.modelSelection ?? selectedThread.modelSelection;
  const lockedProviderInstanceId = threadAllowsProviderSwitch({
    thread: selectedThread,
    projection: structure?.projection,
  })
    ? undefined
    : modelSelection.instanceId;
  const modelOptions = buildModelOptions(
    serverConfig,
    modelSelection,
    lockedProviderInstanceId,
    selectedThread.projectId,
  );
  const currentModelOption =
    modelOptions.find(
      (option) =>
        option.selection.instanceId === modelSelection.instanceId &&
        option.selection.model === modelSelection.model,
    ) ?? null;
  const updateModelSelection = (selection: ModelSelection) =>
    selectThreadModel(route.params, selection);

  return (
    <ThreadSettingsPickerScreen
      environmentId={selectedThread.environmentId}
      projectId={selectedThread.projectId}
      cwd={selectedThreadCwd}
      providerInstanceId={modelSelection.instanceId}
      {...(lockedProviderInstanceId ? { lockedProviderInstanceId } : {})}
      providerGroups={groupByProvider(modelOptions)}
      selectedModel={modelSelection}
      prompt={prompt}
      onPromptChange={(text) => setComposerDraftText(draftKey, text)}
      reportedModelSelection={reportedModelSelection}
      onSelectModel={(option) =>
        updateModelSelection(
          withStoredThreadModelOptions(
            withRememberedModelOptions(option.selection),
            selectedThread.modelSelection,
          ),
        )
      }
      restoreSelection={withRememberedModelOptions}
      optionDescriptors={resolveProviderOptionDescriptors({
        capabilities: currentModelOption?.capabilities,
        selections: modelSelection.options,
      })}
      onUpdateOptionSelections={(options) => {
        rememberModelOptions(modelSelection.instanceId, modelSelection.model, options ?? []);
        updateModelSelection({ ...modelSelection, options });
      }}
      runtimeMode={threadDraftSettings.runtimeMode ?? selectedThread.runtimeMode}
      onUpdateRuntimeMode={(runtimeMode) => updateComposerDraftSettings(threadKey, { runtimeMode })}
      onClose={() => navigation.goBack()}
    />
  );
}

export function NewTaskThreadSettingsRouteScreen() {
  const flow = useNewTaskFlow();
  const navigation = useNavigation<NativeStackNavigationProp<Record<string, object | undefined>>>();
  const optionDescriptors = resolveProviderOptionDescriptors({
    capabilities: flow.selectedModelOption?.capabilities,
    selections: flow.selectedModel?.options,
  });

  return (
    <ThreadSettingsPickerScreen
      environmentId={flow.selectedEnvironmentId}
      projectId={flow.selectedProject?.id ?? null}
      cwd={flow.workspaceCwd}
      {...(flow.selectedModel ? { providerInstanceId: flow.selectedModel.instanceId } : {})}
      providerGroups={flow.providerGroups}
      selectedModel={flow.selectedModel}
      prompt={flow.prompt}
      onPromptChange={flow.setPrompt}
      onSelectModel={(option) => flow.setSelectedModelKey(option.key, option.selection.options)}
      restoreSelection={withRememberedModelOptions}
      optionDescriptors={optionDescriptors}
      onUpdateOptionSelections={flow.setSelectedModelOptions}
      runtimeMode={flow.runtimeMode}
      onUpdateRuntimeMode={flow.setRuntimeMode}
      onClose={() => navigation.goBack()}
    />
  );
}
