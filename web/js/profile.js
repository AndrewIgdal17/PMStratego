import { supabase } from "./supabaseClient.js";
import { renderNavAuth, getUsername, isLoggedIn } from "./auth.js";
import { materialSparkline } from "./gameSummary.js";

renderNavAuth(document.getElementById("nav-auth"));

const params = new URLSearchParams(location.search);
const username = params.get("user");

if (!username) {
  document.getElementById("profile-error").textContent = "No username specified";
  document.getElementById("profile-error").hidden = false;
} else {
  loadProfile(username);
}

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
  renderRadar(stats);
  renderHeatmap(stats);
  renderPieceFate(stats);
  renderAchievements(achievements, stats);
  loadHistory(username);
  await renderHeadToHead(player.id, player.username);
}

async function renderHeadToHead(profilePlayerId, username) {
  if (!isLoggedIn()) return;
  const myUsername = getUsername();
  if (!myUsername || myUsername.toLowerCase() === username.toLowerCase()) return;

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

function formatInfoArchetype(key) {
  const map = {
    bluffer: "Hyperactive Bluffer",
    trapper: "Patient Trapper",
    converter: "Snap Converter",
    denier: "Fog Denier",
    investor: "Recon Investor",
  };
  return map[key] ?? key;
}

function renderHeader(player, stats) {
  const el = document.getElementById("profile-header");
  const totalGames = stats ? (stats.wins + stats.losses + stats.draws) : 0;
  const winRate = totalGames > 0 ? ((stats.wins / totalGames) * 100).toFixed(1) : "0.0";
  el.innerHTML = `
    <h2>${player.username}</h2>
    <div class="profile-meta">
      <span class="rating-badge ${player.rating_provisional ? "provisional" : ""}">${player.rating} ${player.rating_provisional ? "(Provisional)" : ""}</span>
      ${stats?.archetype ? `<span class="archetype-badge" data-tooltip="Playstyle archetype — recalculated every 5 games based on your stat pattern">${stats.archetype.replace("_", " ")}</span>` : ""}
      ${stats?.info_archetype ? `<span class="archetype-badge info-archetype-badge" data-tooltip="Information Warfare archetype — how you hide, reveal, and convert knowledge">${formatInfoArchetype(stats.info_archetype)}</span>` : ""}
      <span>${player.games_played} games</span>
      <span>${winRate}% win rate</span>
      <span>Member since ${new Date(player.created_at).toLocaleDateString()}</span>
    </div>
  `;
}

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
    { title: "Information Warfare", items: [
      ["Stillness Ratio",
        stats.stillness_movable_total > 0
          ? `${((stats.stillness_never_moved / stats.stillness_movable_total) * 100).toFixed(0)}%`
          : "—",
        "What % of your movable pieces never move in a game — high suggests fake-bomb trapping"],
      ["Info Exchange Rate",
        stats.info_exchange_games > 0
          ? `${(stats.info_exchange_ratio_sum / stats.info_exchange_games).toFixed(2)}x`
          : "—",
        "For every piece of yours revealed, how many enemy pieces did you learn? >1 = you're winning the info war"],
      ["Deduction Latency",
        stats.deduction_latency_count > 0
          ? `${Math.round(stats.deduction_latency_sum / stats.deduction_latency_count)} moves`
          : "—",
        "How quickly you send the correct counter after learning an enemy piece's rank"],
      ["Bluff Bait Rate",
        stats.bluff_bait_events > 0
          ? `${((stats.bluff_bait_bitten / stats.bluff_bait_events) * 100).toFixed(0)}%`
          : "—",
        "When you push weak pieces deep as bluffs, how often does the enemy bite and attack them?"],
      ["Reveal Half-Life",
        stats.reveal_half_life_games > 0
          ? `${((stats.reveal_half_life_sum / stats.reveal_half_life_games) * 100).toFixed(0)}% of game`
          : "—",
        "How far into the game before half your army is identified by the enemy — higher = you stay foggy longer"],
      ["Ambush Yield",
        stats.ambush_defenses > 0
          ? `${((stats.ambush_wins / stats.ambush_defenses) * 100).toFixed(0)}%`
          : "—",
        "When enemies attack your still/never-moved pieces, how often does the still piece win?"],
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
    { title: "Board Geography", items: [
      ["Flank Preference", (stats.flank_left_moves + stats.flank_right_moves) > 0
        ? `${((stats.flank_left_moves / (stats.flank_left_moves + stats.flank_right_moves)) * 100).toFixed(0)}% Left`
        : "—",
        "Do you favor the left side (cols 0–4) or right side (cols 5–9) of the board?"],
      ["Lake Corridor", stats.total_moves > 0
        ? `${((stats.lake_corridor_moves / stats.total_moves) * 100).toFixed(0)}%`
        : "—",
        "What % of your moves pass through the center corridor (cols 4–5) between the lakes?"],
      ["Defense Depth", stats.defense_depth_count > 0
        ? `${(Number(stats.defense_depth_sum) / stats.defense_depth_count).toFixed(1)} rows`
        : "—",
        "Average distance from your back row when you initiate combat — low = defensive, high = deep strikes"],
    ]},
    { title: "Tempo & Rhythm", items: [
      ["Combat Cadence", stats.combat_cadence_count > 0
        ? `${Math.round(stats.combat_cadence_sum / stats.combat_cadence_count)} moves apart`
        : "—",
        "Average moves between your consecutive attacks — low = rapid pressure, high = patient/positional"],
      ["Opening Speed", stats.opening_speed_games > 0
        ? `Move ${Math.round(stats.opening_speed_sum / stats.opening_speed_games)}`
        : "—",
        "Average move number of your first attack — early = aggressive opener, late = developer"],
      ["Endgame Acceleration", (stats.endgame_accel_early + stats.endgame_accel_late) > 0
        ? `${((stats.endgame_accel_late / (stats.endgame_accel_early + stats.endgame_accel_late)) * 100).toFixed(0)}% in final quarter`
        : "—",
        "What % of your attacks happen in the last 25% of the game? High = you close fast"],
    ]},
  ];

  el.innerHTML = sections.map((s) => `
    <details class="stats-section" open>
      <summary>${s.title}</summary>
      <div class="stats-grid">
        ${s.items.map(([label, value, desc]) => `
          <div class="stat-item">
            <span class="stat-label">${label} <span class="stat-help" data-tooltip="${desc}">?</span></span>
            <span class="stat-value">${value}</span>
          </div>
        `).join("")}
      </div>
    </details>
  `).join("");
}

function renderRadar(stats) {
  const el = document.getElementById("profile-stats");
  if (!stats || (stats.wins + stats.losses + stats.draws) < 1) return;

  const axes = [
    { label: "Aggression", value: stats.total_moves > 0 ? stats.forward_moves / stats.total_moves : 0, desc: "% of moves advancing toward enemy", raw: stats.total_moves > 0 ? `${((stats.forward_moves / stats.total_moves) * 100).toFixed(0)}%` : "—" },
    { label: "Initiative", value: stats.combats_total > 0 ? stats.combats_initiated / stats.combats_total : 0, desc: "% of combats you started", raw: stats.combats_total > 0 ? `${((stats.combats_initiated / stats.combats_total) * 100).toFixed(0)}%` : "—" },
    { label: "Fog Breaking", value: stats.reveal_attacks > 0 ? stats.reveal_wins / stats.reveal_attacks : 0, desc: "Win rate on blind attacks", raw: stats.reveal_attacks > 0 ? `${((stats.reveal_wins / stats.reveal_attacks) * 100).toFixed(0)}%` : "—" },
    { label: "Bomb Craft", value: stats.total_bombs > 0 ? stats.bombs_detonated / stats.total_bombs : 0, desc: "% of your Bombs that killed", raw: stats.total_bombs > 0 ? `${((stats.bombs_detonated / stats.total_bombs) * 100).toFixed(0)}%` : "—" },
    { label: "Endgame", value: stats.marathon_games > 0 ? stats.marathon_wins / stats.marathon_games : 0.5, desc: "Win rate in 60+ move games", raw: stats.marathon_games > 0 ? `${((stats.marathon_wins / stats.marathon_games) * 100).toFixed(0)}%` : "—" },
    { label: "Material", value: stats.trade_efficiency_count > 0 ? Math.min(1, Math.max(0, (stats.trade_efficiency_sum / stats.trade_efficiency_count + 5) / 10)) : 0.5, desc: "Net value per combat", raw: stats.trade_efficiency_count > 0 ? `${(stats.trade_efficiency_sum / stats.trade_efficiency_count).toFixed(1)}` : "—" },
  ];

  const cx = 100, cy = 100, r = 70;
  const n = axes.length;
  const angleStep = (2 * Math.PI) / n;

  function point(i, scale) {
    const angle = -Math.PI / 2 + i * angleStep;
    return [cx + r * scale * Math.cos(angle), cy + r * scale * Math.sin(angle)];
  }

  let rings = "";
  for (const ringScale of [0.25, 0.5, 0.75, 1.0]) {
    const pts = Array.from({ length: n }, (_, i) => point(i, ringScale).join(",")).join(" ");
    rings += `<polygon points="${pts}" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="0.5"/>`;
  }

  let axisLines = "";
  for (let i = 0; i < n; i++) {
    const [px, py] = point(i, 1);
    axisLines += `<line x1="${cx}" y1="${cy}" x2="${px}" y2="${py}" stroke="rgba(255,255,255,0.15)" stroke-width="0.5"/>`;
    const [lx, ly] = point(i, 1.2);
    axisLines += `<text x="${lx}" y="${ly}" text-anchor="middle" dominant-baseline="middle" fill="rgba(255,255,255,0.7)" font-size="7">${axes[i].label}</text>`;
  }

  const dataPts = axes.map((a, i) => point(i, Math.max(0.05, a.value)).join(",")).join(" ");
  const dataPolygon = `<polygon points="${dataPts}" fill="rgba(100,200,150,0.25)" stroke="rgba(100,200,150,0.8)" stroke-width="1.5"/>`;

  let dots = "";
  axes.forEach((a, i) => {
    const [dx, dy] = point(i, Math.max(0.05, a.value));
    dots += `<circle cx="${dx}" cy="${dy}" r="4" fill="rgba(100,200,150,0.9)" class="radar-dot"><title>${a.label}: ${a.raw}\n${a.desc}</title></circle>`;
  });

  const svg = `<svg viewBox="0 0 200 200" class="radar-chart">${rings}${axisLines}${dataPolygon}${dots}</svg>`;
  const container = document.createElement("div");
  container.className = "radar-container";
  container.innerHTML = `<h3>Your Stratego DNA</h3>${svg}`;
  el.insertBefore(container, el.firstChild);
}

function renderHeatmap(stats) {
  if (!stats || !stats.attack_heatmap || Object.keys(stats.attack_heatmap).length === 0) return;
  const el = document.getElementById("profile-stats");

  const cellSize = 22;
  const padding = 2;
  const boardSize = cellSize * 10 + padding * 9;
  const lakeSquares = new Set(["4,2", "4,3", "5,2", "5,3", "4,6", "4,7", "5,6", "5,7"]);

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
          cells += `<text x="${x + cellSize / 2}" y="${y + cellSize / 2 + 1}" text-anchor="middle" dominant-baseline="middle" fill="rgba(255,255,255,0.7)" font-size="7">${data.attacks}</text>`;
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

const RANK_DISPLAY = {
  "1": "Marshal",
  "2": "General",
  "3": "Colonel",
  "4": "Major",
  "5": "Captain",
  "6": "Lieutenant",
  "7": "Sergeant",
  "8": "Miner",
  "9": "Scout",
  "10": "Spy",
  BOMB: "Bomb",
};

function renderPieceFate(stats) {
  if (!stats?.kills_by_rank || Object.keys(stats.kills_by_rank).length === 0) return;
  const el = document.getElementById("profile-stats");

  function barChart(data, title, color) {
    const entries = Object.entries(data)
      .filter(([k]) => RANK_DISPLAY[k])
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5);
    if (entries.length === 0) return "";
    const max = Math.max(...entries.map(([, v]) => v));
    return `<div class="fate-chart"><h4>${title}</h4>${entries
      .map(
        ([rank, count]) =>
          `<div class="fate-bar-row"><span class="fate-label">${RANK_DISPLAY[rank]}</span><div class="fate-bar" style="width:${(count / max) * 100}%;background:${color}"></div><span class="fate-count">${count}</span></div>`
      )
      .join("")}</div>`;
  }

  const container = document.createElement("div");
  container.className = "piece-fate-section";
  container.innerHTML = `
    <details class="stats-section" open>
      <summary>Signature Weapons</summary>
      <div class="fate-grid">
        ${barChart(stats.kills_by_rank, "You Kill With", "rgba(100,200,100,0.6)")}
        ${barChart(stats.deaths_by_rank, "You Die To", "rgba(200,100,100,0.6)")}
      </div>
    </details>
  `;
  el.appendChild(container);
}

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
  ghost_protocol: { name: "Ghost Protocol", desc: "Win without your Marshal or General ever entering combat" },
  phoenix: { name: "Phoenix", desc: "Win after losing your Marshal during the game" },
  vendetta: { name: "Vendetta", desc: "Avenge 3+ of your pieces by killing the exact enemy piece that killed them" },
  counterintel: { name: "Counterintel", desc: "Eliminate the enemy Spy before your Marshal is revealed in combat" },
  fortress_breaker: { name: "Fortress Breaker", desc: "Defuse 3+ enemy Bombs AND capture the Flag in the same game" },
  silent_general: { name: "Silent General", desc: "Win without initiating any attack in the first 15 moves" },
  nemesis: { name: "Nemesis", desc: "Beat an opponent rated 200+ points higher than you" },
  serial_killer: { name: "Serial Killer", desc: "Use your Spy to kill the enemy Marshal in 3+ career games" },
  perfect_deminer: { name: "Perfect Deminer", desc: "Defuse all 6 enemy Bombs without losing a single Miner to a Bomb" },
};

function renderAchievements(achievements, stats) {
  const el = document.getElementById("profile-achievements");
  const unlocked = new Set((achievements || []).map((a) => a.achievement_key));

  const progressHints = {
    rival_hunter: () => {
      const rivals = stats?.career_rival_wins ?? {};
      const best = Object.entries(rivals).sort(([, a], [, b]) => Number(b) - Number(a))[0];
      return best ? `${best[1]}/5 vs top rival` : null;
    },
    serial_killer: () =>
      stats?.career_kingmakers > 0 ? `${stats.career_kingmakers}/3 spy kills` : null,
    counterpunch: () =>
      stats?.max_comeback_deficit > 0 ? `Best: ${stats.max_comeback_deficit}/15 pts` : null,
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

async function loadHistory(username) {
  const { data, error } = await supabase.rpc("get_game_history", { p_username: username, p_limit: 20, p_offset: 0 });
  const el = document.getElementById("profile-history");
  if (error || !data || data.length === 0) {
    el.innerHTML = "<h3>Game History</h3><p>No games yet.</p>";
    return;
  }

  const reversed = [...data].reverse();
  const pills = reversed.map((g) => {
    const result = g.winner_slot === g.player_slot ? "W" : (g.winner_slot ? "L" : "D");
    const cls = result === "W" ? "pill-win" : (result === "L" ? "pill-loss" : "pill-draw");
    const tooltip = `vs ${g.opponent_username || "Anon"} (${g.turn_number || "?"} moves)`;
    return `<span class="form-pill ${cls}" data-tooltip="${tooltip}">${result}</span>`;
  }).join("");
  const sparkline = `<div class="form-sparkline"><span class="form-label">Last ${data.length}:</span>${pills}</div>`;

  el.innerHTML = `
    <h3>Game History</h3>
    ${sparkline}
    <table class="history-table">
      <thead><tr><th>Opponent</th><th>Result</th><th>Moves</th><th>Curve</th><th>Date</th></tr></thead>
      <tbody>
        ${data.map((g) => {
          const result = g.winner_slot === g.player_slot ? "Win" : (g.winner_slot ? "Loss" : "Draw");
          const cls = result === "Win" ? "win" : (result === "Loss" ? "loss" : "draw");
          return `<tr class="clickable-row" onclick="location.href='game-detail.html?id=${g.game_id}&slot=${g.player_slot}'">
            <td><a href="profile.html?user=${encodeURIComponent(g.opponent_username || "Anonymous")}" onclick="event.stopPropagation()">${g.opponent_username || "Anonymous"}</a></td>
            <td class="${cls}">${result}</td>
            <td>${g.turn_number || "—"}</td>
            <td class="curve-cell" data-game-id="${g.game_id}" data-player-slot="${g.player_slot}">—</td>
            <td><a href="game-detail.html?id=${g.game_id}&slot=${g.player_slot}" onclick="event.stopPropagation()">${new Date(g.created_at).toLocaleDateString()}</a></td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>
  `;

  await loadMaterialCurves(el);
}

async function loadMaterialCurves(container) {
  const cells = container.querySelectorAll(".curve-cell");
  await Promise.all(
    [...cells].map(async (cell) => {
      const gameId = cell.dataset.gameId;
      const playerSlot = Number(cell.dataset.playerSlot);
      const { data: summary } = await supabase.rpc("get_game_summary", { p_game_id: gameId });
      const curve = summary?.material_curve_p1;
      if (curve && curve.length > 0) {
        cell.innerHTML = materialSparkline(curve, playerSlot);
      }
    })
  );
}
