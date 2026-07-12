// web/js/flagDefense.js
import { RANK, ARMY_COMPOSITION } from "./rules/pieces.js";
import { isOnBoard, isLake } from "./rules/board.js";
import { resolveCombat, COMBAT_OUTCOME } from "./rules/combat.js";

const ORTHOGONAL = [[-1, 0], [1, 0], [0, -1], [0, 1]];

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

export function assessGuardSquares(pieces, flag, botSlot, memory, unknownRankEstimate, lookoutRadius) {
  const results = [];

  for (const [dr, dc] of ORTHOGONAL) {
    const row = flag.row + dr;
    const col = flag.col + dc;

    if (!isOnBoard(row, col) || isLake(row, col)) continue;

    const occupant = pieces.find((p) => p.alive && p.row === row && p.col === col);

    if (occupant && occupant.playerSlot !== botSlot) continue;

    if (!occupant) {
      results.push({ row, col, status: 'open', occupiedByPieceId: null });
      continue;
    }

    const guardRank = occupant.rank;
    const nearbyEnemies = pieces.filter(
      (p) => p.alive && p.playerSlot !== botSlot &&
        Math.max(Math.abs(p.row - row), Math.abs(p.col - col)) <= lookoutRadius,
    );

    let atRisk = false;
    for (const enemy of nearbyEnemies) {
      const effectiveRank = memory.get(enemy.id) ?? (enemy.rank != null ? enemy.rank : unknownRankEstimate);
      const outcome = resolveCombat(effectiveRank, guardRank);
      if (outcome === COMBAT_OUTCOME.ATTACKER_WINS || outcome === COMBAT_OUTCOME.TIE) {
        atRisk = true;
        break;
      }
    }

    results.push({
      row,
      col,
      status: atRisk ? 'atRisk' : 'safe',
      occupiedByPieceId: occupant.id,
    });
  }

  return results;
}
