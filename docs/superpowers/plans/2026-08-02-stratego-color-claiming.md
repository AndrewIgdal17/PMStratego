# Color Claiming & Synced Token Color Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make each player's army color a real, mutually-exclusive, server-synced value (not a local-only preference), and make every place a piece is rendered — board, graveyard trays, setup screen — show the *actual* color the owning player picked, replacing the hardcoded "enemy red."

**Architecture:** Two new nullable `text` columns on `games` (`player1_color`, `player2_color`) store the committed hex per slot. `create-game` and `join-game` auto-seed these on insert/join so there's never an "unclaimed" state. A new `set-color` Edge Function — built on a shared, unit-tested validation module (`_shared/colors.ts`) — is the single place a color claim is checked (status-is-setup, palette membership, not-taken-by-the-other-slot, own-repick-is-a-no-op) and written. `get_game_state` and `get_spectator_state` gain the same two columns on every returned row (small redundancy, matches the functions' existing per-row shape) so the client always has both players' committed colors without a second query. `token.js`'s `createTokenSVG` drops the `ENEMY_COLOR` branch entirely — the caller always supplies the real owner color, with a neutral-gray fallback baked into the renderer for the rare case a color is still null. `setup.js`'s color picker becomes a server round-trip (click → `set-color` → re-render) instead of a `localStorage` write, with a dedicated Realtime subscription on `games` so the opponent's swatch disables live.

**Tech Stack:** Supabase (Postgres + Deno Edge Functions), vanilla HTML/CSS/JS ES modules, inline SVG (no charting libraries). Tests: `deno test` for the new `_shared/colors.ts` module (matches the project's existing `_shared/information-warfare.ts` / `.test.ts` pattern); `node --test` unchanged for existing rules/web tests; new `@playwright/test` two-context end-to-end test for the cross-player sync behavior (first Playwright usage in this repo — added because the approved design spec explicitly requires a two-context browser test, which no existing tool in this repo can express).

## Global Constraints

- The palette is a fixed 8-hex set and must never be expanded: `#4a7a4a, #3a5a8a, #6a4a8a, #3a7a7a, #8a7a3a, #8a3a4a, #5a6a7a, #8a6a3a` (2 players only ever need 2 distinct colors — the other 6 are variety, not a slot-count requirement).
- Colors lock once `games.status !== 'setup'` — `set-color` must reject with `409 NOT_ALLOWED` after that point.
- Re-submitting your own already-committed color is always a no-op success, never a rejection.
- An uncommitted/unknown color must render as neutral gray, never red — red no longer means "enemy."
- No spectator-specific color handling — spectators just render whatever both committed colors are.
- New migration must use the next free number: existing migrations run `0001`–`0015`, so this one is `0016_player_colors.sql`.
- `set-color`'s server-side palette copy is a small, deliberate duplicate of `web/js/setup.js`'s `PLAYER_COLORS` hex list (not a cross-package import) — matches this project's established `_shared/`-module pattern and the spec's explicit call to keep it simple.

---

## File Structure

**Create:**
- `supabase/migrations/0016_player_colors.sql` — adds `player1_color`/`player2_color` to `games`; rebuilds `get_game_state` and `get_spectator_state` to return both columns on every row.
- `supabase/functions/_shared/colors.ts` — `PLAYER_COLOR_HEXES` palette, `firstAvailableColor()`, `validateColorClaim()` (pure, unit-testable).
- `supabase/functions/_shared/colors.test.ts` — Deno tests for every `validateColorClaim` branch and `firstAvailableColor`.
- `supabase/functions/set-color/index.ts` — the Edge Function; validates via `colors.ts`, writes the caller's slot column.
- `playwright.config.ts` — Playwright config (new test tool for this repo).
- `test/e2e/colorClaiming.spec.ts` — two-browser-context end-to-end test.

**Modify:**
- `supabase/functions/create-game/index.ts` — seeds `player1_color` on insert.
- `supabase/functions/join-game/index.ts` — seeds `player2_color` (first palette color not equal to `player1_color`) on join.
- `web/js/token.js` — retires `ENEMY_COLOR`/`ENEMY_STROKE`; adds `NEUTRAL_COLOR`; `createTokenSVG` always uses the passed-in color (with the neutral fallback) instead of branching on `isMine`.
- `web/js/game.js` — removes the `localStorage`-based `getPlayerColor()`; adds `colorForSlot()` sourced from `get_game_state`'s new columns; wires `renderBoard()` and `renderSingleGraveyard()` to real per-slot colors.
- `web/js/setup.js` — replaces the `localStorage`-write color picker with a `set-color` round trip, opponent-taken swatch disabling, a stale-default fallback check, and a dedicated `games` Realtime subscription for live palette sync during setup.
- `web/css/styles.css` — adds `.color-swatch.taken` / `.color-swatch.flash-taken` (+ keyframes); removes the hardcoded `filled-enemy` background so both graveyard trays get their color set inline by JS like the "mine" tray already does.
- `package.json` — adds `@playwright/test` devDependency and a `test:e2e` script.
- `README.md` — documents the two new test commands (`deno test`, `npx playwright test`).

---

### Task 1: Migration — `player1_color`/`player2_color` columns + color-aware state functions

**Files:**
- Create: `supabase/migrations/0016_player_colors.sql`

**Interfaces:**
- Produces: `games.player1_color`, `games.player2_color` (nullable `text`, no CHECK constraint — validated at the application layer by `set-color`, matching how `bot_difficulty`/`bot_personality` are constrained in SQL but colors are validated against a list that already lives in code). `get_game_state(p_token uuid)` and `get_spectator_state(p_room_code text)` both now return `player1_color text, player2_color text` as the last two columns of their existing row shape (`piece_id, player_slot, rank, row_idx, col_idx, alive, is_mine, player1_color, player2_color`). Every later task that reads state rows (Task 6's `game.js`) relies on exactly these two column names.

- [ ] **Step 1: Write the migration**

Postgres does not allow `CREATE OR REPLACE FUNCTION` to change a function's return columns, so both functions must be dropped before being recreated with the two extra columns.

```sql
-- supabase/migrations/0016_player_colors.sql
alter table games add column player1_color text;
alter table games add column player2_color text;

drop function if exists get_game_state(uuid);

create function get_game_state(p_token uuid)
returns table (
  piece_id uuid,
  player_slot smallint,
  rank text,
  row_idx smallint,
  col_idx smallint,
  alive boolean,
  is_mine boolean,
  player1_color text,
  player2_color text
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
    g.player1_color,
    g.player2_color
  from pieces p
  join games g on g.id = p.game_id
  where p.game_id = v_game_id;
end;
$$;

grant execute on function get_game_state(uuid) to anon;

drop function if exists get_spectator_state(text);

create function get_spectator_state(p_room_code text)
returns table (
  piece_id uuid,
  player_slot smallint,
  rank text,
  row_idx smallint,
  col_idx smallint,
  alive boolean,
  is_mine boolean,
  player1_color text,
  player2_color text
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
    g.player1_color,
    g.player2_color
  from pieces p
  join games g on g.id = p.game_id
  where p.game_id = v_game_id;
end;
$$;

grant execute on function get_spectator_state(text) to anon;
```

- [ ] **Step 2: Apply and verify locally**

This is a schema-only change (no pure logic to unit test), matching the project's existing `0007_bot_difficulty.sql`/`0008_bot_personality.sql` precedent — verification is "does it apply cleanly," done via the local Supabase stack.

Run:
```bash
cd Projects/Stratego/code
npx supabase start
npx supabase db reset
```
Expected: output ends with `Finished supabase db reset.` and no error mentioning `get_game_state`, `get_spectator_state`, or `player1_color`/`player2_color`. If `db reset` errors on `cannot change return type of existing function`, the `drop function if exists` lines are missing or misplaced — they must run before each `create function`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0016_player_colors.sql
git commit -m "feat: add player1_color/player2_color columns and expose them from get_game_state/get_spectator_state"
```

---

### Task 2: `_shared/colors.ts` — palette + pure validation (TDD)

**Files:**
- Create: `supabase/functions/_shared/colors.ts`
- Create: `supabase/functions/_shared/colors.test.ts`

**Interfaces:**
- Consumes: nothing (pure module, no imports beyond the Deno std assert used in the test file).
- Produces: `PLAYER_COLOR_HEXES: readonly string[]` (8-entry palette, exact order given in Global Constraints). `firstAvailableColor(taken: (string | null)[]): string`. `validateColorClaim(status: string, requestedHex: string, ownSlot: 1 | 2, player1Color: string | null, player2Color: string | null): { ok: true } | { ok: false; error: "NOT_ALLOWED" | "INVALID_COLOR" | "COLOR_TAKEN" }`. Task 3 and Task 4 call `firstAvailableColor`; Task 5 calls `validateColorClaim` with exactly this signature.

- [ ] **Step 1: Write the failing tests**

Create `supabase/functions/_shared/colors.test.ts`:

```typescript
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { PLAYER_COLOR_HEXES, firstAvailableColor, validateColorClaim } from "./colors.ts";

Deno.test("PLAYER_COLOR_HEXES has exactly 8 unique hexes", () => {
  assertEquals(PLAYER_COLOR_HEXES.length, 8);
  assertEquals(new Set(PLAYER_COLOR_HEXES).size, 8);
});

Deno.test("firstAvailableColor: nothing taken returns the first palette color", () => {
  assertEquals(firstAvailableColor([]), PLAYER_COLOR_HEXES[0]);
});

Deno.test("firstAvailableColor: skips a taken color and returns the next one", () => {
  assertEquals(firstAvailableColor([PLAYER_COLOR_HEXES[0]]), PLAYER_COLOR_HEXES[1]);
});

Deno.test("firstAvailableColor: skips nulls without treating them as taken", () => {
  assertEquals(firstAvailableColor([null, PLAYER_COLOR_HEXES[0]]), PLAYER_COLOR_HEXES[1]);
});

Deno.test("validateColorClaim: rejects when game is not in setup", () => {
  const result = validateColorClaim("active", PLAYER_COLOR_HEXES[2], 1, PLAYER_COLOR_HEXES[0], PLAYER_COLOR_HEXES[1]);
  assertEquals(result, { ok: false, error: "NOT_ALLOWED" });
});

Deno.test("validateColorClaim: rejects a hex not in the palette", () => {
  const result = validateColorClaim("setup", "#000000", 1, PLAYER_COLOR_HEXES[0], PLAYER_COLOR_HEXES[1]);
  assertEquals(result, { ok: false, error: "INVALID_COLOR" });
});

Deno.test("validateColorClaim: rejects a color already committed by the other slot", () => {
  const result = validateColorClaim("setup", PLAYER_COLOR_HEXES[1], 1, PLAYER_COLOR_HEXES[0], PLAYER_COLOR_HEXES[1]);
  assertEquals(result, { ok: false, error: "COLOR_TAKEN" });
});

Deno.test("validateColorClaim: allows re-picking your own current color as a no-op", () => {
  const result = validateColorClaim("setup", PLAYER_COLOR_HEXES[0], 1, PLAYER_COLOR_HEXES[0], PLAYER_COLOR_HEXES[1]);
  assertEquals(result, { ok: true });
});

Deno.test("validateColorClaim: allows claiming a free, never-before-taken color", () => {
  const result = validateColorClaim("setup", PLAYER_COLOR_HEXES[2], 1, PLAYER_COLOR_HEXES[0], PLAYER_COLOR_HEXES[1]);
  assertEquals(result, { ok: true });
});

Deno.test("validateColorClaim: works symmetrically for slot 2 against slot 1's color", () => {
  const result = validateColorClaim("setup", PLAYER_COLOR_HEXES[0], 2, PLAYER_COLOR_HEXES[0], PLAYER_COLOR_HEXES[1]);
  assertEquals(result, { ok: false, error: "COLOR_TAKEN" });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `deno test supabase/functions/_shared/colors.test.ts`
Expected: FAIL — `error: Module not found "file:///.../supabase/functions/_shared/colors.ts"` (the module doesn't exist yet).

- [ ] **Step 3: Write the implementation**

Create `supabase/functions/_shared/colors.ts`:

```typescript
// supabase/functions/_shared/colors.ts
//
// Server-side copy of the 8-swatch palette rendered by web/js/setup.js's
// PLAYER_COLORS. Deliberately duplicated (not cross-imported) -- it's an
// 8-item hex list, and this keeps the Edge Function runtime free of any
// dependency on the frontend bundle.
export const PLAYER_COLOR_HEXES = [
  "#4a7a4a",
  "#3a5a8a",
  "#6a4a8a",
  "#3a7a7a",
  "#8a7a3a",
  "#8a3a4a",
  "#5a6a7a",
  "#8a6a3a",
] as const;

export function firstAvailableColor(taken: (string | null)[]): string {
  return PLAYER_COLOR_HEXES.find((hex) => !taken.includes(hex)) ?? PLAYER_COLOR_HEXES[0];
}

export type ColorClaimError = "NOT_ALLOWED" | "INVALID_COLOR" | "COLOR_TAKEN";
export type ColorClaimResult = { ok: true } | { ok: false; error: ColorClaimError };

export function validateColorClaim(
  status: string,
  requestedHex: string,
  ownSlot: 1 | 2,
  player1Color: string | null,
  player2Color: string | null,
): ColorClaimResult {
  if (status !== "setup") {
    return { ok: false, error: "NOT_ALLOWED" };
  }

  if (!(PLAYER_COLOR_HEXES as readonly string[]).includes(requestedHex)) {
    return { ok: false, error: "INVALID_COLOR" };
  }

  const ownColor = ownSlot === 1 ? player1Color : player2Color;
  const otherColor = ownSlot === 1 ? player2Color : player1Color;

  if (requestedHex === ownColor) {
    return { ok: true }; // re-picking your own current color is always a no-op success
  }

  if (requestedHex === otherColor) {
    return { ok: false, error: "COLOR_TAKEN" };
  }

  return { ok: true };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `deno test supabase/functions/_shared/colors.test.ts`
Expected: `ok | 9 passed | 0 failed`

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/colors.ts supabase/functions/_shared/colors.test.ts
git commit -m "feat: add shared color palette + claim validation module with tests"
```

---

### Task 3: Auto-seed `player1_color` on `create-game`

**Files:**
- Modify: `supabase/functions/create-game/index.ts`

**Interfaces:**
- Consumes: `firstAvailableColor` from Task 2's `_shared/colors.ts`.
- Produces: every newly created `games` row has a non-null `player1_color` (always `PLAYER_COLOR_HEXES[0]`, since nothing is taken yet).

- [ ] **Step 1: Modify the function**

In `supabase/functions/create-game/index.ts`, find:

```typescript
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { verifyToken } from "../_shared/auth.ts";
```

Add the new import:

```typescript
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { verifyToken } from "../_shared/auth.ts";
import { firstAvailableColor } from "../_shared/colors.ts";
```

Then find:

```typescript
    const { data, error } = await supabase
      .from("games")
      .insert({ room_code: roomCode, is_bot_game: isBotGame, player1_id: playerId })
      .select("id")
      .single();
```

Replace with:

```typescript
    const { data, error } = await supabase
      .from("games")
      .insert({
        room_code: roomCode,
        is_bot_game: isBotGame,
        player1_id: playerId,
        player1_color: firstAvailableColor([]),
      })
      .select("id")
      .single();
```

- [ ] **Step 2: Manual verification**

This is I/O glue against a live database (no pure logic to unit test, matching this project's existing `create-game` — it has never had a dedicated test file). Verify against the local stack, which must already be running from Task 1.

Run:
```bash
npx supabase functions serve --no-verify-jwt &
sleep 2
curl -s -X POST http://127.0.0.1:54321/functions/v1/create-game -H "Content-Type: application/json" -d '{}'
```
Expected: a JSON response like `{"roomCode":"...","token":"...","invitePath":"..."}`. Then confirm the seed landed:
```bash
npx supabase db diff --linked 2>/dev/null; true  # no-op, ignore; use Studio or psql below instead
```
Open Supabase Studio (`http://127.0.0.1:54323` by default), go to the `games` table, and confirm the newest row has `player1_color = #4a7a4a`.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/create-game/index.ts
git commit -m "feat: auto-seed player1_color on create-game"
```

---

### Task 4: Auto-seed `player2_color` on `join-game`

**Files:**
- Modify: `supabase/functions/join-game/index.ts`

**Interfaces:**
- Consumes: `firstAvailableColor` from Task 2.
- Produces: every game gets a non-null `player2_color` the moment the second player joins, always distinct from `player1_color` at that moment.

- [ ] **Step 1: Modify the function**

In `supabase/functions/join-game/index.ts`, find:

```typescript
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { verifyToken } from "../_shared/auth.ts";
```

Add the import:

```typescript
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { verifyToken } from "../_shared/auth.ts";
import { firstAvailableColor } from "../_shared/colors.ts";
```

Find:

```typescript
  const { data: game, error: gameError } = await supabase
    .from("games")
    .select("id, status")
    .eq("room_code", roomCode)
    .maybeSingle();
```

Replace with:

```typescript
  const { data: game, error: gameError } = await supabase
    .from("games")
    .select("id, status, player1_color")
    .eq("room_code", roomCode)
    .maybeSingle();
```

Find:

```typescript
  let playerId: string | null = null;
  if (authToken) {
    const claims = await verifyToken(authToken);
    if (claims) playerId = claims.player_id;
  }

  if (playerId) {
    await supabase.from("games").update({ player2_id: playerId }).eq("id", game.id);
  }

  return new Response(
    JSON.stringify({ token: playerRow.secret_token, gameId: game.id }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
```

Replace with:

```typescript
  let playerId: string | null = null;
  if (authToken) {
    const claims = await verifyToken(authToken);
    if (claims) playerId = claims.player_id;
  }

  const gameUpdate: Record<string, unknown> = {
    player2_color: firstAvailableColor([game.player1_color]),
  };
  if (playerId) gameUpdate.player2_id = playerId;
  await supabase.from("games").update(gameUpdate).eq("id", game.id);

  return new Response(
    JSON.stringify({ token: playerRow.secret_token, gameId: game.id }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
```

- [ ] **Step 2: Manual verification**

Using the room code returned by Task 3's `create-game` curl call (still running the same local stack):

```bash
curl -s -X POST http://127.0.0.1:54321/functions/v1/join-game -H "Content-Type: application/json" -d '{"roomCode":"<ROOM_CODE_FROM_TASK_3>"}'
```
Expected: `{"token":"...","gameId":"..."}`. In Studio, confirm that game's row now has `player2_color = #3a5a8a` (the second palette entry, since `#4a7a4a` was already taken by `player1_color`).

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/join-game/index.ts
git commit -m "feat: auto-seed player2_color on join-game, avoiding player1's color"
```

---

### Task 5: `set-color` Edge Function

**Files:**
- Create: `supabase/functions/set-color/index.ts`

**Interfaces:**
- Consumes: `validateColorClaim` from Task 2's `_shared/colors.ts`; `corsHeaders` from `_shared/cors.ts`.
- Produces: `POST /functions/v1/set-color` with body `{ token: string, color: string }`. Success: `200 { ok: true, color: string }`. Failures: `401 { error: "INVALID_TOKEN" }`, `400 { error: "MISSING_FIELDS" }`, `409 { error: "NOT_ALLOWED" }` (game load failed, or status not `setup`), `400 { error: "INVALID_COLOR" }`, `409 { error: "COLOR_TAKEN" }`. This is the exact shape Task 8 (`setup.js`) calls via `callFunction("set-color", { token, color })`, and `callFunction`'s error handling (in `web/js/supabaseClient.js`) surfaces the `error` field as `err.message`.

- [ ] **Step 1: Write the function**

Mirrors `set-bot-difficulty/index.ts`'s exact shape (auth lookup → game load → validate → write), per this project's established Edge Function pattern.

```typescript
// supabase/functions/set-color/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { validateColorClaim } from "../_shared/colors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "METHOD_NOT_ALLOWED" }), { status: 405, headers: corsHeaders });
  }

  const { token, color } = await req.json();
  if (!token || !color) {
    return new Response(JSON.stringify({ error: "MISSING_FIELDS" }), { status: 400, headers: corsHeaders });
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

  const { data: game, error: gameError } = await supabase
    .from("games")
    .select("status, player1_color, player2_color")
    .eq("id", playerRow.game_id)
    .single();

  if (gameError || !game) {
    return new Response(JSON.stringify({ error: "NOT_ALLOWED" }), { status: 409, headers: corsHeaders });
  }

  const result = validateColorClaim(game.status, color, playerRow.player_slot, game.player1_color, game.player2_color);

  if (!result.ok) {
    const status = result.error === "INVALID_COLOR" ? 400 : 409;
    return new Response(JSON.stringify({ error: result.error }), { status, headers: corsHeaders });
  }

  const column = playerRow.player_slot === 1 ? "player1_color" : "player2_color";
  const { error: updateError } = await supabase
    .from("games")
    .update({ [column]: color, updated_at: new Date().toISOString() })
    .eq("id", playerRow.game_id);

  if (updateError) {
    return new Response(JSON.stringify({ error: "UPDATE_FAILED", detail: updateError.message }), {
      status: 500,
      headers: corsHeaders,
    });
  }

  return new Response(JSON.stringify({ ok: true, color }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
```

- [ ] **Step 2: Manual curl smoke test covering all four validation branches**

This function's I/O-heavy `Deno.serve` handler has no automated test in this project's convention (same as `set-bot-difficulty`, `create-game`, `join-game` — the pure validation logic it delegates to is already covered by Task 2's `colors.test.ts`). Verify the wiring end-to-end against the local stack (still running from Task 3/4):

```bash
# Fresh game + token for this test
RESP=$(curl -s -X POST http://127.0.0.1:54321/functions/v1/create-game -H "Content-Type: application/json" -d '{}')
echo "$RESP"
TOKEN=$(echo "$RESP" | node -e "process.stdin.on('data',d=>process.stdout.write(JSON.parse(d).token))")

# 1. Own-repick no-op: player1 was auto-seeded to #4a7a4a
curl -s -X POST http://127.0.0.1:54321/functions/v1/set-color -H "Content-Type: application/json" -d "{\"token\":\"$TOKEN\",\"color\":\"#4a7a4a\"}"
# Expected: {"ok":true,"color":"#4a7a4a"}

# 2. Free color claim
curl -s -X POST http://127.0.0.1:54321/functions/v1/set-color -H "Content-Type: application/json" -d "{\"token\":\"$TOKEN\",\"color\":\"#6a4a8a\"}"
# Expected: {"ok":true,"color":"#6a4a8a"}

# 3. Invalid hex (not in the 8-color palette)
curl -s -X POST http://127.0.0.1:54321/functions/v1/set-color -H "Content-Type: application/json" -d "{\"token\":\"$TOKEN\",\"color\":\"#000000\"}"
# Expected: {"error":"INVALID_COLOR"} with HTTP 400 (add -i to curl to see the status line)

# 4. Opponent-taken: join as player 2, then have player 1 try to claim player 2's auto-seeded color
JOIN_RESP=$(curl -s -X POST http://127.0.0.1:54321/functions/v1/join-game -H "Content-Type: application/json" -d "{\"roomCode\":\"$(echo "$RESP" | node -e "process.stdin.on('data',d=>process.stdout.write(JSON.parse(d).roomCode))")\"}")
echo "$JOIN_RESP"
curl -s -X POST http://127.0.0.1:54321/functions/v1/set-color -H "Content-Type: application/json" -d "{\"token\":\"$TOKEN\",\"color\":\"#3a5a8a\"}"
# Expected: {"error":"COLOR_TAKEN"} — player 2 was auto-seeded to #3a5a8a on join
```

Expected across all four: exact error/success bodies as annotated above.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/set-color/index.ts
git commit -m "feat: add set-color Edge Function"
```

---

### Task 6: `token.js` — retire `ENEMY_COLOR`, add `NEUTRAL_COLOR`

**Files:**
- Modify: `web/js/token.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `NEUTRAL_COLOR` (new named export, `'#6a6a6a'`) alongside the existing `DEFAULT_PLAYER_COLOR` and `createTokenSVG(rank, isMine, playerColor)`. `createTokenSVG`'s call signature is unchanged — only its internal color logic changes — so no call site in `setup.js` or `game.js` needs to change how it invokes this function; Task 7 and Task 8 only change what color value they pass in for the third argument. `isMine` is intentionally kept as a parameter even though it no longer selects the fill color: a separate, not-yet-implemented design spec (`docs/superpowers/specs/2026-08-02-stratego-higgsfield-tokens-design.md`) already documents `createTokenSVG(rank, isMine, playerColor)` as the function's stable signature for a future ownership-badge feature, so removing the parameter now would be a needless breaking change against already-planned work.

- [ ] **Step 1: Modify the module**

Find:

```javascript
const ENEMY_COLOR = '#8b4444';
const ENEMY_STROKE = '#6a2a2a';
export const DEFAULT_PLAYER_COLOR = '#4a7a4a';
```

Replace with:

```javascript
export const DEFAULT_PLAYER_COLOR = '#4a7a4a';
export const NEUTRAL_COLOR = '#6a6a6a';
```

Find:

```javascript
export function createTokenSVG(rank, isMine, playerColor = DEFAULT_PLAYER_COLOR) {
  const fill = isMine ? playerColor : ENEMY_COLOR;
  const stroke = isMine ? darkenColor(fill) : ENEMY_STROKE;
  const textFill = isMine ? '#e0f0e0' : '#f0d0d0';
```

Replace with:

```javascript
export function createTokenSVG(rank, isMine, playerColor = DEFAULT_PLAYER_COLOR) {
  const fill = playerColor || NEUTRAL_COLOR;
  const stroke = darkenColor(fill);
  const textFill = '#e0f0e0';
```

- [ ] **Step 2: Manual verification**

`token.js` has no dedicated test file today (it's pure DOM/SVG construction with no existing test harness in this project — confirmed by inspecting `test/`), so this is verified visually once Task 7 and Task 8 wire real colors through it. No action here beyond re-reading the diff to confirm `ENEMY_COLOR` and `ENEMY_STROKE` have zero remaining references:

Run: `grep -n "ENEMY_COLOR\|ENEMY_STROKE" web/js/token.js`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add web/js/token.js
git commit -m "feat: retire ENEMY_COLOR in token.js in favor of caller-supplied real colors"
```

---

### Task 7: `game.js` — render real per-slot colors on the board and graveyard trays

**Files:**
- Modify: `web/js/game.js`

**Interfaces:**
- Consumes: `NEUTRAL_COLOR` from Task 6's `token.js`; `player1_color`/`player2_color` from every row returned by `get_game_state`/`get_spectator_state` (Task 1).
- Produces: `colorForSlot(slotNum)` (new module-private helper) — used by Task 8 is not required (setup.js has its own color state), but any future code in this file reading a piece's real color should go through it rather than re-deriving it.

- [ ] **Step 1: Remove the localStorage-based color getter**

Find:

```javascript
function getPlayerColor() {
  return localStorage.getItem(`stratego:${roomCode}:color`) || DEFAULT_PLAYER_COLOR;
}
```

Replace with:

```javascript
function colorForSlot(slotNum) {
  const anyPiece = [...piecesById.values()][0];
  if (!anyPiece) return null;
  return slotNum === 1 ? anyPiece.player1_color : anyPiece.player2_color;
}
```

- [ ] **Step 2: Update the import to drop the now-unused `DEFAULT_PLAYER_COLOR` and add `NEUTRAL_COLOR`**

Find:

```javascript
import { createTokenSVG, RANK_NAME, DEFAULT_PLAYER_COLOR } from "./token.js";
```

Replace with:

```javascript
import { createTokenSVG, RANK_NAME, NEUTRAL_COLOR } from "./token.js";
```

- [ ] **Step 3: Wire the board renderer to real colors**

Find, inside `renderBoard()`:

```javascript
      const piece = [...piecesById.values()].find((p) => p.row_idx === row && p.col_idx === col && p.alive);
      if (piece) {
        const isFriendly = isSpectator ? piece.player_slot === 1 : piece.is_mine;
        let displayRank = piece.rank;
        if (!isFriendly && displayRank == null) {
          const revealedRank = getPostCombatRevealRank(piece.piece_id);
          if (revealedRank != null) displayRank = revealedRank;
        }
        cell.appendChild(createTokenSVG(displayRank, isFriendly, getPlayerColor()));
        if (piece.piece_id === selectedPieceId) cell.classList.add("selected");
      }
```

Replace with:

```javascript
      const piece = [...piecesById.values()].find((p) => p.row_idx === row && p.col_idx === col && p.alive);
      if (piece) {
        const isFriendly = isSpectator ? piece.player_slot === 1 : piece.is_mine;
        let displayRank = piece.rank;
        if (!isFriendly && displayRank == null) {
          const revealedRank = getPostCombatRevealRank(piece.piece_id);
          if (revealedRank != null) displayRank = revealedRank;
        }
        cell.appendChild(createTokenSVG(displayRank, isFriendly, colorForSlot(piece.player_slot)));
        if (piece.piece_id === selectedPieceId) cell.classList.add("selected");
      }
```

- [ ] **Step 4: Wire the graveyard trays to real colors on both sides**

Find:

```javascript
function renderSingleGraveyard(containerId, isMine, enemyRankMap, filterSlot) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const allPieces = [...piecesById.values()];
  const deadPieces = allPieces.filter((p) => !p.alive && (filterSlot ? p.player_slot === filterSlot : p.is_mine === isMine));
```

Replace with:

```javascript
function renderSingleGraveyard(containerId, isMine, enemyRankMap, filterSlot) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const colorSlot = filterSlot ?? (isMine ? mySlot : 3 - mySlot);
  const trayColor = colorForSlot(colorSlot) || NEUTRAL_COLOR;

  const allPieces = [...piecesById.values()];
  const deadPieces = allPieces.filter((p) => !p.alive && (filterSlot ? p.player_slot === filterSlot : p.is_mine === isMine));
```

Find:

```javascript
      if (s < deadCount) {
        slot.classList.add(`filled-${colorSuffix}`);
        slot.textContent = entry.abbr;
        if (isMine) slot.style.backgroundColor = getPlayerColor();
      } else {
        slot.classList.add(`empty-${colorSuffix}`);
      }
```

Replace with:

```javascript
      if (s < deadCount) {
        slot.classList.add(`filled-${colorSuffix}`);
        slot.textContent = entry.abbr;
        slot.style.backgroundColor = trayColor;
      } else {
        slot.classList.add(`empty-${colorSuffix}`);
      }
```

- [ ] **Step 5: Manual verification**

`game.js` has no unit test harness (it's DOM/network glue executed on import, same as `setup.js` — confirmed by the absence of any `game.test.js` in `test/`). Verify against the local stack after Task 8 and Task 9 are in place, as part of Task 12's full run-through. For now, just confirm there are no leftover references:

Run: `grep -n "getPlayerColor" web/js/game.js`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add web/js/game.js
git commit -m "feat: render real per-slot colors on the board and both graveyard trays"
```

---

### Task 8: `setup.js` — server-backed color picker

**Files:**
- Modify: `web/js/setup.js`

**Interfaces:**
- Consumes: `callFunction("set-color", { token, color })` from Task 5; `supabase` client and the existing `slot`/`roomCode`/`token` module-level values already defined in this file.
- Produces: module-level `myColor` (string or `null`), read by `renderGrid()` in place of the old `localStorage` read.

- [ ] **Step 1: Replace the color-picker state and rendering logic**

Find the entire existing color-picker block:

```javascript
const PLAYER_COLORS = [
  { name: 'Forest Green', hex: '#4a7a4a' },
  { name: 'Navy Blue',    hex: '#3a5a8a' },
  { name: 'Royal Purple', hex: '#6a4a8a' },
  { name: 'Teal',         hex: '#3a7a7a' },
  { name: 'Gold',         hex: '#8a7a3a' },
  { name: 'Crimson',      hex: '#8a3a4a' },
  { name: 'Slate',        hex: '#5a6a7a' },
  { name: 'Bronze',       hex: '#8a6a3a' },
];

function initColorPicker() {
  const container = document.getElementById('color-swatches');
  if (!container) return;

  const saved = localStorage.getItem(`stratego:${roomCode}:color`) || PLAYER_COLORS[0].hex;

  for (const color of PLAYER_COLORS) {
    const swatch = document.createElement('div');
    swatch.className = 'color-swatch';
    swatch.style.backgroundColor = color.hex;
    swatch.title = color.name;
    if (color.hex === saved) swatch.classList.add('selected');

    swatch.addEventListener('click', () => {
      container.querySelectorAll('.color-swatch').forEach((s) => s.classList.remove('selected'));
      swatch.classList.add('selected');
      localStorage.setItem(`stratego:${roomCode}:color`, color.hex);
      if (typeof renderGrid === "function") renderGrid();
    });

    container.appendChild(swatch);
  }

  if (!localStorage.getItem(`stratego:${roomCode}:color`)) {
    localStorage.setItem(`stratego:${roomCode}:color`, PLAYER_COLORS[0].hex);
  }
}

initColorPicker();
```

Replace with:

```javascript
const PLAYER_COLORS = [
  { name: 'Forest Green', hex: '#4a7a4a' },
  { name: 'Navy Blue',    hex: '#3a5a8a' },
  { name: 'Royal Purple', hex: '#6a4a8a' },
  { name: 'Teal',         hex: '#3a7a7a' },
  { name: 'Gold',         hex: '#8a7a3a' },
  { name: 'Crimson',      hex: '#8a3a4a' },
  { name: 'Slate',        hex: '#5a6a7a' },
  { name: 'Bronze',       hex: '#8a6a3a' },
];

let myColor = null;
let opponentColor = null;

function renderColorPalette() {
  const container = document.getElementById('color-swatches');
  if (!container) return;
  container.innerHTML = '';

  for (const color of PLAYER_COLORS) {
    const swatch = document.createElement('div');
    swatch.className = 'color-swatch';
    swatch.style.backgroundColor = color.hex;

    const isTaken = color.hex === opponentColor && color.hex !== myColor;
    if (isTaken) {
      swatch.classList.add('taken');
      swatch.title = `${color.name} (Taken by opponent)`;
    } else {
      swatch.title = color.name;
      swatch.addEventListener('click', () => selectColor(color.hex, swatch));
    }

    if (color.hex === myColor) swatch.classList.add('selected');

    container.appendChild(swatch);
  }
}

async function selectColor(hex, swatchEl) {
  if (hex === myColor) return;
  try {
    await callFunction("set-color", { token, color: hex });
    myColor = hex;
    localStorage.setItem(`stratego:${roomCode}:color`, hex);
    renderColorPalette();
    if (typeof renderGrid === "function") renderGrid();
  } catch (err) {
    swatchEl.classList.add('flash-taken');
    setTimeout(() => swatchEl.classList.remove('flash-taken'), 500);
  }
}
```

- [ ] **Step 2: Add the async init function that fetches colors, applies the stale-default fallback, and subscribes to live updates**

This must run *after* `token` and `slot` are defined (see the note in Step 3 about placement). Add this new function right after the block from Step 1 (it will be called from Step 3, not immediately):

```javascript
async function initColorPicker() {
  const { data: gameRow } = await supabase.from("games").select("id, player1_color, player2_color").eq("room_code", roomCode).single();
  if (!gameRow) return;

  myColor = slot === 1 ? gameRow.player1_color : gameRow.player2_color;
  opponentColor = slot === 1 ? gameRow.player2_color : gameRow.player1_color;

  const remembered = localStorage.getItem(`stratego:${roomCode}:color`);
  if (remembered && remembered === opponentColor && remembered !== myColor) {
    // Stale local default that now collides with the opponent's committed
    // color -- silently fall through to the first free palette color
    // instead of showing an error the player never asked for.
    const fallback = PLAYER_COLORS.find((c) => c.hex !== opponentColor)?.hex ?? PLAYER_COLORS[0].hex;
    try {
      await callFunction("set-color", { token, color: fallback });
      myColor = fallback;
      localStorage.setItem(`stratego:${roomCode}:color`, fallback);
    } catch {
      // Best-effort only -- if this fails, the palette below still reflects
      // whatever the server actually has, which is always safe to show.
    }
  }

  renderColorPalette();

  supabase
    .channel(`color-wait-${gameRow.id}`)
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "games", filter: `id=eq.${gameRow.id}` }, (payload) => {
      myColor = slot === 1 ? payload.new.player1_color : payload.new.player2_color;
      opponentColor = slot === 1 ? payload.new.player2_color : payload.new.player1_color;
      renderColorPalette();
    })
    .subscribe();
}
```

- [ ] **Step 3: Move the init call to after `token`/`slot` are defined**

The original `initColorPicker();` call (right after the old color-picker block, before `ensureSession()`) must be removed — `set-color` needs `token`, which doesn't exist yet at that point in the file. Find:

```javascript
const slot = Number(localStorage.getItem(`stratego:${roomCode}:slot`));
const ABSOLUTE_ROWS = ABSOLUTE_ROWS_BY_SLOT[slot];

async function initDifficultyControls() {
```

Replace with:

```javascript
const slot = Number(localStorage.getItem(`stratego:${roomCode}:slot`));
const ABSOLUTE_ROWS = ABSOLUTE_ROWS_BY_SLOT[slot];

initColorPicker();

async function initDifficultyControls() {
```

- [ ] **Step 4: Update `renderGrid()` to read the new `myColor` variable instead of `localStorage`**

Find:

```javascript
      if (rank) {
        const playerColor = localStorage.getItem(`stratego:${roomCode}:color`) || DEFAULT_PLAYER_COLOR;
        cell.appendChild(createTokenSVG(rank, true, playerColor));
        cell.classList.add("occupied");
      }
```

Replace with:

```javascript
      if (rank) {
        cell.appendChild(createTokenSVG(rank, true, myColor || DEFAULT_PLAYER_COLOR));
        cell.classList.add("occupied");
      }
```

(`DEFAULT_PLAYER_COLOR` stays imported from `token.js` at the top of the file — it's the pre-fetch fallback for the brief window before `initColorPicker()`'s async call resolves, since `renderGrid()` runs synchronously at file load time via the final `renderGrid(); renderTray(); updateSubmitButton();` calls at the bottom of the file.)

- [ ] **Step 5: Manual verification**

DOM/network glue code, same "no automated test" convention as `initDifficultyControls`/`initPersonalityControls` in this same file. Verified as part of Task 12's full run-through. For now, confirm no dangling references:

Run: `grep -n "getPlayerColor\|stratego:\${roomCode}:color.*localStorage.getItem" web/js/setup.js`
Expected: no matches for a bare `localStorage.getItem` color read outside of the two intentional remaining uses (`selectColor`'s write and `initColorPicker`'s stale-default read) — spot-check by eye that both remaining `localStorage` color lines are inside `selectColor` (a write, for remembering the choice) and `initColorPicker` (the stale-default check), not a naked read feeding rendering.

- [ ] **Step 6: Commit**

```bash
git add web/js/setup.js
git commit -m "feat: make the setup color picker a server round trip with live opponent-taken sync"
```

---

### Task 9: CSS — taken/flash-taken swatch states, dynamic graveyard colors

**Files:**
- Modify: `web/css/styles.css`

**Interfaces:**
- Consumes: the `.taken` and `.flash-taken` classes added by Task 8's `renderColorPalette()`/`selectColor()`.
- Produces: no new JS-facing interface — pure visual styling.

- [ ] **Step 1: Remove the hardcoded enemy graveyard background and unify the filled-slot text color**

Find:

```css
.graveyard-slot.filled-mine {
  color: #e0f0e0;
}

.graveyard-slot.filled-enemy {
  background: #d98b8b;
  color: #3a1a1a;
}
```

Replace with:

```css
.graveyard-slot.filled-mine,
.graveyard-slot.filled-enemy {
  color: #e0f0e0;
}
```

(The background for both is now set inline by `game.js`'s `slot.style.backgroundColor = trayColor;` from Task 7 — matching how `filled-mine` already worked before this change.)

- [ ] **Step 2: Add the taken/flash-taken swatch styles**

Find:

```css
.color-swatch.selected {
  border-color: gold;
  box-shadow: 0 0 6px rgba(255, 215, 0, 0.5);
}
```

Add immediately after it:

```css
.color-swatch.taken {
  opacity: 0.25;
  filter: grayscale(70%);
  cursor: not-allowed;
}

.color-swatch.flash-taken {
  animation: shake-taken 0.4s;
}

@keyframes shake-taken {
  0%, 100% { transform: translateX(0); box-shadow: none; }
  20%, 60% { transform: translateX(-4px); box-shadow: 0 0 8px 2px rgba(220, 50, 50, 0.8); }
  40%, 80% { transform: translateX(4px); box-shadow: 0 0 8px 2px rgba(220, 50, 50, 0.8); }
}
```

- [ ] **Step 3: Manual verification**

CSS-only change, verified visually as part of Task 12. Sanity-check the file still parses by running the frontend locally:

Run: `cd web && python3 -m http.server 8080 &` then open `http://localhost:8080/setup.html?code=TEST` in a browser and confirm no console error about `styles.css` failing to load (a syntax error would still let the rest of the page render, so this is a weak check — the real verification is Task 12's browser walkthrough).

- [ ] **Step 4: Commit**

```bash
git add web/css/styles.css
git commit -m "feat: add taken/flash-taken color swatch styles; drop hardcoded enemy graveyard color"
```

---

### Task 10: Add Playwright as a dev dependency

**Files:**
- Modify: `package.json`
- Create: `playwright.config.ts`
- Modify: `README.md`

**Interfaces:**
- Produces: `npx playwright test` runs any `*.spec.ts` file under `test/e2e/` against `http://localhost:8080` (the same static server this project's README already documents running via `npx http-server web -p 8080` or `python3 -m http.server 8080` from inside `web/`). Task 11's spec file is written against this config.

- [ ] **Step 1: Install the dependency**

Run:
```bash
cd Projects/Stratego/code
npm install --save-dev @playwright/test@^1.62.1
npx playwright install chromium
```
Expected: `package.json`'s `devDependencies` now includes `@playwright/test`; a `package-lock.json` is created/updated; Chromium downloads without error.

- [ ] **Step 2: Add the `test:e2e` script**

In `package.json`, find:

```json
  "scripts": {
    "test": "node --test"
  },
```

Replace with:

```json
  "scripts": {
    "test": "node --test",
    "test:e2e": "playwright test"
  },
```

- [ ] **Step 3: Write the Playwright config**

Create `playwright.config.ts`:

```typescript
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test/e2e',
  timeout: 30000,
  fullyParallel: false,
  use: {
    baseURL: 'http://localhost:8080',
  },
});
```

`fullyParallel: false` because Task 11's test creates two contexts against the same local Supabase project and room-code generation is already astronomically-collision-resistant on its own — no need to add parallel-worker isolation complexity for a single spec file.

- [ ] **Step 4: Document how to run it**

In `README.md`, find:

```markdown
**Rules engine tests** (no external dependencies):

```bash
npm test
```
```

Replace with:

```markdown
**Rules engine tests** (no external dependencies):

```bash
npm test
```

**Shared Edge Function logic tests** (Deno, no external dependencies):

```bash
deno test supabase/functions/_shared/colors.test.ts
deno test supabase/functions/_shared/information-warfare.test.ts
```

**End-to-end tests** (Playwright, requires the local Supabase stack and static
frontend server both running — see below):

```bash
npx playwright test
```
```

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json playwright.config.ts README.md
git commit -m "chore: add Playwright for end-to-end testing"
```

---

### Task 11: Two-context Playwright test — color claiming & sync

**Files:**
- Create: `test/e2e/colorClaiming.spec.ts`

**Interfaces:**
- Consumes: `playwright.config.ts` from Task 10; the running local Supabase stack + `web/` static server (both started manually before this test runs, per Task 12's full verification sequence).
- Produces: nothing consumed by later tasks — this is the final proof of the whole feature.

- [ ] **Step 1: Write the test**

```typescript
// test/e2e/colorClaiming.spec.ts
import { test, expect } from '@playwright/test';

test('opponent-taken swatches disable live, and pieces render in the real chosen color', async ({ browser }) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  await pageA.goto('/index.html');
  await pageA.click('#new-game-btn');
  const roomCode = (await pageA.locator('.room-code-box').innerText()).trim();
  await pageA.click('#continue-to-setup-btn');
  await pageA.waitForURL(/setup\.html\?code=/);

  await pageB.goto('/index.html');
  await pageB.fill('#room-code-input', roomCode);
  await pageB.click('#join-form button[type="submit"]');
  await pageB.waitForURL(/setup\.html\?code=/);

  // Player A (slot 1) was auto-seeded to palette[0] (#4a7a4a); player B
  // (slot 2) was auto-seeded to palette[1] (#3a5a8a) on join. A picks
  // palette[2] (#6a4a8a, Royal Purple) -- distinct from both auto-seeded
  // defaults, so the assertions below are unambiguous.
  await pageA.locator('.color-swatch').nth(2).click();
  await expect(pageA.locator('.color-swatch').nth(2)).toHaveClass(/selected/);

  // Player B's palette must show that swatch disabled within one poll/
  // Realtime cycle -- no manual refresh triggered on purpose.
  await expect(pageB.locator('.color-swatch').nth(2)).toHaveClass(/taken/, { timeout: 10000 });

  // Fastest path to an active game through the real UI: random formation,
  // then submit, for both players.
  await pageA.click('[data-formation="random"]');
  await pageA.click('#submit-setup-btn');
  await pageB.click('[data-formation="random"]');
  await pageB.click('#submit-setup-btn');

  await pageA.waitForURL(/game\.html\?code=/, { timeout: 20000 });
  await pageB.waitForURL(/game\.html\?code=/, { timeout: 20000 });

  // Player B's board must render Player A's pieces in A's actual chosen
  // color (#6a4a8a), and never the old hardcoded enemy red (#8b4444).
  const enemyColoredPieces = pageB.locator('#board .piece-token circle[fill="#6a4a8a"]');
  await expect(enemyColoredPieces.first()).toBeVisible();

  const legacyRedPieces = pageB.locator('#board .piece-token circle[fill="#8b4444"]');
  await expect(legacyRedPieces).toHaveCount(0);

  await contextA.close();
  await contextB.close();
});
```

- [ ] **Step 2: Run it against the local stack**

Requires the local Supabase stack and the static frontend server both running, and `web/js/supabaseClient.js` pointed at the local project (per this README's existing "Local development" instructions — swap in the `SUPABASE_URL`/anon key printed by `npx supabase status` for the duration of this test run, then swap back before committing anything under `web/js/supabaseClient.js`, which must stay pointed at production).

```bash
npx supabase start
npx supabase db reset
npx supabase functions serve --no-verify-jwt &
cd web && npx http-server . -p 8080 &
cd ..
npx playwright test
```
Expected: `1 passed`.

- [ ] **Step 3: Commit**

```bash
git add test/e2e/colorClaiming.spec.ts
git commit -m "test: add two-context Playwright test for color claiming and sync"
```

---

### Task 12: Full verification + deploy decision

**Files:** none (verification only)

- [ ] **Step 1: Run the full non-browser test suite**

Run: `npm test`
Expected: every existing test still passes (this feature touched no rules-engine files, so the count should be unchanged from before this plan).

Run: `deno test supabase/functions/_shared/colors.test.ts`
Expected: `ok | 9 passed | 0 failed`

Run: `deno test supabase/functions/_shared/information-warfare.test.ts`
Expected: unchanged pass count from before this plan (this feature didn't touch that module).

- [ ] **Step 2: Live two-player smoke test through the browser**

With the local stack still running from Task 11, manually play through one full game start-to-first-moves as two separate browser profiles (or a normal window + an incognito window), confirming by eye:
1. Player 1's setup screen shows 8 swatches, one pre-selected (auto-seeded default).
2. Clicking a free swatch on Player 1's screen instantly updates Player 1's own selection, and — without Player 1 refreshing anything — Player 2's screen shows that same swatch grayed out with a "Taken by opponent" tooltip within a few seconds.
3. Clicking Player 2's own currently-selected swatch a second time does not error or flicker (no-op).
4. After both submit setups and the game goes active, each player's own pieces and the opponent's pieces render in the two actual chosen colors — no red anywhere on the board or in either graveyard tray.
5. A spectator (`game.html?code=<ROOM>&spectate=1` in a third tab) also sees both real colors, no red.

- [ ] **Step 3: Run the Playwright suite one more time clean**

Run: `npx playwright test`
Expected: `1 passed`.

- [ ] **Step 4: Do not auto-deploy**

Migrations (`npx supabase db push`) and Edge Function deploys (`npx supabase functions deploy`) are production actions against the live project. Stop here and report status — deploying to the live Supabase project and pushing to `origin/main` (which triggers the Render auto-deploy) are separate, explicit decisions for the user, matching how every prior feature in this project's history was deployed only after an explicit go-ahead. Also double check at this point that `web/js/supabaseClient.js` still points at the production `SUPABASE_URL`/anon key (not the local values swapped in for Task 11's test run).

---

## Self-Review Notes (completed during authoring)

**1. Spec coverage:**
- New `games` columns (`player1_color`, `player2_color`) — Task 1. ✓
- Auto-seed on create/join — Task 3, Task 4. ✓
- `set-color` Edge Function with all four validation branches (status, palette, taken, own-repick no-op) — Task 2 (pure logic + tests) + Task 5 (wiring + curl smoke test covering all four). ✓
- `get_game_state` (and, for consistency, `get_spectator_state`) returning color fields — Task 1. ✓
- Retire `ENEMY_COLOR`; rewire `token.js`/`game.js`/graveyard trays to real colors with neutral-gray fallback — Task 6, Task 7. ✓
- Client-side stale-default fallback logic — Task 8, `initColorPicker`'s stale-default check. ✓
- Swatch-disable-on-taken UI — Task 8's `renderColorPalette` + Task 9's `.taken` CSS. ✓
- Unit test coverage — Task 2 (`colors.test.ts`, 9 Deno tests covering every branch). ✓
- Two-context Playwright test — Task 10 (tooling) + Task 11 (the test itself), matching the spec's exact two assertions (swatch disables live; board shows real color, not red). ✓
- Out-of-scope items (no spectator-specific handling, no palette expansion) — confirmed nothing in this plan special-cases spectators beyond reusing the same `get_spectator_state` columns, and the palette stays fixed at 8 hexes throughout (Global Constraints).

**2. Placeholder scan:** re-read every step; no "TBD"/"handle appropriately"/"similar to Task N"-style gaps found. Every code step shows complete, runnable code (including full before/after context for every `Modify` step, matching this plan's own "exact file paths, complete code" requirement).

**3. Type/name consistency:** `firstAvailableColor(taken: (string | null)[]): string` defined in Task 2, called identically (array literal of nullable strings) in Task 3 and Task 4. `validateColorClaim(status, requestedHex, ownSlot, player1Color, player2Color)` defined in Task 2, called with the same five arguments in the same order in Task 5. `colorForSlot(slotNum)` defined once in Task 7 and used consistently within that same task (Task 8's `setup.js` deliberately does *not* reuse this name — it tracks `myColor`/`opponentColor` locally instead, since `setup.js` has no `piecesById` to derive from; this is a distinct, intentionally separate mechanism, not a naming collision). `NEUTRAL_COLOR` exported once from `token.js` in Task 6, imported with that exact name in Task 7 (Task 8 never needs it, since `setup.js` only ever renders "mine" pieces, which always have a resolved `myColor` or the `DEFAULT_PLAYER_COLOR` fallback — never `NEUTRAL_COLOR`). `PLAYER_COLOR_HEXES` (server, `_shared/colors.ts`) and `PLAYER_COLORS` (client, `setup.js`) are intentionally two separate, unlinked lists per the spec's explicit "duplicate rather than fetch cross-repo" instruction — verified both lists contain the identical 8 hexes in the identical order.
