import { useGT } from "gt-react-native";
import { useId, useState } from "react";
import { Platform, View } from "react-native";
import { FormSheet, ScreenStack } from "react-native-screens";
import { useResolveClassNames } from "uniwind";

import { nativeHeaderScrollEdgeEffects } from "../../native/StackHeader";
import { NATIVE_LIQUID_GLASS_SUPPORTED } from "../../native/native-glass";
import { formSheetDetents, NATIVE_GLASS_SHEET_BG_CLASS } from "../../native/sheet-surface";
import { NativeHeader, NativeScreen } from "../../native/ThemedScreenStack";

const HEADER_SCROLL_EDGE_EFFECTS = nativeHeaderScrollEdgeEffects(Platform.OS, Platform.Version);

export type { SheetProps } from "./Sheet.types";
import type { SheetProps } from "./Sheet.types";

/** Native presentation. Scrollable children use automatic insets beneath the iOS header. */
export function Sheet(props: SheetProps) {
  const gt = useGT();
  const containerStyle = useResolveClassNames(NATIVE_GLASS_SHEET_BG_CLASS);
  const screenId = useId();
  const [isOpen, setIsOpen] = useState(true);
  const close = () => {
    if (!props.dismissDisabled) setIsOpen(false);
  };

  return (
    <FormSheet
      isOpen={isOpen}
      detents={formSheetDetents(0.5, 0.9)}
      prefersGrabberVisible
      preventNativeDismiss={props.dismissDisabled}
      // The header holds the close button, so the Duo needs no rail inside this sheet.
      prefersHorizontalBars
      nativeContainerStyle={
        NATIVE_LIQUID_GLASS_SUPPORTED ? { backgroundColor: "transparent" } : containerStyle
      }
      onDismiss={props.onClose}
      onNativeDismiss={props.onClose}
    >
      {/* Flex children are not bounded by the FormSheet host, so pin to its edges. */}
      <View collapsable={false} className={`absolute inset-0 ${NATIVE_GLASS_SHEET_BG_CLASS}`}>
        <ScreenStack style={{ flex: 1 }}>
          <NativeScreen
            activityState={2}
            enabled
            isNativeStack
            screenId={`app-sheet-${screenId}`}
            scrollEdgeEffects={HEADER_SCROLL_EDGE_EFFECTS}
            className={`flex-1 ${NATIVE_GLASS_SHEET_BG_CLASS}`}
          >
            {props.children}
            <NativeHeader
              backgroundColor="rgba(0,0,0,0)"
              tintColorClassName="accent-foreground"
              hideBackButton
              hideShadow={false}
              title={props.title}
              titleColorClassName="accent-foreground"
              titleFontSize={18}
              titleFontWeight="800"
              translucent
              headerRightBarButtonItems={[
                {
                  type: "button",
                  icon: { name: "xmark", type: "sfSymbol" },
                  accessibilityLabel: gt("Close {title}", { title: props.title }),
                  identifier: `app-sheet-close-${screenId}`,
                  disabled: props.dismissDisabled,
                  onPress: close,
                },
              ]}
            />
          </NativeScreen>
        </ScreenStack>
      </View>
    </FormSheet>
  );
}
