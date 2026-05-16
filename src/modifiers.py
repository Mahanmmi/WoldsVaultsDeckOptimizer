"""Loader + classifier for ``modifiers.json`` (game card definitions).

Used by the Preview panel in the GUI to let users assign concrete stat cards
to slots in an optimized deck. We only care about cards that actually grant a
stat — non-stat entries are filtered out.

Public API:
    load_modifiers()             -> Dict[str, CardEntry]   (cached)
    cards_by_family(family)      -> List[CardEntry]        (cached, alpha order)
    get_card(key)                -> Optional[CardEntry]
    is_percent_attr(attribute)   -> bool
    attribute_display(attribute) -> str                    (e.g. "Attack Damage")

Family rules (mutually exclusive, first match wins):
    "deluxe"   if groups contains "Deluxe"
    "shiny"    if groups contains "Shiny"
    "evo"      if groups contains "Evolution"
    "typeless" if groups contains "Stat" (and none of the above)
    otherwise: skipped (not a previewable stat card)

Percent rule:
    attribute ends in "_percent" or "_percentile", OR is in _PERCENT_EXTRA
    (a small hardcoded set of known scaling attrs that don't follow the suffix
    convention — currently just "damage_increase").
"""
from __future__ import annotations

import json
import sys
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Dict, List, Optional, Tuple

# ──────────────────────────────────────────────────────────────────────────────
# Detection rules
# ──────────────────────────────────────────────────────────────────────────────

_PERCENT_SUFFIXES: Tuple[str, ...] = ("_percent", "_percentile")

# Attributes that are percent-style but don't end in _percent/_percentile.
# Every entry is justified by pool-value magnitude: these attrs have max pool
# values in the 0.005–0.1 range (same scale as known-% damage_increase / the
# *_percentile family), versus clearly-flat attrs which sit at 5–10. In-game
# semantics confirm: all of these are %-bonus stats in Vault Hunters.
#
# If a future card adds an attribute that should be percent, add it here.
_PERCENT_EXTRA = frozenset({
    "the_vault:damage_increase",         # "Scaling Attack Damage"  — max 0.025
    "the_vault:cooldown_reduction",      # CDR                        max 0.025
    "the_vault:critical_hit_mitigation", # crit-hit mitigation        max 0.025
    "the_vault:healing_effectiveness",   # healing bonus              max 0.025
    "the_vault:knockback_resistance",    # KBR                        max 0.05
    "the_vault:lucky_hit_chance",        # lucky hit chance           max 0.0125
    "the_vault:resistance",              # generic resistance         max 0.025
    "the_vault:soul_chance",             # soul drop chance           max 0.1
    "the_vault:trap_disarming",          # trap disarm chance         max 0.05
    "the_vault:item_quantity",           # +% item quantity           max 0.025
    "the_vault:item_rarity",             # +% item rarity             max 0.025
    "the_vault:mana_regen",              # mana regen                 max 0.1
    "the_vault:movement_speed",          # movement speed             max 0.0125
    "the_vault:area_of_effect",          # AoE                        max 0.025
    "the_vault:copiously",               # "copiously" (drop bonus)   max 0.025
})

# Order matters: first match wins. Deluxe is checked first because some deluxe
# cards also carry stat-family groups; we want them in the "deluxe" pool only.
_FAMILY_ORDER: Tuple[Tuple[str, str], ...] = (
    ("Deluxe",    "deluxe"),
    ("Shiny",     "shiny"),
    ("Evolution", "evo"),
    ("Stat",      "typeless"),
)

_FAMILIES: Tuple[str, ...] = ("shiny", "evo", "deluxe", "typeless")


# ──────────────────────────────────────────────────────────────────────────────
# Data model
# ──────────────────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class CardTier:
    tier:  int
    value: float       # pool[i].min (min == max in practice; we ignore step)


@dataclass(frozen=True)
class CardEntry:
    key:             str        # e.g. "attack_damage_shiny"
    name:            str        # e.g. "Shiny Attack Damage Card"
    attribute:       str        # full id, e.g. "the_vault:attack_damage"
    attribute_short: str        # display id, e.g. "attack_damage"
    family:          str        # "shiny" | "evo" | "deluxe" | "typeless"
    is_percent:      bool
    tiers:           Tuple[CardTier, ...]  # sorted by tier asc

    @property
    def display_attribute(self) -> str:
        """Human-readable attribute name, e.g. 'Attack Damage'."""
        return _humanize(self.attribute_short)


# ──────────────────────────────────────────────────────────────────────────────
# Loader
# ──────────────────────────────────────────────────────────────────────────────

def _modifiers_path() -> Path:
    """Resolve modifiers.json — sibling of the repo root (parent of ``src/``)."""
    return Path(__file__).resolve().parent.parent / "modifiers.json"


def _classify_family(groups: List[str]) -> Optional[str]:
    for tag, family in _FAMILY_ORDER:
        if tag in groups:
            return family
    return None


def _is_percent(attribute: str) -> bool:
    if attribute in _PERCENT_EXTRA:
        return True
    return any(attribute.endswith(s) for s in _PERCENT_SUFFIXES)


def _strip_attr_prefix(attribute: str) -> str:
    # Strip the "the_vault:" mod prefix for display.
    return attribute.split(":", 1)[-1]


def _humanize(snake: str) -> str:
    """`attack_damage_percent` -> `Attack Damage Percent`. Pure cosmetic."""
    return " ".join(part.capitalize() for part in snake.split("_") if part)


@lru_cache(maxsize=1)
def load_modifiers() -> Dict[str, CardEntry]:
    """Parse ``modifiers.json`` once and return ``{key: CardEntry}``.

    Returns ``{}`` (and prints a warning to stderr) if the file is missing or
    malformed — the GUI will surface this to the user, but we don't crash the
    rest of the app over it.
    """
    path = _modifiers_path()
    if not path.exists():
        print(
            f"[modifiers] WARN: {path} not found — Preview mode will be empty.",
            file=sys.stderr,
        )
        return {}

    try:
        with path.open("r", encoding="utf-8") as f:
            raw = json.load(f)
    except (OSError, json.JSONDecodeError) as exc:
        print(
            f"[modifiers] WARN: failed to load {path.name} ({type(exc).__name__}: "
            f"{exc}) — Preview mode will be empty.",
            file=sys.stderr,
        )
        return {}

    values = raw.get("values") or {}
    out: Dict[str, CardEntry] = {}
    skipped_no_family = 0
    skipped_no_pool = 0

    for key, entry in values.items():
        if not isinstance(entry, dict):
            continue
        if entry.get("type") != "gear":
            continue

        groups = entry.get("groups") or []
        if not isinstance(groups, list):
            groups = []

        family = _classify_family(groups)
        if family is None:
            skipped_no_family += 1
            continue

        attribute = entry.get("attribute")
        if not isinstance(attribute, str) or not attribute:
            # Stat cards without an attribute can't contribute — skip and log.
            print(
                f"[modifiers] WARN: skipping '{key}' — no attribute field.",
                file=sys.stderr,
            )
            continue

        pool = entry.get("pool") or []
        if not pool:
            skipped_no_pool += 1
            continue

        tier_list: List[CardTier] = []
        for p in pool:
            try:
                t = int(p["tier"])
                v = float(p["min"])
            except (KeyError, TypeError, ValueError):
                continue
            tier_list.append(CardTier(tier=t, value=v))
        if not tier_list:
            skipped_no_pool += 1
            continue
        tier_list.sort(key=lambda x: x.tier)

        name_block = entry.get("name") or {}
        if isinstance(name_block, dict):
            display_name = name_block.get("text") or key
        else:
            display_name = str(name_block)

        out[key] = CardEntry(
            key=key,
            name=display_name,
            attribute=attribute,
            attribute_short=_strip_attr_prefix(attribute),
            family=family,
            is_percent=_is_percent(attribute),
            tiers=tuple(tier_list),
        )

    if skipped_no_family or skipped_no_pool:
        # Single summary line — verbose per-card logging would be too noisy.
        print(
            f"[modifiers] loaded {len(out)} cards "
            f"(skipped {skipped_no_family} non-stat, {skipped_no_pool} no-pool).",
            file=sys.stderr,
        )

    return out


# ──────────────────────────────────────────────────────────────────────────────
# Queries
# ──────────────────────────────────────────────────────────────────────────────

@lru_cache(maxsize=None)
def cards_by_family(family: str) -> Tuple[CardEntry, ...]:
    """All cards in a family, sorted by display name. Empty tuple if family
    name is unknown or no cards loaded."""
    if family not in _FAMILIES:
        return ()
    cards = [c for c in load_modifiers().values() if c.family == family]
    cards.sort(key=lambda c: c.name.lower())
    return tuple(cards)


def get_card(key: str) -> Optional[CardEntry]:
    return load_modifiers().get(key)


def is_percent_attr(attribute: str) -> bool:
    return _is_percent(attribute)


def attribute_display(attribute: str) -> str:
    """Human label for an attribute id (works for full or short form)."""
    short = _strip_attr_prefix(attribute)
    return _humanize(short)


# ──────────────────────────────────────────────────────────────────────────────
# Convenience: families exposed for the UI
# ──────────────────────────────────────────────────────────────────────────────

FAMILIES: Tuple[str, ...] = _FAMILIES
