// web/js/pieceSuspicion.js
import { jitterFactor } from "./deterministicJitter.js";

const BASE_THRESHOLD_TURNS = { easy: 30, medium: 15, hard: 8 };

// moveHistory: rows shaped like the `moves` table (piece_id [the mover]),
// from BOTH players -- used only to find which piece_ids have ever moved.
// aliveOpponentPieces: pieces already filtered by the caller to alive,
// non-mine (e.g. from get_game_state rows).
// difficulty: 'easy' | 'medium' | 'hard'.
// currentTurn: pass fullMoveHistory.length (not games.turn_number) -- see
// design spec for why this is preferred over the DB's separately-tracked
// counter.
// seedFn: optional injectable hash for deterministic jitter in tests;
// defaults to the real hash in deterministicJitter.js.
// Returns Set<pieceId> of opponent pieces suspected of being immobile
// (likely Bomb/Flag).
export function findSuspects(moveHistory, aliveOpponentPieces, difficulty, currentTurn, seedFn = undefined) {
  const movedPieceIds = new Set(moveHistory.map((move) => move.piece_id));

  const suspects = new Set();
  for (const piece of aliveOpponentPieces) {
    if (movedPieceIds.has(piece.id)) continue;

    const threshold = BASE_THRESHOLD_TURNS[difficulty] * jitterFactor(piece.id, seedFn);
    if (currentTurn >= threshold) {
      suspects.add(piece.id);
    }
  }

  return suspects;
}
