// Card-type / color palette (lockstep with src/gui.py — bg colors match the
// xlsx export too). Centralised so DeckGrid + Legend agree without drift.

import { CardType, Color } from "./types";

const POSITIONAL = new Set<CardType>([CardType.ROW, CardType.COL, CardType.SURR, CardType.DIAG]);
const DIR_GREEDS = new Set<CardType>([
  CardType.DIR_GREED_UP,    CardType.DIR_GREED_DOWN,
  CardType.DIR_GREED_LEFT,  CardType.DIR_GREED_RIGHT,
  CardType.DIR_GREED_NE,    CardType.DIR_GREED_NW,
  CardType.DIR_GREED_SE,    CardType.DIR_GREED_SW,
]);
const OTHER_GREEDS = new Set<CardType>([CardType.EVO_GREED, CardType.SURR_GREED]);

export function slotBg(t: CardType): string {
  if (POSITIONAL.has(t))     return "#A9CCE3";
  if (t === CardType.DELUXE) return "#D7BDE2";
  if (DIR_GREEDS.has(t))     return "#F9E79F";
  if (OTHER_GREEDS.has(t))   return "#FDEBD0";
  if (t === CardType.TYPELESS) return "#A8D5A2";
  if (t === CardType.DEAD)     return "#ECECEC";
  return "#FFFFFF";
}

export const COLOR_HEX: Record<Color, string> = {
  [Color.RED]:    "#E74C3C",
  [Color.GREEN]:  "#27AE60",
  [Color.BLUE]:   "#3498DB",
  [Color.YELLOW]: "#F1C40F",
};

export const TYPE_LABEL: Record<CardType, string> = {
  [CardType.ROW]: "Row", [CardType.COL]: "Col",
  [CardType.SURR]: "Surr", [CardType.DIAG]: "Diag",
  [CardType.DELUXE]: "Deluxe", [CardType.TYPELESS]: "Typeless",
  [CardType.DIR_GREED_UP]: "Greed ↑", [CardType.DIR_GREED_DOWN]: "Greed ↓",
  [CardType.DIR_GREED_LEFT]: "Greed ←", [CardType.DIR_GREED_RIGHT]: "Greed →",
  [CardType.DIR_GREED_NE]: "Greed ↗", [CardType.DIR_GREED_NW]: "Greed ↖",
  [CardType.DIR_GREED_SE]: "Greed ↘", [CardType.DIR_GREED_SW]: "Greed ↙",
  [CardType.EVO_GREED]: "Evo Greed", [CardType.SURR_GREED]: "Surr Greed",
  [CardType.FILLER_GREED]: "Filler",
  [CardType.EMPTY]: "Empty", [CardType.DEAD]: "Dead",
};

// Single-char glyphs (matches Deck._CHAR in src/config.py).
export const TYPE_GLYPH: Record<CardType, string> = {
  [CardType.ROW]: "R", [CardType.COL]: "C",
  [CardType.SURR]: "S", [CardType.DIAG]: "X",
  [CardType.DELUXE]: "D", [CardType.TYPELESS]: "T",
  [CardType.DIR_GREED_UP]: "^", [CardType.DIR_GREED_DOWN]: "v",
  [CardType.DIR_GREED_LEFT]: "<", [CardType.DIR_GREED_RIGHT]: ">",
  [CardType.DIR_GREED_NE]: "↗", [CardType.DIR_GREED_NW]: "↖",
  [CardType.DIR_GREED_SE]: "↘", [CardType.DIR_GREED_SW]: "↙",
  [CardType.EVO_GREED]: "e", [CardType.SURR_GREED]: "o",
  [CardType.FILLER_GREED]: ".",
  [CardType.EMPTY]: "·", [CardType.DEAD]: "·",
};

// Inventory rows in the order the table renders them (positional, deluxe,
// typeless, then greeds).
export const INVENTORY_TYPES: readonly CardType[] = [
  CardType.ROW, CardType.COL, CardType.SURR, CardType.DIAG,
  CardType.DELUXE, CardType.TYPELESS,
  CardType.DIR_GREED_UP, CardType.DIR_GREED_DOWN,
  CardType.DIR_GREED_LEFT, CardType.DIR_GREED_RIGHT,
  CardType.DIR_GREED_NE, CardType.DIR_GREED_NW,
  CardType.DIR_GREED_SE, CardType.DIR_GREED_SW,
  CardType.EVO_GREED, CardType.SURR_GREED,
];
