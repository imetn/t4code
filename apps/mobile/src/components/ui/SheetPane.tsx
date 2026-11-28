import { use } from "react";
import { View } from "react-native";

import { NATIVE_GLASS_SHEET_BG_CLASS } from "../../native/sheet-surface";
import { BottomSheetContext } from "./BottomSheetContext";
import type { SheetPaneProps } from "./SheetPane.types";
export type { SheetPaneProps } from "./SheetPane.types";

/** The root of a pane or sheet that draws an AppBar above its ScreenContent. */
export function SheetPane(props: SheetPaneProps) {
  const inBottomSheet = use(BottomSheetContext);
  const bgClass =
    props.surface === "screen"
      ? "bg-screen"
      : props.surface === "glass" || inBottomSheet
        ? NATIVE_GLASS_SHEET_BG_CLASS
        : "bg-sheet";
  return (
    <View collapsable={false} className={`flex-1 ${bgClass}`}>
      {props.children}
    </View>
  );
}
