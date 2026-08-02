---
tags: [project/stratego]
---

# Game Detail Page & Deep Analytics Implementation Plan

## Related

- [[Stratego MOC]]
- [[Projects/Stratego/PROJECT_MEMORY]]
- Design spec: `Projects/Stratego/code/docs/superpowers/specs/2026-08-01-game-detail-deep-analytics-design.md`
- Sibling IW/memory plan (migration 0014): `docs/superpowers/plans/2026-08-01-information-warfare-memory.md`

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a public game detail page (`game-detail.html?id=<game_id>`) with full per-game narrative (material curve with y-axis labels, info edge, piece careers, phase breakdowns including avenge, territory timeline, Flag proximity from `row_idx`/`col_idx`) and add Board Geography + Tempo & Rhythm career stats to profiles — all computed at `compute-stats` time and stored in `game_summaries.story` + `player_stats`.

**Architecture:** Migration `0013` adds `story` JSONB on `game_summaries` and geography/tempo columns + `phase_career` on `player_stats`. In `compute-stats`: extend the pieces select to include `row_idx`/`col_idx`; compute game-wide story (careers, kill chains, turning point, territory via running `aliveSet`, think times, Flag proximity from Flag’s stored coordinates, bidirectional info-edge) **before** the per-slot loop; inside the loop after comeback, compute phase bins (3 lenses) with avenge routed into bins; accumulate career geography/tempo + `phase_career`; upsert `story`. Frontend: `game-detail.html` + `gameDetail.js` (SVG charts with y-axis labels); profile Board Geography + Tempo; history rows link to detail.

**Tech Stack:** Supabase Postgres + Deno Edge Functions, vanilla HTML/CSS/JS (ES modules, inline SVG, no chart libraries).

## Global Constraints

- Supabase project ref: `cafqbrzaxcwewwtyqpnf`
- Frontend: vanilla HTML/CSS/JS, ES modules via esm.sh imports, no build step, no charting libraries
- Edge Functions: Deno/TypeScript, `createClient` from `https://esm.sh/@supabase/supabase-js@2`
- Direct commits to main branch
- Rank system: `R.MARSHAL="1"`, `R.GENERAL="2"`, …, `R.SPY="10"`, `R.BOMB="BOMB"`, `R.FLAG="FLAG"` (lower number = stronger)
- `RANK_VALUE`: Marshal=10, General=9, Colonel=8, Major=7, Captain=6, Lieutenant=5, Sergeant=4, Miner=3, Scout=2, Spy=2, Bomb=5, Flag=0
- `moves` table: piece_id, player_slot, from_row, from_col, to_row, to_col, move_type, outcome, attacker_rank, defender_rank, defender_piece_id, move_number, created_at
- `pieces` table: `id, game_id, player_slot, rank, row_idx, col_idx, alive, revealed_rank, created_at` — `row_idx`/`col_idx` are **current** position (updated by make-move). Immobile pieces (Bomb, Flag) stay at setup forever.
- `game_summaries` already exists (game_id PK, material_curve_p1/p2 int[], created_at)
- Existing `compute-stats/index.ts` structure (do not reorder existing blocks):
  1. Game fetch + early returns
  2. `pieceById`, `firstCombat`, `lastMove`, `isMarathon`, `marshalFights`
  3. Material curve — once, before per-slot loop
  4. `for (const slot of [1, 2])` — basic stats, reveal-set replay (`revealedEnemyIds` + avenge career counters), trade, comeback, heatmap, piece fate, Elo+stats, achievements
  5. After loop: `game_summaries` upsert + `stats_computed = true`
- `RANK_NAME`: `{"1":"Marshal","2":"General","3":"Colonel","4":"Major","5":"Captain","6":"Lieutenant","7":"Sergeant","8":"Miner","9":"Scout","10":"Spy","BOMB":"Bomb","FLAG":"Flag"}`
- Tooltips: `data-tooltip` + CSS `::after`
- Deploy: `npx supabase functions deploy compute-stats --project-ref cafqbrzaxcwewwtyqpnf`; `npx supabase db push --linked`; frontend via `git push`
- Lakes: (4,2),(4,3),(5,2),(5,3),(4,6),(4,7),(5,6),(5,7)
- Board: 10×10. Slot 1 territory = rows 6–9 (back row = 9). Slot 2 territory = rows 0–3 (back row = 0). Enemy-half samples use mid-board split: slot 1 in enemy when `row <= 4`; slot 2 in enemy when `row >= 5`.

### Correctness invariants (blocking)

1. **Capture = kill, not attack-win-only.** A player's capture count includes (a) own attacks with `ATTACKER_WINS` and (b) enemy attacks against them with `DEFENDER_WINS`.
2. **Material-state bin is pre-combat.** Read `runningMaterialDiff` → bin → THEN update differential.
3. **Info Edge uses two reveal Sets.** `knownBySlot1` / `knownBySlot2` = enemy piece IDs that slot knows. Edge for slot X = `|knownByX| - |knownByOpponent|`.
4. **Territory samples use alive-at-time.** Maintain running `aliveSet`; never use final `piece.alive` for samples.
5. **`attacks` / `attack_wins` are initiation-only.** Increment only when `player_slot === slot`.
6. **Flag proximity uses Flag `row_idx`/`col_idx`.** Pieces select must include those columns. No move-based Flag position inference.
7. **Info-state bins:** deep_fog = `< 5`, partial = `5–14` (`>= 5 && < 15`), known = `>= 15`.
8. **Phase avenge:** `PhaseBin` has `avenge_kills` / `avenge_opportunities`; phase loop mirrors reveal-set avenge tracking and increments the pre-combat bins.

### Review-bug fixes locked into this plan

| # | Bug | Fix |
|---|-----|-----|
| 1 | Flag proximity inferred from moves | Select `row_idx, col_idx`; Flag pos = those fields; min Manhattan from enemy `to_*` |
| 2 | `infoState` treated 15 as partial (`<= 15`) | `known` when `knownCount >= 15` (`if (knownCount < 15) return "partial"`) |
| 3 | Phase bins omitted avenge | Add `avenge_kills` / `avenge_opportunities` to `PhaseBin`; increment in phase loop |
| 4 | Detail material SVG missing y labels | `renderLineChart` shows `+max` / `min` text like `gameSummary.js` |

---

## File Map

| File | Responsibility |
|------|----------------|
| `supabase/migrations/0013_game_story_deep_analytics.sql` | `story` JSONB, geography/tempo columns, `phase_career`, `get_game_detail` RPC |
| `supabase/functions/compute-stats/index.ts` | Pieces select + story block + phase bins (w/ avenge) + career accumulators + story upsert |
| `web/game-detail.html` | Game detail page shell |
| `web/js/gameDetail.js` | Fetch summary, render narrative + SVG charts (y-axis labels) |
| `web/js/profile.js` | Board Geography + Tempo sections; history links |
| `web/css/styles.css` | Game detail + phase table styles |
| `scripts/backfill-stats.sh` | Recompute finished games after deploy |

---

### Task 1: Migration — Story JSONB + Career Columns + phase_career

**Files:**
- Create: `supabase/migrations/0013_game_story_deep_analytics.sql`

**Interfaces:**
- Produces: `game_summaries.story jsonb`; geography/tempo columns on `player_stats`; `player_stats.phase_career jsonb`; `get_game_detail(uuid)` RPC

- [ ] **Step 1: Write migration**

```sql
-- supabase/migrations/0013_game_story_deep_analytics.sql
-- Game detail narrative + board geography / tempo career stats + phase-binned career accumulator

alter table game_summaries add column if not exists story jsonb not null default '{}';

-- Board Geography
alter table player_stats add column if not exists flank_left_moves integer not null default 0;
alter table player_stats add column if not exists flank_right_moves integer not null default 0;
alter table player_stats add column if not exists lake_corridor_moves integer not null default 0;
alter table player_stats add column if not exists defense_depth_sum numeric not null default 0;
alter table player_stats add column if not exists defense_depth_count integer not null default 0;
alter table player_stats add column if not exists invasion_lane_left integer not null default 0;
alter table player_stats add column if not exists invasion_lane_center integer not null default 0;
alter table player_stats add column if not exists invasion_lane_right integer not null default 0;

-- Tempo & Rhythm
alter table player_stats add column if not exists combat_cadence_sum integer not null default 0;
alter table player_stats add column if not exists combat_cadence_count integer not null default 0;
alter table player_stats add column if not exists opening_speed_sum integer not null default 0;
alter table player_stats add column if not exists opening_speed_games integer not null default 0;
alter table player_stats add column if not exists endgame_accel_early integer not null default 0;
alter table player_stats add column if not exists endgame_accel_late integer not null default 0;
alter table player_stats add column if not exists think_time_sum_ms bigint not null default 0;
alter table player_stats add column if not exists think_time_count integer not null default 0;

-- Phase-binned career accumulator
alter table player_stats add column if not exists phase_career jsonb not null default '{}';

create or replace function get_game_detail(p_game_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game games%rowtype;
  v_summary json;
  v_p1 text;
  v_p2 text;
begin
  select * into v_game from games where id = p_game_id;
  if not found then
    return null;
  end if;

  select username into v_p1 from players where id = v_game.player1_id;
  select username into v_p2 from players where id = v_game.player2_id;

  select row_to_json(gs) into v_summary
  from game_summaries gs where gs.game_id = p_game_id;

  return json_build_object(
    'game_id', v_game.id,
    'status', v_game.status,
    'winner_slot', v_game.winner_slot,
    'turn_number', v_game.turn_number,
    'created_at', v_game.created_at,
    'player1_username', coalesce(v_p1, 'Anonymous'),
    'player2_username', coalesce(v_p2, 'Anonymous'),
    'summary', v_summary
  );
end;
$$;

grant execute on function get_game_detail(uuid) to anon;
```

- [ ] **Step 2: Apply migration**

Run: `cd Projects/Stratego/code && npx supabase db push --linked`

Expected: `Applying migration 0013_game_story_deep_analytics.sql... Finished`

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0013_game_story_deep_analytics.sql
git commit -m "feat: migration 0013 — game story JSONB, geography/tempo columns, phase_career"
```

---

### Task 2: Helpers + Pieces Select + Per-Game Story Block

**Files:**
- Modify: `supabase/functions/compute-stats/index.ts`
  - Extend `Move` (`created_at`) and `Piece` (`row_idx`, `col_idx`)
  - Change pieces `.select(...)` to include coordinates
  - Add helpers after `RANK_VALUE`
  - Insert story block after material curve, before `for (const slot of [1, 2])`

**Interfaces:**
- Consumes: `moves`, `pieces`, `pieceById`, `curveP1`, `totalMoves`, `R`, `RANK_VALUE`
- Produces: `story` object (phase_stats filled in Tasks 3–4); `phaseStatsBySlot` shells; helpers for Tasks 3–4

- [ ] **Step 1: Extend interfaces and change pieces select**

Replace `Move` / `Piece` and the pieces query:

```typescript
interface Move {
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
  created_at?: string;
}

interface Piece {
  id: string;
  player_slot: number;
  rank: string;
  alive: boolean;
  row_idx: number;
  col_idx: number;
}
```

```typescript
  const { data: pieces, error: piecesError } = await supabase
    .from("pieces")
    .select("id, player_slot, rank, alive, row_idx, col_idx")
    .eq("game_id", game_id);
```

- [ ] **Step 2: Add helpers after `RANK_VALUE`**

```typescript
type PhaseBin = {
  reveal_attacks: number;
  reveal_wins: number;
  trade_sum: number;
  trade_count: number;
  attacks: number;
  attack_wins: number;
  avenge_kills: number;
  avenge_opportunities: number;
};

function emptyPhaseBin(): PhaseBin {
  return {
    reveal_attacks: 0,
    reveal_wins: 0,
    trade_sum: 0,
    trade_count: 0,
    attacks: 0,
    attack_wins: 0,
    avenge_kills: 0,
    avenge_opportunities: 0,
  };
}

function emptyPhaseStats() {
  return {
    by_capture_quarter: {
      q1: emptyPhaseBin(),
      q2: emptyPhaseBin(),
      q3: emptyPhaseBin(),
      q4: emptyPhaseBin(),
    },
    by_material_state: {
      behind: emptyPhaseBin(),
      even: emptyPhaseBin(),
      ahead: emptyPhaseBin(),
      dominant: emptyPhaseBin(),
    },
    by_info_state: {
      deep_fog: emptyPhaseBin(),
      partial: emptyPhaseBin(),
      known: emptyPhaseBin(),
    },
  };
}

type PhaseStats = ReturnType<typeof emptyPhaseStats>;

function mergePhaseBin(target: PhaseBin, delta: PhaseBin): void {
  target.reveal_attacks += delta.reveal_attacks;
  target.reveal_wins += delta.reveal_wins;
  target.trade_sum += delta.trade_sum;
  target.trade_count += delta.trade_count;
  target.attacks += delta.attacks;
  target.attack_wins += delta.attack_wins;
  target.avenge_kills += delta.avenge_kills;
  target.avenge_opportunities += delta.avenge_opportunities;
}

function mergePhaseStats(target: PhaseStats, delta: PhaseStats): void {
  for (const lens of ["by_capture_quarter", "by_material_state", "by_info_state"] as const) {
    for (const key of Object.keys(target[lens])) {
      mergePhaseBin(
        target[lens][key as keyof typeof target[typeof lens]],
        delta[lens][key as keyof typeof delta[typeof lens]],
      );
    }
  }
}

function mergePhaseCareer(
  existing: Record<string, unknown> | null | undefined,
  gamePhase: PhaseStats,
): Record<string, unknown> {
  const out = JSON.parse(JSON.stringify(existing ?? {})) as Record<
    string,
    Record<string, PhaseBin>
  >;
  for (const lens of ["by_capture_quarter", "by_material_state", "by_info_state"] as const) {
    if (!out[lens]) out[lens] = {};
    for (const key of Object.keys(gamePhase[lens])) {
      if (!out[lens][key]) out[lens][key] = emptyPhaseBin();
      mergePhaseBin(
        out[lens][key],
        gamePhase[lens][key as keyof typeof gamePhase[typeof lens]],
      );
    }
  }
  return out;
}

/** Quartile of captures completed so far (captures BEFORE current combat). */
function captureQuarter(capturesSoFar: number, totalCaptures: number): "q1" | "q2" | "q3" | "q4" {
  if (totalCaptures <= 0) return "q1";
  const pct = capturesSoFar / totalCaptures;
  if (pct < 0.25) return "q1";
  if (pct < 0.5) return "q2";
  if (pct < 0.75) return "q3";
  return "q4";
}

function materialState(diff: number): "behind" | "even" | "ahead" | "dominant" {
  if (diff < -5) return "behind";
  if (diff <= 5) return "even";
  if (diff <= 15) return "ahead";
  return "dominant";
}

/** deep_fog < 5; partial 5–14; known >= 15 */
function infoState(knownCount: number): "deep_fog" | "partial" | "known" {
  if (knownCount < 5) return "deep_fog";
  if (knownCount < 15) return "partial";
  return "known";
}

/**
 * Last index where curve sign permanently flips to the final sign.
 * combatMoves = attack moves with outcomes, same order as curve samples.
 */
function findTurningPoint(
  curve: number[],
  combatMoves: Move[],
): { move_number: number; combat_index: number } | null {
  if (curve.length < 2 || combatMoves.length !== curve.length) return null;
  let lastCrossIndex: number | null = null;
  for (let i = 1; i < curve.length; i++) {
    const prev = curve[i - 1];
    const curr = curve[i];
    if (curr === 0) continue;
    if (prev === 0 || Math.sign(prev) !== Math.sign(curr)) {
      lastCrossIndex = i;
    }
  }
  if (lastCrossIndex === null) return null;
  const finalSign = Math.sign(curve[curve.length - 1]);
  if (finalSign === 0) return null;
  for (let i = lastCrossIndex; i < curve.length; i++) {
    if (curve[i] !== 0 && Math.sign(curve[i]) !== finalSign) return null;
  }
  return {
    move_number: combatMoves[lastCrossIndex].move_number,
    combat_index: lastCrossIndex,
  };
}

function invasionLane(col: number): "left" | "center" | "right" {
  if (col <= 3) return "left";
  if (col <= 5) return "center";
  return "right";
}

/** True when this combat is a capture (kill) for `slot`. */
function isCaptureForSlot(m: Move, slot: number, pieceById: Map<string, Piece>): boolean {
  if (m.move_type !== "attack" || !m.outcome) return false;
  if (m.player_slot === slot && m.outcome === "ATTACKER_WINS") return true;
  if (m.player_slot !== slot && m.outcome === "DEFENDER_WINS" && m.defender_piece_id) {
    const dp = pieceById.get(m.defender_piece_id);
    return dp?.player_slot === slot;
  }
  return false;
}
```

- [ ] **Step 3: Insert story computation after material curve (before per-slot loop)**

Place immediately after `curveP2.push(-diffP1);` / end of material-curve loop, before `for (const slot of [1, 2])`:

```typescript
  // === PER-GAME STORY (game-wide, before per-slot loop) ===
  const phaseStatsBySlot: Record<1 | 2, PhaseStats> = {
    1: emptyPhaseStats(),
    2: emptyPhaseStats(),
  };

  const combatMoves = moves.filter(
    (m: Move) => m.move_type === "attack" && m.outcome,
  ) as Move[];

  const pieceStats = new Map<
    string,
    {
      moves_made: number;
      kills: number;
      distance: number;
      first_move: number | null;
      death_move: number | null;
    }
  >();
  for (const p of pieces) {
    pieceStats.set(p.id, {
      moves_made: 0,
      kills: 0,
      distance: 0,
      first_move: null,
      death_move: null,
    });
  }

  const killChains = {
    1: { current: 0, best: 0, bestStart: 0, bestEnd: 0, curStart: 0 },
    2: { current: 0, best: 0, bestStart: 0, bestEnd: 0, curStart: 0 },
  };

  let firstCasualty: {
    rank: string;
    player_slot: number;
    move_number: number;
    killed_by_rank: string;
  } | null = null;

  // Running positions + alive-at-time (INVARIANT 4)
  const positionsByPiece = new Map<string, { row: number; col: number }>();
  // Seed with current piece coords (setup for unmoved pieces, including Flag/Bomb)
  for (const p of pieces as Piece[]) {
    positionsByPiece.set(p.id, { row: p.row_idx, col: p.col_idx });
  }
  const aliveSet = new Set((pieces as Piece[]).map((p) => p.id));
  const territoryTimeline: Array<{
    move_number: number;
    p1_in_enemy: number;
    p2_in_enemy: number;
  }> = [];

  // INVARIANT 3: bidirectional reveal sets
  const knownBySlot1 = new Set<string>();
  const knownBySlot2 = new Set<string>();
  const infoEdgeP1: number[] = [];
  const infoEdgeP2: number[] = [];

  function recordDeath(pieceId: string, moveNumber: number): void {
    const ps = pieceStats.get(pieceId);
    if (ps && ps.death_move === null) ps.death_move = moveNumber;
    aliveSet.delete(pieceId);
  }

  function bumpKillChain(winnerSlot: 1 | 2, moveNumber: number): void {
    const loserSlot = (winnerSlot === 1 ? 2 : 1) as 1 | 2;
    const kc = killChains[winnerSlot];
    kc.current++;
    if (kc.current === 1) kc.curStart = moveNumber;
    if (kc.current > kc.best) {
      kc.best = kc.current;
      kc.bestStart = kc.curStart;
      kc.bestEnd = moveNumber;
    }
    killChains[loserSlot].current = 0;
  }

  function applyCombatDeaths(m: Move): void {
    if (m.outcome === "ATTACKER_WINS" && m.defender_piece_id) {
      recordDeath(m.defender_piece_id, m.move_number);
    } else if (m.outcome === "DEFENDER_WINS") {
      recordDeath(m.piece_id, m.move_number);
    } else if (m.outcome === "TIE") {
      recordDeath(m.piece_id, m.move_number);
      if (m.defender_piece_id) recordDeath(m.defender_piece_id, m.move_number);
    }
  }

  for (const m of moves as Move[]) {
    const ps = pieceStats.get(m.piece_id);
    if (ps) {
      ps.moves_made++;
      ps.distance += Math.abs(m.to_row - m.from_row) + Math.abs(m.to_col - m.from_col);
      if (ps.first_move === null) ps.first_move = m.move_number;
    }

    positionsByPiece.set(m.piece_id, { row: m.to_row, col: m.to_col });

    if (m.move_type === "attack" && m.outcome) {
      if (!firstCasualty) {
        if (m.outcome === "ATTACKER_WINS" && m.defender_piece_id) {
          const dp = pieceById.get(m.defender_piece_id);
          if (dp) {
            firstCasualty = {
              rank: dp.rank,
              player_slot: dp.player_slot,
              move_number: m.move_number,
              killed_by_rank: m.attacker_rank ?? "?",
            };
          }
        } else if (m.outcome === "DEFENDER_WINS") {
          const ap = pieceById.get(m.piece_id);
          if (ap) {
            firstCasualty = {
              rank: ap.rank,
              player_slot: ap.player_slot,
              move_number: m.move_number,
              killed_by_rank: m.defender_rank ?? "?",
            };
          }
        } else if (m.outcome === "TIE") {
          const ap = pieceById.get(m.piece_id);
          if (ap) {
            firstCasualty = {
              rank: ap.rank,
              player_slot: ap.player_slot,
              move_number: m.move_number,
              killed_by_rank: m.defender_rank ?? "?",
            };
          }
        }
      }

      applyCombatDeaths(m);

      if (m.outcome === "ATTACKER_WINS") {
        const aps = pieceStats.get(m.piece_id);
        if (aps) aps.kills++;
        bumpKillChain(m.player_slot as 1 | 2, m.move_number);
      } else if (m.outcome === "DEFENDER_WINS") {
        if (m.defender_piece_id) {
          const dps = pieceStats.get(m.defender_piece_id);
          if (dps) dps.kills++;
        }
        const defSlot = (m.player_slot === 1 ? 2 : 1) as 1 | 2;
        bumpKillChain(defSlot, m.move_number);
      } else {
        killChains[1].current = 0;
        killChains[2].current = 0;
      }

      // Info Edge — attacker learns defender; defender learns attacker
      if (m.player_slot === 1) {
        if (m.defender_piece_id) knownBySlot1.add(m.defender_piece_id);
        knownBySlot2.add(m.piece_id);
      } else {
        if (m.defender_piece_id) knownBySlot2.add(m.defender_piece_id);
        knownBySlot1.add(m.piece_id);
      }
      infoEdgeP1.push(knownBySlot1.size - knownBySlot2.size);
      infoEdgeP2.push(knownBySlot2.size - knownBySlot1.size);
    }

    // Territory sample AFTER combat deaths (INVARIANT 4)
    if (m.move_number % 20 === 0 || m.move_number === totalMoves) {
      let p1InEnemy = 0;
      let p2InEnemy = 0;
      for (const [pid, pos] of positionsByPiece) {
        if (!aliveSet.has(pid)) continue;
        const piece = pieceById.get(pid);
        if (!piece) continue;
        if (piece.player_slot === 1 && pos.row <= 4) p1InEnemy++;
        if (piece.player_slot === 2 && pos.row >= 5) p2InEnemy++;
      }
      territoryTimeline.push({
        move_number: m.move_number,
        p1_in_enemy: p1InEnemy,
        p2_in_enemy: p2InEnemy,
      });
    }
  }

  // Flag proximity: Flag never moves — use pieces.row_idx / col_idx directly
  const flagProximity: Record<1 | 2, number | null> = { 1: null, 2: null };
  for (const s of [1, 2] as const) {
    const flag = (pieces as Piece[]).find((p) => p.player_slot === s && p.rank === R.FLAG);
    if (!flag) continue;
    for (const m of moves as Move[]) {
      if (m.player_slot === s) continue;
      const dist =
        Math.abs(m.to_row - flag.row_idx) + Math.abs(m.to_col - flag.col_idx);
      if (flagProximity[s] === null || dist < (flagProximity[s] as number)) {
        flagProximity[s] = dist;
      }
    }
  }

  // Think times (cap 10 min; skip non-positive / overnight gaps)
  const p1Think: number[] = [];
  const p2Think: number[] = [];
  for (let i = 1; i < moves.length; i++) {
    const prev = moves[i - 1] as Move;
    const curr = moves[i] as Move;
    if (!prev.created_at || !curr.created_at) continue;
    const diff =
      new Date(curr.created_at).getTime() - new Date(prev.created_at).getTime();
    if (diff <= 0 || diff >= 600_000) continue;
    if (curr.player_slot === 1) p1Think.push(diff);
    else p2Think.push(diff);
  }

  const thinkTimes =
    p1Think.length > 0 || p2Think.length > 0
      ? {
          p1_avg_ms: p1Think.length
            ? Math.round(p1Think.reduce((a, b) => a + b, 0) / p1Think.length)
            : null,
          p2_avg_ms: p2Think.length
            ? Math.round(p2Think.reduce((a, b) => a + b, 0) / p2Think.length)
            : null,
          p1_max_ms: p1Think.length ? Math.max(...p1Think) : null,
          p2_max_ms: p2Think.length ? Math.max(...p2Think) : null,
        }
      : null;

  const pieceCareers = (pieces as Piece[]).map((p) => {
    const s = pieceStats.get(p.id)!;
    return {
      piece_id: p.id,
      player_slot: p.player_slot,
      rank: p.rank,
      moves_made: s.moves_made,
      kills: s.kills,
      distance: s.distance,
      first_move: s.first_move,
      death_move: s.death_move,
      alive: p.alive,
    };
  });

  const mvpCandidate = [...pieceCareers].sort((a, b) => b.kills - a.kills)[0] ?? null;
  const turningPoint = findTurningPoint(curveP1, combatMoves);

  const story: Record<string, unknown> = {
    turning_point: turningPoint,
    mvp:
      mvpCandidate && mvpCandidate.kills > 0
        ? {
            piece_id: mvpCandidate.piece_id,
            player_slot: mvpCandidate.player_slot,
            rank: mvpCandidate.rank,
            kills: mvpCandidate.kills,
          }
        : null,
    piece_careers: pieceCareers,
    kill_chains: {
      slot1: {
        length: killChains[1].best,
        start_move: killChains[1].bestStart,
        end_move: killChains[1].bestEnd,
      },
      slot2: {
        length: killChains[2].best,
        start_move: killChains[2].bestStart,
        end_move: killChains[2].bestEnd,
      },
    },
    first_casualty: firstCasualty,
    flag_proximity: { slot1: flagProximity[1], slot2: flagProximity[2] },
    territory_timeline: territoryTimeline,
    think_times: thinkTimes,
    info_edge_curve: { slot1: infoEdgeP1, slot2: infoEdgeP2 },
    // phase_stats filled after per-slot loop (Task 3–4)
  };
```

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/compute-stats/index.ts
git commit -m "feat: story block — Flag coords from row_idx/col_idx, careers, territory, info edge"
```

---

### Task 3: Phase-Binned Stats with Avenge (Inside Per-Slot Loop)

**Files:**
- Modify: `supabase/functions/compute-stats/index.ts` — insert after comeback delta (`comebackDelta = …`), before combat heatmap

**Interfaces:**
- Consumes: `moves`, `slot`, `pieceById`, helpers from Task 2
- Produces: `gamePhaseStats` for this slot (including avenge); merged into `phaseStatsBySlot[slot]`

- [ ] **Step 1: Add phase-bin accumulator (captures, pre-combat bins, initiation-only attacks, avenge)**

```typescript
    // === PHASE-BINNED STATS (per-slot) ===
    // INVARIANT 1: total captures = attack kills + defense kills
    let totalSlotCaptures = 0;
    for (const m of moves as Move[]) {
      if (isCaptureForSlot(m, slot, pieceById)) totalSlotCaptures++;
    }

    const gamePhaseStats = emptyPhaseStats();
    let runningMaterialDiff = 0; // BEFORE current combat (Lens 2)
    let runningCaptures = 0; // captures completed BEFORE current combat (Lens 1)
    const slotKnownEnemy = new Set<string>(); // known BEFORE current combat (Lens 3)
    // Avenge tracking — same semantics as reveal-set replay career counters
    const killedByEnemy = new Map<string, string[]>();

    for (const m of moves as Move[]) {
      if (m.move_type !== "attack" || !m.outcome) continue;

      const attackerVal = RANK_VALUE[m.attacker_rank ?? ""] ?? 0;
      const defenderVal = RANK_VALUE[m.defender_rank ?? ""] ?? 0;
      const isMyAttack = m.player_slot === slot;
      const isEnemyAttack = m.player_slot !== slot;

      let iAmDefender = false;
      if (isEnemyAttack && m.defender_piece_id) {
        const dp = pieceById.get(m.defender_piece_id);
        iAmDefender = dp?.player_slot === slot;
      }

      if (!isMyAttack && !iAmDefender) continue;

      // ---- BIN FIRST (INVARIANT 2 + 7: pre-combat material / known count) ----
      const q = captureQuarter(runningCaptures, totalSlotCaptures);
      const ms = materialState(runningMaterialDiff);
      const fog = infoState(slotKnownEnemy.size);
      const bins: PhaseBin[] = [
        gamePhaseStats.by_capture_quarter[q],
        gamePhaseStats.by_material_state[ms],
        gamePhaseStats.by_info_state[fog],
      ];

      if (isMyAttack) {
        // INVARIANT 5: attacks / attack_wins only when WE initiated
        const wasUnknown = m.defender_piece_id
          ? !slotKnownEnemy.has(m.defender_piece_id)
          : false;
        let tradeDelta = 0;
        if (m.outcome === "ATTACKER_WINS") tradeDelta = defenderVal;
        else if (m.outcome === "DEFENDER_WINS") tradeDelta = -attackerVal;
        else tradeDelta = -attackerVal; // TIE — match existing trade loop

        for (const b of bins) {
          b.attacks++;
          if (m.outcome === "ATTACKER_WINS") b.attack_wins++;
          if (wasUnknown) {
            b.reveal_attacks++;
            if (m.outcome === "ATTACKER_WINS") b.reveal_wins++;
          }
          b.trade_sum += tradeDelta;
          b.trade_count++;
        }

        // Avenge kill as attacker: kill an enemy that previously killed one of ours
        if (
          m.outcome === "ATTACKER_WINS" &&
          m.defender_piece_id &&
          killedByEnemy.has(m.defender_piece_id)
        ) {
          for (const b of bins) b.avenge_kills++;
        }
      } else if (iAmDefender) {
        // Defense: trade only — never attacks / attack_wins
        let tradeDelta = 0;
        if (m.outcome === "DEFENDER_WINS") tradeDelta = attackerVal;
        else if (m.outcome === "ATTACKER_WINS") tradeDelta = -defenderVal;
        else tradeDelta = -defenderVal;

        for (const b of bins) {
          b.trade_sum += tradeDelta;
          b.trade_count++;
        }

        // Avenge opportunity: enemy piece kills one of ours
        if (m.outcome === "ATTACKER_WINS" && m.defender_piece_id) {
          if (!killedByEnemy.has(m.piece_id)) killedByEnemy.set(m.piece_id, []);
          killedByEnemy.get(m.piece_id)!.push(m.defender_piece_id);
          for (const b of bins) b.avenge_opportunities++;
        }

        // Avenge kill as defender: our piece kills that marked enemy attacker
        if (m.outcome === "DEFENDER_WINS" && killedByEnemy.has(m.piece_id)) {
          for (const b of bins) b.avenge_kills++;
        }
      }

      // ---- THEN UPDATE STATE ----
      if (isMyAttack) {
        if (m.outcome === "ATTACKER_WINS") runningMaterialDiff += defenderVal;
        else if (m.outcome === "DEFENDER_WINS") runningMaterialDiff -= attackerVal;
        else {
          runningMaterialDiff -= attackerVal;
          runningMaterialDiff += defenderVal;
        }
      } else if (iAmDefender) {
        if (m.outcome === "ATTACKER_WINS") runningMaterialDiff -= defenderVal;
        else if (m.outcome === "DEFENDER_WINS") runningMaterialDiff += attackerVal;
        else {
          runningMaterialDiff += attackerVal;
          runningMaterialDiff -= defenderVal;
        }
      }

      if (isCaptureForSlot(m, slot, pieceById)) runningCaptures++;

      if (isMyAttack && m.defender_piece_id) {
        slotKnownEnemy.add(m.defender_piece_id);
      } else if (iAmDefender) {
        slotKnownEnemy.add(m.piece_id);
      }
    }

    mergePhaseStats(phaseStatsBySlot[slot as 1 | 2], gamePhaseStats);
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/compute-stats/index.ts
git commit -m "feat: phase bins — pre-combat lenses, avenge_kills/opportunities, known>=15"
```

---

### Task 4: Career Geography, Tempo, phase_career + Story Upsert

**Files:**
- Modify: `supabase/functions/compute-stats/index.ts`
  - Geography/tempo after Task 3 block
  - Fields on existing `player_stats` `.update()`
  - After loop: attach `phase_stats` to `story` and upsert

**Interfaces:**
- Consumes: `playerMoves`, `moves`, `slot`, `totalMoves`, `gamePhaseStats`, `stats`, `phaseStatsBySlot`, `story`, `curveP1`, `curveP2`
- Produces: updated `player_stats` columns; `game_summaries.story` with `phase_stats`

- [ ] **Step 1: Compute geography and tempo (after phase-bin block)**

```typescript
    // === BOARD GEOGRAPHY ===
    let flankLeft = 0;
    let flankRight = 0;
    let lakeCorridor = 0;
    let defenseDepthSum = 0;
    let defenseDepthCount = 0;
    for (const m of playerMoves as Move[]) {
      if (m.to_col <= 4) flankLeft++;
      else flankRight++;
      if (m.to_col === 4 || m.to_col === 5) lakeCorridor++;
      if (m.move_type === "attack") {
        const homeRow = slot === 1 ? 9 : 0;
        defenseDepthSum += Math.abs(m.to_row - homeRow);
        defenseDepthCount++;
      }
    }

    let invasionLaneKey: "left" | "center" | "right" | null = null;
    for (const m of playerMoves as Move[]) {
      if (slot === 1 && m.to_row <= 4) {
        invasionLaneKey = invasionLane(m.to_col);
        break;
      }
      if (slot === 2 && m.to_row >= 5) {
        invasionLaneKey = invasionLane(m.to_col);
        break;
      }
    }

    // === TEMPO & RHYTHM ===
    const myAttackMoves = (playerMoves as Move[]).filter((m) => m.move_type === "attack");
    const combatMoveNumbers = myAttackMoves.map((m) => m.move_number);
    let cadenceSum = 0;
    let cadenceCount = 0;
    for (let i = 1; i < combatMoveNumbers.length; i++) {
      cadenceSum += combatMoveNumbers[i] - combatMoveNumbers[i - 1];
      cadenceCount++;
    }
    const openingSpeed = combatMoveNumbers.length > 0 ? combatMoveNumbers[0] : null;
    const threshold75 = Math.floor(totalMoves * 0.75);
    const earlyAttacks = myAttackMoves.filter((m) => m.move_number <= threshold75).length;
    const lateAttacks = myAttackMoves.filter((m) => m.move_number > threshold75).length;

    let thinkSumMs = 0;
    let thinkCount = 0;
    for (let i = 1; i < moves.length; i++) {
      const prev = moves[i - 1] as Move;
      const curr = moves[i] as Move;
      if (curr.player_slot !== slot || !prev.created_at || !curr.created_at) continue;
      const diff =
        new Date(curr.created_at).getTime() - new Date(prev.created_at).getTime();
      if (diff > 0 && diff < 600_000) {
        thinkSumMs += diff;
        thinkCount++;
      }
    }

    const mergedPhaseCareer = mergePhaseCareer(stats.phase_career ?? {}, gamePhaseStats);
```

- [ ] **Step 2: Add fields to existing `player_stats` `.update()`**

Inside the existing `.update({ ... })` object, add:

```typescript
        flank_left_moves: (stats.flank_left_moves ?? 0) + flankLeft,
        flank_right_moves: (stats.flank_right_moves ?? 0) + flankRight,
        lake_corridor_moves: (stats.lake_corridor_moves ?? 0) + lakeCorridor,
        defense_depth_sum: Number(stats.defense_depth_sum ?? 0) + defenseDepthSum,
        defense_depth_count: (stats.defense_depth_count ?? 0) + defenseDepthCount,
        invasion_lane_left:
          (stats.invasion_lane_left ?? 0) + (invasionLaneKey === "left" ? 1 : 0),
        invasion_lane_center:
          (stats.invasion_lane_center ?? 0) + (invasionLaneKey === "center" ? 1 : 0),
        invasion_lane_right:
          (stats.invasion_lane_right ?? 0) + (invasionLaneKey === "right" ? 1 : 0),
        combat_cadence_sum: (stats.combat_cadence_sum ?? 0) + cadenceSum,
        combat_cadence_count: (stats.combat_cadence_count ?? 0) + cadenceCount,
        opening_speed_sum: (stats.opening_speed_sum ?? 0) + (openingSpeed ?? 0),
        opening_speed_games:
          (stats.opening_speed_games ?? 0) + (openingSpeed !== null ? 1 : 0),
        endgame_accel_early: (stats.endgame_accel_early ?? 0) + earlyAttacks,
        endgame_accel_late: (stats.endgame_accel_late ?? 0) + lateAttacks,
        think_time_sum_ms: Number(stats.think_time_sum_ms ?? 0) + thinkSumMs,
        think_time_count: (stats.think_time_count ?? 0) + thinkCount,
        phase_career: mergedPhaseCareer,
```

- [ ] **Step 3: Replace post-loop `game_summaries` upsert**

After the per-slot `for` loop ends (before `stats_computed = true`):

```typescript
  story.phase_stats = {
    slot1: phaseStatsBySlot[1],
    slot2: phaseStatsBySlot[2],
  };

  await supabase.from("game_summaries").upsert(
    {
      game_id,
      material_curve_p1: curveP1,
      material_curve_p2: curveP2,
      story,
    },
    { onConflict: "game_id" },
  );
```

- [ ] **Step 4: Deploy and commit**

```bash
npx supabase functions deploy compute-stats --project-ref cafqbrzaxcwewwtyqpnf
git add supabase/functions/compute-stats/index.ts
git commit -m "feat: career geography/tempo + phase_career; upsert story with phase_stats"
```

---

### Task 5: Game Detail Page — HTML, JS, CSS

**Files:**
- Create: `web/game-detail.html`
- Create: `web/js/gameDetail.js`
- Modify: `web/css/styles.css`

**Interfaces:**
- Consumes: `get_game_detail(uuid)` → `{ game_id, winner_slot, turn_number, created_at, player1_username, player2_username, summary: { story, material_curve_p1, ... } }`
- Produces: Full narrative page; material SVG with `+max` / `min` y-axis labels

- [ ] **Step 1: Create `web/game-detail.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Stratego — Game Detail</title>
  <link rel="stylesheet" href="css/styles.css" />
</head>
<body>
  <nav class="top-nav">
    <a href="index.html" class="nav-brand">Stratego</a>
    <div class="nav-links">
      <div id="nav-auth" class="nav-auth"></div>
      <a href="index.html">Home</a>
    </div>
  </nav>
  <div class="page-shell">
    <main class="page-frame game-detail-page">
      <div id="game-header"></div>
      <div id="game-story"></div>
      <div id="game-material-curve"></div>
      <div id="game-info-edge"></div>
      <div id="game-phase-stats"></div>
      <div id="game-pieces"></div>
      <div id="game-territory"></div>
      <p id="game-error" class="error" hidden></p>
    </main>
  </div>
  <script type="module" src="js/gameDetail.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create `web/js/gameDetail.js`**

```javascript
import { supabase } from "./supabaseClient.js";
import { renderNavAuth } from "./auth.js";

renderNavAuth(document.getElementById("nav-auth"));

const RANK_NAME = {
  "1": "Marshal", "2": "General", "3": "Colonel", "4": "Major",
  "5": "Captain", "6": "Lieutenant", "7": "Sergeant", "8": "Miner",
  "9": "Scout", "10": "Spy", BOMB: "Bomb", FLAG: "Flag",
};

const params = new URLSearchParams(location.search);
const gameId = params.get("id");
const viewSlot = Number(params.get("slot") || "1");

if (!gameId) {
  document.getElementById("game-error").textContent = "No game ID specified";
  document.getElementById("game-error").hidden = false;
} else {
  loadGameDetail(gameId);
}

async function loadGameDetail(id) {
  const { data, error } = await supabase.rpc("get_game_detail", { p_game_id: id });
  if (error || !data?.summary) {
    document.getElementById("game-error").textContent =
      "Game not found or no summary available";
    document.getElementById("game-error").hidden = false;
    return;
  }

  const story = data.summary.story || {};
  const curveP1 = data.summary.material_curve_p1 || [];

  renderHeader(data);
  renderStoryHighlights(data, story, viewSlot);
  renderMaterialCurve(curveP1, story.turning_point, viewSlot);
  renderInfoEdge(story.info_edge_curve, viewSlot);
  renderPhaseStats(story.phase_stats, viewSlot);
  renderPieceCareers(story.piece_careers || [], viewSlot);
  renderTerritory(story.territory_timeline || []);
}

function slotLabel(slot, data) {
  return slot === 1 ? data.player1_username : data.player2_username;
}

function renderHeader(data) {
  const winner = data.winner_slot ? slotLabel(data.winner_slot, data) : "Draw";
  const el = document.getElementById("game-header");
  el.innerHTML = `
    <h2>${data.player1_username} vs ${data.player2_username}</h2>
    <p class="game-detail-subtitle" data-tooltip="Rated human game — stats computed at game end">
      ${winner === "Draw" ? "Draw" : `${winner} wins`} · ${data.turn_number ?? "—"} moves · ${new Date(data.created_at).toLocaleString()}
    </p>
    <p class="game-detail-view-toggle">
      Viewing as:
      <a href="?id=${gameId}&slot=1" class="${viewSlot === 1 ? "active" : ""}">${data.player1_username}</a>
      ·
      <a href="?id=${gameId}&slot=2" class="${viewSlot === 2 ? "active" : ""}">${data.player2_username}</a>
    </p>
  `;
}

function renderStoryHighlights(data, story, slot) {
  const el = document.getElementById("game-story");
  const highlights = [];
  const name = slotLabel(slot, data);
  const careers = (story.piece_careers || []).filter((p) => p.player_slot === slot);
  const enemyCareers = (story.piece_careers || []).filter((p) => p.player_slot !== slot);

  const mvp = [...careers].sort((a, b) => b.kills - a.kills)[0];
  if (mvp?.kills > 0) {
    highlights.push({
      icon: "⭐",
      text: `${name}'s MVP: ${RANK_NAME[mvp.rank] || "?"} — ${mvp.kills} kills, ${mvp.moves_made} moves`,
      tooltip: "Your piece with the most kills this game",
    });
  }

  const deadliestEnemy = [...enemyCareers].sort((a, b) => b.kills - a.kills)[0];
  if (deadliestEnemy?.kills > 0) {
    highlights.push({
      icon: "💀",
      text: `Most dangerous enemy: ${RANK_NAME[deadliestEnemy.rank] || "?"} killed ${deadliestEnemy.kills} of yours`,
      tooltip: "Enemy piece that eliminated the most of your army",
    });
  }

  const kc = story.kill_chains?.[`slot${slot}`];
  if (kc?.length >= 3) {
    highlights.push({
      icon: "🔥",
      text: `${name} went on a ${kc.length}-kill streak (moves ${kc.start_move}–${kc.end_move})`,
      tooltip: "Longest streak of consecutive combat wins without the opponent getting a kill",
    });
  }

  if (story.turning_point) {
    highlights.push({
      icon: "📈",
      text: `Turning point at combat #${story.turning_point.combat_index + 1} (move ${story.turning_point.move_number}) — material lead never changed after`,
      tooltip: "Last combat where rank-value advantage permanently flipped",
    });
  }

  const fp = story.flag_proximity?.[`slot${slot}`];
  if (fp !== null && fp !== undefined && fp <= 5) {
    highlights.push({
      icon: "🚩",
      text: `Enemy got within ${fp} square${fp === 1 ? "" : "s"} of your Flag`,
      tooltip: "Minimum Manhattan distance from any enemy move destination to your Flag's board coordinates",
    });
  }

  const fc = story.first_casualty;
  if (fc) {
    highlights.push({
      icon: "🩸",
      text: `First blood: ${RANK_NAME[fc.killed_by_rank] || "?"} killed ${slotLabel(fc.player_slot, data)}'s ${RANK_NAME[fc.rank] || "?"} at move ${fc.move_number}`,
      tooltip: "First piece eliminated in combat",
    });
  }

  const tt = story.think_times;
  const avgKey = slot === 1 ? "p1_avg_ms" : "p2_avg_ms";
  const maxKey = slot === 1 ? "p1_max_ms" : "p2_max_ms";
  if (tt?.[avgKey]) {
    highlights.push({
      icon: "⏱️",
      text: `${name} avg think time: ${(tt[avgKey] / 1000).toFixed(1)}s (max ${(tt[maxKey] / 1000).toFixed(0)}s)`,
      tooltip: "Time between consecutive moves (capped at 10 min — overnight gaps ignored)",
    });
  }

  el.innerHTML = `
    <h3>Story Highlights</h3>
    <div class="story-highlights">
      ${highlights.map((h) => `
        <div class="highlight-item">
          <span class="highlight-icon">${h.icon}</span>
          <span class="highlight-text">${h.text}</span>
          <span class="stat-help" data-tooltip="${h.tooltip}">?</span>
        </div>
      `).join("") || "<p class=\"muted\">No highlights for this perspective.</p>"}
    </div>
  `;
}

/**
 * Line chart with y-axis labels (+max / min), matching gameSummary.js sparkline convention.
 */
function renderLineChart(elId, title, tooltip, series, markerIndex) {
  const el = document.getElementById(elId);
  if (!series?.length) return;
  const w = 520;
  const h = 150;
  const pad = 16;
  const labelPad = 36;
  const min = Math.min(0, ...series);
  const max = Math.max(0, ...series);
  const range = max - min || 1;
  const yPos = (v) => pad + (1 - (v - min) / range) * (h - 2 * pad);
  const xPos = (i) => labelPad + (i / Math.max(series.length - 1, 1)) * (w - labelPad - pad);
  const points = series.map((v, i) => `${xPos(i)},${yPos(v)}`).join(" ");
  const zeroY = yPos(0);
  const topLabel = max > 0 ? `+${max}` : `${max}`;
  const botLabel = `${min}`;
  let marker = "";
  if (markerIndex != null && markerIndex >= 0 && markerIndex < series.length) {
    const mx = xPos(markerIndex);
    marker = `<line x1="${mx}" y1="${pad}" x2="${mx}" y2="${h - pad}" stroke="rgba(255,200,50,0.7)" stroke-width="1" stroke-dasharray="3,3"/>`;
  }
  el.innerHTML = `
    <h3>${title} <span class="stat-help" data-tooltip="${tooltip}">?</span></h3>
    <svg viewBox="0 0 ${w} ${h}" class="detail-curve">
      <text x="2" y="${pad + 4}" font-size="10" fill="rgba(255,255,255,0.45)">${topLabel}</text>
      <text x="2" y="${h - pad + 2}" font-size="10" fill="rgba(255,255,255,0.45)">${botLabel}</text>
      <line x1="${labelPad}" y1="${zeroY}" x2="${w - pad}" y2="${zeroY}" stroke="rgba(255,255,255,0.25)" stroke-width="0.5" stroke-dasharray="3,3"/>
      <polyline points="${points}" fill="none" stroke="rgba(100,200,150,0.9)" stroke-width="2" stroke-linejoin="round"/>
      ${marker}
    </svg>
  `;
}

function renderMaterialCurve(curveP1, turningPoint, slot) {
  const curve = slot === 1 ? curveP1 : curveP1.map((v) => -v);
  renderLineChart(
    "game-material-curve",
    "Material Curve",
    "Rank-value advantage after each combat. Above zero = you are ahead. Y-axis shows peak and trough.",
    curve,
    turningPoint?.combat_index ?? null,
  );
}

function renderInfoEdge(infoEdge, slot) {
  const series = infoEdge?.[`slot${slot}`] || [];
  renderLineChart(
    "game-info-edge",
    "Information Edge",
    "Known enemy pieces minus pieces the enemy knows about you, after each combat. Positive = you hold the fog advantage.",
    series,
    null,
  );
}

function pct(num, den) {
  return den > 0 ? `${((num / den) * 100).toFixed(0)}%` : "—";
}

function renderPhaseStats(phaseStats, slot) {
  const el = document.getElementById("game-phase-stats");
  const ps = phaseStats?.[`slot${slot}`];
  if (!ps) return;
  const rows = ["q1", "q2", "q3", "q4"].map((q) => {
    const b = ps.by_capture_quarter[q];
    return `<tr>
      <td>${q.toUpperCase()}</td>
      <td>${pct(b.reveal_wins, b.reveal_attacks)}</td>
      <td>${b.trade_count ? (b.trade_sum / b.trade_count).toFixed(1) : "—"}</td>
      <td>${pct(b.attack_wins, b.attacks)}</td>
      <td>${pct(b.avenge_kills, b.avenge_opportunities)}</td>
      <td>${b.attacks}</td>
    </tr>`;
  }).join("");
  el.innerHTML = `
    <h3>Phase Breakdown <span class="stat-help" data-tooltip="Metrics binned by capture quartile — Q1 is opening fog, Q4 is endgame. Captures = attack kills + defense kills. Attack WR only counts combats you initiated. Avenge = kill a piece that previously killed yours.">?</span></h3>
    <table class="history-table phase-table">
      <thead><tr><th>Phase</th><th>Reveal Eff</th><th>Trade Eff</th><th>Attack WR</th><th>Avenge</th><th>Attacks</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderPieceCareers(careers, slot) {
  const el = document.getElementById("game-pieces");
  const notable = careers
    .filter((p) => p.player_slot === slot && (p.kills > 0 || p.moves_made >= 10))
    .sort((a, b) => b.kills - a.kills || b.moves_made - a.moves_made);
  if (!notable.length) return;
  el.innerHTML = `
    <h3>Piece Careers <span class="stat-help" data-tooltip="Notable pieces — kills > 0 or 10+ moves. All 80 pieces tracked; only standouts shown.">?</span></h3>
    <table class="history-table piece-career-table">
      <thead><tr><th>Piece</th><th>Kills</th><th>Moves</th><th>Distance</th><th>Status</th></tr></thead>
      <tbody>
        ${notable.slice(0, 12).map((p) => `
          <tr>
            <td>${RANK_NAME[p.rank] || p.rank}</td>
            <td>${p.kills}</td>
            <td>${p.moves_made}</td>
            <td>${p.distance} sq</td>
            <td>${p.alive ? "Survived" : `Died move ${p.death_move}`}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function renderTerritory(timeline) {
  if (!timeline || timeline.length < 2) return;
  const el = document.getElementById("game-territory");
  const w = 520;
  const h = 110;
  const pad = 16;
  const labelPad = 28;
  const maxPieces = Math.max(
    ...timeline.map((t) => Math.max(t.p1_in_enemy, t.p2_in_enemy)),
    1,
  );
  const yPos = (v) => pad + (1 - v / maxPieces) * (h - 2 * pad);
  const xPos = (i) => labelPad + (i / Math.max(timeline.length - 1, 1)) * (w - labelPad - pad);
  const p1 = timeline.map((t, i) => `${xPos(i)},${yPos(t.p1_in_enemy)}`).join(" ");
  const p2 = timeline.map((t, i) => `${xPos(i)},${yPos(t.p2_in_enemy)}`).join(" ");
  el.innerHTML = `
    <h3>Territory Control <span class="stat-help" data-tooltip="Alive pieces in enemy half sampled every 20 moves (alive-at-sample-time, not final state). Shows invasion pressure over time.">?</span></h3>
    <svg viewBox="0 0 ${w} ${h}" class="detail-curve">
      <text x="2" y="${pad + 4}" font-size="9" fill="rgba(255,255,255,0.45)">${maxPieces}</text>
      <text x="2" y="${h - pad + 2}" font-size="9" fill="rgba(255,255,255,0.45)">0</text>
      <polyline points="${p1}" fill="none" stroke="rgba(100,200,150,0.85)" stroke-width="1.5"/>
      <polyline points="${p2}" fill="none" stroke="rgba(200,100,100,0.85)" stroke-width="1.5"/>
      <text x="${w - pad}" y="${pad}" font-size="8" fill="rgba(100,200,150,0.8)" text-anchor="end">P1 in enemy half</text>
      <text x="${w - pad}" y="${pad + 12}" font-size="8" fill="rgba(200,100,100,0.8)" text-anchor="end">P2 in enemy half</text>
    </svg>
  `;
}
```

- [ ] **Step 3: Append CSS to `web/css/styles.css`**

```css
.game-detail-page { max-width: 640px; }
.game-detail-subtitle { font-size: 0.85rem; opacity: 0.7; margin-bottom: 0.5rem; }
.game-detail-view-toggle { font-size: 0.8rem; margin-bottom: 1rem; }
.game-detail-view-toggle a { opacity: 0.6; }
.game-detail-view-toggle a.active { opacity: 1; font-weight: 600; }
.story-highlights { display: flex; flex-direction: column; gap: 0.5rem; margin-bottom: 1.25rem; }
.highlight-item { display: flex; align-items: center; gap: 0.5rem; padding: 0.45rem 0.65rem; background: rgba(255,255,255,0.04); border-radius: 4px; }
.highlight-icon { font-size: 1.05rem; }
.highlight-text { font-size: 0.85rem; flex: 1; }
.detail-curve { width: 100%; height: auto; max-height: 170px; margin: 0.25rem 0 1.25rem; }
.piece-career-table, .phase-table { font-size: 0.8rem; }
.piece-career-table td, .piece-career-table th,
.phase-table td, .phase-table th { padding: 0.35rem 0.5rem; }
.history-table tr.clickable-row { cursor: pointer; }
.history-table tr.clickable-row:hover { background: rgba(255,255,255,0.04); }
```

- [ ] **Step 4: Commit**

```bash
git add web/game-detail.html web/js/gameDetail.js web/css/styles.css
git commit -m "feat: game detail page — narrative, y-axis curve labels, phase avenge column"
```

---

### Task 6: Profile — Board Geography + Tempo & Rhythm

**Files:**
- Modify: `web/js/profile.js`

**Interfaces:**
- Consumes: new `player_stats` columns from Task 1 / Task 4
- Produces: two new section objects after "Combat Economy" in `renderStats`

- [ ] **Step 1: Add invasion-route entropy helper before `renderStats`**

```javascript
function invasionEntropy(left, center, right) {
  const total = left + center + right;
  if (total < 3) return "—";
  const probs = [left, center, right].map((c) => c / total).filter((p) => p > 0);
  const entropy = -probs.reduce((s, p) => s + p * Math.log2(p), 0);
  const maxEntropy = Math.log2(3);
  const normalized = entropy / maxEntropy;
  return normalized < 0.5 ? "Predictable" : normalized < 0.85 ? "Mixed" : "Varied";
}
```

- [ ] **Step 2: Insert sections in `renderStats` immediately after the "Combat Economy" section object**

```javascript
    { title: "Board Geography", items: [
      ["Flank Preference", (stats.flank_left_moves + stats.flank_right_moves) > 0
        ? `${((stats.flank_left_moves / (stats.flank_left_moves + stats.flank_right_moves)) * 100).toFixed(0)}% Left`
        : "—",
        "Share of moves on columns 0–4 (left) vs 5–9 (right) — reveals side bias"],
      ["Lake Corridor", stats.total_moves > 0
        ? `${((stats.lake_corridor_moves / stats.total_moves) * 100).toFixed(0)}%`
        : "—",
        "Moves ending in columns 4–5 — the center gap between lakes"],
      ["Defense Depth", stats.defense_depth_count > 0
        ? `${(Number(stats.defense_depth_sum) / stats.defense_depth_count).toFixed(1)} rows from home`
        : "—",
        "Average distance from your back row when you initiate combat — low = defensive, high = deep strikes"],
      ["Invasion Route", invasionEntropy(stats.invasion_lane_left ?? 0, stats.invasion_lane_center ?? 0, stats.invasion_lane_right ?? 0),
        "Entropy of first entry column into enemy territory across games — predictable vs varied routes"],
    ]},
    { title: "Tempo & Rhythm", items: [
      ["Combat Cadence", stats.combat_cadence_count > 0
        ? `${(stats.combat_cadence_sum / stats.combat_cadence_count).toFixed(0)} moves apart`
        : "—",
        "Average moves between your consecutive attacks"],
      ["Opening Speed", stats.opening_speed_games > 0
        ? `Move ${Math.round(stats.opening_speed_sum / stats.opening_speed_games)}`
        : "—",
        "Average move number of your first attack — early = aggressive opener"],
      ["Endgame Acceleration", (stats.endgame_accel_early + stats.endgame_accel_late) > 0
        ? `${((stats.endgame_accel_late / (stats.endgame_accel_early + stats.endgame_accel_late)) * 100).toFixed(0)}% in final quarter`
        : "—",
        "Share of your attacks in the last 25% of game moves"],
      ["Think Time", stats.think_time_count > 0
        ? `${(Number(stats.think_time_sum_ms) / stats.think_time_count / 1000).toFixed(1)}s avg`
        : "—",
        "Average time between your moves when timestamps are meaningful (10 min cap)"],
    ]},
```

- [ ] **Step 3: Commit**

```bash
git add web/js/profile.js
git commit -m "feat: profile Board Geography + Tempo & Rhythm sections with tooltips"
```

---

### Task 7: History Links to Game Detail

**Files:**
- Modify: `web/js/profile.js` (`loadHistory`)

**Interfaces:**
- Consumes: `g.game_id`, `g.player_slot` from `get_game_history`
- Produces: clickable history rows → `game-detail.html?id=<game_id>&slot=<player_slot>`

- [ ] **Step 1: Update history table row markup in `loadHistory`**

Replace the existing `return \`<tr>...` template with:

```javascript
          return `<tr class="clickable-row" onclick="location.href='game-detail.html?id=${g.game_id}&slot=${g.player_slot}'">
            <td><a href="profile.html?user=${encodeURIComponent(g.opponent_username || "Anonymous")}" onclick="event.stopPropagation()">${g.opponent_username || "Anonymous"}</a></td>
            <td class="${cls}">${result}</td>
            <td>${g.turn_number || "—"}</td>
            <td class="curve-cell" data-game-id="${g.game_id}" data-player-slot="${g.player_slot}">—</td>
            <td><a href="game-detail.html?id=${g.game_id}&slot=${g.player_slot}" onclick="event.stopPropagation()">${new Date(g.created_at).toLocaleDateString()}</a></td>
          </tr>`;
```

- [ ] **Step 2: Commit**

```bash
git add web/js/profile.js
git commit -m "feat: game history rows link to game-detail page"
```

---

### Task 8: Deploy, Reset, Backfill, Verify

**Files:**
- Create: `scripts/backfill-stats.sh`
- Deploy all prior tasks

- [ ] **Step 1: Push frontend + apply migration + deploy function**

```bash
cd Projects/Stratego/code
git push
npx supabase db push --linked
npx supabase functions deploy compute-stats --project-ref cafqbrzaxcwewwtyqpnf
```

Expected: migration applied; function deploy succeeds; frontend live after push.

- [ ] **Step 2: Reset new columns and recompute flags (Supabase SQL editor)**

```sql
UPDATE player_stats SET
  flank_left_moves = 0, flank_right_moves = 0, lake_corridor_moves = 0,
  defense_depth_sum = 0, defense_depth_count = 0,
  invasion_lane_left = 0, invasion_lane_center = 0, invasion_lane_right = 0,
  combat_cadence_sum = 0, combat_cadence_count = 0,
  opening_speed_sum = 0, opening_speed_games = 0,
  endgame_accel_early = 0, endgame_accel_late = 0,
  think_time_sum_ms = 0, think_time_count = 0,
  phase_career = '{}';

UPDATE games SET stats_computed = false
WHERE status = 'finished' AND is_bot_game = false;

DELETE FROM game_summaries;
```

- [ ] **Step 3: Create and run backfill script**

Write `scripts/backfill-stats.sh`:

```bash
#!/usr/bin/env bash
# scripts/backfill-stats.sh
set -euo pipefail
cd "$(dirname "$0")/.."
PROJECT_REF="cafqbrzaxcwewwtyqpnf"
SERVICE_KEY="${SUPABASE_SERVICE_ROLE_KEY:?Set SUPABASE_SERVICE_ROLE_KEY}"
URL="${SUPABASE_URL:?Set SUPABASE_URL}"

GAME_IDS=$(curl -s "$URL/rest/v1/games?status=eq.finished&is_bot_game=eq.false&stats_computed=eq.false&select=id" \
  -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" | jq -r '.[].id')

for id in $GAME_IDS; do
  echo "Computing $id..."
  curl -s -X POST "$URL/functions/v1/compute-stats" \
    -H "Authorization: Bearer $SERVICE_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"game_id\":\"$id\"}" | jq -c .
done
```

Run:

```bash
chmod +x scripts/backfill-stats.sh
SUPABASE_URL=https://cafqbrzaxcwewwtyqpnf.supabase.co \
  SUPABASE_SERVICE_ROLE_KEY=... \
  ./scripts/backfill-stats.sh
```

Expected: each game returns `{"ok":true}` (or a documented skip).

- [ ] **Step 4: Verify game detail page**

Navigate to `game-detail.html?id=<finished_rated_game_id>&slot=1`.

Expected:
- Header with both usernames, result, move count
- Story highlights including Flag proximity (when ≤5)
- Material curve SVG with **y-axis labels** (`+max` at top, `min` at bottom) and turning-point marker
- Information edge SVG with y-axis labels
- Phase breakdown table with Avenge column
- Piece careers + territory chart

- [ ] **Step 5: Verify review-bug invariants (SQL)**

```sql
select
  story->'flag_proximity' as flag_prox,
  story->'phase_stats'->'slot1'->'by_info_state' as info_bins,
  story->'phase_stats'->'slot1'->'by_capture_quarter'->'q1' as q1_bin,
  story->'info_edge_curve'->'slot1' as edge
from game_summaries
where game_id = '<game_id>';
```

Manual checks:
- `flag_proximity.slot1` is an integer Manhattan distance (or null only if no Flag row) — computed from Flag `row_idx`/`col_idx`, not inferred
- Info bins: pieces known at 15 land in `known`, not `partial`
- `q1_bin` has both `avenge_kills` and `avenge_opportunities` keys (numbers ≥ 0)
- Sum of `attacks` across Q1–Q4 equals that player's initiated attack count
- Sum of `attack_wins` ≤ sum of `attacks`
- `info_edge_curve.slot1` length equals combat count

- [ ] **Step 6: Verify profile sections**

Navigate to `profile.html?user=<username>`.

Expected:
- "Board Geography" and "Tempo & Rhythm" after Combat Economy, each item with `?` tooltip
- History rows navigate to game detail; sparkline still renders; opponent links use `stopPropagation`

- [ ] **Step 7: Commit backfill script and push**

```bash
git add scripts/backfill-stats.sh
git commit -m "chore: backfill script for deep analytics recompute"
git push
```

---

## Self-Review

### 1. Spec coverage

| Design spec requirement | Task |
|-------------------------|------|
| `story` JSONB on game_summaries | Task 1 |
| Turning point, MVP, kill chain, first casualty, flag proximity, think times, territory | Task 2 |
| Piece careers (all 80; UI filters notable) | Task 2 + Task 5 |
| Information Edge Curve (bidirectional Sets) | Task 2 + Task 5 |
| Phase-binned stats (3 lenses) in story | Task 3 |
| Capture quartiles = attack+defense kills | Task 3 (`isCaptureForSlot`) |
| Material-state bin pre-combat | Task 3 |
| Info state: deep_fog `<5`, partial `5–14`, known `>=15` | Task 2 `infoState` + Task 3 |
| Avenge Rate phase-binned | Task 3 (`avenge_kills` / `avenge_opportunities`) |
| Territory alive-at-sample-time | Task 2 (`aliveSet`) |
| Flag proximity from Flag coordinates | Task 2 (pieces select + `row_idx`/`col_idx`) |
| Material curve y-axis labels | Task 5 (`renderLineChart`) |
| `phase_career` career accumulator | Task 1 + Task 4 |
| Board Geography career stats | Task 1 + Task 4 + Task 6 |
| Tempo & Rhythm career stats | Task 1 + Task 4 + Task 6 |
| Game detail layout | Task 5 |
| Profile sections after Combat Economy | Task 6 |
| History links | Task 7 |
| Deploy + reset + backfill | Task 8 |
| Information Warfare profile Big 6 | Out of scope — IW plan (0014) |
| Unknown Pressure / Memory Score phase bins | Out of scope until IW/memory ledger lands |

### 2. Placeholder scan

No TBD/TODO/"similar to Task N"/empty stubs. All SQL, TypeScript, HTML, CSS, and shell are complete in-step.

### 3. Type / naming consistency

- `phaseStatsBySlot` → `story.phase_stats.slot1/slot2` → `gameDetail.js` `phaseStats?.[\`slot${slot}\`]`
- `PhaseBin` fields: `reveal_*`, `trade_*`, `attacks`, `attack_wins`, `avenge_kills`, `avenge_opportunities` — merged in `mergePhaseBin` / `mergePhaseCareer`
- `info_edge_curve.slot1/slot2` length = combat count
- `turning_point.combat_index` is 0-based into the curve
- Career column names match migration ↔ compute-stats update ↔ profile.js
- `get_game_detail` returns `{ summary: { story, material_curve_p1, ... } }`

### 4. Review-bug re-check

| # | Bug | Enforcement |
|---|-----|-------------|
| 1 | Flag proximity | `.select("…, row_idx, col_idx")`; Flag pos = `flag.row_idx`/`flag.col_idx`; no move inference |
| 2 | Info boundary | `infoState`: `<5` / `<15` / else (`>=15` → known) |
| 3 | Phase avenge | `PhaseBin.avenge_*`; opportunity on enemy kill-of-ours; kill when that enemy dies to us |
| 4 | Y-axis labels | `renderLineChart` `topLabel`/`botLabel` text nodes, same convention as `gameSummary.js` |

### 5. Invariants re-check

| # | Invariant | Where enforced |
|---|-----------|----------------|
| 1 | Capture = attack kill OR defense kill | `isCaptureForSlot` + `totalSlotCaptures` / `runningCaptures` |
| 2 | Material bin before diff update | Phase loop: bin → then update `runningMaterialDiff` |
| 3 | Info edge = two Sets | `knownBySlot1` / `knownBySlot2`; attacker↔defender mutual reveal |
| 4 | Territory alive-at-time | `aliveSet` + `applyCombatDeaths` before sample |
| 5 | No defense→`attack_wins` | `attacks`/`attack_wins` only inside `if (isMyAttack)` |
| 6 | Flag from `row_idx`/`col_idx` | Pieces select + Flag proximity loop |
| 7 | known = `>= 15` | `infoState`: `if (knownCount < 15) return "partial"` |
| 8 | Phase avenge routed | `killedByEnemy` Map inside phase loop → bin increments |

---

## Deviation Log

(Record plan deviations during implementation)
