export const STACKED_DECK_MAX_VISIBLE_LAYERS = 3;
export const STACKED_DECK_PEEK_STEP = 12;
export const STACKED_DECK_DEFAULT_ASPECT_RATIO = 0.75;
const STACKED_DECK_MIN_CARD_WIDTH = 148;
const STACKED_DECK_MAX_CARD_WIDTH = 224;
const STACKED_DECK_MIN_CARD_HEIGHT = 128;
const STACKED_DECK_MAX_CARD_HEIGHT = 360;

export interface DeckLayer {
  readonly itemIndex: number;
  readonly layer: number;
}

export interface DeckCardPose {
  readonly translateX: number;
  readonly translateY: number;
  readonly scale: number;
  readonly rotateZ: number;
  readonly opacity: number;
  readonly zIndex: number;
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

/**
 * Returns deduplicated item indices to keep mounted for seamless circular deck shuffles:
 * the visible 3 layers, the next hidden back layer (for left swipe), and the immediate
 * previous card behind the deck (for right swipe).
 */
export function mountedDeckItemIndices(activeIndex: number, count: number): ReadonlyArray<number> {
  if (count <= 0) return [];
  const normalized = ((activeIndex % count) + count) % count;
  const result: number[] = [];
  const add = (idx: number) => {
    if (!result.includes(idx)) result.push(idx);
  };
  // Mount previous card and incoming back card first so native sibling order stays back-to-front.
  add((normalized - 1 + count) % count);
  if (count > STACKED_DECK_MAX_VISIBLE_LAYERS) {
    add((normalized + STACKED_DECK_MAX_VISIBLE_LAYERS) % count);
  }
  const visibleCount = Math.min(count, STACKED_DECK_MAX_VISIBLE_LAYERS);
  for (let layer = visibleCount - 1; layer >= 0; layer -= 1) {
    add((normalized + layer) % count);
  }
  return result;
}

/**
 * Worklet-safe circular shuffle pose: `progress = 1` matches the exact post-step rest pose
 * so the UI thread can commit `activeIndex` atomically with zero frame flicker.
 */
export function computeDeckCardPose(
  forward: number,
  count: number,
  progress: number,
  dir: -1 | 0 | 1,
  cardWidth: number,
): DeckCardPose {
  "worklet";
  const maxVisible =
    count < STACKED_DECK_MAX_VISIBLE_LAYERS ? count : STACKED_DECK_MAX_VISIBLE_LAYERS;
  const backLayer = maxVisible - 1;
  const backX = backLayer * STACKED_DECK_PEEK_STEP;
  const backScale = 1 - backLayer * 0.06;
  const backOpacity = 1 - backLayer * 0.14;

  const restPose = (layer: number): DeckCardPose => {
    if (layer >= 0 && layer < maxVisible) {
      return {
        translateX: layer * STACKED_DECK_PEEK_STEP,
        translateY: 0,
        scale: 1 - layer * 0.06,
        rotateZ: 0,
        opacity: 1 - layer * 0.14,
        zIndex: 20 - layer * 4,
      };
    }
    return {
      translateX: backX,
      translateY: 0,
      scale: backScale,
      rotateZ: 0,
      opacity: 0,
      zIndex: 2,
    };
  };

  const t = progress < 0 ? 0 : progress > 1 ? 1 : progress;
  if (dir === 0 || t === 0 || count <= 1) {
    return restPose(forward);
  }

  const lerp = (a: number, b: number, ratio: number) => a + (b - a) * ratio;

  if (dir === -1) {
    const behind = t > 0.5;
    if (forward === 0) {
      const apexLeft = Math.round(cardWidth * 0.68);
      if (!behind) {
        const s = t * 2;
        return {
          translateX: lerp(0, -apexLeft, s),
          translateY: lerp(0, -6, s),
          scale: lerp(1, 0.96, s),
          rotateZ: lerp(0, -6.5, s),
          opacity: 1,
          zIndex: 20,
        };
      }
      const s = (t - 0.5) * 2;
      const opacity =
        count <= STACKED_DECK_MAX_VISIBLE_LAYERS
          ? lerp(1, backOpacity, s)
          : s < 0.72
            ? 1
            : lerp(1, 0, (s - 0.72) / 0.28);
      return {
        translateX: lerp(-apexLeft, backX, s),
        translateY: lerp(-6, 0, s),
        scale: lerp(0.96, backScale, s),
        rotateZ: lerp(-6.5, 0, s),
        opacity,
        zIndex: count <= STACKED_DECK_MAX_VISIBLE_LAYERS ? 20 - backLayer * 4 : 2,
      };
    }
    if (forward === 1) {
      return {
        translateX: lerp(STACKED_DECK_PEEK_STEP, 0, t),
        translateY: 0,
        scale: lerp(0.94, 1, t),
        rotateZ: 0,
        opacity: lerp(0.86, 1, t),
        zIndex: behind ? 20 : 16,
      };
    }
    if (forward === 2 && count >= 3) {
      return {
        translateX: lerp(STACKED_DECK_PEEK_STEP * 2, STACKED_DECK_PEEK_STEP, t),
        translateY: 0,
        scale: lerp(0.88, 0.94, t),
        rotateZ: 0,
        opacity: lerp(0.72, 0.86, t),
        zIndex: behind ? 16 : 12,
      };
    }
    if (forward === 3 && count > STACKED_DECK_MAX_VISIBLE_LAYERS) {
      const opacity = t <= 0.3 ? 0 : lerp(0, 0.72, (t - 0.3) / 0.7);
      return {
        translateX: backX,
        translateY: 0,
        scale: backScale,
        rotateZ: 0,
        opacity,
        zIndex: behind ? 12 : 2,
      };
    }
    return restPose(forward);
  }

  // dir === 1 (swipe right / previous card pulls out from behind and lands on top)
  const onTop = t > 0.5;
  if (forward === count - 1) {
    const apexRight = Math.round(cardWidth * 0.56);
    const startZ = count <= STACKED_DECK_MAX_VISIBLE_LAYERS ? 20 - backLayer * 4 : 2;
    if (!onTop) {
      const s = t * 2;
      const opacity =
        count <= STACKED_DECK_MAX_VISIBLE_LAYERS
          ? lerp(backOpacity, 1, s)
          : s < 0.28
            ? lerp(0, 1, s / 0.28)
            : 1;
      return {
        translateX: lerp(backX, apexRight, s),
        translateY: lerp(0, -6, s),
        scale: lerp(backScale, 0.96, s),
        rotateZ: lerp(0, 6, s),
        opacity,
        zIndex: startZ,
      };
    }
    const s = (t - 0.5) * 2;
    return {
      translateX: lerp(apexRight, 0, s),
      translateY: lerp(-6, 0, s),
      scale: lerp(0.96, 1, s),
      rotateZ: lerp(6, 0, s),
      opacity: 1,
      zIndex: 20,
    };
  }
  if (forward === 0) {
    const translateX = !onTop
      ? lerp(0, -16, t * 2)
      : lerp(-16, STACKED_DECK_PEEK_STEP, (t - 0.5) * 2);
    return {
      translateX,
      translateY: 0,
      scale: lerp(1, 0.94, t),
      rotateZ: 0,
      opacity: lerp(1, 0.86, t),
      zIndex: onTop ? 16 : 20,
    };
  }
  if (forward === 1 && count >= 3) {
    return {
      translateX: lerp(STACKED_DECK_PEEK_STEP, STACKED_DECK_PEEK_STEP * 2, t),
      translateY: 0,
      scale: lerp(0.94, 0.88, t),
      rotateZ: 0,
      opacity: lerp(0.86, 0.72, t),
      zIndex: onTop ? 12 : 16,
    };
  }
  if (forward === 2 && count > STACKED_DECK_MAX_VISIBLE_LAYERS) {
    return {
      translateX: backX,
      translateY: 0,
      scale: backScale,
      rotateZ: 0,
      opacity: t < 0.7 ? lerp(0.72, 0, t / 0.7) : 0,
      zIndex: onTop ? 2 : 12,
    };
  }
  return restPose(forward);
}

export function resolveDeckDimensions(
  maxWidth: number,
  count: number,
  aspectRatio?: number | null,
) {
  const backingCards = Math.min(Math.max(count - 1, 0), STACKED_DECK_MAX_VISIBLE_LAYERS - 1);
  const peekTotalWidth = backingCards * STACKED_DECK_PEEK_STEP;
  const expandPillAllowance = 86;
  const maxAllowedWidth = Math.min(
    STACKED_DECK_MAX_CARD_WIDTH,
    Math.max(
      STACKED_DECK_MIN_CARD_WIDTH,
      Math.floor(maxWidth - peekTotalWidth - expandPillAllowance),
    ),
  );
  const safeRatio =
    aspectRatio !== undefined &&
    aspectRatio !== null &&
    Number.isFinite(aspectRatio) &&
    aspectRatio > 0
      ? aspectRatio
      : STACKED_DECK_DEFAULT_ASPECT_RATIO;

  // Preserve the photo's natural aspect ratio as closely as possible within reasonable chat bounds.
  let cardWidth = maxAllowedWidth;
  let cardHeight = Math.round(cardWidth / safeRatio);
  if (cardHeight > STACKED_DECK_MAX_CARD_HEIGHT) {
    cardHeight = STACKED_DECK_MAX_CARD_HEIGHT;
    cardWidth = Math.max(
      STACKED_DECK_MIN_CARD_WIDTH,
      Math.min(maxAllowedWidth, Math.round(cardHeight * safeRatio)),
    );
  } else if (cardHeight < STACKED_DECK_MIN_CARD_HEIGHT) {
    cardHeight = STACKED_DECK_MIN_CARD_HEIGHT;
  }

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
