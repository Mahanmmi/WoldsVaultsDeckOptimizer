//! Inventory-based optimizer (color-aware, single-deck, single-run).
//!
//! Parallel sibling to ``run_sa_optimize`` in ``lib.rs``. Differences:
//!   * Cards are ``(CardType, Color)``; only inventory-present stacks may be placed.
//!   * Positional bonuses count only same-color cards in scan range.
//!   * COLOR core is per-color, only boosts matching-color cards.
//!   * Core multipliers may carry per-run overrides.
//!   * Empty slots after inventory exhaustion become transparent DEAD cards.
//!   * Restarts run in parallel via rayon.

use pyo3::prelude::*;
use rand::prelude::*;
use rand::rngs::SmallRng;
use rayon::prelude::*;
use std::collections::HashMap;

// ─────────────────────────────────────────────────────────────────────────────
// Card-type constants (must match the Python CardType.value strings)
// ─────────────────────────────────────────────────────────────────────────────

const ROW:             u8 = 0;
const COL:             u8 = 1;
const SURR:            u8 = 2;
const DIAG:            u8 = 3;
const DELUXE:          u8 = 4;
const TYPELESS:        u8 = 5;
const DIR_GREED_UP:    u8 = 6;
const DIR_GREED_DOWN:  u8 = 7;
const DIR_GREED_LEFT:  u8 = 8;
const DIR_GREED_RIGHT: u8 = 9;
const DIR_GREED_NE:    u8 = 10;
const DIR_GREED_NW:    u8 = 11;
const DIR_GREED_SE:    u8 = 12;
const DIR_GREED_SW:    u8 = 13;
const EVO_GREED:       u8 = 14;
const SURR_GREED:      u8 = 15;
const DEAD:            u8 = 16;

const N_TYPES: usize = 17;

// Colors
const RED:    u8 = 0;
const GREEN:  u8 = 1;
const BLUE:   u8 = 2;
const YELLOW: u8 = 3;
const N_COLORS: usize = 4;

// Sentinel — DEAD cards and "no color core" both use this.
const COLOR_NONE: u8 = 255;

// Cores
const CORE_PURE:        u8 = 0;
const CORE_EQUILIBRIUM: u8 = 1;
const CORE_STEADFAST:   u8 = 2;
const CORE_COLOR:       u8 = 3;
const CORE_FOIL:        u8 = 4;
const CORE_DELUXE:      u8 = 5;

// ─────────────────────────────────────────────────────────────────────────────
// String ↔ u8 conversions (Python boundary only — never on the hot path)
// ─────────────────────────────────────────────────────────────────────────────

fn card_type_from_str(s: &str) -> u8 {
    match s {
        "row"             => ROW,
        "col"             => COL,
        "surr"            => SURR,
        "diag"            => DIAG,
        "deluxe"          => DELUXE,
        "typeless"        => TYPELESS,
        "dir_greed_up"    => DIR_GREED_UP,
        "dir_greed_down"  => DIR_GREED_DOWN,
        "dir_greed_left"  => DIR_GREED_LEFT,
        "dir_greed_right" => DIR_GREED_RIGHT,
        "dir_greed_ne"    => DIR_GREED_NE,
        "dir_greed_nw"    => DIR_GREED_NW,
        "dir_greed_se"    => DIR_GREED_SE,
        "dir_greed_sw"    => DIR_GREED_SW,
        "evo_greed"       => EVO_GREED,
        "surr_greed"      => SURR_GREED,
        "dead"            => DEAD,
        other             => panic!("Unknown card type: {}", other),
    }
}

fn card_type_to_str(t: u8) -> &'static str {
    match t {
        ROW             => "row",
        COL             => "col",
        SURR            => "surr",
        DIAG            => "diag",
        DELUXE          => "deluxe",
        TYPELESS        => "typeless",
        DIR_GREED_UP    => "dir_greed_up",
        DIR_GREED_DOWN  => "dir_greed_down",
        DIR_GREED_LEFT  => "dir_greed_left",
        DIR_GREED_RIGHT => "dir_greed_right",
        DIR_GREED_NE    => "dir_greed_ne",
        DIR_GREED_NW    => "dir_greed_nw",
        DIR_GREED_SE    => "dir_greed_se",
        DIR_GREED_SW    => "dir_greed_sw",
        EVO_GREED       => "evo_greed",
        SURR_GREED      => "surr_greed",
        DEAD            => "dead",
        other           => panic!("Unknown card type u8: {}", other),
    }
}

fn color_from_str(s: &str) -> u8 {
    match s {
        "red"    => RED,
        "green"  => GREEN,
        "blue"   => BLUE,
        "yellow" => YELLOW,
        ""       => COLOR_NONE,
        other    => panic!("Unknown color: {}", other),
    }
}

fn color_to_str(c: u8) -> &'static str {
    match c {
        RED        => "red",
        GREEN      => "green",
        BLUE       => "blue",
        YELLOW     => "yellow",
        COLOR_NONE => "",
        other      => panic!("Unknown color u8: {}", other),
    }
}

fn core_from_str(s: &str) -> u8 {
    match s {
        "pure"        => CORE_PURE,
        "equilibrium" => CORE_EQUILIBRIUM,
        "steadfast"   => CORE_STEADFAST,
        "color"       => CORE_COLOR,
        "foil"        => CORE_FOIL,
        "deluxe_core" => CORE_DELUXE,
        other         => panic!("Unknown core type: {}", other),
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Category predicates
// ─────────────────────────────────────────────────────────────────────────────

#[inline(always)]
fn is_positional(t: u8) -> bool {
    matches!(t, ROW | COL | SURR | DIAG)
}

#[inline(always)]
fn is_greed(t: u8) -> bool {
    matches!(
        t,
        DIR_GREED_UP | DIR_GREED_DOWN | DIR_GREED_LEFT | DIR_GREED_RIGHT
        | DIR_GREED_NE | DIR_GREED_NW | DIR_GREED_SE | DIR_GREED_SW
        | EVO_GREED | SURR_GREED
    )
}

// ─────────────────────────────────────────────────────────────────────────────
// Deck geometry + sim config
// ─────────────────────────────────────────────────────────────────────────────

struct DeckGeom {
    n: usize,
    row_of: Vec<i32>,
    col_of: Vec<i32>,
    row_peers:  Vec<Vec<usize>>,
    col_peers:  Vec<Vec<usize>>,
    surr_peers: Vec<Vec<usize>>,
    diag_peers: Vec<Vec<usize>>,
    dir_up:    Vec<Option<usize>>,
    dir_down:  Vec<Option<usize>>,
    dir_left:  Vec<Option<usize>>,
    dir_right: Vec<Option<usize>>,
    dir_ne:    Vec<Option<usize>>,
    dir_nw:    Vec<Option<usize>>,
    dir_se:    Vec<Option<usize>>,
    dir_sw:    Vec<Option<usize>>,
    n_arcane:  usize,
    // Row/col offset machinery for dense per-color counters.
    row_min: i32,
    row_span: usize,
    col_min: i32,
    col_span: usize,
}

struct SimConfig {
    mult_dir_vert: f64,
    mult_dir_horiz: f64,
    mult_evo_greed: f64,
    mult_surr_greed: f64,
    mult_dir_diag_up: f64,
    mult_dir_diag_down: f64,
    mult_pure_base: f64,
    mult_pure_scale: f64,
    mult_equilibrium: f64,
    mult_foil: f64,
    mult_steadfast: f64,
    mult_color: f64,
    mult_deluxe_flat: f64,
    mult_deluxe_core_base: f64,
    mult_deluxe_core_scale: f64,
    greed_additive: bool,
    additive_cores: bool,
    is_shiny: bool,
}

#[derive(Clone, Copy)]
struct CoreData {
    core_type: u8,
    color:     u8,        // COLOR_NONE unless core_type == CORE_COLOR
    override_: f64,       // -1.0 == no override
}

impl CoreData {
    fn has_override(&self) -> bool { self.override_ >= 0.0 }
}

// Cores list packed for fast iteration. simulate() reads `list` and
// `color_core_color` / `foil_active` directly; per-card combination math is
// done inside the kernel.
struct CoresPack {
    list:             Vec<CoreData>,
    color_core_color: u8,    // COLOR_NONE if absent
    foil_active:      bool,
}

impl CoresPack {
    fn build(specs: &[CoreData], _cfg: &SimConfig) -> Self {
        let mut color_core_color = COLOR_NONE;
        let mut foil_active = false;
        for s in specs {
            match s.core_type {
                CORE_COLOR => { color_core_color = s.color; }
                CORE_FOIL  => { foil_active = true; }
                _ => {}
            }
        }
        Self {
            list: specs.to_vec(),
            color_core_color,
            foil_active,
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Scoring kernel — full-assignment evaluation (no delta yet)
// ─────────────────────────────────────────────────────────────────────────────

fn simulate(
    geom:       &DeckGeom,
    asgn:       &[(u8, u8)],
    cores:      &CoresPack,
    cfg:        &SimConfig,
    // Scratch buffers — caller-allocated for zero-allocation hot path.
    row_color:  &mut [u32],   // len = row_span * N_COLORS
    col_color:  &mut [u32],   // len = col_span * N_COLORS
    boost:      &mut [f64],   // len = n
) -> f64 {
    let n = geom.n;

    // Reset scratch.
    for v in row_color.iter_mut() { *v = 0; }
    for v in col_color.iter_mut() { *v = 0; }

    // Same-color counts per row / col (all non-DEAD colored cards count regardless of type).
    let mut n_positional = 0usize;
    let mut n_deluxe     = 0usize;
    let mut n_typeless   = 0usize;
    let mut n_greed      = 0usize;

    for i in 0..n {
        let (t, c) = asgn[i];
        if t == DEAD || c == COLOR_NONE { continue; }
        let r = (geom.row_of[i] - geom.row_min) as usize;
        let cc = (geom.col_of[i] - geom.col_min) as usize;
        row_color[r * N_COLORS + c as usize] += 1;
        col_color[cc * N_COLORS + c as usize] += 1;
        if is_positional(t)         { n_positional += 1; }
        else if t == DELUXE         { n_deluxe     += 1; }
        else if t == TYPELESS       { n_typeless   += 1; }
        else if is_greed(t)         { n_greed      += 1; }
    }

    // n_ns for PURE — matches src.simulate semantics.
    let n_ns = if cfg.is_shiny {
        n_greed
    } else if cores.foil_active {
        n_greed
    } else {
        n_positional + n_deluxe + n_typeless + n_greed
    };

    // All cores fold into a single per-card core_mult. Precompute the baseline
    // (cores that apply to every non-greed card regardless of color), plus the
    // color- and deluxe-core gated addends, so the per-card combination at
    // accumulation time is constant-time.
    let mut baseline_sum  = 0.0f64;
    let mut baseline_prod = 1.0f64;
    let mut color_addend  = 0.0f64;
    let mut color_factor_val = 1.0f64;
    let mut deluxe_addend = 0.0f64;
    let mut deluxe_factor = 1.0f64;
    let mut deluxe_present = false;
    let color_core_color = cores.color_core_color;

    for s in &cores.list {
        match s.core_type {
            CORE_PURE => {
                let scale = if s.has_override() { s.override_ } else { cfg.mult_pure_scale };
                let v = cfg.mult_pure_base + scale * (n_ns + geom.n_arcane) as f64;
                baseline_sum  += v - 1.0;
                baseline_prod *= v;
            }
            CORE_EQUILIBRIUM if cfg.is_shiny => {
                let v = if s.has_override() { s.override_ } else { cfg.mult_equilibrium };
                baseline_sum  += v - 1.0;
                baseline_prod *= v;
            }
            CORE_STEADFAST if cfg.is_shiny => {
                let v = if s.has_override() { s.override_ } else { cfg.mult_steadfast };
                baseline_sum  += v - 1.0;
                baseline_prod *= v;
            }
            CORE_FOIL => {
                let v = if s.has_override() { s.override_ } else { cfg.mult_foil };
                baseline_sum  += v - 1.0;
                baseline_prod *= v;
            }
            CORE_COLOR => {
                let v = if s.has_override() { s.override_ } else { cfg.mult_color };
                color_addend     = v - 1.0;
                color_factor_val = v;
            }
            CORE_DELUXE => {
                let scale = if s.has_override() { s.override_ } else { cfg.mult_deluxe_core_scale };
                let v = cfg.mult_deluxe_core_base + scale * n_deluxe as f64;
                deluxe_addend  = v - 1.0;
                deluxe_factor  = v;
                deluxe_present = true;
            }
            _ => {}
        }
    }

    // Per-card core multiplier — picks color/deluxe addends per applicability.
    let card_core_mult = |t: u8, c: u8| -> f64 {
        let color_applies  =
            color_core_color != COLOR_NONE && c != COLOR_NONE && c == color_core_color;
        let deluxe_applies = deluxe_present && t != DELUXE;
        if cfg.additive_cores {
            1.0 + baseline_sum
                + if color_applies  { color_addend  } else { 0.0 }
                + if deluxe_applies { deluxe_addend } else { 0.0 }
        } else {
            let mut m = baseline_prod;
            if color_applies  { m *= color_factor_val; }
            if deluxe_applies { m *= deluxe_factor; }
            m
        }
    };

    // Greed → boost pass (same semantics as classic optimizer).
    for v in boost[..n].iter_mut() { *v = 1.0; }

    let scorable = |i: usize| -> bool {
        let t = asgn[i].0;
        is_positional(t) || t == DELUXE || t == TYPELESS
    };

    let apply = |boost: &mut [f64], pos: usize, amount: f64| {
        if cfg.greed_additive { boost[pos] += amount - 1.0; }
        else                  { boost[pos] *= amount; }
    };

    for i in 0..n {
        let (t, _c) = asgn[i];
        if !is_greed(t) { continue; }
        match t {
            DIR_GREED_UP    => if let Some(j) = geom.dir_up[i]    { if scorable(j) { apply(boost, j, cfg.mult_dir_vert); } }
            DIR_GREED_DOWN  => if let Some(j) = geom.dir_down[i]  { if scorable(j) { apply(boost, j, cfg.mult_dir_vert); } }
            DIR_GREED_LEFT  => if let Some(j) = geom.dir_left[i]  { if scorable(j) { apply(boost, j, cfg.mult_dir_horiz); } }
            DIR_GREED_RIGHT => if let Some(j) = geom.dir_right[i] { if scorable(j) { apply(boost, j, cfg.mult_dir_horiz); } }
            DIR_GREED_NE    => if let Some(j) = geom.dir_ne[i]    { if scorable(j) { apply(boost, j, cfg.mult_dir_diag_up); } }
            DIR_GREED_NW    => if let Some(j) = geom.dir_nw[i]    { if scorable(j) { apply(boost, j, cfg.mult_dir_diag_up); } }
            DIR_GREED_SE    => if let Some(j) = geom.dir_se[i]    { if scorable(j) { apply(boost, j, cfg.mult_dir_diag_down); } }
            DIR_GREED_SW    => if let Some(j) = geom.dir_sw[i]    { if scorable(j) { apply(boost, j, cfg.mult_dir_diag_down); } }
            EVO_GREED => {
                if !cfg.is_shiny {
                    if let Some(j) = geom.dir_down[i] {
                        if is_positional(asgn[j].0) {
                            apply(boost, j, cfg.mult_evo_greed);
                        }
                    }
                }
            }
            SURR_GREED => {
                for &j in &geom.surr_peers[i] {
                    if scorable(j) { apply(boost, j, cfg.mult_surr_greed); }
                }
            }
            _ => {}
        }
    }

    // NDM accumulation — uses the per-card combined card_core_mult above.
    let mut ndm = 0.0f64;
    for i in 0..n {
        let (t, c) = asgn[i];
        if t == DEAD { continue; }
        let b = if cfg.greed_additive { boost[i].max(1.0) } else { boost[i] };

        if is_positional(t) {
            let cu = c as usize;
            let pos_val = if c == COLOR_NONE {
                0.0
            } else {
                match t {
                    ROW => {
                        let r = (geom.row_of[i] - geom.row_min) as usize;
                        row_color[r * N_COLORS + cu] as f64
                    }
                    COL => {
                        let cc = (geom.col_of[i] - geom.col_min) as usize;
                        col_color[cc * N_COLORS + cu] as f64
                    }
                    DIAG => {
                        let mut count = 1.0; // self
                        for &q in &geom.diag_peers[i] {
                            let (qt, qc) = asgn[q];
                            if qt != DEAD && qc == c { count += 1.0; }
                        }
                        count
                    }
                    SURR => {
                        let mut count = 0.0; // SURR excludes self
                        for &q in &geom.surr_peers[i] {
                            let (qt, qc) = asgn[q];
                            if qt != DEAD && qc == c { count += 1.0; }
                        }
                        count
                    }
                    _ => 0.0,
                }
            };
            ndm += pos_val * card_core_mult(t, c) * b;
        } else if t == DELUXE {
            ndm += cfg.mult_deluxe_flat * card_core_mult(t, c) * b;
        } else if t == TYPELESS {
            ndm += 1.0 * card_core_mult(t, c) * b;
        }
        // GREED / DEAD contribute nothing.
    }

    ndm
}

// ─────────────────────────────────────────────────────────────────────────────
// Initial fill — mirrors initial_fill() in src/inventory_optimize.py
// ─────────────────────────────────────────────────────────────────────────────

const FILL_ORDER: [u8; 6] = [SURR, ROW, COL, DIAG, DELUXE, TYPELESS];

fn slot_ranking(geom: &DeckGeom, t: u8) -> Vec<usize> {
    let peer_count = |i: usize| -> usize {
        match t {
            ROW  => geom.row_peers[i].len(),
            COL  => geom.col_peers[i].len(),
            SURR => geom.surr_peers[i].len(),
            DIAG => geom.diag_peers[i].len(),
            _    => 0,
        }
    };
    let mut idx: Vec<usize> = (0..geom.n).collect();
    idx.sort_by(|&a, &b| peer_count(b).cmp(&peer_count(a)));
    idx
}

fn initial_fill(
    geom:      &DeckGeom,
    inventory: &[u32],     // flat N_TYPES * N_COLORS counts
) -> Vec<(u8, u8)> {
    let mut asgn: Vec<(u8, u8)> = vec![(DEAD, COLOR_NONE); geom.n];
    let mut filled = vec![false; geom.n];
    let mut remaining: Vec<u32> = inventory.to_vec();

    for &t in &FILL_ORDER {
        let ranking = slot_ranking(geom, t);
        // Colors of this type sorted by remaining count, descending.
        let mut color_order: [u8; N_COLORS] = [RED, GREEN, BLUE, YELLOW];
        color_order.sort_by(|&a, &b| {
            remaining[t as usize * N_COLORS + b as usize]
                .cmp(&remaining[t as usize * N_COLORS + a as usize])
        });

        let mut cursor = 0usize;
        for &c in &color_order {
            let idx = t as usize * N_COLORS + c as usize;
            while remaining[idx] > 0 {
                // Find next open slot in the ranking.
                while cursor < ranking.len() && filled[ranking[cursor]] { cursor += 1; }
                if cursor >= ranking.len() { break; }
                let slot = ranking[cursor];
                asgn[slot] = (t, c);
                filled[slot] = true;
                remaining[idx] -= 1;
                cursor += 1;
            }
            if cursor >= ranking.len() { break; }
        }
    }

    asgn
}

// ─────────────────────────────────────────────────────────────────────────────
// SA — one restart
// ─────────────────────────────────────────────────────────────────────────────

fn sa_one_restart(
    geom:       &DeckGeom,
    cores:      &CoresPack,
    cfg:        &SimConfig,
    inventory:  &[u32],          // N_TYPES * N_COLORS
    options:    &[(u8, u8)],     // stacks the user owns + (DEAD, COLOR_NONE) at end
    n_iter:     usize,
    t_start:    f64,
    t_end:      f64,
    seed:       u64,
) -> (Vec<(u8, u8)>, f64) {
    let mut rng = SmallRng::seed_from_u64(seed);
    let mut asgn = initial_fill(geom, inventory);

    // Placed counters (flat N_TYPES * N_COLORS).
    let mut placed = vec![0u32; N_TYPES * N_COLORS];
    for &(t, c) in &asgn {
        if t == DEAD || c == COLOR_NONE { continue; }
        placed[t as usize * N_COLORS + c as usize] += 1;
    }

    // Scratch buffers reused across simulate() calls.
    let mut row_color = vec![0u32; geom.row_span * N_COLORS];
    let mut col_color = vec![0u32; geom.col_span * N_COLORS];
    let mut boost     = vec![1.0f64; geom.n];

    let mut score = simulate(geom, &asgn, cores, cfg, &mut row_color, &mut col_color, &mut boost);
    let mut best_score = score;
    let mut best_asgn  = asgn.clone();

    let log_cool = (t_end / t_start).ln();
    let n = geom.n;

    for i in 0..n_iter {
        let temperature = t_start * (log_cool * i as f64 / n_iter as f64).exp();

        if n < 2 || rng.gen::<f64>() < 0.80 {
            // ── Replace move ─────────────────────────────────────────────────
            let p   = rng.gen_range(0..n);
            let old = asgn[p];
            let new = options[rng.gen_range(0..options.len())];
            if new == old { continue; }

            // Inventory feasibility for `new`.
            if !(new.0 == DEAD || new.1 == COLOR_NONE) {
                let idx = new.0 as usize * N_COLORS + new.1 as usize;
                if placed[idx] >= inventory[idx] { continue; }
            }

            // Apply
            if old.0 != DEAD && old.1 != COLOR_NONE {
                placed[old.0 as usize * N_COLORS + old.1 as usize] -= 1;
            }
            if new.0 != DEAD && new.1 != COLOR_NONE {
                placed[new.0 as usize * N_COLORS + new.1 as usize] += 1;
            }
            asgn[p] = new;

            let new_score = simulate(geom, &asgn, cores, cfg, &mut row_color, &mut col_color, &mut boost);
            let delta = new_score - score;
            if delta >= 0.0 || rng.gen::<f64>() < (delta / temperature).exp() {
                score = new_score;
                if score > best_score { best_score = score; best_asgn = asgn.clone(); }
            } else {
                // Revert
                if new.0 != DEAD && new.1 != COLOR_NONE {
                    placed[new.0 as usize * N_COLORS + new.1 as usize] -= 1;
                }
                if old.0 != DEAD && old.1 != COLOR_NONE {
                    placed[old.0 as usize * N_COLORS + old.1 as usize] += 1;
                }
                asgn[p] = old;
            }
        } else {
            // ── Pair-swap move ───────────────────────────────────────────────
            let p1 = rng.gen_range(0..n);
            let mut p2 = rng.gen_range(0..n);
            while p2 == p1 { p2 = rng.gen_range(0..n); }
            if asgn[p1] == asgn[p2] { continue; }

            asgn.swap(p1, p2);
            let new_score = simulate(geom, &asgn, cores, cfg, &mut row_color, &mut col_color, &mut boost);
            let delta = new_score - score;
            if delta >= 0.0 || rng.gen::<f64>() < (delta / temperature).exp() {
                score = new_score;
                if score > best_score { best_score = score; best_asgn = asgn.clone(); }
            } else {
                asgn.swap(p1, p2);
            }
        }
    }

    (best_asgn, best_score)
}

// ─────────────────────────────────────────────────────────────────────────────
// PyO3 entry point
// ─────────────────────────────────────────────────────────────────────────────

#[pyfunction]
#[pyo3(signature = (
    slots, row_peers, col_peers, surr_peers, diag_peers,
    n_arcane, is_shiny, inventory, cores,
    n_iter, restarts,
    mult_dir_vert, mult_dir_horiz, mult_evo_greed, mult_surr_greed,
    mult_dir_diag_up, mult_dir_diag_down,
    mult_pure_base, mult_pure_scale,
    mult_equilibrium, mult_foil, mult_steadfast, mult_color,
    mult_deluxe_flat, mult_deluxe_core_base, mult_deluxe_core_scale,
    greed_additive, additive_cores,
))]
pub fn run_sa_inventory(
    slots:                  Vec<(i32, i32)>,
    row_peers:              Vec<Vec<usize>>,
    col_peers:              Vec<Vec<usize>>,
    surr_peers:             Vec<Vec<usize>>,
    diag_peers:             Vec<Vec<usize>>,
    n_arcane:               usize,
    is_shiny:               bool,
    inventory:              Vec<(String, String, u32)>,  // (type, color, count)
    cores:                  Vec<(String, String, f64)>,  // (type, color, override<0 = none)
    n_iter:                 usize,
    restarts:               usize,
    mult_dir_vert:          f64,
    mult_dir_horiz:         f64,
    mult_evo_greed:         f64,
    mult_surr_greed:        f64,
    mult_dir_diag_up:       f64,
    mult_dir_diag_down:     f64,
    mult_pure_base:         f64,
    mult_pure_scale:        f64,
    mult_equilibrium:       f64,
    mult_foil:              f64,
    mult_steadfast:         f64,
    mult_color:             f64,
    mult_deluxe_flat:       f64,
    mult_deluxe_core_base:  f64,
    mult_deluxe_core_scale: f64,
    greed_additive:         bool,
    additive_cores:         bool,
) -> PyResult<(Vec<(String, String)>, f64)> {
    let n = slots.len();

    let slot_map: HashMap<(i32, i32), usize> =
        slots.iter().enumerate().map(|(i, &p)| (p, i)).collect();
    let row_of: Vec<i32> = slots.iter().map(|&(r, _)| r).collect();
    let col_of: Vec<i32> = slots.iter().map(|&(_, c)| c).collect();

    let dir = |i: usize, dr: i32, dc: i32| -> Option<usize> {
        slot_map.get(&(slots[i].0 + dr, slots[i].1 + dc)).copied()
    };
    let dir_up:    Vec<Option<usize>> = (0..n).map(|i| dir(i, -1,  0)).collect();
    let dir_down:  Vec<Option<usize>> = (0..n).map(|i| dir(i,  1,  0)).collect();
    let dir_left:  Vec<Option<usize>> = (0..n).map(|i| dir(i,  0, -1)).collect();
    let dir_right: Vec<Option<usize>> = (0..n).map(|i| dir(i,  0,  1)).collect();
    let dir_ne:    Vec<Option<usize>> = (0..n).map(|i| dir(i, -1,  1)).collect();
    let dir_nw:    Vec<Option<usize>> = (0..n).map(|i| dir(i, -1, -1)).collect();
    let dir_se:    Vec<Option<usize>> = (0..n).map(|i| dir(i,  1,  1)).collect();
    let dir_sw:    Vec<Option<usize>> = (0..n).map(|i| dir(i,  1, -1)).collect();

    let row_min = *row_of.iter().min().unwrap_or(&0);
    let row_max = *row_of.iter().max().unwrap_or(&0);
    let col_min = *col_of.iter().min().unwrap_or(&0);
    let col_max = *col_of.iter().max().unwrap_or(&0);

    let geom = DeckGeom {
        n,
        row_of,
        col_of,
        row_peers,
        col_peers,
        surr_peers,
        diag_peers,
        dir_up, dir_down, dir_left, dir_right,
        dir_ne, dir_nw, dir_se, dir_sw,
        n_arcane,
        row_min,
        row_span: (row_max - row_min + 1) as usize,
        col_min,
        col_span: (col_max - col_min + 1) as usize,
    };

    let cfg = SimConfig {
        mult_dir_vert, mult_dir_horiz, mult_evo_greed, mult_surr_greed,
        mult_dir_diag_up, mult_dir_diag_down,
        mult_pure_base, mult_pure_scale,
        mult_equilibrium, mult_foil, mult_steadfast, mult_color,
        mult_deluxe_flat, mult_deluxe_core_base, mult_deluxe_core_scale,
        greed_additive, additive_cores, is_shiny,
    };

    // Pack cores
    let core_specs: Vec<CoreData> = cores
        .iter()
        .map(|(t, c, o)| CoreData {
            core_type: core_from_str(t),
            color:     color_from_str(c),
            override_: *o,
        })
        .collect();
    let cores_pack = CoresPack::build(&core_specs, &cfg);

    // Pack inventory into flat array
    let mut inv_flat = vec![0u32; N_TYPES * N_COLORS];
    for (t_s, c_s, n) in &inventory {
        let t = card_type_from_str(t_s) as usize;
        let c = color_from_str(c_s);
        if c == COLOR_NONE { continue; }   // skip malformed entries
        inv_flat[t * N_COLORS + c as usize] += *n;
    }

    // Build proposal options list: every owned (type, color) + DEAD sentinel.
    let mut options: Vec<(u8, u8)> = Vec::with_capacity(inventory.len() + 1);
    for t_idx in 0..N_TYPES {
        for c_idx in 0..N_COLORS {
            if inv_flat[t_idx * N_COLORS + c_idx] > 0 {
                options.push((t_idx as u8, c_idx as u8));
            }
        }
    }
    options.push((DEAD, COLOR_NONE));

    // Restarts in parallel via rayon. Seeds: hash of (i, n_iter) so runs are
    // deterministic per restart but diverge across restarts.
    let restarts = restarts.max(1);
    let results: Vec<(Vec<(u8, u8)>, f64)> = (0..restarts)
        .into_par_iter()
        .map(|i| {
            // Use thread-local entropy XOR'd with restart index for a robust seed.
            let mut seed_rng = SmallRng::from_entropy();
            let seed: u64 = seed_rng.gen::<u64>() ^ (i as u64).wrapping_mul(0x9E37_79B9_7F4A_7C15);
            sa_one_restart(&geom, &cores_pack, &cfg, &inv_flat, &options, n_iter, 100.0, 0.5, seed)
        })
        .collect();

    // Pick best result.
    let (best_asgn, best_score) = results
        .into_iter()
        .max_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal))
        .expect("at least one restart");

    let result_strs: Vec<(String, String)> = best_asgn
        .iter()
        .map(|&(t, c)| (card_type_to_str(t).to_owned(), color_to_str(c).to_owned()))
        .collect();

    Ok((result_strs, best_score))
}
