# Spectator Mode — Design Spec

## Goal

Allow a third person to watch a live Stratego game in real-time with full visibility of both armies (no fog of war). Spectators are read-only — they can see the board, move log, and chat, but cannot interact.

## Architecture

Backend: a new `get_spectator_state` Postgres RPC that returns all pieces with all ranks visible (no redaction). Frontend: `game.js` detects a `spectate=1` URL parameter, calls the spectator RPC instead of `get_game_state`, disables all interactive controls, and renders both armies with their ranks shown.

## Access Model

- **Room code access:** Anyone who knows the room code can spectate. No spectator token, no `game_players` row — the room code is the access key, matching the existing trust model (casual play between friends, not competitive/secured).
- **Entry points:**
  1. Home page "Watch a game" panel — enter room code, click "Spectate", navigates to `game.html?code=ABCD&spectate=1`
  2. Direct URL — `game.html?code=ABCD&spectate=1`
- **No limit** on number of simultaneous spectators (they're just Supabase RPC callers + Realtime subscribers).

## Backend: `get_spectator_state` RPC

### New migration: `supabase/migrations/0003_spectator.sql`

A new Postgres function `get_spectator_state(p_room_code text)`:

- Takes a **room code** (not a player token — spectators don't have tokens).
- Looks up the game by room code.
- Returns all pieces for that game with the same column shape as `get_game_state`: `piece_id`, `player_slot`, `rank`, `row_idx`, `col_idx`, `alive`, `is_mine`.
- **All ranks are always visible** — no `CASE WHEN` redaction. Every piece's `rank` column returns its actual rank.
- `is_mine` is always `false` for every piece (the spectator doesn't own either army).
- Raises an exception if the room code doesn't match a game.
- Granted to `anon` role (same as `get_game_state`).

This is intentionally a separate function from `get_game_state` rather than adding a flag/parameter to the existing one — keeps the fog-of-war enforcement in `get_game_state` clean, auditable, and impossible to accidentally bypass.

## Frontend: Spectator View

### Detection

`game.js` checks `params.get("spectate") === "1"` at the top of the file. When true:

- Sets a module-level `const isSpectator = true` flag.
- Does NOT read a player token from localStorage (spectators don't have one).
- Does NOT throw on missing token.

### Game state loading

- Instead of `supabase.rpc("get_game_state", { p_token: token })`, calls `supabase.rpc("get_spectator_state", { p_room_code: roomCode })`.
- `piecesById` is populated the same way — the return shape is identical.

### Board rendering

- Both armies' pieces are fully visible with ranks shown.
- Slot 1 pieces render with the default green (`#4a7a4a`) — spectators don't have a color choice.
- Slot 2 pieces render with the existing enemy red (`#8b4444`).
- `createTokenSVG` is called with `isMine` based on `player_slot === 1` (arbitrary — spectator sees both, slot 1 gets the "friendly" color treatment, slot 2 gets the "enemy" color treatment).
- Board is rendered from slot 1's perspective (no rotation) — spectators see absolute coordinates.
- Click handlers are attached but `handleCellClick` returns immediately when `isSpectator` is true (no piece selection, no moves).

### UI adjustments when spectating

- Turn indicator shows `"Player 1's turn"` / `"Player 2's turn"` (or `"Bot's turn"` for bot games) instead of `"Your turn"` / `"Waiting for opponent"`.
- Game-over shows `"Player 1 wins!"` / `"Player 2 wins!"` instead of `"You won!"` / `"You lost."`.
- Resign button: hidden.
- Rematch button: hidden.
- Chat log: visible (spectators can read chat).
- Chat input form: hidden (spectators can't send messages).
- Graveyards: both rendered with full ranks visible (the spectator RPC returns all ranks, so the graveyard renderer will naturally populate both trays correctly).

### Move log

- Uses `formatAbsCoord` for coordinates (from slot 1's perspective, matching the spectator's board view).
- Shows piece names for ALL moves (both players' non-combat and combat) — no fog of war for spectators.
- Labels moves as `"P1:"` / `"P2:"` (or `"Bot:"`) instead of `"You:"` / `"Opponent:"`.

### Realtime

- Subscribes to the same `game-${gameId}` Realtime channel for live updates.
- On `games` table UPDATE: refreshes game row + state + move log (same as player view).
- On `chat_messages` INSERT: refreshes chat (same as player view).

### Game ID loading

- Spectators still need the `game_id` for Realtime subscriptions. `loadGameId()` queries the `games` table by `room_code` — this already works without a token (the `games` table has an open SELECT policy).

## Home Page

### New panel on `index.html`

A "Watch a game" section between "Play vs Bot" and "Join a game":

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

### Handler in `home.js`

On submit: navigates to `game.html?code=${roomCode}&spectate=1`. No server call needed — the game page itself will validate the room code when it calls `get_spectator_state`.

## Files Changed

- **Create:** `supabase/migrations/0003_spectator.sql` — `get_spectator_state` RPC
- **Modify:** `web/index.html` — "Watch a game" panel
- **Modify:** `web/js/home.js` — spectate form handler
- **Modify:** `web/js/game.js` — spectator detection, alternate RPC, read-only mode, dual-army rendering, spectator-appropriate labels

## Non-Goals

- No spectator chat (spectators are silent observers).
- No spectator count display (players don't see how many spectators are watching).
- No spectator authentication or rate limiting.
- No delayed/buffered view (real-time only, per user decision).
- No separate spectator page — reuses `game.html` with the `spectate=1` flag.
