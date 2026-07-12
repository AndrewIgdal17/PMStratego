// web/js/setup.js
import { supabase, callFunction } from "./supabaseClient.js";
import { ARMY_COMPOSITION } from "./rules/pieces.js";
import { DEFENSIVE_FORMATIONS, AGGRESSIVE_FORMATIONS } from "./formations.js";

const params = new URLSearchParams(location.search);
const roomCode = params.get("code");
const isJoining = params.get("join") === "1";

const navRoomEl = document.getElementById("nav-room-code");
if (navRoomEl && roomCode) navRoomEl.textContent = `Room: ${roomCode}`;

const PLAYER_COLORS = [
  { name: 'Forest Green', hex: '#4a7a4a' },
  { name: 'Navy Blue',    hex: '#3a5a8a' },
  { name: 'Royal Purple', hex: '#6a4a8a' },
  { name: 'Teal',         hex: '#3a7a7a' },
  { name: 'Gold',         hex: '#8a7a3a' },
  { name: 'Crimson',      hex: '#8a3a4a' },
  { name: 'Slate',        hex: '#5a6a7a' },
  { name: 'Bronze',       hex: '#8a6a3a' },
];

function initColorPicker() {
  const container = document.getElementById('color-swatches');
  if (!container) return;

  const saved = localStorage.getItem(`stratego:${roomCode}:color`) || PLAYER_COLORS[0].hex;

  for (const color of PLAYER_COLORS) {
    const swatch = document.createElement('div');
    swatch.className = 'color-swatch';
    swatch.style.backgroundColor = color.hex;
    swatch.title = color.name;
    if (color.hex === saved) swatch.classList.add('selected');

    swatch.addEventListener('click', () => {
      container.querySelectorAll('.color-swatch').forEach((s) => s.classList.remove('selected'));
      swatch.classList.add('selected');
      localStorage.setItem(`stratego:${roomCode}:color`, color.hex);
    });

    container.appendChild(swatch);
  }

  if (!localStorage.getItem(`stratego:${roomCode}:color`)) {
    localStorage.setItem(`stratego:${roomCode}:color`, PLAYER_COLORS[0].hex);
  }
}

initColorPicker();

async function ensureSession() {
  let token = localStorage.getItem(`stratego:${roomCode}:token`);
  if (token) return token;

  if (isJoining) {
    try {
      const result = await callFunction("join-game", { roomCode });
      localStorage.setItem(`stratego:${roomCode}:token`, result.token);
      localStorage.setItem(`stratego:${roomCode}:slot`, "2");
      return result.token;
    } catch (err) {
      document.body.innerHTML = `<p>Could not join this game: ${err.message}</p>`;
      throw err;
    }
  }

  document.body.innerHTML = "<p>No access token found for this room. Use the link your friend sent you, or create a new game from the home page.</p>";
  throw new Error("missing token");
}

const token = await ensureSession();

// This browser's player slot was stored by home.js when the room was created
// (slot 1) or joined (slot 2). The setup grid always draws "row 0" as the
// row nearest the midline for whoever is looking at their own screen, but
// submit-setup expects literal absolute board rows (6-9 for slot 1, 0-3 for
// slot 2), and slot 1's territory is drawn top-to-bottom OPPOSITE to slot
// 2's -- so we need this mapping before sending placements to the server.
const slot = Number(localStorage.getItem(`stratego:${roomCode}:slot`));
const ABSOLUTE_ROWS = slot === 1 ? [6, 7, 8, 9] : [3, 2, 1, 0]; // index 0 = nearest midline, for both slots

const LOCAL_ROWS = [0, 1, 2, 3];
const COLS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

const RANK_NAME = {
  '1': 'Marshal', '2': 'General', '3': 'Colonel', '4': 'Major',
  '5': 'Captain', '6': 'Lieutenant', '7': 'Sergeant', '8': 'Miner',
  '9': 'Scout', '10': 'Spy', 'BOMB': 'Bomb', 'FLAG': 'Flag',
};

const RANK_SHORT = {
  '1': 'Ma', '2': 'Ge', '3': 'Co', '4': 'Mj',
  '5': 'Cp', '6': 'Lt', '7': 'Sg', '8': 'Mi',
  '9': 'Sc', '10': 'Sp', 'BOMB': 'B', 'FLAG': 'F',
};

let placements = new Map(); // key "row,col" -> rank
let formationIndex = { defensive: -1, aggressive: -1 };

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
    // Show all piece types, dim the exhausted ones
    const chip = document.createElement("button");
    chip.className = "tray-chip";
    if (count <= 0) {
      chip.classList.add("exhausted");
      chip.disabled = true;
    }
    chip.textContent = `${RANK_NAME[rank] ?? rank} x${count}`;
    chip.dataset.rank = rank;
    if (count > 0) {
      chip.addEventListener("click", () => {
        selectedRank = rank;
        highlightSelectedChip(chip);
      });
    }
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
  const colLabels = document.getElementById("setup-col-labels");
  if (colLabels && colLabels.children.length === 0) {
    for (let c = 0; c < COLS.length; c++) {
      const span = document.createElement("span");
      span.textContent = String.fromCharCode(65 + c);
      colLabels.appendChild(span);
    }
  }

  const rowLabels = document.getElementById("setup-row-labels");
  if (rowLabels && rowLabels.children.length === 0) {
    for (let r = 0; r < LOCAL_ROWS.length; r++) {
      const span = document.createElement("span");
      span.textContent = String(7 + r);
      rowLabels.appendChild(span);
    }
  }

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
        cell.textContent = RANK_SHORT[rank] ?? rank;
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
  const total = totalPieces();
  const placed = placements.size;
  const btn = document.getElementById("submit-setup-btn");
  btn.disabled = placed !== total;
  btn.textContent = placed === total ? "Submit setup" : `Submit setup (${placed}/${total})`;
}

function applyFormation(name) {
  placements = new Map();

  if (name === "random") {
    const squares = [];
    for (const row of LOCAL_ROWS) {
      for (const col of COLS) squares.push([row, col]);
    }
    const ranks = ARMY_COMPOSITION.flatMap((e) => Array(e.count).fill(String(e.rank)));
    for (let i = ranks.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ranks[i], ranks[j]] = [ranks[j], ranks[i]];
    }
    squares.forEach(([row, col], i) => placements.set(`${row},${col}`, ranks[i]));
    updateFormationLabel("");
  } else {
    const catalog = name === "defensive" ? DEFENSIVE_FORMATIONS : AGGRESSIVE_FORMATIONS;
    formationIndex[name] = (formationIndex[name] + 1) % catalog.length;
    const formation = catalog[formationIndex[name]];

    for (const [row, col, rank] of formation.cells) {
      placements.set(`${row},${col}`, rank);
    }
    updateFormationLabel(`${formation.name} (${formationIndex[name] + 1}/${catalog.length})`);
  }

  renderGrid();
  renderTray();
  updateSubmitButton();
}

function updateFormationLabel(text) {
  let label = document.getElementById("formation-label");
  if (!label) {
    label = document.createElement("p");
    label.id = "formation-label";
    label.className = "formation-label";
    const frame = document.querySelector(".setup-frame");
    frame.parentNode.insertBefore(label, frame);
  }
  label.textContent = text;
  label.hidden = !text;
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
    } else {
      const { data: gameRow } = await supabase.from("games").select("id").eq("room_code", roomCode).single();
      if (gameRow) {
        supabase
          .channel(`setup-wait-${gameRow.id}`)
          .on("postgres_changes", { event: "UPDATE", schema: "public", table: "games", filter: `id=eq.${gameRow.id}` }, (payload) => {
            if (payload.new.status === "active") {
              location.href = `game.html?code=${roomCode}`;
            }
          })
          .subscribe();
      }
    }
  } catch (err) {
    statusEl.hidden = false;
    statusEl.textContent = `Setup failed: ${err.message}`;
  }
});

renderGrid();
renderTray();
updateSubmitButton();
