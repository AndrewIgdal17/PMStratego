# Sound Effects — Design Spec

## Goal

Add sound effects for game events (piece select, move, your turn, combat outcomes, bomb, flag capture) with a mute toggle in the nav bar that persists across sessions.

## Architecture

A new `web/js/audio.js` module manages all sound playback via the Web Audio API. It preloads MP3 files into AudioBuffers on page load, and exposes a `playSound(name)` function. Synthesized sounds (select click, your-turn chime) are generated via oscillator nodes — no file needed. `game.js` imports and calls `playSound()` at the appropriate trigger points. A mute toggle in the nav bar controls a localStorage flag that `playSound()` checks.

## Sound Effects

| Name | Source | Description |
|------|--------|-------------|
| `select` | **Web Audio synth** | Short click — 800Hz sine, 50ms, fast decay |
| `yourTurn` | **Web Audio synth** | Two-tone ascending chime — 440Hz then 660Hz, 100ms each |
| `move` | **MP3 file** | Wooden piece slide/tap (Kenney CC0 or Freesound CC0) |
| `attackWin` | **MP3 file** | Metallic sword strike (Mixkit free) |
| `attackLose` | **MP3 file** | Deflected/fail tone (Mixkit free) |
| `tie` | **MP3 file** | Clash + shatter (Mixkit free) |
| `bomb` | **MP3 file** | Short explosion (Mixkit free) |
| `flagCaptured` | **MP3 file** | Victory fanfare, ~2-3s (Mixkit free) |

### File details

- Location: `web/audio/move.mp3`, `attackWin.mp3`, `attackLose.mp3`, `tie.mp3`, `bomb.mp3`, `flagCaptured.mp3`
- Total size budget: <500KB combined
- Trimmed to <0.5s for combat/move sounds, ~2-3s for fanfare
- Format: MP3 only (universal browser support including Safari)
- License: CC0 (Kenney) + Mixkit Free SFX License (personal+commercial, no attribution required)

## Audio Module (`web/js/audio.js`)

### Exports

- `initAudio()` — call once on first user gesture to resume AudioContext + preload files
- `playSound(name)` — plays the named sound; no-op if muted or AudioContext not ready
- `toggleMute()` — toggles mute state, returns new state (true = muted)
- `isMuted()` — returns current mute state

### Implementation approach

- Single `AudioContext` instance, created lazily
- MP3 files fetched and decoded via `fetch()` + `decodeAudioData()` on init — stored in a `Map<string, AudioBuffer>`
- Synth sounds (`select`, `yourTurn`) generated on-the-fly via `OscillatorNode` + `GainNode` with fast envelope
- Mute state stored in `localStorage` key `stratego:muted` (`"1"` = muted, absent = unmuted)
- `playSound()` checks mute state and AudioContext readiness before playing

### AudioContext resume

Browsers require a user gesture before AudioContext can play. `initAudio()` is called from the first click/interaction on the game page. The mute toggle button itself also serves as a gesture to resume the context.

## Mute Toggle

- A button in the top nav bar (right side, in `.nav-links`, before the "Home" link)
- Displays a speaker emoji: 🔊 (unmuted) or 🔇 (muted)
- Default: unmuted
- Click toggles mute state via `toggleMute()`, updates the emoji
- State persists in `localStorage` across pages and refreshes

### HTML

In `web/game.html` nav:

```html
<button id="mute-btn" class="nav-mute-btn" title="Toggle sound">🔊</button>
```

## Trigger Points in `game.js`

| Event | Sound | Where |
|-------|-------|-------|
| Select your piece | `select` | `handleCellClick` — when `piece && piece.is_mine` and setting `selectedPieceId` |
| Successful move (no combat) | `move` | After `callFunction("make-move")` succeeds — check `result.combatResult` is null |
| Your turn notification | `yourTurn` | `renderTurnIndicator` — when `current_turn_slot === mySlot` and game is active. Guard against playing on every render (only play when turn actually changes) |
| Attack wins | `attackWin` | After make-move — `combatResult.outcome === 'ATTACKER_WINS'` and `defenderRank !== 'BOMB'` and `defenderRank !== 'FLAG'` |
| Attack loses | `attackLose` | After make-move — `combatResult.outcome === 'DEFENDER_WINS'` |
| Tie | `tie` | After make-move — `combatResult.outcome === 'TIE'` |
| Hit a bomb | `bomb` | After make-move — `combatResult.outcome === 'DEFENDER_WINS'` and `combatResult.defenderRank === 'BOMB'` (overrides `attackLose`) |
| Captured flag | `flagCaptured` | After make-move — `combatResult.defenderRank === 'FLAG'` (overrides `attackWin`) |

### Your-turn guard

`yourTurn` sound should only play when the turn CHANGES to you, not on every `renderTurnIndicator` call (which happens on page load, Realtime events, etc.). Track a `lastTurnSlot` variable — only play the sound when `current_turn_slot` transitions TO `mySlot` from a different value.

### Spectator sounds

Spectators hear no sounds (they're passive observers). `playSound()` checks `isSpectator` and returns early.

## Files Changed

- **Create:** `web/audio/move.mp3`, `attackWin.mp3`, `attackLose.mp3`, `tie.mp3`, `bomb.mp3`, `flagCaptured.mp3` — sound effect files
- **Create:** `web/js/audio.js` — sound system module
- **Modify:** `web/js/game.js` — import audio module, call `playSound()` at trigger points, add `lastTurnSlot` tracking
- **Modify:** `web/game.html` — mute toggle button in nav
- **Modify:** `web/css/styles.css` — mute button styling

## Non-Goals

- No background music (just event sounds).
- No volume slider (just on/off mute).
- No sounds on the setup or home screens (game screen only).
- No spatial/positional audio.
- No sounds for opponent's moves arriving via Realtime (only your own actions + your-turn notification).
