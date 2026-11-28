import type { ReactNode } from "react";

export interface SheetPaneProps {
  /** The iOS surface under the bar: a sheet's, native glass, or the screen's in a column. */
  readonly surface?: "sheet" | "screen" | "glass";
  readonly children: ReactNode;
}
