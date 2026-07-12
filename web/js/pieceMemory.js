// web/js/pieceMemory.js
import { RANK } from "./rules/pieces.js";
import { jitterFactor } from "./deterministicJitter.js";

const IMPORTANCE_TIER = new Map([
  [RANK.MARSHAL, "critical"],
  [RANK.SPY, "critical"],
  [RANK.GENERAL, "high"],
  [RANK.COLONEL, "high"],
  [RANK.MAJOR, "medium"],
  [RANK.CAPTAIN, "medium"],
  [RANK.LIEUTENANT, "low"],
  [RANK.SERGEANT, "low"],
  [RANK.MINER, "low"],
  [RANK.SCOUT, "minor"],
]);

const BASE_WINDOW_TURNS = {
  critical: { easy: 5, medium: 15, hard: Infinity },
  high: { easy: 3, medium: 10, hard: 25 },
  medium: { easy: 2, medium: 6, hard: 15 },
  low: { easy: 1, medium: 3, hard: 8 },
  minor: { easy: 0, medium: 2, hard: 4 },
};

function normalizeRank(rank) {
  if (rank === "BOMB" || rank === "FLAG" || rank == null) return rank;
  return Number(rank);
}

function windowFor(rank, difficulty, seed, seedFn) {
  // Bomb is a permanent fact once revealed (it never moves) -- remembered
  // for the whole game at every difficulty, not scaled like mobile ranks.
  if (rank === "BOMB") return Infinity;

  const tier = IMPORTANCE_TIER.get(rank);
  if (!tier) return null; // FLAG and any unrecognized rank: not memory-tracked

  const baseWindow = BASE_WINDOW_TURNS[tier][difficulty];
  if (baseWindow === Infinity) return Infinity;
  return baseWindow * jitterFactor(seed, seedFn);
}

// moveHistory: rows shaped like the `moves` table (move_number, outcome,
// piece_id [the mover/attacker], attacker_rank, defender_piece_id,
// defender_rank), oldest-first, from BOTH players. Only combat moves
// (outcome != null) carry reveals.
export function buildPieceMemory(moveHistory, difficulty, currentTurn, seedFn = undefined) {
  const memory = new Map();

  for (const move of moveHistory) {
    if (!move.outcome) continue;

    const reveals = [
      { pieceId: move.piece_id, rank: normalizeRank(move.attacker_rank) },
      { pieceId: move.defender_piece_id, rank: normalizeRank(move.defender_rank) },
    ];

    for (const { pieceId, rank } of reveals) {
      if (!pieceId || rank == null) continue;

      const seed = `${pieceId}:${move.move_number}`;
      const window = windowFor(rank, difficulty, seed, seedFn);
      if (window == null) continue;

      const age = currentTurn - move.move_number;
      if (window > 0 && age <= window) {
        memory.set(pieceId, rank);
      }
    }
  }

  return memory;
}
