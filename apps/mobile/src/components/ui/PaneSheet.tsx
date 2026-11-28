import { View } from "react-native";
import { FormSheet } from "react-native-screens";
import { useResolveClassNames } from "uniwind";

import { NATIVE_LIQUID_GLASS_SUPPORTED } from "../../native/native-glass";
import { NATIVE_GLASS_SHEET_BG_CLASS } from "../../native/sheet-surface";
import { BottomSheetContext } from "./BottomSheetContext";
import type { PaneSheetProps } from "./PaneSheet.types";
export type { PaneSheetProps } from "./PaneSheet.types";

/** A native sheet holding a pane that draws its own bar. */
export function PaneSheet({ children, ...props }: PaneSheetProps) {
  const containerStyle = useResolveClassNames(NATIVE_GLASS_SHEET_BG_CLASS);
  return (
    <FormSheet
      {...props}
      prefersGrabberVisible
      nativeContainerStyle={
        NATIVE_LIQUID_GLASS_SUPPORTED ? { backgroundColor: "transparent" } : containerStyle
      }
    >
      <BottomSheetContext value>
        <View collapsable={false} className={`flex-1 ${NATIVE_GLASS_SHEET_BG_CLASS}`}>
          {children}
        </View>
      </BottomSheetContext>
    </FormSheet>
  );
}
