export const LAKE_SQUARES = new Set([
  "4,2", "4,3", "5,2", "5,3", "4,6", "4,7", "5,6", "5,7",
]);

export const RANK_VALUE_IW: Record<string, number> = {
  "1": 10, "2": 9, "3": 8, "4": 7, "5": 6, "6": 5, "7": 4,
  "8": 3, "9": 2, "10": 2, BOMB: 5, FLAG: 0,
};

export type RevealSource =
  | "combat_as_attacker"
  | "combat_as_defender"
  | "movement_inference"
  | "elimination_deduction";

export interface KnowledgeEntry {
  piece_id: string;
  rank: string;
  revealed_at: number;
  reveal_source: RevealSource;
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

/** Count ledger entries gained via one-directional sources only. */
export function asymmetricKnowledgeCount(ledger: KnowledgeLedger): number {
  let n = 0;
  for (const e of ledger.values()) {
    if (
      e.reveal_source === "movement_inference" ||
      e.reveal_source === "elimination_deduction"
    ) {
      n++;
    }
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
  source: RevealSource,
): boolean {
  const existing = ledger.get(pieceId);
  if (existing) {
    existing.rank = rank;
    existing.last_known_row = row;
    existing.last_known_col = col;
    existing.last_update_move = moveNumber;
    if (!existing.alive) existing.alive = true;
    // Preserve original reveal_source — do not overwrite
    return false;
  }
  ledger.set(pieceId, {
    piece_id: pieceId,
    rank,
    revealed_at: moveNumber,
    reveal_source: source,
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

  // Scout inference — ONE-DIRECTIONAL toward the observer
  if (isEnemyMove && inferScoutFromMove(m)) {
    learnPiece(
      myLedger, m.piece_id, "9", m.to_row, m.to_col, m.move_number,
      "movement_inference",
    );
  }
  if (isMyMove && inferScoutFromMove(m)) {
    learnPiece(
      theirLedger, m.piece_id, "9", m.to_row, m.to_col, m.move_number,
      "movement_inference",
    );
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
    if (m.defender_rank) {
      learnPiece(
        myLedger, m.defender_piece_id, m.defender_rank, m.to_row, m.to_col,
        m.move_number, "combat_as_attacker",
      );
    }
    if (m.attacker_rank) {
      learnPiece(
        theirLedger, m.piece_id, m.attacker_rank, m.to_row, m.to_col,
        m.move_number, "combat_as_defender",
      );
    }
  } else {
    if (m.attacker_rank) {
      learnPiece(
        myLedger, m.piece_id, m.attacker_rank, m.to_row, m.to_col,
        m.move_number, "combat_as_defender",
      );
    }
    const def = pieceById.get(m.defender_piece_id);
    if (def && def.player_slot === slot) {
      learnPiece(
        theirLedger, m.defender_piece_id, def.rank, m.to_row, m.to_col,
        m.move_number, "combat_as_attacker",
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

export type MemoryTestId =
  | "bomb_correct"
  | "known_win"
  | "spy_marshal"
  | "track_strike"
  | "threat_avoidance";

export interface MemoryTestResult {
  test_id: MemoryTestId;
  hit: boolean;
  weight: number;
  age: number;
  move_number: number;
  attacker_rank: string;
  known_rank: string;
  defender_piece_id: string;
  load: number;
}

export interface MemoryEvent {
  move_number: number;
  hit: boolean;
  test_id: MemoryTestId;
  attacker_rank: string;
  known_rank: string;
  age: number;
  weight: number;
  narrative: string;
}

export interface MemoryGameAccum {
  hits: number;
  misses: number;
  hitsW: number;
  missesW: number;
  bombHits: number;
  bombMisses: number;
  marshalHits: number;
  marshalMisses: number;
  trackHits: number;
  trackMisses: number;
  missByAge: Record<string, { hits: number; misses: number }>;
  loadAtHit: number[];
  loadAtMiss: number[];
  events: MemoryEvent[];
}

export function emptyMemoryAccum(): MemoryGameAccum {
  return {
    hits: 0,
    misses: 0,
    hitsW: 0,
    missesW: 0,
    bombHits: 0,
    bombMisses: 0,
    marshalHits: 0,
    marshalMisses: 0,
    trackHits: 0,
    trackMisses: 0,
    missByAge: {
      "0-5": { hits: 0, misses: 0 },
      "6-15": { hits: 0, misses: 0 },
      "16-30": { hits: 0, misses: 0 },
      "31+": { hits: 0, misses: 0 },
    },
    loadAtHit: [],
    loadAtMiss: [],
    events: [],
  };
}

function ageBucket(age: number): string {
  if (age <= 5) return "0-5";
  if (age <= 15) return "6-15";
  if (age <= 30) return "16-30";
  return "31+";
}

const RANK_NAME: Record<string, string> = {
  "1": "Marshal", "2": "General", "3": "Colonel", "4": "Major",
  "5": "Captain", "6": "Lieutenant", "7": "Sergeant", "8": "Miner",
  "9": "Scout", "10": "Spy", BOMB: "Bomb", FLAG: "Flag",
};

function narrativeFor(test: MemoryTestResult): string {
  const ar = RANK_NAME[test.attacker_rank] ?? test.attacker_rank;
  const kr = RANK_NAME[test.known_rank] ?? test.known_rank;
  if (test.test_id === "bomb_correct") {
    return test.hit
      ? `Move ${test.move_number} — remembered the Bomb ${test.age} moves later; ${ar} cleared it.`
      : `Move ${test.move_number} — forgot the Bomb (age ${test.age}); sent a ${ar} into it.`;
  }
  if (test.test_id === "track_strike") {
    return test.hit
      ? `Move ${test.move_number} — tracked ${kr} to its new square.`
      : `Move ${test.move_number} — attacked the old ${kr} square after it moved.`;
  }
  if (test.test_id === "threat_avoidance") {
    return `Move ${test.move_number} — walked ${ar} into a known lethal ${kr}.`;
  }
  if (test.test_id === "spy_marshal") {
    return test.hit
      ? `Move ${test.move_number} — Spy correctly struck the known Marshal.`
      : `Move ${test.move_number} — misplayed the known Marshal with ${ar}.`;
  }
  return test.hit
    ? `Move ${test.move_number} — correctly re-engaged ${kr} with ${ar}.`
    : `Move ${test.move_number} — misjudged ${kr}; sent ${ar}.`;
}

/**
 * Memory tests for an attack against myLedger.
 * Call BEFORE learning new info from this combat.
 * Trades (TIE) excluded. threat_avoidance is MISS-only.
 */
export function emitMemoryTestsForAttack(
  m: MoveLike,
  slot: number,
  myLedger: KnowledgeLedger,
  vacated: Map<string, VacatedSquare>,
  _legal: LegalMove[],
  pieceById: Map<string, PieceLike>,
): MemoryTestResult[] {
  if (m.player_slot !== slot || m.move_type !== "attack") return [];
  if (!m.defender_piece_id || !m.attacker_rank) return [];
  if (m.outcome === "TIE") return []; // trades excluded

  const results: MemoryTestResult[] = [];
  const load = ledgerAliveCount(myLedger);
  const weight = RANK_VALUE_IW[m.attacker_rank] ?? 1;

  const known = myLedger.get(m.defender_piece_id);

  // --- track_strike (position memory) ---
  const vacKey = `${m.to_row},${m.to_col}`;
  const stale = vacated.get(vacKey);
  if (stale && stale.piece_id !== m.defender_piece_id) {
    const staleEntry = myLedger.get(stale.piece_id);
    if (staleEntry?.moved_since_reveal) {
      results.push({
        test_id: "track_strike",
        hit: false,
        weight,
        age: m.move_number - stale.vacated_at,
        move_number: m.move_number,
        attacker_rank: m.attacker_rank,
        known_rank: stale.rank,
        defender_piece_id: m.defender_piece_id,
        load,
      });
    }
  } else if (known?.moved_since_reveal) {
    const onCurrent =
      m.to_row === known.last_known_row && m.to_col === known.last_known_col;
    results.push({
      test_id: "track_strike",
      hit: onCurrent,
      weight,
      age: m.move_number - known.revealed_at,
      move_number: m.move_number,
      attacker_rank: m.attacker_rank,
      known_rank: known.rank,
      defender_piece_id: m.defender_piece_id,
      load,
    });
  }

  // Identity tests require defender already in myLedger
  if (!known || !known.alive) return results;

  const age = m.move_number - known.revealed_at;

  // threat_avoidance — MISS ONLY when attacking a known piece you'd lose to
  if (isKnownLethalAttack(m.attacker_rank, m.defender_piece_id, myLedger)) {
    results.push({
      test_id: "threat_avoidance",
      hit: false,
      weight,
      age,
      move_number: m.move_number,
      attacker_rank: m.attacker_rank,
      known_rank: known.rank,
      defender_piece_id: m.defender_piece_id,
      load,
    });
  }

  if (known.rank === "BOMB") {
    results.push({
      test_id: "bomb_correct",
      hit: m.attacker_rank === "8",
      weight,
      age,
      move_number: m.move_number,
      attacker_rank: m.attacker_rank,
      known_rank: known.rank,
      defender_piece_id: m.defender_piece_id,
      load,
    });
  } else if (known.rank === "1") {
    results.push({
      test_id: "spy_marshal",
      hit: m.attacker_rank === "10", // Spy ONLY
      weight,
      age,
      move_number: m.move_number,
      attacker_rank: m.attacker_rank,
      known_rank: known.rank,
      defender_piece_id: m.defender_piece_id,
      load,
    });
  } else if (!ranksTie(m.attacker_rank, known.rank)) {
    results.push({
      test_id: "known_win",
      hit: rankBeats(m.attacker_rank, known.rank),
      weight,
      age,
      move_number: m.move_number,
      attacker_rank: m.attacker_rank,
      known_rank: known.rank,
      defender_piece_id: m.defender_piece_id,
      load,
    });
  }

  return results;
}

export function accumulateMemoryTests(
  acc: MemoryGameAccum,
  tests: MemoryTestResult[],
): void {
  for (const t of tests) {
    const bucket = ageBucket(t.age);
    if (t.hit) {
      acc.hits++;
      acc.hitsW += t.weight;
      acc.missByAge[bucket].hits++;
      acc.loadAtHit.push(t.load);
      if (t.test_id === "bomb_correct") acc.bombHits++;
      if (t.test_id === "spy_marshal") acc.marshalHits++;
      if (t.test_id === "track_strike") acc.trackHits++;
    } else {
      acc.misses++;
      acc.missesW += t.weight;
      acc.missByAge[bucket].misses++;
      acc.loadAtMiss.push(t.load);
      if (t.test_id === "bomb_correct") acc.bombMisses++;
      if (t.test_id === "spy_marshal") acc.marshalMisses++;
      if (t.test_id === "track_strike") acc.trackMisses++;
    }
    acc.events.push({
      move_number: t.move_number,
      hit: t.hit,
      test_id: t.test_id,
      attacker_rank: t.attacker_rank,
      known_rank: t.known_rank,
      age: t.age,
      weight: t.weight,
      narrative: narrativeFor(t),
    });
  }
}

export function topMemoryMoments(events: MemoryEvent[], limit = 5): MemoryEvent[] {
  return [...events]
    .sort(
      (a, b) =>
        b.weight - a.weight ||
        (a.hit === b.hit ? 0 : a.hit ? 1 : -1) ||
        b.move_number - a.move_number,
    )
    .slice(0, limit);
}

export type MemoryScoutingBlob = {
  score: number | null;
  n_tests: number;
  bomb_retention: number | null;
  marshal_retention: number | null;
  /** Career counters persisted inside JSONB (no dedicated SQL columns for marshal). */
  marshal_hits: number;
  marshal_misses: number;
  track_rate: number | null;
  miss_rate_by_age: Record<string, { hits: number; misses: number }>;
  avg_load_at_miss: number | null;
  avg_load_at_hit: number | null;
  half_life_moves: number | null;
  tags: string[];
  vs_bot_tests?: number;
};

function avg(xs: number[]): number | null {
  if (xs.length === 0) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function halfLifeFromBuckets(
  buckets: Record<string, { hits: number; misses: number }>,
): number | null {
  const order: Array<{ key: string; mid: number }> = [
    { key: "0-5", mid: 2.5 },
    { key: "6-15", mid: 10.5 },
    { key: "16-30", mid: 23 },
    { key: "31+", mid: 40 },
  ];
  for (const { key, mid } of order) {
    const b = buckets[key];
    const n = (b?.hits ?? 0) + (b?.misses ?? 0);
    if (n === 0) continue;
    if ((b?.misses ?? 0) / n >= 0.5) return mid;
  }
  return null;
}

export function buildMemoryScouting(
  hitsW: number,
  missesW: number,
  hits: number,
  misses: number,
  bombHits: number,
  bombMisses: number,
  marshalHits: number,
  marshalMisses: number,
  trackHits: number,
  trackMisses: number,
  missByAge: Record<string, { hits: number; misses: number }>,
  loadAtHit: number[],
  loadAtMiss: number[],
): MemoryScoutingBlob {
  const n = hits + misses;
  const score = hitsW + missesW > 0 ? hitsW / (hitsW + missesW) : null;
  const bombN = bombHits + bombMisses;
  const marshalN = marshalHits + marshalMisses;
  const trackN = trackHits + trackMisses;
  const bombRetention = bombN > 0 ? bombHits / bombN : null;
  const marshalRetention = marshalN > 0 ? marshalHits / marshalN : null;
  const trackRate = trackN > 0 ? trackHits / trackN : null;
  const halfLife = halfLifeFromBuckets(missByAge);

  const tags: string[] = [];
  if (score !== null && score >= 0.85 && n >= 10) tags.push("steel_trap");
  if (bombRetention !== null && bombRetention <= 0.4 && bombN >= 5) tags.push("bomb_amnesia");
  if (trackRate !== null && trackRate <= 0.4 && trackN >= 4) tags.push("loses_track");
  if (halfLife !== null && halfLife <= 10) tags.push("short_fuse");

  return {
    score,
    n_tests: n,
    bomb_retention: bombRetention,
    marshal_retention: marshalRetention,
    marshal_hits: marshalHits,
    marshal_misses: marshalMisses,
    track_rate: trackRate,
    miss_rate_by_age: missByAge,
    avg_load_at_miss: avg(loadAtMiss),
    avg_load_at_hit: avg(loadAtHit),
    half_life_moves: halfLife,
    tags,
  };
}

export function mergeMemoryScoutingWithCareer(
  existing: MemoryScoutingBlob | Record<string, unknown> | null | undefined,
  game: MemoryGameAccum,
  careerHitsW: number,
  careerMissesW: number,
  careerHits: number,
  careerMisses: number,
  careerBombHits: number,
  careerBombMisses: number,
  careerMarshalHits: number,
  careerMarshalMisses: number,
  careerTrackHits: number,
  careerTrackMisses: number,
  isBotGame: boolean,
): MemoryScoutingBlob {
  const prev = (existing ?? {}) as Partial<MemoryScoutingBlob>;
  const prevAge = (prev.miss_rate_by_age ?? {}) as Record<
    string,
    { hits: number; misses: number }
  >;
  const mergedAge: Record<string, { hits: number; misses: number }> = {
    "0-5": { hits: 0, misses: 0 },
    "6-15": { hits: 0, misses: 0 },
    "16-30": { hits: 0, misses: 0 },
    "31+": { hits: 0, misses: 0 },
  };
  for (const key of Object.keys(mergedAge)) {
    mergedAge[key].hits = (prevAge[key]?.hits ?? 0) + (game.missByAge[key]?.hits ?? 0);
    mergedAge[key].misses = (prevAge[key]?.misses ?? 0) + (game.missByAge[key]?.misses ?? 0);
  }

  // Running load averages via synthetic expansion of prior means
  const priorHits = Math.max(0, careerHits - game.hits);
  const priorMisses = Math.max(0, careerMisses - game.misses);
  const loadHits = [
    ...(prev.avg_load_at_hit != null && priorHits > 0
      ? Array(priorHits).fill(prev.avg_load_at_hit)
      : []),
    ...game.loadAtHit,
  ];
  const loadMisses = [
    ...(prev.avg_load_at_miss != null && priorMisses > 0
      ? Array(priorMisses).fill(prev.avg_load_at_miss)
      : []),
    ...game.loadAtMiss,
  ];

  const blob = buildMemoryScouting(
    careerHitsW,
    careerMissesW,
    careerHits,
    careerMisses,
    careerBombHits,
    careerBombMisses,
    careerMarshalHits,
    careerMarshalMisses,
    careerTrackHits,
    careerTrackMisses,
    mergedAge,
    loadHits,
    loadMisses,
  );
  if (isBotGame) {
    blob.vs_bot_tests =
      Number((prev as { vs_bot_tests?: number }).vs_bot_tests ?? 0) +
      game.hits + game.misses;
  }
  return blob;
}

export interface IWGameResult {
  // Legacy reveal/avenge (preserve existing player_stats columns)
  revealAttacks: number;
  revealWins: number;
  revealTotal: number;
  revealThenKill: number;
  avengeKills: number;
  avengeOpportunities: number;
  scoutDistance: number;
  spyFirstCombatMove: number | null;

  // Big 6 + controlled deeper
  stillnessNeverMoved: number;
  stillnessMovableTotal: number;
  infoExchangeRatio: number;
  deductionLatencySum: number;
  deductionLatencyCount: number;
  bluffBaitEvents: number;
  bluffBaitBitten: number;
  revealHalfLife: number | null;
  ambushDefenses: number;
  ambushWins: number;
  controlledExposureAttacks: number;
  controlledExposureBurned: number;
  silentMajority: number;
  motionEntropy: number;
  myCaptures: number;

  memory: MemoryGameAccum;
  infoEdgeCurve: number[];
  phaseEvents: PhaseEvent[];
}

export type PhaseEvent = {
  move_number: number;
  kind: "attack" | "memory" | "avenge";
  is_my_attack: boolean;
  reveal_attack: boolean;
  reveal_win: boolean;
  trade_delta: number;
  attack_win: boolean;
  memory_hit: boolean | null;
  memory_w: number;
  my_ledger_size: number;
  material_diff_before: number;
  captures_before: number;
  avenge_opportunity: boolean;
  avenge_kill: boolean;
  deduction_latency: number | null;
};

/** Shannon entropy of my move distribution, normalized by ln(n_moved_pieces). */
export function computeMotionEntropy(moveCountByPiece: Map<string, number>): number {
  const movedCounts: number[] = [];
  let totalMyMoves = 0;
  for (const count of moveCountByPiece.values()) {
    if (count > 0) {
      movedCounts.push(count);
      totalMyMoves += count;
    }
  }
  if (totalMyMoves === 0 || movedCounts.length <= 1) return 0;
  let h = 0;
  for (const c of movedCounts) {
    const p = c / totalMyMoves;
    h -= p * Math.log(p);
  }
  return h / Math.log(movedCounts.length);
}

export function runInformationWarfarePass(
  slot: number,
  moves: MoveLike[],
  pieces: PieceLike[],
  pieceById: Map<string, PieceLike>,
  totalMoves: number,
): IWGameResult {
  const myLedger = createLedger();
  const theirLedger = createLedger();
  const myVacated = new Map<string, VacatedSquare>();
  const board = buildInitialBoard(pieces, moves);

  const myPieces = pieces.filter((p) => p.player_slot === slot);
  const myMovable = myPieces.filter((p) => movableRank(p.rank));
  const myMovableIds = new Set(myMovable.map((p) => p.id));
  const myMovableTotal = myMovable.length;
  const halfThreshold = Math.ceil(myMovableTotal * 0.5);

  const moveCountByPiece = new Map<string, number>();
  for (const p of myPieces) moveCountByPiece.set(p.id, 0);

  const bluffOpen = new Map<string, number>();
  const bluffBitten = new Set<string>();
  const bluffEventIds = new Set<string>();

  let revealAttacks = 0;
  let revealWins = 0;
  let revealTotal = 0;
  let revealThenKill = 0;
  let avengeKills = 0;
  let avengeOpportunities = 0;
  let scoutDistance = 0;
  let spyFirstCombatMove: number | null = null;

  let deductionLatencySum = 0;
  let deductionLatencyCount = 0;
  let ambushDefenses = 0;
  let ambushWins = 0;
  let controlledExposureAttacks = 0;
  let controlledExposureBurned = 0;
  let revealHalfLifeMove: number | null = null;

  const memory = emptyMemoryAccum();
  const infoEdgeCurve: number[] = [];
  const phaseEvents: PhaseEvent[] = [];
  const firstRevealedByMe = new Set<string>();
  const killedByEnemy = new Map<string, string[]>();

  let materialDiff = 0;
  let myCaptures = 0;

  for (const m of moves) {
    const isMyAttack = m.player_slot === slot && m.move_type === "attack";
    const isEnemyAttack = m.player_slot !== slot && m.move_type === "attack";
    const isMyMove = m.player_slot === slot;

    const legal = isMyMove ? listLegalMoves(board, slot, pieceById) : [];

    if (isMyMove) {
      const piece = pieceById.get(m.piece_id);
      if (piece?.rank === "9") {
        scoutDistance += Math.abs(m.to_row - m.from_row) + Math.abs(m.to_col - m.from_col);
      }
    }

    if (spyFirstCombatMove === null && m.move_type === "attack") {
      if (isMyAttack && m.attacker_rank === "10") spyFirstCombatMove = m.move_number;
      else if (isEnemyAttack && m.defender_piece_id) {
        const def = pieceById.get(m.defender_piece_id);
        if (def?.player_slot === slot && def.rank === "10") {
          spyFirstCombatMove = m.move_number;
        }
      }
    }

    let memTests: MemoryTestResult[] = [];
    if (isMyAttack) {
      memTests = emitMemoryTestsForAttack(
        m, slot, myLedger, myVacated, legal, pieceById,
      );
      accumulateMemoryTests(memory, memTests);
    }

    const materialBefore = materialDiff;
    const capturesBefore = myCaptures;
    const myLedgerSizeBefore = myLedger.size;

    let tradeDelta = 0;
    let attackWin = false;
    let revealAttack = false;
    let revealWin = false;
    let avengeOpp = false;
    let avengeKill = false;
    let deductionLat: number | null = null;

    if (m.move_type === "attack" && m.outcome && m.defender_piece_id) {
      const aVal = RANK_VALUE_IW[m.attacker_rank ?? ""] ?? 0;
      const dVal = RANK_VALUE_IW[m.defender_rank ?? ""] ?? 0;

      if (isMyAttack) {
        const wasKnown = myLedger.has(m.defender_piece_id);
        if (!wasKnown) {
          revealAttacks++;
          revealAttack = true;
          if (m.outcome === "ATTACKER_WINS") {
            revealWins++;
            revealWin = true;
          }
          firstRevealedByMe.add(m.defender_piece_id);
          revealTotal++;
        } else {
          const known = myLedger.get(m.defender_piece_id)!;
          if (
            m.attacker_rank &&
            isCorrectCounter(m.attacker_rank, known.rank) &&
            (m.outcome === "ATTACKER_WINS" ||
              (known.rank === "BOMB" && m.outcome === "ATTACKER_WINS"))
          ) {
            const lat = m.move_number - known.revealed_at;
            deductionLatencySum += lat;
            deductionLatencyCount++;
            deductionLat = lat;
          }
        }

        controlledExposureAttacks++;
        if (theirLedger.has(m.piece_id)) controlledExposureBurned++;

        if (m.outcome === "ATTACKER_WINS") {
          tradeDelta += dVal;
          attackWin = true;
          myCaptures++;
          if (killedByEnemy.has(m.defender_piece_id)) {
            avengeKills++;
            avengeKill = true;
          }
        } else if (m.outcome === "DEFENDER_WINS") {
          tradeDelta -= aVal;
        } else if (m.outcome === "TIE") {
          tradeDelta -= aVal;
        }
      } else if (isEnemyAttack) {
        if (!firstRevealedByMe.has(m.piece_id)) {
          firstRevealedByMe.add(m.piece_id);
          revealTotal++;
        }

        if (m.defender_piece_id) {
          const def = pieceById.get(m.defender_piece_id);
          if (def?.player_slot === slot) {
            const prior = moveCountByPiece.get(m.defender_piece_id) ?? 0;
            if (prior === 0) {
              ambushDefenses++;
              if (m.outcome === "DEFENDER_WINS") ambushWins++;
            }
          }
        }

        if (m.outcome === "ATTACKER_WINS" && m.defender_piece_id) {
          const def = pieceById.get(m.defender_piece_id);
          if (def?.player_slot === slot) {
            if (!killedByEnemy.has(m.piece_id)) killedByEnemy.set(m.piece_id, []);
            killedByEnemy.get(m.piece_id)!.push(m.defender_piece_id);
            avengeOpportunities++;
            avengeOpp = true;
            tradeDelta -= dVal;
          }
        } else if (m.outcome === "DEFENDER_WINS") {
          tradeDelta += aVal;
          myCaptures++;
          attackWin = true;
          if (killedByEnemy.has(m.piece_id)) {
            avengeKills++;
            avengeKill = true;
          }
        } else if (m.outcome === "TIE") {
          const def = pieceById.get(m.defender_piece_id);
          if (def?.player_slot === slot) tradeDelta -= dVal;
          tradeDelta += aVal;
        }
      }

      if (isEnemyAttack && m.defender_piece_id && bluffOpen.has(m.defender_piece_id)) {
        const opened = bluffOpen.get(m.defender_piece_id)!;
        if (m.move_number - opened <= 5) {
          bluffBitten.add(m.defender_piece_id);
        }
      }
    }

    if (isMyMove && moveCountByPiece.has(m.piece_id)) {
      moveCountByPiece.set(m.piece_id, (moveCountByPiece.get(m.piece_id) ?? 0) + 1);
    }

    if (isMyMove) {
      const piece = pieceById.get(m.piece_id);
      if (
        piece &&
        isWeakBluffRank(piece.rank) &&
        enemyHalfRow(slot, m.to_row) &&
        !theirLedger.has(m.piece_id) &&
        !bluffEventIds.has(m.piece_id)
      ) {
        bluffEventIds.add(m.piece_id);
        bluffOpen.set(m.piece_id, m.move_number);
      }
    }

    applyLedgerUpdatesFromMove(m, slot, myLedger, theirLedger, myVacated, pieceById);

    if (revealHalfLifeMove === null && myMovableTotal > 0) {
      let knownMovable = 0;
      for (const id of myMovableIds) {
        if (theirLedger.has(id)) knownMovable++;
      }
      if (knownMovable >= halfThreshold) {
        revealHalfLifeMove = m.move_number;
      }
    }

    if (m.move_type === "attack" && m.outcome) {
      infoEdgeCurve.push(
        asymmetricKnowledgeCount(myLedger) -
          asymmetricKnowledgeCount(theirLedger),
      );
    }

    if (m.move_type === "attack" && m.outcome) {
      materialDiff += tradeDelta;
    }

    if (m.move_type === "attack" && m.outcome) {
      phaseEvents.push({
        move_number: m.move_number,
        kind: "attack",
        is_my_attack: isMyAttack,
        reveal_attack: revealAttack,
        reveal_win: revealWin,
        trade_delta: tradeDelta,
        attack_win: attackWin,
        memory_hit: null,
        memory_w: 0,
        my_ledger_size: myLedgerSizeBefore,
        material_diff_before: materialBefore,
        captures_before: capturesBefore,
        avenge_opportunity: avengeOpp,
        avenge_kill: avengeKill,
        deduction_latency: deductionLat,
      });
    }
    for (const t of memTests) {
      phaseEvents.push({
        move_number: m.move_number,
        kind: "memory",
        is_my_attack: true,
        reveal_attack: false,
        reveal_win: false,
        trade_delta: 0,
        attack_win: false,
        memory_hit: t.hit,
        memory_w: t.weight,
        my_ledger_size: myLedgerSizeBefore,
        material_diff_before: materialBefore,
        captures_before: capturesBefore,
        avenge_opportunity: false,
        avenge_kill: false,
        deduction_latency: null,
      });
    }

    applyMoveToBoard(board, m);
  }

  for (const enemyId of firstRevealedByMe) {
    const ep = pieceById.get(enemyId);
    if (ep && !ep.alive) revealThenKill++;
  }

  let neverMoved = 0;
  for (const id of myMovableIds) {
    if ((moveCountByPiece.get(id) ?? 0) === 0) neverMoved++;
  }

  let unrevealedMovable = 0;
  for (const id of myMovableIds) {
    if (!theirLedger.has(id)) unrevealedMovable++;
  }
  const silentMajority = myMovableTotal > 0 ? unrevealedMovable / myMovableTotal : 0;

  const infoExchangeRatio = myLedger.size / Math.max(theirLedger.size, 1);

  const revealHalfLife =
    revealHalfLifeMove !== null && totalMoves > 0
      ? revealHalfLifeMove / totalMoves
      : null;

  const motionEntropy = computeMotionEntropy(moveCountByPiece);

  return {
    revealAttacks,
    revealWins,
    revealTotal,
    revealThenKill,
    avengeKills,
    avengeOpportunities,
    scoutDistance,
    spyFirstCombatMove,
    stillnessNeverMoved: neverMoved,
    stillnessMovableTotal: myMovableTotal,
    infoExchangeRatio,
    deductionLatencySum,
    deductionLatencyCount,
    bluffBaitEvents: bluffEventIds.size,
    bluffBaitBitten: bluffBitten.size,
    revealHalfLife,
    ambushDefenses,
    ambushWins,
    controlledExposureAttacks,
    controlledExposureBurned,
    silentMajority,
    motionEntropy,
    myCaptures,
    memory,
    infoEdgeCurve,
    phaseEvents,
  };
}

// --- Phase-binning (IW + memory + avenge) ---

export type PhaseBin = {
  reveal_attacks: number;
  reveal_wins: number;
  trade_sum: number;
  trade_count: number;
  memory_hits_w: number;
  memory_misses_w: number;
  attacks: number;
  attack_wins: number;
  avenge_kills: number;
  avenge_opportunities: number;
  deduction_latency_sum: number;
  deduction_latency_count: number;
};

export function emptyPhaseBin(): PhaseBin {
  return {
    reveal_attacks: 0,
    reveal_wins: 0,
    trade_sum: 0,
    trade_count: 0,
    memory_hits_w: 0,
    memory_misses_w: 0,
    attacks: 0,
    attack_wins: 0,
    avenge_kills: 0,
    avenge_opportunities: 0,
    deduction_latency_sum: 0,
    deduction_latency_count: 0,
  };
}

export type PhaseStatsStory = {
  by_capture_quarter: Record<"q1" | "q2" | "q3" | "q4", PhaseBin>;
  by_material_state: Record<"behind" | "even" | "ahead" | "dominant", PhaseBin>;
  by_info_state: Record<"deep_fog" | "partial" | "known", PhaseBin>;
};

export function emptyPhaseStats(): PhaseStatsStory {
  return {
    by_capture_quarter: {
      q1: emptyPhaseBin(),
      q2: emptyPhaseBin(),
      q3: emptyPhaseBin(),
      q4: emptyPhaseBin(),
    },
    by_material_state: {
      behind: emptyPhaseBin(),
      even: emptyPhaseBin(),
      ahead: emptyPhaseBin(),
      dominant: emptyPhaseBin(),
    },
    by_info_state: {
      deep_fog: emptyPhaseBin(),
      partial: emptyPhaseBin(),
      known: emptyPhaseBin(),
    },
  };
}

function captureQuarterPhase(
  capturesBefore: number,
  totalCaptures: number,
): "q1" | "q2" | "q3" | "q4" {
  if (totalCaptures <= 0) return "q1";
  const r = capturesBefore / totalCaptures;
  if (r < 0.25) return "q1";
  if (r < 0.5) return "q2";
  if (r < 0.75) return "q3";
  return "q4";
}

function materialStatePhase(diff: number): "behind" | "even" | "ahead" | "dominant" {
  if (diff < -5) return "behind";
  if (diff <= 5) return "even";
  if (diff <= 15) return "ahead";
  return "dominant";
}

function infoStatePhase(knownCount: number): "deep_fog" | "partial" | "known" {
  if (knownCount < 5) return "deep_fog";
  if (knownCount < 15) return "partial";
  return "known";
}

function applyToPhaseBin(bin: PhaseBin, e: PhaseEvent): void {
  if (e.kind === "memory") {
    if (e.memory_hit === true) bin.memory_hits_w += e.memory_w;
    else if (e.memory_hit === false) bin.memory_misses_w += e.memory_w;
    return;
  }
  if (e.is_my_attack) {
    bin.attacks++;
    if (e.attack_win) bin.attack_wins++;
    if (e.reveal_attack) {
      bin.reveal_attacks++;
      if (e.reveal_win) bin.reveal_wins++;
    }
  }
  bin.trade_sum += e.trade_delta;
  bin.trade_count++;
  if (e.avenge_opportunity) bin.avenge_opportunities++;
  if (e.avenge_kill) bin.avenge_kills++;
  if (e.deduction_latency !== null) {
    bin.deduction_latency_sum += e.deduction_latency;
    bin.deduction_latency_count++;
  }
}

export function binPhaseEvents(events: PhaseEvent[], totalCaptures: number): PhaseStatsStory {
  const out = emptyPhaseStats();
  for (const e of events) {
    const q = captureQuarterPhase(e.captures_before, totalCaptures);
    const ms = materialStatePhase(e.material_diff_before);
    const is = infoStatePhase(e.my_ledger_size);
    applyToPhaseBin(out.by_capture_quarter[q], e);
    applyToPhaseBin(out.by_material_state[ms], e);
    applyToPhaseBin(out.by_info_state[is], e);
  }
  return out;
}

function addPhaseBins(a: PhaseBin, b: PhaseBin): PhaseBin {
  return {
    reveal_attacks: a.reveal_attacks + b.reveal_attacks,
    reveal_wins: a.reveal_wins + b.reveal_wins,
    trade_sum: a.trade_sum + b.trade_sum,
    trade_count: a.trade_count + b.trade_count,
    memory_hits_w: a.memory_hits_w + b.memory_hits_w,
    memory_misses_w: a.memory_misses_w + b.memory_misses_w,
    attacks: a.attacks + b.attacks,
    attack_wins: a.attack_wins + b.attack_wins,
    avenge_kills: a.avenge_kills + b.avenge_kills,
    avenge_opportunities: a.avenge_opportunities + b.avenge_opportunities,
    deduction_latency_sum: a.deduction_latency_sum + b.deduction_latency_sum,
    deduction_latency_count: a.deduction_latency_count + b.deduction_latency_count,
  };
}

/** Merge only IW-specific phase fields (memory + deduction) into an existing combat phase stats blob. */
export function mergeIwPhaseFields(target: PhaseStatsStory, source: PhaseStatsStory): void {
  for (const k of ["q1", "q2", "q3", "q4"] as const) {
    const t = target.by_capture_quarter[k];
    const s = source.by_capture_quarter[k];
    t.memory_hits_w += s.memory_hits_w;
    t.memory_misses_w += s.memory_misses_w;
    t.deduction_latency_sum += s.deduction_latency_sum;
    t.deduction_latency_count += s.deduction_latency_count;
  }
  for (const k of ["behind", "even", "ahead", "dominant"] as const) {
    const t = target.by_material_state[k];
    const s = source.by_material_state[k];
    t.memory_hits_w += s.memory_hits_w;
    t.memory_misses_w += s.memory_misses_w;
    t.deduction_latency_sum += s.deduction_latency_sum;
    t.deduction_latency_count += s.deduction_latency_count;
  }
  for (const k of ["deep_fog", "partial", "known"] as const) {
    const t = target.by_info_state[k];
    const s = source.by_info_state[k];
    t.memory_hits_w += s.memory_hits_w;
    t.memory_misses_w += s.memory_misses_w;
    t.deduction_latency_sum += s.deduction_latency_sum;
    t.deduction_latency_count += s.deduction_latency_count;
  }
}

export function mergePhaseCareer(
  existing: PhaseStatsStory | Record<string, unknown> | null | undefined,
  game: PhaseStatsStory,
): PhaseStatsStory {
  const base = existing && (existing as PhaseStatsStory).by_capture_quarter
    ? (existing as PhaseStatsStory)
    : emptyPhaseStats();
  const out = emptyPhaseStats();
  for (const k of ["q1", "q2", "q3", "q4"] as const) {
    out.by_capture_quarter[k] = addPhaseBins(
      base.by_capture_quarter[k],
      game.by_capture_quarter[k],
    );
  }
  for (const k of ["behind", "even", "ahead", "dominant"] as const) {
    out.by_material_state[k] = addPhaseBins(base.by_material_state[k], game.by_material_state[k]);
  }
  for (const k of ["deep_fog", "partial", "known"] as const) {
    out.by_info_state[k] = addPhaseBins(base.by_info_state[k], game.by_info_state[k]);
  }
  return out;
}

// --- IW archetype (Wave-1 metrics only) ---

export type InfoArchetype =
  | "bluffer"
  | "trapper"
  | "converter"
  | "denier"
  | "investor";

export type InfoArchetypeInput = {
  stillness_never_moved: number;
  stillness_movable_total: number;
  info_exchange_ratio_sum: number;
  info_exchange_games: number;
  deduction_latency_sum: number;
  deduction_latency_count: number;
  bluff_bait_events: number;
  bluff_bait_bitten: number;
  reveal_half_life_sum: number;
  reveal_half_life_games: number;
  ambush_defenses: number;
  ambush_wins: number;
  controlled_exposure_attacks: number;
  controlled_exposure_burned: number;
  silent_majority_sum: number;
  silent_majority_games: number;
  memory_hits_w: number;
  memory_misses_w: number;
};

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/** Invert latency: 0 moves → 1.0, 20+ moves → ~0 */
function latencyScore(avgLatency: number): number {
  return clamp01(1 - avgLatency / 20);
}

export function computeInfoArchetype(
  s: InfoArchetypeInput,
): { archetype: InfoArchetype; scores: Record<InfoArchetype, number> } {
  const stillness = s.stillness_movable_total > 0
    ? s.stillness_never_moved / s.stillness_movable_total
    : 0;
  const exchange = s.info_exchange_games > 0
    ? s.info_exchange_ratio_sum / s.info_exchange_games
    : 1;
  const exchangeN = clamp01(exchange / 2); // 2.0 ratio → 1.0
  const lat = s.deduction_latency_count > 0
    ? latencyScore(s.deduction_latency_sum / s.deduction_latency_count)
    : 0.5;
  const bluff = s.bluff_bait_events > 0
    ? s.bluff_bait_bitten / s.bluff_bait_events
    : 0;
  const halfLife = s.reveal_half_life_games > 0
    ? s.reveal_half_life_sum / s.reveal_half_life_games
    : 0.5;
  const ambush = s.ambush_defenses > 0 ? s.ambush_wins / s.ambush_defenses : 0;
  const exposure = s.controlled_exposure_attacks > 0
    ? s.controlled_exposure_burned / s.controlled_exposure_attacks
    : 0;
  const silent = s.silent_majority_games > 0
    ? s.silent_majority_sum / s.silent_majority_games
    : 0;
  const memW = s.memory_hits_w + s.memory_misses_w;
  const memory = memW > 0 ? s.memory_hits_w / memW : 0.5;

  const scores: Record<InfoArchetype, number> = {
    bluffer: bluff * 3 + (1 - stillness) * 2 + (1 - silent) * 1.5 + (1 - ambush),
    trapper: stillness * 3 + ambush * 3 + (1 - bluff) * 2,
    converter: lat * 3 + memory * 3,
    denier: halfLife * 3 + exposure * 2 + silent * 2 + (1 - bluff),
    investor: exchangeN * 4 + memory * 1.5,
  };

  const archetype = (Object.entries(scores) as [InfoArchetype, number][])
    .sort(([, a], [, b]) => b - a)[0][0];
  return { archetype, scores };
}
