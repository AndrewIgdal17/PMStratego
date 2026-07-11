// web/js/bot.js
import { DEFENSIVE_FORMATIONS, AGGRESSIVE_FORMATIONS } from "./formations.js";
import { getLegalMoves } from "./rules/game.js";
import { resolveCombat, COMBAT_OUTCOME } from "./rules/combat.js";

const ALL_FORMATIONS = [...DEFENSIVE_FORMATIONS, ...AGGRESSIVE_FORMATIONS];

// The bot is always seated as player slot 2. Slot 2's absolute board rows
// (0-3) already match the local row numbering formations.js stores cells
// in, so -- unlike slot 1's setup screen (see setup.js's ABSOLUTE_ROWS) --
// no row-mirroring is needed here.
export function pickBotFormationPlacements() {
  const formation = ALL_FORMATIONS[Math.floor(Math.random() * ALL_FORMATIONS.length)];
  return formation.cells.map(([row, col, rank]) => ({ rank, row, col }));
}

function toRulesPiece(row) {
  return {
    id: row.piece_id,
    playerSlot: row.player_slot,
    rank: row.rank === "BOMB" || row.rank === "FLAG" || row.rank === null ? row.rank : Number(row.rank),
    row: row.row_idx,
    col: row.col_idx,
    alive: row.alive,
  };
}

// gameStateRows: rows shaped like get_game_state()'s output (piece_id,
// player_slot, rank, row_idx, col_idx, alive, is_mine). Opponent pieces
// that haven't been revealed have rank === null, exactly as a human
// opponent would see them -- the bot gets no extra information.
export function chooseBotMove(gameStateRows, botSlot, botMoveHistory) {
  const pieces = gameStateRows.map(toRulesPiece);
  const legalMoves = getLegalMoves(pieces, botSlot, botMoveHistory);
  if (legalMoves.length === 0) return null;

  const botRankByPieceId = new Map(
    pieces.filter((p) => p.playerSlot === botSlot).map((p) => [p.id, p.rank]),
  );

  const winning = [];
  const safe = [];
  const losing = [];

  for (const move of legalMoves) {
    const defender = pieces.find((p) => p.alive && p.row === move.to.row && p.col === move.to.col);
    if (!defender || defender.rank == null) {
      safe.push(move);
      continue;
    }
    const outcome = resolveCombat(botRankByPieceId.get(move.pieceId), defender.rank);
    if (outcome === COMBAT_OUTCOME.DEFENDER_WINS) {
      losing.push(move);
    } else {
      winning.push(move);
    }
  }

  const pool = winning.length > 0 ? winning : safe.length > 0 ? safe : losing;
  return pool[Math.floor(Math.random() * pool.length)];
}
