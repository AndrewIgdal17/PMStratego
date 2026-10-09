# Phase 1: Critical Bug Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all CRITICAL and HIGH bugs from the Oct 7 quality audit on the existing vanilla JS stack so production is safe while the Phase 2 React/TS migration is planned and executed.

**Architecture:** Targeted, file-level patches. No architecture changes. Every fix is independently deployable. The recon report (`docs/.superpowers/sdd/phase1-recon-report.md`) traced each bug to its root cause and provides exact fix shapes.

**Tech Stack:** Vanilla JS (ES modules), Node.js `node --test`, Supabase Edge Functions (Deno/TS for the one new function).

## Global Constraints

- Do not restructure files or add frameworks — Phase 2 owns that.
- All existing tests must stay green after every task.
- Test command after Task 1: `npm test` (which becomes `node --test test/`).
- Every task ends with a commit.
- **Deviation from pole star:** Fix 4 (setup row labels) — the audit's prescribed `ABSOLUTE_ROWS[r] + 1` is **wrong**. The recon proved that `7 + r` is already the correct display-space label for both slots (the game board rotates 180° for slot 2, so display rows 7–10 are correct for both seats). The fix is a behavior-preserving formula + comment, not a value change. See Task 10 for details.

---

### Task 1: Fix Bot Test Assertion + npm test Script

**Files:**
- Modify: `test/web/bot.test.js:17-20`
- Modify: `package.json:10`
- Modify: `README.md` (test documentation section)

**Interfaces:**
- Consumes: nothing
- Produces: a green `npm test` that runs only Node-compatible test files

- [ ] **Step 1: Run the test suite to confirm the current failure**

Run: `cd Projects/Stratego/code && node --test`
Expected: `bot.test.js` fails on the `mapFormationToAbsolute` assertion (col values wrong), and `information-warfare.test.ts` fails with `ERR_UNSUPPORTED_ESM_URL_SCHEME`.

- [ ] **Step 2: Fix the bot test assertion**

In `test/web/bot.test.js`, replace lines 17-20:

```js
  assert.deepEqual(placements, [
    { rank: '9', row: 3, col: 0 },     // slot 2's front row is absolute row 3
    { rank: 'FLAG', row: 0, col: 9 },  // slot 2's back row is absolute row 0
  ]);
```

with:

```js
  assert.deepEqual(placements, [
    { rank: '9', row: 3, col: 9 },     // local col 0 mirrors to absolute col 9 for slot 2
    { rank: 'FLAG', row: 0, col: 0 },  // local col 9 mirrors to absolute col 0 for slot 2
  ]);
```

- [ ] **Step 3: Fix the npm test script to exclude Deno-only files**

In `package.json`, replace:

```json
"test": "node --test"
```

with:

```json
"test": "node --test test/",
"test:deno": "deno test supabase/functions/_shared/information-warfare.test.ts"
```

- [ ] **Step 4: Update README test documentation**

In `README.md`, find the "Rules engine tests" section and update to mention both commands:

```markdown
**Rules engine + bot tests** (no external dependencies):

```bash
npm test          # Node test suite (test/rules + test/web)
```

**Information warfare tests** (requires Deno):

```bash
npm run test:deno
```
```

- [ ] **Step 5: Run the test suite to confirm it's green**

Run: `npm test`
Expected: All tests pass. No `information-warfare.test.ts` failure. The bot assertion passes with the new col values.

- [ ] **Step 6: Commit**

```bash
git add test/web/bot.test.js package.json README.md
git commit -m "fix: correct bot test assertion for column mirror + scope npm test to test/"
```

---

### Task 2: Fix Leaderboard Empty-State Copy

**Files:**
- Modify: `web/index.html:52`

**Interfaces:**
- Consumes: nothing
- Produces: corrected user-facing text

- [ ] **Step 1: Fix the text**

In `web/index.html`, replace:

```html
<p id="leaderboard-empty" class="hint-text" hidden>No ranked players yet. Play 20 games to appear here!</p>
```

with:

```html
<p id="leaderboard-empty" class="hint-text" hidden>No ranked players yet.</p>
```

- [ ] **Step 2: Verify the page still loads**

Run: `npx http-server web -p 8080` and open `http://localhost:8080`. The leaderboard panel should render (empty-state text is hidden unless no players exist).

- [ ] **Step 3: Commit**

```bash
git add web/index.html
git commit -m "fix: remove false '20 games' leaderboard eligibility claim"
```

---

### Task 3: Fix callFunction Null-Data Crash + Error Fallback Chain

**Files:**
- Modify: `web/js/supabaseClient.js:12-30`
- Create: `test/web/escapeHtml.test.js` (placeholder — actually no, put callFunction test here... but callFunction depends on Supabase. Skip unit test; verify manually.)

**Interfaces:**
- Consumes: nothing
- Produces: `callFunction` that throws `Error("EMPTY_RESPONSE")` on null data, and uses a cumulative error-message fallback chain

- [ ] **Step 1: Replace the callFunction body**

Replace the entire `callFunction` function in `web/js/supabaseClient.js` (lines 12-30) with:

```js
export async function callFunction(name, body) {
  const token = getAuthToken();
  const enrichedBody = token ? { ...body, authToken: token } : body;
  const { data, error } = await supabase.functions.invoke(name, { body: enrichedBody });
  if (error) {
    let message;
    if (error.context && typeof error.context.json === "function") {
      try {
        const errorBody = await error.context.json();
        message = errorBody?.error;
      } catch {
        // response body wasn't JSON
      }
    }
    message = message || data?.error || error.message || "UNKNOWN_ERROR";
    throw new Error(message);
  }
  if (data == null) throw new Error("EMPTY_RESPONSE");
  return data;
}
```

Key changes from the old version:
1. Null-data guard: `if (data == null) throw new Error("EMPTY_RESPONSE")` after the error block.
2. Cumulative fallback: `message = message || data?.error || error.message || "UNKNOWN_ERROR"` — `data?.error` is always consulted, not gated behind an `else if`.

- [ ] **Step 2: Run the test suite**

Run: `npm test`
Expected: All tests pass (no test imports `supabaseClient.js` — it depends on browser globals).

- [ ] **Step 3: Commit**

```bash
git add web/js/supabaseClient.js
git commit -m "fix: throw on null callFunction data + cumulative error fallback chain"
```

---

### Task 4: Add escapeHtml Helper + Fix All XSS Sites

**Files:**
- Create: `web/js/escapeHtml.js`
- Create: `test/web/escapeHtml.test.js`
- Modify: `web/js/auth.js:31`
- Modify: `web/js/home.js:160,181`
- Modify: `web/js/profile.js:167,550,565`
- Modify: `web/js/gameDetail.js:46,53,55,59,61,121,143`

**Interfaces:**
- Consumes: nothing
- Produces: `escapeHtml(value)` function exported from `web/js/escapeHtml.js`

- [ ] **Step 1: Write the escapeHtml test**

Create `test/web/escapeHtml.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml } from '../../web/js/escapeHtml.js';

test('escapeHtml escapes all HTML metacharacters', () => {
  assert.equal(escapeHtml('<script>alert("xss")</script>'), '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
});

test('escapeHtml escapes ampersands', () => {
  assert.equal(escapeHtml('A & B'), 'A &amp; B');
});

test('escapeHtml escapes single quotes', () => {
  assert.equal(escapeHtml("it's"), "it&#39;s");
});

test('escapeHtml passes through safe strings unchanged', () => {
  assert.equal(escapeHtml('andy1701'), 'andy1701');
  assert.equal(escapeHtml('hello_world_123'), 'hello_world_123');
});

test('escapeHtml handles null and undefined', () => {
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `escapeHtml.js` does not exist yet.

- [ ] **Step 3: Create the escapeHtml helper**

Create `web/js/escapeHtml.js`:

```js
export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[ch]));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: All tests pass including the new `escapeHtml.test.js`.

- [ ] **Step 5: Wrap username interpolations in auth.js**

In `web/js/auth.js`, add the import at the top:

```js
import { escapeHtml } from "./escapeHtml.js";
```

At line 31, replace:

```js
      <a href="profile.html?user=${encodeURIComponent(getUsername())}" class="nav-user">${getUsername()}</a>
```

with:

```js
      <a href="profile.html?user=${encodeURIComponent(getUsername())}" class="nav-user">${escapeHtml(getUsername())}</a>
```

- [ ] **Step 6: Wrap username interpolations in home.js**

In `web/js/home.js`, add the import at the top:

```js
import { escapeHtml } from "./escapeHtml.js";
```

At line 160 (rating leaderboard), replace:

```js
        <td><a href="profile.html?user=${encodeURIComponent(p.username)}">${p.username}</a></td>
```

with:

```js
        <td><a href="profile.html?user=${encodeURIComponent(p.username)}">${escapeHtml(p.username)}</a></td>
```

At line 181 (micro-leaderboard), make the same replacement:

```js
      <td><a href="profile.html?user=${encodeURIComponent(p.username)}">${escapeHtml(p.username)}</a></td>
```

- [ ] **Step 7: Wrap username interpolations in profile.js**

In `web/js/profile.js`, add the import at the top:

```js
import { escapeHtml } from "./escapeHtml.js";
```

At line 167 (profile header `<h2>`), replace:

```js
    <h2>${player.username}</h2>
```

with:

```js
    <h2>${escapeHtml(player.username)}</h2>
```

At line 550 (game history tooltip — **attribute-breakout variant**), replace:

```js
    const tooltip = `vs ${g.opponent_username || "Anon"} (${g.turn_number || "?"} moves)`;
```

with:

```js
    const tooltip = `vs ${escapeHtml(g.opponent_username || "Anon")} (${g.turn_number || "?"} moves)`;
```

At line 565 (game history table link text), replace:

```js
            <td><a href="profile.html?user=${encodeURIComponent(g.opponent_username || "Anonymous")}" onclick="event.stopPropagation()">${g.opponent_username || "Anonymous"}</a></td>
```

with:

```js
            <td><a href="profile.html?user=${encodeURIComponent(g.opponent_username || "Anonymous")}" onclick="event.stopPropagation()">${escapeHtml(g.opponent_username || "Anonymous")}</a></td>
```

- [ ] **Step 8: Wrap username interpolations in gameDetail.js**

In `web/js/gameDetail.js`, add the import at the top:

```js
import { escapeHtml } from "./escapeHtml.js";
```

Wrap `slotLabel` at line 46 so every downstream use is safe:

```js
function slotLabel(slot, data) {
  return escapeHtml(slot === 1 ? data.player1_username : data.player2_username);
}
```

At line 53, the `<h2>` uses the raw usernames directly (not via `slotLabel`). Replace:

```js
    <h2>${data.player1_username} vs ${data.player2_username}</h2>
```

with:

```js
    <h2>${escapeHtml(data.player1_username)} vs ${escapeHtml(data.player2_username)}</h2>
```

At lines 59 and 61, the view-toggle links also use raw usernames. Replace:

```js
      <a href="?id=${gameId}&slot=1" class="${viewSlot === 1 ? "active" : ""}">${data.player1_username}</a>
      ·
      <a href="?id=${gameId}&slot=2" class="${viewSlot === 2 ? "active" : ""}">${data.player2_username}</a>
```

with:

```js
      <a href="?id=${gameId}&slot=1" class="${viewSlot === 1 ? "active" : ""}">${escapeHtml(data.player1_username)}</a>
      ·
      <a href="?id=${gameId}&slot=2" class="${viewSlot === 2 ? "active" : ""}">${escapeHtml(data.player2_username)}</a>
```

`slotLabel` now returns escaped HTML, so lines 55, 69, 77, 95, 121 that interpolate `slotLabel(...)` or `name` (which is `slotLabel(...)`) are covered automatically. Line 143 interpolates `h.text`, which is built from `name` — also covered.

- [ ] **Step 9: Run the full test suite**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 10: Commit**

```bash
git add web/js/escapeHtml.js test/web/escapeHtml.test.js web/js/auth.js web/js/home.js web/js/profile.js web/js/gameDetail.js
git commit -m "fix: escape all username innerHTML interpolations (XSS prevention)"
```

---

### Task 5: Guard gameDetail.js Phase Stats Crash

**Files:**
- Modify: `web/js/gameDetail.js:224-237`

**Interfaces:**
- Consumes: nothing
- Produces: `renderPhaseStats` that gracefully handles missing `by_capture_quarter` or missing quarter keys

- [ ] **Step 1: Replace the renderPhaseStats function body**

In `web/js/gameDetail.js`, replace lines 224-237 (the `renderPhaseStats` function, from the opening `function` to the end of the `el.innerHTML` assignment) with:

```js
function renderPhaseStats(phaseStats, slot) {
  const el = document.getElementById("game-phase-stats");
  const ps = phaseStats?.[`slot${slot}`];
  const quarters = ps?.by_capture_quarter;
  if (!quarters) return;
  const rows = ["q1", "q2", "q3", "q4"].map((q) => {
    const b = quarters[q];
    if (!b) {
      return `<tr><td>${q.toUpperCase()}</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td></tr>`;
    }
    return `<tr>
      <td>${q.toUpperCase()}</td>
      <td>${pct(b.reveal_wins, b.reveal_attacks)}</td>
      <td>${b.trade_count ? (b.trade_sum / b.trade_count).toFixed(1) : "—"}</td>
      <td>${pct(b.attack_wins, b.attacks)}</td>
      <td>${pct(b.avenge_kills, b.avenge_opportunities)}</td>
      <td>${b.attacks ?? "—"}</td>
    </tr>`;
  }).join("");
  el.innerHTML = `
    <h3>Phase Breakdown <span class="stat-help" data-tooltip="Metrics binned by capture quartile — Q1 is opening fog, Q4 is endgame. Captures = attack kills + defense kills. Attack WR only counts combats you initiated. Avenge = kill a piece that previously killed yours.">?</span></h3>
    <table class="history-table phase-table">
      <thead><tr><th>Phase</th><th>Reveal Eff</th><th>Trade Eff</th><th>Attack WR</th><th>Avenge</th><th>Attacks</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}
```

Key changes: (1) extract `quarters = ps?.by_capture_quarter` and bail early if absent, (2) guard each `quarters[q]` and render em-dashes for missing bins, (3) use `b.attacks ?? "—"` instead of bare `b.attacks`.

- [ ] **Step 2: Run the test suite**

Run: `npm test`
Expected: All tests pass (no test imports `gameDetail.js`).

- [ ] **Step 3: Commit**

```bash
git add web/js/gameDetail.js
git commit -m "fix: guard gameDetail renderPhaseStats against missing capture-quarter data"
```

---

### Task 6: Add Monotonic Guard to refreshGameRow

**Files:**
- Modify: `web/js/game.js:83-106`

**Interfaces:**
- Consumes: nothing
- Produces: `refreshGameRow` that rejects stale out-of-order responses

- [ ] **Step 1: Add the staleness guard**

In `web/js/game.js`, add this helper above `refreshGameRow` (before line 83):

```js
const STATUS_RANK = { setup: 0, active: 1, finished: 2 };

function shouldApplyGameRow(next, prev) {
  if (!prev) return true;
  if (next.turn_number !== prev.turn_number) return next.turn_number > prev.turn_number;
  return (STATUS_RANK[next.status] ?? -1) >= (STATUS_RANK[prev.status] ?? -1);
}
```

- [ ] **Step 2: Apply the guard in refreshGameRow**

In `refreshGameRow`, after the error check and before `gameRow = data`, add the guard. Replace:

```js
  if (error) return;
  gameRow = data;
```

with:

```js
  if (error || !data) return;
  if (!shouldApplyGameRow(data, gameRow)) return;
  gameRow = data;
```

- [ ] **Step 3: Run the test suite**

Run: `npm test`
Expected: All tests pass (no test imports `game.js`).

- [ ] **Step 4: Commit**

```bash
git add web/js/game.js
git commit -m "fix: reject stale out-of-order refreshGameRow responses via turn+status guard"
```

---

### Task 7: Fix AudioContext User-Gesture Requirement

**Files:**
- Modify: `web/js/audio.js:62-98`
- Modify: `web/js/game.js:621-622` (the `initAudio` + `playMusic` calls)

**Interfaces:**
- Consumes: nothing
- Produces: Safari-safe audio initialization that defers `resume()` and `decodeAudioData` to the first user gesture

- [ ] **Step 1: Rewrite initAudio to defer resume and decode**

In `web/js/audio.js`, replace the `initAudio` function (lines 62-98) with:

```js
let rawBuffers = new Map();
let unlocked = false;

export async function initAudio() {
  if (initialized) return;
  ctx = new (window.AudioContext || window.webkitAudioContext)();

  masterGain = ctx.createGain();
  masterGain.connect(ctx.destination);

  sfxGain = ctx.createGain();
  sfxGain.connect(masterGain);

  musicGain = ctx.createGain();
  musicGain.connect(masterGain);

  applyGains();

  const basePath = new URL(AUDIO_BASE, import.meta.url).href;
  setupMusicElement(basePath);

  // Fetch raw audio data but do NOT decode yet — decoding while the
  // AudioContext is suspended can fail on Safari. Decode on first unlock.
  const loadPromises = Object.entries(SFX_FILES).map(async ([name, file]) => {
    try {
      const res = await fetch(basePath + file);
      rawBuffers.set(name, await res.arrayBuffer());
    } catch (e) {
      console.warn(`Failed to load sound: ${name}`, e);
    }
  });

  await Promise.all(loadPromises);
  initialized = true;

  // Unlock on the first user gesture (pointerdown fires before click,
  // giving us the earliest possible moment in the gesture).
  document.addEventListener("pointerdown", unlockAudio, { once: true, capture: true });
}

async function unlockAudio() {
  if (unlocked) return;
  unlocked = true;
  try {
    if (ctx.state === 'suspended') await ctx.resume();
  } catch { /* context may already be running */ }

  // Decode the pre-fetched buffers now that the context is active.
  for (const [name, arrayBuf] of rawBuffers) {
    try {
      buffers.set(name, await ctx.decodeAudioData(arrayBuf));
    } catch (e) {
      console.warn(`Failed to decode sound: ${name}`, e);
    }
  }
  rawBuffers.clear();

  // Start music on first interaction
  playMusic();
}
```

- [ ] **Step 2: Add a resume guard to playSound**

In `web/js/audio.js`, at the top of the `playSound` function (line ~100), add a resume attempt so clicks that arrive before the `pointerdown` listener also unlock:

```js
export function playSound(name) {
  if (!initialized || !ctx) return;
  if (state.allMuted || state.sfxMuted) return;

  // Belt-and-suspenders: resume on any sound-triggering interaction
  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }
```

The rest of `playSound` stays the same.

- [ ] **Step 3: Remove the eager playMusic call from game.js**

In `web/js/game.js`, find the `init` function's audio block (around lines 621-622):

```js
    await initAudio();
    playMusic();
```

Replace with:

```js
    await initAudio();
    // playMusic() is now called by unlockAudio() on the first user gesture
```

- [ ] **Step 4: Run the test suite**

Run: `npm test`
Expected: All tests pass (no test imports `audio.js` or the audio parts of `game.js`).

- [ ] **Step 5: Commit**

```bash
git add web/js/audio.js web/js/game.js
git commit -m "fix: defer AudioContext resume + decode to first user gesture (Safari-safe)"
```

---

### Task 8: Add Rules Engine Copy Sync Script + Drift Test

**Files:**
- Create: `scripts/sync-rules.sh`
- Create: `test/rules/copies.test.js`

**Interfaces:**
- Consumes: Task 1's `npm test` scoped to `test/`
- Produces: a sync script and a test that catches drift between the three rules-engine copies

- [ ] **Step 1: Write the drift test**

Create `test/rules/copies.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const CANONICAL = 'src/rules';
const COPIES = [
  'web/js/rules',
  'supabase/functions/_shared/rules',
];

const jsFiles = readdirSync(CANONICAL).filter((f) => f.endsWith('.js'));

for (const copy of COPIES) {
  for (const file of jsFiles) {
    test(`${copy}/${file} is identical to ${CANONICAL}/${file}`, () => {
      const canonical = readFileSync(join(CANONICAL, file), 'utf8');
      const copied = readFileSync(join(copy, file), 'utf8');
      assert.equal(
        copied,
        canonical,
        `${copy}/${file} differs from ${CANONICAL}/${file}. Edit src/rules/ and run: npm run sync-rules`,
      );
    });
  }
}
```

- [ ] **Step 2: Run the test to verify it passes (copies are identical today)**

Run: `npm test`
Expected: All copy-check tests pass (the three directories are byte-identical right now).

- [ ] **Step 3: Create the sync script**

Create `scripts/sync-rules.sh`:

```bash
#!/usr/bin/env bash
# Copies the canonical rules engine (src/rules/) to the two deploy-isolated
# directories. Run this after editing src/rules/ and before committing.
set -euo pipefail

cp src/rules/*.js web/js/rules/
cp src/rules/*.js supabase/functions/_shared/rules/

echo "Rules synced: src/rules/ → web/js/rules/ + supabase/functions/_shared/rules/"
```

- [ ] **Step 4: Make the script executable and add an npm script**

Run: `chmod +x scripts/sync-rules.sh`

In `package.json`, add the script:

```json
"sync-rules": "bash scripts/sync-rules.sh"
```

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: All tests pass including the new drift checks.

- [ ] **Step 6: Commit**

```bash
git add scripts/sync-rules.sh test/rules/copies.test.js package.json
git commit -m "feat: add rules-engine sync script + drift test for triple-copy enforcement"
```

---

### Task 9: Add abandon-game Edge Function + Bot Cleanup in home.js

**Files:**
- Create: `supabase/functions/abandon-game/index.ts`
- Modify: `web/js/home.js:69-87`

**Interfaces:**
- Consumes: nothing
- Produces: `abandon-game` Edge Function (token-authenticated, bot-game setup-phase only) + cleanup catch in `home.js`

- [ ] **Step 1: Create the abandon-game Edge Function**

Create `supabase/functions/abandon-game/index.ts`:

```ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { token } = await req.json();
    if (!token) {
      return new Response(JSON.stringify({ error: "MISSING_TOKEN" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Find the player by their secret token
    const { data: player, error: playerError } = await supabase
      .from("game_players")
      .select("id, game_id, player_slot")
      .eq("secret_token", token)
      .single();

    if (playerError || !player) {
      return new Response(JSON.stringify({ error: "INVALID_TOKEN" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (player.player_slot !== 1) {
      return new Response(JSON.stringify({ error: "NOT_HOST" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load the game and verify it's a bot game still in setup
    const { data: game, error: gameError } = await supabase
      .from("games")
      .select("id, is_bot_game, status")
      .eq("id", player.game_id)
      .single();

    if (gameError || !game) {
      return new Response(JSON.stringify({ error: "GAME_NOT_FOUND" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!game.is_bot_game) {
      return new Response(JSON.stringify({ error: "NOT_BOT_GAME" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (game.status !== "setup") {
      return new Response(JSON.stringify({ error: "GAME_NOT_IN_SETUP" }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Delete in FK order: chat_messages, moves, pieces, game_players, games
    const gid = game.id;
    await supabase.from("chat_messages").delete().eq("game_id", gid);
    await supabase.from("moves").delete().eq("game_id", gid);
    await supabase.from("pieces").delete().eq("game_id", gid);
    await supabase.from("game_players").delete().eq("game_id", gid);
    await supabase.from("games").delete().eq("id", gid);

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "INTERNAL_ERROR" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
```

- [ ] **Step 2: Add cleanup to the Play-vs-Bot catch in home.js**

In `web/js/home.js`, replace the play-bot-btn handler (lines 69-87) with:

```js
document.getElementById("play-bot-btn").addEventListener("click", async () => {
  const button = document.getElementById("play-bot-btn");
  const resultEl = document.getElementById("play-bot-error");
  button.disabled = true;
  let roomCode = null;
  try {
    const created = await callFunction("create-game", { isBotGame: true });
    roomCode = created.roomCode;
    storeSession(roomCode, created.token, 1);

    const { token: botToken } = await callFunction("join-game", { roomCode });
    localStorage.setItem(`stratego:${roomCode}:botToken`, botToken);
    const placements = pickBotFormationPlacements();
    await callFunction("submit-setup", { token: botToken, placements });

    location.href = `setup.html?code=${roomCode}`;
  } catch (err) {
    if (roomCode) {
      const humanToken = localStorage.getItem(`stratego:${roomCode}:token`);
      if (humanToken) {
        try { await callFunction("abandon-game", { token: humanToken }); } catch { /* best effort */ }
      }
      for (const key of ["token", "slot", "botToken"]) {
        localStorage.removeItem(`stratego:${roomCode}:${key}`);
      }
    }
    resultEl.hidden = false;
    resultEl.textContent = `Failed to start bot game: ${err.message}`;
    button.disabled = false;
  }
});
```

Key changes: (1) `roomCode` declared outside try, (2) on catch: call `abandon-game` with the human token, then clear all localStorage keys for that room.

- [ ] **Step 3: Run the test suite**

Run: `npm test`
Expected: All tests pass (no test imports `home.js` or the Edge Function).

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/abandon-game/index.ts web/js/home.js
git commit -m "feat: add abandon-game Edge Function + cleanup catch for bot flow partial failure"
```

- [ ] **Step 5: Deploy the Edge Function**

Run: `npx supabase functions deploy abandon-game --project-ref cafqbrzaxcwewwtyqpnf`
Expected: Deployment succeeds.

- [ ] **Step 6: Smoke test via curl**

Run (with an invalid token to verify the error path):

```bash
curl -X POST "https://cafqbrzaxcwewwtyqpnf.supabase.co/functions/v1/abandon-game" \
  -H "Authorization: Bearer sb_publishable_mxrVhbM1gbEixsbuhyn6sw_eL7r6dRX" \
  -H "Content-Type: application/json" \
  -d '{"token":"fake-token-123"}'
```

Expected: `{"error":"INVALID_TOKEN"}` with status 400.

---

### Task 10: Behavior-Preserving Setup Row Label Formula

**Files:**
- Modify: `web/js/setup.js:220-223`

**Interfaces:**
- Consumes: nothing
- Produces: setup row labels computed from `ABSOLUTE_ROWS` and slot, producing the same 7-10 values as before

**⚠️ Deviation from pole star:** The audit's `ABSOLUTE_ROWS[r] + 1` formula is wrong — it would show 4, 3, 2, 1 for slot 2, desynchronizing setup labels from the game board and move log. This task replaces the magic `7 + r` with the equivalent display-space formula plus a comment, keeping the output identical.

- [ ] **Step 1: Replace the row label computation**

In `web/js/setup.js`, replace the row-label loop body (inside the `if (rowLabels && rowLabels.children.length === 0)` block, approximately lines 220-223):

```js
    for (let r = 0; r < LOCAL_ROWS.length; r++) {
      const span = document.createElement("span");
      span.textContent = String(7 + r);
      rowLabels.appendChild(span);
    }
```

with:

```js
    for (let r = 0; r < LOCAL_ROWS.length; r++) {
      const span = document.createElement("span");
      // Display-space labels matching game.js renderBoard (row + 1) after
      // slot 2's 180° rotation. Both seats' territory = display rows 6–9.
      const absRow = ABSOLUTE_ROWS[r];
      const displayRow = slot === 2 ? (9 - absRow) : absRow;
      span.textContent = String(displayRow + 1);
      rowLabels.appendChild(span);
    }
```

Verify by hand: Slot 1 ABSOLUTE_ROWS = [6,7,8,9] → displayRow = [6,7,8,9] → labels 7,8,9,10. Slot 2 ABSOLUTE_ROWS = [3,2,1,0] → displayRow = [9-3, 9-2, 9-1, 9-0] = [6,7,8,9] → labels 7,8,9,10. Same output as `7 + r`.

- [ ] **Step 2: Run the test suite**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add web/js/setup.js
git commit -m "refactor: replace magic 7+r row labels with display-space formula + comment"
```

---

## Verification

After all 10 tasks are complete:

- [ ] Run `npm test` — all tests green, no false failures.
- [ ] Push to GitHub: `git push origin main`.
- [ ] Trigger Render deploy and verify the site loads at `stratego-1ex2.onrender.com`.
- [ ] Deploy the `abandon-game` Edge Function (if not done in Task 9 Step 5).
- [ ] Play a real two-player game (create → join → setup → play → resign/rematch) to verify no regressions.
- [ ] Play a bot game to verify the bot flow works, including deliberately failing a step (disconnect network during bot setup) to test the cleanup catch.
- [ ] Open the site in Safari to verify audio plays after the first click.
- [ ] Check the game-detail page for an older game (one that might have partial `phase_stats`) to verify the guard works.
