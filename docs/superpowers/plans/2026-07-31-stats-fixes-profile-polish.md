# Stats Fixes & Profile Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix critical rank-mismatch bug in stats computation, add resign→compute-stats trigger, add idempotency guard, block password_hash exposure, fix profile "undefined" fields, add tooltips to all stats/achievements, add game-over UI with "Go Home" button.

**Architecture:** The rules engine stores ranks as `1`=Marshal through `10`=Spy (lower=stronger), but `compute-stats` was written assuming display numbers (`"10"`=Marshal, `"SPY"` as string). Fix: create a rank constants map in compute-stats matching the actual game engine. Migration adds `stats_computed` column and restricts RLS. Game-over UI: hide resign when finished, show result banner + go-home button.

**Tech Stack:** Supabase (Postgres + Edge Functions/Deno), HTML/CSS/JS frontend (same stack as existing).

## Global Constraints

- Supabase project ref: `cafqbrzaxcwewwtyqpnf`
- Frontend: vanilla HTML/CSS/JS, ES modules via esm.sh imports, no build step
- Edge Functions: Deno/TypeScript, use `createClient` from `https://esm.sh/@supabase/supabase-js@2`
- CORS: use shared `corsHeaders` from `../_shared/cors.ts`
- All Edge Functions use `SUPABASE_SERVICE_ROLE_KEY` for DB access
- Direct commits to main branch
- Deploy Edge Functions with: `npx supabase functions deploy <name> --project-ref cafqbrzaxcwewwtyqpnf`
- Push frontend via git push (Render auto-deploys)
- **Rank system:** internal ranks are `1`=Marshal, `2`=General, `3`=Colonel, `4`=Major, `5`=Captain, `6`=Lieutenant, `7`=Sergeant, `8`=Miner, `9`=Scout, `10`=Spy, `"BOMB"`=Bomb, `"FLAG"`=Flag. Lower number = stronger. This is what's stored in `pieces.rank` and `moves.attacker_rank`/`moves.defender_rank`.

---

### Task 1: Fix Rank Constants in compute-stats (Critical Bug)

**Files:**
- Modify: `supabase/functions/compute-stats/index.ts`

**Interfaces:**
- Consumes: `moves` table (where `attacker_rank`/`defender_rank` use internal rank values: 1=Marshal, 8=Miner, 9=Scout, 10=Spy, "BOMB", "FLAG")
- Produces: Correct stat calculations using the actual rank values from the game engine

The root cause of "Spy Success Rate: —" despite a confirmed spy kill: `compute-stats` checks `m.attacker_rank === "SPY"` but the moves table stores the Spy's rank as `10` (the integer from the rules engine). Same class of bug affects Miner (stored as `8`, checked as `"3"`), Marshal (stored as `1`, checked as `"10"`), Scout (stored as `9`, checked as `"2"`), and all rank-value calculations.

- [ ] **Step 1: Replace the incorrect RANK_VALUE map and add correct rank constants**

At the top of `compute-stats/index.ts`, replace the existing `RANK_VALUE` map:

```typescript
// Internal rank constants matching supabase/functions/_shared/rules/pieces.js
// Lower number = stronger. These are what's stored in pieces.rank and moves columns.
const RANK = {
  MARSHAL: 1,
  GENERAL: 2,
  COLONEL: 3,
  MAJOR: 4,
  CAPTAIN: 5,
  LIEUTENANT: 6,
  SERGEANT: 7,
  MINER: 8,
  SCOUT: 9,
  SPY: 10,
  BOMB: "BOMB",
  FLAG: "FLAG",
} as const;

// Strategic value (for potential future trade efficiency / deficit calculations)
const RANK_VALUE: Record<string | number, number> = {
  [RANK.MARSHAL]: 10,
  [RANK.GENERAL]: 9,
  [RANK.COLONEL]: 8,
  [RANK.MAJOR]: 7,
  [RANK.CAPTAIN]: 6,
  [RANK.LIEUTENANT]: 5,
  [RANK.SERGEANT]: 4,
  [RANK.MINER]: 3,
  [RANK.SCOUT]: 2,
  [RANK.SPY]: 2,
  [RANK.BOMB]: 5,
  [RANK.FLAG]: 0,
};
```

- [ ] **Step 2: Fix all rank comparisons throughout the function**

Replace every rank literal with the correct `RANK.*` constant:

| Old (wrong) | New (correct) | Meaning |
|---|---|---|
| `m.attacker_rank === "SPY"` | `m.attacker_rank == RANK.SPY` | Spy as attacker |
| `m.defender_rank === "SPY"` | `m.defender_rank == RANK.SPY` | Spy as defender |
| `p.rank === "3"` | `p.rank == RANK.MINER` | Miner pieces |
| `p.rank === "BOMB"` | `p.rank === RANK.BOMB` | Bomb pieces (already correct — "BOMB" === "BOMB") |
| `p.rank === "2"` | `p.rank == RANK.SCOUT` | Scout pieces |
| `m.attacker_rank === "10" && m.defender_rank === "10"` | `m.attacker_rank == RANK.MARSHAL && m.defender_rank == RANK.MARSHAL` | Marshal showdowns |
| `m.defender_rank === "FLAG"` | `m.defender_rank === RANK.FLAG` | Flag capture (already correct — "FLAG" === "FLAG") |
| `m.defender_rank === "BOMB" && m.outcome === "ATTACKER_WINS"` | `m.defender_rank === RANK.BOMB && m.outcome === "ATTACKER_WINS"` | Bomb defusal (already correct) |
| `m.attacker_rank === "3" && m.defender_rank === "BOMB"` | `m.attacker_rank == RANK.MINER && m.defender_rank === RANK.BOMB` | Miner defuses bomb |
| `m.attacker_rank === "3" && m.defender_rank === "FLAG"` | `m.attacker_rank == RANK.MINER && m.defender_rank === RANK.FLAG` | Needle threader achievement |
| `["8", "9", "10"].includes(p.rank)` | `[RANK.MARSHAL, RANK.GENERAL, RANK.COLONEL].includes(p.rank as number)` | High-value pieces (rank ≥ Colonel) |

Note: Use `==` (loose equality) for numeric comparisons because the DB may return ranks as strings (`"10"`) or numbers (`10`) depending on the column type. The pieces table stores `rank` as `text`, so ranks will come back as strings `"1"`, `"8"`, `"10"`, `"BOMB"`, `"FLAG"`. Use string comparison:

Actually, since `pieces.rank` is a `text` column, all values come back as strings. So the correct comparisons are:

| Expression | Correct form |
|---|---|
| Spy | `m.attacker_rank === "10"` (SPY's internal rank as string) |
| Marshal | `m.attacker_rank === "1"` or `m.defender_rank === "1"` |
| Miner | `p.rank === "8"` |
| Scout | `p.rank === "9"` |
| High-value (Marshal+General+Colonel) | `["1", "2", "3"].includes(p.rank)` |

Use string versions of RANK constants for all comparisons:

```typescript
const R = {
  MARSHAL: "1",
  GENERAL: "2",
  COLONEL: "3",
  MAJOR: "4",
  CAPTAIN: "5",
  LIEUTENANT: "6",
  SERGEANT: "7",
  MINER: "8",
  SCOUT: "9",
  SPY: "10",
  BOMB: "BOMB",
  FLAG: "FLAG",
} as const;
```

Full list of replacements in the function body:

```typescript
// Spy combats: attacker_rank will be "10" for spy
const spyCombats = moves.filter((m: Move) => {
  if (m.player_slot === slot && m.attacker_rank === R.SPY) return true;
  if (m.player_slot !== slot && m.defender_rank === R.SPY) {
    const defender = m.defender_piece_id ? pieceById.get(m.defender_piece_id) : undefined;
    return defender?.player_slot === slot;
  }
  return false;
}).length;

// Spy kills
const spyKills = moves.filter(
  (m: Move) =>
    m.player_slot === slot && m.attacker_rank === R.SPY && m.outcome === "ATTACKER_WINS",
).length;

// Bombs
const myBombs = playerPieces.filter((p: Piece) => p.rank === R.BOMB);
const bombsDetonated = moves.filter(
  (m: Move) =>
    m.player_slot !== slot &&
    m.move_type === "attack" &&
    m.defender_rank === R.BOMB &&
    m.outcome === "DEFENDER_WINS",
).length;

// Miners
const myMiners = playerPieces.filter((p: Piece) => p.rank === R.MINER);

// Scout moves
const scoutMoves = playerMoves.filter((m: Move) => {
  const piece = pieceById.get(m.piece_id);
  return piece?.rank === R.SCOUT;
}).length;

// Marshal showdowns (Marshal = "1")
const marshalFights = moves.filter(
  (m: Move) => m.attacker_rank === R.MARSHAL && m.defender_rank === R.MARSHAL,
);

// Flag capture detection
if (lastMove?.defender_rank === R.FLAG) winByFlag = 1;

// High-value pieces lost (Marshal, General, Colonel = ranks 1, 2, 3)
const highPiecesLost = playerPieces.filter(
  (p: Piece) => !p.alive && [R.MARSHAL, R.GENERAL, R.COLONEL].includes(p.rank as any),
).length;

// Bomb defuse achievement (Miner attacks Bomb and wins)
const bombDefuses = playerMoves.filter(
  (m: Move) =>
    m.attacker_rank === R.MINER && m.defender_rank === R.BOMB && m.outcome === "ATTACKER_WINS",
).length;

// Needle threader (Miner captures Flag)
if (won && lastMove?.attacker_rank === R.MINER && lastMove?.defender_rank === R.FLAG) {
  newAchievements.push("needle_threader");
}

// Enemy scouts
const enemyScoutsDead = enemyPieces.filter((p: Piece) => p.rank === R.SCOUT && !p.alive).length;
```

- [ ] **Step 3: Also fix the win-by-resignation categorization**

Replace the existing win-method block:

```typescript
    let winByFlag = 0;
    let winByResign = 0;
    let winByNomoves = 0;
    if (won) {
      const enemyFlag = enemyPieces.find((p: Piece) => p.rank === R.FLAG);
      if (enemyFlag && !enemyFlag.alive) {
        winByFlag = 1;
      } else {
        const enemyMobilePieces = enemyPieces.filter(
          (p: Piece) => p.alive && p.rank !== R.BOMB && p.rank !== R.FLAG,
        );
        if (enemyMobilePieces.length === 0) {
          winByNomoves = 1;
        } else {
          winByResign = 1;
        }
      }
    }
```

- [ ] **Step 4: Deploy**

```bash
npx supabase functions deploy compute-stats --project-ref cafqbrzaxcwewwtyqpnf
```

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/compute-stats/index.ts
git commit -m "fix: use correct internal rank constants in compute-stats (1=Marshal, 10=Spy)"
```

---

### Task 2: Migration — Idempotency Guard + Password Hash Protection

**Files:**
- Create: `supabase/migrations/0011_stats_idempotency_and_rls.sql`

**Interfaces:**
- Produces: `games.stats_computed` boolean column (default false); blocks direct anon select on `players` table

- [ ] **Step 1: Write the migration SQL**

```sql
-- supabase/migrations/0011_stats_idempotency_and_rls.sql

-- Idempotency: track whether compute-stats has already run for a game
alter table games add column stats_computed boolean not null default false;

-- Password hash protection: replace wide-open select with a deny-all policy.
-- All player reads go through SECURITY DEFINER RPCs (get_player_profile,
-- get_leaderboard, get_game_history) which bypass RLS. Direct PostgREST
-- select from anon was never intended and exposes password_hash.
drop policy if exists players_select on players;
create policy players_no_direct_select on players for select using (false);
```

- [ ] **Step 2: Deploy the migration**

```bash
cd Projects/Stratego/code
npx supabase db push --project-ref cafqbrzaxcwewwtyqpnf
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0011_stats_idempotency_and_rls.sql
git commit -m "fix: add stats_computed idempotency column, block password_hash via RLS"
```

---

### Task 3: Compute-Stats Idempotency + Resign Trigger

**Files:**
- Modify: `supabase/functions/compute-stats/index.ts`
- Modify: `supabase/functions/resign/index.ts`

**Interfaces:**
- Consumes: `games.stats_computed` column from Task 2
- Produces: compute-stats skips already-computed games; resign fires compute-stats on successful resignation

- [ ] **Step 1: Add idempotency check in compute-stats**

After the `if (game.status !== "finished")` block, add:

```typescript
  if (game.stats_computed) {
    return jsonResponse({ ok: true, skipped: "already_computed" });
  }
```

- [ ] **Step 2: Set stats_computed = true at the end**

Just before the final `return jsonResponse({ ok: true })`:

```typescript
  await supabase.from("games").update({ stats_computed: true }).eq("id", game_id);
```

- [ ] **Step 3: Add compute-stats call to resign function**

In `resign/index.ts`, after the successful game update (after the `if (updateError)` block), before the final response:

```typescript
  // Fire-and-forget stats computation
  const fnUrl = `${SUPABASE_URL}/functions/v1/compute-stats`;
  fetch(fnUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({ game_id: playerRow.game_id }),
  }).catch(() => {});
```

- [ ] **Step 4: Deploy both**

```bash
npx supabase functions deploy compute-stats --project-ref cafqbrzaxcwewwtyqpnf
npx supabase functions deploy resign --project-ref cafqbrzaxcwewwtyqpnf
```

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/compute-stats/index.ts supabase/functions/resign/index.ts
git commit -m "fix: idempotency guard on compute-stats; resign triggers stats computation"
```

---

### Task 4: Fix Profile Page — Undefined Fields

**Files:**
- Modify: `web/js/profile.js`

**Interfaces:**
- Consumes: `get_player_profile` RPC returns `{ player: { id, username, rating, rating_provisional, games_played, created_at }, stats: { ... }, achievements: [...] }`
- Produces: Profile page correctly reads the nested response structure

The `get_player_profile` RPC (see migration lines 186–200) returns:
```json
{ "player": { "username": "...", "rating": 1500, ... }, "stats": { ... }, "achievements": [...] }
```
But `profile.js` accesses `data.username`, `data.rating`, etc. (top-level) — should be `data.player.username`.

- [ ] **Step 1: Fix loadProfile to use nested structure**

```javascript
async function loadProfile(username) {
  const { data, error } = await supabase.rpc("get_player_profile", { p_username: username });
  if (error || !data) {
    document.getElementById("profile-error").textContent = "Player not found";
    document.getElementById("profile-error").hidden = false;
    return;
  }

  const player = data.player;
  const stats = data.stats;
  const achievements = data.achievements;

  document.title = `Stratego — ${player.username}`;
  renderHeader(player, stats);
  renderStats(stats);
  renderAchievements(achievements);
  loadHistory(username);
}
```

- [ ] **Step 2: Fix renderHeader signature and references**

```javascript
function renderHeader(player, stats) {
  const el = document.getElementById("profile-header");
  const totalGames = stats ? (stats.wins + stats.losses + stats.draws) : 0;
  const winRate = totalGames > 0 ? ((stats.wins / totalGames) * 100).toFixed(1) : "0.0";
  el.innerHTML = `
    <h2>${player.username}</h2>
    <div class="profile-meta">
      <span class="rating-badge ${player.rating_provisional ? "provisional" : ""}">${player.rating} ${player.rating_provisional ? "(Provisional)" : ""}</span>
      ${stats?.archetype ? `<span class="archetype-badge">${stats.archetype}</span>` : ""}
      <span>${player.games_played} games</span>
      <span>${winRate}% win rate</span>
      <span>Member since ${new Date(player.created_at).toLocaleDateString()}</span>
    </div>
  `;
}
```

- [ ] **Step 3: Commit**

```bash
git add web/js/profile.js
git commit -m "fix: profile reads from nested data.player object (fixes undefined fields)"
```

---

### Task 5: Tooltips on All Stats and Achievements

**Files:**
- Modify: `web/js/profile.js`
- Modify: `web/css/styles.css`

**Interfaces:**
- Consumes: Existing rendering in profile.js
- Produces: Every stat has a visible `?` tooltip icon; every achievement (locked or unlocked) has a visible `?` tooltip with its unlock condition

- [ ] **Step 1: Update renderStats to include tooltip descriptions**

Each item in the sections array becomes a triple `[label, value, description]`:

```javascript
function renderStats(stats) {
  if (!stats) return;
  const el = document.getElementById("profile-stats");
  const totalGames = stats.wins + stats.losses + stats.draws;

  const sections = [
    { title: "Core", items: [
      ["Wins", stats.wins, "Total rated games won"],
      ["Losses", stats.losses, "Total rated games lost"],
      ["Draws", stats.draws, "Games with no winner (both Marshals eliminated simultaneously)"],
      ["Current Streak", stats.current_streak, "Consecutive wins right now — resets on any loss or draw"],
      ["Longest Streak", stats.longest_streak, "Best-ever consecutive win streak across all games"],
      ["Avg Game Length", totalGames > 0 ? Math.round(stats.total_moves_all_games / totalGames) : "—", "Average total moves (both players combined) per game"],
    ]},
    { title: "Combat Intelligence", items: [
      ["Spy Success Rate", stats.spy_combats > 0 ? `${((stats.spy_kills / stats.spy_combats) * 100).toFixed(0)}%` : "—", "When your Spy enters combat (attacking or defending), how often does it kill the Marshal?"],
      ["Bomb Efficiency", stats.total_bombs > 0 ? `${((stats.bombs_detonated / stats.total_bombs) * 100).toFixed(0)}%` : "—", "What fraction of your Bombs (6 per game) actually killed an enemy piece?"],
      ["Miner Survival", stats.miners_started > 0 ? `${((stats.miners_survived / stats.miners_started) * 100).toFixed(0)}%` : "—", "What fraction of your Miners (5 per game) survive to the end?"],
      ["First Blood %", totalGames > 0 ? `${((stats.first_bloods / totalGames) * 100).toFixed(0)}%` : "—", "How often you initiate the very first attack of the entire game"],
    ]},
    { title: "Strategic Profile", items: [
      ["Initiative Ratio", stats.combats_total > 0 ? `${((stats.combats_initiated / stats.combats_total) * 100).toFixed(0)}%` : "—", "Of all combats you're involved in, what % did you start by attacking?"],
      ["Aggression Index", stats.total_moves > 0 ? `${((stats.forward_moves / stats.total_moves) * 100).toFixed(0)}%` : "—", "What % of your moves advance toward the enemy's side of the board?"],
      ["Deep Strike Rate", stats.total_moves > 0 ? `${((stats.moves_in_enemy_half / stats.total_moves) * 100).toFixed(0)}%` : "—", "What % of your moves end in the enemy's half of the board?"],
    ]},
    { title: "Endgame & Clutch", items: [
      ["Marathon Win Rate", stats.marathon_games > 0 ? `${((stats.marathon_wins / stats.marathon_games) * 100).toFixed(0)}%` : "—", "Win rate in long games (60+ total moves)"],
      ["Win by Flag %", stats.wins > 0 ? `${((stats.wins_by_flag / stats.wins) * 100).toFixed(0)}%` : "—", "% of your wins by capturing the enemy Flag (vs. resignation or no-moves-left)"],
    ]},
    { title: "Records", items: [
      ["Fastest Win", stats.fastest_win ? `${stats.fastest_win} moves` : "—", "Fewest total moves in any game you won"],
      ["Longest Game", stats.longest_game ? `${stats.longest_game} moves` : "—", "Most total moves in any single game you played"],
      ["Most Captures (1 game)", stats.most_captures ?? "—", "Most enemy pieces you killed in a single game"],
      ["Marshal Showdowns", `${stats.marshal_showdown_wins}/${stats.marshal_showdowns}`, "Marshal vs Marshal direct combat — your wins out of total showdowns"],
    ]},
  ];

  el.innerHTML = sections.map((s) => `
    <details class="stats-section" open>
      <summary>&#9660; ${s.title}</summary>
      <div class="stats-grid">
        ${s.items.map(([label, value, desc]) => `
          <div class="stat-item">
            <span class="stat-label">${label} <span class="stat-help" title="${desc}">?</span></span>
            <span class="stat-value">${value}</span>
          </div>
        `).join("")}
      </div>
    </details>
  `).join("");
}
```

- [ ] **Step 2: Update renderAchievements to show tooltip with unlock condition on each badge**

```javascript
const ACHIEVEMENT_LABELS = {
  kingmaker: { name: "Kingmaker", desc: "Your Spy kills the enemy Marshal in combat" },
  bomb_squad: { name: "Bomb Squad", desc: "Defuse 3 or more enemy Bombs with your Miners in one game" },
  needle_threader: { name: "Needle Threader", desc: "Win the game by capturing the enemy Flag with a Miner" },
  glass_cannon: { name: "Glass Cannon", desc: "Win a game with 8 or fewer of your own pieces still alive" },
  clean_operation: { name: "Clean Operation", desc: "Win a game while losing 10 or fewer of your pieces" },
  blitz_general: { name: "Blitz General", desc: "Win a game in under 30 total moves" },
  no_fly_zone: { name: "No Fly Zone", desc: "Eliminate all 8 of the enemy's Scouts in one game" },
  minefield_architect: { name: "Minefield Architect", desc: "Your Bombs kill 4 or more enemy pieces in one game" },
  iron_wall: { name: "Iron Wall", desc: "Win without losing any piece ranked Colonel or higher (Marshal, General, Colonel)" },
  fog_walker: { name: "Fog Walker", desc: "Make 10+ attacks on enemy pieces and win the game" },
  counterpunch: { name: "Counterpunch", desc: "Win after being behind by 15+ rank-value points during the game" },
  rival_hunter: { name: "Rival Hunter", desc: "Beat the same opponent 5 times across any number of games" },
};

function renderAchievements(achievements) {
  const el = document.getElementById("profile-achievements");
  const unlocked = new Set((achievements || []).map((a) => a.achievement_key));
  el.innerHTML = `
    <h3>Achievements</h3>
    <div class="achievements-grid">
      ${Object.entries(ACHIEVEMENT_LABELS).map(([key, { name, desc }]) => {
        const isUnlocked = unlocked.has(key);
        return `
          <div class="achievement-item ${isUnlocked ? "unlocked" : "locked"}">
            <span class="achievement-name">${name}</span>
            <span class="stat-help" title="${desc}">?</span>
          </div>
        `;
      }).join("")}
    </div>
  `;
}
```

- [ ] **Step 3: Add CSS for tooltip help icon**

Add to `web/css/styles.css`:

```css
/* Stat and achievement tooltip help icon */
.stat-help {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.15);
  font-size: 0.6rem;
  cursor: help;
  vertical-align: middle;
  margin-left: 3px;
  opacity: 0.6;
}

.stat-help:hover {
  opacity: 1;
  background: rgba(255, 255, 255, 0.3);
}
```

- [ ] **Step 4: Commit**

```bash
git add web/js/profile.js web/css/styles.css
git commit -m "feat: add ? tooltip descriptions to all stats and achievement badges"
```

---

### Task 6: Game-Over UI — Result Banner + Go Home Button

**Files:**
- Modify: `web/game.html`
- Modify: `web/js/game.js`
- Modify: `web/css/styles.css`

**Interfaces:**
- Consumes: `gameRow.status === "finished"` + `gameRow.winner_slot`
- Produces: When a game finishes, resign button hides, a clear "Game Over" result banner appears, and "Go Home" + "View Profile" buttons show alongside Rematch

- [ ] **Step 1: Add game-over action buttons to game.html**

In `game.html`, replace the `game-actions` div:

```html
<div class="game-actions">
  <button id="resign-btn" class="btn-danger">Resign</button>
  <button id="rematch-btn" class="btn-primary" hidden>Rematch</button>
  <a id="home-btn" href="index.html" class="btn-secondary" hidden>Home</a>
  <a id="profile-btn" href="#" class="btn-secondary" hidden>My Profile</a>
</div>
```

- [ ] **Step 2: Update renderTurnIndicator in game.js to show game-over state**

Replace the `renderTurnIndicator` function's "finished" branch:

```javascript
function renderTurnIndicator() {
  const el = document.getElementById("turn-indicator");
  if (!gameRow) return;
  if (gameRow.status === "finished") {
    if (isSpectator) {
      el.textContent = `Game Over — Player ${gameRow.winner_slot} wins!`;
    } else {
      el.textContent = gameRow.winner_slot === mySlot ? "Victory! You won!" : "Defeat. You lost.";
      el.className = `turn-indicator ${gameRow.winner_slot === mySlot ? "result-win" : "result-loss"}`;
    }
    document.getElementById("resign-btn").hidden = true;
    if (!isSpectator) {
      document.getElementById("rematch-btn").hidden = false;
      document.getElementById("home-btn").hidden = false;
      document.getElementById("profile-btn").hidden = false;
    } else {
      document.getElementById("home-btn").hidden = false;
    }
    return;
  }
  // ... rest of existing logic for active game
```

- [ ] **Step 3: Wire profile button href based on auth state**

After the `renderTurnIndicator` call in the game-over path, set the profile link:

```javascript
// In the init block, after renderTurnIndicator is called:
import { getUsername, isLoggedIn } from "./auth.js";

// After showing profile-btn:
const profileBtn = document.getElementById("profile-btn");
if (isLoggedIn()) {
  profileBtn.href = `profile.html?user=${encodeURIComponent(getUsername())}`;
} else {
  profileBtn.hidden = true;
}
```

- [ ] **Step 4: Add CSS for result styling**

```css
/* Game over result indicator */
.turn-indicator.result-win {
  color: #6c6;
  font-weight: bold;
  font-size: 1.1rem;
}

.turn-indicator.result-loss {
  color: #c66;
  font-weight: bold;
  font-size: 1.1rem;
}

/* Secondary button style for Home/Profile links */
.btn-secondary {
  display: inline-block;
  padding: 0.4rem 0.8rem;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.3);
  background: rgba(255, 255, 255, 0.08);
  color: var(--ink);
  text-decoration: none;
  font-size: 0.85rem;
  cursor: pointer;
}

.btn-secondary:hover {
  background: rgba(255, 255, 255, 0.15);
}
```

- [ ] **Step 5: Commit**

```bash
git add web/game.html web/js/game.js web/css/styles.css
git commit -m "feat: game-over UI — hide resign, show result banner + Home/Profile buttons"
```

---

### Task 7: Backfill & Deploy

**Files:**
- All files from Tasks 1–6

**Interfaces:**
- Consumes: All previous tasks
- Produces: Fully deployed and verified fixes; existing game stats recomputed with correct ranks

- [ ] **Step 1: Push all commits to GitHub (triggers Render deploy)**

```bash
git push
```

- [ ] **Step 2: Deploy all modified Edge Functions**

```bash
npx supabase functions deploy compute-stats --project-ref cafqbrzaxcwewwtyqpnf
npx supabase functions deploy resign --project-ref cafqbrzaxcwewwtyqpnf
```

- [ ] **Step 3: Reset stats for existing players (rank fix invalidates old data)**

Since the old compute-stats was using entirely wrong rank constants, all previously computed stats are incorrect. Reset both players' stats and recompute:

```sql
-- Run via Supabase SQL editor or supabase db execute:
UPDATE player_stats SET
  wins = 0, losses = 0, draws = 0, current_streak = 0, longest_streak = 0,
  fastest_win = NULL, longest_game = NULL, most_captures = NULL,
  total_moves_all_games = 0, spy_combats = 0, spy_kills = 0,
  bombs_detonated = 0, total_bombs = 0, miners_survived = 0, miners_started = 0,
  first_bloods = 0, combats_initiated = 0, combats_total = 0,
  forward_moves = 0, total_moves = 0, moves_in_enemy_half = 0,
  scout_moves = 0, attacks_on_unknown = 0, attacks_total = 0,
  lateral_non_combat_moves = 0, opponent_pieces_captured = 0,
  own_pieces_lost = 0, active_moves = 0, wins_by_flag = 0,
  wins_by_resign = 0, wins_by_nomoves = 0, marathon_games = 0,
  marathon_wins = 0, marshal_showdowns = 0, marshal_showdown_wins = 0,
  updated_at = now();

UPDATE players SET rating = 1500, rating_provisional = true, games_played = 0;

UPDATE games SET stats_computed = false WHERE stats_computed = true;

DELETE FROM achievements;
```

- [ ] **Step 4: Recompute stats for all finished rated games**

Query all finished games with both players (non-bot):

```bash
# Get game IDs
curl -s "https://cafqbrzaxcwewwtyqpnf.supabase.co/rest/v1/games?status=eq.finished&is_bot_game=eq.false&player1_id=not.is.null&player2_id=not.is.null&select=id" \
  -H "apikey: <anon-key>" \
  -H "Authorization: Bearer <service-role-key>"
```

For each game ID, call compute-stats (now idempotent):

```bash
curl -s -X POST https://cafqbrzaxcwewwtyqpnf.supabase.co/functions/v1/compute-stats \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <service-role-key>" \
  -d '{"game_id":"<id>"}'
```

- [ ] **Step 5: Verify profile page**

Navigate to `https://stratego-1ex2.onrender.com/profile.html?user=andy1701`.

Expected:
- Username shows correctly (not "undefined")
- Rating shows a number
- "Member since" shows a real date
- Spy Success Rate shows a percentage (the spy-kills-marshal game is now correctly counted)
- Every stat has a `?` tooltip on hover
- Every achievement badge has a `?` tooltip explaining how to unlock it

- [ ] **Step 6: Verify game-over UI**

Open a finished game URL. Expected:
- Resign button is hidden
- "Victory!" or "Defeat." banner in green/red
- Rematch, Home, and My Profile buttons visible

- [ ] **Step 7: Verify password_hash protection**

```bash
curl -s "https://cafqbrzaxcwewwtyqpnf.supabase.co/rest/v1/players?select=password_hash&limit=1" \
  -H "apikey: <anon-key>"
```

Expected: Empty array or permission error (RLS blocks direct select).

- [ ] **Step 8: Verify resign triggers stats**

Create a rated game, make a move, resign. Check that stats_computed flips to true and player stats update.

---

## Deviation Log

(Record any plan deviations here during implementation)
