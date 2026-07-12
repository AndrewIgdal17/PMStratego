// web/js/bot.js
import { DEFENSIVE_FORMATIONS, AGGRESSIVE_FORMATIONS } from "./formations.js";
import { ABSOLUTE_ROWS_BY_SLOT } from "./formationRowMap.js";
import { getLegalMoves } from "./rules/game.js";
import { resolveCombat, COMBAT_OUTCOME } from "./rules/combat.js";
import { RANK } from "./rules/pieces.js";
import { buildPieceMemory } from "./pieceMemory.js";
import { findSuspects } from "./pieceSuspicion.js";
import { findOwnFlag, assessGuardSquares, estimateUnknownEnemyRank } from "./flagDefense.js";

const ALL_FORMATIONS = [...DEFENSIVE_FORMATIONS, ...AGGRESSIVE_FORMATIONS];
const BOT_SLOT = 2;

const VALUABLE_RANKS = new Set([RANK.MARSHAL, RANK.GENERAL, RANK.COLONEL, RANK.MAJOR, RANK.SPY]);
const PROBE_ELIGIBLE_RANKS = new Set([RANK.CAPTAIN, RANK.LIEUTENANT, RANK.SERGEANT, RANK.MINER, RANK.SCOUT]);
const PROBE_PROBABILITY = { easy: 0, medium: 0.5, hard: 1 };
const LOOKOUT_RADIUS = { easy: 1, medium: 2, hard: 3 };

// The bot is always seated as player slot 2, which needs the same local-row
// -> absolute-row remap the human setup screen applies (see
// formationRowMap.js) -- without it, a formation's back rank (where the
// Flag and most Bombs live) lands on the row nearest the lake instead of
// the bot's true back row.
export function mapFormationToAbsolute(cells, slot) {
  const absoluteRows = ABSOLUTE_ROWS_BY_SLOT[slot];
  return cells.map(([row, col, rank]) => ({ rank, row: absoluteRows[row], col }));
}

export function pickBotFormationPlacements() {
  const formation = ALL_FORMATIONS[Math.floor(Math.random() * ALL_FORMATIONS.length)];
  return mapFormationToAbsolute(formation.cells, BOT_SLOT);
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

function isSuspectedSquare(suspects, pieces, row, col) {
  const piece = pieces.find((p) => p.alive && p.row === row && p.col === col);
  return piece != null && suspects.has(piece.id);
}

// gameStateRows: rows shaped like get_game_state()'s output (piece_id,
// player_slot, rank, row_idx, col_idx, alive, is_mine). Opponent pieces
// that haven't been revealed have rank === null, exactly as a human
// opponent would see them -- the bot gets no extra information beyond
// what pieceMemory/pieceSuspicion can legitimately infer from history.
//
// fullMoveHistory: every move in the game so far (both players), shaped
// like the `moves` table -- used to build memory + suspicion.
// difficulty: 'easy' | 'medium' | 'hard'.
// currentTurn: fullMoveHistory.length (see design spec for why this is
// used instead of games.turn_number).
export function chooseBotMove(gameStateRows, botSlot, fullMoveHistory, difficulty = "medium", currentTurn = fullMoveHistory.length, rng = Math.random, personality = "neutral") {
  const pieces = gameStateRows.map(toRulesPiece);
  const legalMoves = getLegalMoves(pieces, botSlot, fullMoveHistory
    .filter((m) => pieces.some((p) => p.id === m.piece_id && p.playerSlot === botSlot))
    .map((m) => ({ pieceId: m.piece_id, from: `${m.from_row},${m.from_col}`, to: `${m.to_row},${m.to_col}` })));
  if (legalMoves.length === 0) return null;

  const botRankByPieceId = new Map(
    pieces.filter((p) => p.playerSlot === botSlot).map((p) => [p.id, p.rank]),
  );

  const memory = buildPieceMemory(fullMoveHistory, difficulty, currentTurn);
  const aliveOpponentPieces = pieces.filter((p) => p.alive && p.playerSlot !== botSlot);
  const suspects = findSuspects(fullMoveHistory, aliveOpponentPieces, difficulty, currentTurn);

  const flag = findOwnFlag(pieces, botSlot);
  let guardStatuses = [];
  if (flag) {
    const unknownRankEstimate = estimateUnknownEnemyRank(pieces, fullMoveHistory, botSlot);
    guardStatuses = assessGuardSquares(pieces, flag, botSlot, memory, unknownRankEstimate, LOOKOUT_RADIUS[difficulty] ?? 2);
  }
  const atRiskFromSquares = new Set(
    guardStatuses.filter((s) => s.status === 'atRisk').map((s) => `${s.row},${s.col}`),
  );

  const winning = [];
  const safe = [];
  const losing = [];

  for (const move of legalMoves) {
    const defender = pieces.find((p) => p.alive && p.row === move.to.row && p.col === move.to.col);
    const liveRank = defender?.rank ?? null;
    const knownRank = liveRank != null ? liveRank : (defender ? memory.get(defender.id) ?? null : null);

    if (!defender || knownRank == null) {
      safe.push(move);
      continue;
    }
    const outcome = resolveCombat(botRankByPieceId.get(move.pieceId), knownRank);
    if (outcome === COMBAT_OUTCOME.DEFENDER_WINS) {
      losing.push(move);
    } else {
      winning.push(move);
    }
  }

  let pool = winning.length > 0 ? winning : safe.length > 0 ? safe : losing;

  // Avoid sending a valuable piece onto a suspected square when a
  // non-suspected alternative exists in the same pool.
  const movingPieceRank = (move) => botRankByPieceId.get(move.pieceId);
  const nonSuspectAlternatives = pool.filter(
    (move) => !isSuspectedSquare(suspects, pieces, move.to.row, move.to.col),
  );
  if (nonSuspectAlternatives.length > 0) {
    const valuableOnSuspect = pool.some(
      (move) => VALUABLE_RANKS.has(movingPieceRank(move)) && isSuspectedSquare(suspects, pieces, move.to.row, move.to.col),
    );
    if (valuableOnSuspect) {
      pool = pool.filter(
        (move) => !(VALUABLE_RANKS.has(movingPieceRank(move)) && isSuspectedSquare(suspects, pieces, move.to.row, move.to.col)),
      );
    }
  }

  if (atRiskFromSquares.size > 0) {
    const nonVacating = pool.filter(
      (move) => !atRiskFromSquares.has(`${move.from.row},${move.from.col}`),
    );
    if (nonVacating.length > 0) {
      pool = nonVacating;
    }
  }

  const openGuardSquares = new Set(
    guardStatuses.filter((s) => s.status === 'open').map((s) => `${s.row},${s.col}`),
  );

  if (winning.length === 0) {
    let reinforceMoves = [];
    if (openGuardSquares.size > 0) {
      reinforceMoves = pool.filter(
        (move) => openGuardSquares.has(`${move.to.row},${move.to.col}`),
      );
      const nonValuableReinforce = reinforceMoves.filter(
        (move) => !VALUABLE_RANKS.has(movingPieceRank(move)),
      );
      if (nonValuableReinforce.length > 0) reinforceMoves = nonValuableReinforce;
    }

    let probeMoves = [];
    if (suspects.size > 0 && rng() < PROBE_PROBABILITY[difficulty]) {
      probeMoves = safe.filter(
        (move) => PROBE_ELIGIBLE_RANKS.has(movingPieceRank(move)) && isSuspectedSquare(suspects, pieces, move.to.row, move.to.col),
      );
    }

    if (reinforceMoves.length > 0 && probeMoves.length === 0) {
      return reinforceMoves[Math.floor(rng() * reinforceMoves.length)];
    }
    if (probeMoves.length > 0 && reinforceMoves.length === 0) {
      return probeMoves[Math.floor(rng() * probeMoves.length)];
    }
    if (reinforceMoves.length > 0 && probeMoves.length > 0) {
      let first;
      if (personality === 'aggressive') {
        first = probeMoves;
      } else if (personality === 'defensive') {
        first = reinforceMoves;
      } else {
        first = rng() < 0.5 ? reinforceMoves : probeMoves;
      }
      return first[Math.floor(rng() * first.length)];
    }
  }

  return pool[Math.floor(rng() * pool.length)];
}
