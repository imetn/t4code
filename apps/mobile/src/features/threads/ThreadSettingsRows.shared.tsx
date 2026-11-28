import { useGT } from "gt-react-native";
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import { AppText as Text } from "../../components/ui/AppText";
import { SymbolView } from "../../components/ui/AppSymbol";
import { ProviderIcon } from "../../components/ProviderIcon";
import { cn } from "../../lib/cn";
import type { ModelOption } from "../../lib/modelOptions";

export type ModelRowProps = {
  readonly option: ModelOption;
  readonly selected: boolean;
  readonly selectedBackgroundColor?: string;
  readonly onPress: () => void;
  readonly isFavorite: boolean;
  readonly favoritesLoaded: boolean;
  readonly onToggleFavorite: () => void;
  readonly onToggleHidden?: () => void;
  readonly hiddenUpdatePending?: boolean;
  readonly showProviderIcon?: boolean;
  readonly isFirst: boolean;
  readonly isLast: boolean;
};

export type ChoiceRowProps = {
  readonly label: string;
  readonly description?: string;
  readonly selected: boolean;
  readonly disabled?: boolean;
  readonly onPress: () => void;
  readonly isLast: boolean;
};

type RowSelectionProps = {
  readonly leadingSelection?: ReactNode;
  readonly trailingSelection?: ReactNode;
  readonly minimumHeight?: number;
};

export function ModelRowContent(
  props: ModelRowProps &
    RowSelectionProps & {
      readonly labelNumberOfLines: number;
      readonly selectedClassName?: string;
    },
) {
  const gt = useGT();
  return (
    <View
      style={[
        props.minimumHeight === undefined ? undefined : { minHeight: props.minimumHeight },
        props.selected && props.selectedBackgroundColor
          ? { backgroundColor: props.selectedBackgroundColor }
          : undefined,
      ]}
      className={cn(
        "mx-1.5 my-0.5 min-h-[44px] flex-row items-center gap-2 rounded-[14px] px-3 android:min-h-[48px]",
        props.selected
          ? props.selectedBackgroundColor
            ? undefined
            : (props.selectedClassName ?? "bg-subtle-strong")
          : "bg-transparent",
      )}
    >
      <Pressable
        accessibilityLabel={[props.option.label, props.option.subtitle].filter(Boolean).join(", ")}
        accessibilityRole="radio"
        accessibilityState={{
          checked: props.selected,
          disabled: props.option.isUnavailable === true || props.option.isHidden === true,
        }}
        className="min-h-[46px] min-w-0 flex-1 flex-row items-center gap-2.5 active:opacity-70 android:min-h-[48px]"
        disabled={props.option.isUnavailable || props.option.isHidden}
        onPress={props.onPress}
      >
        {props.leadingSelection}
        {props.showProviderIcon ? (
          <ProviderIcon
            iconUrl={props.option.providerIconUrl}
            provider={props.option.providerDriver}
            size={15}
          />
        ) : null}
        <View className="min-w-0 flex-1">
          <View className="flex-row items-center gap-2">
            <Text
              className={cn(
                "min-w-0 shrink text-base",
                props.selected
                  ? "font-t3-bold text-foreground"
                  : "font-t3-medium text-foreground/90",
              )}
              numberOfLines={props.labelNumberOfLines}
            >
              {props.option.label}
            </Text>
            {props.option.isLegacy ? (
              <View className="rounded-full bg-subtle px-1.5 py-0.5">
                <Text className="text-3xs font-t3-medium text-foreground-muted">
                  {gt("Legacy", { $context: "badge on an older model" })}
                </Text>
              </View>
            ) : null}
            {props.option.isHidden ? (
              <Text className="text-xs text-foreground-muted">
                {gt("Hidden", { $context: "model is hidden from the picker" })}
              </Text>
            ) : null}
            {props.option.isUnavailable ? (
              <Text className="text-xs text-foreground">
                {gt("Unavailable", { $context: "model cannot be used" })}
              </Text>
            ) : null}
          </View>
          {props.option.subtitle ? (
            <Text
              className="text-xs text-foreground-muted"
              numberOfLines={props.labelNumberOfLines}
            >
              {props.option.subtitle}
            </Text>
          ) : null}
        </View>
        {props.trailingSelection}
      </Pressable>
      {props.onToggleHidden ? (
        <Pressable
          accessibilityLabel={
            props.option.isHidden
              ? gt("Show model: {provider}, {model}", {
                  provider: props.option.providerLabel,
                  model: props.option.label,
                })
              : gt("Hide model: {provider}, {model}", {
                  provider: props.option.providerLabel,
                  model: props.option.label,
                })
          }
          accessibilityRole="button"
          accessibilityState={{ disabled: props.hiddenUpdatePending === true }}
          className="min-h-[40px] min-w-[36px] items-center justify-center"
          disabled={props.hiddenUpdatePending}
          onPress={props.onToggleHidden}
        >
          <SymbolView
            name={props.option.isHidden ? "eye.slash" : "eye"}
            size={16}
            tintColorClassName={props.option.isHidden ? "accent-icon-subtle" : "accent-icon"}
            type="monochrome"
          />
        </Pressable>
      ) : null}
      <Pressable
        accessibilityLabel={
          props.isFavorite
            ? gt("Remove from favorites: {provider}, {model}", {
                provider: props.option.providerLabel,
                model: props.option.label,
              })
            : gt("Add to favorites: {provider}, {model}", {
                provider: props.option.providerLabel,
                model: props.option.label,
              })
        }
        accessibilityRole="button"
        accessibilityState={{ disabled: !props.favoritesLoaded, selected: props.isFavorite }}
        className="min-h-[40px] min-w-[36px] items-center justify-center"
        disabled={!props.favoritesLoaded}
        onPress={props.onToggleFavorite}
      >
        <SymbolView
          name={props.isFavorite ? "star.fill" : "star"}
          size={15}
          tintColor={props.isFavorite ? "#f59e0b" : undefined}
          tintColorClassName={props.isFavorite ? undefined : "accent-icon-subtle"}
          style={props.isFavorite ? undefined : { opacity: 0.4 }}
          type="monochrome"
        />
      </Pressable>
    </View>
  );
}

export function ChoiceRowContent(props: ChoiceRowProps & RowSelectionProps) {
  return (
    <Pressable
      accessibilityLabel={props.description ? `${props.label}. ${props.description}` : props.label}
      accessibilityRole="radio"
      accessibilityState={{ checked: props.selected, disabled: props.disabled === true }}
      disabled={props.disabled}
      onPress={props.onPress}
      style={props.minimumHeight === undefined ? undefined : { minHeight: props.minimumHeight }}
      className={cn(
        "min-h-14 flex-row items-center gap-3 bg-grouped-card px-4 py-3 active:bg-subtle",
        !props.isLast && "border-b border-border-subtle",
      )}
    >
      {props.leadingSelection}
      <View className={cn("min-w-0 flex-1 gap-0.5", props.disabled && "opacity-50")}>
        <Text className="text-base font-t3-medium text-foreground">{props.label}</Text>
        {props.description ? (
          <Text className="text-sm leading-5 text-foreground-muted">{props.description}</Text>
        ) : null}
      </View>
      {props.trailingSelection}
    </Pressable>
  );
}
