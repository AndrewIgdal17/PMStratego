# Rematch Notification — Design Spec

## Goal

When one player clicks "Rematch" after a game ends, the opponent receives a live notification with Accept/Decline buttons instead of needing the new room code shared manually.

## Architecture

The `rematch` Edge Function already creates a new game. The change: it also writes the new game's room code back to the old game's row (`rematch_room_code` column). The opponent's `game.js` already has a Realtime subscription on the old game's `games` row — when `rematch_room_code` appears, it shows an Accept/Decline modal. Accepting calls `join-game` with the new room code and redirects to setup.

## Backend Changes

### New column: `games.rematch_room_code`

Migration `0005_rematch_notification.sql`:

```sql
alter table games add column rematch_room_code text;
```

Nullable. Only set when a rematch is created from this game.

### Modify `rematch` Edge Function

After creating the new game and player row (existing logic), add one more write before the response:

```typescript
await supabase
  .from("games")
  .update({ rematch_room_code: roomCode, updated_at: new Date().toISOString() })
  .eq("id", playerRow.game_id);
```

This writes the new game's room code to the OLD game's row, which triggers a Realtime event to the opponent's browser.

The `updated_at` update ensures the Realtime `postgres_changes` event fires (Supabase only broadcasts when a column actually changes; `rematch_room_code` going from null to a value already qualifies, but `updated_at` is a belt-and-suspenders safeguard).

No other backend changes needed.

## Frontend Changes

### game.html — rematch modal markup

Add a hidden modal overlay at the end of `<main>`, before `</main>`:

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

### styles.css — modal overlay styles

```css
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

### game.js — detect rematch and show modal

In the existing Realtime subscription on `games` (inside `init()`), add a check for `rematch_room_code`:

```javascript
if (payload.new.rematch_room_code && !isSpectator) {
  showRematchModal(payload.new.rematch_room_code);
}
```

The `showRematchModal(newRoomCode)` function:
- Shows the `#rematch-modal` overlay.
- Stores the new room code.
- Does NOT show the modal to the player who initiated the rematch (they've already redirected to setup by then — but as a safety check, if they're still on the page, they initiated it and don't need the prompt).

Detection of "who initiated": the player who clicks Rematch gets redirected immediately via `location.href = setup.html?code=...`. They won't be on the game page to see the Realtime event. So the modal only fires for the opponent who is still viewing the finished game. No explicit "who initiated" tracking needed.

**Accept handler:**
```javascript
const { token: newToken } = await callFunction("join-game", { roomCode: newRoomCode });
localStorage.setItem(`stratego:${newRoomCode}:token`, newToken);
localStorage.setItem(`stratego:${newRoomCode}:slot`, "2");
location.href = `setup.html?code=${newRoomCode}`;
```

**Decline handler:**
```javascript
document.getElementById("rematch-modal").hidden = true;
```

No server action on decline — the new game just sits empty.

### Rematch button behavior (existing)

The existing rematch button handler in `game.js` already calls `callFunction("rematch", { token })`, stores the new session, and redirects. This continues to work as-is. The only change is that the `rematch` Edge Function now ALSO writes `rematch_room_code` to the old game, which the opponent picks up via Realtime.

The existing `alert()` with the room code can be removed since the opponent now gets a live notification — the rematch creator doesn't need to manually share the code anymore. Replace the `alert(...)` with just the redirect.

## Files Changed

- **Create:** `supabase/migrations/0005_rematch_notification.sql` — `rematch_room_code` column
- **Modify:** `supabase/functions/rematch/index.ts` — write `rematch_room_code` to old game
- **Modify:** `web/game.html` — rematch modal markup
- **Modify:** `web/js/game.js` — detect rematch via Realtime, show modal, Accept/Decline handlers, remove alert from rematch button
- **Modify:** `web/css/styles.css` — modal overlay styles

## Non-Goals

- No "rematch request expires" timer — the modal stays until accepted or declined.
- No "both players must request rematch" flow — one player requests, the other accepts or ignores.
- No notification sound or browser notification API — just the visual modal.
- No changes for bot games (bot games don't use rematch between humans).
- No cleanup of abandoned rematch games — they'll just sit in setup status until Supabase pauses.
