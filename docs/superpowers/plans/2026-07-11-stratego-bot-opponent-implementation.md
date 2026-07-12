# Bot Opponent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Play vs Bot" mode so the game can be exercised end-to-end (setup → moves → combat → win/lose) by one person against the real deployed backend, without a second human.

**Architecture:** The bot is an ordinary player-slot-2 row driven by a client-side JS heuristic instead of a second human, authenticating through the existing public Edge Functions. One new `games.is_bot_game` column, one small `create-game` change, a new pure `web/js/bot.js` move-picker, and orchestration glue in `home.js`/`game.js`. No new Edge Functions, no fog-of-war changes.

**Tech Stack:** Plain JavaScript (ESM), Node's built-in test runner, Supabase (Postgres migration + existing Edge Functions), Supabase CLI, Playwright (scratch install at `/tmp/pw-verify` if present).

**Design reference:** `docs/superpowers/specs/2026-07-11-stratego-bot-opponent-design.md`

---

## Task 1: `getLegalMoves` in the rules engine

**Files:**
- Modify: `src/rules/game.js`
- Modify: `test/rules/game.test.js`
- Modify (sync copies): `supabase/functions/_shared/rules/game.js`, `web/js/rules/game.js`

- [ ] **Step 1: Write the failing tests**

Add these three tests to the end of `test/rules/game.test.js` (it already imports `applyMove` and `RANK` from `'../../src/rules/game.js'` and `'../../src/rules/pieces.js'` respectively — add `getLegalMoves` to the existing `game.js` import so the top of the file reads `import { applyMove, getLegalMoves } from '../../src/rules/game.js';`):

```javascript
test('getLegalMoves returns an empty array when the player has no movable pieces', () => {
  const pieces = [{ id: 'a', playerSlot: 1, rank: RANK.BOMB, row: 6, col: 5, alive: true }];
  assert.deepEqual(getLegalMoves(pieces, 1, []), []);
});

test('getLegalMoves returns every legal destination for a movable piece', () => {
  const pieces = [{ id: 'a', playerSlot: 1, rank: RANK.SERGEANT, row: 6, col: 5, alive: true }];
  const moves = getLegalMoves(pieces, 1, []);
  const destinations = moves.map((m) => `${m.to.row},${m.to.col}`).sort();
  assert.deepEqual(destinations, ['5,5', '6,4', '6,6', '7,5']);
  assert.ok(moves.every((m) => m.pieceId === 'a' && m.from.row === 6 && m.from.col === 5));
});

test('getLegalMoves excludes a destination that would violate the two-square rule', () => {
  const pieces = [{ id: 'a', playerSlot: 1, rank: RANK.SERGEANT, row: 6, col: 5, alive: true }];
  const history = [
    { pieceId: 'a', from: '6,4', to: '6,5' },
    { pieceId: 'a', from: '6,5', to: '6,4' },
    { pieceId: 'a', from: '6,4', to: '6,5' },
  ];
  const moves = getLegalMoves(pieces, 1, history);
  assert.equal(moves.some((m) => m.to.row === 6 && m.to.col === 4), false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `getLegalMoves is not a function` (or similar), because it doesn't exist yet. The rest of the existing suite (48 tests) should still pass.

- [ ] **Step 3: Implement `getLegalMoves` and refactor `hasAnyLegalMove` to use it**

In `src/rules/game.js`, replace the existing `hasAnyLegalMove` function (currently the last function in the file) with:

```javascript
export function getLegalMoves(pieces, playerSlot, history) {
  const movablePieces = pieces.filter(
    (p) => p.alive && p.playerSlot === playerSlot && p.rank !== RANK.BOMB && p.rank !== RANK.FLAG,
  );
  const moves = [];
  for (const piece of movablePieces) {
    for (let row = 0; row < 10; row++) {
      for (let col = 0; col < 10; col++) {
        const validation = validateMove(pieces, playerSlot, { row: piece.row, col: piece.col }, { row, col });
        if (!validation.valid) continue;
        const fromKey = squareKey(piece.row, piece.col);
        const toKey = squareKey(row, col);
        if (violatesTwoSquareRule(history, piece.id, fromKey, toKey)) continue;
        moves.push({ pieceId: piece.id, from: { row: piece.row, col: piece.col }, to: { row, col } });
      }
    }
  }
  return moves;
}

function hasAnyLegalMove(pieces, playerSlot, history) {
  return getLegalMoves(pieces, playerSlot, history).length > 0;
}
```

Do not change anything else in the file — `applyMove` still calls `hasAnyLegalMove` exactly as before, so its behavior (and the existing win-condition tests) is unaffected.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — all tests including the 3 new ones (51 total).

- [ ] **Step 5: Sync the change into the two duplicate copies**

```bash
cp src/rules/game.js supabase/functions/_shared/rules/game.js
cp src/rules/game.js web/js/rules/game.js
diff -rq src/rules/ supabase/functions/_shared/rules/ | grep -v README
diff -rq src/rules/ web/js/rules/
```

Expected: both `diff` commands produce no output (the first only ever reports the extra README, which `grep -v README` filters out).

- [ ] **Step 6: Commit**

```bash
git add src/rules/game.js supabase/functions/_shared/rules/game.js web/js/rules/game.js test/rules/game.test.js
git commit -m "feat: add getLegalMoves to the rules engine"
```

---

## Task 2: `is_bot_game` schema column

**Files:**
- Create: `supabase/migrations/0002_bot_game.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/0002_bot_game.sql
alter table games add column is_bot_game boolean not null default false;
```

No RLS change needed — `games` already has `create policy games_select on games for select using (true);` from `0001_init.sql`, which covers all columns including this new one.

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/0002_bot_game.sql
git commit -m "feat: add is_bot_game column to games table"
```

(This migration is applied to the local stack in Task 7 and to production in Task 8 — writing it now just adds the file to version control.)

---

## Task 3: `create-game` accepts an optional bot flag

**Files:**
- Modify: `supabase/functions/create-game/index.ts`

- [ ] **Step 1: Read the request body and pass the flag through to the insert**

In `supabase/functions/create-game/index.ts`, the current handler never reads `req.json()` at all. Add this right after the `Deno.serve(async (req) => {` method-check block (i.e. right before `const supabase = createClient(...)`):

```typescript
  let isBotGame = false;
  try {
    const body = await req.json();
    isBotGame = body?.isBotGame === true;
  } catch {
    // no JSON body sent (e.g. a plain create-game call with no bot flag) -- default false
  }
```

Then change the insert inside the retry loop from:

```typescript
    const { data, error } = await supabase
      .from("games")
      .insert({ room_code: roomCode })
      .select("id")
      .single();
```

to:

```typescript
    const { data, error } = await supabase
      .from("games")
      .insert({ room_code: roomCode, is_bot_game: isBotGame })
      .select("id")
      .single();
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/create-game/index.ts
git commit -m "feat: create-game accepts an optional isBotGame flag"
```

---

## Task 4: `web/js/bot.js` — pure move-picking logic

> **Deviation (found during Task 1):** `web/js/rules/` was only ever a partial copy of the rules engine — it has `board.js`, `pieces.js`, and (as of Task 1) `game.js`, but never `combat.js`, `movement.js`, or `twoSquareRule.js`, because the frontend never previously needed to run move validation or combat resolution client-side. `game.js`'s own internal imports (`./movement.js`, `./combat.js`, `./twoSquareRule.js`) will fail to resolve in the browser (and in Node tests) until those three files exist alongside it. `bot.js` also needs `combat.js` directly. Step 0 below fixes this before writing `bot.js`.

**Files:**
- Create: `web/js/bot.js`
- Create: `test/web/bot.test.js`
- Modify (sync copies): `web/js/rules/combat.js`, `web/js/rules/movement.js`, `web/js/rules/twoSquareRule.js` (new files, copied from `src/rules/`)

- [ ] **Step 0: Complete the rules-engine copy in `web/js/rules/`**

```bash
cp src/rules/combat.js src/rules/movement.js src/rules/twoSquareRule.js web/js/rules/
diff -rq src/rules/ web/js/rules/ | grep -v README
```

Expected: no output — `web/js/rules/` now has all 6 rules files, byte-identical to `src/rules/`.

- [ ] **Step 1: Write the failing tests**

Create `test/web/bot.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickBotFormationPlacements, chooseBotMove } from '../../web/js/bot.js';
import { ARMY_COMPOSITION, ARMY_SIZE } from '../../web/js/rules/pieces.js';

test('pickBotFormationPlacements returns a full, valid army with no duplicate squares', () => {
  const placements = pickBotFormationPlacements();
  assert.equal(placements.length, ARMY_SIZE);

  const seen = new Set();
  const countByRank = new Map();
  for (const p of placements) {
    const key = `${p.row},${p.col}`;
    assert.equal(seen.has(key), false, `duplicate square ${key}`);
    seen.add(key);
    assert.ok(p.row >= 0 && p.row <= 3, `row ${p.row} outside slot-2 territory`);
    assert.ok(p.col >= 0 && p.col <= 9, `col ${p.col} out of bounds`);
    countByRank.set(String(p.rank), (countByRank.get(String(p.rank)) ?? 0) + 1);
  }
  for (const entry of ARMY_COMPOSITION) {
    assert.equal(countByRank.get(String(entry.rank)), entry.count, `wrong count for rank ${entry.rank}`);
  }
});

test('chooseBotMove prefers a winning capture over other legal moves', () => {
  const rows = [
    { piece_id: 'colonel-1', player_slot: 2, rank: '3', row_idx: 5, col_idx: 5, alive: true, is_mine: true },
    { piece_id: 'major-enemy', player_slot: 1, rank: '4', row_idx: 5, col_idx: 6, alive: true, is_mine: false },
  ];
  const move = chooseBotMove(rows, 2, []);
  assert.deepEqual(move, { pieceId: 'colonel-1', from: { row: 5, col: 5 }, to: { row: 5, col: 6 } });
});

test('chooseBotMove avoids a losing capture when a safe alternative exists', () => {
  const rows = [
    { piece_id: 'sergeant-1', player_slot: 2, rank: '7', row_idx: 5, col_idx: 5, alive: true, is_mine: true },
    { piece_id: 'blocker-1', player_slot: 2, rank: 'BOMB', row_idx: 4, col_idx: 5, alive: true, is_mine: true },
    { piece_id: 'blocker-2', player_slot: 2, rank: 'BOMB', row_idx: 6, col_idx: 5, alive: true, is_mine: true },
    { piece_id: 'blocker-3', player_slot: 2, rank: 'BOMB', row_idx: 5, col_idx: 4, alive: true, is_mine: true },
    { piece_id: 'marshal-enemy', player_slot: 1, rank: '1', row_idx: 5, col_idx: 6, alive: true, is_mine: false },
    { piece_id: 'scout-1', player_slot: 2, rank: '9', row_idx: 0, col_idx: 0, alive: true, is_mine: true },
  ];
  const move = chooseBotMove(rows, 2, []);
  assert.notEqual(move.pieceId, 'sergeant-1');
});

test('chooseBotMove picks a losing capture when it is the only legal move', () => {
  const rows = [
    { piece_id: 'sergeant-1', player_slot: 2, rank: '7', row_idx: 5, col_idx: 5, alive: true, is_mine: true },
    { piece_id: 'blocker-1', player_slot: 2, rank: 'BOMB', row_idx: 4, col_idx: 5, alive: true, is_mine: true },
    { piece_id: 'blocker-2', player_slot: 2, rank: 'BOMB', row_idx: 6, col_idx: 5, alive: true, is_mine: true },
    { piece_id: 'blocker-3', player_slot: 2, rank: 'BOMB', row_idx: 5, col_idx: 4, alive: true, is_mine: true },
    { piece_id: 'marshal-enemy', player_slot: 1, rank: '1', row_idx: 5, col_idx: 6, alive: true, is_mine: false },
  ];
  const move = chooseBotMove(rows, 2, []);
  assert.deepEqual(move, { pieceId: 'sergeant-1', from: { row: 5, col: 5 }, to: { row: 5, col: 6 } });
});

test('chooseBotMove returns null when the bot has no legal moves', () => {
  const rows = [
    { piece_id: 'bomb-1', player_slot: 2, rank: 'BOMB', row_idx: 0, col_idx: 0, alive: true, is_mine: true },
  ];
  assert.equal(chooseBotMove(rows, 2, []), null);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `web/js/bot.js` doesn't exist yet, so the import errors out. The rest of the suite still passes.

- [ ] **Step 3: Implement `web/js/bot.js`**

```javascript
// web/js/bot.js
import { DEFENSIVE_FORMATIONS, AGGRESSIVE_FORMATIONS } from "./formations.js";
import { getLegalMoves } from "./rules/game.js";
import { resolveCombat, COMBAT_OUTCOME } from "./rules/combat.js";

const ALL_FORMATIONS = [...DEFENSIVE_FORMATIONS, ...AGGRESSIVE_FORMATIONS];

// The bot is always seated as player slot 2. Slot 2's absolute board rows
// (0-3) already match the local row numbering formations.js stores cells
// in, so -- unlike slot 1's setup screen (see setup.js's ABSOLUTE_ROWS) --
// no row-mirroring is needed here.
export function pickBotFormationPlacements() {
  const formation = ALL_FORMATIONS[Math.floor(Math.random() * ALL_FORMATIONS.length)];
  return formation.cells.map(([row, col, rank]) => ({ rank, row, col }));
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

// gameStateRows: rows shaped like get_game_state()'s output (piece_id,
// player_slot, rank, row_idx, col_idx, alive, is_mine). Opponent pieces
// that haven't been revealed have rank === null, exactly as a human
// opponent would see them -- the bot gets no extra information.
export function chooseBotMove(gameStateRows, botSlot, botMoveHistory) {
  const pieces = gameStateRows.map(toRulesPiece);
  const legalMoves = getLegalMoves(pieces, botSlot, botMoveHistory);
  if (legalMoves.length === 0) return null;

  const botRankByPieceId = new Map(
    pieces.filter((p) => p.playerSlot === botSlot).map((p) => [p.id, p.rank]),
  );

  const winning = [];
  const safe = [];
  const losing = [];

  for (const move of legalMoves) {
    const defender = pieces.find((p) => p.alive && p.row === move.to.row && p.col === move.to.col);
    if (!defender || defender.rank == null) {
      safe.push(move);
      continue;
    }
    const outcome = resolveCombat(botRankByPieceId.get(move.pieceId), defender.rank);
    if (outcome === COMBAT_OUTCOME.DEFENDER_WINS) {
      losing.push(move);
    } else {
      winning.push(move);
    }
  }

  const pool = winning.length > 0 ? winning : safe.length > 0 ? safe : losing;
  return pool[Math.floor(Math.random() * pool.length)];
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — all tests including the 5 new ones (56 total).

- [ ] **Step 5: Commit**

```bash
git add web/js/bot.js test/web/bot.test.js
git commit -m "feat: add bot.js move-picking heuristic"
```

---

## Task 5: "Play vs Bot" entry point on the home screen

**Files:**
- Modify: `web/index.html`
- Modify: `web/js/home.js`

- [ ] **Step 1: Add the button to the home screen**

In `web/index.html`, add a new panel between the "Start a new game" panel and the "Join a game" panel:

```html
    <section class="panel">
      <h2>Play vs Bot</h2>
      <p class="hint-text">Practice or bug-test alone — the bot plays legal moves automatically.</p>
      <button id="play-bot-btn" class="btn-primary">Play vs Bot</button>
    </section>
```

- [ ] **Step 2: Add the click handler**

In `web/js/home.js`, add this import at the top:

```javascript
import { pickBotFormationPlacements } from "./bot.js";
```

Then add this handler after the existing `join-form` submit handler (at the end of the file):

```javascript
document.getElementById("play-bot-btn").addEventListener("click", async () => {
  const button = document.getElementById("play-bot-btn");
  const resultEl = document.getElementById("new-game-result");
  button.disabled = true;
  try {
    const { roomCode, token } = await callFunction("create-game", { isBotGame: true });
    storeSession(roomCode, token, 1);

    const { token: botToken } = await callFunction("join-game", { roomCode });
    const placements = pickBotFormationPlacements();
    await callFunction("submit-setup", { token: botToken, placements });
    localStorage.setItem(`stratego:${roomCode}:botToken`, botToken);

    location.href = `setup.html?code=${roomCode}`;
  } catch (err) {
    resultEl.hidden = false;
    resultEl.textContent = `Failed to start bot game: ${err.message}`;
    button.disabled = false;
  }
});
```

- [ ] **Step 3: Commit**

```bash
git add web/index.html web/js/home.js
git commit -m "feat: add Play vs Bot button to home screen"
```

---

## Task 6: Bot auto-play loop and UI labeling in the game screen

**Files:**
- Modify: `web/js/game.js`

- [ ] **Step 1: Add the bot slot constant and a re-entry guard**

Near the top of `web/js/game.js`, right after the existing `let selectedPieceId = null;` line, add:

```javascript
const BOT_SLOT = 2;
let botMoveScheduled = false;
```

- [ ] **Step 2: Include `is_bot_game` in the games row query**

Change the existing `refreshGameRow` function's select from:

```javascript
    .select("status, current_turn_slot, turn_number, winner_slot")
```

to:

```javascript
    .select("status, current_turn_slot, turn_number, winner_slot, is_bot_game")
```

- [ ] **Step 3: Update the turn indicator and move-log labels for bot games**

In `renderTurnIndicator`, change:

```javascript
  el.textContent = gameRow.current_turn_slot === mySlot ? "Your turn" : "Waiting for opponent...";
```

to:

```javascript
  el.textContent = gameRow.current_turn_slot === mySlot
    ? "Your turn"
    : gameRow.is_bot_game ? "Bot's turn..." : "Waiting for opponent...";
```

In `refreshMoveLog`, change:

```javascript
    const who = m.player_slot === mySlot ? "You" : "Opponent";
```

to:

```javascript
    const who = m.player_slot === mySlot ? "You" : (gameRow?.is_bot_game ? "Bot" : "Opponent");
```

- [ ] **Step 4: Hide the chat form for bot games**

At the end of `renderTurnIndicator` (after the existing `el.textContent = ...` line, still inside the function, before its closing brace), add:

```javascript
  if (gameRow.is_bot_game) {
    document.getElementById("chat-form").hidden = true;
  }
```

- [ ] **Step 5: Write the bot move function**

Add this new function after `refreshChat` and before `renderBoard`:

```javascript
async function makeBotMove(gameId) {
  const botToken = localStorage.getItem(`stratego:${roomCode}:botToken`);
  if (!botToken) return;

  const MAX_ATTEMPTS = 5;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const { data: rows, error: stateError } = await supabase.rpc("get_game_state", { p_token: botToken });
    if (stateError || !rows) return;

    const { data: moveRows } = await supabase
      .from("moves")
      .select("piece_id, from_row, from_col, to_row, to_col")
      .eq("game_id", gameId)
      .eq("player_slot", BOT_SLOT)
      .order("move_number", { ascending: true });

    const botHistory = (moveRows ?? []).map((m) => ({
      pieceId: m.piece_id,
      from: `${m.from_row},${m.from_col}`,
      to: `${m.to_row},${m.to_col}`,
    }));

    const move = chooseBotMove(rows, BOT_SLOT, botHistory);
    if (!move) return;

    try {
      await callFunction("make-move", { token: botToken, from: move.from, to: move.to });
      await refreshState();
      await refreshGameRow(gameId);
      await refreshMoveLog(gameId);
      return;
    } catch (err) {
      console.warn("Bot move rejected, retrying:", err.message);
    }
  }
}
```

Add the import at the top of the file, alongside the existing imports:

```javascript
import { chooseBotMove } from "./bot.js";
```

- [ ] **Step 6: Schedule the bot's move when it's the bot's turn**

In `refreshGameRow`, after the line `renderTurnIndicator();` (still inside the function, before its closing brace), add:

```javascript
  if (
    gameRow.is_bot_game &&
    gameRow.status === "active" &&
    gameRow.current_turn_slot === BOT_SLOT &&
    !botMoveScheduled
  ) {
    botMoveScheduled = true;
    setTimeout(() => {
      makeBotMove(gameId).finally(() => {
        botMoveScheduled = false;
      });
    }, 1000);
  }
```

Note `refreshGameRow` already takes `gameId` as a parameter, so it's in scope here.

- [ ] **Step 7: Commit**

```bash
git add web/js/game.js
git commit -m "feat: bot auto-play loop and bot-game UI labeling"
```

---

## Task 7: Local end-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full unit test suite one more time**

Run: `npm test`
Expected: PASS — 56 tests, 0 failures.

- [ ] **Step 2: Start the local Supabase stack and apply the new migration**

```bash
npx supabase start
npx supabase db reset
```

Expected: no errors; `is_bot_game` column exists on `games` (confirm with `npx supabase db diff` showing no pending changes, or by inspecting the table via `npx supabase status` → Studio URL).

- [ ] **Step 3: Serve Edge Functions locally**

```bash
npx supabase functions serve --no-verify-jwt
```

Run this in the background (it's a long-running process) — leave it running for the rest of this task.

- [ ] **Step 4: Point the frontend at the local stack temporarily**

`web/js/supabaseClient.js` currently hardcodes the production URL and anon key. Temporarily replace them with the local values printed by `npx supabase status` (look for `API URL` and `anon key`), so local testing doesn't touch production data. **Do not commit this temporary change** — it gets reverted in Step 7 before anything is committed.

- [ ] **Step 5: Serve the frontend**

```bash
npx http-server web -p 8080
```

- [ ] **Step 6: Playwright verification**

Reuse the scratch Playwright install at `/tmp/pw-verify` if present (check with `ls /tmp/pw-verify`); otherwise set up a minimal one (`npm init -y && npm install playwright && npx playwright install chromium` in `/tmp/pw-verify`).

Write and run a script that, against `http://localhost:8080`:
1. Opens the home page, clicks "Play vs Bot".
2. Confirms it lands on `setup.html` with no invite-link UI shown.
3. Places a full 40-piece setup (e.g. click "Defensive" once to auto-fill, or place manually) and clicks "Submit setup".
4. Confirms it lands on `game.html` with `status: active` (i.e. the bot's setup was already recorded, so the game started as soon as the human's setup landed).
5. Confirms the turn indicator shows "Your turn" (first-move coin flip may occasionally give the bot the first move — if so, wait and confirm the indicator flips to "Your turn" within ~3s after the bot's automatic move).
6. Makes one legal move as the human player.
7. Waits up to 3s and confirms the turn indicator returns to "Your turn" (i.e. the bot responded automatically) and the move log shows a "Bot:" entry.
8. Confirms the chat input (`#chat-form`) is hidden.

Expected: all assertions pass. If any step fails, fix the relevant file from Tasks 1-6 and re-run — do not proceed to Task 8 until this passes.

- [ ] **Step 7: Revert the temporary local Supabase URL/key change**

Restore `web/js/supabaseClient.js` to the production values it had before Step 4 (use `git diff web/js/supabaseClient.js` to confirm it matches the last committed version, then `git checkout -- web/js/supabaseClient.js` if it doesn't).

- [ ] **Step 8: Stop local services**

```bash
npx supabase stop
```

(Stop the `functions serve` and `http-server` background processes too.)

---

## Task 8: Deploy to production and verify live

**Files:** none (deploy + verification only)

- [ ] **Step 1: Push the migration to production**

```bash
npx supabase link --project-ref cafqbrzaxcwewwtyqpnf
npx supabase db push
```

Expected: confirms `0002_bot_game.sql` applied with no errors.

- [ ] **Step 2: Deploy the updated Edge Function**

```bash
npx supabase functions deploy create-game
```

Expected: deploy succeeds. (Only `create-game` changed in this plan — no need to redeploy the other six functions.)

- [ ] **Step 3: Push the repo so Render redeploys the frontend**

```bash
git push
```

Expected: push succeeds; Render's connected GitHub integration auto-redeploys `stratego-1ex2.onrender.com` on push to `main` (per existing setup — no action needed beyond the push, but wait ~1-2 minutes for the deploy to finish before the next step).

- [ ] **Step 4: Playwright verification against the live production site**

Run the same Playwright script from Task 7 Step 6, but pointed at `https://stratego-1ex2.onrender.com` instead of `localhost:8080`. This is the step that actually proves the feature works against the real deployed backend — per the project's own established lesson, local-only testing has previously missed production-only issues (the CORS bug), so this step is not optional.

Expected: all assertions pass against production.

- [ ] **Step 5: Manual smoke check**

Open `https://stratego-1ex2.onrender.com` in a real browser, click "Play vs Bot", play a few moves by hand (including at least one attack), and confirm it feels right (bot responds within ~1-2s, combat reveals correctly, move log labels the opponent "Bot").

---

## Deviation log

- **Task 4 (found by implementer):** The plan's original test fixtures placed pieces at `(5,5)`/`(5,6)` for the capture-adjacency scenarios, but `(5,6)` is a lake square (`board.js` lake set includes `'5,6'`), making those moves illegal by construction. The implementer relocated the fixtures to dry-land coordinates (`(5,5)`/`(5,4)` for the winning-capture test; row 3 for the blocked-sergeant tests) while preserving the exact same test intent. Verified correct — see `test/web/bot.test.js`.

- **Task 7 (found by Playwright verification):** `handleCellClick` (the human's own move handler, pre-existing code not otherwise touched by this plan) calls `refreshState()` after a successful `make-move`, but not `refreshGameRow(gameId)`. The bot-scheduling check lives entirely inside `refreshGameRow`, which after page load is only re-invoked via the Supabase Realtime `postgres_changes` subscription on `games`. If the human's first move happens before that subscription has finished establishing, the resulting turn-flip UPDATE can be missed entirely (Postgres Changes delivery has no replay/backfill), silently stalling the bot forever until an unrelated page reload. Fix: promote `gameId` to a module-level variable (currently local to `init()`, inaccessible to `handleCellClick`'s closure) and have `handleCellClick` call `refreshGameRow(gameId)` directly after its own successful move, matching the same defensive "don't rely solely on Realtime" pattern `makeBotMove` itself already uses.

## Self-review notes

- **Spec coverage:** every component in the design doc (`is_bot_game` column, `create-game` flag, `getLegalMoves`, `bot.js`, home screen button, `game.js` auto-play loop + labeling + chat hiding, local + production verification) maps to a task above. The design doc's explicit non-goals (bot-aware rematch, unattended play, search/planning) are intentionally not implemented anywhere in this plan.
- **No placeholders:** all code blocks are complete; no TBD/TODO markers.
- **Type/name consistency checked:** `chooseBotMove(gameStateRows, botSlot, botMoveHistory)` is defined once in Task 4 and called with that exact signature in Task 6 Step 5. `pickBotFormationPlacements()` (no arguments) is defined in Task 4 and called with no arguments in Task 5 Step 2. `BOT_SLOT` is defined once in Task 6 Step 1 and reused in Task 6 Steps 5-6 rather than re-declaring `2` as a magic number.
