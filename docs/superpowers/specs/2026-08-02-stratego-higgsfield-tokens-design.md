# Design: Higgsfield-generated token art themes

**Date:** 2026-08-02
**Status:** Approved by user, ready for implementation plan

## Problem

Tokens today are procedurally-drawn SVG coins (`web/js/token.js`'s `createTokenSVG`): a flat-colored circle, a center rank glyph, and curved rank-name text. The user wants the option to skin pieces with actual generated artwork per piece type, while keeping the rank number legibly overlaid so gameplay isn't slowed down by having to recognize art instead of numbers.

## Current state (verified in code)

- `createTokenSVG(rank, isMine, playerColor)` is the single shared renderer used by both the setup screen and the live game board/graveyard trays — one function, one visual system, no theming concept exists today.
- Project has a hard **$0/month hosting** constraint (Render free static site + Supabase free tier, explicitly documented as the founding architectural decision) — ruling out any design that calls a paid generation API live, per player, per game.
- `games` table is the established place for per-game cosmetic settings synced between both players (see color-claiming design, same session) — colors, `bot_difficulty`, `bot_personality` all live there and ride the same Realtime/polling refresh.

## Design

### Themes (v1: 3, generated once by us, not at runtime)

1. **Knights & Castles** — medieval fantasy army.
2. **Sci-Fi Legion** — futuristic soldiers/mechs.
3. **Wildlife Platoon** — animals-as-soldiers, whimsical.

Each theme = 12 generated images, one per unique piece type (Marshal, General, Colonel, Major, Captain, Lieutenant, Sergeant, Miner, Scout, Spy, Bomb, Flag) — generated via the Higgsfield MCP as a one-time content-creation task during implementation, not a runtime call. Saved as static assets checked into the repo:

```
web/assets/tokens/<theme-slug>/marshal.png
web/assets/tokens/<theme-slug>/general.png
... (12 per theme × 3 themes = 36 files total)
```

This keeps the $0/month model fully intact — no live API dependency, no per-request cost, no generation latency or failure handling needed during actual play.

### Token shape

- **Default (no theme selected):** today's circular SVG coin, completely unchanged. This feature is purely additive/opt-in.
- **Theme active:** rounded-square "card" shape (more image real estate than a circle, still compact on the board grid). The theme's PNG for that rank is cropped/`object-fit: cover`-style into the rounded-square as the card's background.
- **Rank badge:** a small, bold, high-contrast circular badge in the top-right corner of the card — dark fill (e.g. navy/black) with a white bold number, same rank-glyph convention already used today (1-10 numerals, distinct glyphs for Bomb/Flag). Sized to stay legible over any artwork, independent of the theme's color palette.

### Sync requirement (the non-obvious part)

Like color, a player's own pieces are rendered *on the opponent's screen too* (once revealed, or via the "enemy" rendering path) — so theme choice can't be a purely local `localStorage` preference, or the opponent would see the wrong/default look for your pieces. This needs the same lightweight server-sync pattern as color-claiming:

- Two new nullable columns on `games`: `player1_token_theme text`, `player2_token_theme text` (values: `null` | `'knights'` | `'scifi'` | `'wildlife'`).
- New `set-token-theme` Edge Function, structurally identical to `set-color`/`set-bot-difficulty`, except **no exclusivity check** — both players may independently pick the same theme, or different ones, or no theme at all. Just: validate token → validate `status === 'setup'` (or arguably allow changing mid-game too, since it's purely cosmetic with zero fog-of-war/rules implication — recommend allowing it anytime, unlike color which needs to be settled before play since it's tied to identity clarity).
- `get_game_state` gains each player's theme choice (not secret, no redaction needed), same as the color fields.

### Client rendering

- `createTokenSVG` (or a new sibling `createImageTokenCard`, dispatched by whichever has a theme set) branches on whether the piece owner has a theme selected. If yes: render the rounded-square card with the theme image + corner badge. If no: unchanged existing circular SVG path.
- Setup screen: a simple theme picker (3 thumbnails + "Classic" / none option) near the color swatches, calling `set-token-theme` on click — same "click = commit immediately" UX as color, no separate confirm step, for consistency.
- Both players' theme choices can differ and coexist on the same board simultaneously (e.g., you see your own pieces as Sci-Fi Legion cards and the opponent's as classic circular coins) — this is expected and fine, no need to force a shared theme.

### Legibility check

Since the whole point of the corner badge is "still easy to remember" per the user's ask, plan a quick manual visual pass during implementation across all 12 ranks × 3 themes to confirm the badge reads clearly against every piece of artwork (e.g. a white numeral badge might need a subtle dark ring/outline if a theme's background near the corner is very light) — call this out as an explicit acceptance check, not just an assumption.

## Testing

- Unit test: `set-token-theme` accepts the 3 valid values + `null`/"classic" (unset), rejects unknown theme slugs, works regardless of game status (unlike color, no `setup`-only gate).
- Manual/visual: the 36-image legibility pass described above; screenshot comparison of a themed board vs. classic board to confirm no layout regressions (card size fits existing grid cell dimensions).
- No Playwright interaction test strictly required beyond confirming the picker calls the right endpoint and the correct asset path renders — this feature has no gameplay logic, it's pure presentation.

## Out of scope / deferred

- No custom/on-demand prompt-driven generation (ruled out for cost/latency/moderation reasons against the $0/month constraint) — could be revisited later as a paid "premium" tier if ever wanted, but not in this design.
- No per-individual-piece unique art (40 separate images) — one themed set per rank (12 images), reused for all pieces of that rank, per your answer.
- No theme marketplace/user-uploaded art.
