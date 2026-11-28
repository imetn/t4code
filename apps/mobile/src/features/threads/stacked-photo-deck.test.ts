import { describe, expect, it } from "vite-plus/test";

import {
  computeDeckCardPose,
  cycleDeckIndex,
  mountedDeckItemIndices,
  resolveDeckDimensions,
  resolveExpandedPhotoGrid,
  visibleDeckLayers,
} from "./stacked-photo-deck";

describe("stacked-photo-deck", () => {
  it("cycles deck index forward and backward with wraparound", () => {
    expect(cycleDeckIndex(0, 4, 1)).toBe(1);
    expect(cycleDeckIndex(3, 4, 1)).toBe(0);
    expect(cycleDeckIndex(0, 4, -1)).toBe(3);
    expect(cycleDeckIndex(2, 4, -1)).toBe(1);
    expect(cycleDeckIndex(0, 1, 1)).toBe(0);
  });

  it("orders up to 3 visible layers from back to front", () => {
    expect(visibleDeckLayers(0, 4)).toEqual([
      { itemIndex: 2, layer: 2 },
      { itemIndex: 1, layer: 1 },
      { itemIndex: 0, layer: 0 },
    ]);
    expect(visibleDeckLayers(3, 4)).toEqual([
      { itemIndex: 1, layer: 2 },
      { itemIndex: 0, layer: 1 },
      { itemIndex: 3, layer: 0 },
    ]);
    expect(visibleDeckLayers(1, 2)).toEqual([
      { itemIndex: 0, layer: 1 },
      { itemIndex: 1, layer: 0 },
    ]);
  });

  it("fits stacked deck width plus expand pill within the user bubble maxWidth and preserves natural aspect ratio", () => {
    const iphoneScreenshotRatio = 1206 / 2622; // ~0.46 portrait
    const portrait = resolveDeckDimensions(310, 7, iphoneScreenshotRatio);
    expect(portrait.peekTotalWidth).toBe(24);
    expect(portrait.cardWidth + portrait.peekTotalWidth + 86).toBeLessThanOrEqual(310);
    expect(portrait.cardHeight).toBe(360);
    expect(Math.abs(portrait.cardWidth / portrait.cardHeight - iphoneScreenshotRatio)).toBeLessThan(
      0.02,
    );

    const landscape = resolveDeckDimensions(320, 4, 16 / 9);
    expect(landscape.cardWidth).toBeGreaterThan(landscape.cardHeight);
    expect(landscape.cardHeight).toBeGreaterThanOrEqual(128);

    const square = resolveDeckDimensions(320, 4, 1);
    expect(square.cardWidth).toBe(square.cardHeight);

    const tablet = resolveDeckDimensions(520, 6, 0.75);
    expect(tablet.cardWidth).toBe(224);
    expect(tablet.cardHeight).toBe(Math.round(224 / 0.75));
  });

  it("selects expanded grid modes by photo count", () => {
    expect(resolveExpandedPhotoGrid(2)).toEqual({ mode: "two-col", rowHeight: 172 });
    expect(resolveExpandedPhotoGrid(3)).toEqual({ mode: "three-hero", rowHeight: 192 });
    expect(resolveExpandedPhotoGrid(4)).toEqual({ mode: "two-col", rowHeight: 144 });
    expect(resolveExpandedPhotoGrid(5)).toEqual({ mode: "three-col", rowHeight: 102 });
    expect(resolveExpandedPhotoGrid(9)).toEqual({ mode: "three-col", rowHeight: 102 });
  });

  it("mounts deduplicated circular shuffle slots including prev and incoming back cards", () => {
    expect(mountedDeckItemIndices(0, 2)).toEqual([1, 0]);
    expect(mountedDeckItemIndices(0, 3)).toEqual([2, 1, 0]);
    expect(mountedDeckItemIndices(0, 7)).toEqual([6, 3, 2, 1, 0]);
  });

  it("tucks the swiped card behind the deck with full opacity and exact frame continuity on commit", () => {
    for (const count of [2, 3, 7]) {
      for (const dir of [-1, 1] as const) {
        const delta = dir === -1 ? 1 : -1;
        for (let itemIndex = 0; itemIndex < count; itemIndex += 1) {
          const endPose = computeDeckCardPose(itemIndex, count, 1, dir, 180);
          const nextForward = (itemIndex - delta + count) % count;
          const nextRestPose = computeDeckCardPose(nextForward, count, 0, 0, 180);
          expect(endPose).toEqual(nextRestPose);
        }
      }
    }

    // Left swipe: stays opaque on top during pull-out, then drops behind the next card past 0.5.
    const pulled = computeDeckCardPose(0, 7, 0.5, -1, 180);
    expect(pulled.opacity).toBe(1);
    expect(pulled.zIndex).toBe(20);
    expect(pulled.translateX).toBeLessThan(-100);

    const tucking = computeDeckCardPose(0, 7, 0.6, -1, 180);
    const nextFront = computeDeckCardPose(1, 7, 0.6, -1, 180);
    expect(tucking.opacity).toBe(1);
    expect(tucking.zIndex).toBeLessThan(nextFront.zIndex);
    expect(tucking.translateX).toBeGreaterThan(pulled.translateX);
  });
});
