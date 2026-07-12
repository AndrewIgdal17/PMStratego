# Spectator Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow a third person to watch a live Stratego game in real-time with full visibility of both armies — read-only, no fog of war.

**Architecture:** New `get_spectator_state` Postgres RPC (takes room code, returns all pieces with all ranks visible). Frontend detects `spectate=1` URL param, calls the spectator RPC, disables interaction, renders both armies fully. Home page gets a "Watch a game" panel.

**Tech Stack:** Plain JavaScript (ESM), Supabase (Postgres RPC + Realtime), CSS.

**Design reference:** `docs/superpowers/specs/2026-07-11-spectator-mode-design.md`

---

## Task 1: Create `get_spectator_state` RPC

**Files:**
- Create: `supabase/migrations/0003_spectator.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0003_spectator.sql`:

```sql
-- supabase/migrations/0003_spectator.sql
create or replace function get_spectator_state(p_room_code text)
returns table (
  piece_id uuid,
  player_slot smallint,
  rank text,
  row_idx smallint,
  col_idx smallint,
  alive boolean,
  is_mine boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game_id uuid;
begin
  select g.id into v_game_id
  from games g
  where g.room_code = p_room_code;

  if v_game_id is null then
    raise exception 'game not found';
  end if;

  return query
  select
    p.id,
    p.player_slot,
    p.rank,
    p.row_idx,
    p.col_idx,
    p.alive,
    false as is_mine
  from pieces p
  where p.game_id = v_game_id;
end;
$$;

grant execute on function get_spectator_state(text) to anon;
```

Key differences from `get_game_state`:
- Takes `p_room_code text` instead of `p_token uuid`
- No `CASE WHEN` rank redaction — all ranks always visible
- `is_mine` is always `false` (spectator owns neither army)
- Looks up game by `room_code` instead of via `game_players.secret_token`

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/0003_spectator.sql
git commit -m "feat: add get_spectator_state RPC for full-visibility spectator view"
```

---

## Task 2: Add "Watch a game" panel to the home page

**Files:**
- Modify: `web/index.html`
- Modify: `web/js/home.js`

- [ ] **Step 1: Add the spectate panel to index.html**

In `web/index.html`, add a new panel AFTER the "Play vs Bot" panel and BEFORE the "Join a game" panel:

```html
      <section class="panel">
        <h2>Watch a game</h2>
        <p class="hint-text">Spectate a live game — see all pieces, both sides.</p>
        <form id="spectate-form">
          <input id="spectate-code-input" placeholder="Room code" maxlength="8" autocapitalize="characters" required />
          <button type="submit">Spectate</button>
        </form>
        <p id="spectate-error" class="error" hidden></p>
      </section>
```

- [ ] **Step 2: Add the spectate form handler to home.js**

At the end of `web/js/home.js`, after the existing `play-bot-btn` handler, add:

```javascript
document.getElementById("spectate-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const roomCode = document.getElementById("spectate-code-input").value.trim().toUpperCase();
  if (!roomCode) return;
  location.href = `game.html?code=${roomCode}&spectate=1`;
});
```

No server call needed — the game page validates the room code when it calls `get_spectator_state`.

- [ ] **Step 3: Commit**

```bash
git add web/index.html web/js/home.js
git commit -m "feat: add Watch a Game panel to home page for spectator access"
```

---

## Task 3: Add spectator mode to `game.js`

**Files:**
- Modify: `web/js/game.js`

This is the main task. The changes are scattered across the file but all follow the same pattern: check `isSpectator` and branch behavior.

- [ ] **Step 1: Add spectator detection and bypass the token check**

In `web/js/game.js`, find the block starting at line 99:

```javascript
const params = new URLSearchParams(location.search);
const roomCode = params.get("code");
const token = localStorage.getItem(`stratego:${roomCode}:token`);
const mySlot = Number(localStorage.getItem(`stratego:${roomCode}:slot`));

const navRoomEl = document.getElementById("nav-room-code");
if (navRoomEl && roomCode) navRoomEl.textContent = `Room: ${roomCode}`;

if (!token) {
  document.body.innerHTML = "<p>No access token found for this room.</p>";
  throw new Error("missing token");
}
```

Replace it with:

```javascript
const params = new URLSearchParams(location.search);
const roomCode = params.get("code");
const isSpectator = params.get("spectate") === "1";
const token = isSpectator ? null : localStorage.getItem(`stratego:${roomCode}:token`);
const mySlot = isSpectator ? 0 : Number(localStorage.getItem(`stratego:${roomCode}:slot`));

const navRoomEl = document.getElementById("nav-room-code");
if (navRoomEl && roomCode) navRoomEl.textContent = `Room: ${roomCode}${isSpectator ? ' (Spectating)' : ''}`;

if (!token && !isSpectator) {
  document.body.innerHTML = "<p>No access token found for this room.</p>";
  throw new Error("missing token");
}
```

- [ ] **Step 2: Update `refreshState` to use the spectator RPC**

Find the existing `refreshState` function:

```javascript
async function refreshState() {
  const { data: rows, error } = await supabase.rpc("get_game_state", { p_token: token });
  if (error) {
    console.error("get_game_state failed", error);
    return;
  }
  piecesById = new Map(rows.map((r) => [r.piece_id, r]));
  renderBoard();
  renderGraveyards(lastMoveData);
}
```

Replace it with:

```javascript
async function refreshState() {
  let rows, error;
  if (isSpectator) {
    ({ data: rows, error } = await supabase.rpc("get_spectator_state", { p_room_code: roomCode }));
  } else {
    ({ data: rows, error } = await supabase.rpc("get_game_state", { p_token: token }));
  }
  if (error) {
    console.error("state fetch failed", error);
    return;
  }
  piecesById = new Map(rows.map((r) => [r.piece_id, r]));
  renderBoard();
  renderGraveyards(lastMoveData);
}
```

- [ ] **Step 3: Update `renderTurnIndicator` for spectator labels**

Find the existing `renderTurnIndicator` function. Replace the entire function with:

```javascript
function renderTurnIndicator() {
  const el = document.getElementById("turn-indicator");
  if (!gameRow) return;
  if (gameRow.status === "finished") {
    if (isSpectator) {
      el.textContent = `Player ${gameRow.winner_slot} wins!`;
    } else {
      el.textContent = gameRow.winner_slot === mySlot ? "You won!" : "You lost.";
    }
    if (!isSpectator) document.getElementById("rematch-btn").hidden = false;
    return;
  }
  if (isSpectator) {
    el.textContent = gameRow.is_bot_game && gameRow.current_turn_slot === 2
      ? "Bot's turn..."
      : `Player ${gameRow.current_turn_slot}'s turn`;
  } else {
    el.textContent = gameRow.current_turn_slot === mySlot
      ? "Your turn"
      : gameRow.is_bot_game ? "Bot's turn..." : "Waiting for opponent...";
  }

  if (isSpectator) {
    document.getElementById("chat-form").hidden = true;
    document.getElementById("resign-btn").hidden = true;
  } else if (gameRow.is_bot_game) {
    document.getElementById("chat-form").hidden = true;
  }
}
```

- [ ] **Step 4: Update `renderBoard` for spectator piece coloring**

In the `renderBoard` function, find the line:

```javascript
        cell.appendChild(createTokenSVG(piece.rank, piece.is_mine));
```

Replace it with:

```javascript
        const isFriendly = isSpectator ? piece.player_slot === 1 : piece.is_mine;
        cell.appendChild(createTokenSVG(piece.rank, isFriendly));
```

For spectators, slot 1 gets the "friendly" green color, slot 2 gets enemy red. For players, the existing `is_mine` logic is unchanged.

- [ ] **Step 5: Update `handleCellClick` to block spectator interaction**

At the very top of the `handleCellClick` function, find:

```javascript
  if (!gameRow || gameRow.status !== "active" || gameRow.current_turn_slot !== mySlot) return;
```

Replace with:

```javascript
  if (isSpectator) return;
  if (!gameRow || gameRow.status !== "active" || gameRow.current_turn_slot !== mySlot) return;
```

- [ ] **Step 6: Update `refreshMoveLog` for spectator labels and full piece names**

In `refreshMoveLog`, find the move log rendering loop (the `for (const m of data)` block). Replace the entire loop with:

```javascript
  for (const m of data) {
    const li = document.createElement("li");
    let who;
    if (isSpectator) {
      who = gameRow?.is_bot_game && m.player_slot === 2 ? "Bot" : `P${m.player_slot}`;
    } else {
      who = m.player_slot === mySlot ? "You" : (gameRow?.is_bot_game ? "Bot" : "Opponent");
    }
    const fromCoord = formatAbsCoord(m.from_row, m.from_col);
    const toCoord = formatAbsCoord(m.to_row, m.to_col);
    const isMyMove = m.player_slot === mySlot;

    if (m.move_type === "attack") {
      li.textContent = `${who}: ${fromCoord} → ${toCoord} (${RANK_NAME[m.attacker_rank] ?? m.attacker_rank} vs ${RANK_NAME[m.defender_rank] ?? m.defender_rank}: ${m.outcome})`;
    } else if (isSpectator) {
      const piece = piecesById.get(m.piece_id);
      const pieceName = piece ? (RANK_NAME[piece.rank] ?? '') : '';
      li.textContent = `${who}: ${pieceName ? pieceName + ' ' : ''}${fromCoord} → ${toCoord}`;
    } else if (isMyMove) {
      const piece = piecesById.get(m.piece_id);
      const pieceName = piece ? (RANK_NAME[piece.rank] ?? '') : '';
      li.textContent = `${who}: ${pieceName ? pieceName + ' ' : ''}${fromCoord} → ${toCoord}`;
    } else {
      li.textContent = `${who}: ${fromCoord} → ${toCoord}`;
    }
    list.appendChild(li);
  }
```

Key difference for spectators: all non-combat moves show piece names (spectators see everything), and labels use "P1"/"P2" instead of "You"/"Opponent".

- [ ] **Step 7: Update `toDisplay` for spectator perspective**

Spectators view the board from slot 1's perspective (no rotation). The existing `toDisplay` and `toAbsolute` use `mySlot` which is `0` for spectators. Since `mySlot !== 2`, both functions already return identity (no mirroring). This is correct — no change needed, but verify by reading the functions.

- [ ] **Step 8: Update graveyard rendering for spectator**

In `renderGraveyards`, the existing code uses `!p.is_mine` to identify enemy pieces. For spectators, `is_mine` is always `false`, so all pieces would be treated as "enemy". We need spectator-aware logic.

In the `renderGraveyards` function, find where it calls `renderSingleGraveyard`:

```javascript
  renderSingleGraveyard('graveyard-enemy-body', false, deadEnemyRanks);
  renderSingleGraveyard('graveyard-mine-body', true, null);
```

Replace with:

```javascript
  if (isSpectator) {
    renderSingleGraveyard('graveyard-enemy-body', false, null, 2);
    renderSingleGraveyard('graveyard-mine-body', false, null, 1);
  } else {
    renderSingleGraveyard('graveyard-enemy-body', false, deadEnemyRanks);
    renderSingleGraveyard('graveyard-mine-body', true, null);
  }
```

And update the `renderSingleGraveyard` signature to accept an optional `filterSlot` parameter. Change:

```javascript
function renderSingleGraveyard(containerId, isMine, enemyRankMap) {
```

to:

```javascript
function renderSingleGraveyard(containerId, isMine, enemyRankMap, filterSlot) {
```

And change the dead pieces filter from:

```javascript
  const deadPieces = allPieces.filter((p) => !p.alive && p.is_mine === isMine);
```

to:

```javascript
  const deadPieces = allPieces.filter((p) => !p.alive && (filterSlot ? p.player_slot === filterSlot : p.is_mine === isMine));
```

Also update the graveyard labels for spectators. In `renderTurnIndicator` (or at the end of `renderGraveyards`), when spectating, change the graveyard header labels. Actually, simpler: do it once in init. After the `if (isSpectator)` block in `renderTurnIndicator`, the labels can be set. Add at the end of `renderTurnIndicator`, inside the `if (isSpectator)` block:

```javascript
    const enemyLabel = document.querySelector('#graveyard-enemy .graveyard-label');
    const mineLabel = document.querySelector('#graveyard-mine .graveyard-label');
    if (enemyLabel) enemyLabel.textContent = 'Player 2 Losses';
    if (mineLabel) mineLabel.textContent = 'Player 1 Losses';
```

- [ ] **Step 9: Commit**

```bash
git add web/js/game.js
git commit -m "feat: add spectator mode to game view — full visibility, read-only"
```

---

## Task 4: Deploy and verify

**Files:** none (deploy + verification only)

- [ ] **Step 1: Push to GitHub and deploy the migration**

```bash
git push
npx supabase db push --project-ref cafqbrzaxcwewwtyqpnf
```

Wait for Render to deploy the frontend (~1-2 min).

- [ ] **Step 2: Local verification with Playwright**

Start the local server if not running:

```bash
npx http-server web -p 8090 -s
```

Write and run a Playwright script against `http://localhost:8090` that:

1. Opens home, clicks "Play vs Bot" to create a game. Notes the room code from the URL.
2. On setup, clicks "Defensive", submits. On game page, makes 2-3 moves (including one that triggers combat if possible).
3. Opens a SECOND browser context (new incognito context — no shared localStorage).
4. In the second context, navigates to `http://localhost:8090/`, enters the room code in the "Watch a game" input, clicks "Spectate".
5. Confirms the second context lands on `game.html?code=XXXX&spectate=1`.
6. Confirms the nav shows "(Spectating)".
7. Confirms both armies' pieces are visible with ranks (no "?" on any pieces).
8. Confirms the resign button is hidden.
9. Confirms the chat form is hidden.
10. Takes a screenshot.

Note: This test runs against the local HTTP server with the production Supabase backend (since `supabaseClient.js` points to production). The `get_spectator_state` RPC must be deployed to production first (Step 1).

- [ ] **Step 3: Commit any fixes**

If the verification reveals issues, fix and push again.

---

## Self-review notes

- **Spec coverage:** `get_spectator_state` RPC ✓. Home page "Watch a game" panel ✓. Spectator detection via URL param ✓. Alternate RPC call ✓. Read-only (no clicks, no resign, no rematch, no chat input) ✓. Full visibility (all ranks shown) ✓. Spectator labels (P1/P2 instead of You/Opponent) ✓. Move log shows all piece names for spectator ✓. Real-time via same Realtime channel ✓. Graveyards with both armies visible ✓.
- **No placeholders:** All code blocks complete. All SQL and JS shown in full.
- **Type/name consistency:** `isSpectator` defined once (Task 3 Step 1), used throughout. `get_spectator_state(p_room_code text)` matches `supabase.rpc("get_spectator_state", { p_room_code: roomCode })`. `filterSlot` parameter added to `renderSingleGraveyard` with backward-compatible default (undefined → uses `isMine` logic).
