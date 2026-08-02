---
tags: [project/stratego]
---

# Higgsfield Token Art Themes Implementation Plan

## Related

- [[Stratego MOC]]
- [[Projects/Stratego/PROJECT_MEMORY]]
- Design spec: `Projects/Stratego/code/docs/superpowers/specs/2026-08-02-stratego-higgsfield-tokens-design.md`
- Note: this plan claims migration `0018_player_token_themes.sql` — `0016`/`0017` are claimed by `2026-08-02-stratego-private-formations.md` / `2026-08-02-stratego-color-claiming.md`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each player optionally skin their pieces with one of three pre-generated art themes (Knights & Castles, Sci-Fi Legion, Wildlife Platoon), rendered as a rounded-square card with a legible rank badge, synced server-side so the opponent sees the real theme choice too — while leaving the existing circular coin as the unthemed default.

**Architecture:** Two nullable `games` columns (`player1_token_theme`, `player2_token_theme`) hold each player's choice, exposed per-piece-row through `get_game_state`/`get_spectator_state` (same shape both rows already use). A new `set-token-theme` Edge Function writes the caller's own column with no exclusivity check and no game-status gate. `token.js` gains a pure `tokenImagePath` helper plus a new `createImageTokenCard` renderer and a `createPieceToken` dispatcher that falls back to the existing `createTokenSVG` coin when no theme is set; `game.js` and `setup.js` swap their `createTokenSVG` call to `createPieceToken`. The 36 source images (3 themes × 12 ranks) are generated once via the Higgsfield MCP and checked into the repo as static assets — no runtime generation, no per-request cost.

**Tech Stack:** Vanilla JS ES modules (browser), Supabase Postgres + Deno Edge Functions, `node --test` for unit tests, Higgsfield MCP `generate_image` for one-time asset generation.

## Global Constraints

- **$0/month hosting** — no live/per-request calls to any paid generation API during actual play; all 36 images are generated once during implementation and committed as static files.
- **3 themes in v1**: `knights` (Knights & Castles), `scifi` (Sci-Fi Legion), `wildlife` (Wildlife Platoon) — exactly these three slugs, no others accepted anywhere in code.
- **12 unique piece types per theme**, not 40 unique images — Marshal, General, Colonel, Major, Captain, Lieutenant, Sergeant, Miner, Scout, Spy, Bomb, Flag. One image per rank, reused for every piece of that rank.
- **No exclusivity check** on theme (unlike player color) — both players may pick the same theme, different themes, or no theme, independently.
- **No setup-only gate** on theme (unlike player color) — `set-token-theme` must succeed regardless of `games.status`.
- **Default/unthemed rendering is unchanged** — the existing circular SVG coin (`createTokenSVG` in `web/js/token.js`) must not be modified; theming is purely additive/opt-in via a new sibling renderer.
- **Migration numbering**: `0016_player_formations.sql` (private-formations plan) and `0017_player_colors.sql` (color-claiming plan, `docs/superpowers/plans/2026-08-02-stratego-color-claiming.md`) are already claimed by the other two plans from this same brainstorming session. This plan's migration must use the next free number, `0018`, to avoid a collision when all three land.
- **No automated Edge Function test harness exists in this project** (verified: only `supabase/functions/_shared/information-warfare.test.ts` exists, and it tests a shared pure-logic module, not a specific `set-*` function) — `set-token-theme` is verified via the local Supabase stack (curl) plus one live production check, matching the established pattern for every other `set-*` function in this codebase.

---

## File structure

- `supabase/migrations/0018_player_token_themes.sql` — new columns + `get_game_state`/`get_spectator_state` extension. One responsibility: schema + the two read paths that expose it.
- `supabase/functions/set-token-theme/index.ts` — new Edge Function, one responsibility: validate token + theme value, write the caller's own column.
- `web/js/token.js` — modified. Adds the pure `tokenImagePath` helper (testable, no DOM), `resolveTokenImageUrl`, the new `createImageTokenCard` renderer, and the `createPieceToken` dispatcher. `createTokenSVG` itself is untouched.
- `test/web/token.test.js` — new, unit tests for `tokenImagePath` only (the one piece of this feature that's pure logic; everything else is DOM/network glue, verified manually per this codebase's existing convention for `setup.js`/`game.js` UI code).
- `web/js/game.js` — modified call site (line ~357): swap `createTokenSVG` → `createPieceToken`, pass the piece owner's theme.
- `web/js/setup.js` — modified: new `initThemePicker()` function (same shape as `initColorPicker`/`initDifficultyControls`), module-level `selectedTheme` state, swapped `renderGrid()` call site.
- `web/setup.html` — modified: new `#theme-swatches` container next to the existing color picker.
- `web/css/styles.css` — modified: new `.theme-swatch` rules for the rounded-square thumbnail picker.
- `web/assets/tokens/knights/*.png`, `web/assets/tokens/scifi/*.png`, `web/assets/tokens/wildlife/*.png` — 36 new static image assets (12 per theme).

---

### Task 1: `games.player1_token_theme` / `player2_token_theme` columns + `get_game_state`/`get_spectator_state` extension

**Files:**
- Create: `supabase/migrations/0018_player_token_themes.sql`

**Interfaces:**
- Produces: `games.player1_token_theme text`, `games.player2_token_theme text` (values: `null | 'knights' | 'scifi' | 'wildlife'`). `get_game_state(p_token uuid)` and `get_spectator_state(p_room_code text)` now return two extra columns per row: `player1_token_theme text, player2_token_theme text` (redundant per row, same pattern the color-claiming design proposes for `player1_color`/`player2_color` — trivial and consistent with these functions' existing per-row shape).

No automated test — this is a schema-only change plus two `create or replace function` statements with no branching logic of their own; verified indirectly by Task 2 (Edge Function writes the columns) and Task 4/5 (client reads the columns via RPC). This matches the established convention (`supabase/migrations/0007_bot_difficulty.sql` and its Task 2 in `docs/superpowers/plans/2026-07-12-bot-difficulty.md`: "No test — this is a schema-only change with no logic.").

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/0018_player_token_themes.sql
alter table games add column player1_token_theme text check (player1_token_theme in ('knights', 'scifi', 'wildlife'));
alter table games add column player2_token_theme text check (player2_token_theme in ('knights', 'scifi', 'wildlife'));

create or replace function get_game_state(p_token uuid)
returns table (
  piece_id uuid,
  player_slot smallint,
  rank text,
  row_idx smallint,
  col_idx smallint,
  alive boolean,
  is_mine boolean,
  player1_token_theme text,
  player2_token_theme text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game_id uuid;
  v_player_slot smallint;
begin
  select gp.game_id, gp.player_slot into v_game_id, v_player_slot
  from game_players gp
  where gp.secret_token = p_token;

  if v_game_id is null then
    raise exception 'invalid token';
  end if;

  return query
  select
    p.id,
    p.player_slot,
    case
      when p.player_slot = v_player_slot then p.rank
      when p.revealed_rank is not null then p.revealed_rank
      else null
    end as rank,
    p.row_idx,
    p.col_idx,
    p.alive,
    (p.player_slot = v_player_slot) as is_mine,
    g.player1_token_theme,
    g.player2_token_theme
  from pieces p
  join games g on g.id = p.game_id
  where p.game_id = v_game_id;
end;
$$;

grant execute on function get_game_state(uuid) to anon;

create or replace function get_spectator_state(p_room_code text)
returns table (
  piece_id uuid,
  player_slot smallint,
  rank text,
  row_idx smallint,
  col_idx smallint,
  alive boolean,
  is_mine boolean,
  player1_token_theme text,
  player2_token_theme text
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
    false as is_mine,
    g.player1_token_theme,
    g.player2_token_theme
  from pieces p
  join games g on g.id = p.game_id
  where p.game_id = v_game_id;
end;
$$;

grant execute on function get_spectator_state(text) to anon;
```

- [ ] **Step 2: Apply the migration locally and spot-check the new columns/functions**

Run:
```bash
cd /Users/ai17/Documents/Andys_Workshop/Projects/Stratego/code
npx supabase start
npx supabase db reset
```
Expected: reset applies all migrations through `0018_player_token_themes.sql` with no errors.

Then, with the local stack running, verify the new columns exist and the check constraint rejects bad values:
```bash
npx supabase db psql -c "insert into games (room_code) values ('THEMETEST') returning player1_token_theme, player2_token_theme;"
npx supabase db psql -c "update games set player1_token_theme = 'not-a-theme' where room_code = 'THEMETEST';"
```
Expected: the `insert` returns two `null` values; the bad `update` fails with a `check constraint "games_player1_token_theme_check"` violation.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0018_player_token_themes.sql
git commit -m "feat: add games.player1_token_theme/player2_token_theme columns and expose via get_game_state/get_spectator_state"
```

---

### Task 2: `set-token-theme` Edge Function

**Files:**
- Create: `supabase/functions/set-token-theme/index.ts`

**Interfaces:**
- Consumes: `games.player1_token_theme`/`player2_token_theme` columns from Task 1.
- Produces: `POST set-token-theme` accepting `{ token: string, theme: 'knights' | 'scifi' | 'wildlife' | null }`, returning `{ ok: true, theme }` on success or `{ error: string }` with an appropriate status code on failure. Consumed by Task 5's `initThemePicker()`.

No automated test — this project has no Deno-level Edge Function test harness (verified in Task 1's constraints section by inspecting `supabase/functions/`); verified via the local Supabase stack (this task) and a live production check (Task 8), matching `set-bot-difficulty`'s established verification pattern.

- [ ] **Step 1: Write the function**

```typescript
// supabase/functions/set-token-theme/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VALID_THEMES = ["knights", "scifi", "wildlife"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "METHOD_NOT_ALLOWED" }), { status: 405, headers: corsHeaders });
  }

  const { token, theme } = await req.json();
  if (!token || theme === undefined) {
    return new Response(JSON.stringify({ error: "MISSING_FIELDS" }), { status: 400, headers: corsHeaders });
  }

  if (theme !== null && !VALID_THEMES.includes(theme)) {
    return new Response(JSON.stringify({ error: "INVALID_THEME" }), { status: 400, headers: corsHeaders });
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

  const column = playerRow.player_slot === 1 ? "player1_token_theme" : "player2_token_theme";

  const { error: updateError } = await supabase
    .from("games")
    .update({ [column]: theme, updated_at: new Date().toISOString() })
    .eq("id", playerRow.game_id);

  if (updateError) {
    return new Response(JSON.stringify({ error: "UPDATE_FAILED", detail: updateError.message }), {
      status: 500,
      headers: corsHeaders,
    });
  }

  return new Response(JSON.stringify({ ok: true, theme }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
```

Note the deliberate differences from `set-bot-difficulty`: no `is_bot_game`/`status` check at all (any game, any status), no exclusivity check against the other slot's column, and both `player_slot` values (1 and 2) are allowed to call this (not just slot 1) — per the spec, this is purely cosmetic and unrelated to bot configuration or identity-locking.

- [ ] **Step 2: Serve the function locally and smoke-test with curl**

Run (with the stack from Task 1 Step 2 still running):
```bash
cd /Users/ai17/Documents/Andys_Workshop/Projects/Stratego/code
npx supabase functions serve --no-verify-jwt &
```

Get a real token for an existing local game (adjust room code to one you created via the running web app, or insert one directly):
```bash
npx supabase db psql -c "insert into games (room_code) values ('SETTHEME1') returning id;"
npx supabase db psql -c "insert into game_players (game_id, player_slot) select id, 1 from games where room_code = 'SETTHEME1' returning secret_token;"
```
Copy the returned `secret_token` value as `TOKEN` below.

```bash
curl -s -X POST http://localhost:54321/functions/v1/set-token-theme \
  -H "Content-Type: application/json" \
  -d '{"token":"TOKEN","theme":"knights"}'
```
Expected: `{"ok":true,"theme":"knights"}`.

```bash
curl -s -X POST http://localhost:54321/functions/v1/set-token-theme \
  -H "Content-Type: application/json" \
  -d '{"token":"TOKEN","theme":"pirates"}'
```
Expected: `{"error":"INVALID_THEME"}`.

```bash
curl -s -X POST http://localhost:54321/functions/v1/set-token-theme \
  -H "Content-Type: application/json" \
  -d '{"token":"TOKEN","theme":null}'
```
Expected: `{"ok":true,"theme":null}` (unsets back to classic).

```bash
npx supabase db psql -c "update games set status = 'active' where room_code = 'SETTHEME1';"
curl -s -X POST http://localhost:54321/functions/v1/set-token-theme \
  -H "Content-Type: application/json" \
  -d '{"token":"TOKEN","theme":"scifi"}'
```
Expected: `{"ok":true,"theme":"scifi"}` — succeeds even though `status = 'active'`, confirming no setup-only gate (unlike `set-color`).

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/set-token-theme/index.ts
git commit -m "feat: add set-token-theme Edge Function (no exclusivity check, no setup-only gate)"
```

---

### Task 3: Generate the 36 token images via Higgsfield MCP

**Files:**
- Create: `web/assets/tokens/knights/marshal.png`, `general.png`, `colonel.png`, `major.png`, `captain.png`, `lieutenant.png`, `sergeant.png`, `miner.png`, `scout.png`, `spy.png`, `bomb.png`, `flag.png`
- Create: `web/assets/tokens/scifi/` — same 12 filenames
- Create: `web/assets/tokens/wildlife/` — same 12 filenames

**Interfaces:**
- Produces: 36 static PNG files at `web/assets/tokens/<theme-slug>/<rank-slug>.png`, consumed by Task 4's `tokenImagePath`/`resolveTokenImageUrl` (which build exactly this path) and visually checked in Task 6.

This is a one-time content-generation task, not application logic — there is no unit test. The deliverable is verified by file existence (Step 3 below) and visually in Task 6 (legibility check).

- [ ] **Step 1: Create the destination directories**

```bash
cd /Users/ai17/Documents/Andys_Workshop/Projects/Stratego/code
mkdir -p web/assets/tokens/knights web/assets/tokens/scifi web/assets/tokens/wildlife
```

- [ ] **Step 2: Generate all 36 images with the Higgsfield MCP `generate_image` tool**

Before calling the tool, confirm its exact argument names by inspecting the schema (the server may require one-time authentication first): call `GetMcpTools` with `server: "plugin-higgsfield-higgsfield"`, authenticate via its `mcp_auth` tool if the server reports `needsAuth`, then re-inspect. Use whatever the schema calls its prompt-text and aspect-ratio fields (per the skill at `/Users/ai17/.cursor/plugins/cache/cursor-public/higgsfield/af1ae5a79611bb47b9e1db86c4afc13eb406ee07/skills/generate-image/SKILL.md`, this is a `generate_image` tool taking a natural-language prompt and an aspect ratio such as `1:1`). For each of the 36 prompts below, call `generate_image` once, then move/save its output image to the exact destination path shown — do not batch multiple ranks into one image.

**Theme 1 — Knights & Castles** (base style: "Medieval fantasy army portrait, square card composition, {PIECE}, painted fantasy illustration style, rich earthy color palette, dramatic lighting, castle/battlefield background, centered subject, high detail, no text, no numbers, no watermark, 1:1 aspect ratio"). Use aspect ratio `1:1` for all 12.

1. `web/assets/tokens/knights/marshal.png` — prompt: "Medieval fantasy army portrait, square card composition, a grizzled elder war marshal in ornate gold-trimmed plate armor, wearing a crown-like helm, holding a jeweled command baton, painted fantasy illustration style, rich earthy color palette, dramatic lighting, castle/battlefield background, centered subject, high detail, no text, no numbers, no watermark, 1:1 aspect ratio"
2. `web/assets/tokens/knights/general.png` — prompt: "Medieval fantasy army portrait, square card composition, a battle-hardened general in silver plate armor with a flowing crimson cape and a plumed helmet, gripping a longsword, painted fantasy illustration style, rich earthy color palette, dramatic lighting, castle/battlefield background, centered subject, high detail, no text, no numbers, no watermark, 1:1 aspect ratio"
3. `web/assets/tokens/knights/colonel.png` — prompt: "Medieval fantasy army portrait, square card composition, a stern colonel knight in steel plate armor with a heraldic surcoat, holding a warhammer, painted fantasy illustration style, rich earthy color palette, dramatic lighting, castle/battlefield background, centered subject, high detail, no text, no numbers, no watermark, 1:1 aspect ratio"
4. `web/assets/tokens/knights/major.png` — prompt: "Medieval fantasy army portrait, square card composition, a mounted-order major in chainmail and a tabard, holding a lance, painted fantasy illustration style, rich earthy color palette, dramatic lighting, castle/battlefield background, centered subject, high detail, no text, no numbers, no watermark, 1:1 aspect ratio"
5. `web/assets/tokens/knights/captain.png` — prompt: "Medieval fantasy army portrait, square card composition, a captain of the guard in leather-and-plate armor with a round shield and shortsword, painted fantasy illustration style, rich earthy color palette, dramatic lighting, castle/battlefield background, centered subject, high detail, no text, no numbers, no watermark, 1:1 aspect ratio"
6. `web/assets/tokens/knights/lieutenant.png` — prompt: "Medieval fantasy army portrait, square card composition, a lieutenant knight in half-plate armor holding a battleaxe and a small buckler, painted fantasy illustration style, rich earthy color palette, dramatic lighting, castle/battlefield background, centered subject, high detail, no text, no numbers, no watermark, 1:1 aspect ratio"
7. `web/assets/tokens/knights/sergeant.png` — prompt: "Medieval fantasy army portrait, square card composition, a veteran sergeant-at-arms in chainmail and a helm, gripping a spear, painted fantasy illustration style, rich earthy color palette, dramatic lighting, castle/battlefield background, centered subject, high detail, no text, no numbers, no watermark, 1:1 aspect ratio"
8. `web/assets/tokens/knights/miner.png` — prompt: "Medieval fantasy army portrait, square card composition, a stocky castle sapper in leather armor with a pickaxe and satchel of black powder charges, painted fantasy illustration style, rich earthy color palette, dramatic lighting, castle/battlefield background, centered subject, high detail, no text, no numbers, no watermark, 1:1 aspect ratio"
9. `web/assets/tokens/knights/scout.png` — prompt: "Medieval fantasy army portrait, square card composition, a lightly armored ranger scout in a hooded cloak with a bow and quiver, painted fantasy illustration style, rich earthy color palette, dramatic lighting, castle/battlefield background, centered subject, high detail, no text, no numbers, no watermark, 1:1 aspect ratio"
10. `web/assets/tokens/knights/spy.png` — prompt: "Medieval fantasy army portrait, square card composition, a hooded rogue spy in dark leather with a dagger and a concealing cloak, face shadowed, painted fantasy illustration style, rich earthy color palette, dramatic lighting, castle/battlefield background, centered subject, high detail, no text, no numbers, no watermark, 1:1 aspect ratio"
11. `web/assets/tokens/knights/bomb.png` — prompt: "Medieval fantasy army portrait, square card composition, a spiked iron landmine trap disguised as a rune-etched stone, faint magical glow, painted fantasy illustration style, rich earthy color palette, dramatic lighting, castle/battlefield background, centered subject, high detail, no text, no numbers, no watermark, 1:1 aspect ratio"
12. `web/assets/tokens/knights/flag.png` — prompt: "Medieval fantasy army portrait, square card composition, a tattered kingdom banner on a wooden pole planted in the ground, heraldic crest visible, painted fantasy illustration style, rich earthy color palette, dramatic lighting, castle/battlefield background, centered subject, high detail, no text, no numbers, no watermark, 1:1 aspect ratio"

**Theme 2 — Sci-Fi Legion** (base style: "Futuristic sci-fi military portrait, square card composition, {PIECE}, sleek sci-fi illustration style, cool blue and metallic color palette, dramatic rim lighting, starship/battlefield background, centered subject, high detail, no text, no numbers, no watermark, 1:1 aspect ratio"). Use aspect ratio `1:1` for all 12.

13. `web/assets/tokens/scifi/marshal.png` — prompt: "Futuristic sci-fi military portrait, square card composition, an elite fleet marshal in a gold-accented powered exosuit with a holographic rank insignia and command visor, sleek sci-fi illustration style, cool blue and metallic color palette, dramatic rim lighting, starship/battlefield background, centered subject, high detail, no text, no numbers, no watermark, 1:1 aspect ratio"
14. `web/assets/tokens/scifi/general.png` — prompt: "Futuristic sci-fi military portrait, square card composition, a battle general in heavy powered armor with glowing blue energy conduits and a plasma sidearm, sleek sci-fi illustration style, cool blue and metallic color palette, dramatic rim lighting, starship/battlefield background, centered subject, high detail, no text, no numbers, no watermark, 1:1 aspect ratio"
15. `web/assets/tokens/scifi/colonel.png` — prompt: "Futuristic sci-fi military portrait, square card composition, a strike colonel in a sleek combat exosuit with shoulder-mounted stabilizers, holding a rifle, sleek sci-fi illustration style, cool blue and metallic color palette, dramatic rim lighting, starship/battlefield background, centered subject, high detail, no text, no numbers, no watermark, 1:1 aspect ratio"
16. `web/assets/tokens/scifi/major.png` — prompt: "Futuristic sci-fi military portrait, square card composition, a squad major in reinforced tactical armor with a jetpack and energy rifle, sleek sci-fi illustration style, cool blue and metallic color palette, dramatic rim lighting, starship/battlefield background, centered subject, high detail, no text, no numbers, no watermark, 1:1 aspect ratio"
17. `web/assets/tokens/scifi/captain.png` — prompt: "Futuristic sci-fi military portrait, square card composition, a captain in lightweight combat armor with a plasma pistol and tactical shield drone, sleek sci-fi illustration style, cool blue and metallic color palette, dramatic rim lighting, starship/battlefield background, centered subject, high detail, no text, no numbers, no watermark, 1:1 aspect ratio"
18. `web/assets/tokens/scifi/lieutenant.png` — prompt: "Futuristic sci-fi military portrait, square card composition, a lieutenant trooper in segmented armor holding a pulse carbine, sleek sci-fi illustration style, cool blue and metallic color palette, dramatic rim lighting, starship/battlefield background, centered subject, high detail, no text, no numbers, no watermark, 1:1 aspect ratio"
19. `web/assets/tokens/scifi/sergeant.png` — prompt: "Futuristic sci-fi military portrait, square card composition, a veteran sergeant trooper in standard-issue combat armor with a rifle and tactical helmet, sleek sci-fi illustration style, cool blue and metallic color palette, dramatic rim lighting, starship/battlefield background, centered subject, high detail, no text, no numbers, no watermark, 1:1 aspect ratio"
20. `web/assets/tokens/scifi/miner.png` — prompt: "Futuristic sci-fi military portrait, square card composition, a rugged demolitions trooper in a heavy-duty exosuit with a plasma cutter and charge pack, sleek sci-fi illustration style, cool blue and metallic color palette, dramatic rim lighting, starship/battlefield background, centered subject, high detail, no text, no numbers, no watermark, 1:1 aspect ratio"
21. `web/assets/tokens/scifi/scout.png` — prompt: "Futuristic sci-fi military portrait, square card composition, a lightweight recon trooper in a stealth-plated suit with a scanner visor and sidearm, sleek sci-fi illustration style, cool blue and metallic color palette, dramatic rim lighting, starship/battlefield background, centered subject, high detail, no text, no numbers, no watermark, 1:1 aspect ratio"
22. `web/assets/tokens/scifi/spy.png` — prompt: "Futuristic sci-fi military portrait, square card composition, a cloaked infiltrator unit in matte-black stealth armor with a holo-camouflage cloak shimmer, sleek sci-fi illustration style, cool blue and metallic color palette, dramatic rim lighting, starship/battlefield background, centered subject, high detail, no text, no numbers, no watermark, 1:1 aspect ratio"
23. `web/assets/tokens/scifi/bomb.png` — prompt: "Futuristic sci-fi military portrait, square card composition, a spiked robotic proximity mine hovering with a pulsing red warning light, sleek sci-fi illustration style, cool blue and metallic color palette, dramatic rim lighting, starship/battlefield background, centered subject, high detail, no text, no numbers, no watermark, 1:1 aspect ratio"
24. `web/assets/tokens/scifi/flag.png` — prompt: "Futuristic sci-fi military portrait, square card composition, a tall antenna beacon mast with a glowing holographic faction emblem, sleek sci-fi illustration style, cool blue and metallic color palette, dramatic rim lighting, starship/battlefield background, centered subject, high detail, no text, no numbers, no watermark, 1:1 aspect ratio"

**Theme 3 — Wildlife Platoon** (base style: "Whimsical animals-as-soldiers illustration, square card composition, {PIECE}, charming storybook illustration style, warm painterly color palette, soft dramatic lighting, forest/battlefield background, centered subject, high detail, no text, no numbers, no watermark, 1:1 aspect ratio"). Use aspect ratio `1:1` for all 12.

25. `web/assets/tokens/wildlife/marshal.png` — prompt: "Whimsical animals-as-soldiers illustration, square card composition, a distinguished elderly lion in an ornate general's dress uniform with medals and a peaked cap, charming storybook illustration style, warm painterly color palette, soft dramatic lighting, forest/battlefield background, centered subject, high detail, no text, no numbers, no watermark, 1:1 aspect ratio"
26. `web/assets/tokens/wildlife/general.png` — prompt: "Whimsical animals-as-soldiers illustration, square card composition, a grizzly bear general in a decorated military coat with epaulettes, holding a saber, charming storybook illustration style, warm painterly color palette, soft dramatic lighting, forest/battlefield background, centered subject, high detail, no text, no numbers, no watermark, 1:1 aspect ratio"
27. `web/assets/tokens/wildlife/colonel.png` — prompt: "Whimsical animals-as-soldiers illustration, square card composition, a wolf colonel in a sharp officer's uniform with a monocle and swagger stick, charming storybook illustration style, warm painterly color palette, soft dramatic lighting, forest/battlefield background, centered subject, high detail, no text, no numbers, no watermark, 1:1 aspect ratio"
28. `web/assets/tokens/wildlife/major.png` — prompt: "Whimsical animals-as-soldiers illustration, square card composition, a tiger major in camouflage fatigues with a utility belt and binoculars, charming storybook illustration style, warm painterly color palette, soft dramatic lighting, forest/battlefield background, centered subject, high detail, no text, no numbers, no watermark, 1:1 aspect ratio"
29. `web/assets/tokens/wildlife/captain.png` — prompt: "Whimsical animals-as-soldiers illustration, square card composition, a fox captain in a naval-style coat with a compass and cutlass, charming storybook illustration style, warm painterly color palette, soft dramatic lighting, forest/battlefield background, centered subject, high detail, no text, no numbers, no watermark, 1:1 aspect ratio"
30. `web/assets/tokens/wildlife/lieutenant.png` — prompt: "Whimsical animals-as-soldiers illustration, square card composition, a badger lieutenant in a field uniform holding a rifle, charming storybook illustration style, warm painterly color palette, soft dramatic lighting, forest/battlefield background, centered subject, high detail, no text, no numbers, no watermark, 1:1 aspect ratio"
31. `web/assets/tokens/wildlife/sergeant.png` — prompt: "Whimsical animals-as-soldiers illustration, square card composition, a boar sergeant in rugged infantry gear with a drill-sergeant scowl, charming storybook illustration style, warm painterly color palette, soft dramatic lighting, forest/battlefield background, centered subject, high detail, no text, no numbers, no watermark, 1:1 aspect ratio"
32. `web/assets/tokens/wildlife/miner.png` — prompt: "Whimsical animals-as-soldiers illustration, square card composition, a mole in overalls and a hard hat with a lantern and shovel, ready to dig, charming storybook illustration style, warm painterly color palette, soft dramatic lighting, forest/battlefield background, centered subject, high detail, no text, no numbers, no watermark, 1:1 aspect ratio"
33. `web/assets/tokens/wildlife/scout.png` — prompt: "Whimsical animals-as-soldiers illustration, square card composition, a rabbit scout in light gear with binoculars and a scarf, alert posture, charming storybook illustration style, warm painterly color palette, soft dramatic lighting, forest/battlefield background, centered subject, high detail, no text, no numbers, no watermark, 1:1 aspect ratio"
34. `web/assets/tokens/wildlife/spy.png` — prompt: "Whimsical animals-as-soldiers illustration, square card composition, a raccoon spy in a dark trench coat and fedora, peeking from behind cover, charming storybook illustration style, warm painterly color palette, soft dramatic lighting, forest/battlefield background, centered subject, high detail, no text, no numbers, no watermark, 1:1 aspect ratio"
35. `web/assets/tokens/wildlife/bomb.png` — prompt: "Whimsical animals-as-soldiers illustration, square card composition, a hedgehog curled into a spiky ball rigged with a comedic fuse and warning stripes, charming storybook illustration style, warm painterly color palette, soft dramatic lighting, forest/battlefield background, centered subject, high detail, no text, no numbers, no watermark, 1:1 aspect ratio"
36. `web/assets/tokens/wildlife/flag.png` — prompt: "Whimsical animals-as-soldiers illustration, square card composition, a small flagpole flying a proud platoon pennant, planted in tall grass, charming storybook illustration style, warm painterly color palette, soft dramatic lighting, forest/battlefield background, centered subject, high detail, no text, no numbers, no watermark, 1:1 aspect ratio"

- [ ] **Step 3: Verify all 36 files exist**

Run:
```bash
find web/assets/tokens -iname "*.png" | wc -l
ls web/assets/tokens/knights web/assets/tokens/scifi web/assets/tokens/wildlife
```
Expected: `36`, and each theme directory lists exactly `marshal.png general.png colonel.png major.png captain.png lieutenant.png sergeant.png miner.png scout.png spy.png bomb.png flag.png`.

- [ ] **Step 4: Commit**

```bash
git add web/assets/tokens/
git commit -m "feat: add 36 Higgsfield-generated token art images (3 themes x 12 ranks)"
```

---

### Task 4: `token.js` — `tokenImagePath`, `resolveTokenImageUrl`, `createImageTokenCard`, `createPieceToken`

**Files:**
- Modify: `web/js/token.js`
- Create: `test/web/token.test.js`

**Interfaces:**
- Consumes: `RANK_CENTER` (module-private, already exists), `darkenColor` (module-private, already exists), `ENEMY_COLOR` (module-private, already exists), `DEFAULT_PLAYER_COLOR` (already exported), `createTokenSVG` (unchanged, already exported), the 36 image files from Task 3.
- Produces: `export const THEMES = ['knights', 'scifi', 'wildlife']`; `export function tokenImagePath(theme, rank): string | null`; `export function resolveTokenImageUrl(theme, rank): string | null`; `export function createImageTokenCard(rank, isMine, imageUrl, playerColor = DEFAULT_PLAYER_COLOR): SVGElement`; `export function createPieceToken(rank, isMine, playerColor = DEFAULT_PLAYER_COLOR, theme = null): SVGElement`. Tasks 5 and 6 call `createPieceToken`, not `createTokenSVG`, at their render call sites.

- [ ] **Step 1: Write the failing test for `tokenImagePath`**

```javascript
// test/web/token.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenImagePath, THEMES } from '../../web/js/token.js';

test('valid theme + Marshal rank (string "1") returns knights/marshal.png', () => {
  assert.equal(tokenImagePath('knights', '1'), 'knights/marshal.png');
});

test('valid theme + BOMB rank returns scifi/bomb.png', () => {
  assert.equal(tokenImagePath('scifi', 'BOMB'), 'scifi/bomb.png');
});

test('valid theme + FLAG rank returns wildlife/flag.png', () => {
  assert.equal(tokenImagePath('wildlife', 'FLAG'), 'wildlife/flag.png');
});

test('numeric rank key (not string) resolves the same as its string equivalent', () => {
  assert.equal(tokenImagePath('knights', 9), 'knights/scout.png');
  assert.equal(tokenImagePath('knights', '9'), 'knights/scout.png');
});

test('unknown theme slug returns null even for a valid rank', () => {
  assert.equal(tokenImagePath('pirates', '1'), null);
});

test('unknown rank returns null even for a valid theme', () => {
  assert.equal(tokenImagePath('knights', 'NOT_A_RANK'), null);
});

test('null rank returns null', () => {
  assert.equal(tokenImagePath('knights', null), null);
});

test('THEMES exports exactly the three v1 theme slugs, in order', () => {
  assert.deepEqual(THEMES, ['knights', 'scifi', 'wildlife']);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx node --test test/web/token.test.js`
Expected: FAIL — `Cannot find module '../../web/js/token.js'` export `tokenImagePath` (the module exists today but does not export `tokenImagePath` or `THEMES` yet).

- [ ] **Step 3: Add `THEMES`, `tokenImagePath`, `resolveTokenImageUrl`, `createImageTokenCard`, `createPieceToken` to `token.js`**

Add the following after the existing `darkenColor` function and before `createTokenSVG` in `web/js/token.js` (leave every existing line of the file untouched):

```javascript
export const THEMES = ['knights', 'scifi', 'wildlife'];
const THEME_BASE = '../assets/tokens/';

const RANK_SLUG = {
  '1': 'marshal', '2': 'general', '3': 'colonel', '4': 'major',
  '5': 'captain', '6': 'lieutenant', '7': 'sergeant', '8': 'miner',
  '9': 'scout', '10': 'spy', 'BOMB': 'bomb', 'FLAG': 'flag',
  1: 'marshal', 2: 'general', 3: 'colonel', 4: 'major',
  5: 'captain', 6: 'lieutenant', 7: 'sergeant', 8: 'miner',
  9: 'scout', 10: 'spy',
};

export function tokenImagePath(theme, rank) {
  if (!THEMES.includes(theme)) return null;
  const slug = rank != null ? (RANK_SLUG[rank] ?? null) : null;
  if (slug == null) return null;
  return `${theme}/${slug}.png`;
}

export function resolveTokenImageUrl(theme, rank) {
  const relPath = tokenImagePath(theme, rank);
  if (!relPath) return null;
  return new URL(THEME_BASE + relPath, import.meta.url).href;
}
```

Then add the following after `createTokenSVG` (at the end of the file):

```javascript
export function createImageTokenCard(rank, isMine, imageUrl, playerColor = DEFAULT_PLAYER_COLOR) {
  const frameColor = isMine ? playerColor : ENEMY_COLOR;
  const frameStroke = isMine ? darkenColor(frameColor) : ENEMY_STROKE;

  const center = rank != null ? (RANK_CENTER[rank] ?? '?') : '?';
  const isEmoji = center === '💣' || center === '🚩';
  const isSpy = center === 'S';
  const isTwoDigit = center === '10';
  const badgeFontSize = isEmoji ? 11 : (isSpy ? 13 : (isTwoDigit ? 10 : 12));
  const badgeStyle = isSpy ? 'font-style="italic"' : '';
  const clipId = `card-clip-${Math.random().toString(36).slice(2, 8)}`;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 72 72');
  svg.classList.add('piece-token');
  svg.innerHTML = `
    <defs><clipPath id="${clipId}"><rect x="2" y="2" width="68" height="68" rx="12" ry="12"/></clipPath></defs>
    <rect x="2" y="2" width="68" height="68" rx="12" ry="12" fill="${frameColor}"/>
    <image href="${imageUrl}" x="2" y="2" width="68" height="68" preserveAspectRatio="xMidYMid slice" clip-path="url(#${clipId})"/>
    <rect x="2" y="2" width="68" height="68" rx="12" ry="12" fill="none" stroke="${frameStroke}" stroke-width="2.5"/>
    <circle cx="58" cy="14" r="12" fill="#14141f" stroke="#ffffff" stroke-width="1.5"/>
    <text font-size="${badgeFontSize}" font-weight="bold" ${badgeStyle} fill="#ffffff" text-anchor="middle" x="58" y="18">${center}</text>
  `;
  return svg;
}

export function createPieceToken(rank, isMine, playerColor = DEFAULT_PLAYER_COLOR, theme = null) {
  const imageUrl = theme ? resolveTokenImageUrl(theme, rank) : null;
  if (imageUrl) return createImageTokenCard(rank, isMine, imageUrl, playerColor);
  return createTokenSVG(rank, isMine, playerColor);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx node --test test/web/token.test.js`
Expected: all 8 tests pass.

- [ ] **Step 5: Manual DOM check (no unit test — SVG/image DOM code, same pattern as `createTokenSVG` itself)**

Open the browser console on any page that has loaded `token.js` (e.g. `game.html` after Task 5 wires it in) and run:
```javascript
import('./js/token.js').then(m => {
  const card = m.createPieceToken('1', true, m.DEFAULT_PLAYER_COLOR, 'knights');
  document.body.appendChild(card);
});
```
Expected: a rounded-square card appears showing the `knights/marshal.png` artwork with a dark circular badge in the top-right corner reading "10" (Marshal's `RANK_CENTER` glyph). Remove the test element afterward.

- [ ] **Step 6: Commit**

```bash
git add web/js/token.js test/web/token.test.js
git commit -m "feat: add createImageTokenCard/createPieceToken renderer with tokenImagePath helper"
```

---

### Task 5: Wire `createPieceToken` into `game.js`'s board renderer

**Files:**
- Modify: `web/js/game.js:7` (import), `web/js/game.js:357` (call site)

**Interfaces:**
- Consumes: `createPieceToken` from Task 4; `player1_token_theme`/`player2_token_theme` fields on each `get_game_state`/`get_spectator_state` row from Task 1 (already present on every object in `piecesById`, since `refreshState()` at `web/js/game.js:67-81` stores each RPC row unmodified).

- [ ] **Step 1: Swap the import**

In `web/js/game.js`, change line 7 from:
```javascript
import { createTokenSVG, RANK_NAME, DEFAULT_PLAYER_COLOR } from "./token.js";
```
to:
```javascript
import { createPieceToken, RANK_NAME, DEFAULT_PLAYER_COLOR } from "./token.js";
```

- [ ] **Step 2: Update the board render call site**

In `web/js/game.js`, change (around line 357):
```javascript
        cell.appendChild(createTokenSVG(displayRank, isFriendly, getPlayerColor()));
```
to:
```javascript
        const ownerTheme = piece.player_slot === 1 ? piece.player1_token_theme : piece.player2_token_theme;
        cell.appendChild(createPieceToken(displayRank, isFriendly, getPlayerColor(), ownerTheme));
```

- [ ] **Step 3: Manual verification (no unit test — DOM/RPC glue code, same pattern this codebase already uses for `renderBoard`/`renderGraveyards`)**

With the local stack running (`npx supabase start`, `npx supabase functions serve --no-verify-jwt`, and `cd web && python3 -m http.server 8080`), and using the `set-token-theme` curl call from Task 2 to set a theme on one of the two players in a test game, play through setup and into an active game. Confirm:
- The themed player's own pieces render as rounded-square cards with the correct theme artwork and a legible rank badge.
- The other (unthemed) player's pieces still render as the original circular coin, unchanged.
- Note found during codebase exploration: the graveyard trays (`renderSingleGraveyard`, `web/js/game.js:421-479`) render dead pieces as plain text-abbreviation chips via CSS classes (`filled-mine`/`filled-enemy`) — they never call `createTokenSVG`/`createPieceToken` at all. There is no token-image call site in the graveyard path to update; this is confirmed by inspection, not an oversight.

- [ ] **Step 4: Commit**

```bash
git add web/js/game.js
git commit -m "feat: render pieces with their owner's token theme card on the board"
```

---

### Task 6: Theme picker UI in `setup.js` (+ `setup.html`, `styles.css`)

**Files:**
- Modify: `web/js/setup.js`
- Modify: `web/setup.html`
- Modify: `web/css/styles.css`

**Interfaces:**
- Consumes: `createPieceToken`, `resolveTokenImageUrl`, `THEMES` from Task 4; `set-token-theme` from Task 2; `games.player1_token_theme`/`player2_token_theme` columns from Task 1.
- Produces: module-level `selectedTheme` state in `setup.js`, read by `renderGrid()`'s call site so the local setup-tray preview reflects the active theme immediately after picking one.

- [ ] **Step 1: Add the picker container to `setup.html`**

In `web/setup.html`, right after the existing color picker block:
```html
          <div class="color-picker">
            <span class="color-picker-label">Army color:</span>
            <div id="color-swatches" class="color-swatches"></div>
          </div>
```
add:
```html
          <div class="color-picker">
            <span class="color-picker-label">Token art theme:</span>
            <div id="theme-swatches" class="color-swatches"></div>
          </div>
```

- [ ] **Step 2: Add `.theme-swatch` CSS to `styles.css`**

Right after the existing `.color-swatch.selected` rule in `web/css/styles.css`:
```css
.color-swatch.selected {
  border-color: gold;
  box-shadow: 0 0 6px rgba(255, 215, 0, 0.5);
}
```
add:
```css
.theme-swatch {
  width: 40px;
  height: 40px;
  border-radius: 8px;
  border: 2px solid transparent;
  cursor: pointer;
  overflow: hidden;
  background-size: cover;
  background-position: center;
  background-color: var(--wood-mid);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.6rem;
  color: var(--wood-light);
  transition: border-color 0.15s, transform 0.1s;
}

.theme-swatch:hover {
  transform: scale(1.1);
}

.theme-swatch.selected {
  border-color: gold;
  box-shadow: 0 0 6px rgba(255, 215, 0, 0.5);
}
```

- [ ] **Step 3: Add `initThemePicker()` to `setup.js`**

Change the import (line 9) from:
```javascript
import { createTokenSVG, RANK_NAME, DEFAULT_PLAYER_COLOR } from "./token.js";
```
to:
```javascript
import { createPieceToken, RANK_NAME, DEFAULT_PLAYER_COLOR, THEMES, resolveTokenImageUrl } from "./token.js";
```

Add this module-level state near the top, after the `PLAYER_COLORS` array:
```javascript
const THEME_LABELS = {
  knights: 'Knights & Castles',
  scifi: 'Sci-Fi Legion',
  wildlife: 'Wildlife Platoon',
};

let selectedTheme = null;

async function initThemePicker() {
  const container = document.getElementById('theme-swatches');
  if (!container) return;

  const column = slot === 1 ? 'player1_token_theme' : 'player2_token_theme';
  const { data: gameRow } = await supabase.from('games').select(column).eq('room_code', roomCode).single();
  selectedTheme = gameRow ? gameRow[column] : null;

  function render() {
    container.innerHTML = '';

    const classicSwatch = document.createElement('div');
    classicSwatch.className = 'theme-swatch';
    classicSwatch.textContent = 'Classic';
    classicSwatch.title = 'Classic (no theme)';
    if (selectedTheme == null) classicSwatch.classList.add('selected');
    classicSwatch.addEventListener('click', () => selectTheme(null));
    container.appendChild(classicSwatch);

    for (const theme of THEMES) {
      const swatch = document.createElement('div');
      swatch.className = 'theme-swatch';
      swatch.title = THEME_LABELS[theme];
      swatch.style.backgroundImage = `url(${resolveTokenImageUrl(theme, '1')})`;
      if (selectedTheme === theme) swatch.classList.add('selected');
      swatch.addEventListener('click', () => selectTheme(theme));
      container.appendChild(swatch);
    }
  }

  async function selectTheme(theme) {
    try {
      await callFunction('set-token-theme', { token, theme });
      selectedTheme = theme;
      render();
      if (typeof renderGrid === 'function') renderGrid();
    } catch (err) {
      const statusEl = document.getElementById('setup-status');
      statusEl.hidden = false;
      statusEl.textContent = `Failed to set token theme: ${err.message}`;
    }
  }

  render();
}

initThemePicker();
```

- [ ] **Step 4: Update `renderGrid()`'s call site**

In `web/js/setup.js`, change (around line 238):
```javascript
        const playerColor = localStorage.getItem(`stratego:${roomCode}:color`) || DEFAULT_PLAYER_COLOR;
        cell.appendChild(createTokenSVG(rank, true, playerColor));
```
to:
```javascript
        const playerColor = localStorage.getItem(`stratego:${roomCode}:color`) || DEFAULT_PLAYER_COLOR;
        cell.appendChild(createPieceToken(rank, true, playerColor, selectedTheme));
```

- [ ] **Step 5: Manual verification (no unit test — DOM/network glue code, same pattern as `initColorPicker`/`initDifficultyControls`)**

With the local stack running, open `setup.html` for a room. Confirm:
- Four swatches render: "Classic" plus one thumbnail per theme (each thumbnail shows the theme's Marshal artwork).
- Clicking a theme swatch calls `set-token-theme`, marks that swatch `.selected`, and immediately re-renders the placement grid so already-placed pieces show as themed cards.
- Clicking "Classic" reverts placed pieces to the circular coin.
- Reloading the page re-fetches the persisted theme from `games.player1_token_theme`/`player2_token_theme` and pre-selects the correct swatch.

- [ ] **Step 6: Commit**

```bash
git add web/js/setup.js web/setup.html web/css/styles.css
git commit -m "feat: add token art theme picker to setup screen"
```

---

### Task 7: Legibility check (acceptance criteria from the design spec)

**Files:** none (manual visual verification only)

The design spec's "Legibility check" section requires a full manual pass across all 12 ranks × 3 themes to confirm the corner rank badge (Task 4's dark circular badge with white numeral/glyph) reads clearly against every piece of artwork before this feature can be considered acceptance-complete.

- [ ] **Step 1: Render all 36 themed cards on one page for review**

With the local stack running, open the browser console on any page that has loaded `token.js` and run:
```javascript
import('./js/token.js').then(m => {
  const container = document.createElement('div');
  container.style.display = 'flex';
  container.style.flexWrap = 'wrap';
  container.style.gap = '8px';
  for (const theme of m.THEMES) {
    for (const rank of ['1','2','3','4','5','6','7','8','9','10','BOMB','FLAG']) {
      const card = m.createPieceToken(rank, true, m.DEFAULT_PLAYER_COLOR, theme);
      card.style.width = '90px';
      container.appendChild(card);
    }
  }
  document.body.innerHTML = '';
  document.body.appendChild(container);
});
```

- [ ] **Step 2: Visually confirm the badge reads clearly for every combination below**

Knights & Castles:
- [ ] Marshal ("10")
- [ ] General ("9")
- [ ] Colonel ("8")
- [ ] Major ("7")
- [ ] Captain ("6")
- [ ] Lieutenant ("5")
- [ ] Sergeant ("4")
- [ ] Miner ("3")
- [ ] Scout ("2")
- [ ] Spy ("S", italic)
- [ ] Bomb ("💣")
- [ ] Flag ("🚩")

Sci-Fi Legion:
- [ ] Marshal ("10")
- [ ] General ("9")
- [ ] Colonel ("8")
- [ ] Major ("7")
- [ ] Captain ("6")
- [ ] Lieutenant ("5")
- [ ] Sergeant ("4")
- [ ] Miner ("3")
- [ ] Scout ("2")
- [ ] Spy ("S", italic)
- [ ] Bomb ("💣")
- [ ] Flag ("🚩")

Wildlife Platoon:
- [ ] Marshal ("10")
- [ ] General ("9")
- [ ] Colonel ("8")
- [ ] Major ("7")
- [ ] Captain ("6")
- [ ] Lieutenant ("5")
- [ ] Sergeant ("4")
- [ ] Miner ("3")
- [ ] Scout ("2")
- [ ] Spy ("S", italic)
- [ ] Bomb ("💣")
- [ ] Flag ("🚩")

- [ ] **Step 3: If any badge is hard to read, strengthen it in `createImageTokenCard`**

If any combination above is flagged, increase the badge's `stroke-width` on its white outline (currently `1.5` in `web/js/token.js`'s `createImageTokenCard`) to `2`, or darken the badge fill from `#14141f` further, then re-run Step 1/2 for the affected theme only. Do not touch `createTokenSVG` or any other theme's badge as part of this fix.

- [ ] **Step 4: Commit (only if Step 3 required a code change)**

```bash
git add web/js/token.js
git commit -m "fix: strengthen token card badge outline for legibility"
```

---

### Task 8: Full verification + live production check

**Files:** none (verification only)

- [ ] **Step 1: Run the full automated test suite**

Run: `cd /Users/ai17/Documents/Andys_Workshop/Projects/Stratego/code && npm test`
Expected: every test passes, including the pre-existing suite plus the new `test/web/token.test.js` from Task 4.

- [ ] **Step 2: Live smoke test against the local stack**

With the local stack running, play one full two-browser-tab game (or one bot game) from room creation through setup to an active board: pick a theme for player 1, leave player 2 on Classic, place pieces, submit setup, and play several moves. Watch the browser console for errors. Confirm player 1's pieces render as theme cards and player 2's render as the classic coin on both tabs (including the opponent's screen — the whole point of server-syncing the theme). Also compare the themed board against a Classic-only board side by side: both `createTokenSVG`'s circular coin and `createImageTokenCard`'s rounded-square card share the same `viewBox="0 0 72 72"` and `.piece-token` CSS class (`web/css/styles.css:562-565`), so grid cell/board layout must be pixel-identical between themed and unthemed pieces — confirm no board-cell resizing or grid-shift occurs when a theme is active.

- [ ] **Step 3: Deploy and verify the Edge Function in production**

Deploy the new Edge Function:
```bash
npx supabase functions deploy set-token-theme
```
Then, against the production Supabase URL (matching this codebase's established "never trust local-only verification for server-side code" rule — the CORS lesson referenced in `docs/superpowers/plans/2026-07-12-bot-difficulty.md`), run one real curl call with a live game's token and confirm a `200 {"ok":true,...}` response and that the `games` row's theme column actually updated.

- [ ] **Step 4: Deploy the static site**

Follow this project's existing Render static-site deploy path (per `render.yaml`) so `web/assets/tokens/` and the updated `web/js/*.js`/`web/setup.html`/`web/css/styles.css` ship together. Confirm the deployed site loads a themed card correctly (checks that the `web/assets/tokens/` PNGs deployed alongside the JS, not just locally).
