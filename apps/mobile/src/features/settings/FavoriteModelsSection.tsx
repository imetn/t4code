import { useAtomValue } from "@effect/atom-react";
import {
  PROVIDER_DISPLAY_NAMES,
  type ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import type { ModelPreferences } from "@t3tools/contracts/settings";
import { resolveProviderInstanceDisplayName } from "@t3tools/client-runtime/state/provider-instance-display";
import {
  modelFavoriteListsEqual,
  reorderModelFavorites,
  resolveModelPreferences,
} from "@t3tools/shared/serverSettings";
import { AsyncResult } from "effect/reactivity";
import * as Haptics from "expo-haptics";
import { useGT } from "gt-react-native";
import { useRef, useState } from "react";
import { Pressable, View } from "react-native";
import Animated, { ReduceMotion, useAnimatedStyle, withTiming } from "react-native-reanimated";

import { ProviderIcon } from "../../components/ProviderIcon";
import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { cn } from "../../lib/cn";
import { mobilePreferencesAtom } from "../../state/preferences";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { modelFavoriteKey } from "../threads/thread-settings-sheet-state";
import { SettingsDragHandle } from "./components/SettingsDragHandle";
import { SettingsSection } from "./components/SettingsSection";
import type { SettingsTarget } from "./settings-environment-filter";

const EMPTY_FAVORITES: ModelPreferences["favorites"] = [];

interface ResolvedFavoriteModel {
  readonly key: string;
  readonly provider: ProviderInstanceId;
  readonly model: string;
  readonly modelLabel: string;
  readonly providerLabel: string;
  readonly providerDriver: string;
  readonly providerIconUrl?: string | undefined;
}

function FavoriteModelSettingRow(props: {
  readonly item: ResolvedFavoriteModel;
  readonly divider: boolean;
  readonly canReorder: boolean;
  readonly canWrite: boolean;
  readonly canMoveUp: boolean;
  readonly canMoveDown: boolean;
  readonly offset: number;
  readonly lifted: boolean;
  readonly onHeight: (height: number) => void;
  readonly onDragStart: () => void;
  readonly onDragMove: (translation: number) => void;
  readonly onDragEnd: (translation: number, cancelled: boolean) => void;
  readonly onStep: (direction: "up" | "down") => void;
  readonly onRemove: () => void;
}) {
  const gt = useGT();
  const { lifted, offset } = props;
  const style = useAnimatedStyle(() => ({
    transform: [
      {
        translateY: lifted
          ? offset
          : withTiming(offset, { duration: 160, reduceMotion: ReduceMotion.System }),
      },
    ],
    zIndex: lifted ? 10 : 0,
  }));

  return (
    <Animated.View
      style={style}
      onLayout={(event) => props.onHeight(event.nativeEvent.layout.height)}
      className={cn(
        "flex-row items-center bg-surface",
        props.divider && !lifted && "border-t border-border-subtle",
        lifted && "rounded-xl shadow-md",
      )}
    >
      <View
        className={cn(
          "min-h-[52px] min-w-0 flex-1 flex-row items-center gap-3 py-2.5 pl-4",
          !props.canReorder && "pr-2",
        )}
      >
        <ProviderIcon
          iconUrl={props.item.providerIconUrl}
          provider={props.item.providerDriver}
          size={16}
        />
        <View className="min-w-0 flex-1 gap-0.5">
          <Text numberOfLines={1} className="text-base font-t3-medium text-foreground">
            {props.item.modelLabel}
          </Text>
          <Text numberOfLines={1} className="text-xs text-foreground-muted">
            {props.item.providerLabel}
          </Text>
        </View>
      </View>

      {props.canWrite ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={gt("Remove from favorites: {provider}, {model}", {
            provider: props.item.providerLabel,
            model: props.item.modelLabel,
          })}
          onPress={props.onRemove}
          hitSlop={8}
          className="h-10 w-10 items-center justify-center active:opacity-60"
        >
          <SymbolView name="star.fill" size={16} tintColor="#f59e0b" type="monochrome" />
        </Pressable>
      ) : null}

      {props.canReorder ? (
        <SettingsDragHandle
          title={props.item.modelLabel}
          canMoveUp={props.canMoveUp}
          canMoveDown={props.canMoveDown}
          onStart={props.onDragStart}
          onMove={props.onDragMove}
          onEnd={props.onDragEnd}
          onStep={props.onStep}
        />
      ) : null}
    </Animated.View>
  );
}

export function FavoriteModelsSection({
  environment,
  providers,
  canWriteSettings,
  onDraggingChange,
}: {
  readonly environment: SettingsTarget;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly canWriteSettings: boolean;
  readonly onDraggingChange?: (dragging: boolean) => void;
}) {
  const gt = useGT();
  const preferences = useAtomValue(mobilePreferencesAtom);
  const saveSettings = useAtomCommand(serverEnvironment.updateSettings, "favorite models reorder");
  const [pendingFavorites, setPendingFavorites] = useState<ModelPreferences["favorites"] | null>(
    null,
  );
  const [drag, setDrag] = useState<{ readonly key: string; readonly translation: number } | null>(
    null,
  );
  const [heights, setHeights] = useState<ReadonlyMap<string, number>>(() => new Map());
  const [drops, setDrops] = useState(0);
  const lastHoverIndexRef = useRef(-1);

  const legacyFavorites = AsyncResult.isSuccess(preferences)
    ? (preferences.value.modelFavorites ?? EMPTY_FAVORITES)
    : EMPTY_FAVORITES;
  const savedFavorites = resolveModelPreferences(environment.serverConfig.settings, {
    favorites: legacyFavorites,
  }).favorites;
  if (pendingFavorites !== null && modelFavoriteListsEqual(pendingFavorites, savedFavorites)) {
    setPendingFavorites(null);
  }
  const favorites = pendingFavorites ?? savedFavorites;

  if (favorites.length === 0) return null;

  const providerById = new Map(providers.map((provider) => [provider.instanceId, provider]));
  const configuredInstances = environment.serverConfig.settings.providerInstances;

  const items: ResolvedFavoriteModel[] = favorites.map((favorite) => {
    const liveProvider = providerById.get(favorite.provider);
    const explicit = configuredInstances?.[favorite.provider];
    const driver = liveProvider?.driver ?? explicit?.driver ?? String(favorite.provider);
    const providerLabel = liveProvider
      ? resolveProviderInstanceDisplayName(liveProvider)
      : (explicit?.displayName?.trim() ??
        (PROVIDER_DISPLAY_NAMES as Record<string, string | undefined>)[driver] ??
        String(favorite.provider));
    const matchedModel = liveProvider?.models.find((model) => model.slug === favorite.model);
    return {
      key: modelFavoriteKey(favorite.provider, favorite.model),
      provider: favorite.provider,
      model: favorite.model,
      modelLabel: matchedModel?.name ?? favorite.model,
      providerLabel,
      providerDriver: driver,
      providerIconUrl: liveProvider?.driver === "acpRegistry" ? liveProvider.iconUrl : undefined,
    };
  });

  const canReorder = canWriteSettings && items.length > 1;
  const visibleKeys = items.map((item) => item.key);
  const dropIndex = (from: number, translation: number) => {
    const step = translation > 0 ? 1 : -1;
    let to = from;
    let remaining = Math.abs(translation);
    while (to + step >= 0 && to + step < visibleKeys.length) {
      const next = heights.get(visibleKeys[to + step]!) ?? 52;
      if (next === 0 || remaining < next / 2) break;
      remaining -= next;
      to += step;
    }
    return to;
  };
  const dragFrom = drag === null ? -1 : visibleKeys.indexOf(drag.key);
  const dragTo = drag === null ? -1 : dropIndex(dragFrom, drag.translation);

  const commitMove = (from: number, to: number) => {
    if (!canReorder || to < 0 || to >= visibleKeys.length || from === to) return;
    const fromKey = visibleKeys[from];
    const toKey = visibleKeys[to];
    if (!fromKey || !toKey) return;
    const nextFavorites = reorderModelFavorites(favorites, visibleKeys, fromKey, toKey);
    if (modelFavoriteListsEqual(nextFavorites, favorites)) return;
    setPendingFavorites(nextFavorites);
    void saveSettings({
      environmentId: environment.environmentId,
      input: { patch: { favorites: nextFavorites } },
    }).then((result) => {
      if (result._tag === "Failure") {
        setPendingFavorites(null);
      }
    });
  };

  const removeFavorite = (provider: ProviderInstanceId, model: string) => {
    if (!canWriteSettings) return;
    void Haptics.selectionAsync();
    const nextFavorites = favorites.filter(
      (favorite) => !(favorite.provider === provider && favorite.model === model),
    );
    setPendingFavorites(nextFavorites);
    void saveSettings({
      environmentId: environment.environmentId,
      input: {
        patch: {
          setModelFavorites: [{ provider, model, favorite: false }],
        },
      },
    }).then((result) => {
      if (result._tag === "Failure") {
        setPendingFavorites(null);
      }
    });
  };

  return (
    <SettingsSection
      title={gt("Favorite models")}
      footer={
        canReorder
          ? gt("Drag handles to reorder favorite models across the model picker on every device.")
          : undefined
      }
    >
      {items.map((item, index) => {
        const liftedHeight = drag === null ? 0 : (heights.get(drag.key) ?? 52);
        const shift =
          dragFrom === -1 || index === dragFrom
            ? 0
            : dragFrom < dragTo && index > dragFrom && index <= dragTo
              ? -liftedHeight
              : dragFrom > dragTo && index < dragFrom && index >= dragTo
                ? liftedHeight
                : 0;
        return (
          <FavoriteModelSettingRow
            key={`${item.key}:${drops}`}
            item={item}
            divider={index > 0}
            canReorder={canReorder}
            canWrite={canWriteSettings}
            canMoveUp={index > 0}
            canMoveDown={index < items.length - 1}
            offset={index === dragFrom ? (drag?.translation ?? 0) : shift}
            lifted={index === dragFrom}
            onHeight={(height) =>
              setHeights((current) =>
                current.get(item.key) === height ? current : new Map(current).set(item.key, height),
              )
            }
            onDragStart={() => {
              lastHoverIndexRef.current = index;
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setDrag({ key: item.key, translation: 0 });
              onDraggingChange?.(true);
            }}
            onDragMove={(translation) => {
              const nextTarget = dropIndex(index, translation);
              if (nextTarget !== lastHoverIndexRef.current) {
                lastHoverIndexRef.current = nextTarget;
                void Haptics.selectionAsync();
              }
              setDrag({ key: item.key, translation });
            }}
            onDragEnd={(translation, cancelled) => {
              const target = dropIndex(index, translation);
              lastHoverIndexRef.current = -1;
              setDrag(null);
              onDraggingChange?.(false);
              setDrops((count) => count + 1);
              if (!cancelled) commitMove(index, target);
            }}
            onStep={(direction) => {
              void Haptics.selectionAsync();
              commitMove(index, direction === "up" ? index - 1 : index + 1);
            }}
            onRemove={() => removeFavorite(item.provider, item.model)}
          />
        );
      })}
    </SettingsSection>
  );
}
