import { supabase } from "./supabaseClient.js";
import { renderNavAuth } from "./auth.js";

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
  renderAchievements(achievements);
  loadHistory(username);
}

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
    dots += `<circle cx="${dx}" cy="${dy}" r="2.5" fill="rgba(100,200,150,0.9)"/>`;
  });

  const svg = `<svg viewBox="0 0 200 200" class="radar-chart">${rings}${axisLines}${dataPolygon}${dots}</svg>`;
  const container = document.createElement("div");
  container.className = "radar-container";
  container.innerHTML = `<h3>Your Stratego DNA</h3>${svg}`;
  el.insertBefore(container, el.firstChild);
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
            <span class="stat-help" data-tooltip="${desc}">?</span>
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
