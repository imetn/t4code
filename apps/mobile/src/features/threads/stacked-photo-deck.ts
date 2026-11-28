export const STACKED_DECK_MAX_VISIBLE_LAYERS = 3;
export const STACKED_DECK_PEEK_STEP = 12;

export interface DeckLayer {
  readonly itemIndex: number;
  readonly layer: number;
}

export function cycleDeckIndex(currentIndex: number, count: number, delta: -1 | 1): number {
  if (count <= 1) return 0;
  const normalized = ((currentIndex % count) + count) % count;
  return (normalized + delta + count) % count;
}

/**
 * Returns visible cards ordered back-to-front (`layer` descending) so React renders
 * the active front card (`layer === 0`) on top without relying on zIndex alone.
 */
export function visibleDeckLayers(
  activeIndex: number,
  count: number,
  maxVisible = STACKED_DECK_MAX_VISIBLE_LAYERS,
): ReadonlyArray<DeckLayer> {
  if (count <= 0) return [];
  const normalized = ((activeIndex % count) + count) % count;
  const visibleCount = Math.min(count, Math.max(1, maxVisible));
  const layers: DeckLayer[] = [];
  for (let layer = visibleCount - 1; layer >= 0; layer -= 1) {
    layers.push({
      itemIndex: (normalized + layer) % count,
      layer,
    });
  }
  return layers;
}

export function resolveDeckDimensions(maxWidth: number, count: number) {
  const backingCards = Math.min(Math.max(count - 1, 0), STACKED_DECK_MAX_VISIBLE_LAYERS - 1);
  const peekTotalWidth = backingCards * STACKED_DECK_PEEK_STEP;
  const expandPillAllowance = 86;
  const availableForCard = Math.max(140, maxWidth - peekTotalWidth - expandPillAllowance);
  const cardWidth = Math.min(204, Math.round(availableForCard));
  const cardHeight = Math.round(cardWidth * 1.24);
  return {
    cardWidth,
    cardHeight,
    peekTotalWidth,
  } as const;
}

export type ExpandedPhotoGridMode = "two-col" | "three-hero" | "three-col";

export function resolveExpandedPhotoGrid(count: number): {
  readonly mode: ExpandedPhotoGridMode;
  readonly rowHeight: number;
} {
  if (count === 3) return { mode: "three-hero", rowHeight: 192 };
  if (count === 2) return { mode: "two-col", rowHeight: 172 };
  if (count === 4) return { mode: "two-col", rowHeight: 144 };
  return { mode: "three-col", rowHeight: 102 };
}
