import { squareKey } from './board.js';
import { RANK } from './pieces.js';
import { validateMove } from './movement.js';
import { resolveCombat, COMBAT_OUTCOME } from './combat.js';
import { violatesTwoSquareRule } from './twoSquareRule.js';

export function applyMove(state, { playerSlot, from, to }) {
  if (state.status !== 'active') {
    return { ok: false, reason: 'GAME_NOT_ACTIVE' };
  }
  if (state.currentTurnSlot !== playerSlot) {
    return { ok: false, reason: 'NOT_YOUR_TURN' };
  }

  const validation = validateMove(state.pieces, playerSlot, from, to);
  if (!validation.valid) {
    return { ok: false, reason: validation.reason };
  }

  const mover = validation.mover;
  const fromKey = squareKey(from.row, from.col);
  const toKey = squareKey(to.row, to.col);
  const history = state.moveHistoryByPlayer[playerSlot] || [];

  if (violatesTwoSquareRule(history, mover.id, fromKey, toKey)) {
    return { ok: false, reason: 'TWO_SQUARE_RULE' };
  }

  const defender = state.pieces.find((p) => p.alive && p.row === to.row && p.col === to.col) || null;
  const newPieces = state.pieces.map((p) => ({ ...p }));
  const moverPiece = newPieces.find((p) => p.id === mover.id);

  let combatResult = null;
  let winnerSlot = null;

  if (defender) {
    const defenderPiece = newPieces.find((p) => p.id === defender.id);
    const outcome = resolveCombat(moverPiece.rank, defenderPiece.rank);
    combatResult = {
      outcome,
      attackerRank: moverPiece.rank,
      defenderRank: defenderPiece.rank,
    };

    if (defenderPiece.rank === RANK.FLAG) {
      winnerSlot = playerSlot;
    }

    if (outcome === COMBAT_OUTCOME.ATTACKER_WINS) {
      defenderPiece.alive = false;
      moverPiece.row = to.row;
      moverPiece.col = to.col;
    } else if (outcome === COMBAT_OUTCOME.DEFENDER_WINS) {
      moverPiece.alive = false;
    } else {
      moverPiece.alive = false;
      defenderPiece.alive = false;
    }
  } else {
    moverPiece.row = to.row;
    moverPiece.col = to.col;
  }

  const newHistory = { ...state.moveHistoryByPlayer };
  newHistory[playerSlot] = [...history, { pieceId: mover.id, from: fromKey, to: toKey }];

  const nextTurnSlot = playerSlot === 1 ? 2 : 1;
  const nextPlayerHistory = newHistory[nextTurnSlot] || [];
  if (!winnerSlot && !hasAnyLegalMove(newPieces, nextTurnSlot, nextPlayerHistory)) {
    winnerSlot = playerSlot;
  }

  return {
    ok: true,
    combatResult,
    winnerSlot,
    newState: {
      ...state,
      pieces: newPieces,
      currentTurnSlot: winnerSlot ? state.currentTurnSlot : nextTurnSlot,
      status: winnerSlot ? 'finished' : 'active',
      moveHistoryByPlayer: newHistory,
    },
  };
}

function hasAnyLegalMove(pieces, playerSlot, history) {
  const movablePieces = pieces.filter(
    (p) => p.alive && p.playerSlot === playerSlot && p.rank !== RANK.BOMB && p.rank !== RANK.FLAG,
  );
  for (const piece of movablePieces) {
    for (let row = 0; row < 10; row++) {
      for (let col = 0; col < 10; col++) {
        const validation = validateMove(pieces, playerSlot, { row: piece.row, col: piece.col }, { row, col });
        if (!validation.valid) continue;
        const fromKey = squareKey(piece.row, piece.col);
        const toKey = squareKey(row, col);
        if (violatesTwoSquareRule(history, piece.id, fromKey, toKey)) continue;
        return true;
      }
    }
  }
  return false;
}
