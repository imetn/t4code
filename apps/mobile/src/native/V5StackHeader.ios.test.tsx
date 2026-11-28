import type { NativeStackHeaderItem } from "@react-navigation/native-stack";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { StackHeaderConfigProps } from "react-native-screens";
import { expect, it, vi } from "vite-plus/test";

const bridge = vi.hoisted(() => ({ ios: undefined as StackHeaderConfigProps["ios"] }));

vi.mock("react-native", () => ({ StyleSheet: { flatten: (style: unknown) => style } }));
vi.mock("react-native-keyboard-controller", () => ({
  KeyboardController: { dismiss: vi.fn() },
  useKeyboardState: () => false,
}));
vi.mock("../lib/useMobileNavigationTheme", () => ({
  useMobileNavigationTheme: () => ({ colors: { card: "white" } }),
}));
vi.mock("./native-layout-metrics", () => ({
  useDeviceType: () => "phone",
  useNativeLayoutMetrics: () => null,
}));
vi.mock("react-native-screens", () => ({
  Stack: {
    HeaderConfig: ({ ios }: StackHeaderConfigProps) => {
      bridge.ios = ios;
      return null;
    },
  },
}));

import { V5StackHeader } from "./V5StackHeader.ios";

it.each(["leadingItems", "trailingItems", "toolbarItems"] as const)(
  "updates native enabled state after permissions change in %s",
  (placement) => {
    bridge.ios = undefined;
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const root = createRoot(document.createElement("div"));
    const onPress = () => {};
    try {
      for (const disabled of [true, false, undefined, true]) {
        const items: NativeStackHeaderItem[] = [
          { type: "button", label: "Files", disabled, onPress },
          {
            type: "menu",
            label: "Terminal",
            disabled,
            menu: { items: [{ type: "action", label: "Open terminal", onPress }] },
          },
        ];
        act(() =>
          root.render(
            <V5StackHeader
              canGoBack={false}
              options={{
                unstable_headerLeftItems: () => (placement === "leadingItems" ? items : []),
                unstable_headerRightItems: () => (placement === "trailingItems" ? items : []),
                unstable_headerToolbarItems: () => (placement === "toolbarItems" ? items : []),
              }}
            />,
          ),
        );
        const nativeItems = (bridge.ios as StackHeaderConfigProps["ios"])?.[placement];
        expect(nativeItems).toHaveLength(2);
        for (const item of nativeItems ?? []) {
          if (item.type !== "item" || "render" in item)
            throw new Error("Expected a native bar item");
          // RNSHeaderContentFactory sets UIBarButtonItem.enabled to !item.disabled.
          expect(!item.disabled).toBe(!disabled);
        }
      }
    } finally {
      act(() => root.unmount());
      vi.unstubAllGlobals();
    }
  },
);

it("forwards submenu icons to native iOS header menus", () => {
  bridge.ios = undefined;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const root = createRoot(document.createElement("div"));
  const onPress = () => {};
  try {
    const items: NativeStackHeaderItem[] = [
      {
        type: "menu",
        label: "More actions",
        icon: { type: "sfSymbol", name: "ellipsis" },
        menu: {
          title: "More actions",
          items: [
            {
              type: "action",
              label: "Open files",
              icon: { type: "sfSymbol", name: "folder" },
              onPress,
            },
            {
              type: "submenu",
              label: "Terminal",
              icon: { type: "sfSymbol", name: "terminal" },
              items: [{ type: "action", label: "Open new terminal", onPress }],
            },
          ],
        },
      },
    ];
    act(() =>
      root.render(
        <V5StackHeader canGoBack={false} options={{ unstable_headerRightItems: () => items }} />,
      ),
    );
    const trailing = (bridge.ios as StackHeaderConfigProps["ios"])?.trailingItems;
    const more = trailing?.[0];
    if (!more || more.type !== "item" || "render" in more) {
      throw new Error("Expected a native menu item");
    }
    const submenu = more.menu?.children[1];
    expect(submenu?.type).toBe("menu");
    if (submenu?.type === "menu") {
      expect(submenu.icon).toEqual({ type: "sfSymbol", name: "terminal" });
    }
  } finally {
    act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});
