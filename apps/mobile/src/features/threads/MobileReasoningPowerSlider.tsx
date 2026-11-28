import * as Haptics from "expo-haptics";
import { useEffect, useEffectEvent, useId, useState } from "react";
import { View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import Svg, { Circle, Defs, G, LinearGradient, Rect, Stop } from "react-native-svg";

import { AppText as Text } from "../../components/ui/AppText";
import { useReduceMotionEnabled } from "../../lib/appState";

export type MobileSliderChoice = {
  readonly id: string;
  readonly label: string;
};

type PowerTier = "neutral" | "cobalt" | "prism";
type StarfieldDensity = "low" | "med" | "high" | "max";

const PRISM_LEVEL_IDS = new Set(["max", "ultra", "ultracode", "ultrathink"]);
const COBALT_LEVEL_IDS = new Set(["high", "xhigh", "extra_high", "extra-high", "extrahigh"]);
const LOW_LEVEL_IDS = new Set(["none", "off", "minimal", "low"]);

const TRACK_HEIGHT = 34;
const THUMB_SIZE = 26;
const THUMB_INSET = 4;

function resolvePowerVisuals(input: {
  readonly selectedId: string | undefined;
  readonly selectedIndex: number;
  readonly count: number;
}): {
  readonly tier: PowerTier;
  readonly density: StarfieldDensity;
  readonly ratio: number;
} {
  const normalizedId = input.selectedId?.toLowerCase() ?? "";
  const safeCount = Math.max(input.count, 1);
  const stepRatio =
    safeCount <= 1 ? 1 : Math.max(0, Math.min(1, input.selectedIndex / (safeCount - 1)));
  const ratio =
    safeCount <= 1
      ? 1
      : input.selectedIndex <= 0
        ? normalizedId === "none" || normalizedId === "off"
          ? 0.14
          : 0.25
        : 0.25 + stepRatio * 0.75;

  if (
    PRISM_LEVEL_IDS.has(normalizedId) ||
    (safeCount >= 4 && input.selectedIndex === safeCount - 1 && !COBALT_LEVEL_IDS.has(normalizedId))
  ) {
    return { tier: "prism", density: "max", ratio };
  }
  if (COBALT_LEVEL_IDS.has(normalizedId) || stepRatio >= 0.65) {
    return { tier: "cobalt", density: "high", ratio };
  }
  if (LOW_LEVEL_IDS.has(normalizedId) || stepRatio <= 0.25) {
    return { tier: "neutral", density: "low", ratio };
  }
  return { tier: "neutral", density: "med", ratio };
}

function durationForDensity(density: StarfieldDensity): number {
  switch (density) {
    case "low":
      return 6400;
    case "med":
      return 4400;
    case "high":
      return 2700;
    case "max":
      return 1750;
  }
}

function opacityForDensity(density: StarfieldDensity): number {
  switch (density) {
    case "low":
      return 0.48;
    case "med":
      return 0.68;
    case "high":
      return 0.86;
    case "max":
      return 1;
  }
}

function gradientStops(
  tier: PowerTier,
  isDarkMode: boolean,
): ReadonlyArray<{ offset: string; color: string }> {
  if (tier === "prism") {
    return isDarkMode
      ? [
          { offset: "0%", color: "#0ea5e9" },
          { offset: "36%", color: "#6366f1" },
          { offset: "68%", color: "#a855f7" },
          { offset: "100%", color: "#f43f5e" },
        ]
      : [
          { offset: "0%", color: "#0284c7" },
          { offset: "38%", color: "#4f46e5" },
          { offset: "70%", color: "#9333ea" },
          { offset: "100%", color: "#e11d48" },
        ];
  }
  if (tier === "cobalt") {
    return [
      { offset: "0%", color: "#1e3a8a" },
      { offset: "55%", color: "#2563eb" },
      { offset: "100%", color: "#3b82f6" },
    ];
  }
  return isDarkMode
    ? [
        { offset: "0%", color: "#3f3f46" },
        { offset: "100%", color: "#52525b" },
      ]
    : [
        { offset: "0%", color: "#18181b" },
        { offset: "100%", color: "#27272a" },
      ];
}

export function MobileReasoningPowerSlider(props: {
  readonly ariaLabel: string;
  readonly choices: ReadonlyArray<MobileSliderChoice>;
  readonly selectedId: string;
  readonly isDarkMode: boolean;
  readonly disabled?: boolean;
  readonly onSelect: (id: string) => void;
}) {
  const gradientId = useId();
  const [trackWidth, setTrackWidth] = useState(0);
  const reducedMotion = useReducedMotion();
  const reduceMotionEnabled = useReduceMotionEnabled();
  const disableMotion = reducedMotion || reduceMotionEnabled;

  const selectedIndex = Math.max(
    0,
    props.choices.findIndex((choice) => choice.id === props.selectedId),
  );
  const activeChoice = props.choices[selectedIndex];
  const visuals = resolvePowerVisuals({
    selectedId: activeChoice?.id,
    selectedIndex,
    count: props.choices.length,
  });

  const fillWidth =
    trackWidth > 0 ? Math.max(TRACK_HEIGHT, Math.round(trackWidth * visuals.ratio)) : 0;
  const labelFitsInside = visuals.ratio >= 0.28;
  const duration = durationForDensity(visuals.density);
  const driftProgress = useSharedValue(0);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- drives the open-sheet starfield drift animation on the UI thread
  useEffect(() => {
    if (disableMotion) {
      cancelAnimation(driftProgress);
      driftProgress.value = 0;
      return;
    }
    driftProgress.value = 0;
    driftProgress.value = withRepeat(withTiming(1, { duration, easing: Easing.linear }), -1, false);
    return () => {
      cancelAnimation(driftProgress);
    };
  }, [disableMotion, driftProgress, duration]);

  const starfieldWidth = Math.max(trackWidth, 240);
  const starfieldStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: (driftProgress.value - 1) * starfieldWidth }],
  }));

  const pickAtX = useEffectEvent((x: number) => {
    if (props.disabled || props.choices.length === 0 || trackWidth <= 0) return;
    const clamped = Math.max(0, Math.min(1, x / trackWidth));
    const nextIndex =
      props.choices.length <= 1 ? 0 : Math.round(clamped * (props.choices.length - 1));
    const target = props.choices[nextIndex];
    if (target && target.id !== props.selectedId) {
      void Haptics.selectionAsync().catch(() => undefined);
      props.onSelect(target.id);
    }
  });

  const [gesture] = useState(() => {
    const tap = Gesture.Tap()
      .runOnJS(true)
      .onEnd((event) => pickAtX(event.x));
    const pan = Gesture.Pan()
      .activeOffsetX([-5, 5])
      .failOffsetY([-18, 18])
      .runOnJS(true)
      .onStart((event) => pickAtX(event.x))
      .onUpdate((event) => pickAtX(event.x));
    return Gesture.Race(pan, tap);
  });

  const showMedium = visuals.density !== "low";
  const showHigh = visuals.density === "high" || visuals.density === "max";
  const showMax = visuals.density === "max";
  const stops = gradientStops(visuals.tier, props.isDarkMode);
  const trackBg = props.isDarkMode ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)";
  const dotColor = props.isDarkMode ? "rgba(255,255,255,0.22)" : "rgba(0,0,0,0.18)";

  return (
    <GestureDetector gesture={gesture}>
      {/* 44pt invisible touch area wrapping the sleek 34pt visual capsule */}
      <View
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={props.ariaLabel}
        accessibilityValue={{ text: activeChoice?.label }}
        accessibilityState={{ disabled: props.disabled === true }}
        accessibilityActions={[
          ...(selectedIndex > 0 ? [{ name: "decrement" }] : []),
          ...(selectedIndex < props.choices.length - 1 ? [{ name: "increment" }] : []),
        ]}
        onAccessibilityAction={({ nativeEvent }) => {
          if (props.disabled) return;
          if (nativeEvent.actionName === "decrement" && selectedIndex > 0) {
            const target = props.choices[selectedIndex - 1];
            if (target) {
              void Haptics.selectionAsync().catch(() => undefined);
              props.onSelect(target.id);
            }
          }
          if (nativeEvent.actionName === "increment" && selectedIndex < props.choices.length - 1) {
            const target = props.choices[selectedIndex + 1];
            if (target) {
              void Haptics.selectionAsync().catch(() => undefined);
              props.onSelect(target.id);
            }
          }
        }}
        style={{ paddingVertical: 5, opacity: props.disabled ? 0.55 : 1 }}
      >
        <View
          onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}
          style={{
            height: TRACK_HEIGHT,
            borderRadius: 9999,
            backgroundColor: trackBg,
            overflow: "hidden",
            flexDirection: "row",
            alignItems: "center",
          }}
        >
          {/* Detent dots across unfilled track */}
          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              inset: 0,
              paddingHorizontal: 17,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            {props.choices.map((choice) => (
              <View
                key={choice.id}
                style={{
                  width: 4,
                  height: 4,
                  borderRadius: 999,
                  backgroundColor: dotColor,
                }}
              />
            ))}
          </View>

          {/* Filled capsule with gradient, flowing circular starfield, label, and pure-white thumb */}
          {fillWidth > 0 ? (
            <View
              pointerEvents="none"
              style={{
                width: fillWidth,
                height: TRACK_HEIGHT,
                borderRadius: 9999,
                overflow: "hidden",
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "flex-end",
                paddingRight: THUMB_INSET,
              }}
            >
              <Svg
                width={fillWidth}
                height={TRACK_HEIGHT}
                style={{ position: "absolute", left: 0, top: 0 }}
              >
                <Defs>
                  <LinearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
                    {stops.map((stop) => (
                      <Stop key={stop.offset} offset={stop.offset} stopColor={stop.color} />
                    ))}
                  </LinearGradient>
                </Defs>
                <Rect
                  x={0}
                  y={0}
                  width={fillWidth}
                  height={TRACK_HEIGHT}
                  rx={TRACK_HEIGHT / 2}
                  fill={`url(#${gradientId})`}
                />
              </Svg>

              {/* Flowing circular micro-dots (zero 4-point sparkles) */}
              <Animated.View
                style={[
                  {
                    position: "absolute",
                    left: 0,
                    top: 0,
                    width: starfieldWidth * 2,
                    height: TRACK_HEIGHT,
                    opacity: opacityForDensity(visuals.density),
                  },
                  starfieldStyle,
                ]}
              >
                <Svg
                  width={starfieldWidth * 2}
                  height={TRACK_HEIGHT}
                  viewBox="0 0 600 34"
                  preserveAspectRatio="none"
                >
                  {[0, 300].map((offset) => (
                    <G key={offset} translateX={offset}>
                      <Circle cx={24} cy={11} r={1.1} fill="#ffffff" opacity={0.55} />
                      <Circle cx={76} cy={24} r={1.2} fill="#ffffff" opacity={0.68} />
                      <Circle cx={142} cy={13} r={1.0} fill="#ffffff" opacity={0.52} />
                      <Circle cx={212} cy={23} r={1.3} fill="#ffffff" opacity={0.75} />
                      <Circle cx={268} cy={12} r={1.15} fill="#ffffff" opacity={0.62} />
                      {showMedium ? (
                        <>
                          <Circle cx={48} cy={21} r={0.95} fill="#ffffff" opacity={0.54} />
                          <Circle cx={110} cy={10} r={1.2} fill="#ffffff" opacity={0.72} />
                          <Circle cx={176} cy={25} r={1.1} fill="#ffffff" opacity={0.62} />
                          <Circle cx={240} cy={17} r={1.3} fill="#ffffff" opacity={0.78} />
                        </>
                      ) : null}
                      {showHigh ? (
                        <>
                          <Circle cx={64} cy={12} r={1.25} fill="#ffffff" opacity={0.78} />
                          <Circle cx={166} cy={23} r={1.3} fill="#ffffff" opacity={0.82} />
                          <Circle cx={242} cy={11} r={1.2} fill="#ffffff" opacity={0.76} />
                          <Circle cx={94} cy={19} r={1.35} fill="#ffffff" opacity={0.86} />
                          <Circle cx={192} cy={10} r={1.4} fill="#ffffff" opacity={0.88} />
                          <Circle cx={284} cy={22} r={1.25} fill="#ffffff" opacity={0.82} />
                        </>
                      ) : null}
                      {showMax ? (
                        <>
                          <Circle cx={38} cy={24} r={1.5} fill="#ffffff" opacity={0.95} />
                          <Circle cx={128} cy={15} r={1.6} fill="#ffffff" opacity={0.96} />
                          <Circle cx={224} cy={20} r={1.65} fill="#ffffff" opacity={0.98} />
                          <Circle cx={152} cy={10} r={1.3} fill="#ffffff" opacity={0.86} />
                          <Circle cx={260} cy={26} r={1.35} fill="#ffffff" opacity={0.9} />
                          <Circle cx={18} cy={18} r={1.2} fill="#ffffff" opacity={0.84} />
                          <Circle cx={106} cy={25} r={1.3} fill="#ffffff" opacity={0.88} />
                        </>
                      ) : null}
                    </G>
                  ))}
                </Svg>
              </Animated.View>

              {labelFitsInside && activeChoice ? (
                <Text
                  numberOfLines={1}
                  style={{
                    position: "absolute",
                    left: 14,
                    color: "#ffffff",
                    fontSize: 12.5,
                    fontWeight: "600",
                  }}
                >
                  {activeChoice.label}
                </Text>
              ) : null}

              {/* Pure-white concentric circular thumb */}
              <View
                style={{
                  width: THUMB_SIZE,
                  height: THUMB_SIZE,
                  borderRadius: 9999,
                  backgroundColor: "#ffffff",
                  shadowColor: "#000000",
                  shadowOffset: { width: 0, height: 1.5 },
                  shadowOpacity: 0.26,
                  shadowRadius: 4,
                  elevation: 3,
                }}
              />
            </View>
          ) : null}

          {!labelFitsInside && activeChoice ? (
            <Text numberOfLines={1} className="ml-2.5 text-xs font-t3-medium text-foreground-muted">
              {activeChoice.label}
            </Text>
          ) : null}
        </View>
      </View>
    </GestureDetector>
  );
}
