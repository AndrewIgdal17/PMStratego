import { supabase, callFunction } from "./supabaseClient.js";
import { BOARD_SIZE, isLake } from "./rules/board.js";
import { chooseBotMove } from "./bot.js";

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

const GRAVEYARD_RANKS = [
  { rank: '1',    abbr: 'Ma', count: 1 },
  { rank: '2',    abbr: 'Ge', count: 1 },
  { rank: '3',    abbr: 'Co', count: 2 },
  { rank: '4',    abbr: 'Mj', count: 3 },
  { rank: '5',    abbr: 'Cp', count: 4 },
  { rank: '6',    abbr: 'Lt', count: 4 },
  { rank: '7',    abbr: 'Sg', count: 4 },
  { rank: '8',    abbr: 'Mi', count: 5 },
  { rank: '9',    abbr: 'Sc', count: 8 },
  { rank: '10',   abbr: 'Sp', count: 1 },
  { rank: 'BOMB', abbr: 'B',  count: 6 },
  { rank: 'FLAG', abbr: 'F',  count: 1 },
];

const RANK_CENTER = {
  '1': '10', '2': '9', '3': '8', '4': '7',
  '5': '6', '6': '5', '7': '4', '8': '3',
  '9': '2', '10': 'S', 'BOMB': '💣', 'FLAG': '🚩',
  1: '10', 2: '9', 3: '8', 4: '7',
  5: '6', 6: '5', 7: '4', 8: '3',
  9: '2', 10: 'S',
};

const ENEMY_COLOR = '#8b4444';
const ENEMY_STROKE = '#6a2a2a';
const DEFAULT_PLAYER_COLOR = '#4a7a4a';

function darkenColor(hex) {
  const r = Math.max(0, parseInt(hex.slice(1, 3), 16) - 0x20);
  const g = Math.max(0, parseInt(hex.slice(3, 5), 16) - 0x20);
  const b = Math.max(0, parseInt(hex.slice(5, 7), 16) - 0x20);
  return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
}

function getPlayerColor() {
  return localStorage.getItem(`stratego:${roomCode}:color`) || DEFAULT_PLAYER_COLOR;
}

function createTokenSVG(rank, isMine) {
  const fill = isMine ? getPlayerColor() : ENEMY_COLOR;
  const stroke = isMine ? darkenColor(fill) : ENEMY_STROKE;
  const textFill = isMine ? '#e0f0e0' : '#f0d0d0';

  const center = rank != null ? (RANK_CENTER[rank] ?? '?') : '?';
  const name = rank != null ? (RANK_NAME[rank] ?? null) : null;
  const isEmoji = center === '💣' || center === '🚩';
  const isSpy = center === 'S';

  const isTwoDigit = center === '10';
  const centerFontSize = isEmoji ? 20 : (isSpy ? 24 : (isTwoDigit ? 18 : 22));
  const centerStyle = isSpy ? 'font-style="italic"' : '';
  const centerY = isEmoji ? 44 : 46;

  let curvedText = '';
  if (name) {
    const arcId = `arc-${Math.random().toString(36).slice(2, 8)}`;
    curvedText = `
      <defs><path id="${arcId}" d="M 10,36 a 26,26 0 0,1 52,0" fill="none"/></defs>
      <text font-size="7" fill="${textFill}" opacity="0.85" font-family="'TokenScript', serif" letter-spacing="1">
        <textPath href="#${arcId}" startOffset="50%" text-anchor="middle">${name}</textPath>
      </text>`;
  }

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 72 72');
  svg.classList.add('piece-token');
  svg.innerHTML = `
    <circle cx="36" cy="36" r="33" fill="${fill}" stroke="${stroke}" stroke-width="2.5"/>
    <circle cx="36" cy="36" r="27" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="1"/>
    ${curvedText}
    <text font-size="${centerFontSize}" font-weight="bold" ${centerStyle} fill="${textFill}" text-anchor="middle" x="36" y="${centerY}">${center}</text>
  `;
  return svg;
}

const params = new URLSearchParams(location.search);
const roomCode = params.get("code");
const isSpectator = params.get("spectate") === "1";
const token = isSpectator ? null : localStorage.getItem(`stratego:${roomCode}:token`);
const mySlot = isSpectator ? 0 : Number(localStorage.getItem(`stratego:${roomCode}:slot`));

const navRoomEl = document.getElementById("nav-room-code");
if (navRoomEl && roomCode) navRoomEl.textContent = `Room: ${roomCode}${isSpectator ? ' (Spectating)' : ''}`;

if (!token && !isSpectator) {
  document.body.innerHTML = "<p>No access token found for this room.</p>";
  throw new Error("missing token");
}

let gameRow = null;
let piecesById = new Map();
let gameId = null;
let selectedPieceId = null;
const BOT_SLOT = 2;
let botMoveScheduled = false;
let lastMoveData = null;

async function loadGameId() {
  const { data, error } = await supabase.from("games").select("id").eq("room_code", roomCode).single();
  if (error || !data) throw new Error("Game not found");
  return data.id;
}

async function refreshState() {
  let rows, error;
  if (isSpectator) {
    ({ data: rows, error } = await supabase.rpc("get_spectator_state", { p_room_code: roomCode }));
  } else {
    ({ data: rows, error } = await supabase.rpc("get_game_state", { p_token: token }));
  }
  if (error) {
    console.error("state fetch failed", error);
    return;
  }
  piecesById = new Map(rows.map((r) => [r.piece_id, r]));
  renderBoard();
  renderGraveyards(lastMoveData);
}

async function refreshGameRow(gameId) {
  const { data, error } = await supabase
    .from("games")
    .select("status, current_turn_slot, turn_number, winner_slot, is_bot_game")
    .eq("id", gameId)
    .single();
  if (error) return;
  gameRow = data;
  renderTurnIndicator();

  if (
    gameRow.is_bot_game &&
    gameRow.status === "active" &&
    gameRow.current_turn_slot === BOT_SLOT &&
    !botMoveScheduled
  ) {
    botMoveScheduled = true;
    setTimeout(() => {
      makeBotMove(gameId).finally(() => {
        botMoveScheduled = false;
      });
    }, 1000);
  }
}

function renderTurnIndicator() {
  const el = document.getElementById("turn-indicator");
  if (!gameRow) return;
  if (gameRow.status === "finished") {
    if (isSpectator) {
      el.textContent = `Player ${gameRow.winner_slot} wins!`;
    } else {
      el.textContent = gameRow.winner_slot === mySlot ? "You won!" : "You lost.";
    }
    if (!isSpectator) document.getElementById("rematch-btn").hidden = false;
    return;
  }
  if (isSpectator) {
    el.textContent = gameRow.is_bot_game && gameRow.current_turn_slot === 2
      ? "Bot's turn..."
      : `Player ${gameRow.current_turn_slot}'s turn`;
  } else {
    el.textContent = gameRow.current_turn_slot === mySlot
      ? "Your turn"
      : gameRow.is_bot_game ? "Bot's turn..." : "Waiting for opponent...";
  }

  if (isSpectator) {
    document.getElementById("chat-form").hidden = true;
    document.getElementById("resign-btn").hidden = true;
    const enemyLabel = document.querySelector('#graveyard-enemy .graveyard-label');
    const mineLabel = document.querySelector('#graveyard-mine .graveyard-label');
    if (enemyLabel) enemyLabel.textContent = 'Player 2 Losses';
    if (mineLabel) mineLabel.textContent = 'Player 1 Losses';
  } else if (gameRow.is_bot_game) {
    document.getElementById("chat-form").hidden = true;
  }
}

async function refreshMoveLog(gameId) {
  const { data, error } = await supabase
    .from("moves")
    .select("move_number, player_slot, piece_id, from_row, from_col, to_row, to_col, move_type, outcome, attacker_rank, defender_rank")
    .eq("game_id", gameId)
    .order("move_number", { ascending: true });
  if (error) return;
  lastMoveData = data;

  const list = document.getElementById("move-log");
  list.innerHTML = "";
  for (const m of data) {
    const li = document.createElement("li");
    let who;
    if (isSpectator) {
      who = gameRow?.is_bot_game && m.player_slot === 2 ? "Bot" : `P${m.player_slot}`;
    } else {
      who = m.player_slot === mySlot ? "You" : (gameRow?.is_bot_game ? "Bot" : "Opponent");
    }
    const fromCoord = formatAbsCoord(m.from_row, m.from_col);
    const toCoord = formatAbsCoord(m.to_row, m.to_col);
    const isMyMove = m.player_slot === mySlot;

    if (m.move_type === "attack") {
      li.textContent = `${who}: ${fromCoord} → ${toCoord} (${RANK_NAME[m.attacker_rank] ?? m.attacker_rank} vs ${RANK_NAME[m.defender_rank] ?? m.defender_rank}: ${m.outcome})`;
    } else if (isSpectator) {
      const piece = piecesById.get(m.piece_id);
      const pieceName = piece ? (RANK_NAME[piece.rank] ?? '') : '';
      li.textContent = `${who}: ${pieceName ? pieceName + ' ' : ''}${fromCoord} → ${toCoord}`;
    } else if (isMyMove) {
      const piece = piecesById.get(m.piece_id);
      const pieceName = piece ? (RANK_NAME[piece.rank] ?? '') : '';
      li.textContent = `${who}: ${pieceName ? pieceName + ' ' : ''}${fromCoord} → ${toCoord}`;
    } else {
      li.textContent = `${who}: ${fromCoord} → ${toCoord}`;
    }
    list.appendChild(li);
  }
  renderGraveyards(data);
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

async function makeBotMove(gameId) {
  const botToken = localStorage.getItem(`stratego:${roomCode}:botToken`);
  if (!botToken) return;

  const MAX_ATTEMPTS = 5;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const { data: rows, error: stateError } = await supabase.rpc("get_game_state", { p_token: botToken });
    if (stateError || !rows) {
      console.warn("Bot state fetch failed, retrying:", stateError?.message ?? "no rows returned");
      continue;
    }

    const { data: moveRows, error: movesError } = await supabase
      .from("moves")
      .select("piece_id, from_row, from_col, to_row, to_col")
      .eq("game_id", gameId)
      .eq("player_slot", BOT_SLOT)
      .order("move_number", { ascending: true });

    if (movesError) {
      console.warn("Bot move-history fetch failed, retrying:", movesError.message);
      continue;
    }

    const botHistory = (moveRows ?? []).map((m) => ({
      pieceId: m.piece_id,
      from: `${m.from_row},${m.from_col}`,
      to: `${m.to_row},${m.to_col}`,
    }));

    const move = chooseBotMove(rows, BOT_SLOT, botHistory);
    if (!move) return;

    try {
      await callFunction("make-move", { token: botToken, from: move.from, to: move.to });
      await refreshState();
      await refreshGameRow(gameId);
      await refreshMoveLog(gameId);
      return;
    } catch (err) {
      console.warn("Bot move rejected, retrying:", err.message);
    }
  }

  document.getElementById("turn-indicator").textContent = "Bot couldn't find a legal move — try Resign or Rematch.";
}

function toAbsolute(displayRow, displayCol) {
  if (mySlot === 2) {
    return { row: BOARD_SIZE - 1 - displayRow, col: BOARD_SIZE - 1 - displayCol };
  }
  return { row: displayRow, col: displayCol };
}

function toDisplay(absRow, absCol) {
  if (mySlot === 2) {
    return { row: BOARD_SIZE - 1 - absRow, col: BOARD_SIZE - 1 - absCol };
  }
  return { row: absRow, col: absCol };
}

function formatCoord(displayRow, displayCol) {
  return String.fromCharCode(65 + displayCol) + (displayRow + 1);
}

function formatAbsCoord(absRow, absCol) {
  const d = toDisplay(absRow, absCol);
  return formatCoord(d.row, d.col);
}

function renderBoard() {
  const colLabels = document.getElementById("board-col-labels");
  if (colLabels) {
    colLabels.innerHTML = "";
    for (let c = 0; c < BOARD_SIZE; c++) {
      const span = document.createElement("span");
      span.textContent = String.fromCharCode(65 + c);
      colLabels.appendChild(span);
    }
  }

  const rowLabels = document.getElementById("board-row-labels");
  if (rowLabels) {
    rowLabels.innerHTML = "";
    for (let r = 0; r < BOARD_SIZE; r++) {
      const span = document.createElement("span");
      span.textContent = String(r + 1);
      rowLabels.appendChild(span);
    }
  }

  const board = document.getElementById("board");
  board.innerHTML = "";
  board.style.gridTemplateColumns = `repeat(${BOARD_SIZE}, 1fr)`;

  for (let displayRow = 0; displayRow < BOARD_SIZE; displayRow++) {
    for (let displayCol = 0; displayCol < BOARD_SIZE; displayCol++) {
      const { row, col } = toAbsolute(displayRow, displayCol);
      const cell = document.createElement("div");
      cell.className = "board-cell";
      if (isLake(row, col)) { cell.classList.add("lake"); cell.textContent = "~"; }

      const piece = [...piecesById.values()].find((p) => p.row_idx === row && p.col_idx === col && p.alive);
      if (piece) {
        const isFriendly = isSpectator ? piece.player_slot === 1 : piece.is_mine;
        cell.appendChild(createTokenSVG(piece.rank, isFriendly));
        if (piece.piece_id === selectedPieceId) cell.classList.add("selected");
      }

      cell.addEventListener("click", () => handleCellClick(row, col, piece));
      board.appendChild(cell);
    }
  }
}

function renderGraveyards(moveData) {
  const allPieces = [...piecesById.values()];

  const deadEnemyRanks = new Map();
  if (moveData) {
    for (const m of moveData) {
      if (m.move_type !== 'attack') continue;
      if (m.outcome === 'ATTACKER_WINS' || m.outcome === 'TIE') {
        const defenderOnSquare = allPieces.find(
          (p) => !p.alive && p.row_idx === m.to_row && p.col_idx === m.to_col && !p.is_mine
        );
        if (defenderOnSquare && !deadEnemyRanks.has(defenderOnSquare.piece_id)) {
          deadEnemyRanks.set(defenderOnSquare.piece_id, String(m.defender_rank));
        }
      }
      if (m.outcome === 'DEFENDER_WINS' || m.outcome === 'TIE') {
        const attackerDead = allPieces.find(
          (p) => !p.alive && !p.is_mine && p.piece_id === allPieces.find(
            (q) => !q.alive && q.row_idx === m.from_row && q.col_idx === m.from_col && !q.is_mine
          )?.piece_id
        );
        if (attackerDead && !deadEnemyRanks.has(attackerDead.piece_id)) {
          deadEnemyRanks.set(attackerDead.piece_id, String(m.attacker_rank));
        }
      }
    }
  }

  if (isSpectator) {
    renderSingleGraveyard('graveyard-enemy-body', false, null, 2);
    renderSingleGraveyard('graveyard-mine-body', false, null, 1);
  } else {
    renderSingleGraveyard('graveyard-enemy-body', false, deadEnemyRanks);
    renderSingleGraveyard('graveyard-mine-body', true, null);
  }
}

function renderSingleGraveyard(containerId, isMine, enemyRankMap, filterSlot) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const allPieces = [...piecesById.values()];
  const deadPieces = allPieces.filter((p) => !p.alive && (filterSlot ? p.player_slot === filterSlot : p.is_mine === isMine));

  const deadByRank = new Map();
  for (const p of deadPieces) {
    let rank = p.rank != null ? String(p.rank) : null;
    if (!isMine && rank == null && enemyRankMap) {
      rank = enemyRankMap.get(p.piece_id) ?? null;
    }
    if (rank == null) continue;
    if (!deadByRank.has(rank)) deadByRank.set(rank, 0);
    deadByRank.set(rank, deadByRank.get(rank) + 1);
  }

  const colorSuffix = isMine ? 'mine' : 'enemy';

  const tray = document.createElement('div');
  tray.className = 'graveyard-tray';

  for (let i = 0; i < GRAVEYARD_RANKS.length; i++) {
    const entry = GRAVEYARD_RANKS[i];
    if (i > 0) {
      const divider = document.createElement('div');
      divider.className = 'graveyard-divider';
      tray.appendChild(divider);
    }

    const col = document.createElement('div');
    col.className = 'graveyard-column';

    const label = document.createElement('span');
    label.className = 'graveyard-rank-label';
    label.textContent = entry.abbr;
    col.appendChild(label);

    const deadCount = deadByRank.get(entry.rank) ?? 0;
    for (let s = 0; s < entry.count; s++) {
      const slot = document.createElement('div');
      slot.className = 'graveyard-slot';
      if (s < deadCount) {
        slot.classList.add(`filled-${colorSuffix}`);
        slot.textContent = entry.abbr;
        if (isMine) slot.style.backgroundColor = getPlayerColor();
      } else {
        slot.classList.add(`empty-${colorSuffix}`);
      }
      col.appendChild(slot);
    }

    tray.appendChild(col);
  }

  container.innerHTML = '';
  container.appendChild(tray);
}

async function handleCellClick(row, col, piece) {
  if (isSpectator) return;
  if (!gameRow || gameRow.status !== "active" || gameRow.current_turn_slot !== mySlot) return;

  if (selectedPieceId) {
    if (piece && piece.is_mine) {
      selectedPieceId = piece.piece_id;
      renderBoard();
      return;
    }
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
    await refreshGameRow(gameId);
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

let pendingRematchCode = null;

function showRematchModal(newRoomCode) {
  pendingRematchCode = newRoomCode;
  document.getElementById("rematch-modal").hidden = false;
}

document.getElementById("accept-rematch-btn").addEventListener("click", async () => {
  if (!pendingRematchCode) return;
  const btn = document.getElementById("accept-rematch-btn");
  btn.disabled = true;
  btn.textContent = "Joining...";
  try {
    const { token: newToken } = await callFunction("join-game", { roomCode: pendingRematchCode });
    localStorage.setItem(`stratego:${pendingRematchCode}:token`, newToken);
    localStorage.setItem(`stratego:${pendingRematchCode}:slot`, "2");
    location.href = `setup.html?code=${pendingRematchCode}`;
  } catch (err) {
    btn.textContent = "Accept";
    btn.disabled = false;
    alert(`Failed to join rematch: ${err.message}`);
  }
});

document.getElementById("decline-rematch-btn").addEventListener("click", () => {
  document.getElementById("rematch-modal").hidden = true;
  pendingRematchCode = null;
});

async function init() {
  gameId = await loadGameId();
  await refreshGameRow(gameId);
  await refreshState();
  await refreshMoveLog(gameId);
  await refreshChat(gameId);

  supabase
    .channel(`game-${gameId}`)
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "games", filter: `id=eq.${gameId}` }, async (payload) => {
      if (payload.new.rematch_room_code && !isSpectator) {
        showRematchModal(payload.new.rematch_room_code);
      }
      await refreshGameRow(gameId);
      await refreshState();
      await refreshMoveLog(gameId);
    })
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages", filter: `game_id=eq.${gameId}` }, async () => {
      await refreshChat(gameId);
    })
    .subscribe();
}

document.querySelectorAll('.graveyard-header').forEach((header) => {
  header.addEventListener('click', () => {
    header.closest('.graveyard').classList.toggle('collapsed');
  });
});

init();
