"""Configuration + Deck definitions.

On import this module:
  * parses ``--mode`` from ``sys.argv``
  * loads ``config.yaml`` (with mode overrides)
  * exposes every tunable as an UPPERCASE module constant
  * defines the ``Deck`` class and loads ``decks/*.yaml`` into ``DECKS``
"""
from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, FrozenSet, List, Optional, Set, Tuple

import argparse as _argparse
import yaml

from .types import (
    CardType, CardClass, Position,
    PLACEABLE, REGULAR_TYPES, DELUXE_TYPES,
)

_mode_parser = _argparse.ArgumentParser(
    description="Wold's Vaults / Vanilla NDM deck optimizer.",
    add_help=True,
)
_mode_parser.add_argument(
    "--mode",
    choices=("wolds", "vanilla"),
    default="wolds",
    help="Optimizer preset: 'wolds' (default) or 'vanilla'.",
)
MODE: str = _mode_parser.parse_known_args()[0].mode
_VANILLA: bool = MODE == "vanilla"

# ──────────────────────────────────────────────────────────────────────────────
# Configuration (config.yaml + decks/*.yaml)
# ──────────────────────────────────────────────────────────────────────────────

_HERE = Path(__file__).resolve().parent.parent  # project root (parent of src/)
_CONFIG_PATH = _HERE / "config.yaml"
_DECKS_DIR = _HERE / "decks"


def _deep_merge(base: Dict[str, Any], override: Dict[str, Any]) -> Dict[str, Any]:
    """Recursively merge ``override`` into ``base`` (mutating ``base``)."""
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(base.get(key), dict):
            _deep_merge(base[key], value)
        else:
            base[key] = value
    return base


with _CONFIG_PATH.open("r", encoding="utf-8") as _f:
    _CFG: Dict[str, Any] = yaml.safe_load(_f)

_mode_overrides = (_CFG.get("modes") or {}).get(MODE, {}) or {}
_deep_merge(_CFG, _mode_overrides)

# ──────────────────────────────────────────────────────────────────────────────
# Tunable multiplier constants (loaded from config.yaml)
# ──────────────────────────────────────────────────────────────────────────────

DECKMOD: int = _CFG["deckmod"]

MULT_DIR_GREED_VERT:      float = _CFG["greed"]["dir_vert"]
MULT_DIR_GREED_HORIZ:     float = _CFG["greed"]["dir_horiz"]
MULT_EVO_GREED:           float = _CFG["greed"]["evo"]
MULT_SURR_GREED:          float = _CFG["greed"]["surr"]
MULT_DIR_GREED_DIAG_UP:   float = _CFG["greed"]["dir_diag_up"]
MULT_DIR_GREED_DIAG_DOWN: float = _CFG["greed"]["dir_diag_down"]

MULT_PURE_BASE:   float = _CFG["cores"]["pure_base"]
MULT_PURE_SCALE:  float = _CFG["cores"]["pure_scale"]
MULT_EQUILIBRIUM: float = _CFG["cores"]["equilibrium"]
MULT_FOIL:        float = _CFG["cores"]["foil"]
MULT_STEADFAST:   float = _CFG["cores"]["steadfast"]
MULT_COLOR:       float = _CFG["cores"]["color"]

ALLOW_DELUXE:           bool  = _CFG["deluxe"]["allow"]
MULT_DELUXE_FLAT:       float = _CFG["deluxe"]["flat"]
MULT_DELUXE_CORE_BASE:  float = _CFG["deluxe"]["core_base"]
MULT_DELUXE_CORE_SCALE: float = _CFG["deluxe"]["core_scale"]

GREED_ADDITIVE: bool = _CFG["stacking"]["greed_additive"]
ADDITIVE_CORES: bool = _CFG["stacking"]["additive_cores"]

SHINY_POSITIONAL: bool = _CFG["shiny"]["positional"]

ENABLE_EXPERIMENTAL_EXPONENT: bool  = _CFG["experimental"]["enable_exponent"]
EXPERIMENTAL_EXPONENT:        float = _CFG["experimental"]["exponent"]
EXPERIMENTAL_BOOST:           float = _CFG["experimental"]["boost"]

DELUXE_COUNTED_AS_REGULAR: bool = _CFG["constraints"]["deluxe_counted_as_regular"]

# Display options
BALANCE_DISPLAY: bool = _CFG["display"]["balance"]
HEATMAP_DISPLAY: bool = _CFG["display"]["heatmap"]

HNS_Q:         float = _CFG["metrics"]["hns_q"]
SPREAD_METRIC: bool  = _CFG["metrics"]["spread"]

# Spreadsheet export
EXPORT_SPREADSHEET: bool = _CFG["output"]["export_spreadsheet"]
SPREADSHEET_PREFIX: str  = _CFG["output"]["spreadsheet_prefix"]

# Full test panel: runs the configured constraint configs per deck/class
# instead of the deck's own min_regular / max_greed settings.
FULL_TEST_PANEL: bool = _CFG["testing"]["full_panel"]

if ALLOW_DELUXE:
    PLACEABLE.append(CardType.DELUXE)


class Deck:
    def __init__(
        self,
        slots:       Set[Position],
        core_slots:  int,
        n_arcane:    int = 0,
        min_regular: int = -1,
        max_greed:   int = -1,
        name:        str = "Unnamed Deck",
    ) -> None:
        self.slots       = frozenset(slots)
        self.core_slots  = core_slots
        self.n_arcane    = n_arcane
        self.min_regular = min_regular
        self.max_greed   = max_greed
        self.name        = name

        self._row_peers:  Dict[Position, FrozenSet[Position]] = {}
        self._col_peers:  Dict[Position, FrozenSet[Position]] = {}
        self._surr_peers: Dict[Position, FrozenSet[Position]] = {}
        self._diag_peers: Dict[Position, FrozenSet[Position]] = {}

        for p in self.slots:
            r, c = p
            self._row_peers[p]  = frozenset(q for q in self.slots if q[0] == r and q != p)
            self._col_peers[p]  = frozenset(q for q in self.slots if q[1] == c and q != p)
            self._surr_peers[p] = frozenset(
                q for q in self.slots if q != p and max(abs(q[0]-r), abs(q[1]-c)) <= 1)
            for p in self.slots:
                r, c = p
                self._diag_peers[p] = frozenset(
                    q for q in self.slots
                    if q != p and (
                        (q[0] - q[1] == r - c) or   # NW-SE diagonal
                        (q[0] + q[1] == r + c)       # NE-SW diagonal
                    )
                )

    _CHAR: Dict[CardType, str] = {
        CardType.ROW:             "R",
        CardType.COL:             "C",
        CardType.SURR:            "S",
        CardType.DIAG:            "X",
        CardType.DELUXE:          "D",
        CardType.TYPELESS:        "T",
        CardType.DIR_GREED_UP:    "^",
        CardType.DIR_GREED_DOWN:  "v",
        CardType.DIR_GREED_LEFT:  "<",
        CardType.DIR_GREED_RIGHT: ">",
        CardType.DIR_GREED_NE:    "↗",
        CardType.DIR_GREED_NW:    "↖",
        CardType.DIR_GREED_SE:    "↘",
        CardType.DIR_GREED_SW:    "↙",
        CardType.EVO_GREED:       "e",
        CardType.SURR_GREED:      "o",
        CardType.FILLER_GREED:    ".",
        CardType.EMPTY:           "·",
    }

    def display(self, assignment: Optional[Dict[Position, CardType]] = None) -> str:
        if not self.slots:
            return "(empty deck)"
        min_r = min(r for r, _ in self.slots); max_r = max(r for r, _ in self.slots)
        min_c = min(c for _, c in self.slots); max_c = max(c for _, c in self.slots)
        lines = []
        for r in range(min_r, max_r + 1):
            cells = []
            for c in range(min_c, max_c + 1):
                p = (r, c)
                if   p not in self.slots:              cells.append(" ")
                elif assignment and p in assignment:   cells.append(self._CHAR[assignment[p]])
                else:                                  cells.append("□")
            lines.append(" ".join(cells))
        return "\n".join(lines)

    def with_constraints(self, min_regular: int, max_greed: int) -> "Deck":
        """Return a shallow copy of this deck with overridden constraints."""
        return Deck(
            self.slots, self.core_slots, self.n_arcane,
            min_regular, max_greed, self.name,
        )

    def constraint_str(self) -> str:
        """Human-readable summary of this deck's min_regular / max_greed."""
        n = len(self.slots)
        overridden = (
            self.min_regular >= 0
            and self.max_greed  >= 0
            and self.min_regular + self.max_greed > n
        )
        parts = []
        if self.min_regular >= 0:
            note = " (overridden)" if overridden else ""
            parts.append(f"min {self.min_regular} regular{note}")
        if self.max_greed >= 0:
            parts.append(f"max {self.max_greed} greed")
        return "  |  ".join(parts) if parts else "unconstrained"

    def __repr__(self) -> str:
        return f"Deck({len(self.slots)} slots, {self.core_slots} core slots)"


# Each panel config is (label, min_regular, max_greed); loaded from config.yaml.
_FULL_TEST_CONFIGS: List[Tuple[str, int, int]] = [
    (str(c["label"]), int(c["min_regular"]), int(c["max_greed"]))
    for c in _CFG["testing"]["panel_configs"]
]


def _get_test_configs(deck: Deck) -> List[Tuple[str, int, int]]:
    """Return the list of (label, min_regular, max_greed) to run for this deck.

    Lives here because it's purely a derivation of the configured test panel
    plus the deck's own constraints — no algorithm logic, no I/O.
    """
    if not FULL_TEST_PANEL:
        return [("default", deck.min_regular, deck.max_greed)]

    n = len(deck.slots)
    configs: List[Tuple[str, int, int]] = []
    for label, min_reg, max_greed in _FULL_TEST_CONFIGS:
        if min_reg > n:          # collapse: min_reg exceeds capacity
            min_reg   = -1
            max_greed = 0
        configs.append((label, min_reg, max_greed))
    return configs


# ──────────────────────────────────────────────────────────────────────────────
# Deck configurations
# ──────────────────────────────────────────────────────────────────────────────
# Decks are loaded from individual YAML files in the `decks/` directory next to
# this script. Each file describes one deck (name, enabled flag, layout grid,
# core slots, etc.). See `decks/01_cake.yaml` for an example. Set
# `enabled: false` in a deck file to skip it without deleting it.

def _parse_layout(layout: str) -> Set[Tuple[int, int]]:
    """Convert a visual layout grid into a set of (row, col) slot positions."""
    slots: Set[Tuple[int, int]] = set()
    for r, line in enumerate(layout.rstrip("\n").splitlines()):
        for c, ch in enumerate(line):
            if ch in ("X", "x", "#"):
                slots.add((r, c))
    return slots


def _load_decks() -> List[Deck]:
    if not _DECKS_DIR.is_dir():
        raise FileNotFoundError(
            f"Deck directory not found: {_DECKS_DIR}. "
            "Add YAML deck files there or restore the directory."
        )

    decks: List[Deck] = []
    for path in sorted(_DECKS_DIR.glob("*.yaml")):
        with path.open("r", encoding="utf-8") as fh:
            data = yaml.safe_load(fh) or {}

        if not data.get("enabled", True):
            continue

        slots = _parse_layout(data["layout"])
        if not slots:
            raise ValueError(
                f"Deck file {path.name} has no slots — check the layout grid."
            )

        decks.append(Deck(
            slots       = slots,
            core_slots  = int(data["core_slots"]) + DECKMOD,
            n_arcane    = int(data.get("n_arcane", 0)),
            min_regular = int(data.get("min_regular", -1)),
            max_greed   = int(data.get("max_greed", -1)),
            name        = str(data["name"]),
        ))

    if not decks:
        raise RuntimeError(
            f"No enabled deck files found in {_DECKS_DIR}."
        )
    return decks


DECKS: List[Deck] = _load_decks()
