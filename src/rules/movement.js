import { isOnBoard, isLake } from './board.js';
import { RANK, isMovableRank } from './pieces.js';

export function pieceAt(pieces, row, col) {
  return pieces.find((p) => p.alive && p.row === row && p.col === col) || null;
}

export function isOrthogonalAdjacent(from, to) {
  const rowDiff = Math.abs(from.row - to.row);
  const colDiff = Math.abs(from.col - to.col);
  return (rowDiff === 1 && colDiff === 0) || (rowDiff === 0 && colDiff === 1);
}

function isClearScoutPath(pieces, from, to) {
  const sameRow = from.row === to.row;
  const sameCol = from.col === to.col;
  if (!sameRow && !sameCol) return false;
  if (sameRow && sameCol) return false;

  const rowStep = sameRow ? 0 : Math.sign(to.row - from.row);
  const colStep = sameCol ? 0 : Math.sign(to.col - from.col);
  let row = from.row + rowStep;
  let col = from.col + colStep;

  while (row !== to.row || col !== to.col) {
    if (isLake(row, col)) return false;
    if (pieceAt(pieces, row, col)) return false;
    row += rowStep;
    col += colStep;
  }
  return true;
}

export function isLegalDestination(pieces, mover, from, to) {
  if (!isOnBoard(to.row, to.col)) return false;
  if (isLake(to.row, to.col)) return false;
  if (from.row === to.row && from.col === to.col) return false;

  const targetPiece = pieceAt(pieces, to.row, to.col);
  if (targetPiece && targetPiece.playerSlot === mover.playerSlot) return false;

  if (mover.rank === RANK.SCOUT) {
    return isClearScoutPath(pieces, from, to);
  }
  return isOrthogonalAdjacent(from, to);
}

export function isMovablePiece(piece) {
  return isMovableRank(piece.rank);
}

export function validateMove(pieces, playerSlot, from, to) {
  const mover = pieceAt(pieces, from.row, from.col);
  if (!mover) return { valid: false, reason: 'NO_PIECE_AT_SOURCE' };
  if (mover.playerSlot !== playerSlot) return { valid: false, reason: 'NOT_YOUR_PIECE' };
  if (!isMovablePiece(mover)) return { valid: false, reason: 'PIECE_CANNOT_MOVE' };
  if (!isLegalDestination(pieces, mover, from, to)) return { valid: false, reason: 'ILLEGAL_DESTINATION' };
  return { valid: true, mover };
}
