import { supabase, callFunction } from "./supabaseClient.js";
import { BOARD_SIZE, isLake } from "./rules/board.js";

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

function renderBoard() {
  const board = document.getElementById("board");
  board.innerHTML = "";
  board.style.gridTemplateColumns = `repeat(${BOARD_SIZE}, 1fr)`;

  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      const cell = document.createElement("div");
      cell.className = "board-cell";
      if (isLake(row, col)) cell.classList.add("lake");

      const piece = [...piecesById.values()].find((p) => p.row_idx === row && p.col_idx === col && p.alive);
      if (piece) {
        cell.classList.add(piece.is_mine ? "mine" : "enemy");
        cell.textContent = piece.rank ?? "?";
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

document.getElementById("resign-btn").addEventListener("click", async () => {
  if (!confirm("Resign this game?")) return;
  // Resigning is modeled as the resigning player's opponent winning; implemented
  // as a dedicated Edge Function is out of scope for this task -- see Task 17.
  alert("Resign is wired up in Task 17 alongside rematch.");
});

async function init() {
  const gameId = await loadGameId();
  await refreshGameRow(gameId);
  await refreshState();

  supabase
    .channel(`game-${gameId}`)
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "games", filter: `id=eq.${gameId}` }, async () => {
      await refreshGameRow(gameId);
      await refreshState();
    })
    .subscribe();
}

init();
