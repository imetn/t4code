import { GlassView } from "expo-glass-effect";
import * as Haptics from "expo-haptics";
import { useEffectEvent, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Easing,
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
  computeDeckCardPose,
  mountedDeckItemIndices,
  resolveDeckDimensions,
  resolveExpandedPhotoGrid,
} from "./stacked-photo-deck";

const DeckGlassPill = withUniwind(GlassView, {
  style: { fromClassName: "className" },
});

const CARD_RADIUS = 20;
const SWIPE_DISTANCE_THRESHOLD = 38;
const SWIPE_VELOCITY_THRESHOLD = 320;
const TUCK_SPRING = {
  damping: 23,
  stiffness: 310,
  mass: 0.8,
} as const;
const CANCEL_SPRING = {
  damping: 22,
  stiffness: 300,
} as const;

function StackedDeckCard(props: {
  readonly itemIndex: number;
  readonly count: number;
  readonly isFront: boolean;
  readonly cardWidth: number;
  readonly cardHeight: number;
  readonly activeIndexSV: SharedValue<number>;
  readonly shuffleProgress: SharedValue<number>;
  readonly shuffleDir: SharedValue<-1 | 0 | 1>;
  readonly isDarkMode: boolean;
  readonly counterLabel?: string;
  readonly children: ReactNode;
}) {
  const {
    itemIndex,
    count,
    isFront,
    cardWidth,
    cardHeight,
    activeIndexSV,
    shuffleProgress,
    shuffleDir,
    isDarkMode,
  } = props;

  const animatedStyle = useAnimatedStyle(() => {
    const active = activeIndexSV.value;
    const forward = (((itemIndex - active) % count) + count) % count;
    const pose = computeDeckCardPose(
      forward,
      count,
      shuffleProgress.value,
      shuffleDir.value,
      cardWidth,
    );
    return {
      opacity: pose.opacity,
      zIndex: pose.zIndex,
      elevation: pose.zIndex,
      transform: [
        { translateX: pose.translateX },
        { translateY: pose.translateY },
        { scale: pose.scale },
        { rotateZ: `${pose.rotateZ}deg` },
      ],
    };
  });

  const counterAnimatedStyle = useAnimatedStyle(() => {
    const active = activeIndexSV.value;
    const forward = (((itemIndex - active) % count) + count) % count;
    const dir = shuffleDir.value;
    const p = shuffleProgress.value;
    const isVisualFront =
      dir === 0 || p <= 0.5 ? forward === 0 : dir === -1 ? forward === 1 : forward === count - 1;
    return { opacity: isVisualFront ? 1 : 0 };
  });

  const borderColor = isDarkMode ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.08)";
  const shadowOpacity = isDarkMode ? (isFront ? 0.34 : 0.22) : isFront ? 0.14 : 0.08;

  return (
    <Animated.View
      pointerEvents={isFront ? "auto" : "none"}
      style={[
        {
          position: "absolute",
          left: 0,
          top: 0,
          width: cardWidth,
          height: cardHeight,
          borderRadius: CARD_RADIUS,
          shadowColor: "#000000",
          shadowOffset: { width: 0, height: isFront ? 4 : 2 },
          shadowOpacity,
          shadowRadius: isFront ? 10 : 5,
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
          <Animated.View
            pointerEvents="none"
            className="absolute bottom-2.5 right-2.5 rounded-full px-2 py-0.5"
            style={[{ backgroundColor: "rgba(0,0,0,0.52)" }, counterAnimatedStyle]}
          >
            <Text
              className="font-t3-semibold tabular-nums"
              style={{ color: "#ffffff", fontSize: 11, lineHeight: 14 }}
            >
              {props.counterLabel}
            </Text>
          </Animated.View>
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
  const isDarkMode = themeAppearance === "dark";
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

  const pillSurfaceStyle = {
    backgroundColor: isDarkMode ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.06)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: isDarkMode ? "rgba(255,255,255,0.16)" : "rgba(0,0,0,0.08)",
  };

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
          style={pillSurfaceStyle}
        >
          {inner}
        </DeckGlassPill>
      ) : (
        <View
          className="h-8 flex-row items-center gap-1.5 rounded-full px-3"
          style={pillSurfaceStyle}
        >
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
  readonly aspectRatios?: Readonly<Record<number, number>>;
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

  const activeAspectRatio =
    props.aspectRatios?.[activeIndex] ??
    props.aspectRatios?.[0] ??
    (props.aspectRatios ? Object.values(props.aspectRatios)[0] : undefined);
  const { cardWidth, cardHeight, peekTotalWidth } = resolveDeckDimensions(
    props.maxWidth,
    props.count,
    activeAspectRatio,
  );
  const pullDistance = Math.round(cardWidth * 0.68);

  const activeIndexSV = useSharedValue(activeIndex);
  const countSV = useSharedValue(props.count);
  const pullDistanceSV = useSharedValue(pullDistance);
  const shuffleProgress = useSharedValue(0);
  const shuffleDir = useSharedValue<-1 | 0 | 1>(0);
  const isCompleting = useSharedValue(false);
  const gestureHandled = useSharedValue(false);

  const lastMessageIdRef = useRef(props.messageId);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- syncs latest deck dimensions and resets UI-thread shuffle state when LegendList recycles this row for another message
  useLayoutEffect(() => {
    countSV.value = props.count;
    pullDistanceSV.value = pullDistance;
    if (lastMessageIdRef.current !== props.messageId) {
      lastMessageIdRef.current = props.messageId;
      activeIndexSV.value = 0;
      shuffleProgress.value = 0;
      shuffleDir.value = 0;
      isCompleting.value = false;
      gestureHandled.value = false;
    }
  }, [
    activeIndexSV,
    countSV,
    gestureHandled,
    isCompleting,
    props.count,
    props.messageId,
    pullDistance,
    pullDistanceSV,
    shuffleDir,
    shuffleProgress,
  ]);

  const triggerSwapHaptic = useEffectEvent(() => {
    void Haptics.selectionAsync();
  });

  const syncReactActiveIndex = useEffectEvent((nextIndex: number) => {
    setDeckState((current) => ({
      messageId: props.messageId,
      expanded: current.messageId === props.messageId ? current.expanded : false,
      activeIndex: nextIndex,
    }));
  });

  const [panGesture] = useState(() => {
    const completeTuck = (dir: -1 | 1) => {
      "worklet";
      shuffleProgress.value = withSpring(1, TUCK_SPRING, (finished) => {
        if (finished) {
          const total = countSV.value;
          const delta = dir === -1 ? 1 : -1;
          const nextIndex = total <= 1 ? 0 : (activeIndexSV.value + delta + total) % total;
          // Update activeIndexSV and reset shuffle state atomically on the UI thread for zero flicker.
          activeIndexSV.value = nextIndex;
          shuffleProgress.value = 0;
          shuffleDir.value = 0;
          isCompleting.value = false;
          runOnJS(syncReactActiveIndex)(nextIndex);
        } else {
          shuffleProgress.value = 0;
          shuffleDir.value = 0;
          isCompleting.value = false;
        }
      });
    };

    return Gesture.Pan()
      .activeOffsetX([-12, 12])
      .failOffsetY([-12, 12])
      .onBegin(() => {
        gestureHandled.value = false;
      })
      .onUpdate((event) => {
        if (isCompleting.value || gestureHandled.value || countSV.value <= 1) return;
        const dx = event.translationX;
        const clearDist = Math.max(72, pullDistanceSV.value);
        if (Math.abs(dx) < 2) {
          shuffleProgress.value = 0;
          return;
        }
        const dir: -1 | 1 = dx < 0 ? -1 : 1;
        shuffleDir.value = dir;
        const absDx = Math.abs(dx);
        if (absDx >= clearDist) {
          // As the finger keeps sliding past the clear edge, automatically flip behind and tuck into the back.
          gestureHandled.value = true;
          isCompleting.value = true;
          shuffleProgress.value = 0.501;
          runOnJS(triggerSwapHaptic)();
          completeTuck(dir);
          return;
        }
        shuffleProgress.value = (absDx / clearDist) * 0.5;
      })
      .onEnd((event) => {
        if (isCompleting.value || gestureHandled.value || countSV.value <= 1) return;
        const shouldAdvance =
          Math.abs(event.translationX) > SWIPE_DISTANCE_THRESHOLD ||
          Math.abs(event.velocityX) > SWIPE_VELOCITY_THRESHOLD;
        if (shouldAdvance) {
          gestureHandled.value = true;
          isCompleting.value = true;
          const dir: -1 | 1 =
            Math.abs(event.translationX) > 10
              ? event.translationX < 0
                ? -1
                : 1
              : event.velocityX < 0
                ? -1
                : 1;
          shuffleDir.value = dir;
          const remainingPull = Math.max(0, 0.5 - shuffleProgress.value);
          const pullDuration = Math.max(45, Math.round(remainingPull * 210));
          shuffleProgress.value = withTiming(
            0.501,
            { duration: pullDuration, easing: Easing.out(Easing.cubic) },
            (pulled) => {
              if (!pulled) {
                shuffleProgress.value = 0;
                shuffleDir.value = 0;
                isCompleting.value = false;
                return;
              }
              runOnJS(triggerSwapHaptic)();
              completeTuck(dir);
            },
          );
        } else {
          shuffleProgress.value = withSpring(0, CANCEL_SPRING, (finished) => {
            if (finished) {
              shuffleDir.value = 0;
            }
          });
        }
      })
      .onFinalize((_event, success) => {
        if (!success && !isCompleting.value) {
          shuffleProgress.value = withSpring(0, CANCEL_SPRING, (finished) => {
            if (finished) {
              shuffleDir.value = 0;
            }
          });
        }
      });
  });

  const expandPillStyle = useAnimatedStyle(() => {
    const opacity =
      shuffleDir.value === -1
        ? interpolate(
            shuffleProgress.value,
            [0, 0.25, 0.72, 1],
            [1, 0.25, 0.25, 1],
            Extrapolation.CLAMP,
          )
        : 1;
    return { opacity };
  });

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

  const mountedIndices = mountedDeckItemIndices(activeIndex, props.count);

  return (
    <View className="flex-row items-center justify-end gap-3">
      <Animated.View style={[{ zIndex: 1 }, expandPillStyle]}>
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
      </Animated.View>
      <GestureDetector gesture={panGesture}>
        <View style={{ width: cardWidth + peekTotalWidth, height: cardHeight, zIndex: 2 }}>
          {mountedIndices.map((itemIndex) => (
            <StackedDeckCard
              key={itemIndex}
              itemIndex={itemIndex}
              count={props.count}
              isFront={itemIndex === activeIndex}
              cardWidth={cardWidth}
              cardHeight={cardHeight}
              activeIndexSV={activeIndexSV}
              shuffleProgress={shuffleProgress}
              shuffleDir={shuffleDir}
              isDarkMode={isDarkMode}
              counterLabel={`${itemIndex + 1} / ${props.count}`}
            >
              {props.renderCard(itemIndex, cardHeight)}
            </StackedDeckCard>
          ))}
        </View>
      </GestureDetector>
    </View>
  );
}
