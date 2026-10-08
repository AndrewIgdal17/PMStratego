import { BOARD_SIZE } from '../rules/board.ts';
import type { FogPiece, GameRow, GameStatus, MoveRow, Slot, Square } from '../types.ts';

/** Spectator orientation. Slot 2 is the only seat that rotates the board. */
export type ViewSlot = Slot | 0;

const STATUS_RANK: Record<GameStatus, number> = { setup: 0, active: 1, finished: 2 };

function statusRank(status: string): number {
  if (status === 'setup' || status === 'active' || status === 'finished') return STATUS_RANK[status];
  return -1;
}

export function toAbsolute(displayRow: number, displayCol: number, mySlot: ViewSlot): Square {
  if (mySlot === 2) {
    return { row: BOARD_SIZE - 1 - displayRow, col: BOARD_SIZE - 1 - displayCol };
  }
  return { row: displayRow, col: displayCol };
}

export function toDisplay(absRow: number, absCol: number, mySlot: ViewSlot): Square {
  if (mySlot === 2) {
    return { row: BOARD_SIZE - 1 - absRow, col: BOARD_SIZE - 1 - absCol };
  }
  return { row: absRow, col: absCol };
}

/**
 * Drop a games snapshot that is older than the one already on screen.
 * A newer turn always wins. The same turn applies when status does not
 * move backwards, so a resign (active → finished, same turn_number) lands
 * and a repeated finished row can carry a rematch code.
 */
export function shouldApplyGameRow(next: GameRow, prev: GameRow | null): boolean {
  if (!prev) return true;
  if (next.turn_number !== prev.turn_number) return next.turn_number > prev.turn_number;
  return statusRank(next.status) >= statusRank(prev.status);
}

function deadDefenderAt(pieces: FogPiece[], move: MoveRow): FogPiece | undefined {
  return pieces.find(
    (piece) =>
      !piece.alive &&
      !piece.is_mine &&
      piece.piece_id !== move.piece_id &&
      piece.row_idx === move.to_row &&
      piece.col_idx === move.to_col,
  );
}

/** Enemy piece ids whose rank is known only because they died in an attack. */
export function inferEnemyDeadRanks(pieces: FogPiece[], moves: MoveRow[]): Map<string, string> {
  const deadEnemyRanks = new Map<string, string>();
  for (const move of moves) {
    if (move.move_type !== 'attack') continue;
    const attacker = pieces.find((piece) => piece.piece_id === move.piece_id);
    const isMyAttack = Boolean(attacker && attacker.is_mine);

    if (move.outcome === 'ATTACKER_WINS') {
      if (!isMyAttack) continue;
      const deadDefender = deadDefenderAt(pieces, move);
      if (deadDefender && !deadEnemyRanks.has(deadDefender.piece_id)) {
        deadEnemyRanks.set(deadDefender.piece_id, String(move.defender_rank));
      }
    } else if (move.outcome === 'DEFENDER_WINS') {
      if (isMyAttack || deadEnemyRanks.has(move.piece_id)) continue;
      deadEnemyRanks.set(move.piece_id, String(move.attacker_rank));
    } else if (move.outcome === 'TIE') {
      if (isMyAttack) {
        const deadDefender = deadDefenderAt(pieces, move);
        if (deadDefender && !deadEnemyRanks.has(deadDefender.piece_id)) {
          deadEnemyRanks.set(deadDefender.piece_id, String(move.defender_rank));
        }
      } else if (!deadEnemyRanks.has(move.piece_id)) {
        deadEnemyRanks.set(move.piece_id, String(move.attacker_rank));
      }
    }
  }
  return deadEnemyRanks;
}

function isEnemyPiece(piece: FogPiece, isSpectator: boolean): boolean {
  return isSpectator ? piece.player_slot !== 1 : !piece.is_mine;
}

/**
 * Rank to paint on an enemy piece for the latest attack only.
 * Fog state often still has `rank: null` for that one refresh.
 */
export function getPostCombatRevealRank(
  pieceId: string,
  lastMove: MoveRow | null,
  pieces: Map<string, FogPiece>,
  isSpectator: boolean,
): string | null {
  if (!lastMove) return null;
  if (lastMove.move_type !== 'attack' || lastMove.outcome === 'TIE') return null;

  if (lastMove.outcome === 'ATTACKER_WINS') {
    if (pieceId !== lastMove.piece_id) return null;
    const attacker = pieces.get(pieceId);
    if (!attacker?.alive) return null;
    if (!isEnemyPiece(attacker, isSpectator)) return null;
    return lastMove.attacker_rank;
  }

  if (lastMove.outcome === 'DEFENDER_WINS') {
    const defender = [...pieces.values()].find(
      (piece) => piece.alive && piece.row_idx === lastMove.to_row && piece.col_idx === lastMove.to_col,
    );
    if (!defender || defender.piece_id !== pieceId) return null;
    if (!isEnemyPiece(defender, isSpectator)) return null;
    return lastMove.defender_rank;
  }

  return null;
}
