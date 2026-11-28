import { describe, expect, it } from "vite-plus/test";

import {
  cycleDeckIndex,
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

  it("fits stacked deck width plus expand pill within the user bubble maxWidth", () => {
    const phone = resolveDeckDimensions(310, 4);
    expect(phone.peekTotalWidth).toBe(24);
    expect(phone.cardWidth + phone.peekTotalWidth + 86).toBeLessThanOrEqual(310);
    expect(phone.cardHeight).toBeGreaterThan(phone.cardWidth);

    const tablet = resolveDeckDimensions(520, 6);
    expect(tablet.cardWidth).toBe(204);
  });

  it("selects expanded grid modes by photo count", () => {
    expect(resolveExpandedPhotoGrid(2)).toEqual({ mode: "two-col", rowHeight: 172 });
    expect(resolveExpandedPhotoGrid(3)).toEqual({ mode: "three-hero", rowHeight: 192 });
    expect(resolveExpandedPhotoGrid(4)).toEqual({ mode: "two-col", rowHeight: 144 });
    expect(resolveExpandedPhotoGrid(5)).toEqual({ mode: "three-col", rowHeight: 102 });
    expect(resolveExpandedPhotoGrid(9)).toEqual({ mode: "three-col", rowHeight: 102 });
  });
});
