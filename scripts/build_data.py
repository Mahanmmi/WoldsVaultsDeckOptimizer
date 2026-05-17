"""Build-time data emitter for the static web app.

Reads ``config.yaml`` + ``decks/*.{yaml,json}`` + ``modifiers.json`` from the
repo root and produces three JSON blobs under ``web/public/``:

  * ``config.json``    — every mode fully resolved (defaults + mode overrides
                         deep-merged); the browser picks one at runtime.
  * ``decks.json``     — flat list of decks with slot positions, base core
                         slots (pre-deckmod), arcane count, and constraints.
                         Mode-independent geometry; ``core_slots`` is derived
                         in the browser as ``base_core_slots + deckmod``.
  * ``modifiers.json`` — verbatim copy of the game data file used by the
                         Preview panel. Browser does its own filter pass.

This script is deliberately self-contained — no imports from ``src/`` — so
it does not trigger ``src.config``'s sys.argv parsing or single-mode load
side effects. Run via ``uv run python scripts/build_data.py``.
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
from copy import deepcopy
from pathlib import Path
from typing import Any, Dict, List, Set, Tuple

import yaml


_REPO_ROOT   = Path(__file__).resolve().parent.parent
_CONFIG_PATH = _REPO_ROOT / "config.yaml"
_DECKS_DIR   = _REPO_ROOT / "decks"
_MODIFIERS   = _REPO_ROOT / "modifiers.json"
_DEFAULT_OUT = _REPO_ROOT / "web" / "public"


# ── config.yaml resolution ────────────────────────────────────────────────────

def _deep_merge(base: Dict[str, Any], override: Dict[str, Any]) -> Dict[str, Any]:
    """Recursively merge ``override`` into ``base`` (mutating ``base``)."""
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(base.get(key), dict):
            _deep_merge(base[key], value)
        else:
            base[key] = value
    return base


def _resolve_modes(raw: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    """Return ``{mode_name: fully_resolved_config}`` for every mode declared."""
    modes_block = raw.get("modes") or {}
    resolved: Dict[str, Dict[str, Any]] = {}
    for name, overrides in modes_block.items():
        cfg = deepcopy(raw)
        cfg.pop("modes", None)                # don't recurse into mode defs
        _deep_merge(cfg, overrides or {})
        resolved[name] = cfg
    return resolved


# ── deck loading (mirrors src.config logic but standalone) ────────────────────

def _parse_layout(layout: str) -> Tuple[List[List[int]], int]:
    """``layout`` grid → (regular slot positions, arcane count). Positions are
    ``[row, col]`` pairs (JSON-friendly). Anything not ``O``/``A`` is empty."""
    slots: List[List[int]] = []
    n_arcane = 0
    for r, line in enumerate(layout.rstrip("\n").splitlines()):
        for c, ch in enumerate(line):
            if   ch == "O": slots.append([r, c])
            elif ch == "A": n_arcane += 1
    return slots, n_arcane


def _yaml_key(path: Path) -> str:
    """Dedup key: filename stem with any ``NN_`` numeric prefix stripped."""
    return re.sub(r"^\d+_", "", path.stem)


def _load_yaml_decks(excluded: Set[str], seen_keys: Set[str]) -> List[Dict[str, Any]]:
    decks: List[Dict[str, Any]] = []
    for path in sorted(_DECKS_DIR.glob("*.yaml")):
        key = _yaml_key(path)
        if key in excluded:
            continue
        with path.open("r", encoding="utf-8") as fh:
            data = yaml.safe_load(fh) or {}
        if not data.get("enabled", True):
            continue
        slots, n_arcane = _parse_layout(data["layout"])
        if not slots:
            raise ValueError(f"Deck {path.name} has no slots — check the layout grid.")
        decks.append({
            "key":             key,
            "name":            str(data["name"]),
            "slots":           slots,
            "base_core_slots": int(data["core_slots"]),
            "n_arcane":        n_arcane,
            "min_regular":     int(data.get("min_regular", -1)),
            "max_greed":       int(data.get("max_greed",   -1)),
        })
        seen_keys.add(key)
    return decks


def _load_json_decks(excluded: Set[str], seen_keys: Set[str]) -> List[Dict[str, Any]]:
    decks: List[Dict[str, Any]] = []
    for path in sorted(_DECKS_DIR.glob("*.json")):
        with path.open("r", encoding="utf-8") as fh:
            data = json.load(fh) or {}
        for key, entry in (data.get("values") or {}).items():
            if key in excluded or key in seen_keys:
                continue
            sockets     = entry.get("socketCount") or {}
            max_sockets = sockets.get("max")
            if max_sockets is None:                # dungeon-only variant
                continue
            layouts = entry.get("layout") or []
            if not layouts:
                continue
            layout_str = "\n".join(layouts[0]["value"])
            slots, n_arcane = _parse_layout(layout_str)
            if not slots:
                continue
            decks.append({
                "key":             key,
                "name":            str(entry.get("name") or key),
                "slots":           slots,
                "base_core_slots": int(max_sockets),
                "n_arcane":        n_arcane,
                "min_regular":     -1,
                "max_greed":       -1,
            })
            seen_keys.add(key)
    return decks


def _load_decks(excluded: List[str]) -> List[Dict[str, Any]]:
    if not _DECKS_DIR.is_dir():
        raise FileNotFoundError(f"Deck directory not found: {_DECKS_DIR}")
    excluded_set = set(excluded or [])
    seen: Set[str] = set()
    decks = _load_yaml_decks(excluded_set, seen)
    decks += _load_json_decks(excluded_set, seen)
    if not decks:
        raise RuntimeError(f"No enabled decks found in {_DECKS_DIR}")
    return decks


# ── main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    ap = argparse.ArgumentParser(description="Emit static JSON for the web app.")
    ap.add_argument("--out", type=Path, default=_DEFAULT_OUT,
                    help=f"Output directory (default: {_DEFAULT_OUT})")
    args = ap.parse_args()
    out_dir: Path = args.out
    out_dir.mkdir(parents=True, exist_ok=True)

    with _CONFIG_PATH.open("r", encoding="utf-8") as f:
        raw_cfg = yaml.safe_load(f)

    modes = _resolve_modes(raw_cfg)
    if "wolds" not in modes:
        raise RuntimeError("config.yaml must declare a 'wolds' mode (the default).")

    # `excluded_decks` may differ per mode; use the union so any mode's exclude
    # list still hides those keys from the bundle (the browser can re-filter
    # per-mode if needed, but the optimizer never sees excluded decks anyway).
    all_excluded: List[str] = []
    for cfg in modes.values():
        all_excluded.extend(cfg.get("excluded_decks") or [])

    decks = _load_decks(all_excluded)

    # config.json: emit every mode resolved, plus a default-mode marker.
    config_blob: Dict[str, Any] = {
        "default_mode": "wolds",
        "modes":        modes,
    }
    (out_dir / "config.json").write_text(
        json.dumps(config_blob, indent=2, sort_keys=False) + "\n",
        encoding="utf-8",
    )

    # decks.json: list of geometry-only deck entries.
    (out_dir / "decks.json").write_text(
        json.dumps(decks, indent=2) + "\n",
        encoding="utf-8",
    )

    # modifiers.json: verbatim copy. Browser filters / classifies.
    if _MODIFIERS.exists():
        shutil.copyfile(_MODIFIERS, out_dir / "modifiers.json")
    else:
        print(f"[build_data] WARN: {_MODIFIERS} not found — Preview will be empty.")

    print(f"[build_data] wrote {len(modes)} mode(s), {len(decks)} deck(s) → {out_dir}")


if __name__ == "__main__":
    main()
