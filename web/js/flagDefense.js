// web/js/flagDefense.js
import { RANK, ARMY_COMPOSITION } from "./rules/pieces.js";

function normalizeRank(rank) {
  if (rank === "BOMB" || rank === "FLAG" || rank == null) return rank;
  return Number(rank);
}

export function findOwnFlag(pieces, botSlot) {
  return pieces.find(
    (p) => p.alive && p.playerSlot === botSlot && p.rank === RANK.FLAG,
  ) ?? null;
}

export function estimateUnknownEnemyRank(pieces, fullMoveHistory, botSlot) {
  const revealedCounts = new Map();

  for (const move of fullMoveHistory) {
    if (!move.outcome) continue;

    if (move.player_slot !== botSlot && move.attacker_rank != null) {
      const rank = normalizeRank(move.attacker_rank);
      if (rank !== RANK.BOMB && rank !== RANK.FLAG) {
        revealedCounts.set(rank, (revealedCounts.get(rank) ?? 0) + 1);
      }
    }
    if (move.defender_piece_id != null && move.defender_rank != null) {
      const defenderIsEnemy = move.player_slot === botSlot;
      if (defenderIsEnemy) {
        const rank = normalizeRank(move.defender_rank);
        if (rank !== RANK.BOMB && rank !== RANK.FLAG) {
          revealedCounts.set(rank, (revealedCounts.get(rank) ?? 0) + 1);
        }
      }
    }
  }

  let totalCount = 0;
  let weightedSum = 0;

  for (const entry of ARMY_COMPOSITION) {
    const rank = entry.rank;
    if (rank === RANK.BOMB || rank === RANK.FLAG) continue;
    const remaining = Math.max(0, entry.count - (revealedCounts.get(rank) ?? 0));
    totalCount += remaining;
    weightedSum += remaining * rank;
  }

  if (totalCount === 0) {
    const lastRank = [...revealedCounts.keys()].pop();
    return lastRank ?? RANK.CAPTAIN;
  }

  return weightedSum / totalCount;
}
