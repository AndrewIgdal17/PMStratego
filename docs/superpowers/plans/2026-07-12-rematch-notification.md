# Rematch Notification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When one player clicks Rematch, the opponent gets a live Accept/Decline modal via Realtime instead of needing the room code shared manually.

**Architecture:** New `rematch_room_code` column on `games`. The `rematch` Edge Function writes the new room code to the old game's row, triggering a Realtime event. The opponent's `game.js` detects it and shows a modal with Accept (join-game + redirect) and Decline (dismiss).

**Tech Stack:** TypeScript (Deno Edge Function), PostgreSQL, Plain JavaScript (ESM), CSS, Supabase Realtime.

**Design reference:** `docs/superpowers/specs/2026-07-12-rematch-notification-design.md`

---

## Task 1: Migration + modify rematch Edge Function

**Files:**
- Create: `supabase/migrations/0005_rematch_notification.sql`
- Modify: `supabase/functions/rematch/index.ts`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0005_rematch_notification.sql`:

```sql
-- supabase/migrations/0005_rematch_notification.sql
alter table games add column rematch_room_code text;
```

- [ ] **Step 2: Modify the rematch Edge Function**

In `supabase/functions/rematch/index.ts`, find the final return statement (around line 79):

```typescript
  return new Response(
    JSON.stringify({ roomCode, token: newPlayerRow.secret_token, yourSlot: 1 }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
```

Add this block RIGHT BEFORE that return:

```typescript
  await supabase
    .from("games")
    .update({ rematch_room_code: roomCode, updated_at: new Date().toISOString() })
    .eq("id", playerRow.game_id);
```

This writes the new game's room code to the OLD game's row, which triggers a Realtime event to the opponent's browser.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0005_rematch_notification.sql supabase/functions/rematch/index.ts
git commit -m "feat: rematch writes room code to old game for live opponent notification"
```

---

## Task 2: Frontend — modal markup, CSS, and game.js handlers

**Files:**
- Modify: `web/game.html`
- Modify: `web/css/styles.css`
- Modify: `web/js/game.js`

- [ ] **Step 1: Add rematch modal markup to game.html**

In `web/game.html`, add this right before the closing `</main>` tag (after `</div>` that closes `game-layout`, still inside `<main class="page-frame">`):

```html
      <div id="rematch-modal" class="modal-overlay" hidden>
        <div class="modal-box">
          <h2>Rematch!</h2>
          <p>Your opponent wants a rematch.</p>
          <div class="modal-actions">
            <button id="accept-rematch-btn" class="btn-primary">Accept</button>
            <button id="decline-rematch-btn" class="btn-danger">Decline</button>
          </div>
        </div>
      </div>
```

- [ ] **Step 2: Add modal CSS**

In `web/css/styles.css`, add before the `@media (max-width: 700px)` block:

```css
/* ── Modal overlay ── */

.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.modal-box {
  background: var(--wood-dark);
  border: 2px solid var(--wood-mid);
  border-radius: 8px;
  padding: 2rem;
  text-align: center;
  max-width: 360px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
}

.modal-box h2 {
  margin-top: 0;
}

.modal-actions {
  display: flex;
  gap: 1rem;
  justify-content: center;
  margin-top: 1.5rem;
}
```

- [ ] **Step 3: Add rematch notification detection to game.js**

In `web/js/game.js`, find the Realtime subscription inside `init()`. It currently looks like:

```javascript
  supabase
    .channel(`game-${gameId}`)
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "games", filter: `id=eq.${gameId}` }, async () => {
      await refreshGameRow(gameId);
      await refreshState();
      await refreshMoveLog(gameId);
    })
```

Replace the games UPDATE handler callback with:

```javascript
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "games", filter: `id=eq.${gameId}` }, async (payload) => {
      if (payload.new.rematch_room_code && !isSpectator) {
        showRematchModal(payload.new.rematch_room_code);
      }
      await refreshGameRow(gameId);
      await refreshState();
      await refreshMoveLog(gameId);
    })
```

Note: changed from `async ()` to `async (payload)` to access the payload.

- [ ] **Step 4: Add the showRematchModal function and handlers**

In `web/js/game.js`, add this right before the `init()` function:

```javascript
let pendingRematchCode = null;

function showRematchModal(newRoomCode) {
  pendingRematchCode = newRoomCode;
  document.getElementById("rematch-modal").hidden = false;
}

document.getElementById("accept-rematch-btn").addEventListener("click", async () => {
  if (!pendingRematchCode) return;
  const btn = document.getElementById("accept-rematch-btn");
  btn.disabled = true;
  btn.textContent = "Joining...";
  try {
    const { token: newToken } = await callFunction("join-game", { roomCode: pendingRematchCode });
    localStorage.setItem(`stratego:${pendingRematchCode}:token`, newToken);
    localStorage.setItem(`stratego:${pendingRematchCode}:slot`, "2");
    location.href = `setup.html?code=${pendingRematchCode}`;
  } catch (err) {
    btn.textContent = "Accept";
    btn.disabled = false;
    alert(`Failed to join rematch: ${err.message}`);
  }
});

document.getElementById("decline-rematch-btn").addEventListener("click", () => {
  document.getElementById("rematch-modal").hidden = true;
  pendingRematchCode = null;
});
```

- [ ] **Step 5: Remove the alert from the existing rematch button handler**

In `web/js/game.js`, find the existing rematch button handler. It currently has:

```javascript
    alert(`Rematch created! Room code: ${result.roomCode}. Share it with your opponent, then wait for them to join before setup.`);
    location.href = `setup.html?code=${result.roomCode}`;
```

Replace with just:

```javascript
    location.href = `setup.html?code=${result.roomCode}`;
```

The opponent now gets a live notification — no need to manually share the code.

- [ ] **Step 6: Commit**

```bash
git add web/game.html web/js/game.js web/css/styles.css
git commit -m "feat: live rematch notification with Accept/Decline modal"
```

---

## Task 3: Deploy and verify

**Files:** none (deploy + verification only)

- [ ] **Step 1: Push and deploy**

```bash
git push
npx supabase link --project-ref cafqbrzaxcwewwtyqpnf
npx supabase db push
npx supabase functions deploy rematch --project-ref cafqbrzaxcwewwtyqpnf
```

- [ ] **Step 2: Verify with bot game**

Start a bot game, play until the game ends (resign). Click Rematch. Confirm:
- No alert pops up (removed).
- Redirected straight to setup with the new room code.
- Bot game still works normally.

- [ ] **Step 3: Commit any fixes**

If issues found, fix and redeploy.

---

## Self-review notes

- **Spec coverage:** `rematch_room_code` column ✓. Rematch function writes to old game ✓. Realtime detection ✓. Accept/Decline modal ✓. Accept joins + redirects ✓. Decline dismisses ✓. Alert removed ✓. Spectators excluded ✓. Modal CSS ✓.
- **No placeholders:** All code blocks complete.
- **Type/name consistency:** `rematch_room_code` used in migration, Edge Function `.update()`, and Realtime `payload.new.rematch_room_code`. `pendingRematchCode` stored by `showRematchModal`, used by accept handler. `callFunction("join-game", { roomCode })` matches existing join-game Edge Function signature.
