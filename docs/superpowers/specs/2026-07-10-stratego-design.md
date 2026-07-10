# Poor Man's Online Stratego

**Date:** 2026-07-10
**Status:** Approved

## Problem

Want to play full-rules Stratego online with one friend, live or async (moves spread over hours/days), for $0/month, using Render for hosting. Need to determine whether a database (Supabase) is required, and design the smallest architecture that supports real hidden-information gameplay.

## Constraints established during brainstorming

- Play cadence: both live sessions and async (make-a-move-and-leave). Rules out pure in-memory server state.
- Rules fidelity: full official Stratego rules, including hidden piece identity (fog of war) until combat, official combat table, Spy-vs-Marshal exception, Scout long moves, immobile Bombs/Flag, and anti-stalling two-square rule.
- No push notifications for MVP — players check the link themselves.
- Multiple games supported via shareable room codes/links, not a single hardcoded pairing.
- Live board updates when both players are online (not just manual refresh).
- Device target: desktop + mobile, so movement uses tap-to-select/tap-destination rather than drag-and-drop.
- Setup phase: random shuffle, a few strategy-informed preset formations, and manual drag/tap adjustment on top of either.
- MVP extras: resign, rematch, move-history log, in-app chat.
- Visual direction: classic wood & military board style (real-board-game look), confirmed via visual mockup.

## Platform research (verified 2026-07-10)

**Render:** Static Sites are free forever, served via CDN, never spin down. Free Web Services (a custom backend process) sleep after 15 min of inactivity with a 30-60s cold start on the next request, capped at 750 instance-hours/month. Free Postgres on Render expires after 30-90 days depending on source — not viable for long-term state anyway.

**Supabase:** Free tier includes 500MB DB, Realtime (200 concurrent connections, 2M messages/month), 500k Edge Function invocations/month, unlimited API requests. The entire *project* auto-pauses after 7 consecutive days with zero database requests — recoverable with one click in the dashboard, no data loss. A free GitHub Actions cron ping can prevent this if it becomes annoying.

**Conclusion:** avoid Render Web Services entirely (their sleep behavior is the exact problem the async requirement rules out). Use Render only for the static frontend. Push all game logic and persistence into Supabase, which has no equivalent spin-down for the pieces we need (Postgres + Edge Functions + Realtime), just the softer 7-day pause.

## Architecture

```
Browser (both players)
  │  loads static HTML/CSS/JS from Render Static Site
  │  imports @supabase/supabase-js via CDN, no build step
  ▼
Supabase (single free project)
  ├─ Postgres: games, game_players, pieces, moves, chat_messages
  ├─ Edge Functions: create-game, join-game, submit-setup, make-move
  ├─ RPC (SECURITY DEFINER): get_game_state(token) — the ONLY read path for board state
  └─ Realtime: Postgres Changes on `games` (safe, non-secret columns) → triggers client refetch via get_game_state
```

No custom server process exists anywhere. Nothing to keep warm, nothing that sleeps mid-game.

### Why fog of war needs server-side enforcement

Stratego's core mechanic is that your opponent can't see your piece ranks until combat. If the client read a shared `pieces` table directly (even behind Supabase Row Level Security), RLS operates at row level, not column level — both players are allowed to read the row for their shared game, so a curious friend opening the browser's Network tab would see the raw JSON with the opponent's hidden ranks. Row Level Security alone cannot solve this because both players are legitimately allowed to read their shared game.

The fix: **no client ever gets direct table access to `pieces`.** RLS denies `SELECT` entirely for the anon role. The only way to read board state is `get_game_state(token)`, a Postgres function that:
1. Resolves `token` to a `player_slot` (1 or 2) via `game_players`.
2. Returns that player's own 40 pieces in full.
3. Returns the opponent's pieces with `rank` nulled out unless `revealed_rank` is set (i.e., that piece has been in combat).

This is the single source of truth for "what can this player see" — there's no second filtering path to keep in sync.

### Why combat is safe to log fully

Official rules: when two pieces clash, both are revealed to both players regardless of outcome — same as flipping physical pieces face-up. So `moves` rows for combat can store and display both ranks openly to both players; only non-combat moves (moving into an empty square) keep the moved piece's rank hidden from the opponent. This resolves the move-history-log feature without a separate fog-of-war mechanism for it.

### Why Realtime doesn't leak hidden state

Realtime "Postgres Changes" broadcasts the full row to any subscriber RLS allows to read that row. Since both players can legitimately read their shared `games` row, that table is scoped to contain only non-secret fields: `id`, `room_code`, `status`, `current_turn_slot`, `turn_number`, `winner`, timestamps. It never contains piece data. When `turn_number` changes, Realtime pushes that change to both players as a "something happened, go refetch" signal; each client then calls `get_game_state(token)` to pull its own correctly-filtered view. This avoids building a second, custom per-player broadcast/authorization mechanism — the RPC function remains the only place fog-of-war logic lives.

## Data model

- **games**: `id`, `room_code` (unique, short alphanumeric), `status` (`setup` | `active` | `finished`), `current_turn_slot`, `turn_number`, `winner_slot`, `created_at`, `updated_at`. RLS: readable by anyone who supplies the correct `room_code` (acts as a lookup key, not a secret — the player tokens are the actual secret).
- **game_players**: `game_id`, `player_slot` (1 | 2), `secret_token` (random UUID, generated server-side on create/join, never re-derivable from `room_code` alone). No direct client `SELECT` — only used inside Edge Functions/RPCs to authenticate requests.
- **pieces**: `game_id`, `player_slot`, `rank` (Marshal..Spy, Bomb, Flag), `row`, `col`, `is_alive`, `revealed_rank` (nullable, set on combat). No direct client `SELECT` at all — see `get_game_state`.
- **moves**: `game_id`, `move_number`, `player_slot`, `from_row/col`, `to_row/col`, `move_type` (`move` | `attack`), `outcome` (`win` | `lose` | `tie`, attack only), `revealed_ranks` (populated for combat moves only). Readable by both players in the game.
- **chat_messages**: `game_id`, `player_slot`, `text`, `created_at`. Readable/writable by both players in the game — no fog-of-war concern.

## Game rules engine

Implemented as a pure, dependency-free module (no Supabase/DB imports) so it can be fully unit-tested in isolation, then wrapped by the `make-move` Edge Function for persistence and auth. Covers:

- Board: 10x10 grid, 0-indexed rows/cols 0-9. Two impassable 2x2 lake tiles at rows 4-5 × cols 2-3, and rows 4-5 × cols 6-7 (verified against official rules). Rows 0-3 and 6-9 are each player's territory; rows 4-5 are the open middle strip.
- Movement: orthogonal only, 1 square per move, except Scouts (rank 9, movable) which move any distance in a straight line with no pieces or lakes in between. Bombs and the Flag never move.
- Piece roster (40 total): Marshal(1)×1, General(2)×1, Colonel(3)×2, Major(4)×3, Captain(5)×4, Lieutenant(6)×4, Sergeant(7)×4, Miner(8)×5, Scout(9)×8, Spy(10)×1, Bomb×6, Flag×1.
- Combat: lower rank number wins; equal ranks remove both; Spy defeats Marshal only when the Spy is the attacker (loses if defending); Miners defuse Bombs (Miner survives, Bomb removed); any other piece attacking a Bomb is removed, Bomb stays; capturing the Flag ends the game immediately.
- Two-square rule (verified against official rules): a piece cannot move back and forth between the same two squares more than three consecutive turns. If a player has done so, their next move must be a different piece; if no other legal move exists, they lose.
- Win conditions: opponent's Flag captured, or opponent has no legal moves remaining.

## Setup phase

After both players join a room, each independently arranges their 40 pieces in their own 4x10 territory via `submit-setup` (only writes to your own `player_slot`, only before `status = active`). UI offers: a **Random** shuffle button, a small set of **preset formations** sourced from documented Stratego opening-theory references (not invented from scratch), and free manual drag/tap placement layered on top of either starting point. `status` flips to `active` once both submissions are in; first move assigned by coin flip.

## Rooms & access (no accounts)

- `create-game` → returns `room_code`, the creator's own private link (`/game/{room_code}?token={player1_token}`), and a separate invite link (`/join/{room_code}`, no token) to send the friend.
- Opening the invite link calls `join-game`, assigns player 2, mints their token, gives them their own private link.
- Tokens cache in `localStorage` keyed by `room_code` for automatic return visits; the link itself is the durable fallback across browsers/devices.
- Invite link on an already-full room shows a clear "this game is full" state.
- **Trade-off, accepted:** privacy relies on unguessable tokens/links, not real login accounts. Adequate for casual play between friends; not intended to resist a determined attacker.

## Frontend

Plain HTML/CSS/JS, ES modules, no bundler — Supabase JS client via CDN import. Screens: Home (create/join), Setup (formation), Game (board + move log + chat), waiting-for-opponent state. Board renders as a CSS grid; movement is tap-to-select-then-tap-destination (works identically on desktop and mobile, no drag-and-drop dependency). Visual direction: classic wood & military, per approved mockup.

## MVP feature scope

In scope: setup, moves, combat, win/lose, resign, rematch, move-history log, in-app chat.
Out of scope for v1: push/email notifications, spectator mode, multiple simultaneous games per player beyond what room codes already allow, ranked/ELO systems, AI opponent.

## Testing approach

- Rules engine: full unit test suite (TDD) covering movement legality, the combat table (including Spy/Marshal and Miner/Bomb edge cases), the two-square rule, and win conditions — pure functions, no I/O.
- Edge Functions: thin wrappers adding token auth and persistence around the rules engine; tested against a local/test Supabase instance for the auth and persistence paths specifically (not re-testing rules logic already covered above).
- UI: manual playtest between the two players is the acceptance check; full browser E2E automation is out of scope given the 2-player casual scope.

## Deployment

- Render Static Site connected to the project's GitHub repo — free, auto-deploys on push to the deployed branch.
- Supabase free project — schema as versioned SQL migration files in the repo, Edge Functions deployed via Supabase CLI.
- Optional: a GitHub Actions workflow pinging the Supabase REST API on a schedule (e.g. twice a week) to avoid the 7-day pause, if that pause ever becomes annoying in practice.

## Costs & risks

- Expected cost: $0/month.
- Supabase 7-day inactivity pause: recoverable with one click, no data loss; optional keep-alive cron available if needed.
- No accounts means no password-reset/account-recovery surface to build or secure — token-in-link is the entire access model, by design.

## Dead code / removal

Not applicable — this is a new project with no existing code to replace.

## Next step

Move to `writing-plans` to produce a detailed implementation plan (schema migrations, Edge Function contracts, rules-engine test list, frontend screen breakdown, deployment steps) from this design.
