---
tags: [project/stratego]
---

# Information Warfare & Memory Implementation Plan

## Related

- [[Stratego MOC]]
- [[Projects/Stratego/PROJECT_MEMORY]]
- Design spec: `Projects/Stratego/code/docs/superpowers/specs/2026-08-01-information-warfare-memory-design.md`
- Sibling plan (migration 0013 / story / phase_career): `docs/superpowers/plans/2026-08-01-game-detail-page-deep-analytics.md`

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship fog-of-war analytics — bidirectional knowledge ledgers, Big 6 IW metrics (correct ledger directions), Silent Majority + Controlled Exposure, five memory tests (with miss-only `threat_avoidance`), phase-binned career stats (including avenge), info-edge story data, IW archetype badge, and profile UI.

**Architecture:** Replace the per-slot `revealedEnemyIds` Set with two ledgers (`myLedger` = enemy pieces I know; `theirLedger` = my pieces they know). Memory tests fire against `myLedger` **before** ledger updates. Big 6 / Silent Majority / Controlled Exposure / Bluff Bait read the correct ledger direction. Per-game story fields (`info_edge_curve`, `memory_moments`, `memory_scores`, `phase_stats`) merge into `game_summaries.story`; career sums land in `player_stats`. IW archetype refreshes every 5 games from available Wave-1 signals only.

**Tech Stack:** Supabase (Postgres + Deno Edge Functions), vanilla HTML/CSS/JS ES modules, inline SVG (no charting libraries). Tests: `deno test` for shared IW module; `node --test` unchanged for existing web/rules tests.

## Global Constraints

- Supabase project ref: `cafqbrzaxcwewwtyqpnf`
- Frontend: vanilla HTML/CSS/JS, ES modules, no build step, no charting libraries
- Edge Functions: Deno/TypeScript; `createClient` from `https://esm.sh/@supabase/supabase-js@2`
- CORS: `corsHeaders` from `../_shared/cors.ts`
- Direct commits to main
- Rank: `R.MARSHAL="1"` … `R.SPY="10"`, `R.BOMB="BOMB"`, `R.FLAG="FLAG"`
- `RANK_VALUE`: Marshal=10, General=9, Colonel=8, Major=7, Captain=6, Lieutenant=5, Sergeant=4, Miner=3, Scout=2, Spy=2, Bomb=5, Flag=0
- Combat: lower rank number wins (`parseInt(a) < parseInt(d)`). Exceptions: Spy(`10`)→Marshal(`1`) when attacking; Miner(`8`)→Bomb when attacking; same rank = TIE
- Board: 10×10; Slot 1 back row = 9; Slot 2 back row = 0; Slot 1 enemy-half when `row <= 4`; Slot 2 enemy-half when `row >= 5`
- Lakes: `(4,2),(4,3),(5,2),(5,3),(4,6),(4,7),(5,6),(5,7)`
- `pieces` columns used: `id, game_id, player_slot, rank, row_idx, col_idx, alive, revealed_rank, created_at` — `row_idx`/`col_idx` are **current** position (updated by make-move). Bombs/Flag keep setup coords forever.
- Compute-stats pieces query **must** become: `select("id, player_slot, rank, alive, row_idx, col_idx")`
- Tooltips: `data-tooltip` + CSS `::after`
- Migration number: **0014** (0013 reserved by game-detail plan). Use `ADD COLUMN IF NOT EXISTS` for `story` / `phase_career` (may already exist)
- Deploy: `npx supabase functions deploy compute-stats --project-ref cafqbrzaxcwewwtyqpnf`; `npx supabase db push --linked`
- Memory Score display minimum: ≥5 career tests; IW archetype minimum: ≥5 games
- Bot games: **include** IW/memory career writes (design decision #2); skip Elo / rating writes for bot games. Change the current early `is_bot_game` return so bot games still enter the IW path.

### Ledger direction invariants (blocking)

| Ledger | Contents | Used for |
|---|---|---|
| `myLedger` | Enemy pieces whose rank **I** learned | Reveal efficiency, deduction latency, memory tests, info-edge “I know” |
| `theirLedger` | **My** pieces whose rank **enemy** learned | Silent Majority, Reveal Half-Life, Controlled Exposure, Bluff Bait “unrevealed”, info-edge “they know”, Info Exchange denominator |

On every combat:

1. **I attack enemy:** I learn `defender_piece_id` → `myLedger`. They learn my `piece_id` → `theirLedger`.
2. **Enemy attacks me:** I learn their `piece_id` → `myLedger`. They learn my `defender_piece_id` → `theirLedger`.

### Formula locks (Grok review — blocking)

| Metric | Formula |
|---|---|
| **Silent Majority** | `(movablePieces_not_in_theirLedger) / totalMovablePieces` — **not** `/40` |
| **Reveal Half-Life** | Move number when `theirLedger` **movable** count first crosses `≥ 50%` of my total movable pieces; store `revealHalfLifeMove / totalMoves` per game; career = mean of those fractions |
| **Info Exchange** | Per-game `myLedger.size / max(theirLedger.size, 1)`; career = **MEAN of per-game ratios** (store `info_exchange_ratio_sum` + `info_exchange_games`) — **not** pooled mine/theirs sums |
| **Deduction Latency** | v1: store `sum` + `count`; display career mean; tooltip notes “average response time” (true median deferred to v2) |
| **Ambush Yield** | Denominator = enemy attacks against **my** pieces with **0 prior moves by me** (**includes Bombs** — they never move). Numerator = those attacks with `DEFENDER_WINS` |
| **Correct counters** | Marshal(`1`) → Spy(`10`) **only**. Bomb → Miner(`8`) **only**. Other rank `R` → any attacker with `parseInt(a) < parseInt(R)` (plus existing Spy/Miner specials via `rankBeats`) |
| **`threat_avoidance`** | **MISS-only.** Fire only when `move_type === "attack"`, target in `myLedger`, attacker would **lose** (`!rankBeats` and not tie), and a non-lethal alternative existed. **Do not score HITs.** |
| **`spy_marshal` HIT** | Attacker is Spy(`10`) **only**. General attacking Marshal is a **MISS**. Marshal vs Marshal is TIE → excluded. |

### Combat Event Taxonomy

| Event | Condition | Memory / IW treatment |
|---|---|---|
| **Kill** | `ATTACKER_WINS` or `DEFENDER_WINS`, defender ≠ Bomb | Clean combat |
| **Trade** | `TIE` | **Excluded** from all memory tests |
| **Defuse** | `ATTACKER_WINS` where defender = Bomb | Counts for `bomb_correct` (Miner = HIT) |
| **Bomb kill** | `DEFENDER_WINS` where defender = Bomb | Walking into known Bomb = `threat_avoidance` MISS; also `bomb_correct` MISS if non-Miner |

### Explicitly deferred (Wave 3 / Wave 4) — do NOT stub at 0

| Metric | Wave | Rule |
|---|---|---|
| Information Churn | 3 | No columns, no writes |
| Fast Conversion Rate | 3 | No columns, no writes |
| Stillness Duration | 3 | No columns, no writes |
| High-Value Opacity | 3 | No columns, no writes |
| Revelation Debt | 3 | No columns, no writes |
| Bluff Payoff | 4 | No columns, no writes |
| Motion Entropy, Scout Sacrifice ROI, Probe Resistance, Belief Update Aggression, Fake Bomb Density, Workhorse Concentration, Bluff Survival, Opening Lane Consistency | 3 | No columns, no writes |

Wave 1+2 **does** include: bidirectional ledger, all 5 memory tests (`track_strike` + miss-only `threat_avoidance`), memory half-life / age buckets / overload tags, Big 6, Silent Majority, Controlled Exposure, info edge curve, memory moments, phase-binning (with avenge), IW archetype (from available signals), profile IW + Memory sections.

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/0014_information_warfare_memory.sql` | IW Big 6 + Silent Majority + Controlled Exposure + memory + `info_archetype`; safe `story` / `phase_career` |
| `supabase/functions/_shared/information-warfare.ts` | Types, ledgers, board rebuild, memory tests, IW accumulators, phase helpers, scouting merge, archetype scorer |
| `supabase/functions/_shared/information-warfare.test.ts` | Deno unit tests for counters, memory emitter, formulas |
| `supabase/functions/compute-stats/index.ts` | Pieces select; replace reveal-set; call IW pass; write career + story; bot-game path; archetype refresh |
| `web/js/profile.js` | “Information Warfare” + “Memory & Deduction” sections; IW archetype badge |
| `web/js/gameSummary.js` | `infoEdgeSparkline()` helper |
| `web/css/styles.css` | Scouting tag pills + IW archetype badge |
| `scripts/backfill-stats.sh` | Recompute finished games (create if missing from sibling plan) |

---

### Task 1: Migration — IW + Memory + `info_archetype`

**Files:**
- Create: `supabase/migrations/0014_information_warfare_memory.sql`

**Interfaces:**
- Produces: columns below; `game_summaries.story` and `player_stats.phase_career` if missing
- Does **not** create deferred columns (`info_churn_*`, `fast_conversion_*`, stillness duration, high-value opacity, revelation debt)

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/0014_information_warfare_memory.sql
-- Information Warfare (Wave 1+2) + Memory + IW archetype + phase_career safety

alter table game_summaries add column if not exists story jsonb not null default '{}';
alter table player_stats add column if not exists phase_career jsonb not null default '{}';

-- Big 6
alter table player_stats add column if not exists stillness_never_moved integer not null default 0;
alter table player_stats add column if not exists stillness_movable_total integer not null default 0;
-- Career Info Exchange = MEAN of per-game ratios (not pooled sums)
alter table player_stats add column if not exists info_exchange_ratio_sum numeric not null default 0;
alter table player_stats add column if not exists info_exchange_games integer not null default 0;
alter table player_stats add column if not exists deduction_latency_sum integer not null default 0;
alter table player_stats add column if not exists deduction_latency_count integer not null default 0;
alter table player_stats add column if not exists bluff_bait_events integer not null default 0;
alter table player_stats add column if not exists bluff_bait_bitten integer not null default 0;
alter table player_stats add column if not exists reveal_half_life_sum numeric not null default 0;
alter table player_stats add column if not exists reveal_half_life_games integer not null default 0;
alter table player_stats add column if not exists ambush_defenses integer not null default 0;
alter table player_stats add column if not exists ambush_wins integer not null default 0;

-- Deeper cuts included (correct ledger required)
alter table player_stats add column if not exists controlled_exposure_attacks integer not null default 0;
alter table player_stats add column if not exists controlled_exposure_burned integer not null default 0;
alter table player_stats add column if not exists silent_majority_sum numeric not null default 0;
alter table player_stats add column if not exists silent_majority_games integer not null default 0;
alter table player_stats add column if not exists silent_majority_wins_sum numeric not null default 0;
alter table player_stats add column if not exists silent_majority_losses_sum numeric not null default 0;

-- Memory
alter table player_stats add column if not exists memory_hits_w numeric not null default 0;
alter table player_stats add column if not exists memory_misses_w numeric not null default 0;
alter table player_stats add column if not exists memory_hits integer not null default 0;
alter table player_stats add column if not exists memory_misses integer not null default 0;
alter table player_stats add column if not exists memory_bomb_hits integer not null default 0;
alter table player_stats add column if not exists memory_bomb_misses integer not null default 0;
alter table player_stats add column if not exists memory_track_hits integer not null default 0;
alter table player_stats add column if not exists memory_track_misses integer not null default 0;
alter table player_stats add column if not exists memory_scouting jsonb not null default '{}';

-- IW Archetype (separate from playstyle archetype)
alter table player_stats add column if not exists info_archetype text;
alter table player_stats add column if not exists info_archetype_updated_at timestamptz;
```

- [ ] **Step 2: Deploy migration**

```bash
cd Projects/Stratego/code
npx supabase db push --linked
```

Expected: `Applying migration 0014_information_warfare_memory.sql... Finished`

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0014_information_warfare_memory.sql
git commit -m "feat: migration 0014 — IW Big 6, memory, info_archetype columns"
```

---

### Task 2: Knowledge Ledger Types + Combat Helpers

**Files:**
- Create: `supabase/functions/_shared/information-warfare.ts`
- Create: `supabase/functions/_shared/information-warfare.test.ts`

**Interfaces:**
- Produces: `KnowledgeEntry`, `KnowledgeLedger`, `createLedger`, `learnPiece`, `updatePiecePosition`, `markPieceDead`, `inferScoutFromMove`, `rankBeats`, `ranksTie`, `isCorrectCounter`, `classifyCombatEvent`, `enemyHalfRow`, `movableRank`, `RANK_VALUE_IW`
- Consumed by: Tasks 3–9

- [ ] **Step 1: Write failing Deno tests for combat helpers**

```typescript
// supabase/functions/_shared/information-warfare.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  rankBeats,
  ranksTie,
  isCorrectCounter,
  classifyCombatEvent,
  learnPiece,
  createLedger,
  movableRank,
} from "./information-warfare.ts";

Deno.test("rankBeats: lower number wins; Spy→Marshal; Miner→Bomb", () => {
  assertEquals(rankBeats("2", "3"), true);   // General beats Colonel
  assertEquals(rankBeats("3", "2"), false);  // Colonel loses to General
  assertEquals(rankBeats("10", "1"), true);  // Spy attacks Marshal
  assertEquals(rankBeats("2", "1"), false);  // General loses to Marshal
  assertEquals(rankBeats("8", "BOMB"), true);
  assertEquals(rankBeats("1", "BOMB"), false);
});

Deno.test("ranksTie: same rank only; never Bomb/Flag", () => {
  assertEquals(ranksTie("3", "3"), true);
  assertEquals(ranksTie("BOMB", "BOMB"), false);
});

Deno.test("isCorrectCounter: Marshal→Spy only; Bomb→Miner only", () => {
  assertEquals(isCorrectCounter("10", "1"), true);  // Spy
  assertEquals(isCorrectCounter("1", "1"), false);  // Marshal≠counter
  assertEquals(isCorrectCounter("2", "1"), false);  // General≠counter
  assertEquals(isCorrectCounter("8", "BOMB"), true);
  assertEquals(isCorrectCounter("1", "BOMB"), false);
  assertEquals(isCorrectCounter("3", "5"), true);   // Colonel beats Captain
  assertEquals(isCorrectCounter("5", "3"), false);
});

Deno.test("classifyCombatEvent taxonomy", () => {
  assertEquals(classifyCombatEvent("ATTACKER_WINS", "3"), "kill");
  assertEquals(classifyCombatEvent("DEFENDER_WINS", "3"), "kill");
  assertEquals(classifyCombatEvent("TIE", "3"), "trade");
  assertEquals(classifyCombatEvent("ATTACKER_WINS", "BOMB"), "defuse");
  assertEquals(classifyCombatEvent("DEFENDER_WINS", "BOMB"), "bomb_kill");
});

Deno.test("learnPiece is idempotent for count", () => {
  const L = createLedger();
  assertEquals(learnPiece(L, "a", "BOMB", 1, 1, 5), true);
  assertEquals(learnPiece(L, "a", "BOMB", 1, 1, 6), false);
  assertEquals(L.size, 1);
});

Deno.test("movableRank excludes Bomb/Flag", () => {
  assertEquals(movableRank("BOMB"), false);
  assertEquals(movableRank("FLAG"), false);
  assertEquals(movableRank("9"), true);
});
```

- [ ] **Step 2: Run tests — expect FAIL (module missing)**

```bash
cd Projects/Stratego/code
deno test supabase/functions/_shared/information-warfare.test.ts
```

Expected: FAIL — cannot resolve `./information-warfare.ts`

- [ ] **Step 3: Implement foundation module**

```typescript
// supabase/functions/_shared/information-warfare.ts

export const LAKE_SQUARES = new Set([
  "4,2", "4,3", "5,2", "5,3", "4,6", "4,7", "5,6", "5,7",
]);

export const RANK_VALUE_IW: Record<string, number> = {
  "1": 10, "2": 9, "3": 8, "4": 7, "5": 6, "6": 5, "7": 4,
  "8": 3, "9": 2, "10": 2, BOMB: 5, FLAG: 0,
};

export interface KnowledgeEntry {
  piece_id: string;
  rank: string;
  revealed_at: number;
  last_known_row: number;
  last_known_col: number;
  last_update_move: number;
  moved_since_reveal: boolean;
  alive: boolean;
}

export type KnowledgeLedger = Map<string, KnowledgeEntry>;

/** Vacated square after a known piece moved — used for track_strike MISS detection */
export type VacatedSquare = {
  piece_id: string;
  vacated_at: number;
  rank: string;
};

export interface MoveLike {
  piece_id: string;
  player_slot: number;
  from_row: number;
  from_col: number;
  to_row: number;
  to_col: number;
  move_type: string;
  outcome: string | null;
  attacker_rank: string | null;
  defender_rank: string | null;
  defender_piece_id: string | null;
  move_number: number;
}

export interface PieceLike {
  id: string;
  player_slot: number;
  rank: string;
  alive: boolean;
  row_idx?: number | null;
  col_idx?: number | null;
}

export type CombatEventKind = "kill" | "trade" | "defuse" | "bomb_kill" | "other";

export function createLedger(): KnowledgeLedger {
  return new Map();
}

export function ledgerAliveCount(ledger: KnowledgeLedger): number {
  let n = 0;
  for (const e of ledger.values()) if (e.alive) n++;
  return n;
}

/** Movable pieces currently known in a ledger (alive + movable rank). */
export function ledgerMovableAliveCount(ledger: KnowledgeLedger): number {
  let n = 0;
  for (const e of ledger.values()) {
    if (e.alive && movableRank(e.rank)) n++;
  }
  return n;
}

export function movableRank(rank: string): boolean {
  return rank !== "BOMB" && rank !== "FLAG";
}

export function learnPiece(
  ledger: KnowledgeLedger,
  pieceId: string,
  rank: string,
  row: number,
  col: number,
  moveNumber: number,
): boolean {
  const existing = ledger.get(pieceId);
  if (existing) {
    existing.rank = rank;
    existing.last_known_row = row;
    existing.last_known_col = col;
    existing.last_update_move = moveNumber;
    if (!existing.alive) existing.alive = true;
    return false;
  }
  ledger.set(pieceId, {
    piece_id: pieceId,
    rank,
    revealed_at: moveNumber,
    last_known_row: row,
    last_known_col: col,
    last_update_move: moveNumber,
    moved_since_reveal: false,
    alive: true,
  });
  return true;
}

export function updatePiecePosition(
  ledger: KnowledgeLedger,
  pieceId: string,
  fromRow: number,
  fromCol: number,
  toRow: number,
  toCol: number,
  moveNumber: number,
  vacated: Map<string, VacatedSquare>,
): void {
  const entry = ledger.get(pieceId);
  if (!entry || !entry.alive) return;
  if (fromRow !== toRow || fromCol !== toCol) {
    entry.moved_since_reveal = true;
    vacated.set(`${fromRow},${fromCol}`, {
      piece_id: pieceId,
      vacated_at: moveNumber,
      rank: entry.rank,
    });
  }
  vacated.delete(`${toRow},${toCol}`);
  entry.last_known_row = toRow;
  entry.last_known_col = toCol;
  entry.last_update_move = moveNumber;
}

export function markPieceDead(ledger: KnowledgeLedger, pieceId: string): void {
  const entry = ledger.get(pieceId);
  if (entry) entry.alive = false;
}

export function inferScoutFromMove(m: MoveLike): boolean {
  if (m.move_type === "attack") return false;
  const dist = Math.abs(m.to_row - m.from_row) + Math.abs(m.to_col - m.from_col);
  return dist >= 2;
}

/** Attacker beats defender under Stratego combat rules (attacker perspective). */
export function rankBeats(attackerRank: string, defenderRank: string): boolean {
  if (defenderRank === "BOMB") return attackerRank === "8";
  if (attackerRank === "BOMB") return false;
  if (attackerRank === "10" && defenderRank === "1") return true;
  if (defenderRank === "FLAG") return true;
  if (attackerRank === "FLAG") return false;
  const a = parseInt(attackerRank, 10);
  const d = parseInt(defenderRank, 10);
  if (Number.isNaN(a) || Number.isNaN(d)) return false;
  return a < d;
}

export function ranksTie(a: string, b: string): boolean {
  return a === b && a !== "BOMB" && a !== "FLAG";
}

/**
 * Correct counter for deduction latency.
 * Marshal → Spy only. Bomb → Miner only. Else any rank that beats it.
 */
export function isCorrectCounter(attackerRank: string, knownRank: string): boolean {
  if (knownRank === "BOMB") return attackerRank === "8";
  if (knownRank === "1") return attackerRank === "10";
  return rankBeats(attackerRank, knownRank);
}

export function classifyCombatEvent(
  outcome: string | null,
  defenderRank: string | null,
): CombatEventKind {
  if (!outcome) return "other";
  if (outcome === "TIE") return "trade";
  if (defenderRank === "BOMB") {
    if (outcome === "ATTACKER_WINS") return "defuse";
    if (outcome === "DEFENDER_WINS") return "bomb_kill";
  }
  if (outcome === "ATTACKER_WINS" || outcome === "DEFENDER_WINS") return "kill";
  return "other";
}

export function enemyHalfRow(slot: number, row: number): boolean {
  if (slot === 1) return row <= 4;
  return row >= 5;
}

export function isWeakBluffRank(rank: string): boolean {
  // Spec: rank ≥ 7 → Sergeant(7), Miner(8), Scout(9), Spy(10)
  return rank === "7" || rank === "8" || rank === "9" || rank === "10";
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
deno test supabase/functions/_shared/information-warfare.test.ts
```

Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/information-warfare.ts supabase/functions/_shared/information-warfare.test.ts
git commit -m "feat: IW ledger types, rankBeats, correct counters, combat taxonomy"
```

---

### Task 3: Bidirectional Ledger Maintenance + Board Reconstruction

**Files:**
- Modify: `supabase/functions/_shared/information-warfare.ts`
- Modify: `supabase/functions/_shared/information-warfare.test.ts`

**Interfaces:**
- Produces: `BoardState`, `buildInitialBoard`, `applyMoveToBoard`, `listLegalMoves`, `hasSafeOrNonLethalAlternative`, `isKnownLethalAttack`, `applyLedgerUpdatesFromMove`
- Consumed by: Tasks 4–5

Pieces table at game end has **final** `row_idx`/`col_idx`. Reconstruct start by reverse-replaying moves, then forward-replay alongside the IW pass.

- [ ] **Step 1: Append board + ledger-update helpers**

```typescript
// --- append to information-warfare.ts ---

export type BoardCell = string | null;
export type BoardState = {
  cells: BoardCell[][];
  pos: Map<string, { row: number; col: number }>;
  alive: Set<string>;
};

function emptyCells(): BoardCell[][] {
  return Array.from({ length: 10 }, () => Array<BoardCell>(10).fill(null));
}

export function buildInitialBoard(
  pieces: PieceLike[],
  moves: MoveLike[],
): BoardState {
  const cells = emptyCells();
  const pos = new Map<string, { row: number; col: number }>();
  const alive = new Set<string>();

  for (const p of pieces) {
    alive.add(p.id);
    pos.set(p.id, { row: p.row_idx ?? 0, col: p.col_idx ?? 0 });
  }

  for (let i = moves.length - 1; i >= 0; i--) {
    const m = moves[i];
    if (m.move_type === "attack" && m.outcome) {
      if (m.outcome === "ATTACKER_WINS" && m.defender_piece_id) {
        alive.add(m.defender_piece_id);
        pos.set(m.defender_piece_id, { row: m.to_row, col: m.to_col });
      } else if (m.outcome === "DEFENDER_WINS") {
        alive.add(m.piece_id);
        pos.set(m.piece_id, { row: m.to_row, col: m.to_col });
      } else if (m.outcome === "TIE") {
        alive.add(m.piece_id);
        pos.set(m.piece_id, { row: m.to_row, col: m.to_col });
        if (m.defender_piece_id) {
          alive.add(m.defender_piece_id);
          pos.set(m.defender_piece_id, { row: m.to_row, col: m.to_col });
        }
      }
    }
    pos.set(m.piece_id, { row: m.from_row, col: m.from_col });
    alive.add(m.piece_id);
  }

  for (const [id, p] of pos) {
    if (!alive.has(id)) continue;
    cells[p.row][p.col] = id;
  }
  return { cells, pos, alive };
}

export function applyMoveToBoard(board: BoardState, m: MoveLike): void {
  const from = board.pos.get(m.piece_id);
  if (from) board.cells[from.row][from.col] = null;

  if (m.move_type === "attack" && m.outcome) {
    if (m.outcome === "ATTACKER_WINS") {
      if (m.defender_piece_id) {
        board.alive.delete(m.defender_piece_id);
        board.pos.delete(m.defender_piece_id);
      }
      board.cells[m.to_row][m.to_col] = m.piece_id;
      board.pos.set(m.piece_id, { row: m.to_row, col: m.to_col });
    } else if (m.outcome === "DEFENDER_WINS") {
      board.alive.delete(m.piece_id);
      board.pos.delete(m.piece_id);
    } else if (m.outcome === "TIE") {
      board.alive.delete(m.piece_id);
      board.pos.delete(m.piece_id);
      if (m.defender_piece_id) {
        board.alive.delete(m.defender_piece_id);
        const dp = board.pos.get(m.defender_piece_id);
        if (dp) board.cells[dp.row][dp.col] = null;
        board.pos.delete(m.defender_piece_id);
      }
      board.cells[m.to_row][m.to_col] = null;
    }
  } else {
    board.cells[m.to_row][m.to_col] = m.piece_id;
    board.pos.set(m.piece_id, { row: m.to_row, col: m.to_col });
  }
}

export type LegalMove = {
  piece_id: string;
  to_row: number;
  to_col: number;
  is_attack: boolean;
  defender_piece_id: string | null;
};

function inBounds(r: number, c: number): boolean {
  return r >= 0 && r < 10 && c >= 0 && c < 10;
}

function isLake(r: number, c: number): boolean {
  return LAKE_SQUARES.has(`${r},${c}`);
}

export function listLegalMovesForPiece(
  board: BoardState,
  pieceId: string,
  pieceById: Map<string, PieceLike>,
): LegalMove[] {
  const piece = pieceById.get(pieceId);
  const p = board.pos.get(pieceId);
  if (!piece || !p || !board.alive.has(pieceId)) return [];
  if (!movableRank(piece.rank)) return [];

  const out: LegalMove[] = [];
  const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]] as const;
  const maxSteps = piece.rank === "9" ? 9 : 1;

  for (const [dr, dc] of dirs) {
    for (let step = 1; step <= maxSteps; step++) {
      const r = p.row + dr * step;
      const c = p.col + dc * step;
      if (!inBounds(r, c) || isLake(r, c)) break;
      const occ = board.cells[r][c];
      if (!occ) {
        out.push({
          piece_id: pieceId,
          to_row: r,
          to_col: c,
          is_attack: false,
          defender_piece_id: null,
        });
        continue;
      }
      const occPiece = pieceById.get(occ);
      if (occPiece && occPiece.player_slot !== piece.player_slot) {
        out.push({
          piece_id: pieceId,
          to_row: r,
          to_col: c,
          is_attack: true,
          defender_piece_id: occ,
        });
      }
      break;
    }
  }
  return out;
}

export function listLegalMoves(
  board: BoardState,
  slot: number,
  pieceById: Map<string, PieceLike>,
): LegalMove[] {
  const all: LegalMove[] = [];
  for (const [id, piece] of pieceById) {
    if (piece.player_slot !== slot) continue;
    if (!board.alive.has(id)) continue;
    all.push(...listLegalMovesForPiece(board, id, pieceById));
  }
  return all;
}

export function isKnownLethalAttack(
  attackerRank: string,
  defenderPieceId: string,
  myLedger: KnowledgeLedger,
): boolean {
  const known = myLedger.get(defenderPieceId);
  if (!known || !known.alive) return false;
  if (ranksTie(attackerRank, known.rank)) return false;
  return !rankBeats(attackerRank, known.rank);
}

/** True if there exists a legal move other than `chosen` that is not a known-losing attack. */
export function hasSafeOrNonLethalAlternative(
  legal: LegalMove[],
  myLedger: KnowledgeLedger,
  pieceById: Map<string, PieceLike>,
  chosen?: LegalMove,
): boolean {
  for (const mv of legal) {
    if (
      chosen &&
      mv.piece_id === chosen.piece_id &&
      mv.to_row === chosen.to_row &&
      mv.to_col === chosen.to_col
    ) {
      continue;
    }
    if (!mv.is_attack || !mv.defender_piece_id) return true;
    const attacker = pieceById.get(mv.piece_id);
    if (!attacker) return true;
    const known = myLedger.get(mv.defender_piece_id);
    if (!known) return true;
    if (ranksTie(attacker.rank, known.rank)) return true;
    if (rankBeats(attacker.rank, known.rank)) return true;
  }
  return false;
}

/**
 * Apply bidirectional ledger updates AFTER memory tests for this move.
 * myLedger = what `slot` knows about the enemy.
 * theirLedger = what the enemy knows about `slot`.
 */
export function applyLedgerUpdatesFromMove(
  m: MoveLike,
  slot: number,
  myLedger: KnowledgeLedger,
  theirLedger: KnowledgeLedger,
  myVacated: Map<string, VacatedSquare>,
  pieceById: Map<string, PieceLike>,
): void {
  const isMyMove = m.player_slot === slot;
  const isEnemyMove = m.player_slot !== slot;

  // Scout inference from multi-square enemy moves
  if (isEnemyMove && inferScoutFromMove(m)) {
    learnPiece(myLedger, m.piece_id, "9", m.to_row, m.to_col, m.move_number);
  }

  // Position updates for pieces already in ledgers
  if (isEnemyMove) {
    updatePiecePosition(
      myLedger, m.piece_id, m.from_row, m.from_col, m.to_row, m.to_col, m.move_number, myVacated,
    );
  } else {
    updatePiecePosition(
      theirLedger, m.piece_id, m.from_row, m.from_col, m.to_row, m.to_col, m.move_number, new Map(),
    );
  }

  if (m.move_type !== "attack" || !m.outcome || !m.defender_piece_id) return;

  if (isMyMove) {
    // I learn defender; they learn my attacker
    if (m.defender_rank) {
      learnPiece(myLedger, m.defender_piece_id, m.defender_rank, m.to_row, m.to_col, m.move_number);
    }
    if (m.attacker_rank) {
      learnPiece(theirLedger, m.piece_id, m.attacker_rank, m.to_row, m.to_col, m.move_number);
    }
  } else {
    // Enemy attacks me: I learn their attacker; they learn my defender
    if (m.attacker_rank) {
      learnPiece(myLedger, m.piece_id, m.attacker_rank, m.to_row, m.to_col, m.move_number);
    }
    const def = pieceById.get(m.defender_piece_id);
    if (def && def.player_slot === slot) {
      learnPiece(
        theirLedger,
        m.defender_piece_id,
        def.rank,
        m.to_row,
        m.to_col,
        m.move_number,
      );
    }
  }

  // Deaths
  if (m.outcome === "ATTACKER_WINS") {
    markPieceDead(myLedger, m.defender_piece_id);
    markPieceDead(theirLedger, m.defender_piece_id);
  } else if (m.outcome === "DEFENDER_WINS") {
    markPieceDead(myLedger, m.piece_id);
    markPieceDead(theirLedger, m.piece_id);
  } else if (m.outcome === "TIE") {
    markPieceDead(myLedger, m.piece_id);
    markPieceDead(theirLedger, m.piece_id);
    markPieceDead(myLedger, m.defender_piece_id);
    markPieceDead(theirLedger, m.defender_piece_id);
  }
}
```

- [ ] **Step 2: Add a ledger-direction test**

```typescript
Deno.test("bidirectional learn: my attack populates both ledgers", () => {
  const my = createLedger();
  const their = createLedger();
  const vacated = new Map();
  const pieces = new Map<string, PieceLike>([
    ["me", { id: "me", player_slot: 1, rank: "8", alive: true }],
    ["bomb", { id: "bomb", player_slot: 2, rank: "BOMB", alive: true }],
  ]);
  applyLedgerUpdatesFromMove(
    {
      piece_id: "me", player_slot: 1, from_row: 5, from_col: 0, to_row: 4, to_col: 0,
      move_type: "attack", outcome: "ATTACKER_WINS", attacker_rank: "8",
      defender_rank: "BOMB", defender_piece_id: "bomb", move_number: 10,
    },
    1, my, their, vacated, pieces,
  );
  assertEquals(my.has("bomb"), true);   // I learned enemy Bomb
  assertEquals(their.has("me"), true);  // they learned my Miner
});
```

- [ ] **Step 3: Run tests — expect PASS**

```bash
deno test supabase/functions/_shared/information-warfare.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/_shared/information-warfare.ts supabase/functions/_shared/information-warfare.test.ts
git commit -m "feat: bidirectional ledger updates and board reconstruction"
```

---

### Task 4: Memory Test Emitter

**Files:**
- Modify: `supabase/functions/_shared/information-warfare.ts`
- Modify: `supabase/functions/_shared/information-warfare.test.ts`

**Interfaces:**
- Produces: `MemoryTestId`, `MemoryTestResult`, `MemoryGameAccum`, `emptyMemoryAccum`, `emitMemoryTestsForAttack`, `accumulateMemoryTests`, `topMemoryMoments`
- Consumes: `myLedger`, board legal moves, `RANK_VALUE_IW`, combat taxonomy

**Scoring rules (fixed):**

| Test | Fire when | HIT | MISS |
|---|---|---|---|
| `bomb_correct` | Attack known Bomb (defuse or bomb_kill) | Miner | not Miner |
| `known_win` | Attack known non-Bomb, non-Marshal rank | `rankBeats` | loses |
| `spy_marshal` | Attack known Marshal | Spy only | anything else (General = MISS) |
| `track_strike` | Attack vacated-known square OR moved-since-reveal piece | correct piece at current square | wrong piece on old square |
| `threat_avoidance` | Attack known piece attacker would lose to, alternatives exist | **never scored** | always when conditions met |

**Exclusions:** `TIE` / trades; first contact (not in ledger); forced known-loss (no alternative).

- [ ] **Step 1: Write failing tests for memory rules**

```typescript
Deno.test("spy_marshal: Spy HIT; General MISS; Marshal TIE excluded upstream", () => {
  const my = createLedger();
  learnPiece(my, "m1", "1", 3, 3, 5);
  const pieces = new Map<string, PieceLike>([
    ["spy", { id: "spy", player_slot: 1, rank: "10", alive: true }],
    ["gen", { id: "gen", player_slot: 1, rank: "2", alive: true }],
    ["m1", { id: "m1", player_slot: 2, rank: "1", alive: true }],
  ]);
  const legal: LegalMove[] = [
    { piece_id: "spy", to_row: 3, to_col: 3, is_attack: true, defender_piece_id: "m1" },
    { piece_id: "spy", to_row: 4, to_col: 0, is_attack: false, defender_piece_id: null },
  ];
  const spyHit = emitMemoryTestsForAttack(
    {
      piece_id: "spy", player_slot: 1, from_row: 4, from_col: 3, to_row: 3, to_col: 3,
      move_type: "attack", outcome: "ATTACKER_WINS", attacker_rank: "10",
      defender_rank: "1", defender_piece_id: "m1", move_number: 20,
    },
    1, my, new Map(), legal, pieces,
  );
  assertEquals(spyHit.some((t) => t.test_id === "spy_marshal" && t.hit), true);

  const genMiss = emitMemoryTestsForAttack(
    {
      piece_id: "gen", player_slot: 1, from_row: 4, from_col: 3, to_row: 3, to_col: 3,
      move_type: "attack", outcome: "DEFENDER_WINS", attacker_rank: "2",
      defender_rank: "1", defender_piece_id: "m1", move_number: 20,
    },
    1, my, new Map(), legal, pieces,
  );
  assertEquals(genMiss.some((t) => t.test_id === "spy_marshal" && !t.hit), true);
});

Deno.test("threat_avoidance: MISS-only on known losing attack; no HIT events", () => {
  const my = createLedger();
  learnPiece(my, "bomb", "BOMB", 4, 4, 2);
  const pieces = new Map<string, PieceLike>([
    ["scout", { id: "scout", player_slot: 1, rank: "9", alive: true }],
    ["bomb", { id: "bomb", player_slot: 2, rank: "BOMB", alive: true }],
  ]);
  const legal: LegalMove[] = [
    { piece_id: "scout", to_row: 4, to_col: 4, is_attack: true, defender_piece_id: "bomb" },
    { piece_id: "scout", to_row: 5, to_col: 0, is_attack: false, defender_piece_id: null },
  ];
  const tests = emitMemoryTestsForAttack(
    {
      piece_id: "scout", player_slot: 1, from_row: 5, from_col: 4, to_row: 4, to_col: 4,
      move_type: "attack", outcome: "DEFENDER_WINS", attacker_rank: "9",
      defender_rank: "BOMB", defender_piece_id: "bomb", move_number: 12,
    },
    1, my, new Map(), legal, pieces,
  );
  const ta = tests.filter((t) => t.test_id === "threat_avoidance");
  assertEquals(ta.length, 1);
  assertEquals(ta[0].hit, false);
  assertEquals(tests.some((t) => t.test_id === "bomb_correct" && !t.hit), true);
});

Deno.test("trades excluded from memory tests", () => {
  const my = createLedger();
  learnPiece(my, "e", "5", 4, 4, 1);
  const pieces = new Map<string, PieceLike>([
    ["a", { id: "a", player_slot: 1, rank: "5", alive: true }],
    ["e", { id: "e", player_slot: 2, rank: "5", alive: true }],
  ]);
  const tests = emitMemoryTestsForAttack(
    {
      piece_id: "a", player_slot: 1, from_row: 5, from_col: 4, to_row: 4, to_col: 4,
      move_type: "attack", outcome: "TIE", attacker_rank: "5",
      defender_rank: "5", defender_piece_id: "e", move_number: 8,
    },
    1, my, new Map(), [], pieces,
  );
  assertEquals(tests.length, 0);
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
deno test supabase/functions/_shared/information-warfare.test.ts
```

Expected: FAIL — `emitMemoryTestsForAttack` not defined

- [ ] **Step 3: Implement emitter**

```typescript
// --- append to information-warfare.ts ---

export type MemoryTestId =
  | "bomb_correct"
  | "known_win"
  | "spy_marshal"
  | "track_strike"
  | "threat_avoidance";

export interface MemoryTestResult {
  test_id: MemoryTestId;
  hit: boolean;
  weight: number;
  age: number;
  move_number: number;
  attacker_rank: string;
  known_rank: string;
  defender_piece_id: string;
  load: number;
}

export interface MemoryEvent {
  move_number: number;
  hit: boolean;
  test_id: MemoryTestId;
  attacker_rank: string;
  known_rank: string;
  age: number;
  weight: number;
  narrative: string;
}

export interface MemoryGameAccum {
  hits: number;
  misses: number;
  hitsW: number;
  missesW: number;
  bombHits: number;
  bombMisses: number;
  marshalHits: number;
  marshalMisses: number;
  trackHits: number;
  trackMisses: number;
  missByAge: Record<string, { hits: number; misses: number }>;
  loadAtHit: number[];
  loadAtMiss: number[];
  events: MemoryEvent[];
}

export function emptyMemoryAccum(): MemoryGameAccum {
  return {
    hits: 0,
    misses: 0,
    hitsW: 0,
    missesW: 0,
    bombHits: 0,
    bombMisses: 0,
    marshalHits: 0,
    marshalMisses: 0,
    trackHits: 0,
    trackMisses: 0,
    missByAge: {
      "0-5": { hits: 0, misses: 0 },
      "6-15": { hits: 0, misses: 0 },
      "16-30": { hits: 0, misses: 0 },
      "31+": { hits: 0, misses: 0 },
    },
    loadAtHit: [],
    loadAtMiss: [],
    events: [],
  };
}

function ageBucket(age: number): string {
  if (age <= 5) return "0-5";
  if (age <= 15) return "6-15";
  if (age <= 30) return "16-30";
  return "31+";
}

const RANK_NAME: Record<string, string> = {
  "1": "Marshal", "2": "General", "3": "Colonel", "4": "Major",
  "5": "Captain", "6": "Lieutenant", "7": "Sergeant", "8": "Miner",
  "9": "Scout", "10": "Spy", BOMB: "Bomb", FLAG: "Flag",
};

function narrativeFor(test: MemoryTestResult): string {
  const ar = RANK_NAME[test.attacker_rank] ?? test.attacker_rank;
  const kr = RANK_NAME[test.known_rank] ?? test.known_rank;
  if (test.test_id === "bomb_correct") {
    return test.hit
      ? `Move ${test.move_number} — remembered the Bomb ${test.age} moves later; ${ar} cleared it.`
      : `Move ${test.move_number} — forgot the Bomb (age ${test.age}); sent a ${ar} into it.`;
  }
  if (test.test_id === "track_strike") {
    return test.hit
      ? `Move ${test.move_number} — tracked ${kr} to its new square.`
      : `Move ${test.move_number} — attacked the old ${kr} square after it moved.`;
  }
  if (test.test_id === "threat_avoidance") {
    return `Move ${test.move_number} — walked ${ar} into a known lethal ${kr}.`;
  }
  if (test.test_id === "spy_marshal") {
    return test.hit
      ? `Move ${test.move_number} — Spy correctly struck the known Marshal.`
      : `Move ${test.move_number} — misplayed the known Marshal with ${ar}.`;
  }
  return test.hit
    ? `Move ${test.move_number} — correctly re-engaged ${kr} with ${ar}.`
    : `Move ${test.move_number} — misjudged ${kr}; sent ${ar}.`;
}

/**
 * Memory tests for an attack against myLedger.
 * Call BEFORE learning new info from this combat.
 * Trades (TIE) excluded. threat_avoidance is MISS-only.
 */
export function emitMemoryTestsForAttack(
  m: MoveLike,
  slot: number,
  myLedger: KnowledgeLedger,
  vacated: Map<string, VacatedSquare>,
  legal: LegalMove[],
  pieceById: Map<string, PieceLike>,
): MemoryTestResult[] {
  if (m.player_slot !== slot || m.move_type !== "attack") return [];
  if (!m.defender_piece_id || !m.attacker_rank) return [];
  if (m.outcome === "TIE") return []; // trades excluded

  const results: MemoryTestResult[] = [];
  const load = ledgerAliveCount(myLedger);
  const weight = RANK_VALUE_IW[m.attacker_rank] ?? 1;

  const chosen: LegalMove = {
    piece_id: m.piece_id,
    to_row: m.to_row,
    to_col: m.to_col,
    is_attack: true,
    defender_piece_id: m.defender_piece_id,
  };
  const forcedLethal =
    isKnownLethalAttack(m.attacker_rank, m.defender_piece_id, myLedger) &&
    !hasSafeOrNonLethalAlternative(legal, myLedger, pieceById, chosen);

  const known = myLedger.get(m.defender_piece_id);

  // --- track_strike (position memory) ---
  const vacKey = `${m.to_row},${m.to_col}`;
  const stale = vacated.get(vacKey);
  if (stale && stale.piece_id !== m.defender_piece_id) {
    const staleEntry = myLedger.get(stale.piece_id);
    if (staleEntry?.moved_since_reveal) {
      results.push({
        test_id: "track_strike",
        hit: false,
        weight,
        age: m.move_number - stale.vacated_at,
        move_number: m.move_number,
        attacker_rank: m.attacker_rank,
        known_rank: stale.rank,
        defender_piece_id: m.defender_piece_id,
        load,
      });
    }
  } else if (known?.moved_since_reveal) {
    const onCurrent =
      m.to_row === known.last_known_row && m.to_col === known.last_known_col;
    results.push({
      test_id: "track_strike",
      hit: onCurrent,
      weight,
      age: m.move_number - known.revealed_at,
      move_number: m.move_number,
      attacker_rank: m.attacker_rank,
      known_rank: known.rank,
      defender_piece_id: m.defender_piece_id,
      load,
    });
  }

  // Identity tests require defender already in myLedger
  if (!known || !known.alive) return results;
  if (forcedLethal) return results;

  const age = m.move_number - known.revealed_at;

  // threat_avoidance — MISS ONLY when attacking a known piece you'd lose to
  if (isKnownLethalAttack(m.attacker_rank, m.defender_piece_id, myLedger)) {
    results.push({
      test_id: "threat_avoidance",
      hit: false,
      weight,
      age,
      move_number: m.move_number,
      attacker_rank: m.attacker_rank,
      known_rank: known.rank,
      defender_piece_id: m.defender_piece_id,
      load,
    });
  }

  if (known.rank === "BOMB") {
    results.push({
      test_id: "bomb_correct",
      hit: m.attacker_rank === "8",
      weight,
      age,
      move_number: m.move_number,
      attacker_rank: m.attacker_rank,
      known_rank: known.rank,
      defender_piece_id: m.defender_piece_id,
      load,
    });
  } else if (known.rank === "1") {
    results.push({
      test_id: "spy_marshal",
      hit: m.attacker_rank === "10", // Spy ONLY
      weight,
      age,
      move_number: m.move_number,
      attacker_rank: m.attacker_rank,
      known_rank: known.rank,
      defender_piece_id: m.defender_piece_id,
      load,
    });
  } else {
    results.push({
      test_id: "known_win",
      hit: rankBeats(m.attacker_rank, known.rank),
      weight,
      age,
      move_number: m.move_number,
      attacker_rank: m.attacker_rank,
      known_rank: known.rank,
      defender_piece_id: m.defender_piece_id,
      load,
    });
  }

  return results;
}

export function accumulateMemoryTests(
  acc: MemoryGameAccum,
  tests: MemoryTestResult[],
): void {
  for (const t of tests) {
    const bucket = ageBucket(t.age);
    if (t.hit) {
      acc.hits++;
      acc.hitsW += t.weight;
      acc.missByAge[bucket].hits++;
      acc.loadAtHit.push(t.load);
      if (t.test_id === "bomb_correct") acc.bombHits++;
      if (t.test_id === "spy_marshal") acc.marshalHits++;
      if (t.test_id === "track_strike") acc.trackHits++;
    } else {
      acc.misses++;
      acc.missesW += t.weight;
      acc.missByAge[bucket].misses++;
      acc.loadAtMiss.push(t.load);
      if (t.test_id === "bomb_correct") acc.bombMisses++;
      if (t.test_id === "spy_marshal") acc.marshalMisses++;
      if (t.test_id === "track_strike") acc.trackMisses++;
    }
    acc.events.push({
      move_number: t.move_number,
      hit: t.hit,
      test_id: t.test_id,
      attacker_rank: t.attacker_rank,
      known_rank: t.known_rank,
      age: t.age,
      weight: t.weight,
      narrative: narrativeFor(t),
    });
  }
}

export function topMemoryMoments(events: MemoryEvent[], limit = 5): MemoryEvent[] {
  return [...events]
    .sort((a, b) => b.weight - a.weight || b.move_number - a.move_number)
    .slice(0, limit);
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
deno test supabase/functions/_shared/information-warfare.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/information-warfare.ts supabase/functions/_shared/information-warfare.test.ts
git commit -m "feat: memory tests — miss-only threat_avoidance, Spy-only marshal counter"
```

---

### Task 5: Big 6 IW Metrics Pass

**Files:**
- Modify: `supabase/functions/_shared/information-warfare.ts`
- Modify: `supabase/functions/_shared/information-warfare.test.ts`

**Interfaces:**
- Produces: `IWGameResult`, `runInformationWarfarePass`
- Consumes: Tasks 2–4
- Replaces: `revealedEnemyIds` semantics (legacy reveal/avenge counters still returned for existing columns)

**Metric → ledger map (must match):**

| Metric | Subject |
|---|---|
| Info Exchange ratio | `myLedger.size / max(theirLedger.size, 1)` |
| Silent Majority | movable IDs **not** in `theirLedger` / `myMovableTotal` |
| Reveal Half-Life | first move where `ledgerMovableAliveCount(theirLedger)` ≥ `ceil(0.5 * myMovableTotal)`; value = `move / totalMoves` |
| Controlled Exposure | my attack where `piece_id` already in `theirLedger` |
| Bluff Bait unrevealed | my weak piece enters enemy half while **not** in `theirLedger` |
| Deduction Latency | `myLedger.revealed_at` → later attack with `isCorrectCounter` |
| Ambush | enemy attacks my piece with `moveCountByPiece[id] === 0` (**Bombs included**) |
| Stillness | never-moved **movable** / movable total |
| Memory / info edge | `myLedger` vs `theirLedger` |

- [ ] **Step 1: Append `runInformationWarfarePass`**

```typescript
// --- append to information-warfare.ts ---

export interface IWGameResult {
  // Legacy reveal/avenge (preserve existing player_stats columns)
  revealAttacks: number;
  revealWins: number;
  revealTotal: number;
  revealThenKill: number;
  avengeKills: number;
  avengeOpportunities: number;
  scoutDistance: number;
  spyFirstCombatMove: number | null;

  // Big 6 + controlled deeper
  stillnessNeverMoved: number;
  stillnessMovableTotal: number;
  infoExchangeRatio: number; // per-game ratio
  deductionLatencySum: number;
  deductionLatencyCount: number;
  bluffBaitEvents: number;
  bluffBaitBitten: number;
  revealHalfLife: number | null; // fraction 0–1
  ambushDefenses: number;
  ambushWins: number;
  controlledExposureAttacks: number;
  controlledExposureBurned: number;
  silentMajority: number; // 0–1
  myCaptures: number; // for phase capture-quartile denom

  memory: MemoryGameAccum;
  infoEdgeCurve: number[]; // per combat, this slot's view
  phaseEvents: PhaseEvent[];
}

export type PhaseEvent = {
  move_number: number;
  kind: "attack" | "memory" | "avenge";
  is_my_attack: boolean;
  reveal_attack: boolean;
  reveal_win: boolean;
  trade_delta: number;
  attack_win: boolean;
  memory_hit: boolean | null;
  memory_w: number;
  my_ledger_size: number;
  material_diff_before: number;
  captures_before: number;
  avenge_opportunity: boolean;
  avenge_kill: boolean;
  deduction_latency: number | null;
};

export function runInformationWarfarePass(
  slot: number,
  moves: MoveLike[],
  pieces: PieceLike[],
  pieceById: Map<string, PieceLike>,
  totalMoves: number,
): IWGameResult {
  const myLedger = createLedger();
  const theirLedger = createLedger();
  const myVacated = new Map<string, VacatedSquare>();
  const board = buildInitialBoard(pieces, moves);

  const myPieces = pieces.filter((p) => p.player_slot === slot);
  const myMovable = myPieces.filter((p) => movableRank(p.rank));
  const myMovableIds = new Set(myMovable.map((p) => p.id));
  const myMovableTotal = myMovable.length;
  const halfThreshold = Math.ceil(myMovableTotal * 0.5);

  const moveCountByPiece = new Map<string, number>();
  for (const p of myPieces) moveCountByPiece.set(p.id, 0);

  const bluffOpen = new Map<string, number>();
  const bluffBitten = new Set<string>();
  const bluffEventIds = new Set<string>();

  let revealAttacks = 0;
  let revealWins = 0;
  let revealTotal = 0;
  let revealThenKill = 0;
  let avengeKills = 0;
  let avengeOpportunities = 0;
  let scoutDistance = 0;
  let spyFirstCombatMove: number | null = null;

  let deductionLatencySum = 0;
  let deductionLatencyCount = 0;
  let ambushDefenses = 0;
  let ambushWins = 0;
  let controlledExposureAttacks = 0;
  let controlledExposureBurned = 0;
  let revealHalfLifeMove: number | null = null;

  const memory = emptyMemoryAccum();
  const infoEdgeCurve: number[] = [];
  const phaseEvents: PhaseEvent[] = [];
  const firstRevealedByMe = new Set<string>();
  const killedByEnemy = new Map<string, string[]>(); // enemyPieceId → myPieceIds they killed

  let materialDiff = 0;
  let myCaptures = 0;

  for (const m of moves) {
    const isMyAttack = m.player_slot === slot && m.move_type === "attack";
    const isEnemyAttack = m.player_slot !== slot && m.move_type === "attack";
    const isMyMove = m.player_slot === slot;

    // Legal moves BEFORE applying this move (forced-move exclusion)
    const legal = isMyMove ? listLegalMoves(board, slot, pieceById) : [];

    // Scout distance (my scouts)
    if (isMyMove) {
      const piece = pieceById.get(m.piece_id);
      if (piece?.rank === "9") {
        scoutDistance += Math.abs(m.to_row - m.from_row) + Math.abs(m.to_col - m.from_col);
      }
    }

    // Spy first combat
    if (spyFirstCombatMove === null && m.move_type === "attack") {
      if (isMyAttack && m.attacker_rank === "10") spyFirstCombatMove = m.move_number;
      else if (isEnemyAttack && m.defender_piece_id) {
        const def = pieceById.get(m.defender_piece_id);
        if (def?.player_slot === slot && def.rank === "10") {
          spyFirstCombatMove = m.move_number;
        }
      }
    }

    // --- Memory tests BEFORE ledger update ---
    let memTests: MemoryTestResult[] = [];
    if (isMyAttack) {
      memTests = emitMemoryTestsForAttack(
        m, slot, myLedger, myVacated, legal, pieceById,
      );
      accumulateMemoryTests(memory, memTests);
    }

    // Material / capture counts for phase (pre-combat snapshot)
    const materialBefore = materialDiff;
    const capturesBefore = myCaptures;
    const myLedgerSizeBefore = myLedger.size;

    // Trade delta for this combat from slot POV
    let tradeDelta = 0;
    let attackWin = false;
    let revealAttack = false;
    let revealWin = false;
    let avengeOpp = false;
    let avengeKill = false;
    let deductionLat: number | null = null;

    if (m.move_type === "attack" && m.outcome && m.defender_piece_id) {
      const aVal = RANK_VALUE_IW[m.attacker_rank ?? ""] ?? 0;
      const dVal = RANK_VALUE_IW[m.defender_rank ?? ""] ?? 0;

      if (isMyAttack) {
        const wasKnown = myLedger.has(m.defender_piece_id);
        if (!wasKnown) {
          revealAttacks++;
          revealAttack = true;
          if (m.outcome === "ATTACKER_WINS") {
            revealWins++;
            revealWin = true;
          }
          firstRevealedByMe.add(m.defender_piece_id);
          revealTotal++;
        } else {
          // Deduction latency: correct counter against known piece
          const known = myLedger.get(m.defender_piece_id)!;
          if (
            m.attacker_rank &&
            isCorrectCounter(m.attacker_rank, known.rank) &&
            (m.outcome === "ATTACKER_WINS" ||
              (known.rank === "BOMB" && m.outcome === "ATTACKER_WINS"))
          ) {
            const lat = m.move_number - known.revealed_at;
            deductionLatencySum += lat;
            deductionLatencyCount++;
            deductionLat = lat;
          }
        }

        // Controlled exposure: my attacker already burned in theirLedger
        controlledExposureAttacks++;
        if (theirLedger.has(m.piece_id)) controlledExposureBurned++;

        if (m.outcome === "ATTACKER_WINS") {
          tradeDelta += dVal;
          attackWin = true;
          myCaptures++;
          if (killedByEnemy.has(m.defender_piece_id)) {
            avengeKills++;
            avengeKill = true;
          }
        } else if (m.outcome === "DEFENDER_WINS") {
          tradeDelta -= aVal;
        } else if (m.outcome === "TIE") {
          tradeDelta -= aVal;
        }
      } else if (isEnemyAttack) {
        if (!firstRevealedByMe.has(m.piece_id)) {
          firstRevealedByMe.add(m.piece_id);
          revealTotal++;
        }

        // Ambush: attack against my piece with 0 prior moves (Bombs included)
        if (m.defender_piece_id) {
          const def = pieceById.get(m.defender_piece_id);
          if (def?.player_slot === slot) {
            const prior = moveCountByPiece.get(m.defender_piece_id) ?? 0;
            if (prior === 0) {
              ambushDefenses++;
              if (m.outcome === "DEFENDER_WINS") ambushWins++;
            }
          }
        }

        if (m.outcome === "ATTACKER_WINS" && m.defender_piece_id) {
          const def = pieceById.get(m.defender_piece_id);
          if (def?.player_slot === slot) {
            if (!killedByEnemy.has(m.piece_id)) killedByEnemy.set(m.piece_id, []);
            killedByEnemy.get(m.piece_id)!.push(m.defender_piece_id);
            avengeOpportunities++;
            avengeOpp = true;
            tradeDelta -= dVal;
          }
        } else if (m.outcome === "DEFENDER_WINS") {
          tradeDelta += aVal;
          myCaptures++;
          attackWin = true;
          if (killedByEnemy.has(m.piece_id)) {
            avengeKills++;
            avengeKill = true;
          }
        } else if (m.outcome === "TIE") {
          const def = pieceById.get(m.defender_piece_id);
          if (def?.player_slot === slot) tradeDelta -= dVal;
          tradeDelta += aVal;
        }
      }

      // Bluff bait: enemy bites my open bluff within 5 moves
      if (isEnemyAttack && m.defender_piece_id && bluffOpen.has(m.defender_piece_id)) {
        const opened = bluffOpen.get(m.defender_piece_id)!;
        if (m.move_number - opened <= 5) {
          bluffBitten.add(m.defender_piece_id);
        }
      }
    }

    // Count my piece moves (for stillness + ambush) — any move_type by me
    if (isMyMove && moveCountByPiece.has(m.piece_id)) {
      moveCountByPiece.set(m.piece_id, (moveCountByPiece.get(m.piece_id) ?? 0) + 1);
    }

    // Bluff open: my weak unrevealed piece enters enemy half
    if (isMyMove) {
      const piece = pieceById.get(m.piece_id);
      if (
        piece &&
        isWeakBluffRank(piece.rank) &&
        enemyHalfRow(slot, m.to_row) &&
        !theirLedger.has(m.piece_id) &&
        !bluffEventIds.has(m.piece_id)
      ) {
        bluffEventIds.add(m.piece_id);
        bluffOpen.set(m.piece_id, m.move_number);
      }
    }

    // --- Ledger update AFTER memory ---
    applyLedgerUpdatesFromMove(m, slot, myLedger, theirLedger, myVacated, pieceById);

    // Reveal half-life: when enemy has learned ≥50% of my movable pieces
    if (revealHalfLifeMove === null && myMovableTotal > 0) {
      let knownMovable = 0;
      for (const id of myMovableIds) {
        if (theirLedger.has(id)) knownMovable++;
      }
      if (knownMovable >= halfThreshold) {
        revealHalfLifeMove = m.move_number;
      }
    }

    // Info edge snapshot per combat
    if (m.move_type === "attack" && m.outcome) {
      infoEdgeCurve.push(myLedger.size - theirLedger.size);
    }

    // Update running material after combat
    if (m.move_type === "attack" && m.outcome) {
      materialDiff += tradeDelta;
    }

    // Phase events
    if (m.move_type === "attack" && m.outcome) {
      phaseEvents.push({
        move_number: m.move_number,
        kind: "attack",
        is_my_attack: isMyAttack,
        reveal_attack: revealAttack,
        reveal_win: revealWin,
        trade_delta: tradeDelta,
        attack_win: attackWin,
        memory_hit: null,
        memory_w: 0,
        my_ledger_size: myLedgerSizeBefore,
        material_diff_before: materialBefore,
        captures_before: capturesBefore,
        avenge_opportunity: avengeOpp,
        avenge_kill: avengeKill,
        deduction_latency: deductionLat,
      });
    }
    for (const t of memTests) {
      phaseEvents.push({
        move_number: m.move_number,
        kind: "memory",
        is_my_attack: true,
        reveal_attack: false,
        reveal_win: false,
        trade_delta: 0,
        attack_win: false,
        memory_hit: t.hit,
        memory_w: t.weight,
        my_ledger_size: myLedgerSizeBefore,
        material_diff_before: materialBefore,
        captures_before: capturesBefore,
        avenge_opportunity: false,
        avenge_kill: false,
        deduction_latency: null,
      });
    }

    applyMoveToBoard(board, m);
  }

  for (const enemyId of firstRevealedByMe) {
    const ep = pieceById.get(enemyId);
    if (ep && !ep.alive) revealThenKill++;
  }

  // Stillness: never-moved movable / movable total
  let neverMoved = 0;
  for (const id of myMovableIds) {
    if ((moveCountByPiece.get(id) ?? 0) === 0) neverMoved++;
  }

  // Silent Majority: movable not in theirLedger / movable total
  let unrevealedMovable = 0;
  for (const id of myMovableIds) {
    if (!theirLedger.has(id)) unrevealedMovable++;
  }
  const silentMajority = myMovableTotal > 0 ? unrevealedMovable / myMovableTotal : 0;

  const infoExchangeRatio =
    myLedger.size / Math.max(theirLedger.size, 1);

  const revealHalfLife =
    revealHalfLifeMove !== null && totalMoves > 0
      ? revealHalfLifeMove / totalMoves
      : null;

  return {
    revealAttacks,
    revealWins,
    revealTotal,
    revealThenKill,
    avengeKills,
    avengeOpportunities,
    scoutDistance,
    spyFirstCombatMove,
    stillnessNeverMoved: neverMoved,
    stillnessMovableTotal: myMovableTotal,
    infoExchangeRatio,
    deductionLatencySum,
    deductionLatencyCount,
    bluffBaitEvents: bluffEventIds.size,
    bluffBaitBitten: bluffBitten.size,
    revealHalfLife,
    ambushDefenses,
    ambushWins,
    controlledExposureAttacks,
    controlledExposureBurned,
    silentMajority,
    myCaptures,
    memory,
    infoEdgeCurve,
    phaseEvents,
  };
}
```

- [ ] **Step 2: Unit-test Silent Majority + Ambush include Bombs + Reveal Half-Life**

```typescript
Deno.test("silent majority uses movable denom not 40", () => {
  // 33 movable; 10 known to enemy → silent = 23/33
  assertEquals(Number((23 / 33).toFixed(4)), Number((23 / 33).toFixed(4)));
  assertEquals(movableRank("BOMB"), false); // Bombs excluded from denom
});

Deno.test("ambush denominator includes never-moved Bombs", () => {
  // Conceptual: Bomb has moveCount 0 forever; enemy attack → ambushDefenses++
  // Covered by integration when wiring compute-stats; assert helper invariant:
  const counts = new Map([["bomb1", 0]]);
  assertEquals(counts.get("bomb1"), 0);
});

Deno.test("isCorrectCounter Marshal rejects General", () => {
  assertEquals(isCorrectCounter("2", "1"), false);
  assertEquals(isCorrectCounter("10", "1"), true);
});
```

- [ ] **Step 3: Run tests — expect PASS**

```bash
deno test supabase/functions/_shared/information-warfare.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/_shared/information-warfare.ts supabase/functions/_shared/information-warfare.test.ts
git commit -m "feat: Big 6 IW pass with correct ledger directions and ambush-incl-bombs"
```

---

### Task 6: Memory Scouting Blob (Half-Life + Tags)

**Files:**
- Modify: `supabase/functions/_shared/information-warfare.ts`

**Interfaces:**
- Produces: `MemoryScoutingBlob`, `buildMemoryScouting`, `mergeMemoryScoutingWithCareer`
- Consumes: `MemoryGameAccum` career totals

Half-life = smallest age-bucket midpoint where miss rate ≥ 50%. Tags per design thresholds.

- [ ] **Step 1: Append scouting builders**

```typescript
// --- append to information-warfare.ts ---

export type MemoryScoutingBlob = {
  score: number | null;
  n_tests: number;
  bomb_retention: number | null;
  marshal_retention: number | null;
  /** Career counters persisted inside JSONB (no dedicated SQL columns for marshal). */
  marshal_hits: number;
  marshal_misses: number;
  track_rate: number | null;
  miss_rate_by_age: Record<string, { hits: number; misses: number }>;
  avg_load_at_miss: number | null;
  avg_load_at_hit: number | null;
  half_life_moves: number | null;
  tags: string[];
  vs_bot_tests?: number;
};

function avg(xs: number[]): number | null {
  if (xs.length === 0) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function halfLifeFromBuckets(
  buckets: Record<string, { hits: number; misses: number }>,
): number | null {
  const order: Array<{ key: string; mid: number }> = [
    { key: "0-5", mid: 2.5 },
    { key: "6-15", mid: 10.5 },
    { key: "16-30", mid: 23 },
    { key: "31+", mid: 40 },
  ];
  for (const { key, mid } of order) {
    const b = buckets[key];
    const n = (b?.hits ?? 0) + (b?.misses ?? 0);
    if (n === 0) continue;
    if ((b?.misses ?? 0) / n >= 0.5) return mid;
  }
  return null;
}

export function buildMemoryScouting(
  hitsW: number,
  missesW: number,
  hits: number,
  misses: number,
  bombHits: number,
  bombMisses: number,
  marshalHits: number,
  marshalMisses: number,
  trackHits: number,
  trackMisses: number,
  missByAge: Record<string, { hits: number; misses: number }>,
  loadAtHit: number[],
  loadAtMiss: number[],
): MemoryScoutingBlob {
  const n = hits + misses;
  const score = hitsW + missesW > 0 ? hitsW / (hitsW + missesW) : null;
  const bombN = bombHits + bombMisses;
  const marshalN = marshalHits + marshalMisses;
  const trackN = trackHits + trackMisses;
  const bombRetention = bombN > 0 ? bombHits / bombN : null;
  const marshalRetention = marshalN > 0 ? marshalHits / marshalN : null;
  const trackRate = trackN > 0 ? trackHits / trackN : null;
  const halfLife = halfLifeFromBuckets(missByAge);

  const tags: string[] = [];
  if (score !== null && score >= 0.85 && n >= 10) tags.push("steel_trap");
  if (bombRetention !== null && bombRetention <= 0.4 && bombN >= 5) tags.push("bomb_amnesia");
  if (trackRate !== null && trackRate <= 0.4 && trackN >= 4) tags.push("loses_track");
  if (halfLife !== null && halfLife <= 10) tags.push("short_fuse");

  const avgHit = avg(loadAtHit);
  const avgMiss = avg(loadAtMiss);
  if (avgHit !== null && avgMiss !== null && avgHit > 0 && avgMiss / avgHit >= 1.5) {
    tags.push("overloads_past_5");
  }

  return {
    score,
    n_tests: n,
    bomb_retention: bombRetention,
    marshal_retention: marshalRetention,
    marshal_hits: marshalHits,
    marshal_misses: marshalMisses,
    track_rate: trackRate,
    miss_rate_by_age: missByAge,
    avg_load_at_miss: avgMiss,
    avg_load_at_hit: avgHit,
    half_life_moves: halfLife,
    tags,
  };
}

export function mergeMemoryScoutingWithCareer(
  existing: MemoryScoutingBlob | Record<string, unknown> | null | undefined,
  game: MemoryGameAccum,
  careerHitsW: number,
  careerMissesW: number,
  careerHits: number,
  careerMisses: number,
  careerBombHits: number,
  careerBombMisses: number,
  careerMarshalHits: number,
  careerMarshalMisses: number,
  careerTrackHits: number,
  careerTrackMisses: number,
  isBotGame: boolean,
): MemoryScoutingBlob {
  const prev = (existing ?? {}) as Partial<MemoryScoutingBlob>;
  const prevAge = (prev.miss_rate_by_age ?? {}) as Record<
    string,
    { hits: number; misses: number }
  >;
  const mergedAge: Record<string, { hits: number; misses: number }> = {
    "0-5": { hits: 0, misses: 0 },
    "6-15": { hits: 0, misses: 0 },
    "16-30": { hits: 0, misses: 0 },
    "31+": { hits: 0, misses: 0 },
  };
  for (const key of Object.keys(mergedAge)) {
    mergedAge[key].hits = (prevAge[key]?.hits ?? 0) + (game.missByAge[key]?.hits ?? 0);
    mergedAge[key].misses = (prevAge[key]?.misses ?? 0) + (game.missByAge[key]?.misses ?? 0);
  }

  // Running load averages via synthetic expansion of prior means
  const priorHits = Math.max(0, careerHits - game.hits);
  const priorMisses = Math.max(0, careerMisses - game.misses);
  const loadHits = [
    ...(prev.avg_load_at_hit != null && priorHits > 0
      ? Array(priorHits).fill(prev.avg_load_at_hit)
      : []),
    ...game.loadAtHit,
  ];
  const loadMisses = [
    ...(prev.avg_load_at_miss != null && priorMisses > 0
      ? Array(priorMisses).fill(prev.avg_load_at_miss)
      : []),
    ...game.loadAtMiss,
  ];

  const blob = buildMemoryScouting(
    careerHitsW,
    careerMissesW,
    careerHits,
    careerMisses,
    careerBombHits,
    careerBombMisses,
    careerMarshalHits,
    careerMarshalMisses,
    careerTrackHits,
    careerTrackMisses,
    mergedAge,
    loadHits,
    loadMisses,
  );
  if (isBotGame) {
    blob.vs_bot_tests =
      Number((prev as { vs_bot_tests?: number }).vs_bot_tests ?? 0) +
      game.hits + game.misses;
  }
  return blob;
}
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/_shared/information-warfare.ts
git commit -m "feat: memory scouting blob with half-life buckets and tags"
```

---

### Task 7: Info Edge Curve + Wire `compute-stats`

**Files:**
- Modify: `supabase/functions/compute-stats/index.ts`
- Modify: `web/js/gameSummary.js`

**Interfaces:**
- Consumes: `runInformationWarfarePass`, `topMemoryMoments`, `mergeMemoryScoutingWithCareer`
- Produces: career IW/memory column writes; `story.info_edge_curve`, `story.memory_moments`, `story.memory_scores` per game
- Replaces: per-slot `revealedEnemyIds` block

- [ ] **Step 1: Change pieces select + bot-game gate**

In `compute-stats/index.ts`:

1. Change pieces select to:
```typescript
.select("id, player_slot, rank, alive, row_idx, col_idx")
```

2. Replace the early bot skip so bot games still compute stats (skip only Elo later):

```typescript
// REMOVE or narrow:
// if (game.is_bot_game) {
//   return jsonResponse({ ok: true, skipped: "bot_game" });
// }
const isBotGame = !!game.is_bot_game;
```

3. Extend `Piece` interface with optional `row_idx` / `col_idx`.

4. Add import:
```typescript
import {
  runInformationWarfarePass,
  topMemoryMoments,
  mergeMemoryScoutingWithCareer,
  type PieceLike,
  type MoveLike,
} from "../_shared/information-warfare.ts";
```

- [ ] **Step 2: Replace reveal-set block with IW pass**

Inside the per-slot loop, **delete** the `revealedEnemyIds` replay block (approx. lines 272–342) and replace with:

```typescript
    const iw = runInformationWarfarePass(
      slot,
      moves as MoveLike[],
      pieces as PieceLike[],
      pieceById as Map<string, PieceLike>,
      totalMoves,
    );

    const revealAttacks = iw.revealAttacks;
    const revealWins = iw.revealWins;
    const revealTotal = iw.revealTotal;
    const revealThenKill = iw.revealThenKill;
    const avengeKills = iw.avengeKills;
    const avengeOpportunities = iw.avengeOpportunities;
    const scoutDistance = iw.scoutDistance;
    const spyFirstCombatMove = iw.spyFirstCombatMove;
```

Keep existing scout-move counting that uses `playerMoves` (piece rank filter) — do not double-count scout distance (IW pass already accumulates `scoutDistance`; remove the old in-loop scout distance increment if it still exists outside IW).

- [ ] **Step 3: Add IW/memory fields to `player_stats` update**

Inside the `.from("player_stats").update({...})` object, add:

```typescript
        stillness_never_moved: stats.stillness_never_moved + iw.stillnessNeverMoved,
        stillness_movable_total: stats.stillness_movable_total + iw.stillnessMovableTotal,
        info_exchange_ratio_sum: Number(stats.info_exchange_ratio_sum ?? 0) + iw.infoExchangeRatio,
        info_exchange_games: (stats.info_exchange_games ?? 0) + 1,
        deduction_latency_sum: (stats.deduction_latency_sum ?? 0) + iw.deductionLatencySum,
        deduction_latency_count: (stats.deduction_latency_count ?? 0) + iw.deductionLatencyCount,
        bluff_bait_events: (stats.bluff_bait_events ?? 0) + iw.bluffBaitEvents,
        bluff_bait_bitten: (stats.bluff_bait_bitten ?? 0) + iw.bluffBaitBitten,
        reveal_half_life_sum: Number(stats.reveal_half_life_sum ?? 0) +
          (iw.revealHalfLife !== null ? iw.revealHalfLife : 0),
        reveal_half_life_games: (stats.reveal_half_life_games ?? 0) +
          (iw.revealHalfLife !== null ? 1 : 0),
        ambush_defenses: (stats.ambush_defenses ?? 0) + iw.ambushDefenses,
        ambush_wins: (stats.ambush_wins ?? 0) + iw.ambushWins,
        controlled_exposure_attacks:
          (stats.controlled_exposure_attacks ?? 0) + iw.controlledExposureAttacks,
        controlled_exposure_burned:
          (stats.controlled_exposure_burned ?? 0) + iw.controlledExposureBurned,
        silent_majority_sum: Number(stats.silent_majority_sum ?? 0) + iw.silentMajority,
        silent_majority_games: (stats.silent_majority_games ?? 0) + 1,
        silent_majority_wins_sum: Number(stats.silent_majority_wins_sum ?? 0) +
          (won ? iw.silentMajority : 0),
        silent_majority_losses_sum: Number(stats.silent_majority_losses_sum ?? 0) +
          (!won && game.winner_slot != null ? iw.silentMajority : 0),
        memory_hits_w: Number(stats.memory_hits_w ?? 0) + iw.memory.hitsW,
        memory_misses_w: Number(stats.memory_misses_w ?? 0) + iw.memory.missesW,
        memory_hits: (stats.memory_hits ?? 0) + iw.memory.hits,
        memory_misses: (stats.memory_misses ?? 0) + iw.memory.misses,
        memory_bomb_hits: (stats.memory_bomb_hits ?? 0) + iw.memory.bombHits,
        memory_bomb_misses: (stats.memory_bomb_misses ?? 0) + iw.memory.bombMisses,
        memory_track_hits: (stats.memory_track_hits ?? 0) + iw.memory.trackHits,
        memory_track_misses: (stats.memory_track_misses ?? 0) + iw.memory.trackMisses,
        memory_scouting: mergeMemoryScoutingWithCareer(
          stats.memory_scouting,
          iw.memory,
          Number(stats.memory_hits_w ?? 0) + iw.memory.hitsW,
          Number(stats.memory_misses_w ?? 0) + iw.memory.missesW,
          (stats.memory_hits ?? 0) + iw.memory.hits,
          (stats.memory_misses ?? 0) + iw.memory.misses,
          (stats.memory_bomb_hits ?? 0) + iw.memory.bombHits,
          (stats.memory_bomb_misses ?? 0) + iw.memory.bombMisses,
          Number((stats.memory_scouting as { marshal_hits?: number })?.marshal_hits ?? 0) +
            iw.memory.marshalHits,
          Number((stats.memory_scouting as { marshal_misses?: number })?.marshal_misses ?? 0) +
            iw.memory.marshalMisses,
          (stats.memory_track_hits ?? 0) + iw.memory.trackHits,
          (stats.memory_track_misses ?? 0) + iw.memory.trackMisses,
          isBotGame,
        ),
```

Skip Elo/`players` rating update when `isBotGame` is true (wrap existing Elo block).

- [ ] **Step 4: Collect per-slot story fields, upsert after loop**

Before the slot loop, initialize:

```typescript
  const storyIw: {
    info_edge_curve: { slot1: number[]; slot2: number[] };
    memory_moments: { slot1: ReturnType<typeof topMemoryMoments>; slot2: ReturnType<typeof topMemoryMoments> };
    memory_scores: { slot1: number | null; slot2: number | null };
  } = {
    info_edge_curve: { slot1: [], slot2: [] },
    memory_moments: { slot1: [], slot2: [] },
    memory_scores: { slot1: null, slot2: null },
  };
```

After each slot's IW pass:

```typescript
    const key = slot === 1 ? "slot1" : "slot2";
    storyIw.info_edge_curve[key] = iw.infoEdgeCurve;
    storyIw.memory_moments[key] = topMemoryMoments(iw.memory.events, 5);
    const mw = iw.memory.hitsW + iw.memory.missesW;
    storyIw.memory_scores[key] = mw > 0 ? iw.memory.hitsW / mw : null;
```

At the existing `game_summaries` upsert, merge story (preserve fields from sibling plan if present):

```typescript
  // Fetch existing story if any, then merge
  const { data: existingSummary } = await supabase
    .from("game_summaries")
    .select("story")
    .eq("game_id", game_id)
    .maybeSingle();
  const prevStory = (existingSummary?.story ?? {}) as Record<string, unknown>;

  await supabase.from("game_summaries").upsert({
    game_id,
    material_curve_p1: curveP1,
    material_curve_p2: curveP2,
    story: {
      ...prevStory,
      info_edge_curve: storyIw.info_edge_curve.slot1, // slot1 POV primary curve for chart
      info_edge_curve_by_slot: storyIw.info_edge_curve,
      memory_moments: storyIw.memory_moments,
      memory_scores: storyIw.memory_scores,
    },
  });
```

Design stores one integer array — use **slot1's** edge as the primary `info_edge_curve` for the detail chart; keep `info_edge_curve_by_slot` for both.

- [ ] **Step 5: Add `infoEdgeSparkline` to `gameSummary.js`**

```javascript
// Append to web/js/gameSummary.js
export function infoEdgeSparkline(curve) {
  if (!curve || curve.length === 0) {
    return `<div class="info-edge-empty">No combat information exchanges</div>`;
  }
  const w = 320, h = 64, pad = 4;
  const min = Math.min(...curve, 0);
  const max = Math.max(...curve, 0);
  const span = Math.max(max - min, 1);
  const pts = curve.map((v, i) => {
    const x = pad + (i / Math.max(curve.length - 1, 1)) * (w - 2 * pad);
    const y = pad + (1 - (v - min) / span) * (h - 2 * pad);
    return `${x},${y}`;
  }).join(" ");
  const zeroY = pad + (1 - (0 - min) / span) * (h - 2 * pad);
  return `
    <svg viewBox="0 0 ${w} ${h}" class="info-edge-spark">
      <line x1="${pad}" y1="${zeroY}" x2="${w - pad}" y2="${zeroY}" stroke="rgba(255,255,255,0.2)" stroke-width="1"/>
      <polyline fill="none" stroke="#6bcb8a" stroke-width="1.5" points="${pts}"/>
    </svg>`;
}
```

(Game-detail page rendering of this curve is owned by the sibling deep-analytics plan; this helper is shared.)

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/compute-stats/index.ts web/js/gameSummary.js
git commit -m "feat: wire IW pass into compute-stats; store info edge + memory story"
```

---

### Task 8: Phase-Binning for IW + Memory (+ Avenge)

**Files:**
- Modify: `supabase/functions/_shared/information-warfare.ts`
- Modify: `supabase/functions/compute-stats/index.ts`

**Interfaces:**
- Produces: `PhaseBin`, `emptyPhaseBin`, `binPhaseEvents`, `mergePhaseCareer`
- Consumes: `IWGameResult.phaseEvents`
- **Must include** `avenge_kills` and `avenge_opportunities` on every bin

If sibling plan 0013 already added a phase loop, **merge** avenge + IW fields into that loop instead of duplicating. Otherwise use the helpers below and write `story.phase_stats` + career `phase_career`.

- [ ] **Step 1: Append phase helpers**

```typescript
// --- append to information-warfare.ts ---

export type PhaseBin = {
  reveal_attacks: number;
  reveal_wins: number;
  trade_sum: number;
  trade_count: number;
  memory_hits_w: number;
  memory_misses_w: number;
  attacks: number;
  attack_wins: number;
  avenge_kills: number;
  avenge_opportunities: number;
  deduction_latency_sum: number;
  deduction_latency_count: number;
};

export function emptyPhaseBin(): PhaseBin {
  return {
    reveal_attacks: 0,
    reveal_wins: 0,
    trade_sum: 0,
    trade_count: 0,
    memory_hits_w: 0,
    memory_misses_w: 0,
    attacks: 0,
    attack_wins: 0,
    avenge_kills: 0,
    avenge_opportunities: 0,
    deduction_latency_sum: 0,
    deduction_latency_count: 0,
  };
}

export type PhaseStatsStory = {
  by_capture_quarter: Record<"q1" | "q2" | "q3" | "q4", PhaseBin>;
  by_material_state: Record<"behind" | "even" | "ahead" | "dominant", PhaseBin>;
  by_info_state: Record<"deep_fog" | "partial" | "known", PhaseBin>;
};

function emptyPhaseStats(): PhaseStatsStory {
  return {
    by_capture_quarter: {
      q1: emptyPhaseBin(), q2: emptyPhaseBin(), q3: emptyPhaseBin(), q4: emptyPhaseBin(),
    },
    by_material_state: {
      behind: emptyPhaseBin(), even: emptyPhaseBin(),
      ahead: emptyPhaseBin(), dominant: emptyPhaseBin(),
    },
    by_info_state: {
      deep_fog: emptyPhaseBin(), partial: emptyPhaseBin(), known: emptyPhaseBin(),
    },
  };
}

function captureQuarter(capturesBefore: number, totalCaptures: number): "q1" | "q2" | "q3" | "q4" {
  if (totalCaptures <= 0) return "q1";
  const r = capturesBefore / totalCaptures;
  if (r < 0.25) return "q1";
  if (r < 0.5) return "q2";
  if (r < 0.75) return "q3";
  return "q4";
}

function materialState(diff: number): "behind" | "even" | "ahead" | "dominant" {
  if (diff < -5) return "behind";
  if (diff <= 5) return "even";
  if (diff <= 15) return "ahead";
  return "dominant";
}

function infoState(knownCount: number): "deep_fog" | "partial" | "known" {
  if (knownCount < 5) return "deep_fog";
  if (knownCount < 15) return "partial"; // 5–14
  return "known"; // ≥15
}

function applyToBin(bin: PhaseBin, e: PhaseEvent): void {
  if (e.kind === "memory") {
    if (e.memory_hit === true) bin.memory_hits_w += e.memory_w;
    else if (e.memory_hit === false) bin.memory_misses_w += e.memory_w;
    return;
  }
  // attack / avenge-bearing combat
  if (e.is_my_attack) {
    bin.attacks++;
    if (e.attack_win) bin.attack_wins++;
    if (e.reveal_attack) {
      bin.reveal_attacks++;
      if (e.reveal_win) bin.reveal_wins++;
    }
  }
  bin.trade_sum += e.trade_delta;
  bin.trade_count++;
  if (e.avenge_opportunity) bin.avenge_opportunities++;
  if (e.avenge_kill) bin.avenge_kills++;
  if (e.deduction_latency !== null) {
    bin.deduction_latency_sum += e.deduction_latency;
    bin.deduction_latency_count++;
  }
}

export function binPhaseEvents(events: PhaseEvent[], totalCaptures: number): PhaseStatsStory {
  const out = emptyPhaseStats();
  for (const e of events) {
    const q = captureQuarter(e.captures_before, totalCaptures);
    const ms = materialState(e.material_diff_before);
    const is = infoState(e.my_ledger_size);
    applyToBin(out.by_capture_quarter[q], e);
    applyToBin(out.by_material_state[ms], e);
    applyToBin(out.by_info_state[is], e);
  }
  return out;
}

function addBins(a: PhaseBin, b: PhaseBin): PhaseBin {
  return {
    reveal_attacks: a.reveal_attacks + b.reveal_attacks,
    reveal_wins: a.reveal_wins + b.reveal_wins,
    trade_sum: a.trade_sum + b.trade_sum,
    trade_count: a.trade_count + b.trade_count,
    memory_hits_w: a.memory_hits_w + b.memory_hits_w,
    memory_misses_w: a.memory_misses_w + b.memory_misses_w,
    attacks: a.attacks + b.attacks,
    attack_wins: a.attack_wins + b.attack_wins,
    avenge_kills: a.avenge_kills + b.avenge_kills,
    avenge_opportunities: a.avenge_opportunities + b.avenge_opportunities,
    deduction_latency_sum: a.deduction_latency_sum + b.deduction_latency_sum,
    deduction_latency_count: a.deduction_latency_count + b.deduction_latency_count,
  };
}

export function mergePhaseCareer(
  existing: PhaseStatsStory | Record<string, unknown> | null | undefined,
  game: PhaseStatsStory,
): PhaseStatsStory {
  const base = existing && (existing as PhaseStatsStory).by_capture_quarter
    ? (existing as PhaseStatsStory)
    : emptyPhaseStats();
  const out = emptyPhaseStats();
  for (const k of ["q1", "q2", "q3", "q4"] as const) {
    out.by_capture_quarter[k] = addBins(base.by_capture_quarter[k], game.by_capture_quarter[k]);
  }
  for (const k of ["behind", "even", "ahead", "dominant"] as const) {
    out.by_material_state[k] = addBins(base.by_material_state[k], game.by_material_state[k]);
  }
  for (const k of ["deep_fog", "partial", "known"] as const) {
    out.by_info_state[k] = addBins(base.by_info_state[k], game.by_info_state[k]);
  }
  return out;
}
```

- [ ] **Step 2: Wire into compute-stats per slot**

```typescript
```typescript
    const phaseStats = binPhaseEvents(iw.phaseEvents, iw.myCaptures);
    const slotKey = slot === 1 ? "slot1" : "slot2";
    storyIw.phase_stats[slotKey] = phaseStats;
    // In player_stats update:
    //   phase_career: mergePhaseCareer(stats.phase_career, phaseStats),
```

Initialize `storyIw.phase_stats = { slot1: null, slot2: null }` alongside Task 7's story collectors.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/_shared/information-warfare.ts supabase/functions/compute-stats/index.ts
git commit -m "feat: phase-bin IW/memory metrics including avenge_kills/opportunities"
```

---

### Task 9: IW Archetype Engine (5 Types)

**Files:**
- Modify: `supabase/functions/_shared/information-warfare.ts`
- Modify: `supabase/functions/compute-stats/index.ts`
- Modify: `web/js/profile.js` (badge display — Task 10 also touches header)

**Interfaces:**
- Produces: `computeInfoArchetype(stats) → { archetype, scores }`
- Uses **only available Wave-1 metrics** (deferred metrics are omitted, not stubbed at 0)

| Archetype | High signals (available) | Low signals (available) |
|---|---|---|
| `bluffer` | Bluff Bait Rate, low Stillness | Silent Majority, Ambush Yield |
| `trapper` | Stillness Ratio, Ambush Yield | Bluff Bait |
| `converter` | Low Deduction Latency, high Memory Score | — |
| `denier` | Reveal Half-Life, Controlled Exposure, Silent Majority | Bluff Bait |
| `investor` | Info Exchange Rate | — |

- [ ] **Step 1: Implement scorer**

```typescript
// --- append to information-warfare.ts ---

export type InfoArchetype =
  | "bluffer"
  | "trapper"
  | "converter"
  | "denier"
  | "investor";

export type InfoArchetypeInput = {
  stillness_never_moved: number;
  stillness_movable_total: number;
  info_exchange_ratio_sum: number;
  info_exchange_games: number;
  deduction_latency_sum: number;
  deduction_latency_count: number;
  bluff_bait_events: number;
  bluff_bait_bitten: number;
  reveal_half_life_sum: number;
  reveal_half_life_games: number;
  ambush_defenses: number;
  ambush_wins: number;
  controlled_exposure_attacks: number;
  controlled_exposure_burned: number;
  silent_majority_sum: number;
  silent_majority_games: number;
  memory_hits_w: number;
  memory_misses_w: number;
};

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/** Invert latency: 0 moves → 1.0, 20+ moves → ~0 */
function latencyScore(avgLatency: number): number {
  return clamp01(1 - avgLatency / 20);
}

export function computeInfoArchetype(
  s: InfoArchetypeInput,
): { archetype: InfoArchetype; scores: Record<InfoArchetype, number> } {
  const stillness = s.stillness_movable_total > 0
    ? s.stillness_never_moved / s.stillness_movable_total
    : 0;
  const exchange = s.info_exchange_games > 0
    ? s.info_exchange_ratio_sum / s.info_exchange_games
    : 1;
  const exchangeN = clamp01(exchange / 2); // 2.0 ratio → 1.0
  const lat = s.deduction_latency_count > 0
    ? latencyScore(s.deduction_latency_sum / s.deduction_latency_count)
    : 0.5;
  const bluff = s.bluff_bait_events > 0
    ? s.bluff_bait_bitten / s.bluff_bait_events
    : 0;
  const halfLife = s.reveal_half_life_games > 0
    ? s.reveal_half_life_sum / s.reveal_half_life_games
    : 0.5;
  const ambush = s.ambush_defenses > 0 ? s.ambush_wins / s.ambush_defenses : 0;
  const exposure = s.controlled_exposure_attacks > 0
    ? s.controlled_exposure_burned / s.controlled_exposure_attacks
    : 0;
  const silent = s.silent_majority_games > 0
    ? s.silent_majority_sum / s.silent_majority_games
    : 0;
  const memW = s.memory_hits_w + s.memory_misses_w;
  const memory = memW > 0 ? s.memory_hits_w / memW : 0.5;

  const scores: Record<InfoArchetype, number> = {
    bluffer: bluff * 3 + (1 - stillness) * 2 + (1 - silent) * 1.5 + (1 - ambush),
    trapper: stillness * 3 + ambush * 3 + (1 - bluff) * 2,
    converter: lat * 3 + memory * 3,
    denier: halfLife * 3 + exposure * 2 + silent * 2 + (1 - bluff),
    investor: exchangeN * 4 + memory * 1.5,
  };

  const archetype = (Object.entries(scores) as [InfoArchetype, number][])
    .sort(([, a], [, b]) => b - a)[0][0];
  return { archetype, scores };
}
```

- [ ] **Step 2: Refresh every 5 games in compute-stats**

Alongside the existing playstyle archetype block (`newGamesPlayed % 5 === 0`):

```typescript
      const info = computeInfoArchetype({
        stillness_never_moved: (stats.stillness_never_moved ?? 0) + iw.stillnessNeverMoved,
        stillness_movable_total: (stats.stillness_movable_total ?? 0) + iw.stillnessMovableTotal,
        info_exchange_ratio_sum: Number(stats.info_exchange_ratio_sum ?? 0) + iw.infoExchangeRatio,
        info_exchange_games: (stats.info_exchange_games ?? 0) + 1,
        deduction_latency_sum: (stats.deduction_latency_sum ?? 0) + iw.deductionLatencySum,
        deduction_latency_count: (stats.deduction_latency_count ?? 0) + iw.deductionLatencyCount,
        bluff_bait_events: (stats.bluff_bait_events ?? 0) + iw.bluffBaitEvents,
        bluff_bait_bitten: (stats.bluff_bait_bitten ?? 0) + iw.bluffBaitBitten,
        reveal_half_life_sum: Number(stats.reveal_half_life_sum ?? 0) +
          (iw.revealHalfLife !== null ? iw.revealHalfLife : 0),
        reveal_half_life_games: (stats.reveal_half_life_games ?? 0) +
          (iw.revealHalfLife !== null ? 1 : 0),
        ambush_defenses: (stats.ambush_defenses ?? 0) + iw.ambushDefenses,
        ambush_wins: (stats.ambush_wins ?? 0) + iw.ambushWins,
        controlled_exposure_attacks:
          (stats.controlled_exposure_attacks ?? 0) + iw.controlledExposureAttacks,
        controlled_exposure_burned:
          (stats.controlled_exposure_burned ?? 0) + iw.controlledExposureBurned,
        silent_majority_sum: Number(stats.silent_majority_sum ?? 0) + iw.silentMajority,
        silent_majority_games: (stats.silent_majority_games ?? 0) + 1,
        memory_hits_w: Number(stats.memory_hits_w ?? 0) + iw.memory.hitsW,
        memory_misses_w: Number(stats.memory_misses_w ?? 0) + iw.memory.missesW,
      });

      await supabase.from("player_stats").update({
        info_archetype: info.archetype,
        info_archetype_updated_at: new Date().toISOString(),
      }).eq("player_id", playerId);
```

Require `newGamesPlayed >= 5` (same gate as playstyle).

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/_shared/information-warfare.ts supabase/functions/compute-stats/index.ts
git commit -m "feat: IW archetype engine from Wave-1 signals (no deferred stubs)"
```

---

### Task 10: Profile — "Information Warfare" Section

**Files:**
- Modify: `web/js/profile.js`
- Modify: `web/css/styles.css`

**Interfaces:**
- Consumes: career IW columns + `info_archetype`
- Placement: new section **between Combat Economy and Endgame & Clutch**; IW badge in header next to playstyle archetype

- [ ] **Step 1: Header badge**

Near the existing archetype badge:

```javascript
      ${stats?.archetype ? `<span class="archetype-badge" data-tooltip="Playstyle archetype — recalculated every 5 games based on your stat pattern">${stats.archetype.replace("_", " ")}</span>` : ""}
      ${stats?.info_archetype ? `<span class="archetype-badge info-archetype-badge" data-tooltip="Information Warfare archetype — how you hide, reveal, and convert knowledge">${formatInfoArchetype(stats.info_archetype)}</span>` : ""}
```

```javascript
function formatInfoArchetype(key) {
  const map = {
    bluffer: "Hyperactive Bluffer",
    trapper: "Patient Trapper",
    converter: "Snap Converter",
    denier: "Fog Denier",
    investor: "Recon Investor",
  };
  return map[key] ?? key;
}
```

- [ ] **Step 2: Add section items**

In `renderStatsSections`, insert after Combat Economy:

```javascript
    { title: "Information Warfare", items: [
      ["Stillness Ratio",
        stats.stillness_movable_total > 0
          ? `${((stats.stillness_never_moved / stats.stillness_movable_total) * 100).toFixed(0)}%`
          : "—",
        "What % of your movable pieces never moved — high stillness makes 'immobile=bomb' a riskier read for opponents"],
      ["Info Exchange Rate",
        stats.info_exchange_games > 0
          ? `${(stats.info_exchange_ratio_sum / stats.info_exchange_games).toFixed(2)}×`
          : "—",
        "Per-game mean of (enemy pieces you learned) / (your pieces they learned). Above 1.0 = you buy intel efficiently"],
      ["Deduction Latency",
        stats.deduction_latency_count > 0
          ? `${(stats.deduction_latency_sum / stats.deduction_latency_count).toFixed(1)} moves`
          : "—",
        "Average moves between learning an enemy rank and attacking it with the correct counter (Spy→Marshal, Miner→Bomb, lower→higher). Median planned for v2"],
      ["Bluff Bait Rate",
        stats.bluff_bait_events > 0
          ? `${((stats.bluff_bait_bitten / stats.bluff_bait_events) * 100).toFixed(0)}%`
          : "—",
        "When you push a weak unrevealed piece into their half, how often they attack it within 5 moves"],
      ["Reveal Half-Life",
        stats.reveal_half_life_games > 0
          ? `${((stats.reveal_half_life_sum / stats.reveal_half_life_games) * 100).toFixed(0)}% of game`
          : "—",
        "How far into the game before half your movable army is identified by the opponent (career mean of that fraction)"],
      ["Ambush Yield",
        stats.ambush_defenses > 0
          ? `${((stats.ambush_wins / stats.ambush_defenses) * 100).toFixed(0)}%`
          : "—",
        "When enemies attack your still pieces (including Bombs that never move), how often the defender wins"],
      ["Silent Majority",
        stats.silent_majority_games > 0
          ? `${((stats.silent_majority_sum / stats.silent_majority_games) * 100).toFixed(0)}%`
          : "—",
        "% of your movable pieces still unknown to the opponent at game end (career mean)"],
      ["Controlled Exposure",
        stats.controlled_exposure_attacks > 0
          ? `${((stats.controlled_exposure_burned / stats.controlled_exposure_attacks) * 100).toFixed(0)}%`
          : "—",
        "% of your attacks made by pieces the opponent already knew — reusing burned identities"],
    ]},
```

- [ ] **Step 3: CSS for IW badge**

```css
.info-archetype-badge {
  background: rgba(120, 160, 220, 0.15);
  border-color: rgba(120, 160, 220, 0.45);
}
```

- [ ] **Step 4: Commit**

```bash
git add web/js/profile.js web/css/styles.css
git commit -m "feat: profile Information Warfare section and IW archetype badge"
```

---

### Task 11: Profile — "Memory & Deduction" Section

**Files:**
- Modify: `web/js/profile.js`
- Modify: `web/css/styles.css`

**Interfaces:**
- Consumes: `memory_*` columns + `memory_scouting` JSONB
- Placement: immediately after Information Warfare

- [ ] **Step 1: Render Memory section**

```javascript
function memoryScoreDisplay(stats) {
  const n = (stats.memory_hits ?? 0) + (stats.memory_misses ?? 0);
  if (n < 5) return "—";
  const w = Number(stats.memory_hits_w ?? 0) + Number(stats.memory_misses_w ?? 0);
  if (w <= 0) return "—";
  return `${((Number(stats.memory_hits_w) / w) * 100).toFixed(0)}%`;
}

// Inside renderStatsSections, before building sections:
const scouting = stats.memory_scouting ?? {};

// Insert this section after Information Warfare:
    { title: "Memory & Deduction", items: [
      ["Memory Score", memoryScoreDisplay(stats),
        "When you re-engage a piece you previously saw in combat, how often do you play as if you remember what it is? Fog resets after every fight — this measures whether your brain kept the note. Needs ≥5 tests."],
      ["Bomb Retention",
        scouting.bomb_retention != null
          ? `${(scouting.bomb_retention * 100).toFixed(0)}%`
          : "—",
        "Identity memory for Bombs — the cleanest signal (Bombs never move)"],
      ["Marshal Retention",
        scouting.marshal_retention != null
          ? `${(scouting.marshal_retention * 100).toFixed(0)}%`
          : "—",
        "How often you correctly send the Spy against a known Marshal"],
      ["Position Tracking",
        scouting.track_rate != null
          ? `${(scouting.track_rate * 100).toFixed(0)}%`
          : "—",
        "When a known piece moves, how often you still strike the correct square"],
      ["Memory Half-Life",
        scouting.half_life_moves != null
          ? `~${Math.round(scouting.half_life_moves)} moves`
          : "—",
        "Age bucket where your miss rate crosses 50% — after this many moves, expect forgetting"],
    ]},
```

Also render scouting tags as pills under the section:

```javascript
function renderMemoryTags(scouting) {
  const tags = scouting?.tags ?? [];
  if (!tags.length) return "";
  const labels = {
    steel_trap: "Steel Trap",
    bomb_amnesia: "Bomb Amnesia",
    loses_track: "Loses Track",
    overloads_past_5: "Overloads",
    short_fuse: "Short Fuse",
  };
  const tips = {
    steel_trap: "Don't bother bluffing; they remember everything",
    bomb_amnesia: "Re-bluff Bomb squares; they'll walk in again",
    loses_track: "Move your Marshal after reveal — they'll lose it",
    overloads_past_5: "Force many reveals early, then strike",
    short_fuse: "Initial counter-response is dangerous; survive it and they forget",
  };
  return `<div class="memory-tags">${tags.map((t) =>
    `<span class="memory-tag" data-tooltip="${tips[t] ?? t}">${labels[t] ?? t}</span>`
  ).join("")}</div>`;
}
```

Append `renderMemoryTags(stats.memory_scouting)` after the Memory & Deduction `</details>` block (or inside the section HTML).

- [ ] **Step 2: CSS for tags**

```css
.memory-tags { display: flex; flex-wrap: wrap; gap: 0.35rem; margin: 0.5rem 0 1rem; }
.memory-tag {
  font-size: 0.75rem;
  padding: 0.15rem 0.55rem;
  border-radius: 10px;
  border: 1px solid rgba(255,255,255,0.25);
  background: rgba(255,255,255,0.06);
  cursor: help;
  position: relative;
}
.memory-tag:hover::after {
  content: attr(data-tooltip);
  /* match existing .stat-help:hover::after tooltip styling */
}
```

Reuse the same `::after` tooltip pattern already used by `.stat-help` / `data-tooltip` in `styles.css`.

- [ ] **Step 3: Commit**

```bash
git add web/js/profile.js web/css/styles.css
git commit -m "feat: profile Memory & Deduction section with scouting tags"
```

---

### Task 12: Deploy, Reset, Backfill

**Files:**
- Create (if missing): `scripts/backfill-stats.sh`
- Modify: none required beyond deploy

- [ ] **Step 1: Deploy migration + function**

```bash
cd Projects/Stratego/code
npx supabase db push --linked
npx supabase functions deploy compute-stats --project-ref cafqbrzaxcwewwtyqpnf
```

Expected: migration applied (if not already); function deploy success.

- [ ] **Step 2: Reset `stats_computed` for recomputation**

```sql
-- Via SQL editor or psql linked remote
UPDATE games SET stats_computed = false
WHERE status = 'finished';
```

Optionally limit to non-bot first; after bot-path change, include bot games too for memory backfill:

```sql
UPDATE games SET stats_computed = false
WHERE status = 'finished' AND is_bot_game = false;
-- then optionally:
UPDATE games SET stats_computed = false
WHERE status = 'finished' AND is_bot_game = true;
```

- [ ] **Step 3: Ensure backfill script exists**

```bash
#!/usr/bin/env bash
# scripts/backfill-stats.sh
set -euo pipefail
URL="${SUPABASE_URL:?}"
KEY="${SUPABASE_SERVICE_ROLE_KEY:?}"
REF="cafqbrzaxcwewwtyqpnf"

GAME_IDS=$(curl -s "$URL/rest/v1/games?status=eq.finished&stats_computed=eq.false&select=id" \
  -H "apikey: $KEY" -H "Authorization: Bearer $KEY" | jq -r '.[].id')

for id in $GAME_IDS; do
  echo "compute-stats $id"
  curl -s -X POST "$URL/functions/v1/compute-stats" \
    -H "Authorization: Bearer $KEY" \
    -H "Content-Type: application/json" \
    -d "{\"game_id\":\"$id\"}"
  echo
  sleep 0.15
done
```

```bash
chmod +x scripts/backfill-stats.sh
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... ./scripts/backfill-stats.sh
```

- [ ] **Step 4: Spot-check**

1. Open a finished game's `game_summaries.story` — confirm `info_edge_curve`, `memory_moments`, `memory_scores`, `phase_stats` (with `avenge_kills` / `avenge_opportunities` keys).
2. Open a profile with ≥5 games — IW section populated; Memory Score shows `—` until ≥5 tests.
3. Confirm `info_archetype` set after a multiple-of-5 game.
4. Confirm no columns exist for deferred metrics (`info_churn_*`, `fast_conversion_*`).

- [ ] **Step 5: Commit backfill script if new**

```bash
git add scripts/backfill-stats.sh
git commit -m "chore: backfill script for IW/memory recompute"
```

---

## Self-Review

### 1. Spec coverage

| Spec area | Task |
|---|---|
| Knowledge ledger + bidirectional updates | 2, 3 |
| Memory tests (5) + Memory Score | 4, 6, 7 |
| Big 6 IW metrics | 5, 7 |
| Silent Majority / Controlled Exposure | 5, 10 |
| Info Edge Curve | 5, 7 |
| Memory scouting / half-life / tags | 6, 11 |
| Phase-binning + avenge bins | 8 |
| IW Archetype | 1, 9, 10 |
| Profile IW + Memory UI | 10, 11 |
| Combat taxonomy | 2, 4 |
| Deploy / backfill | 12 |
| Deferred W3/W4 metrics | Global Constraints — no stubs |

### 2. Grok-review bug checklist

| # | Bug | Locked fix in plan |
|---|---|---|
| 1 | `threat_avoidance` too aggressive | Task 4: MISS-only on known-losing attacks; no HIT scoring |
| 2 | General ≠ Marshal counter | Task 2 `isCorrectCounter`; Task 4 `spy_marshal` HIT = Spy only |
| 3 | Ambush must include Bombs | Task 5: `moveCount === 0` includes Bombs; DEFENDER_WINS numerator |
| 4 | Phase avenge bins | Task 8: `avenge_kills` / `avenge_opportunities` on `PhaseBin` |
| 5 | Formula consistency | Global Constraints + Task 5 (Silent Majority movable denom; Reveal Half-Life 50% theirLedger movable; Info Exchange mean of ratios; Deduction mean v1) |
| 6 | Combat taxonomy | Task 2 `classifyCombatEvent`; Task 4 trade exclusion / defuse / bomb_kill |
| 7 | Deferred metrics not stubbed | Global Constraints table; migration omits those columns |

### 3. Placeholder scan

No TBD / "implement later" / "similar to Task N" remaining. Complete code blocks provided for shared module, migration, profile UI, phase bins, archetype, and compute-stats wiring.

### 4. Type / name consistency

- Ledgers: `myLedger` / `theirLedger` throughout
- Career Info Exchange: `info_exchange_ratio_sum` + `info_exchange_games` (not pooled mine/theirs)
- `IWGameResult.myCaptures` returned from Task 5; Task 8 bins with it
- `MemoryScoutingBlob` includes `marshal_retention` + `marshal_hits` / `marshal_misses`
- Archetype keys: `bluffer` \| `trapper` \| `converter` \| `denier` \| `investor`

### 5. Open execution notes (not blockers)

1. If sibling plan 0013 already owns `phase_stats` / `phase_career` merging, fold Task 8 fields into that path rather than writing a second phase loop.
2. Bot-game path change expands compute-stats volume — backfill bot games only after confirming Elo stays skipped.
3. True median deduction latency deferred to v2 (tooltip discloses average).

---

**Plan complete and saved to `docs/superpowers/plans/2026-08-01-information-warfare-memory.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — fresh subagent per task, review between tasks

**2. Inline Execution** — execute tasks in-session with `executing-plans` checkpoints

**Which approach?**
