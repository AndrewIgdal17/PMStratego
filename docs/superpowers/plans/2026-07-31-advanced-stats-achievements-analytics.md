# Advanced Stats, Achievements & Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 8 new fog-of-war/trade/tempo stats, 11 new achievements (+ implement 2 existing stubs), a radar chart, achievement progress bars, and a form sparkline to the player profile — turning it into a compelling competitive identity page.

**Architecture:** A single large enhancement to `compute-stats` adds a reveal-set replay loop (tracking which enemy pieces each player has "seen" via combat) and computes all new metrics in one pass. New columns added to `player_stats` via migration. Frontend renders the radar chart and sparkline as inline SVG (no external libraries). Achievement progress uses partial counters stored in a new `achievement_progress` JSONB column.

**Tech Stack:** Supabase (Postgres + Edge Functions/Deno), vanilla HTML/CSS/JS frontend, inline SVG for charts.

## Global Constraints

- Supabase project ref: `cafqbrzaxcwewwtyqpnf`
- Frontend: vanilla HTML/CSS/JS, ES modules via esm.sh imports, no build step, no charting libraries
- Edge Functions: Deno/TypeScript, `createClient` from `https://esm.sh/@supabase/supabase-js@2`
- CORS: shared `corsHeaders` from `../_shared/cors.ts`
- Direct commits to main branch
- Rank system: 1=Marshal(strongest)…10=Spy(weakest), "BOMB", "FLAG". Stored as strings in DB. Use the `R` constants object already in compute-stats.
- `RANK_VALUE` map already exists: Marshal=10, General=9, …, Scout=2, Spy=2, Bomb=5, Flag=0
- The `moves` table has: `piece_id`, `player_slot`, `from_row`, `from_col`, `to_row`, `to_col`, `move_type` ("attack"|"move"), `outcome` ("ATTACKER_WINS"|"DEFENDER_WINS"|"TIE"|null), `attacker_rank`, `defender_rank`, `defender_piece_id`, `move_number`
- The `pieces` table has: `id`, `player_slot`, `rank`, `alive`, `game_id`
- Deploy: `npx supabase functions deploy <name> --project-ref cafqbrzaxcwewwtyqpnf`; `npx supabase db push --linked`; frontend via `git push`

---

### Task 1: Migration — New Stats Columns + Achievement Progress

**Files:**
- Create: `supabase/migrations/0012_advanced_stats.sql`

**Interfaces:**
- Produces: New columns on `player_stats` for all 8 metrics + `achievement_progress` JSONB; updates `get_player_profile` RPC to include new fields

- [ ] **Step 1: Write the migration SQL**

```sql
-- supabase/migrations/0012_advanced_stats.sql
-- New fog/trade/tempo stats + achievement progress tracking

-- Reveal Efficiency (attacks on unrevealed that win / total attacks on unrevealed)
alter table player_stats add column reveal_attacks integer not null default 0;
alter table player_stats add column reveal_wins integer not null default 0;

-- Trade Efficiency (net rank-value per combat, stored as sum + count for averaging)
-- Columns trade_efficiency_sum and trade_efficiency_count already exist from 0009

-- Scout Tempo (total manhattan distance of scout moves / scout_moves already tracked)
alter table player_stats add column scout_distance integer not null default 0;

-- Avenge Rate (kills on pieces that previously killed yours / opportunities)
alter table player_stats add column avenge_kills integer not null default 0;
alter table player_stats add column avenge_opportunities integer not null default 0;

-- Spy Timing (sum of first-spy-combat move numbers / games with spy combat, for averaging)
alter table player_stats add column spy_timing_sum integer not null default 0;
alter table player_stats add column spy_timing_games integer not null default 0;

-- Comeback Delta (max deficit overcome in any win)
alter table player_stats add column max_comeback_deficit numeric not null default 0;

-- First-Reveal Conversion (pieces first revealed by you that you later kill)
alter table player_stats add column reveal_then_kill integer not null default 0;
alter table player_stats add column reveal_total integer not null default 0;

-- Unknown Pressure (attacks on unrevealed / total attacks — reuses reveal_attacks + attacks_total)

-- Achievement progress (JSONB with partial counters for locked badges)
alter table player_stats add column achievement_progress jsonb not null default '{}';

-- Career achievement counters
alter table player_stats add column career_kingmakers integer not null default 0;
alter table player_stats add column career_rival_wins jsonb not null default '{}';
```

- [ ] **Step 2: Deploy the migration**

```bash
cd Projects/Stratego/code
npx supabase db push --linked
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0012_advanced_stats.sql
git commit -m "feat: add columns for advanced stats, achievement progress"
```

---

### Task 2: Reveal-Set Replay + All New Stats in compute-stats

**Files:**
- Modify: `supabase/functions/compute-stats/index.ts`

**Interfaces:**
- Consumes: `moves` table (ordered by move_number), `pieces` table, `RANK_VALUE` map, new columns from Task 1
- Produces: All 8 new stat values computed and written to `player_stats`; `trade_efficiency_sum`/`trade_efficiency_count` now actually populated

This is the core logic task. The key addition is a **reveal-set tracker**: for each player, maintain a `Set<string>` of enemy `piece_id`s whose rank has been revealed via combat. An enemy piece is "revealed" to you after any combat it participates in (as attacker or defender) where you can observe the rank.

- [ ] **Step 1: Add the reveal-set replay logic and new stat computations**

After the existing `for (const slot of [1, 2])` block's stat calculations (after `marshalShowdownWins` computation), add the following new metrics block inside the same loop:

```typescript
    // === REVEAL-SET REPLAY ===
    // Track which enemy pieces this player has "seen" (via combat involvement)
    const revealedEnemyIds = new Set<string>();
    let revealAttacks = 0;   // attacks on pieces NOT yet revealed
    let revealWins = 0;      // wins on those unrevealed attacks
    let revealThenKill = 0;  // pieces first revealed by you, later killed by you
    let revealTotal = 0;     // total unique enemy pieces you revealed
    let avengeKills = 0;
    let avengeOpportunities = 0;
    let spyFirstCombatMove: number | null = null;
    let scoutDistance = 0;

    // Track which enemy pieces killed yours (for avenge tracking)
    const killedByEnemy = new Map<string, string[]>(); // enemyPieceId -> [yourPieceIds it killed]
    // Track pieces you first revealed
    const firstRevealedByMe = new Set<string>();

    for (const m of moves) {
      const isMyAttack = m.player_slot === slot && m.move_type === "attack";
      const isEnemyAttack = m.player_slot !== slot && m.move_type === "attack";

      // Scout distance (manhattan distance for all scout moves, not just attacks)
      if (m.player_slot === slot) {
        const piece = pieceById.get(m.piece_id);
        if (piece?.rank === R.SCOUT) {
          scoutDistance += Math.abs(m.to_row - m.from_row) + Math.abs(m.to_col - m.from_col);
        }
      }

      // Spy timing: first combat involving my spy
      if (spyFirstCombatMove === null && m.move_type === "attack") {
        if (m.player_slot === slot && m.attacker_rank === R.SPY) {
          spyFirstCombatMove = m.move_number;
        } else if (m.player_slot !== slot && m.defender_piece_id) {
          const defPiece = pieceById.get(m.defender_piece_id);
          if (defPiece?.player_slot === slot && defPiece?.rank === R.SPY) {
            spyFirstCombatMove = m.move_number;
          }
        }
      }

      if (!m.defender_piece_id) continue;

      // Track reveals: after any combat, both pieces' ranks become "known"
      if (isMyAttack) {
        const wasRevealed = revealedEnemyIds.has(m.defender_piece_id);
        if (!wasRevealed) {
          revealAttacks++;
          if (m.outcome === "ATTACKER_WINS") revealWins++;
          revealedEnemyIds.add(m.defender_piece_id);
          firstRevealedByMe.add(m.defender_piece_id);
          revealTotal++;
        }
      } else if (isEnemyAttack) {
        // Enemy attacked — their piece is now revealed to me
        revealedEnemyIds.add(m.piece_id);
        if (!firstRevealedByMe.has(m.piece_id)) {
          firstRevealedByMe.add(m.piece_id);
          revealTotal++;
        }

        // Track if enemy killed my piece (for avenge)
        if (m.outcome === "ATTACKER_WINS" && m.defender_piece_id) {
          const defPiece = pieceById.get(m.defender_piece_id);
          if (defPiece?.player_slot === slot) {
            if (!killedByEnemy.has(m.piece_id)) killedByEnemy.set(m.piece_id, []);
            killedByEnemy.get(m.piece_id)!.push(m.defender_piece_id);
            avengeOpportunities++;
          }
        }
      }

      // Check if this is an avenge kill (I kill an enemy that previously killed mine)
      if (isMyAttack && m.outcome === "ATTACKER_WINS" && killedByEnemy.has(m.defender_piece_id)) {
        avengeKills++;
      }
      // Also check: enemy attacks me and loses (defender wins) — I killed the piece
      if (isEnemyAttack && m.outcome === "DEFENDER_WINS" && killedByEnemy.has(m.piece_id)) {
        avengeKills++;
      }
    }

    // First-Reveal Conversion: of pieces I first revealed, how many ended up dead?
    for (const enemyId of firstRevealedByMe) {
      const ep = pieceById.get(enemyId);
      if (ep && !ep.alive) revealThenKill++;
    }

    // === TRADE EFFICIENCY ===
    let tradeValue = 0;
    for (const m of moves) {
      if (m.move_type !== "attack" || !m.outcome) continue;
      const attackerVal = RANK_VALUE[m.attacker_rank ?? ""] ?? 0;
      const defenderVal = RANK_VALUE[m.defender_rank ?? ""] ?? 0;

      if (m.player_slot === slot) {
        // I attacked
        if (m.outcome === "ATTACKER_WINS") tradeValue += defenderVal;
        else if (m.outcome === "DEFENDER_WINS") tradeValue -= attackerVal;
        else if (m.outcome === "TIE") tradeValue -= attackerVal; // lost my piece too
      } else {
        // Enemy attacked me
        if (m.outcome === "DEFENDER_WINS") tradeValue += attackerVal;
        else if (m.outcome === "ATTACKER_WINS") tradeValue -= defenderVal;
        else if (m.outcome === "TIE") tradeValue -= defenderVal;
      }
    }

    // === COMEBACK DELTA ===
    let materialDiff = 0;
    let maxDeficit = 0;
    for (const m of moves) {
      if (m.move_type !== "attack" || !m.outcome) continue;
      const attackerVal = RANK_VALUE[m.attacker_rank ?? ""] ?? 0;
      const defenderVal = RANK_VALUE[m.defender_rank ?? ""] ?? 0;

      if (m.player_slot === slot) {
        if (m.outcome === "ATTACKER_WINS") materialDiff += defenderVal;
        else if (m.outcome === "DEFENDER_WINS") materialDiff -= attackerVal;
        else if (m.outcome === "TIE") { materialDiff -= attackerVal; materialDiff += defenderVal; /* net: opponent also lost */ }
      } else {
        if (m.outcome === "ATTACKER_WINS") materialDiff -= defenderVal;
        else if (m.outcome === "DEFENDER_WINS") materialDiff += attackerVal;
        else if (m.outcome === "TIE") { materialDiff += attackerVal; materialDiff -= defenderVal; }
      }
      if (materialDiff < maxDeficit) maxDeficit = materialDiff;
    }
    const comebackDelta = won && maxDeficit < 0 ? Math.abs(maxDeficit) : 0;
```

- [ ] **Step 2: Wire the new values into the stats update call**

Add these fields to the existing `supabase.from("player_stats").update({...})` call:

```typescript
        reveal_attacks: stats.reveal_attacks + revealAttacks,
        reveal_wins: stats.reveal_wins + revealWins,
        scout_distance: stats.scout_distance + scoutDistance,
        avenge_kills: stats.avenge_kills + avengeKills,
        avenge_opportunities: stats.avenge_opportunities + avengeOpportunities,
        spy_timing_sum: stats.spy_timing_sum + (spyFirstCombatMove ?? 0),
        spy_timing_games: stats.spy_timing_games + (spyFirstCombatMove !== null ? 1 : 0),
        max_comeback_deficit: Math.max(stats.max_comeback_deficit ?? 0, comebackDelta),
        reveal_then_kill: stats.reveal_then_kill + revealThenKill,
        reveal_total: stats.reveal_total + revealTotal,
        trade_efficiency_sum: stats.trade_efficiency_sum + tradeValue,
        trade_efficiency_count: stats.trade_efficiency_count + combatsTotal,
        career_kingmakers: stats.career_kingmakers + (spyKills > 0 ? 1 : 0),
```

- [ ] **Step 3: Deploy**

```bash
npx supabase functions deploy compute-stats --project-ref cafqbrzaxcwewwtyqpnf
```

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/compute-stats/index.ts
git commit -m "feat: reveal-set replay + 8 new stats (fog, trade, tempo, comeback)"
```

---

### Task 3: New Achievements in compute-stats

**Files:**
- Modify: `supabase/functions/compute-stats/index.ts`

**Interfaces:**
- Consumes: All replay data from Task 2 (revealedEnemyIds, comebackDelta, spyKills, etc.), `moves`, `pieces`, `RANK_VALUE`
- Produces: 11 new achievement keys checked and upserted; `career_rival_wins` JSONB updated

Add these achievement checks after the existing achievement block:

- [ ] **Step 1: Add new achievement checks**

```typescript
    // --- NEW ACHIEVEMENTS ---

    // Ghost Protocol: Win without Marshal or General entering combat
    const marshalOrGenInCombat = moves.some((m: Move) => {
      if (m.player_slot === slot) {
        return m.attacker_rank === R.MARSHAL || m.attacker_rank === R.GENERAL;
      }
      if (m.player_slot !== slot && m.defender_piece_id) {
        const dp = pieceById.get(m.defender_piece_id);
        return dp?.player_slot === slot && (dp.rank === R.MARSHAL || dp.rank === R.GENERAL);
      }
      return false;
    });
    if (won && !marshalOrGenInCombat) newAchievements.push("ghost_protocol");

    // Phoenix: Win after losing your Marshal
    const myMarshal = playerPieces.find((p: Piece) => p.rank === R.MARSHAL);
    if (won && myMarshal && !myMarshal.alive) newAchievements.push("phoenix");

    // Vendetta: In one game, an enemy piece kills yours, then you later kill that same piece (3+ times)
    if (avengeKills >= 3) newAchievements.push("vendetta");

    // Counterintel: Kill enemy Spy before your Marshal enters any combat
    const enemySpy = enemyPieces.find((p: Piece) => p.rank === R.SPY);
    const enemySpyDead = enemySpy && !enemySpy.alive;
    if (enemySpyDead && won) {
      // Find move where enemy spy died
      const spyDeathMove = moves.find((m: Move) =>
        (m.defender_piece_id === enemySpy.id && m.outcome === "ATTACKER_WINS") ||
        (m.piece_id === enemySpy.id && m.outcome === "DEFENDER_WINS")
      );
      // Find first combat involving my Marshal
      const marshalFirstCombat = moves.find((m: Move) => {
        if (m.player_slot === slot && m.attacker_rank === R.MARSHAL) return true;
        if (m.player_slot !== slot && m.defender_piece_id) {
          const dp = pieceById.get(m.defender_piece_id);
          return dp?.player_slot === slot && dp.rank === R.MARSHAL;
        }
        return false;
      });
      if (spyDeathMove && (!marshalFirstCombat || spyDeathMove.move_number < marshalFirstCombat.move_number)) {
        newAchievements.push("counterintel");
      }
    }

    // Fortress Breaker: Defuse 3+ bombs AND capture the Flag in same game
    if (won && bombDefuses >= 3 && lastMove?.defender_rank === R.FLAG) {
      newAchievements.push("fortress_breaker");
    }

    // Silent General: Win without initiating any attack in first 15 moves
    const earlyAttacks = moves.filter((m: Move) =>
      m.player_slot === slot && m.move_type === "attack" && m.move_number <= 15
    ).length;
    if (won && earlyAttacks === 0) newAchievements.push("silent_general");

    // Nemesis: Beat opponent rated 200+ higher
    if (won && opponent.rating - player.rating >= 200) newAchievements.push("nemesis");

    // Serial Killer (career): 3+ games where spy kills Marshal
    if (stats.career_kingmakers + (spyKills > 0 ? 1 : 0) >= 3) {
      newAchievements.push("serial_killer");
    }

    // Perfect Deminer: Defuse all enemy bombs (6) without losing any Miner to a bomb
    const minersLostToBombs = moves.filter((m: Move) =>
      m.player_slot === slot && m.attacker_rank === R.MINER &&
      m.defender_rank === R.BOMB && m.outcome === "DEFENDER_WINS"
    ).length;
    if (bombDefuses >= 6 && minersLostToBombs === 0) newAchievements.push("perfect_deminer");

    // Counterpunch: Win after being behind by ≥15 rank-value points
    if (won && comebackDelta >= 15) newAchievements.push("counterpunch");

    // Rival Hunter: Beat same opponent 5+ times (career)
    const rivalWins: Record<string, number> = stats.career_rival_wins ?? {};
    rivalWins[oppId] = (rivalWins[oppId] ?? 0) + (won ? 1 : 0);
    if (rivalWins[oppId] >= 5) newAchievements.push("rival_hunter");
```

- [ ] **Step 2: Update career_rival_wins in the stats update**

Add to the `.update()` call:

```typescript
        career_rival_wins: rivalWins,
```

- [ ] **Step 3: Deploy**

```bash
npx supabase functions deploy compute-stats --project-ref cafqbrzaxcwewwtyqpnf
```

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/compute-stats/index.ts
git commit -m "feat: 11 new achievements (ghost_protocol, phoenix, vendetta, counterintel, etc.)"
```

---

### Task 4: Profile Page — New Stats Display + Achievement Labels

**Files:**
- Modify: `web/js/profile.js`

**Interfaces:**
- Consumes: `get_player_profile` RPC (returns `stats` object with new columns from Task 1)
- Produces: Two new stat sections on profile: "Fog & Intelligence" and "Combat Economy"; updated achievement grid with new badges

- [ ] **Step 1: Add new stat sections to renderStats**

After the existing "Strategic Profile" section in the `sections` array, add:

```javascript
    { title: "Fog & Intelligence", items: [
      ["Reveal Efficiency", stats.reveal_attacks > 0 ? `${((stats.reveal_wins / stats.reveal_attacks) * 100).toFixed(0)}%` : "—", "Win rate when attacking pieces you haven't seen before — measures blind-combat judgment"],
      ["Unknown Pressure", stats.attacks_total > 0 ? `${((stats.reveal_attacks / stats.attacks_total) * 100).toFixed(0)}%` : "—", "What fraction of your attacks target unrevealed (unknown) pieces — bold vs cautious"],
      ["First-Reveal Conversion", stats.reveal_total > 0 ? `${((stats.reveal_then_kill / stats.reveal_total) * 100).toFixed(0)}%` : "—", "After revealing an enemy piece, how often do you eventually eliminate it?"],
      ["Scout Tempo", stats.scout_moves > 0 ? `${(stats.scout_distance / stats.scout_moves).toFixed(1)} sq/move` : "—", "Average squares traveled per Scout move — long-range recon vs cautious one-step probes"],
      ["Spy Timing", stats.spy_timing_games > 0 ? `Move ${Math.round(stats.spy_timing_sum / stats.spy_timing_games)}` : "—", "Average move number when your Spy first enters combat — early gamble vs late dagger"],
    ]},
    { title: "Combat Economy", items: [
      ["Trade Efficiency", stats.trade_efficiency_count > 0 ? `${(stats.trade_efficiency_sum / stats.trade_efficiency_count).toFixed(1)}` : "—", "Net rank-value gained per combat (positive = trading up on average)"],
      ["Avenge Rate", stats.avenge_opportunities > 0 ? `${((stats.avenge_kills / stats.avenge_opportunities) * 100).toFixed(0)}%` : "—", "How often you track down and kill a piece that previously killed one of yours"],
      ["Comeback Record", stats.max_comeback_deficit > 0 ? `${stats.max_comeback_deficit} pts` : "—", "Largest rank-value deficit you overcame in a winning game"],
    ]},
```

- [ ] **Step 2: Add new achievement labels**

Add to the `ACHIEVEMENT_LABELS` object:

```javascript
  ghost_protocol: { name: "Ghost Protocol", desc: "Win without your Marshal or General ever entering combat" },
  phoenix: { name: "Phoenix", desc: "Win after losing your Marshal during the game" },
  vendetta: { name: "Vendetta", desc: "Avenge 3+ of your pieces by killing the exact enemy piece that killed them" },
  counterintel: { name: "Counterintel", desc: "Eliminate the enemy Spy before your Marshal is revealed in combat" },
  fortress_breaker: { name: "Fortress Breaker", desc: "Defuse 3+ enemy Bombs AND capture the Flag in the same game" },
  silent_general: { name: "Silent General", desc: "Win without initiating any attack in the first 15 moves" },
  nemesis: { name: "Nemesis", desc: "Beat an opponent rated 200+ points higher than you" },
  serial_killer: { name: "Serial Killer", desc: "Use your Spy to kill the enemy Marshal in 3+ career games" },
  perfect_deminer: { name: "Perfect Deminer", desc: "Defuse all 6 enemy Bombs without losing a single Miner to a Bomb" },
```

- [ ] **Step 3: Commit**

```bash
git add web/js/profile.js
git commit -m "feat: display new fog/economy stats + 9 achievement badges on profile"
```

---

### Task 5: Radar Chart ("Your Stratego DNA")

**Files:**
- Modify: `web/js/profile.js`
- Modify: `web/css/styles.css`

**Interfaces:**
- Consumes: Player stats from `get_player_profile` response
- Produces: SVG radar chart with 6 axes rendered at the top of the stats section

The 6 axes (each normalized 0–1 from existing stats):
1. **Aggression** — `forward_moves / total_moves`
2. **Initiative** — `combats_initiated / combats_total`
3. **Fog Breaking** — `reveal_wins / reveal_attacks` (reveal efficiency)
4. **Bomb Craft** — `bombs_detonated / total_bombs`
5. **Endgame** — `marathon_wins / marathon_games` (marathon win rate)
6. **Material** — Trade efficiency normalized (clamp `trade_efficiency_sum/trade_efficiency_count` to [-5,+5] then map to 0-1)

- [ ] **Step 1: Add radar chart rendering function**

```javascript
function renderRadar(stats) {
  const el = document.getElementById("profile-stats");
  if (!stats || (stats.wins + stats.losses + stats.draws) < 1) return;

  const axes = [
    { label: "Aggression", value: stats.total_moves > 0 ? stats.forward_moves / stats.total_moves : 0 },
    { label: "Initiative", value: stats.combats_total > 0 ? stats.combats_initiated / stats.combats_total : 0 },
    { label: "Fog Breaking", value: stats.reveal_attacks > 0 ? stats.reveal_wins / stats.reveal_attacks : 0 },
    { label: "Bomb Craft", value: stats.total_bombs > 0 ? stats.bombs_detonated / stats.total_bombs : 0 },
    { label: "Endgame", value: stats.marathon_games > 0 ? stats.marathon_wins / stats.marathon_games : 0.5 },
    { label: "Material", value: stats.trade_efficiency_count > 0 ? Math.min(1, Math.max(0, (stats.trade_efficiency_sum / stats.trade_efficiency_count + 5) / 10)) : 0.5 },
  ];

  const cx = 100, cy = 100, r = 70;
  const n = axes.length;
  const angleStep = (2 * Math.PI) / n;

  function point(i, scale) {
    const angle = -Math.PI / 2 + i * angleStep;
    return [cx + r * scale * Math.cos(angle), cy + r * scale * Math.sin(angle)];
  }

  // Background rings
  let rings = "";
  for (const ringScale of [0.25, 0.5, 0.75, 1.0]) {
    const pts = Array.from({ length: n }, (_, i) => point(i, ringScale).join(",")).join(" ");
    rings += `<polygon points="${pts}" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="0.5"/>`;
  }

  // Axis lines + labels
  let axisLines = "";
  for (let i = 0; i < n; i++) {
    const [px, py] = point(i, 1);
    axisLines += `<line x1="${cx}" y1="${cy}" x2="${px}" y2="${py}" stroke="rgba(255,255,255,0.15)" stroke-width="0.5"/>`;
    const [lx, ly] = point(i, 1.2);
    axisLines += `<text x="${lx}" y="${ly}" text-anchor="middle" dominant-baseline="middle" fill="rgba(255,255,255,0.7)" font-size="7">${axes[i].label}</text>`;
  }

  // Data polygon
  const dataPts = axes.map((a, i) => point(i, Math.max(0.05, a.value)).join(",")).join(" ");
  const dataPolygon = `<polygon points="${dataPts}" fill="rgba(100,200,150,0.25)" stroke="rgba(100,200,150,0.8)" stroke-width="1.5"/>`;

  // Data dots
  let dots = "";
  axes.forEach((a, i) => {
    const [dx, dy] = point(i, Math.max(0.05, a.value));
    dots += `<circle cx="${dx}" cy="${dy}" r="2.5" fill="rgba(100,200,150,0.9)"/>`;
  });

  const svg = `<svg viewBox="0 0 200 200" class="radar-chart">${rings}${axisLines}${dataPolygon}${dots}</svg>`;
  const container = document.createElement("div");
  container.className = "radar-container";
  container.innerHTML = `<h3>Your Stratego DNA</h3>${svg}`;
  el.insertBefore(container, el.firstChild);
}
```

- [ ] **Step 2: Call renderRadar from loadProfile**

In `loadProfile`, after `renderStats(stats)`:

```javascript
  renderRadar(stats);
```

- [ ] **Step 3: Add CSS for radar chart**

```css
/* Radar chart */
.radar-container { text-align: center; margin-bottom: 1.5rem; }
.radar-container h3 { margin-bottom: 0.5rem; }
.radar-chart { width: 220px; height: 220px; display: inline-block; }
```

- [ ] **Step 4: Commit**

```bash
git add web/js/profile.js web/css/styles.css
git commit -m "feat: add SVG radar chart (Your Stratego DNA) to profile"
```

---

### Task 6: Form Sparkline (Last 20 Games)

**Files:**
- Modify: `web/js/profile.js`
- Modify: `web/css/styles.css`

**Interfaces:**
- Consumes: `get_game_history` RPC data (already fetched in `loadHistory`)
- Produces: Mini W/L sparkline strip above the game history table

- [ ] **Step 1: Add sparkline rendering in loadHistory**

Replace the beginning of `loadHistory` to also render a sparkline:

```javascript
async function loadHistory(username) {
  const { data, error } = await supabase.rpc("get_game_history", { p_username: username, p_limit: 20, p_offset: 0 });
  const el = document.getElementById("profile-history");
  if (error || !data || data.length === 0) {
    el.innerHTML = "<h3>Game History</h3><p>No games yet.</p>";
    return;
  }

  // Form sparkline (last 20 games, newest on right)
  const reversed = [...data].reverse();
  const pills = reversed.map((g) => {
    const result = g.winner_slot === g.player_slot ? "W" : (g.winner_slot ? "L" : "D");
    const cls = result === "W" ? "pill-win" : (result === "L" ? "pill-loss" : "pill-draw");
    return `<span class="form-pill ${cls}" title="vs ${g.opponent_username || 'Anon'} (${g.turn_number || '?'} moves)">${result}</span>`;
  }).join("");
  const sparkline = `<div class="form-sparkline"><span class="form-label">Last ${data.length}:</span>${pills}</div>`;

  el.innerHTML = `
    <h3>Game History</h3>
    ${sparkline}
    <table class="history-table">
      <thead><tr><th>Opponent</th><th>Result</th><th>Moves</th><th>Date</th></tr></thead>
      <tbody>
        ${data.map((g) => {
          const result = g.winner_slot === g.player_slot ? "Win" : (g.winner_slot ? "Loss" : "Draw");
          const cls = result === "Win" ? "win" : (result === "Loss" ? "loss" : "draw");
          return `<tr>
            <td><a href="profile.html?user=${encodeURIComponent(g.opponent_username || "Anonymous")}">${g.opponent_username || "Anonymous"}</a></td>
            <td class="${cls}">${result}</td>
            <td>${g.turn_number || "—"}</td>
            <td>${new Date(g.created_at).toLocaleDateString()}</td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>
  `;
}
```

- [ ] **Step 2: Add CSS for form pills**

```css
/* Form sparkline */
.form-sparkline { display: flex; align-items: center; gap: 3px; margin-bottom: 0.75rem; flex-wrap: wrap; }
.form-label { font-size: 0.75rem; opacity: 0.6; margin-right: 0.3rem; }
.form-pill { display: inline-block; width: 20px; height: 20px; line-height: 20px; text-align: center; border-radius: 3px; font-size: 0.6rem; font-weight: bold; }
.pill-win { background: rgba(100, 200, 100, 0.3); color: #6c6; }
.pill-loss { background: rgba(200, 100, 100, 0.3); color: #c66; }
.pill-draw { background: rgba(200, 200, 100, 0.3); color: #cc6; }
```

- [ ] **Step 3: Commit**

```bash
git add web/js/profile.js web/css/styles.css
git commit -m "feat: add form sparkline (last 20 games W/L/D pills) to profile"
```

---

### Task 7: Achievement Progress Bars

**Files:**
- Modify: `web/js/profile.js`
- Modify: `web/css/styles.css`

**Interfaces:**
- Consumes: `achievement_progress` JSONB from stats, existing `ACHIEVEMENT_LABELS`
- Produces: Locked achievements show partial progress (e.g., "2/3 bomb defuses this career")

- [ ] **Step 1: Update renderAchievements to show progress**

```javascript
function renderAchievements(achievements, stats) {
  const el = document.getElementById("profile-achievements");
  const unlocked = new Set((achievements || []).map((a) => a.achievement_key));
  const progress = stats?.achievement_progress ?? {};

  // Define progress hints for locked badges
  const progressHints = {
    rival_hunter: () => {
      const rivals = stats?.career_rival_wins ?? {};
      const best = Object.entries(rivals).sort(([,a],[,b]) => (b as number) - (a as number))[0];
      return best ? `${best[1]}/5 vs top rival` : null;
    },
    serial_killer: () => stats?.career_kingmakers > 0 ? `${stats.career_kingmakers}/3 spy kills` : null,
    counterpunch: () => stats?.max_comeback_deficit > 0 ? `Best: ${stats.max_comeback_deficit}/15 pts` : null,
  };

  el.innerHTML = `
    <h3>Achievements</h3>
    <div class="achievements-grid">
      ${Object.entries(ACHIEVEMENT_LABELS).map(([key, { name, desc }]) => {
        const isUnlocked = unlocked.has(key);
        let progressBar = "";
        if (!isUnlocked && progressHints[key]) {
          const hint = progressHints[key]();
          if (hint) progressBar = `<span class="achievement-progress">${hint}</span>`;
        }
        return `
          <div class="achievement-item ${isUnlocked ? "unlocked" : "locked"}">
            <span class="achievement-name">${name}</span>
            <span class="stat-help" data-tooltip="${desc}">?</span>
            ${progressBar}
          </div>
        `;
      }).join("")}
    </div>
  `;
}
```

- [ ] **Step 2: Update loadProfile to pass stats to renderAchievements**

```javascript
  renderAchievements(achievements, stats);
```

- [ ] **Step 3: Add CSS for progress hints**

```css
.achievement-progress { display: block; font-size: 0.65rem; opacity: 0.7; margin-top: 2px; }
```

- [ ] **Step 4: Commit**

```bash
git add web/js/profile.js web/css/styles.css
git commit -m "feat: achievement progress bars for locked badges"
```

---

### Task 8: Combat Heatmap

**Files:**
- Modify: `supabase/migrations/0012_advanced_stats.sql` (add JSONB column)
- Modify: `supabase/functions/compute-stats/index.ts`
- Modify: `web/js/profile.js`
- Modify: `web/css/styles.css`

**Interfaces:**
- Consumes: Attack moves (`to_row`, `to_col`, `outcome`) from compute-stats replay
- Produces: 10×10 grid JSONB stored in `player_stats`, rendered as SVG heatmap on profile

The heatmap aggregates where your attacks land on the board, colored by win rate at each cell.

- [ ] **Step 1: Add column to migration**

Add to `0012_advanced_stats.sql`:

```sql
-- Combat heatmap: 10x10 grid of {attacks, wins} stored as JSONB
alter table player_stats add column attack_heatmap jsonb not null default '{}';
```

- [ ] **Step 2: Compute heatmap data in compute-stats**

After the reveal-set replay loop, add:

```typescript
    // === COMBAT HEATMAP ===
    const heatmap: Record<string, { attacks: number; wins: number }> = { ...(stats.attack_heatmap ?? {}) };
    for (const m of moves) {
      if (m.player_slot === slot && m.move_type === "attack") {
        const key = `${m.to_row},${m.to_col}`;
        if (!heatmap[key]) heatmap[key] = { attacks: 0, wins: 0 };
        heatmap[key].attacks++;
        if (m.outcome === "ATTACKER_WINS") heatmap[key].wins++;
      }
    }
```

Add to stats update: `attack_heatmap: heatmap,`

- [ ] **Step 3: Render SVG heatmap on profile**

```javascript
function renderHeatmap(stats) {
  if (!stats || !stats.attack_heatmap || Object.keys(stats.attack_heatmap).length === 0) return;
  const el = document.getElementById("profile-stats");

  const cellSize = 22;
  const padding = 2;
  const boardSize = cellSize * 10 + padding * 9;
  const lakeSquares = new Set(["4,2","4,3","5,2","5,3","4,6","4,7","5,6","5,7"]);

  let maxAttacks = 0;
  for (const v of Object.values(stats.attack_heatmap)) {
    if (v.attacks > maxAttacks) maxAttacks = v.attacks;
  }

  let cells = "";
  for (let row = 0; row < 10; row++) {
    for (let col = 0; col < 10; col++) {
      const key = `${row},${col}`;
      const x = col * (cellSize + padding);
      const y = row * (cellSize + padding);

      if (lakeSquares.has(key)) {
        cells += `<rect x="${x}" y="${y}" width="${cellSize}" height="${cellSize}" fill="rgba(50,80,120,0.4)" rx="2"/>`;
        continue;
      }

      const data = stats.attack_heatmap[key];
      if (!data || data.attacks === 0) {
        cells += `<rect x="${x}" y="${y}" width="${cellSize}" height="${cellSize}" fill="rgba(255,255,255,0.03)" rx="2"/>`;
      } else {
        const intensity = data.attacks / maxAttacks;
        const winRate = data.wins / data.attacks;
        const r = Math.round(200 * (1 - winRate) * intensity);
        const g = Math.round(200 * winRate * intensity);
        cells += `<rect x="${x}" y="${y}" width="${cellSize}" height="${cellSize}" fill="rgba(${r},${g},50,${0.2 + intensity * 0.6})" rx="2"/>`;
        if (data.attacks >= 3) {
          cells += `<text x="${x + cellSize/2}" y="${y + cellSize/2 + 1}" text-anchor="middle" dominant-baseline="middle" fill="rgba(255,255,255,0.7)" font-size="7">${data.attacks}</text>`;
        }
      }
    }
  }

  const svg = `<svg viewBox="0 0 ${boardSize} ${boardSize}" class="heatmap-board">${cells}</svg>`;
  const container = document.createElement("div");
  container.className = "heatmap-container";
  container.innerHTML = `<h3>Combat Heatmap <span class="stat-help" data-tooltip="Where your attacks land on the board. Green = high win rate, Red = low win rate. Brighter = more attacks.">?</span></h3><div class="heatmap-legend"><span class="legend-loss">Losses</span><span class="legend-win">Wins</span></div>${svg}`;
  el.appendChild(container);
}
```

- [ ] **Step 4: Add CSS**

```css
.heatmap-container { text-align: center; margin: 1.5rem 0; }
.heatmap-board { width: 240px; height: 240px; display: inline-block; }
.heatmap-legend { font-size: 0.7rem; margin-bottom: 0.3rem; display: flex; justify-content: center; gap: 1rem; }
.legend-loss { color: #c66; }
.legend-win { color: #6c6; }
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0012_advanced_stats.sql supabase/functions/compute-stats/index.ts web/js/profile.js web/css/styles.css
git commit -m "feat: combat heatmap — board visualization of attack locations + win rate"
```

---

### Task 9: Material Curve (Per-Game Sparkline)

**Files:**
- Modify: `supabase/migrations/0012_advanced_stats.sql` (add game_summaries table)
- Modify: `supabase/functions/compute-stats/index.ts`
- Create: `web/js/gameSummary.js` (inline SVG sparkline component)
- Modify: `web/js/profile.js`

**Interfaces:**
- Consumes: Combat replay data; writes per-game material curve to `game_summaries` table
- Produces: Sparkline SVG in game history table rows (expandable on click)

- [ ] **Step 1: Add game_summaries table to migration**

```sql
-- Per-game summary for material curves and analytics
create table game_summaries (
  game_id uuid primary key references games(id) on delete cascade,
  material_curve_p1 integer[] not null default '{}',
  material_curve_p2 integer[] not null default '{}',
  created_at timestamptz not null default now()
);

alter table game_summaries enable row level security;
create policy game_summaries_select on game_summaries for select using (true);

-- RPC to fetch a game summary
create or replace function get_game_summary(p_game_id uuid)
returns json
language sql
security definer
set search_path = public
as $$
  select row_to_json(gs) from game_summaries gs where gs.game_id = p_game_id;
$$;

grant execute on function get_game_summary(uuid) to anon;
```

- [ ] **Step 2: Compute and store material curve in compute-stats**

After the comeback-delta calculation (which already replays material), store the curve:

```typescript
  // === MATERIAL CURVE (store per-game) ===
  const curveP1: number[] = [];
  const curveP2: number[] = [];
  let diffP1 = 0;
  for (const m of moves) {
    if (m.move_type !== "attack" || !m.outcome) continue;
    const attackerVal = RANK_VALUE[m.attacker_rank ?? ""] ?? 0;
    const defenderVal = RANK_VALUE[m.defender_rank ?? ""] ?? 0;

    if (m.player_slot === 1) {
      if (m.outcome === "ATTACKER_WINS") diffP1 += defenderVal;
      else if (m.outcome === "DEFENDER_WINS") diffP1 -= attackerVal;
      else if (m.outcome === "TIE") diffP1 -= attackerVal;
    } else {
      if (m.outcome === "ATTACKER_WINS") diffP1 -= defenderVal;
      else if (m.outcome === "DEFENDER_WINS") diffP1 += attackerVal;
      else if (m.outcome === "TIE") diffP1 += attackerVal;
    }
    curveP1.push(diffP1);
    curveP2.push(-diffP1);
  }

  // Store (outside the per-slot loop — do this once after both slots processed)
  await supabase.from("game_summaries").upsert({
    game_id,
    material_curve_p1: curveP1,
    material_curve_p2: curveP2,
  }, { onConflict: "game_id" });
```

- [ ] **Step 3: Create sparkline renderer**

```javascript
// web/js/gameSummary.js
export function materialSparkline(curve, playerSlot) {
  if (!curve || curve.length === 0) return "";
  const data = playerSlot === 1 ? curve : curve.map(v => -v);
  const w = 120, h = 30, pad = 2;
  const min = Math.min(0, ...data);
  const max = Math.max(0, ...data);
  const range = max - min || 1;

  const points = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * (w - 2 * pad);
    const y = pad + (1 - (v - min) / range) * (h - 2 * pad);
    return `${x},${y}`;
  }).join(" ");

  const zeroY = pad + (1 - (0 - min) / range) * (h - 2 * pad);

  return `<svg viewBox="0 0 ${w} ${h}" class="material-spark">
    <line x1="${pad}" y1="${zeroY}" x2="${w-pad}" y2="${zeroY}" stroke="rgba(255,255,255,0.2)" stroke-width="0.5"/>
    <polyline points="${points}" fill="none" stroke="rgba(100,200,150,0.8)" stroke-width="1.5"/>
  </svg>`;
}
```

- [ ] **Step 4: Integrate into game history**

In `profile.js`, in the history table, add a "Curve" column that fetches summaries lazily or renders a placeholder.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0012_advanced_stats.sql supabase/functions/compute-stats/index.ts web/js/gameSummary.js web/js/profile.js
git commit -m "feat: per-game material curve sparkline in game history"
```

---

### Task 10: Head-to-Head Cards

**Files:**
- Modify: `supabase/migrations/0012_advanced_stats.sql` (add RPC)
- Modify: `web/js/profile.js`
- Modify: `web/css/styles.css`

**Interfaces:**
- Consumes: `games` table (player1_id, player2_id, winner_slot)
- Produces: When viewing another player's profile while logged in, shows H2H record card

- [ ] **Step 1: Add head-to-head RPC to migration**

```sql
create or replace function get_head_to_head(p_player1_id uuid, p_player2_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_p1_wins integer;
  v_p2_wins integer;
  v_draws integer;
  v_total_games integer;
  v_avg_moves numeric;
begin
  select
    count(*) filter (where (player1_id = p_player1_id and winner_slot = 1) or (player2_id = p_player1_id and winner_slot = 2)),
    count(*) filter (where (player1_id = p_player2_id and winner_slot = 1) or (player2_id = p_player2_id and winner_slot = 2)),
    count(*) filter (where winner_slot is null),
    count(*),
    avg(turn_number)
  into v_p1_wins, v_p2_wins, v_draws, v_total_games, v_avg_moves
  from games
  where status = 'finished'
    and is_bot_game = false
    and ((player1_id = p_player1_id and player2_id = p_player2_id)
      or (player1_id = p_player2_id and player2_id = p_player1_id));

  return json_build_object(
    'p1_wins', v_p1_wins,
    'p2_wins', v_p2_wins,
    'draws', v_draws,
    'total_games', v_total_games,
    'avg_moves', round(v_avg_moves)
  );
end;
$$;

grant execute on function get_head_to_head(uuid, uuid) to anon;
```

- [ ] **Step 2: Render H2H card on profile when logged in as different user**

```javascript
async function renderHeadToHead(profilePlayerId, username) {
  const { getAuthToken, getUsername } = await import("./auth.js");
  const myUsername = getUsername();
  if (!myUsername || myUsername.toLowerCase() === username.toLowerCase()) return;

  // Get my player ID
  const { data: myProfile } = await supabase.rpc("get_player_profile", { p_username: myUsername });
  if (!myProfile?.player?.id) return;

  const { data: h2h } = await supabase.rpc("get_head_to_head", {
    p_player1_id: myProfile.player.id,
    p_player2_id: profilePlayerId,
  });

  if (!h2h || h2h.total_games === 0) return;

  const el = document.getElementById("profile-header");
  const card = document.createElement("div");
  card.className = "h2h-card";
  card.innerHTML = `
    <div class="h2h-title">Head-to-Head vs ${username}</div>
    <div class="h2h-record">
      <span class="h2h-wins">${h2h.p1_wins}W</span>
      <span class="h2h-draws">${h2h.draws}D</span>
      <span class="h2h-losses">${h2h.p2_wins}L</span>
    </div>
    <div class="h2h-meta">${h2h.total_games} games, avg ${h2h.avg_moves} moves</div>
  `;
  el.after(card);
}
```

- [ ] **Step 3: Add CSS**

```css
.h2h-card { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; padding: 0.75rem 1rem; margin: 0.75rem 0; display: inline-block; }
.h2h-title { font-size: 0.8rem; opacity: 0.7; margin-bottom: 0.3rem; }
.h2h-record { font-size: 1.2rem; font-weight: bold; display: flex; gap: 0.75rem; }
.h2h-wins { color: #6c6; }
.h2h-draws { color: #cc6; }
.h2h-losses { color: #c66; }
.h2h-meta { font-size: 0.75rem; opacity: 0.6; margin-top: 0.3rem; }
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0012_advanced_stats.sql web/js/profile.js web/css/styles.css
git commit -m "feat: head-to-head card when viewing another player's profile"
```

---

### Task 11: Archetype Engine

**Files:**
- Modify: `supabase/functions/compute-stats/index.ts`
- Modify: `web/js/profile.js`
- Modify: `web/css/styles.css`

**Interfaces:**
- Consumes: Existing stats (aggression index, initiative ratio, reveal efficiency, bomb efficiency, marathon win rate, trade efficiency)
- Produces: `archetype` column updated every 5 games; profile badge shows primary archetype with confidence

Archetypes (rule-based scoring from stat axes):
- **Brawler** — high aggression + high initiative + high combats_initiated
- **Trapper** — high bomb efficiency + low aggression + high avenge rate
- **Scout Main** — high scout_distance + high reveal_efficiency
- **Grinder** — high marathon_win_rate + high total_moves + low aggression
- **Assassin** — high spy_kills + high first_blood + high unknown_pressure
- **Fortress** — low aggression + high miner_survival + high officer_preservation

- [ ] **Step 1: Add archetype computation at end of compute-stats**

After stats update, if `newGamesPlayed % 5 === 0`:

```typescript
    // Archetype refresh every 5 games
    if (newGamesPlayed % 5 === 0 && newGamesPlayed >= 5) {
      const updatedStats = { ...stats,
        reveal_attacks: stats.reveal_attacks + revealAttacks,
        reveal_wins: stats.reveal_wins + revealWins,
        forward_moves: stats.forward_moves + forwardMoves,
        total_moves: stats.total_moves + playerMoves.length,
        combats_initiated: stats.combats_initiated + combatsAsAttacker,
        combats_total: stats.combats_total + combatsTotal,
        bombs_detonated: stats.bombs_detonated + bombsDetonated,
        total_bombs: stats.total_bombs + myBombs.length,
        scout_distance: stats.scout_distance + scoutDistance,
        scout_moves: stats.scout_moves + scoutMoves,
        marathon_wins: stats.marathon_wins + (isMarathon && won ? 1 : 0),
        marathon_games: stats.marathon_games + (isMarathon ? 1 : 0),
        avenge_kills: stats.avenge_kills + avengeKills,
        avenge_opportunities: stats.avenge_opportunities + avengeOpportunities,
        trade_efficiency_sum: stats.trade_efficiency_sum + tradeValue,
        trade_efficiency_count: stats.trade_efficiency_count + combatsTotal,
        spy_kills: stats.spy_kills + spyKills,
        first_bloods: stats.first_bloods + (gotFirstBlood ? 1 : 0),
        miners_survived: stats.miners_survived + minersSurvived,
        miners_started: stats.miners_started + myMiners.length,
      };

      const aggression = updatedStats.total_moves > 0 ? updatedStats.forward_moves / updatedStats.total_moves : 0;
      const initiative = updatedStats.combats_total > 0 ? updatedStats.combats_initiated / updatedStats.combats_total : 0;
      const revealEff = updatedStats.reveal_attacks > 0 ? updatedStats.reveal_wins / updatedStats.reveal_attacks : 0;
      const bombEff = updatedStats.total_bombs > 0 ? updatedStats.bombs_detonated / updatedStats.total_bombs : 0;
      const marathonWR = updatedStats.marathon_games > 0 ? updatedStats.marathon_wins / updatedStats.marathon_games : 0;
      const tradeEff = updatedStats.trade_efficiency_count > 0 ? updatedStats.trade_efficiency_sum / updatedStats.trade_efficiency_count : 0;
      const scoutTempo = updatedStats.scout_moves > 0 ? updatedStats.scout_distance / updatedStats.scout_moves : 0;
      const avengeRate = updatedStats.avenge_opportunities > 0 ? updatedStats.avenge_kills / updatedStats.avenge_opportunities : 0;
      const minerSurv = updatedStats.miners_started > 0 ? updatedStats.miners_survived / updatedStats.miners_started : 0;
      const totalGames = newWins + newLosses + newDraws;
      const firstBloodRate = totalGames > 0 ? updatedStats.first_bloods / totalGames : 0;
      const unknownPressure = updatedStats.attacks_total > 0 ? updatedStats.reveal_attacks / updatedStats.attacks_total : 0;

      const scores: Record<string, number> = {
        brawler: aggression * 3 + initiative * 2 + firstBloodRate,
        trapper: bombEff * 3 + (1 - aggression) * 2 + avengeRate,
        scout_main: (scoutTempo / 5) * 3 + revealEff * 2 + unknownPressure,
        grinder: marathonWR * 3 + (1 - aggression) * 2 + minerSurv,
        assassin: (updatedStats.spy_kills > 0 ? 1 : 0) * 2 + firstBloodRate * 2 + unknownPressure * 2,
        fortress: (1 - aggression) * 2 + minerSurv * 2 + bombEff * 2,
      };

      const archetype = Object.entries(scores).sort(([,a],[,b]) => b - a)[0][0];

      await supabase.from("player_stats").update({
        archetype,
        archetype_updated_at: new Date().toISOString(),
      }).eq("player_id", playerId);
    }
```

- [ ] **Step 2: Display archetype badge on profile**

The existing `renderHeader` already shows `stats.archetype` if present. Update the badge styling and add a tooltip:

```javascript
${stats?.archetype ? `<span class="archetype-badge" data-tooltip="Playstyle archetype — recalculated every 5 games based on your stat pattern">${stats.archetype.replace('_', ' ')}</span>` : ""}
```

- [ ] **Step 3: Add archetype badge CSS**

```css
.archetype-badge { background: rgba(100,200,150,0.15); border: 1px solid rgba(100,200,150,0.4); padding: 0.15rem 0.6rem; border-radius: 12px; text-transform: capitalize; font-size: 0.8rem; cursor: help; position: relative; }
```

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/compute-stats/index.ts web/js/profile.js web/css/styles.css
git commit -m "feat: archetype engine — rule-based playstyle classification every 5 games"
```

---

### Task 12: Piece Fate / Signature Weapons

**Files:**
- Modify: `supabase/migrations/0012_advanced_stats.sql`
- Modify: `supabase/functions/compute-stats/index.ts`
- Modify: `web/js/profile.js`
- Modify: `web/css/styles.css`

**Interfaces:**
- Consumes: Combat data (attacker_rank, defender_rank, outcome, player_slot)
- Produces: JSONB tracking "what ranks kill your pieces" and "what ranks you kill with"; displayed as compact bar charts

- [ ] **Step 1: Add columns to migration**

```sql
-- Piece fate: what ranks kill yours, what ranks you kill with
alter table player_stats add column kills_by_rank jsonb not null default '{}';
alter table player_stats add column deaths_by_rank jsonb not null default '{}';
```

- [ ] **Step 2: Compute in compute-stats**

```typescript
    // === PIECE FATE / SIGNATURE WEAPONS ===
    const killsByRank: Record<string, number> = { ...(stats.kills_by_rank ?? {}) };
    const deathsByRank: Record<string, number> = { ...(stats.deaths_by_rank ?? {}) };

    for (const m of moves) {
      if (m.move_type !== "attack" || !m.outcome) continue;

      if (m.player_slot === slot) {
        if (m.outcome === "ATTACKER_WINS" && m.attacker_rank) {
          killsByRank[m.attacker_rank] = (killsByRank[m.attacker_rank] ?? 0) + 1;
        }
        if (m.outcome === "DEFENDER_WINS" && m.attacker_rank) {
          deathsByRank[m.defender_rank ?? "?"] = (deathsByRank[m.defender_rank ?? "?"] ?? 0) + 1;
        }
      } else {
        if (m.outcome === "DEFENDER_WINS" && m.defender_piece_id) {
          const dp = pieceById.get(m.defender_piece_id);
          if (dp?.player_slot === slot && dp.rank) {
            killsByRank[dp.rank] = (killsByRank[dp.rank] ?? 0) + 1;
          }
        }
        if (m.outcome === "ATTACKER_WINS" && m.defender_piece_id) {
          const dp = pieceById.get(m.defender_piece_id);
          if (dp?.player_slot === slot) {
            deathsByRank[m.attacker_rank ?? "?"] = (deathsByRank[m.attacker_rank ?? "?"] ?? 0) + 1;
          }
        }
      }
    }
```

Add to update: `kills_by_rank: killsByRank, deaths_by_rank: deathsByRank,`

- [ ] **Step 3: Render on profile**

```javascript
const RANK_DISPLAY = { "1":"Marshal","2":"General","3":"Colonel","4":"Major","5":"Captain","6":"Lieutenant","7":"Sergeant","8":"Miner","9":"Scout","10":"Spy","BOMB":"Bomb" };

function renderPieceFate(stats) {
  if (!stats?.kills_by_rank || Object.keys(stats.kills_by_rank).length === 0) return;
  const el = document.getElementById("profile-stats");

  function barChart(data, title, color) {
    const entries = Object.entries(data).filter(([k]) => RANK_DISPLAY[k]).sort(([,a],[,b]) => (b as number) - (a as number)).slice(0, 5);
    if (entries.length === 0) return "";
    const max = Math.max(...entries.map(([,v]) => v as number));
    return `<div class="fate-chart"><h4>${title}</h4>${entries.map(([rank, count]) =>
      `<div class="fate-bar-row"><span class="fate-label">${RANK_DISPLAY[rank]}</span><div class="fate-bar" style="width:${((count as number)/max)*100}%;background:${color}"></div><span class="fate-count">${count}</span></div>`
    ).join("")}</div>`;
  }

  const container = document.createElement("div");
  container.className = "piece-fate-section";
  container.innerHTML = `
    <details class="stats-section" open>
      <summary>&#9660; Signature Weapons</summary>
      <div class="fate-grid">
        ${barChart(stats.kills_by_rank, "You Kill With", "rgba(100,200,100,0.6)")}
        ${barChart(stats.deaths_by_rank, "You Die To", "rgba(200,100,100,0.6)")}
      </div>
    </details>
  `;
  el.appendChild(container);
}
```

- [ ] **Step 4: Add CSS**

```css
.fate-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; padding: 0.5rem 0; }
.fate-chart h4 { font-size: 0.8rem; margin-bottom: 0.3rem; opacity: 0.8; }
.fate-bar-row { display: flex; align-items: center; gap: 0.3rem; margin-bottom: 2px; }
.fate-label { font-size: 0.7rem; width: 55px; text-align: right; opacity: 0.7; }
.fate-bar { height: 12px; border-radius: 2px; min-width: 4px; }
.fate-count { font-size: 0.65rem; opacity: 0.6; }
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0012_advanced_stats.sql supabase/functions/compute-stats/index.ts web/js/profile.js web/css/styles.css
git commit -m "feat: piece fate / signature weapons — bar charts of kill/death by rank"
```

---

### Task 13: Seasonal Micro-Leaderboards

**Files:**
- Modify: `supabase/migrations/0012_advanced_stats.sql` (add RPCs)
- Modify: `web/index.html`
- Modify: `web/js/home.js`
- Modify: `web/css/styles.css`

**Interfaces:**
- Consumes: `player_stats` table (existing aggregates)
- Produces: Multiple leaderboard tabs on home page — not just Elo, but "Best Spy%", "Trade King", "Fog Breaker", etc.

- [ ] **Step 1: Add micro-leaderboard RPC**

```sql
create or replace function get_micro_leaderboard(p_category text, p_limit integer default 10)
returns json
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_category = 'spy_rate' then
    return (select json_agg(row_to_json(t)) from (
      select p.username, round(ps.spy_kills::numeric / nullif(ps.spy_combats, 0) * 100, 1) as value
      from player_stats ps join players p on p.id = ps.player_id
      where ps.spy_combats >= 3 and p.games_played >= 5
      order by ps.spy_kills::numeric / ps.spy_combats desc limit p_limit
    ) t);
  elsif p_category = 'trade_efficiency' then
    return (select json_agg(row_to_json(t)) from (
      select p.username, round(ps.trade_efficiency_sum / nullif(ps.trade_efficiency_count, 0)::numeric, 2) as value
      from player_stats ps join players p on p.id = ps.player_id
      where ps.trade_efficiency_count >= 20 and p.games_played >= 5
      order by ps.trade_efficiency_sum::numeric / ps.trade_efficiency_count desc limit p_limit
    ) t);
  elsif p_category = 'reveal_efficiency' then
    return (select json_agg(row_to_json(t)) from (
      select p.username, round(ps.reveal_wins::numeric / nullif(ps.reveal_attacks, 0) * 100, 1) as value
      from player_stats ps join players p on p.id = ps.player_id
      where ps.reveal_attacks >= 10 and p.games_played >= 5
      order by ps.reveal_wins::numeric / ps.reveal_attacks desc limit p_limit
    ) t);
  elsif p_category = 'bomb_craft' then
    return (select json_agg(row_to_json(t)) from (
      select p.username, round(ps.bombs_detonated::numeric / nullif(ps.total_bombs, 0) * 100, 1) as value
      from player_stats ps join players p on p.id = ps.player_id
      where ps.total_bombs >= 12 and p.games_played >= 5
      order by ps.bombs_detonated::numeric / ps.total_bombs desc limit p_limit
    ) t);
  else
    return '[]'::json;
  end if;
end;
$$;

grant execute on function get_micro_leaderboard(text, integer) to anon;
```

- [ ] **Step 2: Add tabbed leaderboard UI to home page**

In `home.js`, add a category selector above the leaderboard:

```javascript
const LEADERBOARD_CATEGORIES = [
  { key: "rating", label: "Rating" },
  { key: "spy_rate", label: "Best Spy%" },
  { key: "trade_efficiency", label: "Trade King" },
  { key: "reveal_efficiency", label: "Fog Breaker" },
  { key: "bomb_craft", label: "Bomb Craft" },
];

function renderLeaderboardTabs() {
  const panel = document.querySelector(".leaderboard-panel");
  if (!panel) return;
  const tabs = document.createElement("div");
  tabs.className = "leaderboard-tabs";
  tabs.innerHTML = LEADERBOARD_CATEGORIES.map(({ key, label }) =>
    `<button class="lb-tab ${key === 'rating' ? 'active' : ''}" data-cat="${key}">${label}</button>`
  ).join("");
  panel.insertBefore(tabs, panel.querySelector("table"));

  tabs.addEventListener("click", (e) => {
    const btn = e.target.closest(".lb-tab");
    if (!btn) return;
    tabs.querySelectorAll(".lb-tab").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    loadLeaderboard(btn.dataset.cat);
  });
}

async function loadLeaderboard(category = "rating") {
  const body = document.getElementById("leaderboard-body");
  const empty = document.getElementById("leaderboard-empty");

  if (category === "rating") {
    const { data } = await supabase.rpc("get_leaderboard", { p_limit: 10, p_offset: 0 });
    if (!data || data.length === 0) { empty.hidden = false; body.innerHTML = ""; return; }
    empty.hidden = true;
    body.innerHTML = data.map((p, i) => `<tr><td>${i+1}</td><td><a href="profile.html?user=${encodeURIComponent(p.username)}">${p.username}</a></td><td>${p.rating}</td><td>${p.wins}/${p.losses}</td><td>${(p.win_rate * 100).toFixed(0)}%</td></tr>`).join("");
  } else {
    const { data } = await supabase.rpc("get_micro_leaderboard", { p_category: category, p_limit: 10 });
    if (!data || data.length === 0) { empty.hidden = false; body.innerHTML = ""; return; }
    empty.hidden = true;
    body.innerHTML = data.map((p, i) => `<tr><td>${i+1}</td><td><a href="profile.html?user=${encodeURIComponent(p.username)}">${p.username}</a></td><td colspan="3">${p.value}${category.includes('rate') || category.includes('efficiency') || category === 'bomb_craft' || category === 'spy_rate' ? '%' : ''}</td></tr>`).join("");
  }
}

renderLeaderboardTabs();
loadLeaderboard();
```

- [ ] **Step 3: Add tab CSS**

```css
.leaderboard-tabs { display: flex; gap: 0.3rem; margin-bottom: 0.75rem; flex-wrap: wrap; }
.lb-tab { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: var(--ink); padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.7rem; cursor: pointer; }
.lb-tab.active { background: rgba(100,200,150,0.2); border-color: rgba(100,200,150,0.5); }
.lb-tab:hover { background: rgba(255,255,255,0.1); }
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0012_advanced_stats.sql web/index.html web/js/home.js web/css/styles.css
git commit -m "feat: seasonal micro-leaderboards — spy%, trade, reveal, bomb craft tabs"
```

---

### Task 14: Deploy, Reset & Backfill (Final)

**Files:**
- All files from Tasks 1–13

- [ ] **Step 1: Push all commits to GitHub**

```bash
git push
```

- [ ] **Step 2: Deploy migration**

```bash
npx supabase db push --linked
```

- [ ] **Step 3: Deploy compute-stats**

```bash
npx supabase functions deploy compute-stats --project-ref cafqbrzaxcwewwtyqpnf
```

- [ ] **Step 4: Full stats reset and recompute**

```sql
-- Full reset for clean recomputation with all new metrics
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
  reveal_attacks = 0, reveal_wins = 0, scout_distance = 0,
  avenge_kills = 0, avenge_opportunities = 0,
  spy_timing_sum = 0, spy_timing_games = 0,
  max_comeback_deficit = 0, reveal_then_kill = 0, reveal_total = 0,
  trade_efficiency_sum = 0, trade_efficiency_count = 0,
  career_kingmakers = 0, career_rival_wins = '{}',
  achievement_progress = '{}', attack_heatmap = '{}',
  kills_by_rank = '{}', deaths_by_rank = '{}',
  archetype = NULL, updated_at = now();

UPDATE players SET rating = 1500, rating_provisional = true, games_played = 0;
UPDATE games SET stats_computed = false;
DELETE FROM achievements;
DELETE FROM game_summaries;
```

Then recompute all finished rated games.

- [ ] **Step 5: Verify everything**

Navigate to profile page. Expected:
- Radar chart with 6 axes
- "Fog & Intelligence" + "Combat Economy" stat sections with values
- Combat heatmap showing board with attack colors
- "Signature Weapons" kill/death bar charts
- Form sparkline in game history
- Archetype badge in header (after 5+ games)
- Achievement progress hints on locked badges
- Micro-leaderboard tabs on home page

---

## Deviation Log

(Record any plan deviations here during implementation)
