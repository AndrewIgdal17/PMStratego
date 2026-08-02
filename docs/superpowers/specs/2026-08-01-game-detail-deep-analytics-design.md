# Game Detail Page & Deep Analytics — Design Spec

## Overview

A game detail page (`game-detail.html?id=<game_id>`) showing the full narrative of a single game, plus new career aggregate stats on the profile (board geography, tempo, information warfare). Every metric tells a story — both about individual games and about a player's identity across their career.

---

## Per-Game Story (game detail page)

### Narrative Highlights

Each game produces a set of story beats, displayed as a highlight reel at the top of the detail page:

| Insight | What it tells | Computation |
|---|---|---|
| **Turning point** | The combat where material advantage permanently flipped | Last index where material curve crosses zero and stays same sign |
| **MVP piece** | The single piece with the most kills | `piece_id` with max kills (from piece careers) |
| **Most dangerous enemy piece** | The enemy piece that killed the most of yours | Enemy `piece_id` with max kills against you |
| **Kill chain** | Longest streak of consecutive combat wins | Per-slot consecutive wins without opponent getting a kill |
| **First casualty** | Which rank died first (and what killed it) | First combat with a death; records rank, slot, killer rank |
| **Flag proximity** | How close the enemy got to your Flag | Min manhattan distance from any enemy move `to_*` to Flag's inferred position |
| **Think times** | Average and max think time per player | `created_at` differences between consecutive moves (cap at 10 min, ignore overnight) |
| **Territory control timeline** | Invasion waves over time | Sampled every 20 moves: count of each player's pieces in enemy half |

### Piece Careers (per-game)

Every piece gets a career record for that game:

| Field | What it is |
|---|---|
| `rank` | What piece it is |
| `moves_made` | Total moves by this piece |
| `kills` | Combats won (as attacker or defender) |
| `distance` | Cumulative manhattan distance traveled |
| `first_move` | Move number it first acted |
| `death_move` | Move number it died (null if survived) |
| `alive` | Did it survive to game end? |

Displayed as a table of "notable pieces" (sorted by kills, filtered to pieces with kills > 0 or moves ≥ 10).

### Charts

- **Material curve** (already built) — rank-value differential per combat, with turning point marker
- **Information Edge Curve** (new) — `|enemy_pieces_I_know| - |my_pieces_they_know|` per combat
- **Territory control** — dual-line chart showing each player's pieces in enemy half over time

---

## Per-Game Phase-Binned Stats (Cross-Cutting Principle)

Many per-game metrics are more informative when broken into game phases. A 60% Reveal Efficiency in Q1 (true fog) means something different from 90% in Q4 (mopping up).

### Three Phase Lenses

#### Lens 1: Phase by Material Captured (Player-Relative)

Bin combats into quartiles of total captures by that player in that game:
- **Q1 (0–25%):** Opening engagements, maximum uncertainty
- **Q2 (25–50%):** Developing, building information
- **Q3 (50–75%):** Exploiting established knowledge
- **Q4 (75–100%):** Closing out / endgame

Normalizes across game lengths. A 30-combat game and an 80-combat game both produce 4 comparable phases.

#### Lens 2: Phase by Material Differential State

Bin each event by the player's material position when it happened:
- **Behind** (diff < -5)
- **Even** (-5 to +5)
- **Ahead** (+5 to +15)
- **Dominant** (+15+)

Answers: "How do they perform when losing vs. ahead?"

#### Lens 3: Phase by Information State

Bin by how much of the enemy army has been revealed to you:
- **Deep Fog** (<5 enemy pieces known)
- **Partially Mapped** (5–15 known)
- **Mostly Known** (15+ known)

Uniquely Stratego. Answers: "How does this player perform in true uncertainty?"

### Per-Game Storage

In `game_summaries.story.phase_stats`:
```json
{
  "by_capture_quarter": {
    "q1": { "reveal_efficiency": 0.4, "trade_eff": -0.5, "attacks": 8, "attack_wins": 3 },
    "q2": { ... },
    "q3": { ... },
    "q4": { ... }
  },
  "by_material_state": {
    "behind": { "attacks": 12, "attack_wins": 5, "reveal_eff": 0.5 },
    "even": { ... },
    "ahead": { ... },
    "dominant": { ... }
  },
  "by_info_state": {
    "deep_fog": { "attacks": 10, "attack_wins": 4 },
    "partial": { ... },
    "known": { ... }
  }
}
```

### Career Aggregation

JSONB column `phase_career` in `player_stats` accumulates per-lens, per-phase sums across games. Enables queries like "my Reveal Efficiency when behind" across all career games.

### Which Metrics Get Phase-Binned

Per-combat/per-attack metrics:
- Reveal Efficiency, Trade Efficiency, Attack Win Rate, Unknown Pressure, Avenge Rate, Memory Score

NOT phase-binned (inherently whole-game):
- Stillness Ratio, Reveal Half-Life, Motion Entropy, Flank Preference

---

## Career Aggregate Stats (profile page)

### Board Geography

| Metric | What it reveals | Computation |
|---|---|---|
| **Flank Preference** | Left-side vs right-side player | `flank_left_moves / (left + right)` — moves on cols 0–4 vs 5–9 |
| **Lake Corridor Usage** | % of moves through center gap between lakes | Moves where `to_col` ∈ {4, 5} / total moves |
| **Defense Depth** | Avg distance from back row when initiating combat | `|to_row - home_row|` for attacks; career mean |
| **Invasion Route Consistency** | How predictable their entry into enemy territory | Entropy of first-entry column across games (low = predictable) |

### Tempo & Rhythm

| Metric | What it reveals | Computation |
|---|---|---|
| **Combat Cadence** | Avg moves between consecutive attacks | Sum of gaps between attack move_numbers / count |
| **Opening Speed** | Avg move number of first attack | First attack `move_number` per game; career mean |
| **Endgame Acceleration** | % of attacks in final 25% of game | Attacks where `move_number > 0.75 * total_moves` / total attacks |
| **Think Time Profile** | Avg/max time per move (if timestamps available) | `created_at` differences; career avg |

### Information Warfare (on profile — from the IW spec)

| Metric | What it reveals |
|---|---|
| **Stillness Ratio** | % of movable pieces never moved |
| **Info Exchange Rate** | Enemy reveals per own reveal |
| **Deduction Latency** | Moves to send counter after learning rank |
| **Bluff Bait Rate** | % of weak-piece bluffs that get attacked |
| **Reveal Half-Life** | Game progress when half army identified |
| **Ambush Yield** | Win rate when still pieces are attacked |

Plus deeper cuts: Motion Entropy, Controlled Exposure, Info Churn, Scout Sacrifice ROI, Probe Resistance, etc.

---

## UI Placement

### Game Detail Page (`game-detail.html?id=<game_id>`)

Layout (top to bottom):
1. **Header:** Game result, players, move count, date
2. **Story highlights:** Icon + one-line narrative per beat (MVP, kill chain, turning point, flag proximity, think times)
3. **Material curve:** Full-width SVG with turning point marker + y-axis labels
4. **Information Edge Curve:** Same-width SVG below material curve (fog advantage over time)
5. **Phase breakdown:** Compact table or sparklines showing key metrics by capture quartile
6. **Piece careers:** Table of notable pieces (kills, moves, distance, survived)
7. **Territory control:** Dual-line SVG chart

### Profile Page (new sections)

After existing "Combat Economy" section:
- **Board Geography** (3 stat items with tooltips)
- **Tempo & Rhythm** (3–4 stat items)
- **Information Warfare** (Big 6 from IW spec)
- **Memory & Deduction** (from memory spec)

Each stat shows full-game career aggregate as the headline number. Phase-binned breakdowns available as expandable detail (exact UI TBD).

### Linking

Game history table rows link to `game-detail.html?id=<game_id>`. Material curve sparkline in history table acts as preview + link.

---

## Data Architecture

### game_summaries table (extended)

```sql
-- Already exists: game_id PK, material_curve_p1/p2 int[]
-- Add:
story jsonb not null default '{}'  -- all narrative data + phase stats + info edge curve
```

### player_stats (new columns)

```sql
-- Board Geography
flank_left_moves integer, flank_right_moves integer
lake_corridor_moves integer
defense_depth_sum numeric, defense_depth_count integer

-- Tempo & Rhythm
combat_cadence_sum integer, combat_cadence_count integer
opening_speed_sum integer, opening_speed_games integer
endgame_accel_early integer, endgame_accel_late integer

-- Information Warfare (see IW spec for full list)

-- Phase-binned career accumulator
phase_career jsonb not null default '{}'
```

---

## Combat Event Taxonomy

Not all piece eliminations are the same. The system distinguishes:

| Event | Condition | Meaning |
|---|---|---|
| **Kill** | ATTACKER_WINS or DEFENDER_WINS, defender is not Bomb | A piece outranks another and eliminates it. One side wins cleanly. |
| **Trade** | TIE outcome (same rank, both die) | Mutual destruction. Neither side "won." |
| **Defuse** | ATTACKER_WINS where defender = Bomb | Obstacle removal by Miner. Not combat — it's engineering. |
| **Bomb kill** | DEFENDER_WINS where defender = Bomb | A piece walked into a Bomb. Passive defense, not an active "kill" by a piece. |

This affects:
- **Piece careers:** `kills` counts only clean kills (not trades, not defuses). `trades` and `defuses` tracked separately.
- **Signature weapons / kills_by_rank:** Only clean kills.
- **MVP calculation:** Based on clean kills.
- **Phase-bin `attack_wins`:** Only clean attack victories.
- **Captures (for quartile denominators):** All enemy eliminations (kills + opponent's trade deaths + defuses) — any event where an enemy piece dies counts toward quartile progress.

---

## Design Decisions

1. **Phase-binning is additive** — full-game aggregates remain as headline numbers; phase bins are deeper layer
2. **Phase quartiles use player-relative captures** — not absolute move count — for cross-game comparability
3. **Story data is write-once** — computed at `compute-stats` time, immutable after
4. **Game detail page is public** — anyone can view any game (same as profiles)
5. **Information Edge Curve reuses the reveal-set replay** — same pass that powers IW metrics
6. **Think times may be null** — async games over days will have meaningless timestamps; cap at 10 min gaps, skip overnight
7. **Piece careers include all 80 pieces** but UI only shows "notable" ones (kills > 0 or moves ≥ 10)
8. **Kill ≠ Trade ≠ Defuse** — see Combat Event Taxonomy above
