# Bot Difficulty (Memory + Suspicion) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Easy/Medium/Hard difficulty selector to the "Play vs Bot" setup screen. All three tiers scale two heuristics in strength (never gated on/off): reveal memory (remembering a piece's combat-revealed rank for a while after the live board's fog-of-war resets it, scaled by strategic importance) and immobile-piece suspicion (flagging opponent pieces that never move as likely Bomb/Flag candidates, biasing move choice around them).

**Architecture:** Two new pure, stateless helper modules (`pieceMemory.js`, `pieceSuspicion.js`) layered on top of the existing `chooseBotMove` winning/safe/losing pooling in `bot.js` — the pooling logic itself is untouched, it just gets better-informed inputs. A deterministic hash (`deterministicJitter.js`) provides ±20% "jitter" on memory windows/suspicion thresholds without needing any cross-turn state, matching this codebase's existing stateless/self-healing philosophy. Difficulty is stored server-side (`games.bot_difficulty`, set via a new small Edge Function) since the `games` table has no client-writable RLS policy.

**Tech Stack:** Vanilla JS (ES modules), Node's built-in `node:test` + `node:assert/strict`, Supabase (Postgres migrations + Deno Edge Functions).

**Full design spec:** `docs/superpowers/specs/2026-07-12-bot-difficulty-design.md`

---

## Scope note

This plan covers one cohesive feature (bot difficulty). It touches the rules engine, one migration prerequisite (`defender_piece_id`), two new pure modules, one new Edge Function, and setup-screen UI — all necessary parts of a single working feature, not independent subsystems. Not decomposed further.

## File Structure

**New:**
- `web/js/deterministicJitter.js` — `jitterFactor`, `defaultJitterSeed` (pure)
- `web/js/pieceMemory.js` — `buildPieceMemory` (pure)
- `web/js/pieceSuspicion.js` — `findSuspects` (pure)
- `supabase/functions/set-bot-difficulty/index.ts`
- `supabase/migrations/0006_defender_piece_id.sql`
- `supabase/migrations/0007_bot_difficulty.sql`
- `test/web/deterministicJitter.test.js`
- `test/web/pieceMemory.test.js`
- `test/web/pieceSuspicion.test.js`

**Modified:**
- `src/rules/game.js`, `web/js/rules/game.js`, `supabase/functions/_shared/rules/game.js` (three byte-identical synced copies) — `applyMove`'s `combatResult` gains `defenderPieceId`
- `test/rules/game.test.js` — two existing combat tests gain a `defenderPieceId` assertion
- `supabase/functions/make-move/index.ts` — inserts `defender_piece_id`
- `web/js/bot.js` — `chooseBotMove` integrates memory + suspicion
- `test/web/bot.test.js` — new tests for memory-influenced combat resolution and suspicion-influenced pool selection
- `web/js/game.js` — `makeBotMove` fetches full (both-player) move history including `defender_piece_id`, reads `gameRow.bot_difficulty`
- `web/js/setup.js` — difficulty button row, gated on `is_bot_game`
- `web/setup.html` — button markup
- `web/css/styles.css` — difficulty button selected-state styling

---

### Task 1: `defenderPieceId` in combat results (prerequisite for memory)

**Why first:** `buildPieceMemory` (Task 5) needs a stable `piece_id` for the defending piece so a remembered rank stays attached to the correct piece even after it moves again. The `moves` table currently only records the attacker's `piece_id`.

**Files:**
- Modify: `test/rules/game.test.js`
- Modify: `src/rules/game.js`, `web/js/rules/game.js`, `supabase/functions/_shared/rules/game.js` (identical copies — edit `src/rules/game.js` first, then copy it over the other two)
- Create: `supabase/migrations/0006_defender_piece_id.sql`
- Modify: `supabase/functions/make-move/index.ts`

- [ ] **Step 1: Write the failing test assertions**

In `test/rules/game.test.js`, find this existing test:

```javascript
test('an attack that wins removes the defender and advances the attacker', () => {
  const pieces = [
    { id: 'a', playerSlot: 1, rank: RANK.GENERAL, row: 6, col: 5, alive: true },
    { id: 'b', playerSlot: 2, rank: RANK.MAJOR, row: 6, col: 6, alive: true },
  ];
  const result = applyMove(baseState(pieces), { playerSlot: 1, from: { row: 6, col: 5 }, to: { row: 6, col: 6 } });
  assert.equal(result.ok, true);
  assert.equal(result.combatResult.outcome, 'ATTACKER_WINS');
  const attacker = result.newState.pieces.find((p) => p.id === 'a');
  const defender = result.newState.pieces.find((p) => p.id === 'b');
  assert.equal(attacker.alive, true);
  assert.equal(attacker.row, 6);
  assert.equal(attacker.col, 6);
  assert.equal(defender.alive, false);
});
```

Add one line after the `outcome` assertion:

```javascript
  assert.equal(result.combatResult.outcome, 'ATTACKER_WINS');
  assert.equal(result.combatResult.defenderPieceId, 'b');
```

Do the same for the sibling test right below it:

```javascript
test('an attack that loses removes the attacker and leaves the defender in place', () => {
  const pieces = [
    { id: 'a', playerSlot: 1, rank: RANK.COLONEL, row: 6, col: 5, alive: true },
    { id: 'b', playerSlot: 2, rank: RANK.GENERAL, row: 6, col: 6, alive: true },
  ];
  const result = applyMove(baseState(pieces), { playerSlot: 1, from: { row: 6, col: 5 }, to: { row: 6, col: 6 } });
  assert.equal(result.ok, true);
  assert.equal(result.combatResult.outcome, 'DEFENDER_WINS');
  assert.equal(result.combatResult.defenderPieceId, 'b');
  const attacker = result.newState.pieces.find((p) => p.id === 'a');
  const defender = result.newState.pieces.find((p) => p.id === 'b');
  assert.equal(attacker.alive, false);
  assert.equal(defender.alive, true);
  assert.equal(defender.row, 6);
  assert.equal(defender.col, 6);
});
```

Only add the one `defenderPieceId` assertion line to each test — the rest of each test (piece ranks, ids, structure) is exactly what's already in the file above; do not change anything else.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd repos/stratego && npx node --test test/rules/game.test.js`
Expected: 2 failures — `AssertionError [ERR_ASSERTION]: Expected values to be strictly equal: undefined !== 'b'`

- [ ] **Step 3: Implement in the canonical rules engine**

In `src/rules/game.js`, find:

```javascript
    combatResult = {
      outcome,
      attackerRank: moverPiece.rank,
      defenderRank: defenderPiece.rank,
    };
```

Change to:

```javascript
    combatResult = {
      outcome,
      attackerRank: moverPiece.rank,
      defenderRank: defenderPiece.rank,
      defenderPieceId: defenderPiece.id,
    };
```

- [ ] **Step 4: Sync the two copies**

Run:
```bash
cd repos/stratego
cp src/rules/game.js web/js/rules/game.js
cp src/rules/game.js supabase/functions/_shared/rules/game.js
md5 src/rules/game.js web/js/rules/game.js supabase/functions/_shared/rules/game.js
```
Expected: all three md5 hashes identical.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx node --test test/rules/game.test.js`
Expected: all tests pass, including the 2 new assertions.

- [ ] **Step 6: Add the `defender_piece_id` column**

Create `supabase/migrations/0006_defender_piece_id.sql`:

```sql
-- supabase/migrations/0006_defender_piece_id.sql
alter table moves add column defender_piece_id uuid references pieces(id);
```

- [ ] **Step 7: Record it in `make-move`**

In `supabase/functions/make-move/index.ts`, find:

```typescript
  const { error: moveInsertError } = await supabase.from("moves").insert({
    game_id: gameId,
    piece_id: movedPiece.id,
    move_number: nextMoveNumber,
    player_slot: playerSlot,
    from_row: from.row,
    from_col: from.col,
    to_row: to.row,
    to_col: to.col,
    move_type: moveType,
    outcome: result.combatResult?.outcome ?? null,
    attacker_rank: result.combatResult?.attackerRank ?? null,
    defender_rank: result.combatResult?.defenderRank ?? null,
  });
```

Change to:

```typescript
  const { error: moveInsertError } = await supabase.from("moves").insert({
    game_id: gameId,
    piece_id: movedPiece.id,
    move_number: nextMoveNumber,
    player_slot: playerSlot,
    from_row: from.row,
    from_col: from.col,
    to_row: to.row,
    to_col: to.col,
    move_type: moveType,
    outcome: result.combatResult?.outcome ?? null,
    attacker_rank: result.combatResult?.attackerRank ?? null,
    defender_rank: result.combatResult?.defenderRank ?? null,
    defender_piece_id: result.combatResult?.defenderPieceId ?? null,
  });
```

- [ ] **Step 8: Full suite check**

Run: `npx node --test`
Expected: all existing tests still pass (57+ from before this plan, plus the 2 new assertions).

- [ ] **Step 9: Commit**

```bash
git add test/rules/game.test.js src/rules/game.js web/js/rules/game.js supabase/functions/_shared/rules/game.js supabase/migrations/0006_defender_piece_id.sql supabase/functions/make-move/index.ts
git commit -m "feat: record defender's piece_id on every combat move

Needed so the bot difficulty feature can attribute a remembered
rank to a specific opponent piece even after it moves again, rather
than a square that a different piece may later occupy."
```

---

### Task 2: `games.bot_difficulty` column

**Files:**
- Create: `supabase/migrations/0007_bot_difficulty.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/0007_bot_difficulty.sql
alter table games add column bot_difficulty text check (bot_difficulty in ('easy', 'medium', 'hard'));
```

No test — this is a schema-only change with no logic. Verified indirectly by Task 3's Edge Function and Task 9's UI.

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/0007_bot_difficulty.sql
git commit -m "feat: add games.bot_difficulty column"
```

---

### Task 3: `set-bot-difficulty` Edge Function

**Files:**
- Create: `supabase/functions/set-bot-difficulty/index.ts`

No automated test — this project has no Deno-level Edge Function test harness (verified by inspecting `supabase/functions/`); Edge Functions are verified via the local Supabase stack and, before considering the feature done, one live check against production (matching this project's established CORS-lesson pattern of never trusting local-only verification for anything server-side). That verification happens in Task 10.

- [ ] **Step 1: Write the function**

```typescript
// supabase/functions/set-bot-difficulty/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VALID_DIFFICULTIES = ["easy", "medium", "hard"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "METHOD_NOT_ALLOWED" }), { status: 405, headers: corsHeaders });
  }

  const { token, difficulty } = await req.json();
  if (!token || !difficulty) {
    return new Response(JSON.stringify({ error: "MISSING_FIELDS" }), { status: 400, headers: corsHeaders });
  }

  if (!VALID_DIFFICULTIES.includes(difficulty)) {
    return new Response(JSON.stringify({ error: "INVALID_DIFFICULTY" }), { status: 400, headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: playerRow, error: playerError } = await supabase
    .from("game_players")
    .select("game_id, player_slot")
    .eq("secret_token", token)
    .maybeSingle();

  if (playerError || !playerRow) {
    return new Response(JSON.stringify({ error: "INVALID_TOKEN" }), { status: 401, headers: corsHeaders });
  }

  if (playerRow.player_slot !== 1) {
    return new Response(JSON.stringify({ error: "NOT_ALLOWED" }), { status: 403, headers: corsHeaders });
  }

  const { data: game, error: gameError } = await supabase
    .from("games")
    .select("status, is_bot_game")
    .eq("id", playerRow.game_id)
    .single();

  if (gameError || !game || !game.is_bot_game || game.status !== "setup") {
    return new Response(JSON.stringify({ error: "NOT_ALLOWED" }), { status: 409, headers: corsHeaders });
  }

  const { error: updateError } = await supabase
    .from("games")
    .update({ bot_difficulty: difficulty, updated_at: new Date().toISOString() })
    .eq("id", playerRow.game_id);

  if (updateError) {
    return new Response(JSON.stringify({ error: "UPDATE_FAILED", detail: updateError.message }), {
      status: 500,
      headers: corsHeaders,
    });
  }

  return new Response(JSON.stringify({ ok: true, difficulty }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/set-bot-difficulty/index.ts
git commit -m "feat: add set-bot-difficulty Edge Function"
```

---

### Task 4: `deterministicJitter.js`

**Files:**
- Create: `web/js/deterministicJitter.js`
- Create: `test/web/deterministicJitter.test.js`

- [ ] **Step 1: Write the failing tests**

Create `test/web/deterministicJitter.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jitterFactor, defaultJitterSeed } from '../../web/js/deterministicJitter.js';

test('jitterFactor is deterministic: the same seed always produces the same factor', () => {
  const a = jitterFactor('piece-123');
  const b = jitterFactor('piece-123');
  assert.equal(a, b);
});

test('jitterFactor differs for different seeds (not a constant)', () => {
  const a = jitterFactor('piece-123');
  const b = jitterFactor('piece-456');
  assert.notEqual(a, b);
});

test('jitterFactor stays within the [0.8, 1.2] range for arbitrary seeds', () => {
  for (const seed of ['a', 'bb', 'ccc', 'piece-1', 'piece-2', 'move-99']) {
    const factor = jitterFactor(seed);
    assert.ok(factor >= 0.8 && factor <= 1.2, `factor ${factor} for seed "${seed}" out of range`);
  }
});

test('jitterFactor honors an injected seedFn for deterministic boundary testing', () => {
  assert.equal(jitterFactor('anything', () => 0), 0.8);
  assert.equal(jitterFactor('anything', () => 1), 1.2);
  assert.equal(jitterFactor('anything', () => 0.5), 1.0);
});

test('defaultJitterSeed returns a value in [0, 1)', () => {
  for (const seed of ['', 'a', 'piece-abc-123']) {
    const value = defaultJitterSeed(seed);
    assert.ok(value >= 0 && value < 1, `value ${value} for seed "${seed}" out of range`);
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx node --test test/web/deterministicJitter.test.js`
Expected: FAIL — `Cannot find module '../../web/js/deterministicJitter.js'`

- [ ] **Step 3: Write the implementation**

Create `web/js/deterministicJitter.js`:

```javascript
// web/js/deterministicJitter.js
//
// The bot's difficulty logic needs small, believable randomness (so two
// games at the same difficulty don't behave identically) without becoming
// stateful -- makeBotMove re-derives everything fresh from the database
// every turn (matching this codebase's existing self-healing pattern,
// e.g. move_number is derived from actual table content rather than
// trusted from a separately-tracked counter), and there is no per-game
// object to cache a random roll in across turns.
//
// A deterministic hash of a stable seed (a piece_id, or a
// piece_id+move_number pair) gives the exact same "roll" every time it's
// queried for that seed, with no storage needed -- mathematically
// equivalent to "rolled once and cached," achieved statelessly.

export function defaultJitterSeed(seed) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return (hash >>> 0) / 0xffffffff;
}

// Returns a factor in [0.8, 1.2] (+/- 20%), deterministic for a given seed.
export function jitterFactor(seed, seedFn = defaultJitterSeed) {
  return 0.8 + seedFn(seed) * 0.4;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx node --test test/web/deterministicJitter.test.js`
Expected: all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add web/js/deterministicJitter.js test/web/deterministicJitter.test.js
git commit -m "feat: add deterministicJitter helper for stateless bot randomness"
```

---

### Task 5: `pieceMemory.js`

**Files:**
- Create: `web/js/pieceMemory.js`
- Create: `test/web/pieceMemory.test.js`

- [ ] **Step 1: Write the failing tests**

Create `test/web/pieceMemory.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPieceMemory } from '../../web/js/pieceMemory.js';

// Base combat-move shape, matching the `moves` table's columns.
function combatMove(overrides) {
  return {
    move_number: 1,
    piece_id: 'attacker-1',
    attacker_rank: '5',
    defender_piece_id: 'defender-1',
    defender_rank: '3',
    outcome: 'ATTACKER_WINS',
    ...overrides,
  };
}

test('a non-combat move (no outcome) contributes nothing to memory', () => {
  const history = [{ move_number: 1, piece_id: 'a', outcome: null, attacker_rank: null, defender_rank: null, defender_piece_id: null }];
  const memory = buildPieceMemory(history, 'hard', 10);
  assert.equal(memory.size, 0);
});

test('remembers both the attacker and defender ranks from a combat move, normalized to numbers', () => {
  const history = [combatMove({ move_number: 5 })];
  // Major (4) tier is "medium"; hard window is 15 turns, jitter range
  // [0.8, 1.2] on 15 gives [12, 18] -- age 2 is comfortably within range
  // regardless of jitter, so this test doesn't need to control the seed.
  const memory = buildPieceMemory(history, 'hard', 7);
  assert.equal(memory.get('attacker-1'), 5);
  assert.equal(memory.get('defender-1'), 3);
});

test('BOMB and FLAG ranks are handled without Number() coercion breaking them', () => {
  const history = [combatMove({ move_number: 1, defender_rank: 'BOMB', attacker_rank: '8' })];
  const memory = buildPieceMemory(history, 'hard', 2);
  assert.equal(memory.get('defender-1'), 'BOMB');
});

test('a Scout (minor tier) reveal is forgotten immediately on Easy (0-turn window)', () => {
  const history = [combatMove({ move_number: 1, attacker_rank: '9' })];
  const memory = buildPieceMemory(history, 'easy', 1);
  assert.equal(memory.has('attacker-1'), false);
});

test('a Scout reveal is remembered briefly on Medium (2-turn base window)', () => {
  const history = [combatMove({ move_number: 10, attacker_rank: '9' })];
  // age 1 is within even the low end of jitter (2 * 0.8 = 1.6, so age 1 <= 1.6)
  const memory = buildPieceMemory(history, 'medium', 11);
  assert.equal(memory.get('attacker-1'), 9);
});

test('jitter boundary: a Colonel (high tier) reveal at exactly the low end of the jittered window is still remembered', () => {
  // High tier, medium difficulty base window = 10. seedFn forced to 0 -> jitterFactor 0.8 -> window = 8.
  const history = [combatMove({ move_number: 1, attacker_rank: '3' })];
  const memory = buildPieceMemory(history, 'medium', 9, () => 0);
  assert.equal(memory.get('attacker-1'), 3, 'age 8 should be within an 8-turn window');
});

test('jitter boundary: a Colonel reveal just past the low end of the jittered window is forgotten', () => {
  const history = [combatMove({ move_number: 1, attacker_rank: '3' })];
  const memory = buildPieceMemory(history, 'medium', 10, () => 0);
  assert.equal(memory.has('attacker-1'), false, 'age 9 should exceed an 8-turn window');
});

test('Bomb is remembered for the whole game even on Easy difficulty (special-cased, not scaled)', () => {
  const history = [combatMove({ move_number: 1, defender_rank: 'BOMB', attacker_rank: '8' })];
  const memory = buildPieceMemory(history, 'easy', 500, () => 1);
  assert.equal(memory.get('defender-1'), 'BOMB');
});

test('Marshal (critical tier, mobile) is NOT remembered forever on Easy -- only Bomb gets the unconditional-Infinity special case', () => {
  const history = [combatMove({ move_number: 1, attacker_rank: '1' })];
  // Easy critical-tier base window is 5; even at jitter factor 1.2, window = 6.
  const memory = buildPieceMemory(history, 'easy', 500, () => 1);
  assert.equal(memory.has('attacker-1'), false);
});

test('the most recent reveal of the same piece overwrites an earlier one', () => {
  const history = [
    combatMove({ move_number: 1, piece_id: 'p1', attacker_rank: '5', defender_piece_id: null, defender_rank: null }),
    combatMove({ move_number: 2, piece_id: 'p1', attacker_rank: '5', defender_piece_id: null, defender_rank: null }),
  ];
  const memory = buildPieceMemory(history, 'hard', 3);
  assert.equal(memory.get('p1'), 5);
  assert.equal(memory.size, 1);
});

test('FLAG reveals are ignored (covered by suspicion, not memory -- Flag never has an importance tier)', () => {
  const history = [combatMove({ move_number: 1, defender_rank: 'FLAG', attacker_rank: '2' })];
  const memory = buildPieceMemory(history, 'hard', 2);
  assert.equal(memory.has('defender-1'), false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx node --test test/web/pieceMemory.test.js`
Expected: FAIL — `Cannot find module '../../web/js/pieceMemory.js'`

- [ ] **Step 3: Write the implementation**

Create `web/js/pieceMemory.js`:

```javascript
// web/js/pieceMemory.js
import { RANK } from "./rules/pieces.js";
import { jitterFactor } from "./deterministicJitter.js";

const IMPORTANCE_TIER = new Map([
  [RANK.MARSHAL, "critical"],
  [RANK.SPY, "critical"],
  [RANK.GENERAL, "high"],
  [RANK.COLONEL, "high"],
  [RANK.MAJOR, "medium"],
  [RANK.CAPTAIN, "medium"],
  [RANK.LIEUTENANT, "low"],
  [RANK.SERGEANT, "low"],
  [RANK.MINER, "low"],
  [RANK.SCOUT, "minor"],
]);

const BASE_WINDOW_TURNS = {
  critical: { easy: 5, medium: 15, hard: Infinity },
  high: { easy: 3, medium: 10, hard: 25 },
  medium: { easy: 2, medium: 6, hard: 15 },
  low: { easy: 1, medium: 3, hard: 8 },
  minor: { easy: 0, medium: 2, hard: 4 },
};

function normalizeRank(rank) {
  if (rank === "BOMB" || rank === "FLAG" || rank == null) return rank;
  return Number(rank);
}

function windowFor(rank, difficulty, seed, seedFn) {
  // Bomb is a permanent fact once revealed (it never moves) -- remembered
  // for the whole game at every difficulty, not scaled like mobile ranks.
  if (rank === "BOMB") return Infinity;

  const tier = IMPORTANCE_TIER.get(rank);
  if (!tier) return null; // FLAG and any unrecognized rank: not memory-tracked

  const baseWindow = BASE_WINDOW_TURNS[tier][difficulty];
  if (baseWindow === Infinity) return Infinity;
  return baseWindow * jitterFactor(seed, seedFn);
}

// moveHistory: rows shaped like the `moves` table (move_number, outcome,
// piece_id [the mover/attacker], attacker_rank, defender_piece_id,
// defender_rank), oldest-first, from BOTH players. Only combat moves
// (outcome != null) carry reveals.
export function buildPieceMemory(moveHistory, difficulty, currentTurn, seedFn = undefined) {
  const memory = new Map();

  for (const move of moveHistory) {
    if (!move.outcome) continue;

    const reveals = [
      { pieceId: move.piece_id, rank: normalizeRank(move.attacker_rank) },
      { pieceId: move.defender_piece_id, rank: normalizeRank(move.defender_rank) },
    ];

    for (const { pieceId, rank } of reveals) {
      if (!pieceId || rank == null) continue;

      const seed = `${pieceId}:${move.move_number}`;
      const window = windowFor(rank, difficulty, seed, seedFn);
      if (window == null) continue;

      const age = currentTurn - move.move_number;
      if (age <= window) {
        memory.set(pieceId, rank);
      }
    }
  }

  return memory;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx node --test test/web/pieceMemory.test.js`
Expected: all 11 tests pass.

- [ ] **Step 5: Commit**

```bash
git add web/js/pieceMemory.js test/web/pieceMemory.test.js
git commit -m "feat: add buildPieceMemory for bot difficulty reveal memory"
```

---

### Task 6: `pieceSuspicion.js`

**Files:**
- Create: `web/js/pieceSuspicion.js`
- Create: `test/web/pieceSuspicion.test.js`

- [ ] **Step 1: Write the failing tests**

Create `test/web/pieceSuspicion.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findSuspects } from '../../web/js/pieceSuspicion.js';

test('a piece that has moved at least once is never suspected, no matter how long the game has run', () => {
  const history = [{ move_number: 1, piece_id: 'moved-1' }];
  const alivePieces = [{ id: 'moved-1' }];
  const suspects = findSuspects(history, alivePieces, 'hard', 1000);
  assert.equal(suspects.has('moved-1'), false);
});

test('a never-moved piece is not suspected before the game has run long enough', () => {
  const history = [];
  const alivePieces = [{ id: 'never-moved-1' }];
  const suspects = findSuspects(history, alivePieces, 'easy', 1);
  assert.equal(suspects.has('never-moved-1'), false);
});

test('jitter boundary: a never-moved piece is suspected right at the low end of the jittered Hard threshold', () => {
  // Hard base threshold = 8. seedFn forced to 0 -> jitterFactor 0.8 -> threshold = 6.4.
  const history = [];
  const alivePieces = [{ id: 'never-moved-1' }];
  const suspects = findSuspects(history, alivePieces, 'hard', 7, () => 0);
  assert.equal(suspects.has('never-moved-1'), true, 'turn 7 should exceed a 6.4-turn threshold');
});

test('jitter boundary: a never-moved piece is NOT yet suspected just before the jittered Hard threshold', () => {
  const history = [];
  const alivePieces = [{ id: 'never-moved-1' }];
  const suspects = findSuspects(history, alivePieces, 'hard', 6, () => 0);
  assert.equal(suspects.has('never-moved-1'), false, 'turn 6 should be under a 6.4-turn threshold');
});

test('Easy has a much later threshold than Hard for the same piece and turn', () => {
  const history = [];
  const alivePieces = [{ id: 'never-moved-1' }];
  const easySuspects = findSuspects(history, alivePieces, 'easy', 10);
  const hardSuspects = findSuspects(history, alivePieces, 'hard', 10);
  assert.equal(easySuspects.has('never-moved-1'), false);
  assert.equal(hardSuspects.has('never-moved-1'), true);
});

test('only alive pieces passed in are considered -- a dead piece is never returned as a suspect', () => {
  const history = [];
  const alivePieces = []; // caller is responsible for filtering to alive, non-mine pieces
  const suspects = findSuspects(history, alivePieces, 'hard', 100);
  assert.equal(suspects.size, 0);
});

test('the same piece gets a consistent (deterministic) suspicion threshold across repeated calls', () => {
  const history = [];
  const alivePieces = [{ id: 'never-moved-1' }];
  const first = findSuspects(history, alivePieces, 'medium', 14);
  const second = findSuspects(history, alivePieces, 'medium', 14);
  assert.equal(first.has('never-moved-1'), second.has('never-moved-1'));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx node --test test/web/pieceSuspicion.test.js`
Expected: FAIL — `Cannot find module '../../web/js/pieceSuspicion.js'`

- [ ] **Step 3: Write the implementation**

Create `web/js/pieceSuspicion.js`:

```javascript
// web/js/pieceSuspicion.js
import { jitterFactor } from "./deterministicJitter.js";

const BASE_THRESHOLD_TURNS = { easy: 30, medium: 15, hard: 8 };

// moveHistory: rows shaped like the `moves` table (piece_id [the mover]),
// from BOTH players -- used only to find which piece_ids have ever moved.
// aliveOpponentPieces: pieces already filtered by the caller to alive,
// non-mine (e.g. from get_game_state rows).
export function findSuspects(moveHistory, aliveOpponentPieces, difficulty, currentTurn, seedFn = undefined) {
  const movedPieceIds = new Set(moveHistory.map((move) => move.piece_id));

  const suspects = new Set();
  for (const piece of aliveOpponentPieces) {
    if (movedPieceIds.has(piece.id)) continue;

    const threshold = BASE_THRESHOLD_TURNS[difficulty] * jitterFactor(piece.id, seedFn);
    if (currentTurn >= threshold) {
      suspects.add(piece.id);
    }
  }

  return suspects;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx node --test test/web/pieceSuspicion.test.js`
Expected: all 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add web/js/pieceSuspicion.js test/web/pieceSuspicion.test.js
git commit -m "feat: add findSuspects for bot difficulty immobile-piece suspicion"
```

---

### Task 7: Integrate memory + suspicion into `chooseBotMove`

**Files:**
- Modify: `web/js/bot.js`
- Modify: `test/web/bot.test.js`

**Rank sets used below** (per the design spec): Valuable = Marshal(1)/General(2)/Colonel(3)/Major(4)/Spy(10); Probe-eligible = Captain(5)/Lieutenant(6)/Sergeant(7)/Miner(8)/Scout(9).

- [ ] **Step 1: Write the failing tests**

Add to `test/web/bot.test.js` (after the existing `chooseBotMove` tests, before the final closing of the file):

```javascript
test('chooseBotMove treats a remembered (but currently fogged) rank as known for combat-outcome purposes', () => {
  // Live state: the enemy piece's rank is null (fog-of-war has reset it),
  // but it was revealed as a Major (4) three turns ago in combat history --
  // Colonel (3) beats Major, so this should be picked as a WINNING move
  // instead of falling into the "unknown, therefore safe" bucket.
  const rows = [
    { piece_id: 'colonel-1', player_slot: 2, rank: '3', row_idx: 5, col_idx: 5, alive: true, is_mine: true },
    { piece_id: 'major-enemy', player_slot: 1, rank: null, row_idx: 5, col_idx: 4, alive: true, is_mine: false },
  ];
  const fullMoveHistory = [
    { move_number: 1, piece_id: 'major-enemy', attacker_rank: '4', defender_piece_id: null, defender_rank: null, outcome: 'ATTACKER_WINS' },
  ];
  const move = chooseBotMove(rows, 2, fullMoveHistory, 'hard', 4);
  assert.deepEqual(move, { pieceId: 'colonel-1', from: { row: 5, col: 5 }, to: { row: 5, col: 4 } });
});

test('chooseBotMove avoids sending a valuable piece onto a suspected square when a plain alternative move exists', () => {
  // marshal-1 (Marshal, valuable) is boxed in by its own bombs on two
  // sides, leaving exactly one plain empty-square move and one attack on
  // a long-untouched (suspected) enemy square. With no winning moves
  // available, it should take the plain move, not the suspected attack.
  const rows = [
    { piece_id: 'marshal-1', player_slot: 2, rank: '1', row_idx: 3, col_idx: 5, alive: true, is_mine: true },
    { piece_id: 'bomb-1', player_slot: 2, rank: 'BOMB', row_idx: 2, col_idx: 5, alive: true, is_mine: true },
    { piece_id: 'bomb-2', player_slot: 2, rank: 'BOMB', row_idx: 4, col_idx: 5, alive: true, is_mine: true },
    { piece_id: 'suspect-1', player_slot: 1, rank: null, row_idx: 3, col_idx: 6, alive: true, is_mine: false },
  ];
  // suspect-1 has never appeared as a mover anywhere in history, and the
  // game has run long enough (turn 20) to exceed even Hard's threshold.
  const move = chooseBotMove(rows, 2, [], 'hard', 20);
  assert.deepEqual(move, { pieceId: 'marshal-1', from: { row: 3, col: 5 }, to: { row: 3, col: 4 } });
});

test('chooseBotMove prefers probing a suspected square with a probe-eligible piece when otherwise idle and the probe roll succeeds', () => {
  // scout-1 at the board corner (0,0) has exactly two legal moves: a
  // plain step to (1,0), and an attack on suspect-1 at (2,0) (a Scout can
  // stop partway along a clear path, so both are legal destinations).
  // getLegalMoves enumerates destinations row-ascending then col-ascending
  // for a single movable piece, so (1,0) is generated before (2,0) --
  // this test relies on the probe logic actively preferring (2,0) despite
  // that natural ordering, not on ordering coincidence.
  const rows = [
    { piece_id: 'scout-1', player_slot: 2, rank: '9', row_idx: 0, col_idx: 0, alive: true, is_mine: true },
    { piece_id: 'bomb-1', player_slot: 2, rank: 'BOMB', row_idx: 0, col_idx: 1, alive: true, is_mine: true },
    { piece_id: 'suspect-1', player_slot: 1, rank: null, row_idx: 2, col_idx: 0, alive: true, is_mine: false },
  ];
  const move = chooseBotMove(rows, 2, [], 'hard', 20, () => 0);
  assert.deepEqual(move, { pieceId: 'scout-1', from: { row: 0, col: 0 }, to: { row: 2, col: 0 } });
});

test('chooseBotMove does not probe on Easy even when idle (probe probability is 0 on Easy)', () => {
  // Identical layout to the Hard probe test above, difficulty changed to
  // Easy. Probe probability 0 means `rng() < 0` is never true for any
  // rng in [0, 1), so the probe branch is unreachable regardless of rng
  // -- the bot falls back to the plain move at (1,0), the first-enumerated
  // legal move, exactly as it would if suspect-1 didn't exist at all.
  const rows = [
    { piece_id: 'scout-1', player_slot: 2, rank: '9', row_idx: 0, col_idx: 0, alive: true, is_mine: true },
    { piece_id: 'bomb-1', player_slot: 2, rank: 'BOMB', row_idx: 0, col_idx: 1, alive: true, is_mine: true },
    { piece_id: 'suspect-1', player_slot: 1, rank: null, row_idx: 2, col_idx: 0, alive: true, is_mine: false },
  ];
  const move = chooseBotMove(rows, 2, [], 'easy', 40, () => 0);
  assert.deepEqual(move, { pieceId: 'scout-1', from: { row: 0, col: 0 }, to: { row: 1, col: 0 } });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx node --test test/web/bot.test.js`
Expected: FAIL — `chooseBotMove` doesn't yet accept `fullMoveHistory`/`difficulty`/`currentTurn` parameters and old tests calling it with the old 3-arg signature may also now behave differently once you start the rewrite; that's expected mid-task. Confirm the 4 new tests specifically fail before continuing.

- [ ] **Step 3: Rewrite `chooseBotMove`**

In `web/js/bot.js`, replace the whole file's `chooseBotMove` function and its surrounding imports:

```javascript
// web/js/bot.js
import { DEFENSIVE_FORMATIONS, AGGRESSIVE_FORMATIONS } from "./formations.js";
import { ABSOLUTE_ROWS_BY_SLOT } from "./formationRowMap.js";
import { getLegalMoves } from "./rules/game.js";
import { resolveCombat, COMBAT_OUTCOME } from "./rules/combat.js";
import { RANK } from "./rules/pieces.js";
import { buildPieceMemory } from "./pieceMemory.js";
import { findSuspects } from "./pieceSuspicion.js";

const ALL_FORMATIONS = [...DEFENSIVE_FORMATIONS, ...AGGRESSIVE_FORMATIONS];
const BOT_SLOT = 2;

const VALUABLE_RANKS = new Set([RANK.MARSHAL, RANK.GENERAL, RANK.COLONEL, RANK.MAJOR, RANK.SPY]);
const PROBE_ELIGIBLE_RANKS = new Set([RANK.CAPTAIN, RANK.LIEUTENANT, RANK.SERGEANT, RANK.MINER, RANK.SCOUT]);
const PROBE_PROBABILITY = { easy: 0, medium: 0.5, hard: 1 };

// The bot is always seated as player slot 2, which needs the same local-row
// -> absolute-row remap the human setup screen applies (see
// formationRowMap.js) -- without it, a formation's back rank (where the
// Flag and most Bombs live) lands on the row nearest the lake instead of
// the bot's true back row.
export function mapFormationToAbsolute(cells, slot) {
  const absoluteRows = ABSOLUTE_ROWS_BY_SLOT[slot];
  return cells.map(([row, col, rank]) => ({ rank, row: absoluteRows[row], col }));
}

export function pickBotFormationPlacements() {
  const formation = ALL_FORMATIONS[Math.floor(Math.random() * ALL_FORMATIONS.length)];
  return mapFormationToAbsolute(formation.cells, BOT_SLOT);
}

function toRulesPiece(row) {
  return {
    id: row.piece_id,
    playerSlot: row.player_slot,
    rank: row.rank === "BOMB" || row.rank === "FLAG" || row.rank === null ? row.rank : Number(row.rank),
    row: row.row_idx,
    col: row.col_idx,
    alive: row.alive,
  };
}

function isSuspectedSquare(suspects, pieces, row, col) {
  const piece = pieces.find((p) => p.alive && p.row === row && p.col === col);
  return piece != null && suspects.has(piece.id);
}

// gameStateRows: rows shaped like get_game_state()'s output (piece_id,
// player_slot, rank, row_idx, col_idx, alive, is_mine). Opponent pieces
// that haven't been revealed have rank === null, exactly as a human
// opponent would see them -- the bot gets no extra information beyond
// what pieceMemory/pieceSuspicion can legitimately infer from history.
//
// fullMoveHistory: every move in the game so far (both players), shaped
// like the `moves` table -- used to build memory + suspicion.
// difficulty: 'easy' | 'medium' | 'hard'.
// currentTurn: fullMoveHistory.length (see design spec for why this is
// used instead of games.turn_number).
export function chooseBotMove(gameStateRows, botSlot, fullMoveHistory, difficulty = "medium", currentTurn = fullMoveHistory.length, rng = Math.random) {
  const pieces = gameStateRows.map(toRulesPiece);
  const legalMoves = getLegalMoves(pieces, botSlot, fullMoveHistory
    .filter((m) => pieces.some((p) => p.id === m.piece_id && p.playerSlot === botSlot))
    .map((m) => ({ pieceId: m.piece_id, from: `${m.from_row},${m.from_col}`, to: `${m.to_row},${m.to_col}` })));
  if (legalMoves.length === 0) return null;

  const botRankByPieceId = new Map(
    pieces.filter((p) => p.playerSlot === botSlot).map((p) => [p.id, p.rank]),
  );

  const memory = buildPieceMemory(fullMoveHistory, difficulty, currentTurn);
  const aliveOpponentPieces = pieces.filter((p) => p.alive && p.playerSlot !== botSlot);
  const suspects = findSuspects(fullMoveHistory, aliveOpponentPieces, difficulty, currentTurn);

  const winning = [];
  const safe = [];
  const losing = [];

  for (const move of legalMoves) {
    const defender = pieces.find((p) => p.alive && p.row === move.to.row && p.col === move.to.col);
    const liveRank = defender?.rank ?? null;
    const knownRank = liveRank != null ? liveRank : (defender ? memory.get(defender.id) ?? null : null);

    if (!defender || knownRank == null) {
      safe.push(move);
      continue;
    }
    const outcome = resolveCombat(botRankByPieceId.get(move.pieceId), knownRank);
    if (outcome === COMBAT_OUTCOME.DEFENDER_WINS) {
      losing.push(move);
    } else {
      winning.push(move);
    }
  }

  let pool = winning.length > 0 ? winning : safe.length > 0 ? safe : losing;

  // Avoid sending a valuable piece onto a suspected square when a
  // non-suspected alternative exists in the same pool.
  const movingPieceRank = (move) => botRankByPieceId.get(move.pieceId);
  const nonSuspectAlternatives = pool.filter(
    (move) => !isSuspectedSquare(suspects, pieces, move.to.row, move.to.col),
  );
  if (nonSuspectAlternatives.length > 0) {
    const valuableOnSuspect = pool.some(
      (move) => VALUABLE_RANKS.has(movingPieceRank(move)) && isSuspectedSquare(suspects, pieces, move.to.row, move.to.col),
    );
    if (valuableOnSuspect) {
      pool = pool.filter(
        (move) => !(VALUABLE_RANKS.has(movingPieceRank(move)) && isSuspectedSquare(suspects, pieces, move.to.row, move.to.col)),
      );
    }
  }

  // Probe-when-idle: only applies when there's no winning move (i.e. we're
  // choosing from the safe or losing pool) and a probe-eligible piece has
  // a legal move onto a suspected square.
  if (winning.length === 0 && suspects.size > 0 && rng() < PROBE_PROBABILITY[difficulty]) {
    const probeMoves = safe.filter(
      (move) => PROBE_ELIGIBLE_RANKS.has(movingPieceRank(move)) && isSuspectedSquare(suspects, pieces, move.to.row, move.to.col),
    );
    if (probeMoves.length > 0) {
      return probeMoves[Math.floor(rng() * probeMoves.length)];
    }
  }

  return pool[Math.floor(rng() * pool.length)];
}
```

**Why `getLegalMoves`'s history filter changed:** the previous version received `botMoveHistory` already pre-filtered to the bot's own moves by the caller (`game.js`). Now `chooseBotMove` receives the *full* game's move history (needed for memory/suspicion) and must derive the bot's-own-moves subset itself before calling `getLegalMoves` (which only wants one player's history, for the two-square rule).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx node --test test/web/bot.test.js`
Expected: all tests pass, including the pre-existing ones (their calls like `chooseBotMove(rows, 2, [])` still work since `difficulty` defaults to `'medium'` and `currentTurn` defaults to `fullMoveHistory.length` which is `0` for an empty history array — verify this doesn't change any pre-existing test's expected outcome; if any pre-existing test now fails because a default changed its behavior, that's a signal to re-check the default values chosen here, not to change the test).

- [ ] **Step 5: Full suite check**

Run: `npx node --test`
Expected: all tests across the whole project pass.

- [ ] **Step 6: Commit**

```bash
git add web/js/bot.js test/web/bot.test.js
git commit -m "feat: integrate reveal memory and immobile-piece suspicion into chooseBotMove"
```

---

### Task 8: Wire difficulty + full move history into `game.js`

**Files:**
- Modify: `web/js/game.js`

- [ ] **Step 1: Update `refreshGameRow`'s select**

Find:

```javascript
async function refreshGameRow(gameId) {
  const { data, error } = await supabase
    .from("games")
    .select("status, current_turn_slot, turn_number, winner_slot, is_bot_game")
    .eq("id", gameId)
    .single();
```

Change to:

```javascript
async function refreshGameRow(gameId) {
  const { data, error } = await supabase
    .from("games")
    .select("status, current_turn_slot, turn_number, winner_slot, is_bot_game, bot_difficulty")
    .eq("id", gameId)
    .single();
```

- [ ] **Step 2: Update `makeBotMove` to fetch full history and pass difficulty**

Find:

```javascript
async function makeBotMove(gameId) {
  const botToken = localStorage.getItem(`stratego:${roomCode}:botToken`);
  if (!botToken) return;

  const MAX_ATTEMPTS = 5;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const { data: rows, error: stateError } = await supabase.rpc("get_game_state", { p_token: botToken });
    if (stateError || !rows) {
      console.warn("Bot state fetch failed, retrying:", stateError?.message ?? "no rows returned");
      continue;
    }

    const { data: moveRows, error: movesError } = await supabase
      .from("moves")
      .select("piece_id, from_row, from_col, to_row, to_col")
      .eq("game_id", gameId)
      .eq("player_slot", BOT_SLOT)
      .order("move_number", { ascending: true });

    if (movesError) {
      console.warn("Bot move-history fetch failed, retrying:", movesError.message);
      continue;
    }

    const botHistory = (moveRows ?? []).map((m) => ({
      pieceId: m.piece_id,
      from: `${m.from_row},${m.from_col}`,
      to: `${m.to_row},${m.to_col}`,
    }));

    const move = chooseBotMove(rows, BOT_SLOT, botHistory);
    if (!move) return;
```

Change to:

```javascript
async function makeBotMove(gameId) {
  const botToken = localStorage.getItem(`stratego:${roomCode}:botToken`);
  if (!botToken) return;

  const MAX_ATTEMPTS = 5;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const { data: rows, error: stateError } = await supabase.rpc("get_game_state", { p_token: botToken });
    if (stateError || !rows) {
      console.warn("Bot state fetch failed, retrying:", stateError?.message ?? "no rows returned");
      continue;
    }

    const { data: moveRows, error: movesError } = await supabase
      .from("moves")
      .select("move_number, piece_id, player_slot, from_row, from_col, to_row, to_col, outcome, attacker_rank, defender_rank, defender_piece_id")
      .eq("game_id", gameId)
      .order("move_number", { ascending: true });

    if (movesError) {
      console.warn("Bot move-history fetch failed, retrying:", movesError.message);
      continue;
    }

    const fullMoveHistory = moveRows ?? [];
    const difficulty = gameRow?.bot_difficulty ?? "medium";
    const move = chooseBotMove(rows, BOT_SLOT, fullMoveHistory, difficulty, fullMoveHistory.length);
    if (!move) return;
```

(The rest of `makeBotMove` — the `try`/`catch` around `callFunction("make-move", ...)` and the final fallback message — is unchanged.)

- [ ] **Step 3: No unit test for this step**

`makeBotMove` is glue code calling Supabase directly (same pattern as the rest of `game.js`, which has no unit tests — it's verified via Playwright, per Task 10). `chooseBotMove` itself is already fully covered by Task 7's tests.

- [ ] **Step 4: Commit**

```bash
git add web/js/game.js
git commit -m "feat: pass full move history and bot_difficulty into chooseBotMove"
```

---

### Task 9: Setup screen difficulty selector

**Files:**
- Modify: `web/setup.html`
- Modify: `web/js/setup.js`
- Modify: `web/css/styles.css`

- [ ] **Step 1: Add the button markup**

In `web/setup.html`, find:

```html
          <div class="setup-controls">
            <button data-formation="random">Random</button>
            <button data-formation="defensive">Defensive</button>
            <button data-formation="aggressive">Aggressive</button>
            <button id="clear-btn">Clear</button>
          </div>
```

Add a new row right after it:

```html
          <div class="setup-controls">
            <button data-formation="random">Random</button>
            <button data-formation="defensive">Defensive</button>
            <button data-formation="aggressive">Aggressive</button>
            <button id="clear-btn">Clear</button>
          </div>
          <div id="difficulty-controls" class="setup-controls" hidden>
            <span class="difficulty-label">Bot difficulty:</span>
            <button class="difficulty-btn" data-difficulty="easy">Easy</button>
            <button class="difficulty-btn" data-difficulty="medium">Medium</button>
            <button class="difficulty-btn" data-difficulty="hard">Hard</button>
          </div>
```

- [ ] **Step 2: Add selected-state CSS**

In `web/css/styles.css`, find the `.setup-controls` rule:

```css
.setup-controls {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
  justify-content: center;
  flex-wrap: wrap;
}
```

Add right after it:

```css
.difficulty-label {
  align-self: center;
  font-size: 0.85rem;
  color: var(--wood-light);
}

.difficulty-btn.selected {
  outline: 3px solid gold;
  background: var(--wood-light);
  color: var(--wood-dark);
}
```

- [ ] **Step 3: Wire up the buttons in `setup.js`**

In `web/js/setup.js`, find:

```javascript
async function subscribeToGameUpdates() {
  const { data: gameRow } = await supabase.from("games").select("id").eq("room_code", roomCode).single();
  if (!gameRow) return;
```

Change the select and add difficulty-UI initialization right after `ensureSession()`'s result is used. First, find this block near the top of the file:

```javascript
const token = await ensureSession();
```

Add right after it:

```javascript
const token = await ensureSession();

async function initDifficultyControls() {
  const { data: gameRow } = await supabase.from("games").select("is_bot_game, bot_difficulty").eq("room_code", roomCode).single();
  if (!gameRow || !gameRow.is_bot_game || slot !== 1) return;

  const container = document.getElementById("difficulty-controls");
  container.hidden = false;

  function highlightSelected(difficulty) {
    container.querySelectorAll(".difficulty-btn").forEach((btn) => {
      btn.classList.toggle("selected", btn.dataset.difficulty === difficulty);
    });
  }

  highlightSelected(gameRow.bot_difficulty ?? "medium");

  container.querySelectorAll(".difficulty-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await callFunction("set-bot-difficulty", { token, difficulty: btn.dataset.difficulty });
        highlightSelected(btn.dataset.difficulty);
      } catch (err) {
        const statusEl = document.getElementById("setup-status");
        statusEl.hidden = false;
        statusEl.textContent = `Failed to set difficulty: ${err.message}`;
      }
    });
  });
}

initDifficultyControls();
```

Note: this references `slot`, which is already defined earlier in the file (`const slot = Number(localStorage.getItem(...))`) — confirm the `initDifficultyControls` call is placed *after* that `const slot = ...` line in the file, not before (JS `const` is block-scoped and hoisted-but-uninitialized, so calling this before the `slot` declaration executes would throw `ReferenceError`). Place it right after the `ABSOLUTE_ROWS` line, not immediately after `ensureSession()`, to be safe:

```javascript
const slot = Number(localStorage.getItem(`stratego:${roomCode}:slot`));
const ABSOLUTE_ROWS = ABSOLUTE_ROWS_BY_SLOT[slot];

async function initDifficultyControls() {
  // ... (as above)
}

initDifficultyControls();
```

- [ ] **Step 4: Manual verification (no unit test — this is DOM/network glue code, same pattern as the rest of setup.js)**

Run the local Supabase stack and static site, then verify by hand:

```bash
cd repos/stratego
npx supabase start
npx supabase functions serve --no-verify-jwt &
cd web && python3 -m http.server 8080
```

Open `http://localhost:8080/index.html`, click "Play vs Bot", confirm:
1. The setup screen shows an "Easy / Medium / Hard" button row with Medium pre-selected.
2. Clicking each button updates the selected styling and does not error.
3. In the local Supabase Studio (usually `http://localhost:54323`), confirm `games.bot_difficulty` updates to match the clicked button.
4. Starting a human-vs-human game (not vs bot) never shows this button row at all.

- [ ] **Step 5: Commit**

```bash
git add web/setup.html web/js/setup.js web/css/styles.css
git commit -m "feat: add bot difficulty selector to the setup screen"
```

---

### Task 10: Full verification + deploy decision

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `cd repos/stratego && npm test`
Expected: every test passes (the pre-existing suite plus every new test file added in Tasks 1, 4, 5, 6, 7).

- [ ] **Step 2: Live smoke test against the local stack**

With the local stack still running from Task 9 (or restarted with `npx supabase start`), play one full bot game at Hard difficulty through to completion (or resignation) via the browser, watching the browser console for errors. This is a sanity check that nothing throws across many turns — not a quality judgment of the heuristic itself, which is inherently probabilistic by design.

- [ ] **Step 3: Do not auto-deploy**

Migrations (`npx supabase db push`) and Edge Function deploys (`npx supabase functions deploy`) are production actions. Stop here and report status; deploying to the live Supabase project (`cafqbrzaxcwewwtyqpnf`) and pushing to `origin/main` (which triggers the Render auto-deploy) are separate, explicit decisions for the user to make — matching how every prior feature in this project's history was deployed only after an explicit go-ahead.

---

## Self-Review Notes (completed during authoring)

1. **Spec coverage:** Storage/UI (Task 2, 3, 9) ✓. Reveal memory with importance tiers + jitter (Task 5) ✓. Immobile-piece suspicion + avoid/probe behavior (Task 6, 7) ✓. Deterministic jitter fix from spec deviation (Task 4) ✓. `defender_piece_id` prerequisite fix from spec deviation (Task 1) ✓. Non-goals (no lookahead, no positional suspicion weighting, no mid-game difficulty changes) — none of these were accidentally implemented; confirmed by re-reading Task 7's `chooseBotMove` rewrite, which adds no search and no position-based suspicion weighting.
2. **Placeholder scan:** none found — every step has complete, exact code.
3. **Type/name consistency:** `buildPieceMemory(moveHistory, difficulty, currentTurn, seedFn)` defined in Task 5, called identically in Task 7. `findSuspects(moveHistory, aliveOpponentPieces, difficulty, currentTurn, seedFn)` defined in Task 6, called identically in Task 7. `jitterFactor(seed, seedFn)` defined in Task 4, consumed identically by both Task 5 and Task 6. `chooseBotMove`'s new signature `(gameStateRows, botSlot, fullMoveHistory, difficulty, currentTurn, rng)` defined in Task 7, and Task 8's `game.js` call site matches it exactly (`chooseBotMove(rows, BOT_SLOT, fullMoveHistory, difficulty, fullMoveHistory.length)` — omits `rng`, correctly relying on its `Math.random` default).
