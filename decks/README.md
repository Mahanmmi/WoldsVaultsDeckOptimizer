# Decks

Each YAML file in this directory describes one deck the optimizer will run.
Files are loaded in lexicographic order — that's why existing files are
prefixed with `01_`, `02_`, … (the prefix is purely cosmetic; only the
`name` field appears in reports).

To add a new deck, drop a new `*.yaml` file here. Nothing else needs to
change — `src/config.py` picks it up automatically on the next run.

## Schema

```yaml
name: My Deck             # required, shown in terminal output and the spreadsheet
enabled: true             # optional, default true. Set false to skip without deleting.

core_slots: 2             # required. Base core slots; `deckmod` from config.yaml is
                          # added at load time (default deckmod=1 for Wold's mode).

n_arcane:    0            # optional, default 0. Arcane cards in the deck — they don't
                          # take a slot but contribute to PURE-core scaling.

min_regular: -1           # optional, default -1 (no minimum). Minimum number of
                          # regular cards the SA solver must keep.
max_greed:   -1           # optional, default -1 (no maximum). Maximum greed cards.
                          # Both are ignored when `testing.full_panel: true` in
                          # config.yaml — the panel configs override them.

layout: |                 # required. Visual grid; each line is a row.
  .XXXXXXX.               #   X / x / # → an active slot
  .XXXXXXX.               #   anything else (., space, etc.) → empty
  XXXXXXXXX
```

## Layout rules

- The grid's absolute row/column indices don't matter — only the relative
  shape is used to compute row/col/surr/diag peers.
- Use `.` (or any non-slot character) to leave a hole; this is what makes
  shapes like the Anvil or Mystery decks possible.
- Trailing blank lines are stripped; rows can be different widths (the
  loader walks character-by-character).
- An empty layout (no `X`/`x`/`#`) raises an error at startup, so a typo
  fails fast instead of producing a silently-empty deck.

## Quick examples

A square 5×5 with the center hollowed out (`11_large.yaml`):

```yaml
name: Large Deck
enabled: true
core_slots: 1
layout: |
  XXXXX
  XX.XX
  XXXXX
```

A pyramid (`02_anvil.yaml`):

```yaml
name: Anvil Deck
enabled: true
core_slots: 3
layout: |
  XXXXXXXXX
  ..XXXXX..
  ...XXX...
  .XXXXXXX.
```

## Tips

- **Disable instead of deleting** while iterating: set `enabled: false`
  to keep the file around without including it in the run.
- **Constraint vs. panel**: per-deck `min_regular` / `max_greed` only
  matter when `testing.full_panel` is `false` in
  [`config.yaml`](../config.yaml). With the full panel on, every deck is
  run through the same `panel_configs`.
- **Core slots**: pick the in-game base value; don't pre-add the
  expertise slot, the loader applies `deckmod` for you.
