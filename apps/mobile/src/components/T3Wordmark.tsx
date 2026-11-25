import type { ColorValue } from "react-native";
import Svg, { Path } from "react-native-svg";
import { withUniwind } from "uniwind";

const ThemedPath = withUniwind(Path);

export function T3Wordmark(props: {
  readonly height: number;
  readonly color?: ColorValue;
  readonly colorClassName?: string;
}) {
  const aspectRatio = 99 / 56;
  return (
    <Svg
      accessibilityLabel="T4"
      height={props.height}
      width={props.height * aspectRatio}
      viewBox="14.5 37 99 56"
    >
      <ThemedPath
        d="M14.5 37H62.5V47.56H44.98V93H32.02V47.56H14.5V37ZM89.2 37H103V70.44H113.5V81H103V93H90.04V81H60.5V70.44L89.2 37ZM90.04 53.22L75.26 70.44H90.04V53.22Z"
        color={props.color}
        colorClassName={props.colorClassName}
        fill="currentColor"
      />
    </Svg>
  );
}
