# Unsubmit Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow players to unsubmit their army placement, with a 10-second countdown window after both players submit before the game goes active. Either player can unsubmit during the countdown to rearrange.

**Architecture:** New `both_submitted_at` column on `games`. Modified `submit-setup` to set the timestamp instead of immediately activating (for non-bot games). Two new Edge Functions: `unsubmit-setup` and `start-game`. Frontend setup screen gets a countdown UI + unsubmit button + Realtime subscription.

**Tech Stack:** TypeScript (Deno Edge Functions), PostgreSQL, Plain JavaScript (ESM), Supabase Realtime.

**Design reference:** `docs/superpowers/specs/2026-07-12-unsubmit-setup-design.md`

---

## Task 1: Database migration + `unsubmit-setup` Edge Function

**Files:**
- Create: `supabase/migrations/0004_unsubmit.sql`
- Create: `supabase/functions/unsubmit-setup/index.ts`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0004_unsubmit.sql`:

```sql
-- supabase/migrations/0004_unsubmit.sql
alter table games add column both_submitted_at timestamptz;
```

- [ ] **Step 2: Create the `unsubmit-setup` Edge Function**

Create `supabase/functions/unsubmit-setup/index.ts`:

```typescript
// supabase/functions/unsubmit-setup/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "METHOD_NOT_ALLOWED" }), { status: 405, headers: corsHeaders });
  }

  const { token } = await req.json();
  if (!token) {
    return new Response(JSON.stringify({ error: "MISSING_FIELDS" }), { status: 400, headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: playerRow, error: playerError } = await supabase
    .from("game_players")
    .select("game_id, player_slot, setup_submitted")
    .eq("secret_token", token)
    .maybeSingle();

  if (playerError || !playerRow) {
    return new Response(JSON.stringify({ error: "INVALID_TOKEN" }), { status: 401, headers: corsHeaders });
  }

  if (!playerRow.setup_submitted) {
    return new Response(JSON.stringify({ error: "SETUP_NOT_SUBMITTED" }), { status: 409, headers: corsHeaders });
  }

  const { data: game, error: gameError } = await supabase
    .from("games")
    .select("status")
    .eq("id", playerRow.game_id)
    .single();

  if (gameError || !game || game.status !== "setup") {
    return new Response(JSON.stringify({ error: "GAME_NOT_IN_SETUP" }), { status: 409, headers: corsHeaders });
  }

  const { error: deletePiecesError } = await supabase
    .from("pieces")
    .delete()
    .eq("game_id", playerRow.game_id)
    .eq("player_slot", playerRow.player_slot);

  if (deletePiecesError) {
    return new Response(JSON.stringify({ error: "DELETE_PIECES_FAILED", detail: deletePiecesError.message }), {
      status: 500, headers: corsHeaders,
    });
  }

  const { error: resetFlagError } = await supabase
    .from("game_players")
    .update({ setup_submitted: false })
    .eq("game_id", playerRow.game_id)
    .eq("player_slot", playerRow.player_slot);

  if (resetFlagError) {
    return new Response(JSON.stringify({ error: "RESET_FLAG_FAILED", detail: resetFlagError.message }), {
      status: 500, headers: corsHeaders,
    });
  }

  const { error: clearTimestampError } = await supabase
    .from("games")
    .update({ both_submitted_at: null, updated_at: new Date().toISOString() })
    .eq("id", playerRow.game_id);

  if (clearTimestampError) {
    return new Response(JSON.stringify({ error: "CLEAR_TIMESTAMP_FAILED", detail: clearTimestampError.message }), {
      status: 500, headers: corsHeaders,
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0004_unsubmit.sql supabase/functions/unsubmit-setup/index.ts
git commit -m "feat: add both_submitted_at column and unsubmit-setup Edge Function"
```

---

## Task 2: `start-game` Edge Function

**Files:**
- Create: `supabase/functions/start-game/index.ts`

- [ ] **Step 1: Create the `start-game` Edge Function**

Create `supabase/functions/start-game/index.ts`:

```typescript
// supabase/functions/start-game/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const COUNTDOWN_SECONDS = 10;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "METHOD_NOT_ALLOWED" }), { status: 405, headers: corsHeaders });
  }

  const { token } = await req.json();
  if (!token) {
    return new Response(JSON.stringify({ error: "MISSING_FIELDS" }), { status: 400, headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: playerRow, error: playerError } = await supabase
    .from("game_players")
    .select("game_id")
    .eq("secret_token", token)
    .maybeSingle();

  if (playerError || !playerRow) {
    return new Response(JSON.stringify({ error: "INVALID_TOKEN" }), { status: 401, headers: corsHeaders });
  }

  const { data: game, error: gameError } = await supabase
    .from("games")
    .select("status, both_submitted_at")
    .eq("id", playerRow.game_id)
    .single();

  if (gameError || !game) {
    return new Response(JSON.stringify({ error: "GAME_NOT_FOUND" }), { status: 404, headers: corsHeaders });
  }

  if (game.status === "active") {
    return new Response(JSON.stringify({ ok: true, alreadyActive: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (game.status !== "setup") {
    return new Response(JSON.stringify({ error: "GAME_NOT_IN_SETUP" }), { status: 409, headers: corsHeaders });
  }

  if (!game.both_submitted_at) {
    return new Response(JSON.stringify({ error: "NOT_BOTH_SUBMITTED" }), { status: 400, headers: corsHeaders });
  }

  const elapsed = (Date.now() - new Date(game.both_submitted_at).getTime()) / 1000;
  if (elapsed < COUNTDOWN_SECONDS) {
    return new Response(JSON.stringify({ error: "COUNTDOWN_NOT_FINISHED", remainingSeconds: Math.ceil(COUNTDOWN_SECONDS - elapsed) }), {
      status: 400, headers: corsHeaders,
    });
  }

  const { data: allPlayers, error: allPlayersError } = await supabase
    .from("game_players")
    .select("setup_submitted")
    .eq("game_id", playerRow.game_id);

  if (allPlayersError) {
    return new Response(JSON.stringify({ error: "READINESS_CHECK_FAILED" }), { status: 500, headers: corsHeaders });
  }

  const bothReady = allPlayers?.length === 2 && allPlayers.every((p) => p.setup_submitted);
  if (!bothReady) {
    return new Response(JSON.stringify({ error: "NOT_BOTH_SUBMITTED" }), { status: 400, headers: corsHeaders });
  }

  const firstTurnSlot = Math.random() < 0.5 ? 1 : 2;
  const { error: activateError } = await supabase
    .from("games")
    .update({ status: "active", current_turn_slot: firstTurnSlot, turn_number: 1, updated_at: new Date().toISOString() })
    .eq("id", playerRow.game_id);

  if (activateError) {
    return new Response(JSON.stringify({ error: "GAME_ACTIVATION_FAILED", detail: activateError.message }), {
      status: 500, headers: corsHeaders,
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
```

Note: if `status` is already `active` (race with the other player), returns `{ ok: true, alreadyActive: true }` — idempotent, no error.

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/start-game/index.ts
git commit -m "feat: add start-game Edge Function with countdown validation"
```

---

## Task 3: Modify `submit-setup` for countdown flow

**Files:**
- Modify: `supabase/functions/submit-setup/index.ts`

- [ ] **Step 1: Change the activation logic for non-bot games**

In `supabase/functions/submit-setup/index.ts`, find the block that activates the game when both players are ready (starts around line 136):

```typescript
  if (bothReady) {
    const firstTurnSlot = Math.random() < 0.5 ? 1 : 2;
    const { error: activateError } = await supabase
      .from("games")
      .update({ status: "active", current_turn_slot: firstTurnSlot, turn_number: 1 })
      .eq("id", playerRow.game_id);

    if (activateError) {
      return new Response(
        JSON.stringify({ error: "GAME_ACTIVATION_FAILED", detail: activateError.message }),
        { status: 500, headers: corsHeaders },
      );
    }
  }

  return new Response(JSON.stringify({ ok: true, gameStarted: bothReady }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
```

Replace with:

```typescript
  if (bothReady) {
    const { data: gameForBot, error: gameBotError } = await supabase
      .from("games")
      .select("is_bot_game")
      .eq("id", playerRow.game_id)
      .single();

    const isBotGame = gameBotError ? false : gameForBot?.is_bot_game === true;

    if (isBotGame) {
      const firstTurnSlot = Math.random() < 0.5 ? 1 : 2;
      const { error: activateError } = await supabase
        .from("games")
        .update({ status: "active", current_turn_slot: firstTurnSlot, turn_number: 1 })
        .eq("id", playerRow.game_id);

      if (activateError) {
        return new Response(
          JSON.stringify({ error: "GAME_ACTIVATION_FAILED", detail: activateError.message }),
          { status: 500, headers: corsHeaders },
        );
      }

      return new Response(JSON.stringify({ ok: true, gameStarted: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } else {
      const { error: timestampError } = await supabase
        .from("games")
        .update({ both_submitted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", playerRow.game_id);

      if (timestampError) {
        return new Response(
          JSON.stringify({ error: "TIMESTAMP_UPDATE_FAILED", detail: timestampError.message }),
          { status: 500, headers: corsHeaders },
        );
      }

      return new Response(JSON.stringify({ ok: true, gameStarted: false, countdownStarted: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  return new Response(JSON.stringify({ ok: true, gameStarted: false }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/submit-setup/index.ts
git commit -m "feat: submit-setup sets countdown timestamp instead of immediate activation for PvP"
```

---

## Task 4: Frontend — countdown UI + unsubmit + start-game logic

**Files:**
- Modify: `web/setup.html`
- Modify: `web/js/setup.js`

- [ ] **Step 1: Add unsubmit button and countdown display to setup.html**

In `web/setup.html`, find the submit button and status paragraph:

```html
          <button id="submit-setup-btn" class="btn-primary" disabled>Submit setup</button>
          <p id="setup-status" class="result" hidden></p>
```

Replace with:

```html
          <button id="submit-setup-btn" class="btn-primary" disabled>Submit setup</button>
          <button id="unsubmit-btn" class="btn-danger" hidden>Unsubmit</button>
          <p id="countdown-display" hidden></p>
          <p id="setup-status" class="result" hidden></p>
```

- [ ] **Step 2: Rewrite the submit handler and add countdown/unsubmit logic in setup.js**

In `web/js/setup.js`, find the existing submit handler (the `submit-setup-btn` click handler, starts around line 265). Replace the ENTIRE handler with:

```javascript
let countdownInterval = null;
let setupChannel = null;

function disableSetupUI() {
  document.getElementById("submit-setup-btn").hidden = true;
  document.getElementById("unsubmit-btn").hidden = false;
  document.querySelectorAll("[data-formation]").forEach((b) => b.disabled = true);
  document.getElementById("clear-btn").disabled = true;
}

function enableSetupUI() {
  document.getElementById("submit-setup-btn").hidden = false;
  document.getElementById("unsubmit-btn").hidden = true;
  document.getElementById("countdown-display").hidden = true;
  document.querySelectorAll("[data-formation]").forEach((b) => b.disabled = false);
  document.getElementById("clear-btn").disabled = false;
  if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }
  renderGrid();
  renderTray();
  updateSubmitButton();
}

function startCountdown(bothSubmittedAt) {
  const countdownEl = document.getElementById("countdown-display");
  const statusEl = document.getElementById("setup-status");
  countdownEl.hidden = false;
  statusEl.hidden = false;
  statusEl.textContent = "Both players ready!";

  if (countdownInterval) clearInterval(countdownInterval);

  function tick() {
    const elapsed = (Date.now() - new Date(bothSubmittedAt).getTime()) / 1000;
    const remaining = Math.max(0, Math.ceil(10 - elapsed));
    countdownEl.textContent = `Game starting in ${remaining}...`;

    if (remaining <= 0) {
      clearInterval(countdownInterval);
      countdownInterval = null;
      countdownEl.textContent = "Starting game...";
      callFunction("start-game", { token }).then((result) => {
        location.href = `game.html?code=${roomCode}`;
      }).catch(() => {
        location.href = `game.html?code=${roomCode}`;
      });
    }
  }

  tick();
  countdownInterval = setInterval(tick, 1000);
}

async function subscribeToGameUpdates() {
  const { data: gameRow } = await supabase.from("games").select("id").eq("room_code", roomCode).single();
  if (!gameRow) return;

  setupChannel = supabase
    .channel(`setup-wait-${gameRow.id}`)
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "games", filter: `id=eq.${gameRow.id}` }, (payload) => {
      if (payload.new.status === "active") {
        location.href = `game.html?code=${roomCode}`;
      } else if (payload.new.both_submitted_at && !countdownInterval) {
        startCountdown(payload.new.both_submitted_at);
      } else if (!payload.new.both_submitted_at && countdownInterval) {
        if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }
        const countdownEl = document.getElementById("countdown-display");
        countdownEl.hidden = true;
        const statusEl = document.getElementById("setup-status");
        statusEl.hidden = false;
        statusEl.textContent = "Opponent is rearranging... waiting for them to resubmit.";
      }
    })
    .subscribe();
}

document.getElementById("submit-setup-btn").addEventListener("click", async () => {
  const statusEl = document.getElementById("setup-status");
  const payload = Array.from(placements.entries()).map(([key, rank]) => {
    const [localRow, col] = key.split(",").map(Number);
    return { rank, row: ABSOLUTE_ROWS[localRow], col };
  });

  try {
    const result = await callFunction("submit-setup", { token, placements: payload });
    statusEl.hidden = false;

    if (result.gameStarted) {
      statusEl.textContent = "Both players ready! Loading game...";
      location.href = `game.html?code=${roomCode}`;
    } else {
      disableSetupUI();
      if (result.countdownStarted) {
        startCountdown(new Date().toISOString());
      } else {
        statusEl.textContent = "Setup submitted. Waiting for your opponent...";
      }
      await subscribeToGameUpdates();
    }
  } catch (err) {
    statusEl.hidden = false;
    statusEl.textContent = `Setup failed: ${err.message}`;
  }
});

document.getElementById("unsubmit-btn").addEventListener("click", async () => {
  const statusEl = document.getElementById("setup-status");
  try {
    await callFunction("unsubmit-setup", { token });
    placements = new Map();
    enableSetupUI();
    statusEl.hidden = false;
    statusEl.textContent = "Setup unsubmitted. Rearrange your army and resubmit.";
  } catch (err) {
    statusEl.hidden = false;
    statusEl.textContent = `Unsubmit failed: ${err.message}`;
  }
});
```

- [ ] **Step 3: Add countdown CSS**

In `web/css/styles.css`, add before the mobile media query:

```css
#countdown-display {
  text-align: center;
  font-weight: bold;
  font-size: 1.2rem;
  color: var(--wood-light);
  margin: 0.5rem 0;
  animation: pulse 1s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}
```

- [ ] **Step 4: Commit**

```bash
git add web/setup.html web/js/setup.js web/css/styles.css
git commit -m "feat: setup screen countdown, unsubmit button, and start-game flow"
```

---

## Task 5: Deploy and verify

**Files:** none (deploy + verification only)

- [ ] **Step 1: Push and deploy**

```bash
git push
npx supabase link --project-ref cafqbrzaxcwewwtyqpnf
npx supabase db push
npx supabase functions deploy submit-setup --project-ref cafqbrzaxcwewwtyqpnf
npx supabase functions deploy unsubmit-setup --project-ref cafqbrzaxcwewwtyqpnf
npx supabase functions deploy start-game --project-ref cafqbrzaxcwewwtyqpnf
```

- [ ] **Step 2: Local verification**

Bot game test — confirm bot games still skip the countdown and activate immediately:
1. Click "Play vs Bot", submit a Defensive formation.
2. Confirm the game starts immediately (no countdown shown).

PvP simulation — use two browser contexts to test the countdown:
1. Context 1: Create new game, go to setup, submit.
2. Context 2: Join with room code, go to setup, submit.
3. Both should see the countdown.
4. Context 1: Click "Unsubmit" during countdown.
5. Context 2: Should see "Opponent is rearranging..."
6. Context 1: Resubmit.
7. Both should see countdown restart.
8. Let countdown finish — both should redirect to game.html.

- [ ] **Step 3: Commit any fixes**

If issues found, fix and redeploy.

---

## Self-review notes

- **Spec coverage:** `both_submitted_at` column ✓. `unsubmit-setup` function (delete pieces, reset flag, clear timestamp) ✓. `start-game` function (10s validation, idempotent on already-active) ✓. Modified `submit-setup` (bot = immediate, PvP = timestamp) ✓. Frontend countdown ✓. Unsubmit button ✓. Realtime subscription for both_submitted_at changes ✓. Bot games skip countdown ✓.
- **No placeholders:** All code blocks complete.
- **Type/name consistency:** `callFunction("unsubmit-setup", { token })` matches the Edge Function name. `callFunction("start-game", { token })` matches. `both_submitted_at` used consistently across migration, submit-setup, unsubmit-setup, start-game, and frontend. `countdownStarted: true` returned by submit-setup, checked by frontend.
