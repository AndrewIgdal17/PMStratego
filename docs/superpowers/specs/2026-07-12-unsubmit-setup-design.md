# Unsubmit Setup Placement — Design Spec

## Goal

Allow players to take back their army placement after submitting, with a 10-second countdown window after both players submit before the game goes active. Either player can unsubmit during the countdown to rearrange.

## Game Flow Change

### Current flow
1. Player submits → `submit-setup` sets `setup_submitted = true`, inserts pieces.
2. When the second player submits, `submit-setup` immediately flips `games.status` to `active`.

### New flow
1. Player submits → same as before.
2. When the second player submits, `submit-setup` sets `games.both_submitted_at = now()` but does NOT flip to `active`.
3. Both players' setup screens show a 10-second countdown: "Game starting in 10... 9..."
4. During the countdown, an "Unsubmit" button is available on both screens.
5. If either player clicks "Unsubmit" → `unsubmit-setup` Edge Function deletes their pieces, resets `setup_submitted = false`, clears `both_submitted_at`. The other player sees "Opponent is rearranging..." and the countdown resets.
6. When the countdown hits zero, the frontend calls `start-game` Edge Function which flips status to `active` (with server-side validation that 10 seconds have passed and both players still have `setup_submitted = true`).

### Bot games
Skip the countdown entirely. When the human submits in a bot game, `submit-setup` immediately activates (existing behavior preserved). The bot's setup was already submitted by `home.js` before the human even reaches the setup screen, so the human is always the second submitter in bot games — the existing immediate-activation path stays for `is_bot_game = true`.

## Backend Changes

### New column: `games.both_submitted_at`

Migration `0004_unsubmit.sql`:

```sql
alter table games add column both_submitted_at timestamptz;
```

### Modify `submit-setup` Edge Function

When the second player submits (both `setup_submitted` are now true):
- If `is_bot_game = true`: flip to `active` immediately (existing behavior, unchanged).
- If `is_bot_game = false`: set `both_submitted_at = now()` but do NOT flip to `active`. Return `{ ok: true, countdownStarted: true }` so the frontend knows to start the countdown.

### New Edge Function: `unsubmit-setup`

Endpoint accepts `{ token }`. Validates:
- Token maps to a valid `game_players` row.
- Game status is `setup` (can't unsubmit once active/finished).
- The player has `setup_submitted = true` (can't unsubmit if you haven't submitted).

Actions:
1. Delete all `pieces` rows for this player in this game.
2. Set `game_players.setup_submitted = false` for this player.
3. Set `games.both_submitted_at = null` (clears the countdown for both players).
4. Return `{ ok: true }`.

Uses service role (same pattern as other Edge Functions). Includes CORS headers (same `_shared/cors.ts`).

### New Edge Function: `start-game`

Endpoint accepts `{ token }`. Validates:
- Token maps to a valid `game_players` row.
- Game status is `setup`.
- Both players have `setup_submitted = true`.
- `both_submitted_at` is not null and is at least 10 seconds ago (`now() - both_submitted_at >= interval '10 seconds'`).

Actions:
1. Randomly assign first turn: `current_turn_slot = random 1 or 2`.
2. Set `status = 'active'`, `turn_number = 1`.
3. Return `{ ok: true }`.

If the 10 seconds haven't elapsed yet, return `{ error: "COUNTDOWN_NOT_FINISHED" }` with status 400. The frontend will retry after the remaining time.

## Frontend Changes

### Setup screen (`setup.js`)

After the player submits their setup, the screen currently shows "Waiting for opponent..." and polls/subscribes for the game to go active. New behavior:

**State machine for post-submission UI:**

1. **Waiting** — your setup is submitted, opponent hasn't submitted yet. Show "Waiting for opponent..." (existing). "Unsubmit" button visible.
2. **Countdown** — both submitted, `both_submitted_at` is set. Show "Game starting in X..." countdown + "Unsubmit" button. Countdown counts down from 10 to 0.
3. **Starting** — countdown reached zero. Call `start-game`. If it succeeds, redirect to `game.html`. If it returns `COUNTDOWN_NOT_FINISHED`, wait and retry.
4. **Opponent unsubmitted** — `both_submitted_at` was set but got cleared (Realtime update). Show "Opponent is rearranging..." Reset countdown. "Unsubmit" button still visible.

**Unsubmit button:** When clicked, calls `unsubmit-setup` Edge Function. On success, re-enables the placement grid, clears the "submitted" state, and the player can rearrange and resubmit.

**Realtime subscription:** Subscribe to `games` table changes for this game. Watch for:
- `both_submitted_at` becoming non-null → start countdown.
- `both_submitted_at` becoming null → reset countdown, show "Opponent is rearranging..."
- `status` becoming `active` → redirect to `game.html` (in case the other player's `start-game` call succeeded first).

### Setup screen (`setup.html`)

Add an "Unsubmit" button (hidden by default, shown after submission):

```html
<button id="unsubmit-btn" class="btn-danger" hidden>Unsubmit</button>
```

Add a countdown display element:

```html
<p id="countdown-display" class="countdown" hidden></p>
```

### Existing `submit-setup` changes in `setup.js`

Currently after a successful submit, the code disables the grid and shows a status message. Update to:
- Show "Unsubmit" button.
- Subscribe to Realtime for `both_submitted_at` changes.
- If the response includes `countdownStarted: true`, immediately start the countdown.

## Files Changed

- **Create:** `supabase/migrations/0004_unsubmit.sql` — `both_submitted_at` column
- **Create:** `supabase/functions/unsubmit-setup/index.ts` — new Edge Function
- **Create:** `supabase/functions/start-game/index.ts` — new Edge Function
- **Modify:** `supabase/functions/submit-setup/index.ts` — set `both_submitted_at` instead of immediate activation for non-bot games
- **Modify:** `web/setup.html` — unsubmit button + countdown display
- **Modify:** `web/js/setup.js` — post-submission state machine, unsubmit handler, countdown logic, Realtime subscription, `start-game` call
- **Modify:** `web/css/styles.css` — countdown display styling (optional, minimal)

## Non-Goals

- No undo after game goes active.
- No limit on how many times a player can unsubmit/resubmit.
- No "ready" confirmation step beyond the countdown — the countdown IS the confirmation window.
- No changes to bot game flow (bots skip the countdown).
