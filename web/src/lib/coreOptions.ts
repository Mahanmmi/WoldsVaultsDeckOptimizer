// Static list of core options in the picker (port of _CORE_OPTIONS in gui.py).
// The COLOR core gets one row per color (game allows one in inventory per color).

import { Color, CoreType } from "./types";

export interface CoreOption {
  coreType: CoreType;
  color:    Color | null;
}

export const CORE_OPTIONS: readonly CoreOption[] = [
  { coreType: CoreType.PURE,        color: null },
  { coreType: CoreType.EQUILIBRIUM, color: null },
  { coreType: CoreType.STEADFAST,   color: null },
  { coreType: CoreType.FOIL,        color: null },
  { coreType: CoreType.DELUXE_CORE, color: null },
  { coreType: CoreType.COLOR,       color: Color.RED },
  { coreType: CoreType.COLOR,       color: Color.GREEN },
  { coreType: CoreType.COLOR,       color: Color.BLUE },
  { coreType: CoreType.COLOR,       color: Color.YELLOW },
];

export function coreLabel(opt: CoreOption): string {
  if (opt.coreType === CoreType.COLOR && opt.color !== null) {
    return `Color · ${opt.color.charAt(0).toUpperCase() + opt.color.slice(1)}`;
  }
  return opt.coreType
    .split("_")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}
