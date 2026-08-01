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
            <span class="stat-label">${label} <span class="stat-help" title="${desc}">?</span></span>
            <span class="stat-value">${value}</span>
          </div>
        `).join("")}
      </div>
    </details>
  `).join("");
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
