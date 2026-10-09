---
tags: [project/stratego]
---

# PMStratego: Quality Fixes & React/TS Migration

> **Pole star document.** This is the guiding vision for the next major push on PMStratego. Every implementation plan, design spec, and task list should reference back to this.

## Why

The Oct 7 quality audit (`docs/audits/2026-10-07__quality-audit.md`) found **22 bugs, 57 quality issues, and 35 gotchas** across the vanilla JS codebase. The structural root causes — `innerHTML`-based rendering, no type system, imperative DOM manipulation, module-scoped mutable state with no coordination — mean that fixing individual bugs on the current stack leaves the same bug *classes* alive for the next feature to reintroduce.

A React + TypeScript migration addresses the root causes:

| Root cause | Current stack | After migration |
|---|---|---|
| XSS via `innerHTML` (9 HIGH findings) | Every render path hand-interpolates untrusted data into `innerHTML` | JSX auto-escapes by default; `dangerouslySetInnerHTML` is an explicit opt-in |
| Type confusion (string `"1"` vs number `1` ranks) | Runtime-only, caught only by tests that happen to exist | Compile-time via TypeScript; a `Rank` union type makes illegal states unrepresentable |
| Full DOM rebuild per render (`renderBoard` = O(100n)) | Imperative `board.innerHTML = ""` on every state change | React reconciliation diffs only changed cells |
| Race conditions from uncoordinated refresh | 3 redundant pipelines mutating shared module-scope `let`s | React state + `useEffect` with cleanup; one source of truth |
| No accessibility (board cells = bare `<div>`) | Retrofit `role`, `tabindex`, `aria-label` onto imperative DOM | Bake into `<BoardCell>` component once, every instance inherits |
| Duplicated constants (`RANK_NAME` in 4 files) | Manual copy-paste, no enforcement | Single `types.ts` export, import everywhere |
| 590-line monolith (`profile.js`) | One file, one giant function | Decomposed into focused components, each independently testable |

## Constraints (unchanged)

- **$0/month hosting.** Vite builds to static files → Render Static Site (same deploy model as today).
- **Supabase free tier.** Postgres + Edge Functions + Realtime. No backend server.
- **No Supabase Auth.** Custom JWT (username + bcrypt + djwt). This stays.
- **Rules engine is pure logic.** TypeScript types added; logic untouched. 146 existing tests must stay green throughout.
- **Edge Functions are TypeScript already.** Out of scope for the frontend migration (they're already TS/Deno). The triple-copy rules-engine sync issue is addressed in Phase 1.

---

## Phase 1: Critical Bug Fixes (vanilla JS)

**Goal:** Ship fixes for all CRITICAL and HIGH findings on the *current* stack, so production is safe while Phase 2 is in progress.

**Approach:** Fix-and-deploy on the existing vanilla JS codebase. No architecture changes. These are targeted, file-level patches.

### Scope

| # | Finding | Severity | Location | Fix shape |
|---|---------|----------|----------|-----------|
| 1 | `bot.test.js` regression test silently broken (asserts pre-fix values) | CRITICAL | `test/web/bot.test.js:17-20` | Fix the assertion to match post-column-mirror behavior |
| 2 | `node --test` false-fails on Deno-only `information-warfare.test.ts` | HIGH | `supabase/functions/_shared/information-warfare.test.ts` | Exclude from `node --test` (move or rename) |
| 3 | Leaderboard empty-state copy claims false "20 games" rule | HIGH | `web/index.html:52` | One-line text change |
| 4 | Setup row labels wrong for slot 2 | HIGH | `web/js/setup.js:217-224` | Use `ABSOLUTE_ROWS[r] + 1` instead of `7 + r` |
| 5 | XSS via `innerHTML` with unescaped usernames (4 render paths) | HIGH | `auth.js:31`, `home.js:160,181`, `profile.js:59,167,550`, `gameDetail.js:53,59,61` | Shared `escapeHtml()` helper or `textContent` |
| 6 | `callFunction` null-data crash path | HIGH | `supabaseClient.js:12-30` | Validate `data` before returning |
| 7 | `AudioContext.resume()` outside user gesture (Safari) | HIGH | `audio.js:62-98` | Defer `resume()` to first user interaction |
| 8 | `gameDetail.js` unguarded `by_capture_quarter` render crash | HIGH | `gameDetail.js:224-237` | Guard with `?.` or existence check |
| 9 | `game.js` stale `refreshGameRow` from out-of-order responses | HIGH | `game.js:83-106` | Monotonic turn-number guard |
| 10 | Play-vs-Bot partial failure leaves orphaned game | HIGH | `home.js:69-87` | Cleanup on failure or resume-on-retry |
| 11 | Triple-copy rules engine with no sync mechanism | HIGH | `web/js/rules/`, `src/rules/`, `supabase/functions/_shared/rules/` | Single canonical source + symlinks or build step |

### Not in Phase 1

- Performance issues (DOM rebuild, O(100n) board render) → solved structurally by Phase 2
- Accessibility (keyboard nav, ARIA) → baked into React components in Phase 2
- DRY violations (duplicated rank maps, duplicate SVG chart code) → resolved by shared TS modules in Phase 2
- Module-scoped mutable state / race conditions → replaced by React state in Phase 2
- Dead code (`toggleMuteSfx`, `toggleMuteMusic`) → cleaned up during Phase 2 migration
- Missing test coverage for UI files → React components get proper test coverage in Phase 2

---

## Phase 2: React + TypeScript Migration

**Goal:** Rewrite the frontend as a React + TypeScript SPA built with Vite, deployed as a Render Static Site. Fix all remaining MEDIUM/LOW audit findings during the migration. Result: a modern, type-safe, accessible, maintainable codebase.

### Tech Stack

| Concern | Choice | Why |
|---------|--------|-----|
| Framework | React 18+ | Declarative rendering, component model, ecosystem |
| Language | TypeScript (strict) | Compile-time type safety, especially for the rank/slot confusion |
| Build | Vite | Fast, zero-config for React+TS, builds to static files |
| Routing | React Router v6 | 5 pages, client-side routing, no SSR needed |
| State | React state + context | Server-owned state via Supabase; no Redux/Zustand needed |
| Supabase | `@supabase/supabase-js` v2 (typed) | Already used; add generated DB types |
| Styling | CSS Modules or the existing `styles.css` (pragmatic) | The wood theme CSS works; no need for a CSS-in-JS rewrite |
| Testing | Vitest + React Testing Library | Vite-native, same API as Jest, component testing |
| Deployment | `vite build` → `dist/` → Render Static Site | Same $0/month model, same deploy pipeline |

### Component Architecture

```
App
├── Layout
│   ├── NavBar (auth-aware: login/signup modals, username, logout)
│   └── Outlet (React Router)
│
├── HomePage
│   ├── CreateGamePanel
│   ├── PlayBotPanel
│   ├── SpectatePanel
│   ├── JoinGamePanel
│   └── Leaderboard (tabs: Rating, Spy%, Trade King, etc.)
│
├── SetupPage
│   ├── PieceSidebar (tray of available pieces)
│   ├── SetupGrid (4×10 placement grid)
│   ├── FormationControls (defensive/aggressive/random/clear)
│   ├── ColorPicker
│   ├── DifficultySelector (bot games only)
│   ├── PersonalitySelector (bot games only)
│   └── SubmitControls (submit/unsubmit/countdown)
│
├── GamePage
│   ├── Board (10×10, accessible cells with keyboard nav)
│   ├── GraveyardTray (× 2: enemy + mine, collapsible)
│   ├── SidePanel
│   │   ├── TurnIndicator
│   │   ├── GameActions (resign, rematch, home, profile)
│   │   ├── MoveLog
│   │   ├── ChatLog + ChatInput
│   │   └── AudioControls
│   └── RematchModal
│
├── ProfilePage
│   ├── ProfileHeader (username, rating, archetype badges)
│   ├── HeadToHead (vs logged-in user)
│   ├── RadarChart (SVG, "Your Stratego DNA")
│   ├── StatsSections (12 collapsible sections, 36+ metrics)
│   ├── CombatHeatmap (SVG 10×10)
│   ├── PieceFate (kills/deaths bar charts)
│   ├── AchievementsGrid
│   └── GameHistory (table + material sparklines)
│
└── GameDetailPage
    ├── GameHeader (players, result, view toggle)
    ├── StoryHighlights
    ├── MaterialCurve (SVG line chart)
    ├── InfoEdgeCurve
    ├── CompositionalKnowledgeCurve
    ├── PhaseBreakdown (table)
    ├── PieceCareers (table)
    └── TerritoryTimeline (SVG multi-line)
```

### Shared TypeScript Modules

These are **renamed and typed**, not rewritten:

```
src/
├── types.ts              — Rank, Slot, GameStatus, Piece, GameRow, etc.
├── rules/                — board.ts, pieces.ts, movement.ts, combat.ts,
│                           twoSquareRule.ts, game.ts (pure logic, unchanged)
├── bot/                  — bot.ts, pieceMemory.ts, pieceSuspicion.ts,
│                           deterministicJitter.ts, flagDefense.ts
├── lib/
│   ├── supabaseClient.ts — typed Supabase client + callFunction
│   ├── auth.ts           — session management (context-based, not localStorage reads)
│   ├── formations.ts     — formation catalog data
│   └── formationRowMap.ts
└── hooks/
    ├── useGameState.ts   — Supabase RPC + Realtime subscription + polling fallback
    ├── useAuth.ts        — auth context consumer
    └── useAudio.ts       — AudioContext lifecycle (user-gesture-aware)
```

### Migration Sequence

The migration is **page by page**, with the old vanilla JS files kept alongside until all pages are ported, then removed in a cleanup task.

1. **Scaffold** — Vite + React + TS + Router. Verify `vite build` produces static files deployable to Render.
2. **Shared types & modules** — `types.ts`, rename rules engine to `.ts`, add types. All 146 tests green via Vitest.
3. **Layout + Auth** — `<Layout>`, `<NavBar>`, auth context + modals. First thing visible in the app.
4. **HomePage** — Create/join/spectate/leaderboard. Replace `home.js` + `index.html`.
5. **SetupPage** — Piece placement, formations, color picker, bot controls, countdown. Replace `setup.js` + `setup.html`.
6. **GamePage** — The big one. Board, graveyards, side panel, bot moves, Realtime, audio. Replace `game.js` + `game.html`.
7. **ProfilePage** — Stats, charts, achievements, history. Replace `profile.js` + `profile.html`.
8. **GameDetailPage** — Curves, phase breakdown, piece careers, territory. Replace `gameDetail.js` + `game-detail.html`.
9. **Cleanup** — Remove old `web/js/`, `web/css/`, `web/*.html`. Verify deploy. Update Render build command.

### Audit Findings Addressed Per Phase-2 Task

| Task | Findings resolved (by migration) |
|------|----------------------------------|
| Scaffold | — |
| Shared types | Rules engine triple-copy (single source), rank string/number confusion (typed `Rank` union), duplicated `RANK_NAME` (single export) |
| Layout + Auth | XSS in nav (JSX escaping), JWT expiry check, circular import (React context replaces it) |
| HomePage | XSS in leaderboard, double-create-game race, loading indicators |
| SetupPage | Grid still editable after submit, double-submit race, leaked Realtime channel, DRY (difficulty/personality), duplicate row-mapping logic |
| GamePage | O(100n) board render (React reconciliation), stale-refresh race (React state), no click debounce (in-flight guard in hook), duplicate render cycles, `setInterval` leak, spectator edge cases, `confirm()` → modal, dead audio exports |
| ProfilePage | 590-line monolith → components, duplicate SVG chart logic → shared `<LineChart>`, unbounded sparkline fetch parallelism, division-by-zero guards |
| GameDetailPage | Unguarded phase-stats crash, duplicate chart code, territory legacy normalization |
| Cleanup | Dead code removal, verify no old files remain |

---

## What Success Looks Like

- [ ] Phase 1 shipped: all CRITICAL/HIGH bugs fixed on vanilla JS, deployed to production, verified with a real two-player game.
- [ ] Phase 2 shipped: all 5 pages ported to React/TS. Vite build → Render Static Site, same URL.
- [ ] All 146 existing rules-engine tests pass in Vitest (renamed `.test.ts`).
- [ ] Zero `innerHTML` in the codebase (all rendering via JSX).
- [ ] `RANK` and `Slot` are TypeScript types — no string/number confusion possible.
- [ ] Board cells are keyboard-navigable with ARIA labels.
- [ ] `tsc --noEmit` passes with strict mode.
- [ ] The audit document's Top 10 Priority Fixes are all addressed.
- [ ] A real two-player game works end-to-end on the new stack (create → join → setup → play → resign/rematch).
- [ ] Bot game works (Easy/Medium/Hard × Aggressive/Neutral/Defensive).
- [ ] Profile page renders all 36 stats, 12 achievements, radar chart, heatmap, sparklines.
- [ ] $0/month hosting preserved (Render Static Site + Supabase free tier).

---

## References

- Quality audit: `docs/audits/2026-10-07__quality-audit.md`
- Original design spec: `docs/superpowers/specs/2026-07-10-stratego-design.md`
- Bot difficulty spec: `docs/superpowers/specs/2026-07-12-bot-difficulty-design.md`
- Player accounts spec: `docs/superpowers/specs/2026-07-31-player-accounts-stats-design.md`
- Project memory: `Projects/Stratego/PROJECT_MEMORY.md`
