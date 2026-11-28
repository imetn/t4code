import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { restrictToParentElement, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  PROVIDER_DISPLAY_NAMES,
  type ProviderDriverKind,
  type ProviderInstanceConfig,
  type ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import type { UnifiedSettings } from "@t3tools/contracts/settings";
import { modelFavoriteListsEqual, reorderModelFavorites } from "@t3tools/shared/serverSettings";
import { T, useGT } from "gt-react";
import { ArrowDownIcon, ArrowUpIcon, GripVerticalIcon, StarIcon } from "lucide-react";
import { useState } from "react";

import { cn } from "../../lib/utils";
import { providerModelKey } from "../../modelOrdering";
import { deriveProviderInstanceEntries, shouldShowInstanceBadge } from "../../providerInstances";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { SettingsRow, SettingsSection } from "./settingsLayout";

interface ResolvedFavoriteRow {
  readonly key: string;
  readonly provider: ProviderInstanceId;
  readonly model: string;
  readonly modelName: string;
  readonly driverKind: ProviderDriverKind | null;
  readonly providerDisplayName: string;
  readonly providerAccentColor?: string | undefined;
  readonly acpRegistryAgentId?: string | undefined;
  readonly acpRegistryIconUrl?: string | undefined;
  readonly showInstanceBadge: boolean;
  readonly unavailable: boolean;
}

function SortableFavoriteModelSettingRow({
  item,
  canReorder,
  canWrite,
  canMoveUp,
  canMoveDown,
  onMove,
  onRemove,
}: {
  readonly item: ResolvedFavoriteRow;
  readonly canReorder: boolean;
  readonly canWrite: boolean;
  readonly canMoveUp: boolean;
  readonly canMoveDown: boolean;
  readonly onMove: (direction: -1 | 1) => void;
  readonly onRemove: () => void;
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
  } = useSortable({ id: item.key, disabled: !canReorder });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      data-favorite-model-row={item.key}
      className={cn(
        "flex items-center gap-2.5 bg-card px-3 py-2.5 sm:px-4",
        isDragging && "relative z-10 rounded-md shadow-md ring-1 ring-border",
      )}
    >
      {canReorder ? (
        <button
          ref={setActivatorNodeRef}
          type="button"
          {...attributes}
          {...listeners}
          aria-label={gt("Drag to reorder {name}", { name: item.modelName })}
          className="flex size-6 shrink-0 cursor-grab touch-none items-center justify-center rounded text-muted-foreground/50 transition-colors hover:bg-muted/60 hover:text-foreground active:cursor-grabbing focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <GripVerticalIcon className="size-3.5" aria-hidden="true" />
        </button>
      ) : null}

      {item.driverKind !== null ? (
        <ProviderInstanceIcon
          driverKind={item.driverKind}
          displayName={item.providerDisplayName}
          accentColor={item.providerAccentColor}
          acpRegistryAgentId={item.acpRegistryAgentId}
          acpRegistryIconUrl={item.acpRegistryIconUrl}
          showBadge={item.showInstanceBadge}
          className="size-4 shrink-0"
          iconClassName="size-3.5"
          indicatorBackground="var(--card)"
          badgeClassName="right-[-0.125rem] bottom-[-0.125rem] h-3 min-w-3 px-0.5 text-5xs"
        />
      ) : null}

      <div className="flex min-w-0 flex-1 items-baseline gap-2">
        <span className="truncate text-sm font-medium text-foreground">{item.modelName}</span>
        <span className="shrink-0 text-xs text-muted-foreground">{item.providerDisplayName}</span>
        {item.modelName !== item.model ? (
          <code className="hidden truncate font-mono text-2xs text-muted-foreground/70 sm:inline">
            {item.model}
          </code>
        ) : null}
        {item.unavailable ? (
          <Badge variant="outline" size="sm">
            <T context="badge on a model that cannot be selected">Unavailable</T>
          </Badge>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-0.5">
        {canReorder ? (
          <>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    size="icon-micro"
                    variant="ghost-muted"
                    disabled={!canMoveUp}
                    onClick={() => onMove(-1)}
                    aria-label={gt("Move {name} up", { name: item.modelName })}
                  />
                }
              >
                <ArrowUpIcon className="size-3" />
              </TooltipTrigger>
              <TooltipPopup side="top">
                <T>Move up</T>
              </TooltipPopup>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    size="icon-micro"
                    variant="ghost-muted"
                    disabled={!canMoveDown}
                    onClick={() => onMove(1)}
                    aria-label={gt("Move {name} down", { name: item.modelName })}
                  />
                }
              >
                <ArrowDownIcon className="size-3" />
              </TooltipTrigger>
              <TooltipPopup side="top">
                <T>Move down</T>
              </TooltipPopup>
            </Tooltip>
          </>
        ) : null}

        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                size="icon-micro"
                variant="ghost-muted"
                disabled={!canWrite}
                onClick={onRemove}
                aria-label={gt("Remove {name} from favorites", { name: item.modelName })}
              />
            }
          >
            <StarIcon className="size-3.5 fill-current text-warning" />
          </TooltipTrigger>
          <TooltipPopup side="top">
            <T>Remove from favorites</T>
          </TooltipPopup>
        </Tooltip>
      </div>
    </li>
  );
}

export function FavoriteModelsSection({
  favorites: savedFavorites,
  providers,
  providerInstances,
  readOnly,
  canWriteSettings,
  onReorderFavorites,
  onToggleFavorite,
}: {
  readonly favorites: UnifiedSettings["favorites"];
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly providerInstances: Readonly<Record<string, ProviderInstanceConfig>> | undefined;
  readonly readOnly: boolean;
  readonly canWriteSettings: boolean;
  readonly onReorderFavorites: (next: UnifiedSettings["favorites"]) => Promise<boolean>;
  readonly onToggleFavorite: (provider: ProviderInstanceId, model: string) => void;
}) {
  const gt = useGT();
  const [pendingFavorites, setPendingFavorites] = useState<UnifiedSettings["favorites"] | null>(
    null,
  );
  if (pendingFavorites !== null && modelFavoriteListsEqual(pendingFavorites, savedFavorites)) {
    setPendingFavorites(null);
  }
  const favorites = pendingFavorites ?? savedFavorites;

  const canWrite = !readOnly && canWriteSettings;
  const canReorder = canWrite && favorites.length > 1;
  const entries = deriveProviderInstanceEntries(providers);
  const entryById = new Map(entries.map((entry) => [entry.instanceId, entry] as const));
  const badgedInstanceIds = new Set(
    entries
      .filter((entry) => shouldShowInstanceBadge(entry, entries))
      .map((entry) => entry.instanceId),
  );

  const rows: ResolvedFavoriteRow[] = favorites.map((favorite) => {
    const entry = entryById.get(favorite.provider);
    const explicit = providerInstances?.[favorite.provider];
    const driverKind = entry?.driverKind ?? explicit?.driver ?? null;
    const providerDisplayName =
      entry?.displayName ??
      explicit?.displayName?.trim() ??
      (driverKind !== null ? (PROVIDER_DISPLAY_NAMES[driverKind] ?? String(driverKind)) : null) ??
      String(favorite.provider);
    const matchedModel = entry?.models.find((model) => model.slug === favorite.model);
    const key = providerModelKey(favorite.provider, favorite.model);
    return {
      key,
      provider: favorite.provider,
      model: favorite.model,
      modelName: matchedModel?.name ?? favorite.model,
      driverKind,
      providerDisplayName,
      providerAccentColor: entry?.accentColor,
      acpRegistryAgentId: entry?.acpRegistryAgentId,
      acpRegistryIconUrl: entry?.acpRegistryIconUrl,
      showInstanceBadge: badgedInstanceIds.has(favorite.provider),
      unavailable: entry === undefined || !entry.enabled || matchedModel === undefined,
    };
  });

  const keys = rows.map((row) => row.key);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const commitReorder = (fromKey: string, toKey: string) => {
    if (!canReorder || fromKey === toKey) return;
    const next = reorderModelFavorites(favorites, keys, fromKey, toKey);
    if (modelFavoriteListsEqual(next, favorites)) return;
    setPendingFavorites(next);
    void onReorderFavorites(next).then((ok) => {
      if (!ok) setPendingFavorites(null);
    });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    if (event.over === null || event.active.id === event.over.id) return;
    commitReorder(String(event.active.id), String(event.over.id));
  };

  return (
    <SettingsSection
      title={gt("Favorite models")}
      headerAction={
        rows.length > 0 ? (
          <span className="text-xs text-muted-foreground">
            {gt("{count, plural, one {{count} favorite} other {{count} favorites}}", {
              count: rows.length,
            })}
          </span>
        ) : null
      }
    >
      {rows.length === 0 ? (
        <SettingsRow
          title={gt("No favorites yet")}
          description={gt(
            "Star models in a provider's model list or the model picker to pin and reorder them here.",
          )}
        />
      ) : (
        <div className="divide-y divide-border/50">
          <div className="px-3 py-2 text-xs text-muted-foreground sm:px-4">
            <T>
              Drag or use the arrows to reorder favorite models across the model picker on every
              device.
            </T>
          </div>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToVerticalAxis, restrictToParentElement]}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={keys} strategy={verticalListSortingStrategy}>
              <ol aria-label={gt("Favorite models")} className="divide-y divide-border/50">
                {rows.map((row, index) => (
                  <SortableFavoriteModelSettingRow
                    key={row.key}
                    item={row}
                    canReorder={canReorder}
                    canWrite={canWrite}
                    canMoveUp={index > 0}
                    canMoveDown={index < rows.length - 1}
                    onMove={(direction) => {
                      const target = rows[index + direction];
                      if (target) commitReorder(row.key, target.key);
                    }}
                    onRemove={() => {
                      setPendingFavorites(null);
                      onToggleFavorite(row.provider, row.model);
                    }}
                  />
                ))}
              </ol>
            </SortableContext>
          </DndContext>
        </div>
      )}
    </SettingsSection>
  );
}
