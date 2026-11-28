import { GlassView } from "expo-glass-effect";
import * as Haptics from "expo-haptics";
import { useEffectEvent, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { useGT } from "gt-react-native";
import { withUniwind } from "uniwind";

import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { NATIVE_LIQUID_GLASS_SUPPORTED } from "../../native/native-glass";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";
import {
  STACKED_DECK_PEEK_STEP,
  cycleDeckIndex,
  resolveDeckDimensions,
  resolveExpandedPhotoGrid,
  visibleDeckLayers,
} from "./stacked-photo-deck";

const DeckGlassPill = withUniwind(GlassView, {
  style: { fromClassName: "className" },
});

const CARD_RADIUS = 20;
const SWIPE_DISTANCE_THRESHOLD = 46;
const SWIPE_VELOCITY_THRESHOLD = 360;

function StackedDeckCard(props: {
  readonly layer: number;
  readonly cardWidth: number;
  readonly cardHeight: number;
  readonly dragX: SharedValue<number>;
  readonly isDarkMode: boolean;
  readonly counterLabel?: string;
  readonly children: ReactNode;
}) {
  const { layer, cardWidth, cardHeight, dragX, isDarkMode } = props;
  const animatedStyle = useAnimatedStyle(() => {
    if (layer === 0) {
      const rotate = interpolate(dragX.value, [-160, 0, 160], [-6.5, 0, 6.5], Extrapolation.CLAMP);
      const opacity = interpolate(
        Math.abs(dragX.value),
        [0, cardWidth * 0.95],
        [1, 0.72],
        Extrapolation.CLAMP,
      );
      return {
        opacity,
        transform: [{ translateX: dragX.value }, { rotateZ: `${rotate}deg` }],
      };
    }
    const progress = interpolate(Math.abs(dragX.value), [0, 120], [0, 1], Extrapolation.CLAMP);
    const effectiveLayer = Math.max(0, layer - progress);
    const translateX = effectiveLayer * STACKED_DECK_PEEK_STEP;
    const scale = 1 - effectiveLayer * 0.06;
    const opacity = 1 - effectiveLayer * 0.14;
    return {
      opacity,
      transform: [{ translateX }, { scale }],
    };
  });

  const borderColor = isDarkMode ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.08)";
  const shadowOpacity = isDarkMode ? (layer === 0 ? 0.34 : 0.22) : layer === 0 ? 0.14 : 0.08;

  return (
    <Animated.View
      pointerEvents={layer === 0 ? "auto" : "none"}
      style={[
        {
          position: "absolute",
          left: 0,
          top: 0,
          width: cardWidth,
          height: cardHeight,
          borderRadius: CARD_RADIUS,
          shadowColor: "#000000",
          shadowOffset: { width: 0, height: layer === 0 ? 4 : 2 },
          shadowOpacity,
          shadowRadius: layer === 0 ? 10 : 5,
          elevation: Math.max(1, 4 - layer),
        },
        animatedStyle,
      ]}
    >
      <View
        className="h-full w-full overflow-hidden bg-card"
        style={{
          borderRadius: CARD_RADIUS,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor,
        }}
      >
        {props.children}
        {props.counterLabel ? (
          <View
            pointerEvents="none"
            className="absolute bottom-2.5 right-2.5 rounded-full px-2 py-0.5"
            style={{ backgroundColor: "rgba(0,0,0,0.52)" }}
          >
            <Text
              className="font-t3-semibold tabular-nums"
              style={{ color: "#ffffff", fontSize: 11, lineHeight: 14 }}
            >
              {props.counterLabel}
            </Text>
          </View>
        ) : null}
      </View>
    </Animated.View>
  );
}

function DeckActionPill(props: {
  readonly label: string;
  readonly icon?: "chevron.up";
  readonly onPress: () => void;
}) {
  const { themeAppearance } = useAppearancePreferences();
  const inner = (
    <>
      {props.icon ? (
        <SymbolView
          name={props.icon}
          size={12}
          tintColorClassName="accent-foreground-muted"
          type="monochrome"
        />
      ) : null}
      <Text className="font-t3-medium text-xs tabular-nums text-foreground-muted">
        {props.label}
      </Text>
    </>
  );

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      hitSlop={8}
      onPress={() => {
        void Haptics.selectionAsync();
        props.onPress();
      }}
      className="active:opacity-70"
    >
      {NATIVE_LIQUID_GLASS_SUPPORTED ? (
        <DeckGlassPill
          isInteractive
          glassEffectStyle="regular"
          colorScheme={themeAppearance}
          className="h-8 flex-row items-center gap-1.5 rounded-full px-3"
        >
          {inner}
        </DeckGlassPill>
      ) : (
        <View className="h-8 flex-row items-center gap-1.5 rounded-full border border-border bg-subtle px-3">
          {inner}
        </View>
      )}
    </Pressable>
  );
}

export function StackedPhotoDeck(props: {
  readonly messageId: string;
  readonly count: number;
  readonly maxWidth: number;
  readonly renderCard: (index: number, height: number) => ReactNode;
}) {
  const gt = useGT();
  const { themeAppearance } = useAppearancePreferences();
  const isDarkMode = themeAppearance === "dark";

  // Key state by messageId so LegendList view recycling never carries expanded/index state across messages.
  const [deckState, setDeckState] = useState({
    messageId: props.messageId,
    expanded: false,
    activeIndex: 0,
  });
  const expanded = deckState.messageId === props.messageId ? deckState.expanded : false;
  const activeIndex =
    deckState.messageId === props.messageId && deckState.activeIndex < props.count
      ? deckState.activeIndex
      : 0;

  const dragX = useSharedValue(0);
  const animating = useSharedValue(false);

  const commitStep = useEffectEvent((delta: -1 | 1) => {
    void Haptics.selectionAsync();
    setDeckState((current) => {
      const baseIndex =
        current.messageId === props.messageId && current.activeIndex < props.count
          ? current.activeIndex
          : 0;
      return {
        messageId: props.messageId,
        expanded: false,
        activeIndex: cycleDeckIndex(baseIndex, props.count, delta),
      };
    });
    dragX.value = 0;
    animating.value = false;
  });

  const { cardWidth, cardHeight, peekTotalWidth } = resolveDeckDimensions(
    props.maxWidth,
    props.count,
  );
  const exitDistance = 240;

  const [panGesture] = useState(() =>
    Gesture.Pan()
      .activeOffsetX([-14, 14])
      .failOffsetY([-12, 12])
      .onUpdate((event) => {
        if (animating.value) return;
        dragX.value = event.translationX;
      })
      .onEnd((event) => {
        if (animating.value) return;
        const shouldAdvance =
          Math.abs(event.translationX) > SWIPE_DISTANCE_THRESHOLD ||
          Math.abs(event.velocityX) > SWIPE_VELOCITY_THRESHOLD;
        if (shouldAdvance) {
          animating.value = true;
          const swipeLeft =
            Math.abs(event.translationX) > 10 ? event.translationX < 0 : event.velocityX < 0;
          const delta: -1 | 1 = swipeLeft ? 1 : -1;
          const targetX = swipeLeft ? -exitDistance : exitDistance;
          dragX.value = withTiming(targetX, { duration: 165 }, (finished) => {
            if (finished) {
              runOnJS(commitStep)(delta);
            } else {
              dragX.value = 0;
              animating.value = false;
            }
          });
        } else {
          dragX.value = withSpring(0, { damping: 22, stiffness: 300 });
        }
      })
      .onFinalize((_event, success) => {
        if (!success && !animating.value) {
          dragX.value = withSpring(0, { damping: 22, stiffness: 300 });
        }
      }),
  );

  if (expanded) {
    const grid = resolveExpandedPhotoGrid(props.count);
    const indices = Array.from({ length: props.count }, (_, index) => index);
    const columns = grid.mode === "three-col" ? 3 : 2;
    const rows: number[][] = [];
    if (grid.mode !== "three-hero") {
      for (let i = 0; i < indices.length; i += columns) {
        rows.push(indices.slice(i, i + columns));
      }
    }

    return (
      <View className="items-end gap-2">
        <DeckActionPill
          label={gt("Collapse", { $context: "verb, collapse expanded photo grid back to stack" })}
          icon="chevron.up"
          onPress={() =>
            setDeckState({
              messageId: props.messageId,
              expanded: false,
              activeIndex,
            })
          }
        />
        <View
          className="overflow-hidden rounded-[20px] bg-border"
          style={{
            width: 320,
            maxWidth: "100%",
            alignSelf: "flex-end",
            gap: StyleSheet.hairlineWidth,
          }}
        >
          {grid.mode === "three-hero" ? (
            <View className="flex-row" style={{ gap: StyleSheet.hairlineWidth }}>
              <View className="min-w-0" style={{ flex: 3 }}>
                {props.renderCard(0, grid.rowHeight)}
              </View>
              <View className="min-w-0" style={{ flex: 2, gap: StyleSheet.hairlineWidth }}>
                {props.renderCard(1, (grid.rowHeight - StyleSheet.hairlineWidth) / 2)}
                {props.renderCard(2, (grid.rowHeight - StyleSheet.hairlineWidth) / 2)}
              </View>
            </View>
          ) : (
            rows.map((row) => (
              <View
                key={row.join("-")}
                className="flex-row"
                style={{ gap: StyleSheet.hairlineWidth }}
              >
                {row.map((itemIndex) => (
                  <View key={itemIndex} className="min-w-0 flex-1">
                    {props.renderCard(itemIndex, grid.rowHeight)}
                  </View>
                ))}
                {row.length < columns
                  ? Array.from({ length: columns - row.length }, (_, padIndex) => (
                      <View
                        key={`pad-${padIndex}`}
                        className="min-w-0 flex-1 bg-card/40"
                        style={{ height: grid.rowHeight }}
                      />
                    ))
                  : null}
              </View>
            ))
          )}
          <View
            pointerEvents="none"
            className="absolute inset-0 rounded-[20px] border border-border"
          />
        </View>
      </View>
    );
  }

  const layers = visibleDeckLayers(activeIndex, props.count);

  return (
    <View className="flex-row items-center justify-end gap-3">
      <DeckActionPill
        label={gt("Expand {count}", {
          count: props.count,
          $context: "verb with photo count, expands a stacked deck of photos into a grid",
        })}
        onPress={() =>
          setDeckState({
            messageId: props.messageId,
            expanded: true,
            activeIndex,
          })
        }
      />
      <GestureDetector gesture={panGesture}>
        <View style={{ width: cardWidth + peekTotalWidth, height: cardHeight }}>
          {layers.map(({ itemIndex, layer }) => (
            <StackedDeckCard
              key={itemIndex}
              layer={layer}
              cardWidth={cardWidth}
              cardHeight={cardHeight}
              dragX={dragX}
              isDarkMode={isDarkMode}
              counterLabel={layer === 0 ? `${activeIndex + 1} / ${props.count}` : undefined}
            >
              {props.renderCard(itemIndex, cardHeight)}
            </StackedDeckCard>
          ))}
        </View>
      </GestureDetector>
    </View>
  );
}
