import { supabase, callFunction } from "./supabaseClient.js";
import { BOARD_SIZE, isLake } from "./rules/board.js";

const RANK_SHORT = {
  '1': 'Ma', '2': 'Ge', '3': 'Co', '4': 'Mj',
  '5': 'Cp', '6': 'Lt', '7': 'Sg', '8': 'Mi',
  '9': 'Sc', '10': 'Sp', 'BOMB': 'B', 'FLAG': 'F',
  1: 'Ma', 2: 'Ge', 3: 'Co', 4: 'Mj',
  5: 'Cp', 6: 'Lt', 7: 'Sg', 8: 'Mi',
  9: 'Sc', 10: 'Sp',
};

const RANK_NAME = {
  '1': 'Marshal', '2': 'General', '3': 'Colonel', '4': 'Major',
  '5': 'Captain', '6': 'Lieutenant', '7': 'Sergeant', '8': 'Miner',
  '9': 'Scout', '10': 'Spy', 'BOMB': 'Bomb', 'FLAG': 'Flag',
  1: 'Marshal', 2: 'General', 3: 'Colonel', 4: 'Major',
  5: 'Captain', 6: 'Lieutenant', 7: 'Sergeant', 8: 'Miner',
  9: 'Scout', 10: 'Spy',
};

const params = new URLSearchParams(location.search);
const roomCode = params.get("code");
const token = localStorage.getItem(`stratego:${roomCode}:token`);
const mySlot = Number(localStorage.getItem(`stratego:${roomCode}:slot`));

if (!token) {
  document.body.innerHTML = "<p>No access token found for this room.</p>";
  throw new Error("missing token");
}

let gameRow = null;
let piecesById = new Map();
let selectedPieceId = null;

async function loadGameId() {
  const { data, error } = await supabase.from("games").select("id").eq("room_code", roomCode).single();
  if (error || !data) throw new Error("Game not found");
  return data.id;
}

async function refreshState() {
  const { data: rows, error } = await supabase.rpc("get_game_state", { p_token: token });
  if (error) {
    console.error("get_game_state failed", error);
    return;
  }
  piecesById = new Map(rows.map((r) => [r.piece_id, r]));
  renderBoard();
}

async function refreshGameRow(gameId) {
  const { data, error } = await supabase
    .from("games")
    .select("status, current_turn_slot, turn_number, winner_slot")
    .eq("id", gameId)
    .single();
  if (error) return;
  gameRow = data;
  renderTurnIndicator();
}

function renderTurnIndicator() {
  const el = document.getElementById("turn-indicator");
  if (!gameRow) return;
  if (gameRow.status === "finished") {
    el.textContent = gameRow.winner_slot === mySlot ? "You won!" : "You lost.";
    document.getElementById("rematch-btn").hidden = false;
    return;
  }
  el.textContent = gameRow.current_turn_slot === mySlot ? "Your turn" : "Waiting for opponent...";
}

async function refreshMoveLog(gameId) {
  const { data, error } = await supabase
    .from("moves")
    .select("move_number, player_slot, from_row, from_col, to_row, to_col, move_type, outcome, attacker_rank, defender_rank")
    .eq("game_id", gameId)
    .order("move_number", { ascending: true });
  if (error) return;

  const list = document.getElementById("move-log");
  list.innerHTML = "";
  for (const m of data) {
    const li = document.createElement("li");
    const who = m.player_slot === mySlot ? "You" : "Opponent";
    const from = `${m.from_row},${m.from_col}`;
    const to = `${m.to_row},${m.to_col}`;
    if (m.move_type === "attack") {
      li.textContent = `${who}: ${from} -> ${to} (${RANK_NAME[m.attacker_rank] ?? m.attacker_rank} vs ${RANK_NAME[m.defender_rank] ?? m.defender_rank}: ${m.outcome})`;
    } else {
      li.textContent = `${who}: ${from} -> ${to}`;
    }
    list.appendChild(li);
  }
}

async function refreshChat(gameId) {
  const { data, error } = await supabase
    .from("chat_messages")
    .select("player_slot, body, created_at")
    .eq("game_id", gameId)
    .order("created_at", { ascending: true });
  if (error) return;

  const list = document.getElementById("chat-log");
  list.innerHTML = "";
  for (const m of data) {
    const li = document.createElement("li");
    li.textContent = `${m.player_slot === mySlot ? "You" : "Opponent"}: ${m.body}`;
    list.appendChild(li);
  }
}

function renderBoard() {
  const board = document.getElementById("board");
  board.innerHTML = "";
  board.style.gridTemplateColumns = `repeat(${BOARD_SIZE}, 1fr)`;

  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      const cell = document.createElement("div");
      cell.className = "board-cell";
      if (isLake(row, col)) { cell.classList.add("lake"); cell.textContent = "~"; }

      const piece = [...piecesById.values()].find((p) => p.row_idx === row && p.col_idx === col && p.alive);
      if (piece) {
        cell.classList.add(piece.is_mine ? "mine" : "enemy");
        cell.textContent = piece.rank != null ? (RANK_SHORT[piece.rank] ?? piece.rank) : "?";
        if (piece.piece_id === selectedPieceId) cell.classList.add("selected");
      }

      cell.addEventListener("click", () => handleCellClick(row, col, piece));
      board.appendChild(cell);
    }
  }
}

async function handleCellClick(row, col, piece) {
  if (!gameRow || gameRow.status !== "active" || gameRow.current_turn_slot !== mySlot) return;

  if (selectedPieceId) {
    const selected = piecesById.get(selectedPieceId);
    const from = { row: selected.row_idx, col: selected.col_idx };
    const to = { row, col };
    selectedPieceId = null;
    try {
      await callFunction("make-move", { token, from, to });
    } catch (err) {
      alert(`Move rejected: ${err.message}`);
    }
    await refreshState();
    return;
  }

  if (piece && piece.is_mine) {
    selectedPieceId = piece.piece_id;
    renderBoard();
  }
}

document.getElementById("chat-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = document.getElementById("chat-input");
  const body = input.value.trim();
  if (!body) return;
  input.value = "";
  try {
    await callFunction("send-chat", { token, body });
  } catch (err) {
    alert(`Message failed: ${err.message}`);
  }
});

document.getElementById("rematch-btn").addEventListener("click", async () => {
  try {
    const result = await callFunction("rematch", { token });
    localStorage.setItem(`stratego:${result.roomCode}:token`, result.token);
    localStorage.setItem(`stratego:${result.roomCode}:slot`, String(result.yourSlot));
    alert(`Rematch created! Room code: ${result.roomCode}. Share it with your opponent, then wait for them to join before setup.`);
    location.href = `setup.html?code=${result.roomCode}`;
  } catch (err) {
    alert(`Rematch failed: ${err.message}`);
  }
});

document.getElementById("resign-btn").addEventListener("click", async () => {
  if (!confirm("Resign this game?")) return;
  try {
    await callFunction("resign", { token });
  } catch (err) {
    alert(`Resign failed: ${err.message}`);
  }
});

async function init() {
  const gameId = await loadGameId();
  await refreshGameRow(gameId);
  await refreshState();
  await refreshMoveLog(gameId);
  await refreshChat(gameId);

  supabase
    .channel(`game-${gameId}`)
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "games", filter: `id=eq.${gameId}` }, async () => {
      await refreshGameRow(gameId);
      await refreshState();
      await refreshMoveLog(gameId);
    })
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages", filter: `game_id=eq.${gameId}` }, async () => {
      await refreshChat(gameId);
    })
    .subscribe();
}

init();
