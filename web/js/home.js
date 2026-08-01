import { supabase, callFunction } from "./supabaseClient.js";
import { renderNavAuth } from "./auth.js";
import { pickBotFormationPlacements } from "./bot.js";

renderNavAuth(document.getElementById("nav-auth"));

function storeSession(roomCode, token, slot) {
  localStorage.setItem(`stratego:${roomCode}:token`, token);
  localStorage.setItem(`stratego:${roomCode}:slot`, String(slot));
}

document.getElementById("new-game-btn").addEventListener("click", async () => {
  const button = document.getElementById("new-game-btn");
  const resultEl = document.getElementById("new-game-result");
  button.disabled = true;
  try {
    const { roomCode, token, invitePath } = await callFunction("create-game", {});
    storeSession(roomCode, token, 1);
    const inviteUrl = `${location.origin}${invitePath}`;
    resultEl.hidden = false;
    resultEl.innerHTML = `
      <p class="success-text">Room created!</p>
      <p class="room-code-label">Room code:</p>
      <div class="room-code-box">${roomCode}</div>
      <div class="copy-buttons">
        <button id="copy-link-btn" class="copy-btn">Copy Link</button>
        <button id="copy-code-btn" class="copy-btn">Copy Code</button>
      </div>
      <button id="continue-to-setup-btn" class="btn-primary" style="width:100%;margin-top:0.75rem;">Continue to setup</button>
    `;
    document.getElementById("copy-link-btn").addEventListener("click", async () => {
      await navigator.clipboard.writeText(inviteUrl);
      const btn = document.getElementById("copy-link-btn");
      btn.textContent = "Copied!";
      setTimeout(() => { btn.textContent = "Copy Link"; }, 1500);
    });
    document.getElementById("copy-code-btn").addEventListener("click", async () => {
      await navigator.clipboard.writeText(roomCode);
      const btn = document.getElementById("copy-code-btn");
      btn.textContent = "Copied!";
      setTimeout(() => { btn.textContent = "Copy Code"; }, 1500);
    });
    document.getElementById("continue-to-setup-btn").addEventListener("click", () => {
      location.href = `setup.html?code=${roomCode}`;
    });
  } catch (err) {
    resultEl.hidden = false;
    resultEl.textContent = `Failed to create game: ${err.message}`;
  } finally {
    button.disabled = false;
  }
});

document.getElementById("join-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const errorEl = document.getElementById("join-error");
  const roomCode = document.getElementById("room-code-input").value.trim().toUpperCase();
  errorEl.hidden = true;
  try {
    const { token } = await callFunction("join-game", { roomCode });
    storeSession(roomCode, token, 2);
    location.href = `setup.html?code=${roomCode}`;
  } catch (err) {
    errorEl.hidden = false;
    errorEl.textContent = `Could not join: ${err.message}`;
  }
});

document.getElementById("play-bot-btn").addEventListener("click", async () => {
  const button = document.getElementById("play-bot-btn");
  const resultEl = document.getElementById("play-bot-error");
  button.disabled = true;
  try {
    const { roomCode, token } = await callFunction("create-game", { isBotGame: true });
    storeSession(roomCode, token, 1);

    const { token: botToken } = await callFunction("join-game", { roomCode });
    localStorage.setItem(`stratego:${roomCode}:botToken`, botToken);
    const placements = pickBotFormationPlacements();
    await callFunction("submit-setup", { token: botToken, placements });

    location.href = `setup.html?code=${roomCode}`;
  } catch (err) {
    resultEl.hidden = false;
    resultEl.textContent = `Failed to start bot game: ${err.message}`;
    button.disabled = false;
  }
});

document.getElementById("spectate-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const roomCode = document.getElementById("spectate-code-input").value.trim().toUpperCase();
  if (!roomCode) return;
  location.href = `game.html?code=${roomCode}&spectate=1`;
});

const LEADERBOARD_CATEGORIES = [
  { key: "rating", label: "Rating" },
  { key: "spy_rate", label: "Best Spy%" },
  { key: "trade_efficiency", label: "Trade King" },
  { key: "reveal_efficiency", label: "Fog Breaker" },
  { key: "bomb_craft", label: "Bomb Craft" },
];

const MICRO_PERCENT_CATEGORIES = new Set(["spy_rate", "reveal_efficiency", "bomb_craft"]);

function renderLeaderboardTabs() {
  const panel = document.querySelector(".leaderboard-panel");
  if (!panel) return;
  const table = panel.querySelector("table");
  if (!table) return;

  const tabs = document.createElement("div");
  tabs.className = "leaderboard-tabs";
  tabs.innerHTML = LEADERBOARD_CATEGORIES.map(({ key, label }) =>
    `<button type="button" class="lb-tab ${key === "rating" ? "active" : ""}" data-cat="${key}">${label}</button>`
  ).join("");
  panel.insertBefore(tabs, table);

  tabs.addEventListener("click", (e) => {
    const btn = e.target.closest(".lb-tab");
    if (!btn) return;
    tabs.querySelectorAll(".lb-tab").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    loadLeaderboard(btn.dataset.cat);
  });
}

function setLeaderboardHead(category) {
  const head = document.querySelector("#leaderboard-table thead tr");
  if (!head) return;

  if (category === "rating") {
    head.innerHTML = "<th>#</th><th>Player</th><th>Rating</th><th>W/L</th><th>Win%</th><th>Streak</th>";
    return;
  }

  const label = LEADERBOARD_CATEGORIES.find((c) => c.key === category)?.label ?? "Value";
  head.innerHTML = `<th>#</th><th>Player</th><th colspan="4">${label}</th>`;
}

async function loadLeaderboard(category = "rating") {
  const body = document.getElementById("leaderboard-body");
  const empty = document.getElementById("leaderboard-empty");
  if (!body) return;

  setLeaderboardHead(category);

  if (category === "rating") {
    const { data, error } = await supabase.rpc("get_leaderboard", { p_limit: 10, p_offset: 0 });
    if (error || !data || data.length === 0) {
      if (empty) empty.hidden = false;
      body.innerHTML = "";
      return;
    }
    if (empty) empty.hidden = true;
    body.innerHTML = data.map((p, i) => `
      <tr>
        <td>${i + 1}</td>
        <td><a href="profile.html?user=${encodeURIComponent(p.username)}">${p.username}</a></td>
        <td>${p.rating}</td>
        <td>${p.wins}/${p.losses}</td>
        <td>${p.win_rate}%</td>
        <td>${p.longest_streak}</td>
      </tr>
    `).join("");
    return;
  }

  const { data, error } = await supabase.rpc("get_micro_leaderboard", { p_category: category, p_limit: 10 });
  if (error || !data || data.length === 0) {
    if (empty) empty.hidden = false;
    body.innerHTML = "";
    return;
  }
  if (empty) empty.hidden = true;
  const suffix = MICRO_PERCENT_CATEGORIES.has(category) ? "%" : "";
  body.innerHTML = data.map((p, i) => `
    <tr>
      <td>${i + 1}</td>
      <td><a href="profile.html?user=${encodeURIComponent(p.username)}">${p.username}</a></td>
      <td colspan="4">${p.value}${suffix}</td>
    </tr>
  `).join("");
}

renderLeaderboardTabs();
loadLeaderboard();
