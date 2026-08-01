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

  document.title = `Stratego — ${data.username}`;
  renderHeader(data);
  renderStats(data.stats);
  renderAchievements(data.achievements);
  loadHistory(username);
}

function renderHeader(data) {
  const el = document.getElementById("profile-header");
  const totalGames = data.stats ? (data.stats.wins + data.stats.losses + data.stats.draws) : 0;
  const winRate = totalGames > 0 ? ((data.stats.wins / totalGames) * 100).toFixed(1) : "0.0";
  el.innerHTML = `
    <h2>${data.username}</h2>
    <div class="profile-meta">
      <span class="rating-badge ${data.rating_provisional ? "provisional" : ""}">${data.rating} ${data.rating_provisional ? "(Provisional)" : ""}</span>
      ${data.stats?.archetype ? `<span class="archetype-badge">${data.stats.archetype}</span>` : ""}
      <span>${data.games_played} games</span>
      <span>${winRate}% win rate</span>
      <span>Member since ${new Date(data.created_at).toLocaleDateString()}</span>
    </div>
  `;
}

function renderStats(stats) {
  if (!stats) return;
  const el = document.getElementById("profile-stats");
  const totalGames = stats.wins + stats.losses + stats.draws;

  const sections = [
    { title: "Core", items: [
      ["Wins", stats.wins], ["Losses", stats.losses], ["Draws", stats.draws],
      ["Current Streak", stats.current_streak], ["Longest Streak", stats.longest_streak],
      ["Avg Game Length", totalGames > 0 ? Math.round(stats.total_moves_all_games / totalGames) : "—"],
    ]},
    { title: "Combat Intelligence", items: [
      ["Spy Success Rate", stats.spy_combats > 0 ? `${((stats.spy_kills / stats.spy_combats) * 100).toFixed(0)}%` : "—"],
      ["Bomb Efficiency", stats.total_bombs > 0 ? `${((stats.bombs_detonated / stats.total_bombs) * 100).toFixed(0)}%` : "—"],
      ["Miner Survival", stats.miners_started > 0 ? `${((stats.miners_survived / stats.miners_started) * 100).toFixed(0)}%` : "—"],
      ["First Blood %", totalGames > 0 ? `${((stats.first_bloods / totalGames) * 100).toFixed(0)}%` : "—"],
    ]},
    { title: "Strategic Profile", items: [
      ["Initiative Ratio", stats.combats_total > 0 ? `${((stats.combats_initiated / stats.combats_total) * 100).toFixed(0)}%` : "—"],
      ["Aggression Index", stats.total_moves > 0 ? `${((stats.forward_moves / stats.total_moves) * 100).toFixed(0)}%` : "—"],
      ["Deep Strike Rate", stats.total_moves > 0 ? `${((stats.moves_in_enemy_half / stats.total_moves) * 100).toFixed(0)}%` : "—"],
    ]},
    { title: "Endgame & Clutch", items: [
      ["Marathon Win Rate", stats.marathon_games > 0 ? `${((stats.marathon_wins / stats.marathon_games) * 100).toFixed(0)}%` : "—"],
      ["Win by Flag %", stats.wins > 0 ? `${((stats.wins_by_flag / stats.wins) * 100).toFixed(0)}%` : "—"],
    ]},
    { title: "Records", items: [
      ["Fastest Win", stats.fastest_win ? `${stats.fastest_win} moves` : "—"],
      ["Longest Game", stats.longest_game ? `${stats.longest_game} moves` : "—"],
      ["Most Captures (1 game)", stats.most_captures ?? "—"],
      ["Marshal Showdowns", `${stats.marshal_showdown_wins}/${stats.marshal_showdowns}`],
    ]},
  ];

  el.innerHTML = sections.map((s) => `
    <details class="stats-section" open>
      <summary>${s.title}</summary>
      <div class="stats-grid">
        ${s.items.map(([label, value]) => `<div class="stat-item"><span class="stat-label">${label}</span><span class="stat-value">${value}</span></div>`).join("")}
      </div>
    </details>
  `).join("");
}

const ACHIEVEMENT_LABELS = {
  kingmaker: { name: "Kingmaker", desc: "Spy kills the enemy Marshal" },
  bomb_squad: { name: "Bomb Squad", desc: "Defuse 3+ bombs in one game" },
  needle_threader: { name: "Needle Threader", desc: "Win by capturing flag with a Miner" },
  glass_cannon: { name: "Glass Cannon", desc: "Win with ≤8 pieces remaining" },
  clean_operation: { name: "Clean Operation", desc: "Win while losing ≤10 pieces" },
  blitz_general: { name: "Blitz General", desc: "Win in under 30 moves" },
  no_fly_zone: { name: "No Fly Zone", desc: "Eliminate all 8 enemy Scouts" },
  minefield_architect: { name: "Minefield Architect", desc: "Your bombs kill 4+ enemies" },
  iron_wall: { name: "Iron Wall", desc: "Win without losing rank ≥8 pieces" },
  fog_walker: { name: "Fog Walker", desc: "10+ attacks on unrevealed pieces and win" },
  counterpunch: { name: "Counterpunch", desc: "Win after big deficit" },
  rival_hunter: { name: "Rival Hunter", desc: "Beat same opponent 5 times" },
};

function renderAchievements(achievements) {
  const el = document.getElementById("profile-achievements");
  const unlocked = new Set((achievements || []).map((a) => a.key));
  el.innerHTML = `
    <h3>Achievements</h3>
    <div class="achievements-grid">
      ${Object.entries(ACHIEVEMENT_LABELS).map(([key, { name, desc }]) => `
        <div class="achievement-item ${unlocked.has(key) ? "unlocked" : "locked"}" title="${desc}">
          <span class="achievement-name">${name}</span>
        </div>
      `).join("")}
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

  el.innerHTML = `
    <h3>Game History</h3>
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
