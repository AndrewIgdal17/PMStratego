# Private Saved Formations + L/R Mirror Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a logged-in player save up to 5 private setup-grid formations to their account, reload any of them on a future setup screen, delete them, and mirror the current grid left-right with one click — all built on the existing JWT player-account system and the existing `applyFormation`/`renderGrid` code path in `web/js/setup.js`.

**Architecture:** One new Postgres table (`player_formations`, server-side-only RLS matching `game_players`/`pieces`) plus three new JWT-authenticated Edge Functions (`save-formation`, `list-formations`, `delete-formation`) that reuse `_shared/auth.ts` exactly as `login`/`signup` do. The client reuses the existing `placements` Map ⇄ `cells: [[row, col, rank], ...]` conversion already implicit in `applyFormation`, adds a "My Formations" panel next to the existing Defensive/Aggressive buttons in `setup.js`/`setup.html`, and adds a pure, independently-testable `mirrorPlacements()` transform (same pattern as `formationRowMap.js`) wired to a new "⇄ Mirror L/R" button.

**Tech Stack:** Deno Edge Functions (Supabase), Postgres/RLS, vanilla ES module JS (no framework) for the client, Node's built-in `node:test` runner for pure client-side unit tests (matches `package.json`'s `"test": "node --test"`), Deno's built-in `Deno.test` for Edge Function unit tests (first Deno tests in this repo — no prior convention existed to follow), Playwright for the end-to-end test (first Playwright test in this repo).

## Global Constraints

- 5 private formation slots per player, enforced in the `save-formation` Edge Function (not a DB constraint) — same pattern as `set-bot-difficulty`'s allowed-value check.
- `player_formations.name`: `text not null check (char_length(name) between 1 and 40)`.
- `player_formations.cells` stores the exact same `[[row, col, rank], ...]` shape as `DEFENSIVE_FORMATIONS`/`AGGRESSIVE_FORMATIONS` in `formations.js`, in the player's own local 0-3 row / 0-9 col convention (pre-`ABSOLUTE_ROWS_BY_SLOT` remap).
- `player_formations` RLS: enabled, **no client policies** — same "server-side only" pattern as `game_players`/`pieces` (`0001_init.sql`). All access goes through the three new JWT-authenticated Edge Functions using the service role.
- Save-formation same-name behavior: if a row with the exact `name` already exists for this player, **overwrite it** (update, not a duplicate).
- The game itself requires no login to play; the "My Formations" panel is the first feature in this codebase to gate on player login.
- Mirror transform: pure client-side, no server round-trip, no new data model. `"row,col"` → `"row,${9-col}"` (column-only reflection; rows/ranks unchanged). Idempotent: mirroring twice returns the original.
- No cross-player sharing/import of formations. No formation preview thumbnails in slot buttons (name-only for v1).
- Confirm the migration number `0016` is still the next free number in `supabase/migrations/` before applying — at plan-writing time the highest existing migration is `0015_scout_self_reveal.sql`, so `0016` is free, but re-check with `ls supabase/migrations/` immediately before running `db push` in case another migration landed since this plan was written.

---

## File Structure

- **Create** `supabase/migrations/0016_player_formations.sql` — the new table + RLS.
- **Create** `supabase/functions/save-formation/logic.ts` — pure decision logic (update vs. insert vs. reject-at-limit) and field validation, unit-testable with no DB.
- **Create** `supabase/functions/save-formation/logic.test.ts` — Deno tests for the above.
- **Create** `supabase/functions/save-formation/index.ts` — the Edge Function: JWT check via `_shared/auth.ts`, calls into `logic.ts`, does the Supabase I/O. Exports `handleSaveFormation(req, supabase)` for testability; only calls `Deno.serve` when run as the entrypoint (`import.meta.main`), matching how Supabase actually invokes `index.ts` in production.
- **Create** `supabase/functions/save-formation/index.test.ts` — Deno tests against `handleSaveFormation` using a small hand-written fake Supabase client (no live DB).
- **Create** `supabase/functions/list-formations/index.ts` + **Create** `supabase/functions/list-formations/index.test.ts` — same `handle*` + fake-client pattern.
- **Create** `supabase/functions/delete-formation/logic.ts` (`isValidId`) + **Create** `supabase/functions/delete-formation/logic.test.ts`.
- **Create** `supabase/functions/delete-formation/index.ts` + **Create** `supabase/functions/delete-formation/index.test.ts` — the ownership-check test lives here (row belongs to a different `player_id` → `404 NOT_FOUND`).
- **Create** `web/js/mirrorFormation.js` — pure `mirrorPlacements(placements)`, same one-exported-constant-plus-comment style as `formationRowMap.js`.
- **Create** `web/js/mirrorFormation.test.js` — `node:test` unit tests (mirror correctness + double-mirror-returns-original), discovered automatically by the existing `npm test` (`node --test`) script.
- **Modify** `web/js/auth.js` — export the existing (currently unexported) `showModal` function so `setup.js` can open the login modal from the locked-panel link.
- **Modify** `web/setup.html` — add the "⇄ Mirror L/R" button next to Clear, the "My Formations" panel (locked state / slot buttons / Save button), and the save-as-name modal markup.
- **Modify** `web/js/setup.js` — wire the mirror button; add `loadMyFormations`, `renderMyFormationsPanel`, save-as-name flow (with slot-limit inline delete), per-slot delete, and the `placements` ⇄ `cells` conversion helpers.
- **Modify** `web/css/styles.css` — small set of new classes for the My Formations panel and slot delete icons, reusing existing `modal-overlay`/`modal-content`/`auth-modal-content`/`btn-secondary`/`link-btn` classes wherever possible.
- **Create** `playwright.config.js` + **Create** `e2e/private-formations.spec.js` — first Playwright test in this repo; add `@playwright/test` as a devDependency and a `test:e2e` script to `package.json`.

---

### Task 1: `player_formations` table + RLS

**Files:**
- Create: `supabase/migrations/0016_player_formations.sql`

**Interfaces:**
- Produces: table `player_formations(id uuid, player_id uuid, name text, cells jsonb, created_at timestamptz, updated_at timestamptz)`, unique on `(player_id, name)`. Every later task's Edge Functions read/write this table by name.

- [ ] **Step 1: Confirm 0016 is still free**

Run: `ls supabase/migrations/`
Expected: highest file is still `0015_scout_self_reveal.sql`. If a `0016_*.sql` already exists (e.g. landed from an unrelated in-flight change), rename this migration to the next free number and update every reference to `0016` in this plan before continuing.

- [ ] **Step 2: Write the migration**

```sql
-- supabase/migrations/0016_player_formations.sql
-- Private per-player saved setup formations (up to 5 per player, enforced
-- in the save-formation Edge Function, not here). The L/R mirror button is
-- a pure client-side transform and has no server-side storage.

create table player_formations (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references players(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  cells jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (player_id, name)
);

create index player_formations_player_id_idx on player_formations (player_id);

alter table player_formations enable row level security;
-- No client policies: same "server-side only" pattern as game_players/pieces
-- (see 0001_init.sql). All access goes through the JWT-authenticated
-- save-formation/list-formations/delete-formation Edge Functions, which use
-- the service role and bypass RLS.
```

- [ ] **Step 3: Apply locally and verify**

Run:
```bash
npx supabase start
npx supabase db reset
```
Expected: output includes `Applying migration 0016_player_formations.sql...` with no errors, ending in `Finished supabase db reset on branch ...`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0016_player_formations.sql
git commit -m "feat: add player_formations table for private saved formations"
```

---

### Task 2: `save-formation` pure decision logic

**Files:**
- Create: `supabase/functions/save-formation/logic.ts`
- Test: `supabase/functions/save-formation/logic.test.ts`

**Interfaces:**
- Produces: `SLOT_LIMIT: number`, `decideSaveAction(existing: {id: string; name: string}[], name: string, limit?: number): SaveDecision` where `SaveDecision = {action: "update", id: string} | {action: "insert"} | {action: "reject", existingNames: string[]}`; `isValidName(name: unknown): boolean`; `isValidCells(cells: unknown): boolean`. Task 3's `index.ts` imports all four.

- [ ] **Step 1: Write the failing tests**

```ts
// supabase/functions/save-formation/logic.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { decideSaveAction, isValidCells, isValidName, SLOT_LIMIT } from "./logic.ts";

Deno.test("decideSaveAction updates when a formation with the same name exists", () => {
  const existing = [
    { id: "a1", name: "Turtle" },
    { id: "a2", name: "Rush" },
  ];
  const decision = decideSaveAction(existing, "Rush", SLOT_LIMIT);
  assertEquals(decision, { action: "update", id: "a2" });
});

Deno.test("decideSaveAction inserts when under the slot limit and name is new", () => {
  const existing = [{ id: "a1", name: "Turtle" }];
  const decision = decideSaveAction(existing, "New Formation", SLOT_LIMIT);
  assertEquals(decision, { action: "insert" });
});

Deno.test("decideSaveAction rejects with existing names when at the slot limit", () => {
  const existing = [
    { id: "a1", name: "One" },
    { id: "a2", name: "Two" },
    { id: "a3", name: "Three" },
    { id: "a4", name: "Four" },
    { id: "a5", name: "Five" },
  ];
  const decision = decideSaveAction(existing, "Six", SLOT_LIMIT);
  assertEquals(decision, {
    action: "reject",
    existingNames: ["One", "Two", "Three", "Four", "Five"],
  });
});

Deno.test("isValidName rejects empty and overlong names", () => {
  assertEquals(isValidName(""), false);
  assertEquals(isValidName("a".repeat(41)), false);
  assertEquals(isValidName("a".repeat(40)), true);
  assertEquals(isValidName(123), false);
});

Deno.test("isValidCells rejects empty arrays and malformed rows", () => {
  assertEquals(isValidCells([]), false);
  assertEquals(isValidCells([[0, 0]]), false);
  assertEquals(isValidCells([[0, 0, "FLAG"]]), true);
  assertEquals(isValidCells("not-an-array"), false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `deno test supabase/functions/save-formation/logic.test.ts`
Expected: FAIL — `Module not found "./logic.ts"`.

- [ ] **Step 3: Write the implementation**

```ts
// supabase/functions/save-formation/logic.ts
//
// Pure decision logic for save-formation, extracted so it can be unit
// tested without a database. index.ts does all the actual Supabase I/O and
// calls into these functions for the business rules.

export const SLOT_LIMIT = 5;

export type SaveDecision =
  | { action: "update"; id: string }
  | { action: "insert" }
  | { action: "reject"; existingNames: string[] };

export function decideSaveAction(
  existing: Array<{ id: string; name: string }>,
  name: string,
  limit: number = SLOT_LIMIT,
): SaveDecision {
  const match = existing.find((row) => row.name === name);
  if (match) {
    return { action: "update", id: match.id };
  }
  if (existing.length >= limit) {
    return { action: "reject", existingNames: existing.map((row) => row.name) };
  }
  return { action: "insert" };
}

export function isValidName(name: unknown): name is string {
  return typeof name === "string" && name.length >= 1 && name.length <= 40;
}

export function isValidCells(cells: unknown): cells is Array<[number, number, string]> {
  if (!Array.isArray(cells) || cells.length === 0) return false;
  return cells.every(
    (cell) =>
      Array.isArray(cell) &&
      cell.length === 3 &&
      typeof cell[0] === "number" &&
      typeof cell[1] === "number" &&
      typeof cell[2] === "string",
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `deno test supabase/functions/save-formation/logic.test.ts`
Expected: `ok | 5 passed | 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/save-formation/logic.ts supabase/functions/save-formation/logic.test.ts
git commit -m "feat: add pure save-formation decision logic with tests"
```

---

### Task 3: `save-formation` Edge Function

**Files:**
- Create: `supabase/functions/save-formation/index.ts`
- Test: `supabase/functions/save-formation/index.test.ts`

**Interfaces:**
- Consumes: `decideSaveAction`, `isValidName`, `isValidCells`, `SLOT_LIMIT` from Task 2; `verifyToken` from `_shared/auth.ts`; `corsHeaders` from `_shared/cors.ts`.
- Produces: exported `handleSaveFormation(req: Request, supabase): Promise<Response>`. Body in: `{ authToken?, name?, cells? }`. Body out on success: `{ ok: true, id: string, name: string }`. Body out on slot-limit: `{ error: "SLOT_LIMIT_REACHED", existingNames: string[] }`, status 409.

- [ ] **Step 1: Write the failing tests**

```ts
// supabase/functions/save-formation/index.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createToken } from "../_shared/auth.ts";
import { handleSaveFormation } from "./index.ts";

// Hand-written fake covering only the exact call shapes index.ts uses --
// simpler and lower-risk than mimicking the full supabase-js chain builder.
function fakeSupabase(existingRows: Array<{ id: string; name: string; player_id: string }>) {
  const updated: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const inserted: Array<Record<string, unknown>> = [];

  return {
    from(_table: string) {
      return {
        select(_columns: string) {
          return {
            eq(_column: string, value: string) {
              const rows = existingRows.filter((row) => row.player_id === value);
              return Promise.resolve({ data: rows, error: null });
            },
          };
        },
        update(patch: Record<string, unknown>) {
          return {
            eq(_column: string, value: string) {
              updated.push({ id: value, patch });
              return Promise.resolve({ error: null });
            },
          };
        },
        insert(row: Record<string, unknown>) {
          inserted.push(row);
          return {
            select(_columns: string) {
              return {
                single() {
                  return Promise.resolve({ data: { id: "new-id" }, error: null });
                },
              };
            },
          };
        },
      };
    },
    _updated: updated,
    _inserted: inserted,
  };
}

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/save-formation", { method: "POST", body: JSON.stringify(body) });
}

Deno.test("handleSaveFormation rejects requests with no authToken", async () => {
  const res = await handleSaveFormation(jsonRequest({ name: "Turtle", cells: [[0, 0, "FLAG"]] }), fakeSupabase([]));
  assertEquals(res.status, 401);
});

Deno.test("handleSaveFormation inserts a new formation when under the slot limit", async () => {
  const token = await createToken("player-1", "alice");
  const supabase = fakeSupabase([]);
  const res = await handleSaveFormation(
    jsonRequest({ authToken: token, name: "Turtle", cells: [[0, 0, "FLAG"]] }),
    supabase,
  );
  const body = await res.json();
  assertEquals(res.status, 200);
  assertEquals(body.ok, true);
  assertEquals(supabase._inserted.length, 1);
  assertEquals(supabase._inserted[0].player_id, "player-1");
});

Deno.test("handleSaveFormation overwrites the existing row when the name matches", async () => {
  const token = await createToken("player-1", "alice");
  const supabase = fakeSupabase([{ id: "row-1", name: "Turtle", player_id: "player-1" }]);
  const res = await handleSaveFormation(
    jsonRequest({ authToken: token, name: "Turtle", cells: [[0, 0, "BOMB"]] }),
    supabase,
  );
  const body = await res.json();
  assertEquals(res.status, 200);
  assertEquals(body.id, "row-1");
  assertEquals(supabase._updated.length, 1);
  assertEquals(supabase._updated[0].id, "row-1");
  assertEquals(supabase._inserted.length, 0);
});

Deno.test("handleSaveFormation rejects with 409 and existing names at the slot limit", async () => {
  const token = await createToken("player-1", "alice");
  const existing = ["One", "Two", "Three", "Four", "Five"].map((name, i) => ({
    id: `row-${i}`,
    name,
    player_id: "player-1",
  }));
  const supabase = fakeSupabase(existing);
  const res = await handleSaveFormation(
    jsonRequest({ authToken: token, name: "Six", cells: [[0, 0, "FLAG"]] }),
    supabase,
  );
  const body = await res.json();
  assertEquals(res.status, 409);
  assertEquals(body.error, "SLOT_LIMIT_REACHED");
  assertEquals(body.existingNames, ["One", "Two", "Three", "Four", "Five"]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `deno test --allow-env supabase/functions/save-formation/index.test.ts`
Expected: FAIL — `Module not found "./index.ts"`.

- [ ] **Step 3: Write the implementation**

```ts
// supabase/functions/save-formation/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { verifyToken } from "../_shared/auth.ts";
import { decideSaveAction, isValidCells, isValidName, SLOT_LIMIT } from "./logic.ts";

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// deno-lint-ignore no-explicit-any
export async function handleSaveFormation(req: Request, supabase: any): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "METHOD_NOT_ALLOWED" }, 405);
  }

  let body: { authToken?: string; name?: string; cells?: unknown };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "MISSING_FIELDS" }, 400);
  }

  const { authToken, name, cells } = body;

  if (!authToken) {
    return jsonResponse({ error: "UNAUTHORIZED" }, 401);
  }

  const session = await verifyToken(authToken);
  if (!session) {
    return jsonResponse({ error: "UNAUTHORIZED" }, 401);
  }

  if (!isValidName(name)) {
    return jsonResponse({ error: "INVALID_NAME" }, 400);
  }

  if (!isValidCells(cells)) {
    return jsonResponse({ error: "INVALID_CELLS" }, 400);
  }

  const { data: existing, error: listError } = await supabase
    .from("player_formations")
    .select("id, name")
    .eq("player_id", session.player_id);

  if (listError) {
    return jsonResponse({ error: "SAVE_FAILED", detail: listError.message }, 500);
  }

  const decision = decideSaveAction(existing ?? [], name, SLOT_LIMIT);

  if (decision.action === "reject") {
    return jsonResponse({ error: "SLOT_LIMIT_REACHED", existingNames: decision.existingNames }, 409);
  }

  if (decision.action === "update") {
    const { error: updateError } = await supabase
      .from("player_formations")
      .update({ cells, updated_at: new Date().toISOString() })
      .eq("id", decision.id);

    if (updateError) {
      return jsonResponse({ error: "SAVE_FAILED", detail: updateError.message }, 500);
    }

    return jsonResponse({ ok: true, id: decision.id, name });
  }

  const { data: inserted, error: insertError } = await supabase
    .from("player_formations")
    .insert({ player_id: session.player_id, name, cells })
    .select("id")
    .single();

  if (insertError || !inserted) {
    return jsonResponse({ error: "SAVE_FAILED", detail: insertError?.message }, 500);
  }

  return jsonResponse({ ok: true, id: inserted.id, name });
}

if (import.meta.main) {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  Deno.serve((req) => handleSaveFormation(req, supabase));
}
```

`import.meta.main` is `true` only when Deno runs this file directly as the entry script (which is how Supabase invokes a deployed function's `index.ts`), and `false` when another module `import`s it — so importing `handleSaveFormation` from the test file never starts an HTTP listener.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `deno test --allow-env supabase/functions/save-formation/index.test.ts`
Expected: `ok | 4 passed | 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/save-formation/index.ts supabase/functions/save-formation/index.test.ts
git commit -m "feat: add save-formation Edge Function"
```

---

### Task 4: `list-formations` Edge Function

**Files:**
- Create: `supabase/functions/list-formations/index.ts`
- Test: `supabase/functions/list-formations/index.test.ts`

**Interfaces:**
- Consumes: `verifyToken` from `_shared/auth.ts`, `corsHeaders` from `_shared/cors.ts`.
- Produces: exported `handleListFormations(req, supabase): Promise<Response>`. Body in: `{ authToken? }`. Body out: `{ formations: Array<{id, name, cells, updated_at}> }`, ordered `updated_at desc`. Task 9 (`setup.js`) consumes this shape directly.

- [ ] **Step 1: Write the failing tests**

```ts
// supabase/functions/list-formations/index.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createToken } from "../_shared/auth.ts";
import { handleListFormations } from "./index.ts";

function fakeSupabase(
  rows: Array<{ id: string; name: string; cells: unknown; updated_at: string; player_id: string }>,
) {
  return {
    from(_table: string) {
      return {
        select(_columns: string) {
          return {
            eq(_column: string, value: string) {
              return {
                order(_column2: string, opts: { ascending: boolean }) {
                  const filtered = rows.filter((row) => row.player_id === value);
                  const sorted = [...filtered].sort((a, b) =>
                    opts.ascending
                      ? a.updated_at.localeCompare(b.updated_at)
                      : b.updated_at.localeCompare(a.updated_at),
                  );
                  return Promise.resolve({ data: sorted, error: null });
                },
              };
            },
          };
        },
      };
    },
  };
}

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/list-formations", { method: "POST", body: JSON.stringify(body) });
}

Deno.test("handleListFormations returns only the caller's own formations, newest first", async () => {
  const token = await createToken("player-1", "alice");
  const supabase = fakeSupabase([
    { id: "a", name: "Old", cells: [], updated_at: "2026-01-01T00:00:00Z", player_id: "player-1" },
    { id: "b", name: "New", cells: [], updated_at: "2026-02-01T00:00:00Z", player_id: "player-1" },
    { id: "c", name: "Other Player's", cells: [], updated_at: "2026-03-01T00:00:00Z", player_id: "player-2" },
  ]);

  const res = await handleListFormations(jsonRequest({ authToken: token }), supabase);
  const body = await res.json();

  assertEquals(res.status, 200);
  assertEquals(body.formations.map((f: { name: string }) => f.name), ["New", "Old"]);
});

Deno.test("handleListFormations rejects requests with no authToken", async () => {
  const res = await handleListFormations(jsonRequest({}), fakeSupabase([]));
  assertEquals(res.status, 401);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `deno test --allow-env supabase/functions/list-formations/index.test.ts`
Expected: FAIL — `Module not found "./index.ts"`.

- [ ] **Step 3: Write the implementation**

```ts
// supabase/functions/list-formations/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { verifyToken } from "../_shared/auth.ts";

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// deno-lint-ignore no-explicit-any
export async function handleListFormations(req: Request, supabase: any): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "METHOD_NOT_ALLOWED" }, 405);
  }

  let body: { authToken?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "MISSING_FIELDS" }, 400);
  }

  if (!body.authToken) {
    return jsonResponse({ error: "UNAUTHORIZED" }, 401);
  }

  const session = await verifyToken(body.authToken);
  if (!session) {
    return jsonResponse({ error: "UNAUTHORIZED" }, 401);
  }

  const { data, error } = await supabase
    .from("player_formations")
    .select("id, name, cells, updated_at")
    .eq("player_id", session.player_id)
    .order("updated_at", { ascending: false });

  if (error) {
    return jsonResponse({ error: "LIST_FAILED", detail: error.message }, 500);
  }

  return jsonResponse({ formations: data ?? [] });
}

if (import.meta.main) {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  Deno.serve((req) => handleListFormations(req, supabase));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `deno test --allow-env supabase/functions/list-formations/index.test.ts`
Expected: `ok | 2 passed | 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/list-formations/index.ts supabase/functions/list-formations/index.test.ts
git commit -m "feat: add list-formations Edge Function"
```

---

### Task 5: `delete-formation` Edge Function (ownership check)

**Files:**
- Create: `supabase/functions/delete-formation/logic.ts`
- Test: `supabase/functions/delete-formation/logic.test.ts`
- Create: `supabase/functions/delete-formation/index.ts`
- Test: `supabase/functions/delete-formation/index.test.ts`

**Interfaces:**
- Produces: `isValidId(id: unknown): boolean`; exported `handleDeleteFormation(req, supabase): Promise<Response>`. Body in: `{ authToken?, id? }`. Body out: `{ ok: true }` on success, `{ error: "NOT_FOUND" }` (404) if the row doesn't exist or belongs to another player.

- [ ] **Step 1: Write the failing logic test**

```ts
// supabase/functions/delete-formation/logic.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isValidId } from "./logic.ts";

Deno.test("isValidId accepts non-empty strings and rejects everything else", () => {
  assertEquals(isValidId("abc-123"), true);
  assertEquals(isValidId(""), false);
  assertEquals(isValidId(undefined), false);
  assertEquals(isValidId(42), false);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `deno test supabase/functions/delete-formation/logic.test.ts`
Expected: FAIL — `Module not found "./logic.ts"`.

- [ ] **Step 3: Write `logic.ts`**

```ts
// supabase/functions/delete-formation/logic.ts
export function isValidId(id: unknown): id is string {
  return typeof id === "string" && id.length > 0;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `deno test supabase/functions/delete-formation/logic.test.ts`
Expected: `ok | 1 passed | 0 failed`.

- [ ] **Step 5: Write the failing handler tests (this is the ownership check)**

```ts
// supabase/functions/delete-formation/index.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createToken } from "../_shared/auth.ts";
import { handleDeleteFormation } from "./index.ts";

// Fake requires BOTH the id filter AND the player_id filter to match --
// this is what makes the "can't delete another player's formation" test
// below a genuine ownership check, not just a schema check.
function fakeSupabase(rows: Array<{ id: string; player_id: string }>) {
  return {
    from(_table: string) {
      return {
        delete() {
          return {
            eq(column1: string, value1: string) {
              return {
                eq(column2: string, value2: string) {
                  return {
                    select(_columns: string) {
                      const matched = rows.filter(
                        (row) =>
                          (row as Record<string, string>)[column1] === value1 &&
                          (row as Record<string, string>)[column2] === value2,
                      );
                      return Promise.resolve({ data: matched, error: null });
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  };
}

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/delete-formation", { method: "POST", body: JSON.stringify(body) });
}

Deno.test("handleDeleteFormation deletes a formation the caller owns", async () => {
  const token = await createToken("player-1", "alice");
  const supabase = fakeSupabase([{ id: "row-1", player_id: "player-1" }]);
  const res = await handleDeleteFormation(jsonRequest({ authToken: token, id: "row-1" }), supabase);
  const body = await res.json();
  assertEquals(res.status, 200);
  assertEquals(body.ok, true);
});

Deno.test("handleDeleteFormation returns NOT_FOUND when the formation belongs to another player", async () => {
  const token = await createToken("player-1", "alice");
  const supabase = fakeSupabase([{ id: "row-1", player_id: "player-2" }]);
  const res = await handleDeleteFormation(jsonRequest({ authToken: token, id: "row-1" }), supabase);
  const body = await res.json();
  assertEquals(res.status, 404);
  assertEquals(body.error, "NOT_FOUND");
});

Deno.test("handleDeleteFormation rejects requests with no authToken", async () => {
  const res = await handleDeleteFormation(jsonRequest({ id: "row-1" }), fakeSupabase([]));
  assertEquals(res.status, 401);
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `deno test --allow-env supabase/functions/delete-formation/index.test.ts`
Expected: FAIL — `Module not found "./index.ts"`.

- [ ] **Step 7: Write `index.ts`**

```ts
// supabase/functions/delete-formation/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { verifyToken } from "../_shared/auth.ts";
import { isValidId } from "./logic.ts";

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// deno-lint-ignore no-explicit-any
export async function handleDeleteFormation(req: Request, supabase: any): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "METHOD_NOT_ALLOWED" }, 405);
  }

  let body: { authToken?: string; id?: unknown };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "MISSING_FIELDS" }, 400);
  }

  if (!body.authToken) {
    return jsonResponse({ error: "UNAUTHORIZED" }, 401);
  }

  const session = await verifyToken(body.authToken);
  if (!session) {
    return jsonResponse({ error: "UNAUTHORIZED" }, 401);
  }

  if (!isValidId(body.id)) {
    return jsonResponse({ error: "INVALID_ID" }, 400);
  }

  const { data: deleted, error } = await supabase
    .from("player_formations")
    .delete()
    .eq("id", body.id)
    .eq("player_id", session.player_id)
    .select("id");

  if (error) {
    return jsonResponse({ error: "DELETE_FAILED", detail: error.message }, 500);
  }

  if (!deleted || deleted.length === 0) {
    return jsonResponse({ error: "NOT_FOUND" }, 404);
  }

  return jsonResponse({ ok: true });
}

if (import.meta.main) {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  Deno.serve((req) => handleDeleteFormation(req, supabase));
}
```

- [ ] **Step 8: Run it to verify it passes**

Run: `deno test --allow-env supabase/functions/delete-formation/index.test.ts`
Expected: `ok | 3 passed | 0 failed`.

- [ ] **Step 9: Commit**

```bash
git add supabase/functions/delete-formation/
git commit -m "feat: add delete-formation Edge Function with ownership check"
```

---

### Task 6: Pure L/R mirror transform

**Files:**
- Create: `web/js/mirrorFormation.js`
- Test: `web/js/mirrorFormation.test.js`

**Interfaces:**
- Produces: `mirrorPlacements(placements: Map<string, string>): Map<string, string>`. Task 9 (`setup.js`) imports this directly for the "⇄ Mirror L/R" button.

- [ ] **Step 1: Write the failing test**

```js
// web/js/mirrorFormation.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mirrorPlacements } from "./mirrorFormation.js";

test("mirrors columns across the vertical centerline, keeps rows and ranks", () => {
  const placements = new Map([
    ["0,0", "FLAG"],
    ["1,3", "BOMB"],
    ["3,9", "5"],
  ]);

  const mirrored = mirrorPlacements(placements);

  assert.equal(mirrored.get("0,9"), "FLAG");
  assert.equal(mirrored.get("1,6"), "BOMB");
  assert.equal(mirrored.get("3,0"), "5");
  assert.equal(mirrored.size, 3);
});

test("mirroring twice returns the original placements", () => {
  const placements = new Map([
    ["0,0", "FLAG"],
    ["2,4", "BOMB"],
    ["3,9", "10"],
  ]);

  const twiceMirrored = mirrorPlacements(mirrorPlacements(placements));

  assert.deepEqual(
    [...twiceMirrored.entries()].sort(),
    [...placements.entries()].sort(),
  );
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test web/js/mirrorFormation.test.js`
Expected: FAIL — `Cannot find module './mirrorFormation.js'`.

- [ ] **Step 3: Write the implementation**

```js
// web/js/mirrorFormation.js
//
// Pure left-right reflection of the player's own 4x10 setup zone. Only the
// column is reflected (col -> 9 - col); rows and ranks are untouched. This
// operates purely on setup.js's in-memory `placements` Map ("row,col" ->
// rank) -- no server round-trip, no dependency on how the grid was
// populated (manual clicks, a public preset, or a loaded private
// formation).
export function mirrorPlacements(placements) {
  const mirrored = new Map();
  for (const [key, rank] of placements) {
    const [row, col] = key.split(",").map(Number);
    mirrored.set(`${row},${9 - col}`, rank);
  }
  return mirrored;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test web/js/mirrorFormation.test.js`
Expected: `# pass 2`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add web/js/mirrorFormation.js web/js/mirrorFormation.test.js
git commit -m "feat: add pure mirrorPlacements transform with tests"
```

---

### Task 7: Export `showModal` from `auth.js`

**Files:**
- Modify: `web/js/auth.js:45`

**Interfaces:**
- Produces: `showModal(type: "login" | "signup"): void` (previously module-private). Task 9 imports this to open the login modal from the "My Formations" locked-panel link.

- [ ] **Step 1: Make the change**

In `web/js/auth.js`, change:

```js
function showModal(type) {
```

to:

```js
export function showModal(type) {
```

No other lines in the file change — `showModal` is already fully self-contained (it builds and wires its own modal markup), so exporting it has no other side effects.

- [ ] **Step 2: Verify nothing else broke**

Run: `node --test` (repo root)
Expected: same pass count as before this change (this is a pure export addition — no existing behavior changes).

- [ ] **Step 3: Commit**

```bash
git add web/js/auth.js
git commit -m "feat: export showModal from auth.js for reuse outside the nav"
```

---

### Task 8: `setup.html` markup — mirror button + My Formations panel

**Files:**
- Modify: `web/setup.html:32-49`

**Interfaces:**
- Produces DOM ids Task 9 wires up: `#mirror-btn`, `#my-formations-locked`, `#my-formations-login-link`, `#my-formations-slots`, `#save-formation-btn`, `#save-formation-name-panel`, `#save-formation-form`, `#save-formation-name-input`, `#save-formation-error`, `#save-formation-limit-list`, `#save-formation-cancel-btn`.

- [ ] **Step 1: Add the mirror button next to Clear**

In `web/setup.html`, change:

```html
          <div class="setup-controls">
            <button data-formation="random">Random</button>
            <button data-formation="defensive">Defensive</button>
            <button data-formation="aggressive">Aggressive</button>
            <button id="clear-btn">Clear</button>
          </div>
```

to:

```html
          <div class="setup-controls">
            <button data-formation="random">Random</button>
            <button data-formation="defensive">Defensive</button>
            <button data-formation="aggressive">Aggressive</button>
            <button id="clear-btn">Clear</button>
            <button id="mirror-btn">⇄ Mirror L/R</button>
          </div>
```

- [ ] **Step 2: Add the My Formations panel and the save-as-name modal**

Immediately after the block from Step 1 (still before `<div id="difficulty-controls" ...>`), add:

```html
          <div id="my-formations-controls" class="setup-controls my-formations-controls">
            <span class="difficulty-label">My Formations:</span>
            <span id="my-formations-locked" class="my-formations-locked" hidden>
              🔒 <button id="my-formations-login-link" class="link-btn" type="button">Log in to save your own formations</button>
            </span>
            <span id="my-formations-slots" class="my-formations-slots"></span>
            <button id="save-formation-btn" class="btn-secondary" hidden type="button">Save current as…</button>
          </div>

          <div id="save-formation-name-panel" class="modal-overlay" hidden>
            <div class="modal-content auth-modal-content">
              <h3>Save formation</h3>
              <form id="save-formation-form">
                <input id="save-formation-name-input" type="text" placeholder="Formation name" maxlength="40" required />
                <p id="save-formation-error" class="error" hidden></p>
                <div id="save-formation-limit-list" class="my-formations-limit-list" hidden></div>
                <button type="submit" class="btn-primary">Save</button>
              </form>
              <button id="save-formation-cancel-btn" class="modal-close" type="button">&times;</button>
            </div>
          </div>
```

- [ ] **Step 3: Verify the page still loads**

Open `web/setup.html` (via `npx http-server web -p 8080` and a browser, or a quick `node -e` HTML-parse sanity check) and confirm no console errors from unclosed tags. There is no automated test for this step — it is pure markup with no behavior yet (Task 9 wires the behavior and is where real verification happens).

- [ ] **Step 4: Commit**

```bash
git add web/setup.html
git commit -m "feat: add mirror button and My Formations markup to setup.html"
```

---

### Task 9: `setup.js` — wire mirror button + My Formations flows

**Files:**
- Modify: `web/js/setup.js`

**Interfaces:**
- Consumes: `mirrorPlacements` (Task 6), `showModal`/`isLoggedIn` (Task 7 + existing `auth.js`), the `#mirror-btn`/`#my-formations-*`/`#save-formation-*` ids (Task 8), `list-formations`/`save-formation`/`delete-formation` (Tasks 3-5) via the existing `callFunction` helper (which already auto-attaches `authToken` from `getAuthToken()` on every call — see `web/js/supabaseClient.js:12-15`).
- Produces: no new exports (this is the top-level page script), but establishes `placementsToCells`/`cellsToPlacements` as the canonical local ⇄ `cells` conversion, matching the shape `applyFormation` already reads from `formations.js`.

There is no unit test for this task: `setup.js` is a top-level page script with DOM side effects and no exports, matching how `applyFormation`/`renderGrid` are already untested in this codebase. It is covered by Task 11's Playwright end-to-end test instead.

- [ ] **Step 1: Update imports**

In `web/js/setup.js`, change:

```js
import { supabase, callFunction } from "./supabaseClient.js";
import { renderNavAuth } from "./auth.js";
```

to:

```js
import { supabase, callFunction } from "./supabaseClient.js";
import { renderNavAuth, isLoggedIn, showModal } from "./auth.js";
import { mirrorPlacements } from "./mirrorFormation.js";
```

- [ ] **Step 2: Add placements ⇄ cells conversion helpers and My Formations state**

Immediately after the existing line `let formationIndex = { defensive: -1, aggressive: -1 };`, add:

```js
let myFormations = [];

function placementsToCells(map) {
  return Array.from(map.entries()).map(([key, rank]) => {
    const [row, col] = key.split(",").map(Number);
    return [row, col, rank];
  });
}

function cellsToPlacements(cells) {
  const map = new Map();
  for (const [row, col, rank] of cells) {
    map.set(`${row},${col}`, rank);
  }
  return map;
}
```

- [ ] **Step 3: Add the mirror button handler**

Immediately after the existing `document.getElementById("clear-btn").addEventListener(...)` block, add:

```js
document.getElementById("mirror-btn").addEventListener("click", () => {
  placements = mirrorPlacements(placements);
  renderGrid();
  renderTray();
  updateSubmitButton();
});
```

- [ ] **Step 4: Add the My Formations rendering + load functions**

Add these new top-level functions (a good spot is right after `updateFormationLabel`):

```js
function renderMyFormationsPanel() {
  const lockedEl = document.getElementById("my-formations-locked");
  const slotsEl = document.getElementById("my-formations-slots");
  const saveBtn = document.getElementById("save-formation-btn");

  if (!isLoggedIn()) {
    lockedEl.hidden = false;
    slotsEl.innerHTML = "";
    saveBtn.hidden = true;
    return;
  }

  lockedEl.hidden = true;
  saveBtn.hidden = false;
  slotsEl.innerHTML = "";

  for (const formation of myFormations) {
    const wrapper = document.createElement("span");
    wrapper.className = "my-formation-slot";

    const loadBtn = document.createElement("button");
    loadBtn.type = "button";
    loadBtn.textContent = formation.name;
    loadBtn.addEventListener("click", () => loadMyFormation(formation));

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "slot-delete-btn";
    deleteBtn.textContent = "🗑";
    deleteBtn.title = `Delete "${formation.name}"`;
    deleteBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteMyFormation(formation.id);
    });

    wrapper.appendChild(loadBtn);
    wrapper.appendChild(deleteBtn);
    slotsEl.appendChild(wrapper);
  }
}

async function loadMyFormations() {
  if (!isLoggedIn()) {
    renderMyFormationsPanel();
    return;
  }
  try {
    const result = await callFunction("list-formations", {});
    myFormations = result.formations;
  } catch {
    myFormations = [];
  }
  renderMyFormationsPanel();
}

function loadMyFormation(formation) {
  placements = cellsToPlacements(formation.cells);
  updateFormationLabel(formation.name);
  renderGrid();
  renderTray();
  updateSubmitButton();
}

async function deleteMyFormation(id) {
  try {
    await callFunction("delete-formation", { id });
    await loadMyFormations();
  } catch (err) {
    const errorEl = document.getElementById("save-formation-error");
    errorEl.textContent = `Delete failed: ${err.message}`;
    errorEl.hidden = false;
  }
}

function renderSlotLimitDeleteList() {
  const container = document.getElementById("save-formation-limit-list");
  container.innerHTML = "";
  for (const formation of myFormations) {
    const row = document.createElement("div");
    row.className = "my-formations-limit-row";

    const label = document.createElement("span");
    label.textContent = formation.name;

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "slot-delete-btn";
    deleteBtn.textContent = "🗑";
    deleteBtn.addEventListener("click", async () => {
      await deleteMyFormation(formation.id);
      renderSlotLimitDeleteList();
    });

    row.appendChild(label);
    row.appendChild(deleteBtn);
    container.appendChild(row);
  }
}
```

Note: `save-formation`'s `409 SLOT_LIMIT_REACHED` response body includes `existingNames`, but the existing `callFunction` helper (`web/js/supabaseClient.js:16-27`) only surfaces `errorBody.error` as the thrown `Error`'s message — it discards other fields. `renderSlotLimitDeleteList` therefore reads from the already-loaded `myFormations` array (populated by `loadMyFormations` on page load) rather than parsing `existingNames` off the error, which is simpler and avoids touching the shared `callFunction` helper for one caller.

- [ ] **Step 5: Add the login-link, save button, and save-form handlers**

Add:

```js
document.getElementById("my-formations-login-link").addEventListener("click", () => showModal("login"));

document.getElementById("save-formation-btn").addEventListener("click", () => {
  document.getElementById("save-formation-name-input").value = "";
  document.getElementById("save-formation-error").hidden = true;
  document.getElementById("save-formation-limit-list").hidden = true;
  document.getElementById("save-formation-name-panel").hidden = false;
});

document.getElementById("save-formation-cancel-btn").addEventListener("click", () => {
  document.getElementById("save-formation-name-panel").hidden = true;
});

document.getElementById("save-formation-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = document.getElementById("save-formation-name-input").value.trim();
  const errorEl = document.getElementById("save-formation-error");
  const limitListEl = document.getElementById("save-formation-limit-list");
  errorEl.hidden = true;
  limitListEl.hidden = true;

  if (!name) {
    errorEl.textContent = "Enter a name for this formation.";
    errorEl.hidden = false;
    return;
  }

  try {
    const cells = placementsToCells(placements);
    await callFunction("save-formation", { name, cells });
    document.getElementById("save-formation-name-panel").hidden = true;
    await loadMyFormations();
  } catch (err) {
    if (err.message === "SLOT_LIMIT_REACHED") {
      errorEl.textContent = "You already have 5 saved formations. Delete one to save a new one:";
      errorEl.hidden = false;
      renderSlotLimitDeleteList();
      limitListEl.hidden = false;
    } else {
      errorEl.textContent = `Save failed: ${err.message}`;
      errorEl.hidden = false;
    }
  }
});
```

- [ ] **Step 6: Load My Formations on page init**

At the bottom of the file, change:

```js
renderGrid();
renderTray();
updateSubmitButton();
```

to:

```js
renderGrid();
renderTray();
updateSubmitButton();
loadMyFormations();
```

Note on the design's "no page reload needed" claim: the actual `auth.js` login flow (`handleAuthSubmit`, `web/js/auth.js:96-98`) calls `location.reload()` on a successful login, not an in-place DOM swap. That reload already re-runs this whole module from scratch, so `loadMyFormations()` at the bottom naturally re-fires with `isLoggedIn()` now `true` — no extra reactivity code is needed here; this plan relies on the real (reload-based) behavior rather than the design doc's slightly optimistic framing.

- [ ] **Step 7: Manual verification**

Run: `npx http-server web -p 8080`, then in a browser create a game (or "Play vs Bot" from the home page) to reach `setup.html`. Confirm:
- Logged out: "My Formations" shows the lock icon + login link; clicking it opens the existing login modal; Defensive/Aggressive/Random/Clear/Mirror all still work.
- Logged in (sign up or log in via the nav): the lock disappears, "Save current as…" appears, saving with a name adds a slot button, clicking a slot button loads that formation onto the grid, the trash icon deletes it.
- Mirror: place a few pieces, click "⇄ Mirror L/R" twice, confirm the grid returns to the original layout.

- [ ] **Step 8: Commit**

```bash
git add web/js/setup.js
git commit -m "feat: wire mirror button and My Formations panel into setup.js"
```

---

### Task 10: `styles.css` — My Formations panel styling

**Files:**
- Modify: `web/css/styles.css`

**Interfaces:**
- Produces CSS classes consumed by Task 8's markup: `.my-formations-controls`, `.my-formations-locked`, `.my-formation-slot`, `.slot-delete-btn`, `.my-formations-limit-list`, `.my-formations-limit-row`.

- [ ] **Step 1: Add the new rules**

Append after the existing `.difficulty-btn.selected { ... }` block (around line 350):

```css
.my-formations-controls {
  align-items: center;
}

.my-formations-locked {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.85rem;
  color: var(--wood-light);
}

.my-formations-slots {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.my-formation-slot {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}

.slot-delete-btn {
  background: none;
  border: none;
  color: #ffb3b3;
  cursor: pointer;
  font-size: 0.9rem;
  padding: 0 0.25rem;
}

.slot-delete-btn:hover {
  color: var(--danger);
}

.my-formations-limit-list {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  margin: 0.5rem 0;
}

.my-formations-limit-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  font-size: 0.85rem;
}
```

- [ ] **Step 2: Verify visually**

Reload `setup.html` in a browser (per Task 9 Step 7's server) and confirm the My Formations row, lock icon, slot buttons, delete icons, and the save-as-name modal all render without overlapping or unstyled elements.

- [ ] **Step 3: Commit**

```bash
git add web/css/styles.css
git commit -m "feat: style the My Formations panel"
```

---

### Task 11: Playwright end-to-end test

**Files:**
- Create: `playwright.config.js`
- Create: `e2e/private-formations.spec.js`
- Modify: `package.json` (add `@playwright/test` devDependency + `test:e2e` script)

**Interfaces:**
- Consumes: the full stack from Tasks 1-10 (real Edge Functions, real `setup.html`/`setup.js`), plus the existing `#play-bot-btn` flow in `web/js/home.js:69-88` to reach `setup.html` with a valid room token without any manual room-code exchange.

This is the **first** Playwright test in this repo — there is no prior convention to match, so this task also establishes one (config + `e2e/` directory + npm script).

- [ ] **Step 1: Install Playwright**

Run:
```bash
npm install --save-dev @playwright/test
npx playwright install --with-deps chromium
```
Expected: `@playwright/test` appears in `package.json` devDependencies with whatever version npm resolves as latest (do not hand-edit a version number in).

- [ ] **Step 2: Add the `test:e2e` script**

In `package.json`, change:

```json
  "scripts": {
    "test": "node --test"
  },
```

to:

```json
  "scripts": {
    "test": "node --test",
    "test:e2e": "playwright test"
  },
```

- [ ] **Step 3: Add the Playwright config**

```js
// playwright.config.js
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  use: {
    baseURL: "http://localhost:8080",
  },
  webServer: {
    command: "npx http-server web -p 8080",
    url: "http://localhost:8080",
    reuseExistingServer: true,
    timeout: 20_000,
  },
});
```

- [ ] **Step 4: Write the spec**

```js
// e2e/private-formations.spec.js
//
// NOTE: web/js/supabaseClient.js currently hardcodes the production
// Supabase project URL/anon key. This test signs up a throwaway player
// account (a randomized, timestamped username) against whatever project
// that file points to. Before running this in CI, point supabaseClient.js
// at a local `supabase start` instance (see README.md) so test runs don't
// write rows into the production `players` table.
import { test, expect } from "@playwright/test";

const SUPABASE_URL = "https://cafqbrzaxcwewwtyqpnf.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_mxrVhbM1gbEixsbuhyn6sw_eL7r6dRX";

async function signUpTestPlayer(request) {
  const username = `pwtest${Date.now()}`;
  const res = await request.post(`${SUPABASE_URL}/functions/v1/signup`, {
    headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}`, apikey: SUPABASE_ANON_KEY },
    data: { username, password: "test-password-123" },
  });
  const body = await res.json();
  return { username, token: body.token };
}

async function loginAs(page, username, token) {
  await page.goto("/index.html");
  await page.evaluate(
    ([t, u]) => {
      localStorage.setItem("stratego:authToken", t);
      localStorage.setItem("stratego:username", u);
    },
    [token, username],
  );
  await page.reload();
}

test("logged-in player saves a formation, reloads, and loads it back", async ({ page, request }) => {
  const { username, token } = await signUpTestPlayer(request);
  await loginAs(page, username, token);

  await page.click("#play-bot-btn");
  await page.waitForURL(/setup\.html/);
  await expect(page.locator("#my-formations-locked")).toBeHidden();

  await page.click('[data-formation="defensive"]');
  await page.click("#save-formation-btn");
  await page.fill("#save-formation-name-input", "E2E Formation");
  await page.click("#save-formation-form button[type=submit]");
  await expect(page.locator("#my-formations-slots")).toContainText("E2E Formation");

  await page.reload();
  await expect(page.locator("#my-formations-slots")).toContainText("E2E Formation");
  await page.click("text=E2E Formation");
  expect(await page.locator(".territory-cell.occupied").count()).toBe(40);

  await page.getByTitle('Delete "E2E Formation"').click();
  await expect(page.locator("#my-formations-slots")).not.toContainText("E2E Formation");
});

test("anonymous player sees the locked panel and public presets still work", async ({ page }) => {
  await page.goto("/index.html");
  await page.click("#play-bot-btn");
  await page.waitForURL(/setup\.html/);
  await expect(page.locator("#my-formations-locked")).toBeVisible();

  await page.click('[data-formation="defensive"]');
  expect(await page.locator(".territory-cell.occupied").count()).toBe(40);
});
```

- [ ] **Step 5: Run it**

Run: `npm run test:e2e`
Expected: both tests pass. (Requires whatever Supabase project `web/js/supabaseClient.js` points at to be reachable and to have all of Tasks 1-5's migration/functions deployed to it — local `supabase start` + `supabase functions serve` if pointed locally, or the deployed production project after `supabase db push` + `supabase functions deploy` if pointed at production.)

- [ ] **Step 6: Commit**

```bash
git add playwright.config.js e2e/private-formations.spec.js package.json package-lock.json
git commit -m "test: add Playwright end-to-end test for private formations"
```

---

## Self-Review

**1. Spec coverage:**

- `player_formations` table + RLS (server-side only) → Task 1. ✅
- `save-formation` overwrite-by-name, 5-slot rejection with existing names → Tasks 2-3. ✅
- `list-formations` (caller's own, `updated_at desc`) → Task 4. ✅
- `delete-formation` ownership check → Task 5. ✅
- "My Formations" panel: locked state for anonymous, named slot buttons, save-as-name flow, per-slot delete, slot-limit-reached inline delete flow → Task 9 (`renderMyFormationsPanel`, save form handler, `renderSlotLimitDeleteList`). ✅
- Standalone L/R mirror button as a pure client-side transform, extractable pure-function unit test (correctness + double-mirror-returns-original) → Task 6. ✅
- Mirror button wired into the UI → Task 9 Step 3. ✅
- Playwright e2e: logged-in save/reload/load-back, anonymous locked-panel + public presets still work → Task 11. ✅
- Out-of-scope items (no cross-player sharing, no thumbnails) → intentionally not built; called out in Global Constraints. ✅

No spec requirement found without a task.

**2. Placeholder scan:** Searched every task for "TBD"/"TODO"/"implement later"/"add appropriate error handling"/"similar to Task N" — none found. Every step has complete, copy-pasteable code. The one deliberately-scoped simplification (My Formations panel reads `existingNames` from local state rather than the error response) is explained with a concrete reason, not left vague.

**3. Type consistency:** Checked names/shapes flow correctly across tasks:
- `decideSaveAction`/`isValidName`/`isValidCells`/`SLOT_LIMIT` (Task 2) are imported with those exact names in Task 3, and no other task redefines them.
- `handleSaveFormation`/`handleListFormations`/`handleDeleteFormation` (Tasks 3-5) are only ever referenced by their test files via those exact names; the `Deno.serve` production wiring uses the same function reference, not a re-implementation.
- `isValidId` (Task 5) matches between `logic.ts` and `logic.test.ts`.
- `mirrorPlacements` (Task 6) is the one and only export from `mirrorFormation.js`, and Task 9 imports exactly that name.
- `showModal` (Task 7) keeps its exact existing signature (`type: "login" | "signup"`); Task 9 calls it with `"login"` only, which is a valid existing case.
- `placementsToCells`/`cellsToPlacements` (Task 9) are the inverse of each other and both operate on the same `[row, col, rank]` triple shape used by `formations.js`'s `cells` arrays and by the `player_formations.cells` jsonb column (Task 1) — verified against the actual `DEFENSIVE_FORMATIONS` data in `web/js/formations.js`.
- DOM ids introduced in Task 8 (`#mirror-btn`, `#my-formations-locked`, `#my-formations-login-link`, `#my-formations-slots`, `#save-formation-btn`, `#save-formation-name-panel`, `#save-formation-form`, `#save-formation-name-input`, `#save-formation-error`, `#save-formation-limit-list`, `#save-formation-cancel-btn`) are each referenced by exactly one `getElementById` call in Task 9, with matching capitalization/hyphenation.

No inconsistencies found.
