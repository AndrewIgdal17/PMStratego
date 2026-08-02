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

export type BoardCell = string | null;
export type BoardState = {
  cells: BoardCell[][];
  pos: Map<string, { row: number; col: number }>;
  alive: Set<string>;
};

function emptyCells(): BoardCell[][] {
  return Array.from({ length: 10 }, () => Array<BoardCell>(10).fill(null));
}

export function buildInitialBoard(
  pieces: PieceLike[],
  moves: MoveLike[],
): BoardState {
  const cells = emptyCells();
  const pos = new Map<string, { row: number; col: number }>();
  const alive = new Set<string>();

  for (const p of pieces) {
    alive.add(p.id);
    pos.set(p.id, { row: p.row_idx ?? 0, col: p.col_idx ?? 0 });
  }

  for (let i = moves.length - 1; i >= 0; i--) {
    const m = moves[i];
    if (m.move_type === "attack" && m.outcome) {
      if (m.outcome === "ATTACKER_WINS" && m.defender_piece_id) {
        alive.add(m.defender_piece_id);
        pos.set(m.defender_piece_id, { row: m.to_row, col: m.to_col });
      } else if (m.outcome === "DEFENDER_WINS") {
        alive.add(m.piece_id);
        pos.set(m.piece_id, { row: m.to_row, col: m.to_col });
      } else if (m.outcome === "TIE") {
        alive.add(m.piece_id);
        pos.set(m.piece_id, { row: m.to_row, col: m.to_col });
        if (m.defender_piece_id) {
          alive.add(m.defender_piece_id);
          pos.set(m.defender_piece_id, { row: m.to_row, col: m.to_col });
        }
      }
    }
    pos.set(m.piece_id, { row: m.from_row, col: m.from_col });
    alive.add(m.piece_id);
  }

  for (const [id, p] of pos) {
    if (!alive.has(id)) continue;
    cells[p.row][p.col] = id;
  }
  return { cells, pos, alive };
}

export function applyMoveToBoard(board: BoardState, m: MoveLike): void {
  const from = board.pos.get(m.piece_id);
  if (from) board.cells[from.row][from.col] = null;

  if (m.move_type === "attack" && m.outcome) {
    if (m.outcome === "ATTACKER_WINS") {
      if (m.defender_piece_id) {
        board.alive.delete(m.defender_piece_id);
        board.pos.delete(m.defender_piece_id);
      }
      board.cells[m.to_row][m.to_col] = m.piece_id;
      board.pos.set(m.piece_id, { row: m.to_row, col: m.to_col });
    } else if (m.outcome === "DEFENDER_WINS") {
      board.alive.delete(m.piece_id);
      board.pos.delete(m.piece_id);
    } else if (m.outcome === "TIE") {
      board.alive.delete(m.piece_id);
      board.pos.delete(m.piece_id);
      if (m.defender_piece_id) {
        board.alive.delete(m.defender_piece_id);
        const dp = board.pos.get(m.defender_piece_id);
        if (dp) board.cells[dp.row][dp.col] = null;
        board.pos.delete(m.defender_piece_id);
      }
      board.cells[m.to_row][m.to_col] = null;
    }
  } else {
    board.cells[m.to_row][m.to_col] = m.piece_id;
    board.pos.set(m.piece_id, { row: m.to_row, col: m.to_col });
  }
}

export type LegalMove = {
  piece_id: string;
  to_row: number;
  to_col: number;
  is_attack: boolean;
  defender_piece_id: string | null;
};

function inBounds(r: number, c: number): boolean {
  return r >= 0 && r < 10 && c >= 0 && c < 10;
}

function isLake(r: number, c: number): boolean {
  return LAKE_SQUARES.has(`${r},${c}`);
}

export function listLegalMovesForPiece(
  board: BoardState,
  pieceId: string,
  pieceById: Map<string, PieceLike>,
): LegalMove[] {
  const piece = pieceById.get(pieceId);
  const p = board.pos.get(pieceId);
  if (!piece || !p || !board.alive.has(pieceId)) return [];
  if (!movableRank(piece.rank)) return [];

  const out: LegalMove[] = [];
  const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]] as const;
  const maxSteps = piece.rank === "9" ? 9 : 1;

  for (const [dr, dc] of dirs) {
    for (let step = 1; step <= maxSteps; step++) {
      const r = p.row + dr * step;
      const c = p.col + dc * step;
      if (!inBounds(r, c) || isLake(r, c)) break;
      const occ = board.cells[r][c];
      if (!occ) {
        out.push({
          piece_id: pieceId,
          to_row: r,
          to_col: c,
          is_attack: false,
          defender_piece_id: null,
        });
        continue;
      }
      const occPiece = pieceById.get(occ);
      if (occPiece && occPiece.player_slot !== piece.player_slot) {
        out.push({
          piece_id: pieceId,
          to_row: r,
          to_col: c,
          is_attack: true,
          defender_piece_id: occ,
        });
      }
      break;
    }
  }
  return out;
}

export function listLegalMoves(
  board: BoardState,
  slot: number,
  pieceById: Map<string, PieceLike>,
): LegalMove[] {
  const all: LegalMove[] = [];
  for (const [id, piece] of pieceById) {
    if (piece.player_slot !== slot) continue;
    if (!board.alive.has(id)) continue;
    all.push(...listLegalMovesForPiece(board, id, pieceById));
  }
  return all;
}

export function isKnownLethalAttack(
  attackerRank: string,
  defenderPieceId: string,
  myLedger: KnowledgeLedger,
): boolean {
  const known = myLedger.get(defenderPieceId);
  if (!known || !known.alive) return false;
  if (ranksTie(attackerRank, known.rank)) return false;
  return !rankBeats(attackerRank, known.rank);
}

/** True if there exists a legal move other than `chosen` that is not a known-losing attack. */
export function hasSafeOrNonLethalAlternative(
  legal: LegalMove[],
  myLedger: KnowledgeLedger,
  pieceById: Map<string, PieceLike>,
  chosen?: LegalMove,
): boolean {
  for (const mv of legal) {
    if (
      chosen &&
      mv.piece_id === chosen.piece_id &&
      mv.to_row === chosen.to_row &&
      mv.to_col === chosen.to_col
    ) {
      continue;
    }
    if (!mv.is_attack || !mv.defender_piece_id) return true;
    const attacker = pieceById.get(mv.piece_id);
    if (!attacker) return true;
    const known = myLedger.get(mv.defender_piece_id);
    if (!known) return true;
    if (ranksTie(attacker.rank, known.rank)) return true;
    if (rankBeats(attacker.rank, known.rank)) return true;
  }
  return false;
}

/**
 * Apply bidirectional ledger updates AFTER memory tests for this move.
 * myLedger = what `slot` knows about the enemy.
 * theirLedger = what the enemy knows about `slot`.
 */
export function applyLedgerUpdatesFromMove(
  m: MoveLike,
  slot: number,
  myLedger: KnowledgeLedger,
  theirLedger: KnowledgeLedger,
  myVacated: Map<string, VacatedSquare>,
  pieceById: Map<string, PieceLike>,
): void {
  const isMyMove = m.player_slot === slot;
  const isEnemyMove = m.player_slot !== slot;

  // Scout inference from multi-square enemy moves
  if (isEnemyMove && inferScoutFromMove(m)) {
    learnPiece(myLedger, m.piece_id, "9", m.to_row, m.to_col, m.move_number);
  }

  // Position updates for pieces already in ledgers
  if (isEnemyMove) {
    updatePiecePosition(
      myLedger, m.piece_id, m.from_row, m.from_col, m.to_row, m.to_col, m.move_number, myVacated,
    );
  } else {
    updatePiecePosition(
      theirLedger, m.piece_id, m.from_row, m.from_col, m.to_row, m.to_col, m.move_number, new Map(),
    );
  }

  if (m.move_type !== "attack" || !m.outcome || !m.defender_piece_id) return;

  if (isMyMove) {
    // I learn defender; they learn my attacker
    if (m.defender_rank) {
      learnPiece(myLedger, m.defender_piece_id, m.defender_rank, m.to_row, m.to_col, m.move_number);
    }
    if (m.attacker_rank) {
      learnPiece(theirLedger, m.piece_id, m.attacker_rank, m.to_row, m.to_col, m.move_number);
    }
  } else {
    // Enemy attacks me: I learn their attacker; they learn my defender
    if (m.attacker_rank) {
      learnPiece(myLedger, m.piece_id, m.attacker_rank, m.to_row, m.to_col, m.move_number);
    }
    const def = pieceById.get(m.defender_piece_id);
    if (def && def.player_slot === slot) {
      learnPiece(
        theirLedger,
        m.defender_piece_id,
        def.rank,
        m.to_row,
        m.to_col,
        m.move_number,
      );
    }
  }

  // Deaths
  if (m.outcome === "ATTACKER_WINS") {
    markPieceDead(myLedger, m.defender_piece_id);
    markPieceDead(theirLedger, m.defender_piece_id);
  } else if (m.outcome === "DEFENDER_WINS") {
    markPieceDead(myLedger, m.piece_id);
    markPieceDead(theirLedger, m.piece_id);
  } else if (m.outcome === "TIE") {
    markPieceDead(myLedger, m.piece_id);
    markPieceDead(theirLedger, m.piece_id);
    markPieceDead(myLedger, m.defender_piece_id);
    markPieceDead(theirLedger, m.defender_piece_id);
  }
}
