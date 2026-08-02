# Information Warfare & Memory System — Design Spec

## Overview

A comprehensive fog-of-war analytics system that measures how players **use, hide, and remember information** in Stratego. The goal: any player can read an opponent's profile before a game and understand their **information personality** — are they an obfuscator, a strategic revealer, a patient trap-setter, a snap converter? And critically: how good is their memory?

This is Stratego's unique competitive dimension. No other strategy game has fog-of-war that resets, where memory is a measurable skill, and where stillness/movement patterns reveal nothing about piece identity.

---

## Part 1: Information Warfare Metrics

### The Big 6 (highest-signal, opponent-readable)

| Metric | What it tells your opponent | Computation |
|---|---|---|
| **Stillness Ratio** | "X% of their movable pieces never move — is immobile=bomb a safe bet, or a trap?" | `never_moved_movable_pieces / total_movable_pieces` (exclude Bombs, Flag from denominator) |
| **Info Exchange Rate** | "For every piece of mine they reveal, how many of theirs do I learn? Are they efficient intel buyers?" | `unique_enemy_pieces_revealed_to_me / unique_my_pieces_revealed_to_them` per game; career mean |
| **Deduction Latency** | "Once they learn what my piece is, how fast do they send the counter? Am I safe for 5 moves or 1?" | Median moves between learning enemy rank → attacking that piece with correct counter (Miner→Bomb, Spy→Marshal, lower→higher) |
| **Bluff Bait Rate** | "When they push weak pieces deep, do opponents actually bite? Are their bluffs working?" | When a rank≥7 piece enters enemy half unrevealed, % attacked by enemy within 5 moves |
| **Reveal Half-Life** | "How far into the game before half their army is identified? How long do they stay foggy?" | Median of `first_reveal_move / game_length` across movable pieces; career avg |
| **Ambush Yield** | "When enemies attack their still pieces, how often does the still piece win? Are the traps real?" | DEFENDER_WINS / total attacks against my pieces with 0 prior moves |

### Information Edge Curve (per-game chart)

At every combat event, plot `|enemy_pieces_I_know| - |my_pieces_they_know|`. This is the **fog-of-war equivalent of the material curve** — shows who controls information. Stored in `game_summaries.story` as an integer array, rendered alongside the material curve on the game detail page.

### Deeper Cuts

| Metric | What it reveals | Computation |
|---|---|---|
| **Motion Entropy** | How evenly moves are spread across pieces. High = noise/many decoys; low = a few workhorses (fingerprintable) | Shannon entropy of move-share per piece: `H = -Σ p_i log(p_i)` normalized by `log(n_moved)` |
| **Controlled Exposure Ratio** | % of attacks made by already-revealed pieces (good deniers reuse "burned" identities) | Attacks where `attacker_piece_id` already in opponent's knowledge set / total attacks |
| **Information Churn** | After reveal, do they relocate + shuffle neighbors? Destroys spatial memory | Within W moves after piece revealed and survives: non-combat moves by that piece + adjacent pieces / opportunities |
| **Opening Lane Consistency** | Entropy of invasion routes across games — low = predictable, high = unpredictable | Map first K moves' `to_col` into {L:0-3, C:4-5, R:6-9}; compute distribution entropy across games |
| **Scout Sacrifice ROI** | After sacrificing a Scout to learn something, do they follow up and kill that piece? | Scout loses → reveals enemy rank; within 10 moves, did player kill that `defender_piece_id`? Rate |
| **Probe Resistance** | When enemy probes your unknown pieces, how often do they hit something worthless? | Enemy attacks my unrevealed pieces; % where my rank ≤ 4 value (low-value hit) |
| **Belief Update Aggression** | After first major reveal (enemy rank ≤ 3), do they accelerate attacks or freeze? | Compare `attacks/moves` ratio before vs after first high-rank reveal; positive delta = bloodhound |
| **Fast Conversion Rate** | % of identified enemy pieces counter-attacked within 8 moves | Among pieces where correct counter exists and is alive: attacked with counter within 8 moves / total |
| **Fake Bomb Density** | Of never-moved movable pieces, how many sit in strategic positions (front rows, lake-adjacent)? | Never-moved movable pieces in rows 4-5 or lake-adjacent / total never-moved movable |
| **Stillness Duration** | Avg move number when still movable pieces first act (or first die) | Per piece: first `move_number` as mover or defender; career mean |
| **Workhorse Concentration** | What % of non-combat moves come from the single most-active piece? | `max(moves_per_piece_id) / total_non_attack_moves` |
| **Bluff Survival** | Of bluff events (weak piece in enemy half), % that never enter combat at all (pure decoy success) | `never_combat ∩ bluff_events / bluff_events` |
| **Silent Majority** | % of army unrevealed at game end | `unrevealed_at_end / 40` (career avg, wins vs losses separately) |
| **High-Value Opacity** | Avg move number when Marshal/General/Colonel first enter combat | Per high-rank piece, first combat involvement; career mean |
| **Revelation Debt** | Net rank-value of your alive revealed pieces (info liability on the board) | Sum `RANK_VALUE[rank]` for pieces you've revealed that are still alive at any point; track max per game |

---

## Part 2: Memory Measurement System

### Architecture: Knowledge Ledger + Behavioral Tests

Maintain a "perfect memory oracle" per player — a ledger of everything they've learned via combat. Then score their **actual behavior** against what perfect memory would dictate.

### Knowledge Ledger (per game, per player)

```typescript
type KnowledgeEntry = {
  piece_id: string;
  rank: string;
  revealed_at: number; // move_number first learned
  last_known_row: number;
  last_known_col: number;
  last_update_move: number;
  moved_since_reveal: boolean;
  alive: boolean;
};
```

**Knowledge gained when:**
1. I attack enemy → learn `defender_rank` + position
2. Enemy attacks me → learn `attacker_rank` (their piece_id) + position
3. Enemy piece moves multiple squares → inferred Scout (rank 9)

**Knowledge updated (not forgotten):**
- When enemy moves a ledger piece → update position, set `moved_since_reveal = true`
- On death → `alive = false`

The ledger is PERMANENT for measurement. We never apply decay. Behavioral errors against the ledger = evidence of forgetting.

### Memory Tests (Atomic Scoring Unit)

A memory test fires when the player attacks a piece **already in their knowledge ledger**:

| Test ID | Fires when... | HIT (remembered) | MISS (forgot) |
|---|---|---|---|
| `bomb_correct` | Attack a known Bomb | Attacker is Miner | Attacker is NOT Miner |
| `known_win` | Attack a known rank R | Attacker beats R | Attacker loses to R |
| `spy_marshal` | Attack a known Marshal | Attacker is Spy or Marshal/General | Attacker is anything else |
| `track_strike` | Attack piece that moved since reveal | Correct piece_id at new location | Wrong piece on old square |
| `threat_avoidance` | Legal option to avoid known lethal piece | Takes alternative | Walks into it |

**Exclusions:**
- Ties (intentional trades) — not scored
- First contact (reveals, not memory) — handled by existing Reveal Efficiency
- Forced moves (only legal option) — excluded

### Memory Score (Career Stat)

```
Memory Score = weighted_hits / (weighted_hits + weighted_misses)
```

**Weight** = `RANK_VALUE[my_attacking_piece]` — losing a Marshal to a known Bomb is a worse forget than losing a Scout.

**Display:** percentage under "Fog & Intelligence" section.
**Tooltip:** "When you re-engage a piece you previously saw in combat, how often do you play as if you remember what it is? Fog resets after every fight — this measures whether your brain kept the note."

**Minimum samples:** Show "—" until ≥5 career tests.

### Memory Half-Life (The Killer Scouting Stat)

Group tests by **age** (moves since reveal):

| Age bucket | 0–5 | 6–15 | 16–30 | 31+ |
|---|---|---|---|---|
| Expected miss rate | low | medium | higher | highest |

**Half-life** = smallest age bucket midpoint where miss rate ≥ 50%.

Scouting interpretation: *"This player forgets Bombs after ~22 moves — if you survive their initial counter-response window, they lose track."*

### Two Memory Dimensions

| Dimension | What it measures | Tests |
|---|---|---|
| **Identity Memory** | "I know piece X IS a Bomb" | bomb_correct, known_win, spy_marshal |
| **Position Memory** | "I know WHERE piece X is NOW" | track_strike (piece moved after reveal) |

Bombs never move → Bomb tests are **pure identity memory** (cleanest, most reliable signal).

### Information Overload Detection

**Metric:** Miss rate when info load ≥ 6 known pieces vs. ≤ 3.

If ratio > 1.5×, tag as "overloads past 5" — their accuracy degrades when tracking many pieces simultaneously.

### Per-Game Narrative Moments

Store top 3-5 memory events per player in `game_summaries.story.memory_moments`:

Templates:
- *"Move 47 — forgot the Bomb (learned move 12); sent a Captain into it."*
- *"Move 51 — remembered the Bomb 39 moves later; Miner cleared it."*
- *"Move 60 — attacked the old Marshal square; the Marshal had moved 8 turns earlier."*

### Opponent Scouting Tags

| Tag | Condition | What it means for you |
|---|---|---|
| **Steel Trap** | Score ≥ 85%, 10+ tests | Don't bother bluffing; they remember everything |
| **Bomb Amnesia** | Bomb retention ≤ 40%, 5+ tests | Re-bluff Bomb squares; they'll walk in again |
| **Loses Track** | Track rate on moved pieces ≤ 40%, 4+ tests | Move your Marshal after reveal — they'll lose it |
| **Overloads** | Miss rate spikes 1.5×+ at high load | Force many reveals early, then strike |
| **Short Fuse** | Half-life ≤ 10 moves | Initial counter-response is dangerous, but survive it and they forget |

### Memory Scouting Blob (JSONB stored in player_stats)

```json
{
  "score": 0.71,
  "n_tests": 42,
  "bomb_retention": 0.82,
  "marshal_retention": 0.55,
  "track_rate": 0.48,
  "miss_rate_by_age": { "0-5": 0.12, "6-15": 0.28, "16-30": 0.45, "31+": 0.61 },
  "median_miss_age": 17,
  "avg_load_at_miss": 6.2,
  "avg_load_at_hit": 4.1,
  "half_life_moves": 22,
  "tags": ["bomb_solid", "loses_marshal_track", "overloads_past_5"]
}
```

---

## Part 3: Information Warfare Archetypes

Computed from the Big 6 + deeper cuts. Shown as a badge on profile (separate from the general playstyle archetype which uses aggression/initiative/etc).

| IW Archetype | High Signals | Low Signals | Opponent Scouting Note |
|---|---|---|---|
| **Hyperactive Bluffer** | Motion Entropy, Bluff Bait Rate, low Stillness | Silent Majority, Ambush Yield | "Ignore the theater — probe carefully, don't react to movement" |
| **Patient Trapper** | Stillness Ratio, Ambush Yield, Bomb Concealment, Fake Bomb Density | Opening Lane Consistency, Motion Entropy | "Don't assume still=bomb — test with expendables" |
| **Snap Converter** | Low Deduction Latency, High Fast Conversion Rate, High Memory Score | — | "If they reveal your piece, RELOCATE immediately or it's dead" |
| **Fog Denier** | Reveal Half-Life, Controlled Exposure, Info Churn, Silent Majority | Unknown Pressure, Bluff Bait | "Expect prolonged uncertainty — scout conservatively" |
| **Recon Investor** | High Scout Sacrifice ROI, Low Cost-Per-New-ID, High Info Exchange Rate | — | "They spend cheap pieces for knowledge efficiently — hide your key ranks" |

### Scoring (rule-based, updated every 5 games alongside general archetype)

Each archetype has 3-4 weighted input metrics (all normalized 0-1). Highest sum wins. Stored as `info_archetype` in `player_stats`.

---

## Part 4: UI Placement

### Profile Page

**New section: "Information Warfare"** (between Combat Economy and Endgame)
- The Big 6 as stat items with `?` tooltips
- Info Exchange Rate, Deduction Latency, Bluff Bait Rate, Reveal Half-Life, Ambush Yield, Stillness Ratio

**New section: "Memory & Deduction"**
- Memory Score (main number)
- Identity Retention / Position Tracking (sub-scores)
- Half-Life ("Forgets after ~X moves")
- Scouting tags as small pills

**Profile header:** Info Archetype badge (alongside general archetype)

### Game Detail Page

**Information Edge Curve** — plotted below material curve as second sparkline (green/red for who has info advantage)

**Memory Moments** — listed in story highlights:
- Top 3 memory hits/misses with move number, piece ranks, and age since reveal

### Opponent Scouting Card (H2H)

When viewing another player's profile while logged in, the H2H card adds:
- Their Memory Score
- Their half-life
- Their IW archetype
- 1-line scouting tip generated from tags

---

## Part 5: Data Architecture

### New player_stats columns

```sql
-- Information Warfare (Big 6 + deeper)
stillness_pieces integer not null default 0      -- never-moved movable pieces (sum)
stillness_games integer not null default 0       -- games counted
info_exchange_mine integer not null default 0    -- my pieces revealed to enemy (sum)
info_exchange_theirs integer not null default 0  -- enemy pieces revealed to me (sum)
deduction_latency_sum integer not null default 0
deduction_latency_count integer not null default 0
bluff_bait_events integer not null default 0
bluff_bait_bitten integer not null default 0
reveal_half_life_sum numeric not null default 0
reveal_half_life_games integer not null default 0
ambush_defenses integer not null default 0
ambush_wins integer not null default 0
motion_entropy_sum numeric not null default 0
motion_entropy_games integer not null default 0
controlled_exposure_attacks integer not null default 0
controlled_exposure_burned integer not null default 0
info_churn_sum integer not null default 0
info_churn_count integer not null default 0
fast_conversion_opportunities integer not null default 0
fast_conversion_hits integer not null default 0

-- Memory
memory_hits_w numeric not null default 0
memory_misses_w numeric not null default 0
memory_hits integer not null default 0
memory_misses integer not null default 0
memory_bomb_hits integer not null default 0
memory_bomb_misses integer not null default 0
memory_track_hits integer not null default 0
memory_track_misses integer not null default 0
memory_scouting jsonb not null default '{}'  -- age buckets, half-life, tags

-- IW Archetype
info_archetype text  -- 'bluffer', 'trapper', 'converter', 'denier', 'investor'
info_archetype_updated_at timestamptz
```

### game_summaries.story additions

```typescript
// Added to existing GameStory interface
info_edge_curve: number[];  // per-combat: |enemy_known_to_me| - |my_known_to_them|
memory_moments: {
  slot1: MemoryEvent[];  // top 5 by weight
  slot2: MemoryEvent[];
};
memory_scores: { slot1: number | null; slot2: number | null };
```

---

## Part 6: Computation Pipeline

All metrics computed in a **single extended pass** through the moves array in `compute-stats`. The existing reveal-set replay is extended into:

1. **Knowledge ledger** (per slot) — tracks what each player knows + where
2. **Memory test emitter** — fires tests when attacking known pieces, before updating ledger
3. **IW metric accumulators** — counts for all Big 6 + deeper cuts
4. **Info edge curve** — per-combat snapshot of `|known|` per side

**Order within the loop:**
1. Check if this is a memory test opportunity (attacker targeting known piece) → emit test BEFORE updating ledger
2. Update ledger with new reveals from this combat
3. Update positions for any piece movement
4. Accumulate IW metrics (stillness, bluff events, etc.)
5. Snapshot info edge

**After loop:**
- Compute per-game derived values (entropy, half-life, etc.)
- Write to career columns (incremental sums)
- Write per-game story (info_edge_curve, memory_moments)

---

## Part 7: Implementation Waves

### Wave 1: Foundation (extend existing plan)
- Knowledge ledger in compute-stats
- Memory tests + Memory Score career stat
- Big 6 IW metrics
- Profile "Information Warfare" + "Memory & Deduction" sections

### Wave 2: Per-Game Narrative
- Info Edge Curve stored and rendered on game detail page
- Memory moments in game story
- Scouting tags computed from memory_scouting JSONB

### Wave 3: Deep Analytics
- All deeper cuts (Motion Entropy, Controlled Exposure, Info Churn, etc.)
- IW Archetype engine
- H2H scouting card additions
- Opening Lane Consistency (cross-game pattern)
- Belief Update Aggression

### Wave 4: Advanced
- Position tracking memory (track_strike / track_miss)
- Information overload detection
- Memory half-life estimation with age buckets
- Bluff Payoff (conversion after successful bait)
- Setup Signature Stability (cross-game fingerprinting)

---

## Part 8: Phase-Binned Analysis (Cross-Cutting Principle)

Full-game aggregate stats remain — they are the headline numbers. But many metrics contain richer signal when **also** reported by game phase. A 60% Reveal Efficiency in the first quarter (true fog, contested board) means something fundamentally different from 90% in the final quarter (mopping up a beaten opponent).

This applies to ALL metrics in this spec (IW and Memory) as an additive layer, not a replacement.

### Three Phase Lenses

#### Lens 1: Phase by Material Captured (Player-Relative)

Bin combats into quartiles of each player's total captures that game:
- **Q1 (0–25% of your captures):** Early game, first engagements, maximum uncertainty
- **Q2 (25–50%):** Developing, building information
- **Q3 (50–75%):** Established patterns, exploiting knowledge
- **Q4 (75–100%):** Closing out, endgame dominance (or desperation)

Why this lens: normalizes across game lengths. A 30-combat game and an 80-combat game both produce 4 comparable phases. Answers: "When in the game's combat arc does this player perform?"

#### Lens 2: Phase by Material Differential State

Bin each metric event by the player's material position when it happened:
- **Behind** (material diff < -5 rank-value)
- **Even** (-5 to +5)
- **Ahead** (+5 to +15)
- **Dominant** (+15+)

Why this lens: answers "How do they perform when losing vs. when already ahead?" A player who probes well when behind but gets sloppy with a lead is a fundamentally different competitor than one who's precise only when comfortable.

#### Lens 3: Phase by Information State

Bin by how much of the enemy army has been revealed:
- **Deep Fog** (<5 enemy pieces revealed to you)
- **Partially Mapped** (5–15 revealed)
- **Mostly Known** (15+ revealed)

Why this lens: uniquely Stratego. Answers "How does this player perform in true uncertainty vs. when the board is partially solved?" Some players thrive in fog (good intuition), others only perform once they've paid the scouting cost.

### Storage Architecture

**Per-game (in `game_summaries.story`):**
```json
"phase_stats": {
  "by_capture_quarter": {
    "q1": { "reveal_efficiency": 0.4, "trade_eff": -0.5, "memory_score": 0.6, "attacks": 8 },
    "q2": { "reveal_efficiency": 0.6, "trade_eff": +0.2, "memory_score": 0.7, "attacks": 9 },
    "q3": { "reveal_efficiency": 0.7, "trade_eff": +1.1, "memory_score": 0.8, "attacks": 7 },
    "q4": { "reveal_efficiency": 1.0, "trade_eff": +2.0, "memory_score": 1.0, "attacks": 5 }
  },
  "by_material_state": {
    "behind": { "reveal_efficiency": 0.5, "attacks": 12 },
    "even": { "reveal_efficiency": 0.6, "attacks": 8 },
    "ahead": { "reveal_efficiency": 0.8, "attacks": 6 },
    "dominant": { "reveal_efficiency": 1.0, "attacks": 3 }
  },
  "by_info_state": {
    "deep_fog": { "reveal_efficiency": 0.45, "attacks": 10 },
    "partial": { "reveal_efficiency": 0.7, "attacks": 12 },
    "known": { "reveal_efficiency": 0.9, "attacks": 7 }
  }
}
```

**Career (in `player_stats`):**

JSONB column `phase_career` accumulating per-lens, per-phase sums for key metrics:
```json
{
  "by_capture_quarter": {
    "q1": { "reveal_attacks": 45, "reveal_wins": 18, "trade_sum": -12, "trade_count": 45, ... },
    "q2": { ... },
    "q3": { ... },
    "q4": { ... }
  },
  "by_material_state": { "behind": {...}, "even": {...}, "ahead": {...}, "dominant": {...} },
  "by_info_state": { "deep_fog": {...}, "partial": {...}, "known": {...} }
}
```

This enables career-level queries like: "What's my Reveal Efficiency when I'm behind?" across all games.

### Which Metrics Get Phase-Binned

All metrics that are per-combat or per-attack events (not per-game aggregates like "fastest win"):
- Reveal Efficiency
- Trade Efficiency
- Memory Score (hit/miss rate)
- Unknown Pressure
- Avenge Rate
- Deduction Latency
- Fast Conversion Rate
- Attack win rate

Metrics that are inherently whole-game (Stillness Ratio, Reveal Half-Life, Motion Entropy) are NOT phase-binned — they describe game-level strategy, not moment-to-moment performance.

### Profile Display (deferred — noted for UI design later)

The profile could show phase progressions as mini-sparklines or as a small table:
- "Reveal Efficiency: 63% overall → 45% early / 72% late"
- A rising curve = "starts cautious, locks in once they learn"
- A falling curve = "good blind fighter, gets sloppy when ahead"

Exact UI treatment TBD — the data architecture supports it regardless of display format.

---

## Combat Event Taxonomy

Not all piece eliminations are the same:

| Event | Condition | Meaning |
|---|---|---|
| **Kill** | ATTACKER_WINS or DEFENDER_WINS, defender is not Bomb | Clean combat victory |
| **Trade** | TIE (same rank, both die) | Mutual destruction — neither side "won" |
| **Defuse** | ATTACKER_WINS where defender = Bomb | Miner clears obstacle — engineering, not combat |
| **Bomb kill** | DEFENDER_WINS where defender = Bomb | Piece walked into Bomb — passive defense |

Memory tests should only fire on events where the player made a CHOICE that can be evaluated. Trades (TIE) are excluded (design decision #1). Defuses count for `bomb_correct` memory test (did you send a Miner?). Bomb kills count for `threat_avoidance` (did you walk into a known Bomb?).

---

## Design Decisions

1. **Ties into known equal rank** — EXCLUDED from memory tests (ambiguous intentional trade)
2. **Bot games** — INCLUDED for memory measurement (cognitive skill applies regardless) but tagged `vs_bot` for optional filtering
3. **Minimum samples** — Memory Score: 5 tests; IW archetype: 5 games; scouting tags: per-tag thresholds
4. **Fog model** — perfect memory oracle (never decays); human behavior measured AGAINST it
5. **Weight function** — `RANK_VALUE[attacking_piece]` (higher cost for expensive forgets)
6. **Exclude forced moves** — if only legal option was the "wrong" counter, don't score as miss
7. **Phase-binning is additive** — full-game aggregates remain as headline numbers; phase bins are a deeper layer, not a replacement
8. **Phase quartiles use player-relative captures** — not absolute move count — for cross-game comparability
9. **Kill ≠ Trade ≠ Defuse** — see Combat Event Taxonomy; kills_by_rank and MVP use clean kills only
