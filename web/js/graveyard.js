import { ARMY_COMPOSITION } from "./rules/pieces.js";

const RANK_ABBR = {
  1: "Ma",
  2: "Ge",
  3: "Co",
  4: "Mj",
  5: "Cp",
  6: "Lt",
  7: "Sg",
  8: "Mi",
  9: "Sc",
  10: "Sp",
  "1": "Ma",
  "2": "Ge",
  "3": "Co",
  "4": "Mj",
  "5": "Cp",
  "6": "Lt",
  "7": "Sg",
  "8": "Mi",
  "9": "Sc",
  "10": "Sp",
  BOMB: "B",
  FLAG: "F",
};

export const GRAVEYARD_RANKS = ARMY_COMPOSITION.map((entry) => ({
  rank: String(entry.rank),
  abbr: RANK_ABBR[entry.rank] ?? String(entry.rank),
  count: entry.count,
}));

export function normalizeRank(rank) {
  if (rank == null) return null;
  return String(rank);
}

function isAttackMove(move) {
  if (move.move_type != null) return move.move_type === "attack";
  return move.outcome != null;
}

function attackerDies(outcome) {
  return outcome === "DEFENDER_WINS" || outcome === "TIE";
}

function defenderDies(outcome) {
  return outcome === "ATTACKER_WINS" || outcome === "TIE";
}

/**
 * Recover ranks of dead enemy pieces from the move log.
 *
 * Fog-of-war leaves enemy `rank` null even after they die, so the graveyard
 * must read attacker_rank / defender_rank from combat rows. Defenders are
 * identified by defender_piece_id — matching "dead piece still sitting on
 * to_row/to_col" is wrong once a second piece dies on the same square.
 */
export function buildDeadEnemyRankMap(pieces, moves) {
  const map = new Map();
  if (!moves) return map;

  const byId = new Map(pieces.map((p) => [p.piece_id, p]));

  for (const m of moves) {
    if (!isAttackMove(m) || !m.outcome) continue;

    if (attackerDies(m.outcome) && m.piece_id) {
      const attacker = byId.get(m.piece_id);
      if (attacker && !attacker.is_mine && m.attacker_rank != null) {
        map.set(m.piece_id, normalizeRank(m.attacker_rank));
      }
    }

    if (!defenderDies(m.outcome)) continue;

    if (m.defender_piece_id) {
      const defender = byId.get(m.defender_piece_id);
      if (defender && !defender.is_mine && m.defender_rank != null) {
        map.set(m.defender_piece_id, normalizeRank(m.defender_rank));
      }
      continue;
    }

    // Pre-defender_piece_id games: pick the first unmapped dead enemy still
    // recorded on the combat square, skipping pieces already attributed.
    const attacker = byId.get(m.piece_id);
    if (!attacker?.is_mine || m.defender_rank == null) continue;
    const deadDefender = pieces.find(
      (p) =>
        !p.alive &&
        !p.is_mine &&
        p.piece_id !== m.piece_id &&
        p.row_idx === m.to_row &&
        p.col_idx === m.to_col &&
        !map.has(p.piece_id),
    );
    if (deadDefender) {
      map.set(deadDefender.piece_id, normalizeRank(m.defender_rank));
    }
  }

  return map;
}

export function tallyDeadByRank(pieces, { isMine, enemyRankMap = null, filterSlot = null } = {}) {
  const deadPieces = pieces.filter((p) => {
    if (p.alive) return false;
    if (filterSlot) return p.player_slot === filterSlot;
    return p.is_mine === isMine;
  });

  const deadByRank = new Map();
  for (const p of deadPieces) {
    let rank = p.rank != null ? normalizeRank(p.rank) : null;
    if (!isMine && rank == null && enemyRankMap) {
      rank = enemyRankMap.get(p.piece_id) ?? null;
    }
    if (rank == null) continue;
    deadByRank.set(rank, (deadByRank.get(rank) ?? 0) + 1);
  }
  return deadByRank;
}
