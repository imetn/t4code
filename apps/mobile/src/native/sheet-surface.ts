import { Platform } from "react-native";

import { NATIVE_LIQUID_GLASS_SUPPORTED } from "./native-glass";

export const NATIVE_GLASS_SHEET_BG_CLASS = NATIVE_LIQUID_GLASS_SUPPORTED
  ? "bg-transparent"
  : "bg-sheet";

export const NATIVE_GLASS_SHEET_SOLID_BG_CLASS = NATIVE_LIQUID_GLASS_SUPPORTED
  ? "bg-transparent"
  : "bg-sheet-solid";

export function formSheetDetents(initialDetent: number, androidExpandedDetent = 0.92) {
  // Duo moves the status bar above the sheet only at the maximum native detent.
  return [initialDetent, Platform.OS === "ios" ? 1 : androidExpandedDetent];
}
