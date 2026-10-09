# PMStratego Quality & Bug Audit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a comprehensive, incrementally-built audit document cataloging every bug, quality issue, confusing pattern, gotcha, and improvement recommendation across the entire PMStratego codebase.

**Architecture:** Each task audits one subsystem and appends its findings directly to a shared audit document. No single agent summarizes — the document accumulates section by section. Task 1 scaffolds the document; Tasks 2–12 each read their target files, audit against a specific checklist, and append a structured section.

**Tech Stack:** Vanilla JS (ES modules), Supabase (Postgres + Edge Functions + Realtime), static HTML/CSS. Tests run via `node --test`. No build step, no TypeScript on frontend.

## Global Constraints

- **Audit document path:** `Projects/Stratego/code/docs/audits/2026-10-07__quality-audit.md`
- **Never modify source code.** This plan is read-only — findings only, no fixes.
- **Severity scale:** CRITICAL (game-breaking or data-loss), HIGH (incorrect behavior visible to users), MEDIUM (quality/maintainability/UX degradation), LOW (style, naming, minor improvements).
- **Every finding must cite a specific file and line number** (or line range).
- **Each section must follow the template defined in Task 1** — no free-form prose.
- **Source of truth for file paths:** `Projects/Stratego/code/web/js/` for frontend, `Projects/Stratego/code/test/` for tests, `Projects/Stratego/code/web/css/styles.css` for CSS, `Projects/Stratego/code/web/*.html` for HTML.

---

### Task 1: Scaffold the Audit Document

**Files:**
- Create: `Projects/Stratego/code/docs/audits/2026-10-07__quality-audit.md`

**Interfaces:**
- Consumes: nothing
- Produces: the audit document skeleton that all subsequent tasks append to

- [ ] **Step 1: Create the audit document with frontmatter and section template**

Write this exact content to `Projects/Stratego/code/docs/audits/2026-10-07__quality-audit.md`:

```markdown
---
tags: [project/stratego]
---

# PMStratego Quality & Bug Audit — 2026-10-07

**Scope:** Full codebase audit of `Projects/Stratego/code/` (frontend JS, CSS, HTML, test suite).
**Edge Functions** are out of scope (not checked out locally in the submodule).
**Method:** Each section produced by an independent reviewer examining one subsystem.

## Summary

| Area | Bugs | Quality Issues | Gotchas | Recommendations |
|------|------|----------------|---------|-----------------|
| *(filled in by each task)* | | | | |

---

<!-- == SECTION TEMPLATE (do not delete — reviewers copy this) ==

## [Area Name]

**Files reviewed:** `path/to/file.js` (N lines), ...

### Bugs

| # | Severity | Location | Description | Suggested Fix |
|---|----------|----------|-------------|---------------|
| 1 | HIGH | `file.js:42` | What's wrong | How to fix it |

*If none found, write "No bugs found."*

### Quality Issues

| # | Severity | Location | Description | Recommendation |
|---|----------|----------|-------------|----------------|
| 1 | MEDIUM | `file.js:42` | What's suboptimal | What to do instead |

*If none found, write "No quality issues found."*

### Confusing Code & Gotchas

| # | Location | What's Confusing | Why It Matters |
|---|----------|-----------------|----------------|
| 1 | `file.js:42` | Description | How someone could get burned |

*If none found, write "No gotchas found."*

### Positive Observations

- Things done well in this area (at least 1).

### Recommendations

1. Prioritized list of what to fix/improve, with estimated effort (trivial/small/medium/large).

== END TEMPLATE == -->
```

- [ ] **Step 2: Verify the document exists and renders correctly**

Run: `cat Projects/Stratego/code/docs/audits/2026-10-07__quality-audit.md | head -20`
Expected: frontmatter and title visible.

- [ ] **Step 3: Commit**

```bash
git add Projects/Stratego/code/docs/audits/2026-10-07__quality-audit.md
git commit -m "docs: scaffold quality audit document"
```

---

### Task 2: Audit the Rules Engine

**Files:**
- Read: `Projects/Stratego/code/web/js/rules/board.js` (18 lines)
- Read: `Projects/Stratego/code/web/js/rules/pieces.js` (35 lines)
- Read: `Projects/Stratego/code/web/js/rules/movement.js` (59 lines)
- Read: `Projects/Stratego/code/web/js/rules/combat.js` (23 lines)
- Read: `Projects/Stratego/code/web/js/rules/twoSquareRule.js` (14 lines)
- Read: `Projects/Stratego/code/web/js/rules/game.js` (110 lines)
- Read: `Projects/Stratego/code/test/rules/` (all 6 test files)
- Modify: `Projects/Stratego/code/docs/audits/2026-10-07__quality-audit.md` (append section)

**Interfaces:**
- Consumes: the audit document skeleton from Task 1
- Produces: a `## Rules Engine` section appended to the audit document

- [ ] **Step 1: Read all 6 rules source files and all 6 test files end-to-end**

- [ ] **Step 2: Audit against this checklist**

Check every item — if it's fine, move on; if it's not, record a finding:

**Correctness:**
- Does `resolveCombat` handle all 12 ranks × 12 ranks correctly per official Stratego rules? (Spy kills Marshal on attack only, Miner defuses Bomb, Flag always dies, equal ranks both die, lower number wins.)
- Does the two-square rule match official rules? ("A piece cannot shuttle between the same two squares more than 3 consecutive times." Verify: does "consecutive" mean the player's own last 3 moves, or does any intervening move by the opponent reset it? Official: it's the player's own history only.)
- Does `getLegalMoves` enumerate all valid moves for Scouts (multi-square straight lines, can't jump pieces or lakes)?
- Does `isLake` use the correct 8 squares? (Official: rows 4-5 × cols 2-3 and rows 4-5 × cols 6-7, 0-indexed.)
- Does `validateMove` correctly reject: moving onto your own piece, moving a Bomb/Flag, moving off-board, moving onto a lake, diagonal moves for non-Scouts?
- Does `applyMove` check for game-ending conditions: Flag captured → attacker wins; no legal moves → opponent wins?
- Can a game end in a draw? (Both players have no legal moves simultaneously — is this handled?)

**Edge cases:**
- What happens if `applyMove` is called when `state.status !== 'active'`?
- What if the move history array is empty (first move of the game) — does `violatesTwoSquareRule` handle it?
- Scout moving exactly 1 square — does it go through `isClearScoutPath` or `isOrthogonalAdjacent`? (Answer: `isOrthogonalAdjacent` short-circuits, but `isLegalDestination` tries Scout path for rank 9 — verify no double-validation issue.)

**Test coverage:**
- For each source function, verify at least one test exists. List any untested functions.
- Check if tests cover edge cases (empty board, all pieces dead, single piece remaining).
- Flag any tests that are trivially passing (e.g., testing a constant).

- [ ] **Step 3: Append findings to the audit document**

Copy the section template from the document. Fill in every table. Update the Summary table row for "Rules Engine" with counts. Append the completed section directly below the template comment block.

- [ ] **Step 4: Verify the section was appended**

Run: `grep -c "## Rules Engine" Projects/Stratego/code/docs/audits/2026-10-07__quality-audit.md`
Expected: `1`

- [ ] **Step 5: Commit**

```bash
git add Projects/Stratego/code/docs/audits/2026-10-07__quality-audit.md
git commit -m "docs(audit): rules engine review"
```

---

### Task 3: Audit Auth & Networking Layer

**Files:**
- Read: `Projects/Stratego/code/web/js/auth.js` (102 lines)
- Read: `Projects/Stratego/code/web/js/supabaseClient.js` (31 lines)
- Modify: `Projects/Stratego/code/docs/audits/2026-10-07__quality-audit.md` (append section)

**Interfaces:**
- Consumes: the audit document with prior sections
- Produces: a `## Auth & Networking` section appended to the audit document

- [ ] **Step 1: Read both files end-to-end**

- [ ] **Step 2: Audit against this checklist**

**Security:**
- Is the Supabase anon key safe to expose in frontend JS? (Yes per design — but verify no secret key is leaked.)
- Does `auth.js` ever check JWT expiration on the client? (It uses `localStorage` — does the token expire? What happens when it does?)
- `callFunction` enriches every request body with `authToken` — is this always appropriate? Could a function receive an unexpected `authToken` field?
- Are passwords transmitted securely? (HTTPS only? Any client-side hashing? Or plaintext over HTTPS to the Edge Function?)
- `saveSession` stores token in `localStorage` — is this vulnerable to XSS? (Standard trade-off, but document it.)
- The room-code token (separate from auth token) in `localStorage` — could a malicious script read all game tokens?

**Error handling:**
- `callFunction`: the error extraction logic (lines 17-28) tries `error.context.json()`, falls back to `data?.error`, falls back to `error.message`. Are there cases where none of these produce a useful message?
- What happens if `supabase.functions.invoke` returns `{ data: null, error: null }`? (Silent failure?)
- The `import("./supabaseClient.js")` dynamic import in `handleAuthSubmit` — why dynamic instead of static? Could it fail?

**Quality:**
- `auth.js` builds modal HTML via template literals injected into `innerHTML` — is this an XSS vector? (Check: does username come from user input that goes into `innerHTML`?)
- Modal creation (lines 47-69): creates a new DOM element every time `showModal` is called if `#auth-modal` doesn't exist, but reuses if it does — is the cleanup reliable?
- No CSRF protection on auth requests — is this a concern with the current architecture?

- [ ] **Step 3: Append findings to the audit document**

Copy the section template. Fill in all tables. Update the Summary row.

- [ ] **Step 4: Verify and commit**

```bash
grep -c "## Auth & Networking" Projects/Stratego/code/docs/audits/2026-10-07__quality-audit.md
git add Projects/Stratego/code/docs/audits/2026-10-07__quality-audit.md
git commit -m "docs(audit): auth & networking review"
```

---

### Task 4: Audit Home & Entry Points

**Files:**
- Read: `Projects/Stratego/code/web/js/home.js` (187 lines)
- Read: `Projects/Stratego/code/web/index.html`
- Modify: `Projects/Stratego/code/docs/audits/2026-10-07__quality-audit.md` (append section)

**Interfaces:**
- Consumes: the audit document with prior sections
- Produces: a `## Home & Entry Points` section appended to the audit document

- [ ] **Step 1: Read both files end-to-end**

- [ ] **Step 2: Audit against this checklist**

**Bugs:**
- "Play vs Bot" flow (lines 69-87): creates a game, joins as bot, submits bot setup, then navigates. If any step fails partway, is the game left in a broken state? (e.g., bot joined but setup not submitted.)
- `storeSession` stores token for roomCode — if a roomCode collision ever happened, would the old token be overwritten silently?
- Leaderboard: `loadLeaderboard` fetches with `p_limit: 10` — the "20 games to appear" text in the HTML (line 51) claims a minimum, but is that enforced by the RPC?
- Spectate form navigates to `game.html` with the room code — what if the room doesn't exist? Does `game.js` handle that gracefully?

**Security:**
- Lines 31-42: Room code and invite URL go into `innerHTML` via template literals — if `roomCode` somehow contained HTML, this is injectable. Is `roomCode` always server-generated alphanumeric?
- Lines 159-166, 179-184: Leaderboard and micro-leaderboard render `p.username` inside `innerHTML` template literals — if a username contained HTML/JS, this is an XSS vector. Check: does the signup Edge Function sanitize usernames?

**UX:**
- "New Game" button is re-enabled in `finally` (line 50) — but the result area already shows the room code. If you click again, do you get a second room?
- No loading indicator on any network call.
- Join form: room code input has `maxlength="8"` and `autocapitalize="characters"` — does the server accept any length? Is the room code always 8 chars?

- [ ] **Step 3: Append findings, update Summary, commit**

```bash
git add Projects/Stratego/code/docs/audits/2026-10-07__quality-audit.md
git commit -m "docs(audit): home & entry points review"
```

---

### Task 5: Audit Setup Screen

**Files:**
- Read: `Projects/Stratego/code/web/js/setup.js` (443 lines)
- Read: `Projects/Stratego/code/web/js/formations.js`
- Read: `Projects/Stratego/code/web/js/formationRowMap.js` (14 lines)
- Read: `Projects/Stratego/code/web/setup.html`
- Modify: `Projects/Stratego/code/docs/audits/2026-10-07__quality-audit.md` (append section)

**Interfaces:**
- Consumes: the audit document with prior sections
- Produces: a `## Setup Screen` section appended to the audit document

- [ ] **Step 1: Read all files end-to-end**

- [ ] **Step 2: Audit against this checklist**

**Bugs:**
- `setup.js` line 222: Row labels are hardcoded as `String(7 + r)` — does this make sense for slot 2, whose territory is rows 0-3? Does the player see the wrong row numbers?
- `renderGrid` line 210: Column labels only populate if `colLabels.children.length === 0` — same guard for row labels. But `renderGrid` is called on every click. Is this optimization correct, or could it suppress a needed re-render?
- `applyFormation("random")` (line 270): Uses `Math.random()` for shuffle — is this fine for a client-side-only operation, or does it need to match the deterministic jitter pattern?
- Column mirroring for slot 2 (line 401): `const absCol = slot === 2 ? (9 - localCol) : localCol` — verify this matches `game.js`'s `toAbsolute` function.
- After submitting setup, `disableSetupUI` hides the submit button and shows "unsubmit" — but the grid is still interactive. Can you modify placements after submitting?
- Countdown timer (line 354): `Date.now() - new Date(bothSubmittedAt).getTime()` — timezone issues if server and client clocks differ significantly?
- `ensureSession` (line 59) does a top-level `await` — what happens if this fails? The page shows an error message but execution continues (`const token = await ensureSession()` would throw).

**Quality:**
- `initDifficultyControls` and `initPersonalityControls` are near-identical functions (lines 90-150) — DRY violation.
- `subscribeToGameUpdates` is called inside the submit handler — what if the user submits, unsubmits, and resubmits? Is the old channel cleaned up?
- The `formationIndex` object tracks cycling state — but it resets on page reload. Is that intentional?

- [ ] **Step 3: Append findings, update Summary, commit**

```bash
git add Projects/Stratego/code/docs/audits/2026-10-07__quality-audit.md
git commit -m "docs(audit): setup screen review"
```

---

### Task 6: Audit Game Screen

**Files:**
- Read: `Projects/Stratego/code/web/js/game.js` (667 lines)
- Read: `Projects/Stratego/code/web/game.html`
- Modify: `Projects/Stratego/code/docs/audits/2026-10-07__quality-audit.md` (append section)

**Interfaces:**
- Consumes: the audit document with prior sections
- Produces: a `## Game Screen` section appended to the audit document

- [ ] **Step 1: Read both files end-to-end**

- [ ] **Step 2: Audit against this checklist**

**Bugs / Race conditions:**
- Three redundant refresh mechanisms: Realtime subscription (line 626), 5-second `setInterval` polling (line 641), and `visibilitychange` handler (line 652). Could they fire simultaneously and cause flickering, duplicate bot moves, or state corruption?
- `botMoveScheduled` flag (line 57): set to `true` before `setTimeout`, reset in `.finally()`. But if `refreshGameRow` fires from the polling interval while the bot move is in-flight, could it schedule a second bot move? (The flag should prevent it, but trace the exact interleaving.)
- `makeBotMove` (line 226): 5 retry attempts with no backoff — is this appropriate?
- `handleCellClick` (line 481): no debouncing. If the user clicks rapidly during an async `callFunction("make-move")`, could a second click fire before the first resolves? What would happen?
- `refreshState` silently returns on error (line 76-77) — the user sees a stale board with no indication of failure.
- `setInterval` at line 641 is never cleared — if `init()` were called twice (e.g., hot-reload during dev), duplicate polling.
- The `getPostCombatRevealRank` function (line 292) only checks the LAST move in `lastMoveData`. If two combats happen in quick succession (bot game), does the first reveal get swallowed?

**Performance:**
- `renderBoard()` line 349: `[...piecesById.values()].find(p => p.row_idx === row && p.col_idx === col && p.alive)` — this is O(n) per cell, called 100 times per render = O(100n). Should use a position index (Map keyed by `"row,col"`).
- `renderBoard()` rebuilds the entire board DOM every time (line 339: `board.innerHTML = ""`). For a 10×10 grid that changes maybe 1-2 cells per move, this is wasteful.
- `renderGraveyards` (line 367) iterates all moves and all pieces on every call — O(moves × pieces).
- Column and row labels are rebuilt every `renderBoard` call (lines 320-336) even though they never change.

**UX:**
- Spectator: chat form is hidden (line 149), but the spectator's slot is 0 — does any other code assume slot is 1 or 2?
- Resign button shows `confirm()` dialog (line 555) — blocks the UI thread. Consider a custom modal.
- Game over: profile button is hidden if not logged in (line 128) — but it's already hidden by default in HTML?
- No indication of network errors during move submission beyond an `alert()`.
- `RANK_SHORT` (lines 10-17) has both string and number keys — intentional for loose matching, but fragile and duplicative.

**Gotchas:**
- `gameId` is module-scoped but set asynchronously in `init()` — any code that runs before `init` completes sees `null`.
- `lastMoveData` and `lastTurnSlot` are module-scoped mutable state — trace all mutation paths for consistency.

- [ ] **Step 3: Append findings, update Summary, commit**

```bash
git add Projects/Stratego/code/docs/audits/2026-10-07__quality-audit.md
git commit -m "docs(audit): game screen review"
```

---

### Task 7: Audit Bot AI System

**Files:**
- Read: `Projects/Stratego/code/web/js/bot.js` (182 lines)
- Read: `Projects/Stratego/code/web/js/pieceMemory.js` (82 lines)
- Read: `Projects/Stratego/code/web/js/pieceSuspicion.js` (32 lines)
- Read: `Projects/Stratego/code/web/js/deterministicJitter.js` (27 lines)
- Read: `Projects/Stratego/code/web/js/flagDefense.js` (103 lines)
- Read: `Projects/Stratego/code/test/web/bot.test.js`, `pieceMemory.test.js`, `pieceSuspicion.test.js`, `deterministicJitter.test.js`, `flagDefense.test.js`
- Modify: `Projects/Stratego/code/docs/audits/2026-10-07__quality-audit.md` (append section)

**Interfaces:**
- Consumes: the audit document with prior sections
- Produces: a `## Bot AI System` section appended to the audit document

- [ ] **Step 1: Read all 5 source files and all 5 test files end-to-end**

- [ ] **Step 2: Audit against this checklist**

**Correctness:**
- `chooseBotMove` (bot.js line 65): the `fullMoveHistory` filter for two-square-rule history (line 68-69) only keeps moves where the piece belongs to the bot. Is this correct per the two-square rule (which tracks per-player history)?
- `chooseBotMove` line 111: `pool = winning.length > 0 ? winning : safe.length > 0 ? safe : losing` — the bot will play a known-losing move rather than doing nothing. Is this correct? (Yes — no legal moves = loss, so any move is better. But verify.)
- Memory: `buildPieceMemory` (pieceMemory.js line 55) tracks both attacker and defender reveals. But the bot only sees `rank === null` for unrevealed pieces (it uses `get_game_state` which redacts). So memory gives the bot "remembered" ranks for pieces whose rank has reset to null in the game state. Is this correct behavior per the design spec? (Yes — this is the design intent. But verify the window math.)
- Memory window edge case (pieceMemory.js line 76): `window > 0 && age <= window` — at `age === 0` (the combat turn itself), the memory is active. At `age === window`, memory is still active. At `age === window + 1`, it expires. Is this off-by-one correct?
- Suspicion (pieceSuspicion.js line 19): `movedPieceIds` tracks ALL pieces that have EVER moved (both players). Line 23 checks `movedPieceIds.has(piece.id)` for opponent pieces. But `piece.id` is the `piece_id` from `get_game_state` — verify that the `move_number` rows in `fullMoveHistory` use the same `piece_id` values.
- Flag defense: `assessGuardSquares` (flagDefense.js line 61) uses `resolveCombat(effectiveRank, guardRank)` to check if a nearby enemy could beat the guard. But `effectiveRank` might be a weighted average (from `estimateUnknownEnemyRank`) — `resolveCombat` expects integer ranks. Does it handle a float like `5.3` correctly? (Check: `resolveCombat` uses `<` comparison — `5.3 < 7` is true, so it would "win." Is this the intended behavior?)
- `estimateUnknownEnemyRank` (flagDefense.js line 19): counts revealed ranks from combat history. But a piece can be revealed multiple times in different combats (e.g., attack and survive, then attack again). Does this overcount?

**Quality:**
- `defaultJitterSeed` (deterministicJitter.js line 17): the hash function `hash * 31 + charCode` — is this a good hash for this use case? Is the distribution reasonably uniform in [0, 1)?
- The bot has no concept of Scout multi-square movement — `getLegalMoves` handles it, but the bot's heuristics don't prefer long Scout moves for reconnaissance. Is this a missed opportunity?
- `bot.js` line 11: `ALL_FORMATIONS = [...DEFENSIVE_FORMATIONS, ...AGGRESSIVE_FORMATIONS]` — the bot picks randomly from all 28 formations. Should difficulty affect formation choice?

- [ ] **Step 3: Append findings, update Summary, commit**

```bash
git add Projects/Stratego/code/docs/audits/2026-10-07__quality-audit.md
git commit -m "docs(audit): bot AI system review"
```

---

### Task 8: Audit Profile, Stats & Analytics

**Files:**
- Read: `Projects/Stratego/code/web/js/profile.js` (590 lines)
- Read: `Projects/Stratego/code/web/js/gameSummary.js` (78 lines)
- Read: `Projects/Stratego/code/web/js/gameDetail.js` (351 lines)
- Read: `Projects/Stratego/code/web/profile.html`
- Read: `Projects/Stratego/code/web/game-detail.html`
- Modify: `Projects/Stratego/code/docs/audits/2026-10-07__quality-audit.md` (append section)

**Interfaces:**
- Consumes: the audit document with prior sections
- Produces: a `## Profile, Stats & Analytics` section appended to the audit document

- [ ] **Step 1: Read all files end-to-end**

- [ ] **Step 2: Audit against this checklist**

**Bugs:**
- `profile.js` line 18: `loadProfile(username)` calls `supabase.rpc("get_player_profile")` — what happens if the username has special characters? Is it SQL-injection safe? (RPC params are parameterized, but check.)
- `renderStats` builds ~12 collapsible sections with 36+ stats — are any division-by-zero cases missed? (Look for patterns like `stats.X > 0 ? (stats.Y / stats.X) : "—"` and check if any skip the guard.)
- `loadMaterialCurves` (line 580): fires `Promise.all` over ALL game history rows to fetch sparklines — if a player has 100+ games, that's 100+ simultaneous RPC calls. Rate limiting? Supabase free tier limits?
- `renderRadar` (line 328): `Math.max(0.05, a.value)` clamps the minimum dot position — but if all values are 0, the radar still renders (as a tiny polygon). Is this the right UX for a player with no data?
- `gameDetail.js`: `renderTerritory` (line 273) normalizes legacy data shape — but the normalization always sets lane values to 0. Are real lane values ever populated?

**Security:**
- `profile.js` line 565: `onclick="location.href='game-detail.html?id=${g.game_id}&slot=${g.player_slot}'"` — this `onclick` is injected via `innerHTML`. If `game_id` were user-controlled (it's a UUID, but check), this could be an injection point.
- Username rendered throughout via `innerHTML` — same XSS concern as home.js.

**Quality:**
- `profile.js` is 590 lines in one file — should it be split? (e.g., radar, heatmap, achievements, history could be separate modules.)
- `RANK_NAME` and `RANK_DISPLAY` are defined in multiple files (`token.js`, `gameDetail.js`, `profile.js`) with slightly different shapes — DRY violation.
- Multiple sequential `supabase.rpc()` calls in `loadProfile` that could be parallelized.
- `gameSummary.js` and `gameDetail.js` both render SVG charts with nearly identical line-chart logic — candidate for extraction.
- Head-to-head (`renderHeadToHead`, line 40): fetches the logged-in user's profile just to get their `player.id` — is there a lighter-weight way?

- [ ] **Step 3: Append findings, update Summary, commit**

```bash
git add Projects/Stratego/code/docs/audits/2026-10-07__quality-audit.md
git commit -m "docs(audit): profile, stats & analytics review"
```

---

### Task 9: Audit Token Rendering & Audio

**Files:**
- Read: `Projects/Stratego/code/web/js/token.js` (67 lines)
- Read: `Projects/Stratego/code/web/js/audio.js` (202 lines)
- Modify: `Projects/Stratego/code/docs/audits/2026-10-07__quality-audit.md` (append section)

**Interfaces:**
- Consumes: the audit document with prior sections
- Produces: a `## Token Rendering & Audio` section appended to the audit document

- [ ] **Step 1: Read both files end-to-end**

- [ ] **Step 2: Audit against this checklist**

**Token rendering:**
- `createTokenSVG` (token.js line 32): generates a unique `arcId` per call using `Math.random().toString(36).slice(2, 8)`. In `renderBoard()` (100 cells × potentially 40 pieces), this generates many random IDs per render. Collision risk? Also: these IDs are never cleaned up — SVG `<defs>` accumulate if `innerHTML` isn't cleared.
- `RANK_NAME` and `RANK_CENTER` both have string AND number keys (lines 3-9, 12-19) — same pattern as `RANK_SHORT` in `game.js`. Why? Is this to handle both `rank = 1` and `rank = "1"` from different sources? Document the gotcha.
- `darkenColor` (line 26): subtracts `0x20` from each RGB channel — doesn't account for hex values below `0x20` (returns negative, but `Math.max(0, ...)` handles it). Verify.
- Bomb and Flag use emoji (`💣`, `🚩`) as center text (line 16) — emoji rendering varies across browsers/OS. Is this visually consistent?
- Token is an SVG element created with `document.createElementNS` but inner content is set via `innerHTML` (line 61) — this works but mixes DOM creation patterns.

**Audio:**
- `initAudio` (audio.js line 62): creates `AudioContext` — browsers require a user gesture before this works. The function is called in `game.js`'s `init()` which runs on page load. Does `ctx.state === 'suspended'` + `ctx.resume()` handle this correctly, or will it fail on first load?
- `setupMusicElement` (line 53): creates an `<audio>` element and connects it to `ctx.createMediaElementSource()` — but `musicElement` is never added to the DOM. Is that correct for a `MediaElementSource`? (Yes — it plays through the AudioContext graph, not the DOM. But document this gotcha.)
- SFX files are loaded via `fetch` + `decodeAudioData` (lines 86-93) — all loaded upfront on `initAudio`. For a game where some sounds may never play, is lazy loading better?
- `playSynthClick` and `playSynthChime` (lines 122-148): create oscillators that are started and stopped immediately — these are fire-and-forget with no cleanup. Verify they're garbage collected properly.
- `state` is module-scoped mutable (line 43: `let state = loadState()`) — loaded once on module init. If `localStorage` changes from another tab, this state goes stale.
- Exported `toggleMuteSfx` and `toggleMuteMusic` (lines 176, 182) exist but are never called from any file — dead code?

- [ ] **Step 3: Append findings, update Summary, commit**

```bash
git add Projects/Stratego/code/docs/audits/2026-10-07__quality-audit.md
git commit -m "docs(audit): token rendering & audio review"
```

---

### Task 10: Audit HTML, CSS & Accessibility

**Files:**
- Read: `Projects/Stratego/code/web/index.html`
- Read: `Projects/Stratego/code/web/setup.html`
- Read: `Projects/Stratego/code/web/game.html`
- Read: `Projects/Stratego/code/web/profile.html`
- Read: `Projects/Stratego/code/web/game-detail.html`
- Read: `Projects/Stratego/code/web/css/styles.css` (1203 lines)
- Modify: `Projects/Stratego/code/docs/audits/2026-10-07__quality-audit.md` (append section)

**Interfaces:**
- Consumes: the audit document with prior sections
- Produces: a `## HTML, CSS & Accessibility` section appended to the audit document

- [ ] **Step 1: Read all 5 HTML files and the CSS file end-to-end**

- [ ] **Step 2: Audit against this checklist**

**Accessibility:**
- Do all interactive elements (buttons, links, form inputs) have visible focus styles? Check `:focus` in CSS.
- Board cells are `<div>` elements with click handlers — they need `role="button"`, `tabindex="0"`, and keyboard event handlers for accessibility. Do they have any?
- Are `aria-label` or `aria-describedby` used anywhere? (Board cells with pieces should be announced by screen readers.)
- Color contrast: the wood theme (`--wood-dark: #3e2f1c`, `--ink: #efe6d8`) — check contrast ratio meets WCAG AA (4.5:1 for normal text).
- Tooltip text uses `data-tooltip` with CSS `::after` pseudo-element — these are invisible to screen readers.
- Are there any `alt` attributes on images? (There are no `<img>` tags — tokens are SVG — but check.)

**CSS:**
- `.modal-overlay` is defined TWICE (lines ~790 and ~908) with different positioning approaches (`inset: 0` vs `top/left/right/bottom: 0`). The second definition overrides the first. Is this intentional or a merge artifact?
- The `[hidden]` override (line 800: `.modal-overlay[hidden] { display: none; }`) — is this applied consistently for ALL modals, or only the rematch modal? The auth modal at line 908 redefines `.modal-overlay` without a `[hidden]` override.
- `--cell-size: 64px` is set as a minimum width (line 534: `min-width: var(--cell-size)`) — on mobile (`--cell-size: 40px`), does the 10-column grid still fit in viewport?
- Is there a print stylesheet or any `@media print` rules? (Probably not needed, but note if absent.)

**HTML:**
- Do all pages have proper `<meta>` tags (charset, viewport)?
- Are any pages missing `<lang>` attribute on `<html>`?
- Do forms have proper `<label>` elements for their inputs?
- Is there any `<noscript>` fallback?

**Mobile:**
- The `@media (max-width: 700px)` breakpoint — is 700px the right threshold? Test common widths (375px iPhone, 414px iPhone Plus).
- Game layout switches from 2-column grid to single column — does the side panel (move log, chat) end up below the board or above?
- Setup layout: piece sidebar stacks above the grid on mobile (line 432-444) — with 12 piece types, does this push the grid off-screen?

- [ ] **Step 3: Append findings, update Summary, commit**

```bash
git add Projects/Stratego/code/docs/audits/2026-10-07__quality-audit.md
git commit -m "docs(audit): HTML, CSS & accessibility review"
```

---

### Task 11: Test Suite Gap Analysis

**Files:**
- Read: `Projects/Stratego/code/test/rules/board.test.js`
- Read: `Projects/Stratego/code/test/rules/pieces.test.js`
- Read: `Projects/Stratego/code/test/rules/combat.test.js`
- Read: `Projects/Stratego/code/test/rules/movement.test.js`
- Read: `Projects/Stratego/code/test/rules/twoSquareRule.test.js`
- Read: `Projects/Stratego/code/test/rules/game.test.js`
- Read: `Projects/Stratego/code/test/web/bot.test.js`
- Read: `Projects/Stratego/code/test/web/pieceMemory.test.js`
- Read: `Projects/Stratego/code/test/web/pieceSuspicion.test.js`
- Read: `Projects/Stratego/code/test/web/deterministicJitter.test.js`
- Read: `Projects/Stratego/code/test/web/flagDefense.test.js`
- Read: `Projects/Stratego/code/supabase/functions/_shared/information-warfare.test.ts`
- Modify: `Projects/Stratego/code/docs/audits/2026-10-07__quality-audit.md` (append section)

**Interfaces:**
- Consumes: the audit document with prior sections
- Produces: a `## Test Suite Gap Analysis` section appended to the audit document

- [ ] **Step 1: Read all 12 test files end-to-end**

- [ ] **Step 2: Run the test suite**

Run: `cd Projects/Stratego/code && node --test`
Record: total tests, pass count, fail count, any skipped.

- [ ] **Step 3: Audit against this checklist**

**Coverage mapping:**
- For each source file in `web/js/`, determine if a corresponding test file exists. Build a table:

| Source File | Test File | Tested? | Notes |
|---|---|---|---|
| `rules/board.js` | `test/rules/board.test.js` | ✅ | |
| `rules/pieces.js` | `test/rules/pieces.test.js` | ✅ | |
| ... | ... | ... | |
| `game.js` | *(none)* | ❌ | 667 lines, no tests |
| `setup.js` | *(none)* | ❌ | 443 lines, no tests |
| `auth.js` | *(none)* | ❌ | 102 lines, no tests |
| `home.js` | *(none)* | ❌ | 187 lines, no tests |
| ... | | | |

**Test quality:**
- For each test file, check: are there tests for edge cases (empty inputs, boundary values, error paths)?
- Are there tests that only test the happy path?
- Are any tests fragile (dependent on timing, random values, or global state)?
- Are there tests that assert implementation details instead of behavior?
- Do test descriptions clearly state what's being tested?

**Missing test categories:**
- List the top 5 most impactful missing tests (areas where bugs have historically been found, per PROJECT_MEMORY).
- Specifically check: are there tests for the row-mapping logic? (This was the source of multiple bugs.)
- Are there tests for the graveyard rendering logic?
- Are there integration-style tests that test multiple modules together?

- [ ] **Step 4: Append findings, update Summary, commit**

```bash
git add Projects/Stratego/code/docs/audits/2026-10-07__quality-audit.md
git commit -m "docs(audit): test suite gap analysis"
```

---

### Task 12: Cross-Cutting Patterns & Final Summary

**Files:**
- Read: ALL source files in `Projects/Stratego/code/web/js/` (skim, don't deep-dive — prior tasks have detailed findings)
- Modify: `Projects/Stratego/code/docs/audits/2026-10-07__quality-audit.md` (append section + update Summary table)

**Interfaces:**
- Consumes: the full audit document with all prior sections
- Produces: a `## Cross-Cutting Patterns` section + a finalized Summary table at the top

- [ ] **Step 1: Read the entire audit document so far (all prior sections)**

- [ ] **Step 2: Skim all source files looking for cross-cutting patterns**

**Checklist — these are patterns that span multiple files and wouldn't be caught by per-file audits:**

- **Naming inconsistency:** Is `rank` always a number in some files and a string in others? Map the convention per file. (Known: `pieces.js` uses `RANK.MARSHAL = 1` as number, but formations and game state pass ranks as strings like `"1"`. Who normalizes?)
- **DRY violations across files:** `RANK_NAME` / `RANK_SHORT` / `RANK_DISPLAY` / `RANK_CENTER` — how many different rank-to-label maps exist? List them all with file locations.
- **Error handling patterns:** How do different files handle Supabase errors? (Some `console.error` and return silently; some `alert()`; some throw. Is there a consistent pattern?)
- **`innerHTML` usage:** List every file that uses `innerHTML` with interpolated data. Assess XSS risk for each.
- **Module-scoped mutable state:** List every `let` at module scope across all files. These are implicit global state — are any prone to stale reads or race conditions?
- **Dead code:** Are there exported functions that no other file imports? Are there event listeners for elements that don't exist on certain pages?
- **Hardcoded values:** Supabase URL/key (intentional), magic numbers (board size 10, army size 40, difficulty thresholds), room code length — should any be constants?
- **Browser compatibility:** `esm.sh` import for Supabase client, ES module syntax, `structuredClone`, `navigator.clipboard`, `AudioContext` — what's the minimum browser version?

- [ ] **Step 3: Append the Cross-Cutting Patterns section**

- [ ] **Step 4: Update the Summary table at the top of the document**

Go back to the `## Summary` table and fill in every row with the counts from each section:

| Area | Bugs | Quality Issues | Gotchas | Recommendations |
|------|------|----------------|---------|-----------------|
| Rules Engine | X | X | X | X |
| Auth & Networking | X | X | X | X |
| ... | ... | ... | ... | ... |
| **TOTAL** | **X** | **X** | **X** | **X** |

- [ ] **Step 5: Add a Top 10 Priority Fixes section at the very end**

Rank the 10 most impactful findings from across ALL sections by: (severity × effort-to-fix ratio). Format:

```markdown
## Top 10 Priority Fixes

| Priority | Area | Description | Severity | Effort | Location |
|----------|------|-------------|----------|--------|----------|
| 1 | ... | ... | CRITICAL | trivial | `file.js:N` |
```

- [ ] **Step 6: Commit**

```bash
git add Projects/Stratego/code/docs/audits/2026-10-07__quality-audit.md
git commit -m "docs(audit): cross-cutting patterns & final summary"
```
