// web/js/setup.js
import { callFunction } from "./supabaseClient.js";
import { ARMY_COMPOSITION } from "./rules/pieces.js";

const params = new URLSearchParams(location.search);
const roomCode = params.get("code");
const token = localStorage.getItem(`stratego:${roomCode}:token`);

if (!token) {
  document.body.innerHTML = "<p>No access token found for this room. Use the link your friend sent you, or create a new game from the home page.</p>";
  throw new Error("missing token");
}

// This browser's player slot was stored by home.js when the room was created
// (slot 1) or joined (slot 2). The setup grid always draws "row 0" as the
// row nearest the midline for whoever is looking at their own screen, but
// submit-setup expects literal absolute board rows (6-9 for slot 1, 0-3 for
// slot 2), and slot 1's territory is drawn top-to-bottom OPPOSITE to slot
// 2's -- so we need this mapping before sending placements to the server.
const slot = Number(localStorage.getItem(`stratego:${roomCode}:slot`));
const ABSOLUTE_ROWS = slot === 1 ? [9, 8, 7, 6] : [0, 1, 2, 3]; // index 0 = nearest midline, for both slots

const LOCAL_ROWS = [0, 1, 2, 3];
const COLS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

let placements = new Map(); // key "row,col" -> rank

function totalPieces() {
  return ARMY_COMPOSITION.reduce((sum, e) => sum + e.count, 0);
}

function remainingByRank() {
  const counts = new Map(ARMY_COMPOSITION.map((e) => [String(e.rank), e.count]));
  for (const rank of placements.values()) {
    counts.set(String(rank), counts.get(String(rank)) - 1);
  }
  return counts;
}

function renderTray() {
  const tray = document.getElementById("tray");
  tray.innerHTML = "";
  const remaining = remainingByRank();
  for (const [rank, count] of remaining) {
    if (count <= 0) continue;
    const chip = document.createElement("button");
    chip.className = "tray-chip";
    chip.textContent = `${rank} (${count})`;
    chip.dataset.rank = rank;
    chip.addEventListener("click", () => {
      selectedRank = rank;
      highlightSelectedChip(chip);
    });
    tray.appendChild(chip);
  }

  if (selectedRank && (remaining.get(selectedRank) ?? 0) > 0) {
    const selectedChip = tray.querySelector(`[data-rank="${selectedRank}"]`);
    if (selectedChip) selectedChip.classList.add("selected");
  } else {
    selectedRank = null;
  }
}

function highlightSelectedChip(chip) {
  document.querySelectorAll(".tray-chip").forEach((el) => el.classList.remove("selected"));
  chip.classList.add("selected");
}

let selectedRank = null;

function renderGrid() {
  const grid = document.getElementById("territory-grid");
  grid.innerHTML = "";
  grid.style.gridTemplateColumns = `repeat(${COLS.length}, 1fr)`;
  for (const row of LOCAL_ROWS) {
    for (const col of COLS) {
      const cell = document.createElement("div");
      cell.className = "territory-cell";
      const key = `${row},${col}`;
      const rank = placements.get(key);
      if (rank) {
        cell.textContent = rank;
        cell.classList.add("occupied");
      }
      cell.addEventListener("click", () => {
        if (placements.has(key)) {
          placements.delete(key);
        } else if (selectedRank) {
          const remaining = remainingByRank();
          if ((remaining.get(selectedRank) ?? 0) > 0) {
            placements.set(key, selectedRank);
          }
        }
        renderGrid();
        renderTray();
        updateSubmitButton();
      });
      grid.appendChild(cell);
    }
  }
}

function updateSubmitButton() {
  document.getElementById("submit-setup-btn").disabled = placements.size !== totalPieces();
}

function applyFormation(name) {
  placements = new Map();
  const squares = [];
  for (const row of LOCAL_ROWS) {
    for (const col of COLS) squares.push([row, col]);
  }

  // "random": shuffle all 40 ranks across all 40 squares.
  // "defensive"/"aggressive": simple documented starting heuristics --
  //   defensive keeps Bombs and the Flag on the back row (row 3, farthest
  //   from the midline) with Miners just in front; aggressive pushes Scouts
  //   and higher-value attackers toward the front row (row 0, nearest the
  //   midline) with the Flag tucked on the back row flanked by two Bombs.
  const ranks = ARMY_COMPOSITION.flatMap((e) => Array(e.count).fill(String(e.rank)));

  if (name === "random") {
    for (let i = ranks.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ranks[i], ranks[j]] = [ranks[j], ranks[i]];
    }
    squares.forEach(([row, col], i) => placements.set(`${row},${col}`, ranks[i]));
  } else {
    const backRow = LOCAL_ROWS[LOCAL_ROWS.length - 1];
    const frontRows = LOCAL_ROWS.slice(0, -1);
    const bombsAndFlag = ranks.filter((r) => r === "BOMB" || r === "FLAG");
    const rest = ranks.filter((r) => r !== "BOMB" && r !== "FLAG");
    rest.sort((a, b) => (name === "defensive" ? Number(b) - Number(a) : Number(a) - Number(b)));

    const backSquares = COLS.map((col) => [backRow, col]);
    bombsAndFlag.forEach((rank, i) => placements.set(`${backSquares[i][0]},${backSquares[i][1]}`, rank));

    const frontSquares = [];
    for (const row of frontRows) for (const col of COLS) frontSquares.push([row, col]);
    rest.forEach((rank, i) => placements.set(`${frontSquares[i][0]},${frontSquares[i][1]}`, rank));
  }

  renderGrid();
  renderTray();
  updateSubmitButton();
}

document.querySelectorAll("[data-formation]").forEach((btn) => {
  btn.addEventListener("click", () => applyFormation(btn.dataset.formation));
});

document.getElementById("clear-btn").addEventListener("click", () => {
  placements = new Map();
  renderGrid();
  renderTray();
  updateSubmitButton();
});

document.getElementById("submit-setup-btn").addEventListener("click", async () => {
  const statusEl = document.getElementById("setup-status");
  const payload = Array.from(placements.entries()).map(([key, rank]) => {
    const [localRow, col] = key.split(",").map(Number);
    return { rank, row: ABSOLUTE_ROWS[localRow], col };
  });

  try {
    const result = await callFunction("submit-setup", { token, placements: payload });
    statusEl.hidden = false;
    statusEl.textContent = result.gameStarted
      ? "Both players ready! Loading game..."
      : "Setup submitted. Waiting for your opponent...";
    if (result.gameStarted) {
      location.href = `game.html?code=${roomCode}`;
    }
  } catch (err) {
    statusEl.hidden = false;
    statusEl.textContent = `Setup failed: ${err.message}`;
  }
});

renderGrid();
renderTray();
