export const LAKE_SQUARES = new Set([
  "4,2", "4,3", "5,2", "5,3", "4,6", "4,7", "5,6", "5,7",
]);

export const RANK_VALUE_IW: Record<string, number> = {
  "1": 10, "2": 9, "3": 8, "4": 7, "5": 6, "6": 5, "7": 4,
  "8": 3, "9": 2, "10": 2, BOMB: 5, FLAG: 0,
};

export interface KnowledgeEntry {
  piece_id: string;
  rank: string;
  revealed_at: number;
  last_known_row: number;
  last_known_col: number;
  last_update_move: number;
  moved_since_reveal: boolean;
  alive: boolean;
}

export type KnowledgeLedger = Map<string, KnowledgeEntry>;

/** Vacated square after a known piece moved — used for track_strike MISS detection */
export type VacatedSquare = {
  piece_id: string;
  vacated_at: number;
  rank: string;
};

export interface MoveLike {
  piece_id: string;
  player_slot: number;
  from_row: number;
  from_col: number;
  to_row: number;
  to_col: number;
  move_type: string;
  outcome: string | null;
  attacker_rank: string | null;
  defender_rank: string | null;
  defender_piece_id: string | null;
  move_number: number;
}

export interface PieceLike {
  id: string;
  player_slot: number;
  rank: string;
  alive: boolean;
  row_idx?: number | null;
  col_idx?: number | null;
}

export type CombatEventKind = "kill" | "trade" | "defuse" | "bomb_kill" | "other";

export function createLedger(): KnowledgeLedger {
  return new Map();
}

export function ledgerAliveCount(ledger: KnowledgeLedger): number {
  let n = 0;
  for (const e of ledger.values()) if (e.alive) n++;
  return n;
}

/** Movable pieces currently known in a ledger (alive + movable rank). */
export function ledgerMovableAliveCount(ledger: KnowledgeLedger): number {
  let n = 0;
  for (const e of ledger.values()) {
    if (e.alive && movableRank(e.rank)) n++;
  }
  return n;
}

export function movableRank(rank: string): boolean {
  return rank !== "BOMB" && rank !== "FLAG";
}

export function learnPiece(
  ledger: KnowledgeLedger,
  pieceId: string,
  rank: string,
  row: number,
  col: number,
  moveNumber: number,
): boolean {
  const existing = ledger.get(pieceId);
  if (existing) {
    existing.rank = rank;
    existing.last_known_row = row;
    existing.last_known_col = col;
    existing.last_update_move = moveNumber;
    if (!existing.alive) existing.alive = true;
    return false;
  }
  ledger.set(pieceId, {
    piece_id: pieceId,
    rank,
    revealed_at: moveNumber,
    last_known_row: row,
    last_known_col: col,
    last_update_move: moveNumber,
    moved_since_reveal: false,
    alive: true,
  });
  return true;
}

export function updatePiecePosition(
  ledger: KnowledgeLedger,
  pieceId: string,
  fromRow: number,
  fromCol: number,
  toRow: number,
  toCol: number,
  moveNumber: number,
  vacated: Map<string, VacatedSquare>,
): void {
  const entry = ledger.get(pieceId);
  if (!entry || !entry.alive) return;
  if (fromRow !== toRow || fromCol !== toCol) {
    entry.moved_since_reveal = true;
    vacated.set(`${fromRow},${fromCol}`, {
      piece_id: pieceId,
      vacated_at: moveNumber,
      rank: entry.rank,
    });
  }
  vacated.delete(`${toRow},${toCol}`);
  entry.last_known_row = toRow;
  entry.last_known_col = toCol;
  entry.last_update_move = moveNumber;
}

export function markPieceDead(ledger: KnowledgeLedger, pieceId: string): void {
  const entry = ledger.get(pieceId);
  if (entry) entry.alive = false;
}

export function inferScoutFromMove(m: MoveLike): boolean {
  if (m.move_type === "attack") return false;
  const dist = Math.abs(m.to_row - m.from_row) + Math.abs(m.to_col - m.from_col);
  return dist >= 2;
}

/** Attacker beats defender under Stratego combat rules (attacker perspective). */
export function rankBeats(attackerRank: string, defenderRank: string): boolean {
  if (defenderRank === "BOMB") return attackerRank === "8";
  if (attackerRank === "BOMB") return false;
  if (attackerRank === "10" && defenderRank === "1") return true;
  if (defenderRank === "FLAG") return true;
  if (attackerRank === "FLAG") return false;
  const a = parseInt(attackerRank, 10);
  const d = parseInt(defenderRank, 10);
  if (Number.isNaN(a) || Number.isNaN(d)) return false;
  return a < d;
}

export function ranksTie(a: string, b: string): boolean {
  return a === b && a !== "BOMB" && a !== "FLAG";
}

/**
 * Correct counter for deduction latency.
 * Marshal → Spy only. Bomb → Miner only. Else any rank that beats it.
 */
export function isCorrectCounter(attackerRank: string, knownRank: string): boolean {
  if (knownRank === "BOMB") return attackerRank === "8";
  if (knownRank === "1") return attackerRank === "10";
  return rankBeats(attackerRank, knownRank);
}

export function classifyCombatEvent(
  outcome: string | null,
  defenderRank: string | null,
): CombatEventKind {
  if (!outcome) return "other";
  if (outcome === "TIE") return "trade";
  if (defenderRank === "BOMB") {
    if (outcome === "ATTACKER_WINS") return "defuse";
    if (outcome === "DEFENDER_WINS") return "bomb_kill";
  }
  if (outcome === "ATTACKER_WINS" || outcome === "DEFENDER_WINS") return "kill";
  return "other";
}

export function enemyHalfRow(slot: number, row: number): boolean {
  if (slot === 1) return row <= 4;
  return row >= 5;
}

export function isWeakBluffRank(rank: string): boolean {
  // Spec: rank ≥ 7 → Sergeant(7), Miner(8), Scout(9), Spy(10)
  return rank === "7" || rank === "8" || rank === "9" || rank === "10";
}
