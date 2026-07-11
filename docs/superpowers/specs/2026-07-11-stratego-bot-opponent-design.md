# Bot Opponent for Local Bug-Testing

**Date:** 2026-07-11
**Status:** Approved

## Problem

The only way to test the full game (setup, moves, combat, fog-of-war, resign, rematch, win/lose) end-to-end is to have a friend online at the same time as you. That's a bottleneck for bug-testing. Need a "Play vs Bot" mode that lets one person exercise the whole flow alone, against the real production backend, without needing a second human.

## Constraints

- Casual, low-stakes personal project — no over-engineering. A weak bot that makes legal moves is enough; it does not need to play well.
- Must exercise the *real* deployed system (Edge Functions, RLS, Realtime, fog-of-war), not a separate local-only mock — otherwise it doesn't actually help bug-test production.
- No new backend infrastructure (no cron, no new servers) — stay within the existing "no custom backend" architecture.
- Rematch after a bot game and unattended/tab-closed play are explicitly out of scope for v1 (see Non-goals).

## Architecture

The bot is not a new subsystem — it's an ordinary second `game_players` row (always player slot 2) whose moves are chosen by a client-side JS heuristic instead of typed in by a second human. It authenticates through the exact same public, token-based Edge Functions (`create-game`, `join-game`, `submit-setup`, `make-move`) that a human uses. Fog-of-war, turn enforcement, and move legality all stay 100% server-side and unmodified — the bot has no special access and cannot cheat by construction.

```
Home screen "Play vs Bot" click (all in the human's own browser tab)
  │
  ├─ create-game({ isBotGame: true })   → games row gets is_bot_game = true
  ├─ join-game(roomCode)                → bot seated as player_slot 2, mints bot token
  ├─ submit-setup(botToken, <random formation>)
  └─ navigate to setup.html (human places their own pieces as normal)

Once the human submits their own setup, submit-setup's existing
"both submitted?" check already flips the game to active (no changes needed).

During play, in game.js (same tab):
  turn becomes slot 2 (bot)
    → wait ~1s
    → get_game_state(botToken)  [bot's own fog-of-war-correct view]
    → chooseBotMove(...)         [pure heuristic, in web/js/bot.js]
    → make-move(botToken, from, to)
    → existing refreshState/refreshGameRow/refreshMoveLog re-run, same as a human move
```

No new Edge Functions. No new RPCs. One new column, one small existing-function change, and new client-side glue.

## Data model change

`games.is_bot_game boolean not null default false` — new migration. The `games` table already has an open read policy (`using (true)`), so no RLS changes are needed; both the frontend and Realtime can already see this column.

## Components

1. **`create-game`**: accepts an optional `isBotGame` field in the request body (defaults false); writes it to the new column.
2. **`src/rules/game.js`**: new exported `getLegalMoves(pieces, playerSlot, history)`, refactored out of the existing internal `hasAnyLegalMove` (which becomes `getLegalMoves(...).length > 0`). Synced byte-identical into `supabase/functions/_shared/rules/game.js` and `web/js/rules/game.js` per the existing duplication convention, even though only the browser copy is actually called by the bot — this keeps the three copies from drifting.
3. **New `web/js/bot.js`** (pure, unit-testable, no DOM/network):
   - `pickBotFormationPlacements()` — picks one random formation from the combined `DEFENSIVE_FORMATIONS`/`AGGRESSIVE_FORMATIONS` catalog and returns it as a `{rank, row, col}[]` placements array. No row-mirroring needed: the bot is always slot 2, and slot 2's absolute territory rows (0-3) already match the local row numbering `formations.js` stores cells in (unlike slot 1, which is mirrored — see `setup.js`'s `ABSOLUTE_ROWS`).
   - `chooseBotMove(gameStateRows, botSlot, botMoveHistory)` — converts `get_game_state` rows into the rules engine's piece shape, calls `getLegalMoves`, and buckets the results into three pools: **winning** (lands on a revealed enemy piece the bot's piece beats or ties), **safe** (everything else — non-combat moves and attacks on unrevealed pieces), and **losing** (lands on a revealed enemy piece that beats the bot's piece). Returns a uniformly random move from the highest-priority non-empty pool (winning → safe → losing), or `null` if there are no legal moves at all.
4. **Home screen** (`index.html` + `home.js`): new "Play vs Bot" button that runs the three-call sequence above, stores the bot's token in `localStorage` (`stratego:{roomCode}:botToken`) alongside the human's own session, and navigates straight to `setup.html` — no invite-link UI is shown, since there's no second human to send it to.
5. **`game.js`**: reads `gameRow.is_bot_game` (added to the existing `games` select). When true and `current_turn_slot === 2` and the game is active, schedules a single ~1s-delayed bot move: fetches the bot's own state via `get_game_state(botToken)`, fetches the bot's own move history from the `moves` table (already-readable, just filtered to `player_slot = 2`), calls `chooseBotMove`, and submits via `make-move`. If `make-move` rejects the choice (e.g. an edge case the bot's simplified view didn't catch), retries with a freshly recomputed move up to 5 attempts before giving up silently. A boolean guard prevents scheduling overlapping bot-move timers when Realtime fires multiple refreshes. Opponent is labeled "Bot" instead of "Opponent" in the move log for bot games; the chat input is hidden (the bot never sends chat).

## Non-goals (explicit scope boundaries)

- **Rematch is not bot-aware.** Clicking rematch after a bot game creates a normal room waiting for a second human, same as today. To play another bot game, click "Play vs Bot" from home again.
- **No unattended play.** If you close the tab, the bot stops responding until you reopen the game page — there is no server-side cron driving it. Acceptable for the stated use case (bug-testing while you're watching), not suitable as a background opponent.
- **No search, planning, or bluffing.** The bot is a one-ply heuristic. It is sized to exercise game flow, not to play a good game of Stratego.

## Testing approach

- `getLegalMoves` and `chooseBotMove`'s bucket-priority logic are pure functions, unit-tested with `node --test` alongside the existing rules-engine suite (`test/rules/game.test.js`, new `test/web/bot.test.js`).
- End-to-end verification via a real Playwright browser run against both the local Supabase stack (fast iteration) and the actual deployed production stack (per the project's established "local-only testing can't surface platform differences" lesson): start a bot game, complete setup, make a move, confirm the bot auto-responds within ~2s, and confirm at least one combat/reveal happens correctly.

## Dead code / removal

None — this is additive. The only modified existing files are `create-game/index.ts` (new optional field, backward compatible) and `game.js` (new conditional branch gated on `is_bot_game`, no change to existing human-vs-human behavior).

## Next step

Move to `writing-plans` to produce the detailed implementation plan.
