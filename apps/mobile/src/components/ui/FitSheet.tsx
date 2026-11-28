import type { ReactNode } from "react";
import { ScrollView, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { fitSheetBottomInset, type FitSheetProps } from "./FitSheet.types";
import { ScreenContent } from "./ScreenContent";
import { NATIVE_GLASS_SHEET_BG_CLASS } from "../../native/sheet-surface";
export type { FitSheetProps } from "./FitSheet.types";

export function FitSheet({
  header,
  footer,
  avoidsKeyboard,
  glass,
  children,
  contentContainerClassName = "gap-4 px-5 pt-2",
  contentContainerStyle,
  ...scrollProps
}: FitSheetProps) {
  const insets = useSafeAreaInsets();
  const bgClass = glass ? NATIVE_GLASS_SHEET_BG_CLASS : "bg-sheet";
  return (
    <SheetContainer avoidsKeyboard={avoidsKeyboard} bgClass={bgClass}>
      {header}
      <ScreenContent>
        <ScrollView
          {...scrollProps}
          nestedScrollEnabled
          contentContainerClassName={contentContainerClassName}
          contentInsetAdjustmentBehavior="automatic"
          className="flex-1"
          contentContainerStyle={[
            footer ? undefined : { paddingBottom: fitSheetBottomInset(insets.bottom) },
            contentContainerStyle,
          ]}
        >
          {children}
        </ScrollView>
        {footer ? (
          <View
            className={`${bgClass} px-4 pt-3`}
            style={{ paddingBottom: Math.max(insets.bottom, 16) }}
          >
            {footer}
          </View>
        ) : null}
      </ScreenContent>
    </SheetContainer>
  );
}

function SheetContainer(props: {
  readonly avoidsKeyboard?: boolean;
  readonly bgClass: string;
  readonly children: ReactNode;
}) {
  return props.avoidsKeyboard ? (
    <KeyboardAvoidingView
      automaticOffset
      behavior="padding"
      collapsable={false}
      className={`flex-1 ${props.bgClass}`}
    >
      {props.children}
    </KeyboardAvoidingView>
  ) : (
    <View collapsable={false} className={`flex-1 ${props.bgClass}`}>
      {props.children}
    </View>
  );
}
