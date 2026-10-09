# Phase 2: React + TypeScript Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the PMStratego frontend as a React + TypeScript SPA built with Vite, deployed as a Render Static Site ($0/month). Fix all remaining MEDIUM/LOW audit findings structurally during the migration.

**Architecture:** Page-by-page migration. The old vanilla `web/` files coexist with the new `src/` tree until all 5 pages are ported, then a single cutover switches Render's publish path from `./web` to `./dist`. Pure-logic modules (rules engine, bot AI) are renamed to `.ts` and typed — logic unchanged. UI files are rewritten as React components. One global `styles.css` imported from Vite.

**Tech Stack:** React 18, TypeScript (strict), Vite, React Router v6, `@supabase/supabase-js` v2, Vitest + React Testing Library, existing `styles.css`.

## Global Constraints

- **$0/month hosting.** `vite build` → `dist/` → Render Static Site.
- **Do not switch Render's `staticPublishPath`** until all 5 routes work (Task 12).
- **125 existing tests** must stay green throughout (the pole star's "146" is incorrect — see recon).
- **22 achievements**, not 12. Port the full `ACHIEVEMENT_LABELS` map.
- **Rank type boundary:** Postgres returns ranks as text strings. `normalizeRank` at the RPC boundary converts to the `Rank` union (`1|2|…|10|"BOMB"|"FLAG"`). Do not type RPC responses as `Rank` directly.
- **Two piece shapes:** `FogPiece` (RPC: `piece_id`, `row_idx`, `col_idx`, `is_mine`) vs `RulesPiece` (engine: `id`, `playerSlot`, `row`, `col`). Do not conflate them.
- **Keep `styles.css` global.** Import from Vite entry. Page-scope via root class (`.home`, `.setup`, `.game`, etc.). No CSS Modules in this migration.
- **Dead code to drop:** `toggleMuteSfx`, `toggleMuteMusic`, `stopMusic`, `isMusicPlaying`, `flagCaptured.mp3` (loaded, never played), `infoEdgeSparkline` (no callers).
- **Recon report:** `.superpowers/sdd/phase2-recon-report.md` — the source of truth for every Supabase call signature, state variable, and DOM pattern referenced below.

---

### Task 1: Vite + React + TypeScript Scaffold

**Files:**
- Create: `package.json` (update — add React, Vite, TS, Router, Vitest deps)
- Create: `tsconfig.json`, `tsconfig.node.json`
- Create: `vite.config.ts`
- Create: `index.html` (Vite entry — SPA shell)
- Create: `src/main.tsx` (React root + Router)
- Create: `src/App.tsx` (route definitions — placeholders)
- Create: `src/vite-env.d.ts`
- Modify: `.gitignore` (add `dist/`)
- Move: `web/css/styles.css` → `src/styles.css` (copy, keep original for coexistence)
- Move: `web/fonts/` → `public/fonts/`
- Move: `web/audio/` → `public/audio/`

**Interfaces:**
- Consumes: nothing
- Produces: `npm run dev` serves a React SPA at localhost; `npm run build` produces `dist/` with `index.html`; all existing `npm test` tests still pass

- [ ] **Step 1: Install dependencies**

```bash
npm install react react-dom react-router-dom @supabase/supabase-js
npm install -D @types/react @types/react-dom typescript vite @vitejs/plugin-react vitest @testing-library/react @testing-library/jest-dom jsdom
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create vite.config.ts**

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'test/**/*.test.{js,ts}'],
  },
});
```

- [ ] **Step 4: Create the SPA entry HTML**

Create `index.html` at the repo root (Vite convention):

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Stratego</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.tsx"></script>
</body>
</html>
```

- [ ] **Step 5: Create src/main.tsx**

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
```

- [ ] **Step 6: Create src/App.tsx with placeholder routes**

```tsx
import { Routes, Route } from 'react-router-dom';

function Placeholder({ name }: { name: string }) {
  return <div className="page-shell"><div className="page-frame"><h1>{name}</h1><p>Coming soon.</p></div></div>;
}

export function App() {
  return (
    <Routes>
      <Route index element={<Placeholder name="Home" />} />
      <Route path="setup" element={<Placeholder name="Setup" />} />
      <Route path="game" element={<Placeholder name="Game" />} />
      <Route path="profile" element={<Placeholder name="Profile" />} />
      <Route path="game-detail" element={<Placeholder name="Game Detail" />} />
    </Routes>
  );
}
```

- [ ] **Step 7: Copy CSS and static assets**

```bash
cp web/css/styles.css src/styles.css
mkdir -p public/fonts public/audio
cp web/fonts/* public/fonts/
cp web/audio/* public/audio/
```

Fix the font URL in `src/styles.css` — change line 3 from `url('../fonts/UnifrakturMaguntia.woff2')` to `url('/fonts/UnifrakturMaguntia.woff2')` (Vite serves `public/` at root).

- [ ] **Step 8: Create src/vite-env.d.ts**

```ts
/// <reference types="vite/client" />
```

- [ ] **Step 9: Add dist/ to .gitignore**

Append `dist/` to `.gitignore`.

- [ ] **Step 10: Update package.json scripts**

Add these scripts (keep existing `test`, `test:deno`, `sync-rules`):

```json
"dev": "vite",
"build": "tsc -b && vite build",
"preview": "vite preview"
```

- [ ] **Step 11: Verify the build works**

Run: `npm run build`
Expected: `dist/` created with `index.html` and `assets/`.

Run: `npm run preview`
Expected: Opens at localhost:4173 and shows placeholder routes.

Run: `npm test`
Expected: Still 125 tests passing (Vitest runs both old `test/` and new `src/` tests).

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "feat: scaffold Vite + React + TS + Router (SPA shell, coexists with web/)"
```

---

### Task 2: Shared Types + Rules Engine to TypeScript

**Files:**
- Create: `src/types.ts`
- Create: `src/lib/normalizeRank.ts`
- Create: `src/lib/normalizeRank.test.ts`
- Rename: `src/rules/*.js` → `src/rules/*.ts` (add types, logic unchanged)
- Modify: `test/rules/*.test.js` → update import paths (`.js` → `.ts` or extensionless)
- Modify: `scripts/sync-rules.sh` — emit JS from TS for the Deno copy
- Modify: `test/rules/copies.test.js` — compare TS source to JS copies

**Interfaces:**
- Consumes: Task 1 scaffold
- Produces: `Rank`, `Slot`, `Square`, `SquareKey`, `RulesPiece`, `FogPiece`, `GameRow`, `GameState`, `CombatOutcome`, `Difficulty`, `Personality`, `Formation`, `FormationCell`, `BotMoveRow`, `normalizeRank()`. All 125+ tests green.

- [ ] **Step 1: Create src/types.ts**

This is the single source of truth for all types across the app. See the recon report §4 for every type. Write the full file with:

- `Rank = 1|2|3|4|5|6|7|8|9|10|"BOMB"|"FLAG"`
- `NumericRank = 1|2|3|4|5|6|7|8|9|10`
- `Slot = 1 | 2`
- `Square = { row: number; col: number }`
- `SquareKey = string` (for `"row,col"` used in two-square rule history — NOT `Square`)
- `GameStatus = "setup" | "active" | "finished"`
- `Difficulty = "easy" | "medium" | "hard"`
- `Personality = "aggressive" | "neutral" | "defensive"`
- `CombatOutcome = "ATTACKER_WINS" | "DEFENDER_WINS" | "TIE"`
- `RulesPiece = { id: string; playerSlot: Slot; rank: Rank; row: number; col: number; alive: boolean }`
- `FogPiece = { piece_id: string; player_slot: Slot; rank: string | null; row_idx: number; col_idx: number; alive: boolean; is_mine: boolean }`
- `GameRow = { id?: string; status: GameStatus; current_turn_slot: Slot | null; turn_number: number; winner_slot: Slot | null; is_bot_game: boolean; bot_difficulty: Difficulty | null; bot_personality: Personality | null; rematch_room_code: string | null }`
- `BotMoveRow` — the moves-table subset needed by the bot (see recon §4)
- `MoveRow` — the move-log subset used by the UI
- `ChatMessage = { player_slot: Slot; body: string; created_at: string }`
- `CombatResult = { outcome: CombatOutcome; attackerRank: Rank | string; defenderRank: Rank | string; defenderPieceId: string } | null`
- `FormationCell = [localRow: number, localCol: number, rank: string]`
- `Formation = { name: string; cells: FormationCell[] }`
- Rank label maps: `RANK_NAME: Record<string | number, string>`, `RANK_SHORT: Record<string | number, string>`, `RANK_ABBR` — consolidate the 4 duplicated maps into one file

- [ ] **Step 2: Create src/lib/normalizeRank.ts with TDD**

Write test first (`src/lib/normalizeRank.test.ts`):

```ts
import { describe, it, expect } from 'vitest';
import { normalizeRank } from './normalizeRank';

describe('normalizeRank', () => {
  it('converts string numeric ranks to numbers', () => {
    expect(normalizeRank("1")).toBe(1);
    expect(normalizeRank("10")).toBe(10);
  });
  it('passes through numeric ranks', () => {
    expect(normalizeRank(1)).toBe(1);
  });
  it('passes through BOMB and FLAG as strings', () => {
    expect(normalizeRank("BOMB")).toBe("BOMB");
    expect(normalizeRank("FLAG")).toBe("FLAG");
  });
  it('returns null for null/undefined', () => {
    expect(normalizeRank(null)).toBeNull();
    expect(normalizeRank(undefined)).toBeNull();
  });
});
```

Implementation:

```ts
import type { Rank } from '../types';

export function normalizeRank(rank: string | number | null | undefined): Rank | null {
  if (rank == null) return null;
  if (rank === "BOMB" || rank === "FLAG") return rank;
  const n = Number(rank);
  if (n >= 1 && n <= 10 && Number.isInteger(n)) return n as Rank;
  return null;
}
```

- [ ] **Step 3: Rename src/rules/*.js to .ts and add type annotations**

For each of the 6 files (`board.ts`, `pieces.ts`, `movement.ts`, `combat.ts`, `twoSquareRule.ts`, `game.ts`):
- Rename `.js` → `.ts`
- Add type imports from `../types`
- Add parameter and return types to every exported function
- **Do not change logic.** Only add types.

Key: `resolveCombat(attackerRank: Rank, defenderRank: Rank): CombatOutcome` — the `<` comparison at line 22 of `combat.js` requires numeric ranks to be numbers, which `Rank` guarantees.

- [ ] **Step 4: Update rules test imports**

In each `test/rules/*.test.js` file, update the import path from `../../src/rules/board.js` to `../../src/rules/board.ts` (or extensionless if the test runner resolves it). Vitest handles `.ts` imports natively.

- [ ] **Step 5: Update sync-rules.sh for the TS → JS copy story**

The Deno Edge Function `submit-setup` imports `../_shared/rules/pieces.js`. Since `src/rules/` is now TypeScript, `sync-rules.sh` must either:
- Strip types and copy `.js` (using `tsc --outDir` or `esbuild`)
- OR keep the copies as-is and update `copies.test.js` to compare the `.ts` source against the `.js` copy semantically

Simplest: use `esbuild` (already a Vite dep) to strip types:

```bash
#!/usr/bin/env bash
set -euo pipefail
for f in src/rules/*.ts; do
  base=$(basename "$f" .ts)
  npx esbuild "$f" --outfile="web/js/rules/${base}.js" --format=esm --platform=neutral
  npx esbuild "$f" --outfile="supabase/functions/_shared/rules/${base}.js" --format=esm --platform=neutral
done
echo "Rules synced: src/rules/*.ts → web/js/rules/*.js + supabase/functions/_shared/rules/*.js"
```

- [ ] **Step 6: Update copies.test.js**

The test now compares the esbuild-emitted JS copies against each other (both copies should be identical since they come from the same source). Or compare the two JS copies byte-for-byte (they're both emitted by the same command).

- [ ] **Step 7: Run sync-rules and full test suite**

```bash
npm run sync-rules
npm test
```

Expected: All tests pass. The `.ts` rules files compile, the emitted `.js` copies match, and all existing rules + bot tests work.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: shared types + rules engine to TypeScript + normalizeRank"
```

---

### Task 3: Bot + Shared Modules to TypeScript

**Files:**
- Rename: `web/js/bot.js` → `src/bot/bot.ts`
- Rename: `web/js/pieceMemory.js` → `src/bot/pieceMemory.ts`
- Rename: `web/js/pieceSuspicion.js` → `src/bot/pieceSuspicion.ts`
- Rename: `web/js/flagDefense.js` → `src/bot/flagDefense.ts`
- Rename: `web/js/deterministicJitter.js` → `src/bot/deterministicJitter.ts`
- Rename: `web/js/formations.js` → `src/data/formations.ts`
- Rename: `web/js/formationRowMap.js` → `src/data/formationRowMap.ts`
- Create: `src/lib/chartGeometry.ts` (shared SVG chart math, extracted from `gameSummary.js` + `gameDetail.js`)
- Create: `src/lib/chartGeometry.test.ts`
- Modify: `test/web/*.test.js` — update import paths

**Interfaces:**
- Consumes: Task 2 types
- Produces: typed bot modules, typed formation data, `chartGeometry()` helper. All tests green.

- [ ] **Step 1: Move and type bot modules**

For each bot file: move to `src/bot/`, rename to `.ts`, add imports from `../types`, add parameter and return types to all exported functions. **Do not change logic.** See recon §4 for exact signatures.

Key: `chooseBotMove` takes `FogPiece[]` from the RPC and converts via the existing `toRulesPiece` helper (which IS the normalizer for the bot path). Type `toRulesPiece(row: FogPiece): RulesPiece`.

- [ ] **Step 2: Move and type formation data**

Move `formations.js` to `src/data/formations.ts`. Add `satisfies Formation[]` to both exports. Move `formationRowMap.js` to `src/data/formationRowMap.ts`. Type `ABSOLUTE_ROWS_BY_SLOT: Record<Slot, [number, number, number, number]>`.

- [ ] **Step 3: Create chart geometry helper**

Extract the shared SVG math from `gameSummary.js` `materialSparkline` and `gameDetail.js` `renderLineChart` into `src/lib/chartGeometry.ts`:

```ts
export type ChartPoint = { x: number; y: number };

export function chartPoints(
  series: number[], width: number, height: number, padding: number,
): { points: ChartPoint[]; zeroY: number; min: number; max: number };

export function perspectiveCurve(curveP1: number[], slot: Slot): number[];
```

Write tests for `perspectiveCurve` (slot 1 returns as-is, slot 2 negates) and `chartPoints` (min/max/zero line position).

- [ ] **Step 4: Update test imports**

All `test/web/*.test.js` files: update import paths from `../../web/js/bot.js` to `../../src/bot/bot.ts` etc.

- [ ] **Step 5: Run full test suite**

```bash
npm test
```

Expected: All tests pass with new paths.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: bot + shared modules to TypeScript + chart geometry helper"
```

---

### Task 4: Layout + Auth Context + Supabase Client

**Files:**
- Create: `src/lib/supabaseClient.ts`
- Create: `src/lib/roomSession.ts`
- Create: `src/contexts/AuthContext.tsx`
- Create: `src/components/Layout.tsx`
- Create: `src/components/NavBar.tsx`
- Create: `src/components/AuthModal.tsx`
- Create: `src/components/AuthModal.test.tsx`
- Modify: `src/App.tsx` — wrap with `AuthProvider`, add `Layout`

**Interfaces:**
- Consumes: Task 1 scaffold, Task 2 types
- Produces: `useAuth()` hook, `callFunction<T>()`, `supabase` client, `Layout` with `NavBar` + auth modals, `saveRoomSession()`/`getRoomSession()`

- [ ] **Step 1: Create typed Supabase client**

`src/lib/supabaseClient.ts` — npm import instead of esm.sh CDN. Preserve the `callFunction` behavior exactly (authToken injection, cumulative error chain, null-data throw). Add a generic return type:

```ts
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://cafqbrzaxcwewwtyqpnf.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_mxrVhbM1gbEixsbuhyn6sw_eL7r6dRX";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export async function callFunction<T = unknown>(name: string, body: Record<string, unknown> = {}): Promise<T> {
  // Same logic as Phase 1's callFunction, but reads token from a passed getter
  // to break the circular import (no static import of auth.ts)
}
```

The circular import is broken by passing a `getToken` function at init, or by having `callFunction` accept an optional token parameter.

- [ ] **Step 2: Create room session helper**

`src/lib/roomSession.ts` — wraps the per-room localStorage keys:

```ts
export function saveRoomSession(roomCode: string, token: string, slot: Slot): void;
export function getRoomSession(roomCode: string): { token: string; slot: Slot } | null;
export function getBotToken(roomCode: string): string | null;
export function saveBotToken(roomCode: string, token: string): void;
export function clearRoomSession(roomCode: string): void;
export function getPlayerColor(roomCode: string): string;
export function setPlayerColor(roomCode: string, hex: string): void;
```

- [ ] **Step 3: Create AuthContext**

`src/contexts/AuthContext.tsx`:

```tsx
type AuthState = { token: string | null; username: string | null };

const AuthContext = createContext<{
  auth: AuthState;
  isLoggedIn: boolean;
  login: (username: string, password: string) => Promise<void>;
  signup: (username: string, password: string) => Promise<void>;
  logout: () => void;
}>(/* ... */);

export function AuthProvider({ children }: { children: ReactNode }) { /* ... */ }
export function useAuth() { return useContext(AuthContext); }
```

Reads from localStorage on mount. `login`/`signup` call `callFunction("login"|"signup", ...)` and update state. `logout` clears localStorage and resets state. No `location.reload()`.

- [ ] **Step 4: Create Layout + NavBar + AuthModal**

`src/components/Layout.tsx` — renders the `<nav class="top-nav">` and an `<Outlet />`:

```tsx
export function Layout() {
  return (
    <>
      <NavBar />
      <Outlet />
    </>
  );
}
```

`src/components/NavBar.tsx` — reads `useAuth()`. Shows login/signup buttons when logged out, username + logout when logged in. Room code display via prop or URL param.

`src/components/AuthModal.tsx` — login/signup modal. Password mismatch validation (client-side). Test with RTL: password mismatch shows error, submit calls the right function.

- [ ] **Step 5: Wire into App.tsx**

```tsx
import { Routes, Route } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { Layout } from './components/Layout';

export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Placeholder name="Home" />} />
          {/* ... */}
        </Route>
      </Routes>
    </AuthProvider>
  );
}
```

- [ ] **Step 6: Test and commit**

Run: `npm test` + `npm run build`
Expected: All tests pass. Build succeeds. Dev server shows nav bar.

```bash
git add -A
git commit -m "feat: Layout + auth context + typed Supabase client"
```

---

### Task 5: PieceToken Component + Audio Hook + SegmentedChoice

**Files:**
- Create: `src/components/PieceToken.tsx`
- Create: `src/hooks/useAudio.ts`
- Create: `src/components/SegmentedChoice.tsx`

**Interfaces:**
- Consumes: Task 2 types (`Rank`, `RANK_NAME`)
- Produces: `<PieceToken rank={} isMine={} color={} />`, `useAudio()` hook, `<SegmentedChoice options={} value={} onChange={} />`

- [ ] **Step 1: Create PieceToken**

Port `token.js`'s `createTokenSVG` to a React component rendering inline SVG. Use `useId()` for the text-path arc ID (replacing `Math.random`). Same visual output: circle, curved blackletter name, center rank number, emoji for Bomb/Flag.

```tsx
type PieceTokenProps = {
  rank: string | number | null;
  isMine: boolean;
  color?: string;
};

export function PieceToken({ rank, isMine, color = DEFAULT_PLAYER_COLOR }: PieceTokenProps) {
  const arcId = useId();
  // ... SVG rendering matching token.js visual output
}
```

- [ ] **Step 2: Create useAudio hook**

Port `audio.js` to a React hook. Preserves the Safari-safe gesture pattern from Phase 1 (defer resume + decode to first `pointerdown`). Drop dead exports (`toggleMuteSfx`, `toggleMuteMusic`, `stopMusic`, `isMusicPlaying`).

```ts
export function useAudio(): {
  playSound: (name: SoundName) => void;
  toggleMuteAll: () => void;
  setSfxVolume: (v: number) => void;
  setMusicVolume: (v: number) => void;
  audioState: AudioState;
};
```

The hook calls `initAudio()` on mount (once, guarded by `initialized`). Cleanup removes the `pointerdown` listener if it hasn't fired. Audio state persists to localStorage.

Audio files: use Vite static imports from `public/audio/` (`/audio/move.wav` etc.).

- [ ] **Step 3: Create SegmentedChoice**

DRY replacement for the duplicated difficulty/personality selectors:

```tsx
type SegmentedChoiceProps<T extends string> = {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
};

export function SegmentedChoice<T extends string>({ options, value, onChange, disabled }: SegmentedChoiceProps<T>) {
  return (
    <div className="setup-controls">
      {options.map((opt) => (
        <button key={opt.value} className={`difficulty-btn ${opt.value === value ? 'selected' : ''}`}
          disabled={disabled} onClick={() => onChange(opt.value)}>
          {opt.label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Test and commit**

```bash
npm test && npm run build
git add -A
git commit -m "feat: PieceToken component + useAudio hook + SegmentedChoice"
```

---

### Task 6: HomePage

**Files:**
- Create: `src/pages/HomePage.tsx`
- Create: `src/pages/HomePage.test.tsx`
- Create: `src/components/Leaderboard.tsx`
- Modify: `src/App.tsx` — wire HomePage route

**Interfaces:**
- Consumes: `callFunction`, `useAuth`, `saveRoomSession`, `clearRoomSession`, `pickBotFormationPlacements` from Task 3, `navigate` from React Router
- Produces: working Home page with create/join/spectate/play-bot/leaderboard

Port `home.js` + `index.html` into React components. Key behaviors to preserve:
- Create game → show room code + copy buttons → Continue to setup
- Join → store session as slot 2 → navigate to setup
- Play vs Bot → 3-call sequence with abandon-game cleanup on failure
- Spectate → navigate to game with `?spectate=1`
- Leaderboard with tabs (Rating, Spy%, Trade King, Fog Breaker, Bomb Craft)

Audit fixes resolved by this migration:
- XSS in leaderboard usernames → JSX auto-escapes
- Double-create-game race → disable button on success, not just `finally`
- Loading indicators → show "Creating..." / "Joining..." on buttons

Tests: mock `callFunction`, verify bot-failure cleanup calls `abandon-game` and clears localStorage.

- [ ] **Steps: implement, test, commit** (follow the brief's component structure)

```bash
git add -A
git commit -m "feat: HomePage with create/join/spectate/bot/leaderboard"
```

---

### Task 7: SetupPage

**Files:**
- Create: `src/pages/SetupPage.tsx`
- Create: `src/components/SetupGrid.tsx`
- Create: `src/components/PieceSidebar.tsx`
- Create: `src/components/FormationControls.tsx`
- Create: `src/components/ColorPicker.tsx`
- Create: `src/components/SubmitControls.tsx`
- Create: `src/hooks/useSetupChannel.ts`

**Interfaces:**
- Consumes: `callFunction`, `getRoomSession`, `PieceToken`, `SegmentedChoice`, `ARMY_COMPOSITION`, `DEFENSIVE_FORMATIONS`, `AGGRESSIVE_FORMATIONS`, `ABSOLUTE_ROWS_BY_SLOT`, `useAuth`
- Produces: working Setup page with piece placement, formations, color picker, bot controls, countdown

Port `setup.js` + `setup.html`. Key behaviors:
- `placements: Map<string, string>` state for the 4×10 grid
- `selectedRank` state for the tray
- Formation cycling (defensive/aggressive/random/clear)
- Color picker (8 presets, persisted to localStorage)
- Difficulty + personality selectors (bot games only, via `SegmentedChoice`)
- Submit/unsubmit with countdown timer
- Realtime subscription for opponent status (`useSetupChannel` hook with proper cleanup)

Audit fixes resolved:
- Grid locked after submit → `submitted` state gates cell clicks
- Double-submit race → disable button before async call
- Leaked Realtime channel → `useEffect` cleanup calls `supabase.removeChannel()`
- DRY difficulty/personality → shared `SegmentedChoice`
- Row labels formula → use display-space computation with comment (behavior-preserving, same as Phase 1 Task 10)

Handle `SETUP_ALREADY_SUBMITTED` error from the server by entering the waiting state (existing vanilla code doesn't handle this on page refresh).

- [ ] **Steps: implement, test, commit**

```bash
git add -A
git commit -m "feat: SetupPage with placement, formations, bot controls, countdown"
```

---

### Task 8: GamePage Hook + Pure Functions

**Files:**
- Create: `src/hooks/useGameState.ts`
- Create: `src/hooks/useGameState.test.ts`
- Create: `src/lib/gameHelpers.ts`
- Create: `src/lib/gameHelpers.test.ts`

**Interfaces:**
- Consumes: `supabase`, `callFunction`, `GameRow`, `FogPiece`, `MoveRow`, `ChatMessage`, `shouldApplyGameRow` (move from `game.js`), `normalizeRank`
- Produces: `useGameState(roomCode, isSpectator)` hook + pure helper functions

This is the **highest-risk task.** The recon identified three concurrent refresh pipelines, a bot loop, and a monotonic guard that must all be preserved correctly in React state.

- [ ] **Step 1: Extract and test pure helper functions**

`src/lib/gameHelpers.ts`:

```ts
// Coordinate transform (existing toAbsolute/toDisplay from game.js:269-289)
export function toAbsolute(displayRow: number, displayCol: number, mySlot: Slot): Square;
export function toDisplay(absRow: number, absCol: number, mySlot: Slot): Square;

// Monotonic guard (existing shouldApplyGameRow from game.js:85-89)
export function shouldApplyGameRow(next: GameRow, prev: GameRow | null): boolean;

// Graveyard enemy rank inference (existing renderGraveyards logic from game.js:376-418)
export function inferEnemyDeadRanks(pieces: FogPiece[], moves: MoveRow[]): Map<string, string>;

// Post-combat reveal rank (existing getPostCombatRevealRank from game.js:301-321)
export function getPostCombatRevealRank(
  pieceId: string, lastMove: MoveRow | null, pieces: Map<string, FogPiece>, isSpectator: boolean,
): string | null;
```

Write comprehensive tests for each. `shouldApplyGameRow` must handle the resign case (same `turn_number`, status goes to `finished`).

- [ ] **Step 2: Create useGameState hook**

`src/hooks/useGameState.ts`:

```ts
export function useGameState(roomCode: string, isSpectator: boolean): {
  gameRow: GameRow | null;
  pieces: Map<string, FogPiece>;
  moves: MoveRow[];
  chat: ChatMessage[];
  loading: boolean;
  error: string | null;
  submitMove: (from: Square, to: Square) => Promise<CombatResult>;
  sendChat: (body: string) => Promise<void>;
  resign: () => Promise<void>;
  rematch: () => Promise<{ roomCode: string; token: string }>;
};
```

Internals:
- One Realtime channel subscription (`game-${gameId}`) with `useEffect` cleanup
- 5s polling interval with `useEffect` cleanup (skipped for spectators)
- `visibilitychange` listener with `useEffect` cleanup
- `shouldApplyGameRow` guard on every `setGameRow`
- Bot scheduling: `useEffect` on `{ isBotGame, status, currentTurnSlot, botToken }` with a 1s `setTimeout` and cleanup

**Critical:** React 18 StrictMode double-mounts effects. The bot timer must be cancelled in cleanup. The channel must be removed in cleanup. The interval must be cleared in cleanup.

- [ ] **Step 3: Run tests**

```bash
npm test
```

Expected: All new tests pass. Existing tests still pass.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: useGameState hook + game helper pure functions with tests"
```

---

### Task 9: GamePage UI Components

**Files:**
- Create: `src/pages/GamePage.tsx`
- Create: `src/components/Board.tsx`
- Create: `src/components/BoardCell.tsx`
- Create: `src/components/GraveyardTray.tsx`
- Create: `src/components/TurnIndicator.tsx`
- Create: `src/components/GameActions.tsx`
- Create: `src/components/MoveLog.tsx`
- Create: `src/components/ChatLog.tsx`
- Create: `src/components/AudioControls.tsx`
- Create: `src/components/RematchModal.tsx`
- Create: `src/components/BoardCell.test.tsx`
- Modify: `src/App.tsx` — wire GamePage route

**Interfaces:**
- Consumes: `useGameState` from Task 8, `useAudio` from Task 5, `PieceToken`, all game helpers
- Produces: working Game page with board, graveyards, side panel, move log, chat, audio, spectator mode, rematch

Port `game.js` + `game.html`. The hook from Task 8 owns all data; this task is pure rendering.

Key components:
- `Board` — 10×10 grid, coordinate labels, passes clicks up
- `BoardCell` — **accessible**: `role="button"`, `tabIndex={0}`, `aria-label` describing the piece, keyboard handler (`Enter`/`Space` to click). Uses `PieceToken`.
- `GraveyardTray` — horizontal rank columns with slots, collapsible (collapse state in component)
- `MoveLog` — stick-to-bottom scroll behavior via ref
- `RematchModal` — replaces `confirm()` for resign, custom modal for rematch accept/decline
- `AudioControls` — mute toggle + volume sliders

Audit fixes resolved:
- O(100n) board render → React reconciliation only updates changed cells
- No keyboard/ARIA on board cells → baked into `BoardCell`
- `confirm()` for resign → custom modal
- `alert()` for errors → inline error text
- Duplicate render cycles → single React render pass

Test `BoardCell` with RTL: keyboard navigation, aria-label content, click handler.

- [ ] **Steps: implement, test, commit**

```bash
git add -A
git commit -m "feat: GamePage with accessible board, graveyards, chat, audio, rematch"
```

---

### Task 10: ProfilePage

**Files:**
- Create: `src/pages/ProfilePage.tsx`
- Create: `src/components/ProfileHeader.tsx`
- Create: `src/components/HeadToHead.tsx`
- Create: `src/components/RadarChart.tsx`
- Create: `src/components/StatsSections.tsx`
- Create: `src/components/CombatHeatmap.tsx`
- Create: `src/components/PieceFate.tsx`
- Create: `src/components/AchievementsGrid.tsx`
- Create: `src/components/GameHistory.tsx`
- Create: `src/components/Sparkline.tsx` (uses `chartGeometry` from Task 3)
- Create: `src/components/LineChart.tsx` (uses `chartGeometry` from Task 3)
- Modify: `src/App.tsx` — wire ProfilePage route

**Interfaces:**
- Consumes: `supabase.rpc`, `useAuth`, `RANK_NAME`, `chartGeometry`, `perspectiveCurve`, `isLake` (for heatmap)
- Produces: working Profile page with all 36+ stats, 22 achievements, radar, heatmap, history

Port `profile.js` (593 lines) + `profile.html`. This is the widest page (many components) but simple state (one RPC fetch, then pure rendering).

Key:
- `ProfilePage` fetches `get_player_profile` and renders all sub-components
- `GameHistory` loads history, then fans out `get_game_summary` with a concurrency cap (max 5 parallel, per audit recommendation)
- `HeadToHead` only renders when logged in and viewing a different player
- `RadarChart` — inline SVG, 6 axes, computed from stats
- `StatsSections` — one component driven by a `buildStatSections(stats)` pure function that returns the 12 section definitions. The Memory section gets extra children (`ScoutingTags`, `PhaseBreakdown`).
- `AchievementsGrid` — 22 entries from the full `ACHIEVEMENT_LABELS` map
- `CombatHeatmap` — import `isLake` from rules instead of duplicating the lake set

Audit fixes resolved:
- 590-line monolith → decomposed into focused components
- Duplicated `RANK_NAME` → single import from `types.ts`
- Unbounded summary parallelism → concurrency cap
- XSS in usernames → JSX auto-escapes

- [ ] **Steps: implement, test, commit**

```bash
git add -A
git commit -m "feat: ProfilePage with stats, radar, heatmap, achievements, history"
```

---

### Task 11: GameDetailPage

**Files:**
- Create: `src/pages/GameDetailPage.tsx`
- Create: `src/components/StoryHighlights.tsx`
- Create: `src/components/PhaseBreakdownTable.tsx`
- Create: `src/components/PieceCareers.tsx`
- Create: `src/components/TerritoryTimeline.tsx`
- Modify: `src/App.tsx` — wire GameDetailPage route

**Interfaces:**
- Consumes: `supabase.rpc("get_game_detail")`, `LineChart` from Task 10, `chartGeometry`, `perspectiveCurve`, `RANK_NAME`
- Produces: working Game Detail page with curves, phase breakdown, piece careers, territory

Port `gameDetail.js` (356 lines) + `game-detail.html`.

Key:
- One RPC fetch, then pure rendering
- `viewSlot` as React state (not a page reload like today — changing slot updates perspective without refetching)
- Reuse `LineChart` from Task 10 for material, info-edge, and compositional-knowledge curves
- `PhaseBreakdownTable` — different from Profile's phase widget (quartile table, not memory bins)
- `TerritoryTimeline` — normalize legacy data shape as a pure function, render multi-line SVG
- `StoryHighlights` — build from a pure `buildHighlights(data, story, slot)` function

Audit fixes resolved:
- Duplicate chart code → shared `LineChart`
- XSS in usernames → JSX
- Legacy territory normalization preserved

- [ ] **Steps: implement, test, commit**

```bash
git add -A
git commit -m "feat: GameDetailPage with curves, phase breakdown, careers, territory"
```

---

### Task 12: Cleanup + Deploy Cutover

**Files:**
- Delete: `web/js/` (all files), `web/css/`, `web/*.html`, `web/audio/`, `web/fonts/`
- Delete: `web/js/escapeHtml.js`, `test/web/escapeHtml.test.js` (JSX handles this now)
- Modify: `render.yaml` — `staticPublishPath: ./dist`, `buildCommand: npm ci && npm run build`
- Modify: `render.yaml` — add rewrite rules for SPA fallback + old `.html` paths
- Modify: `test/rules/copies.test.js` — remove `web/js/rules` comparison (directory deleted)
- Modify: `scripts/sync-rules.sh` — only sync to `supabase/functions/_shared/rules/`
- Modify: `package.json` — clean up any stale scripts

**Interfaces:**
- Consumes: all 5 working React pages
- Produces: production deploy on Render with SPA routing

- [ ] **Step 1: Update render.yaml**

```yaml
services:
  - type: web
    name: stratego
    runtime: static
    staticPublishPath: ./dist
    buildCommand: "npm ci && npm run build"
    pullRequestPreviewsEnabled: false
    routes:
      - type: rewrite
        source: /setup.html
        destination: /setup
      - type: rewrite
        source: /game.html
        destination: /game
      - type: rewrite
        source: /profile.html
        destination: /profile
      - type: rewrite
        source: /game-detail.html
        destination: /game-detail
      - type: rewrite
        source: "/*"
        destination: /index.html
```

The `/*` catch-all rewrite serves `index.html` for SPA routes. The `.html` rewrites preserve old invite links.

- [ ] **Step 2: Delete old vanilla files**

```bash
rm -rf web/js web/css web/*.html web/audio web/fonts
```

Keep `web/` directory only if something else needs it; otherwise `rm -rf web/`.

- [ ] **Step 3: Update copies test and sync script**

`test/rules/copies.test.js` — remove the `web/js/rules` comparison. Only check `supabase/functions/_shared/rules`.

`scripts/sync-rules.sh` — remove the `web/js/rules` copy line.

- [ ] **Step 4: Delete escapeHtml (JSX handles escaping)**

```bash
rm web/js/escapeHtml.js test/web/escapeHtml.test.js 2>/dev/null
```

(These may already be deleted with `web/js/` in Step 2.)

- [ ] **Step 5: Run final test suite and build**

```bash
npm test
npm run build
tsc --noEmit
```

Expected: All tests pass. Build succeeds. TypeScript compiles cleanly in strict mode.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: cleanup old vanilla files + Render deploy cutover to dist/"
```

---

## Verification

After all 12 tasks:

- [ ] `npm test` — all tests green (125 existing + new unit/RTL tests)
- [ ] `tsc --noEmit` — clean with strict mode
- [ ] `npm run build` — `dist/` produced
- [ ] Zero `innerHTML` in `src/` (all rendering via JSX). Verify: `rg 'innerHTML' src/`
- [ ] `Rank` and `Slot` are TypeScript types — no string/number confusion possible
- [ ] Board cells are keyboard-navigable with `role="button"`, `tabIndex`, `aria-label`
- [ ] Push to GitHub, deploy to Render
- [ ] Old invite links (`/setup.html?code=...&join=1`) redirect correctly
- [ ] Real two-player game: create → join → setup → play → resign/rematch
- [ ] Bot game: Easy/Medium/Hard × Aggressive/Neutral/Defensive
- [ ] Profile page renders all 12 stat sections, 22 achievements, radar, heatmap, sparklines
- [ ] Game detail page renders curves, phase breakdown, piece careers, territory
- [ ] Safari: audio plays after first interaction
- [ ] Mobile (375px): board fits, side panel stacks below
- [ ] $0/month hosting preserved (Render Static Site + Supabase free tier)
