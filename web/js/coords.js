import { BOARD_SIZE } from "./rules/board.js";
import { ABSOLUTE_ROWS_BY_SLOT } from "./formationRowMap.js";

/** Shared board name for a square. A1 is absolute (0, 0) for every player. */
export function formatAbsCoord(row, col) {
  return String.fromCharCode(65 + col) + (row + 1);
}

function lettersAtoJ() {
  return Array.from({ length: BOARD_SIZE }, (_, c) => String.fromCharCode(65 + c));
}

function numbers1to10() {
  return Array.from({ length: BOARD_SIZE }, (_, r) => String(r + 1));
}

/**
 * Column letters along the top of the on-screen board.
 * Slot 2's grid is rotated 180°, so the left edge is file J.
 */
export function colLettersAlongTop(slot) {
  const letters = lettersAtoJ();
  return slot === 2 ? letters.reverse() : letters;
}

/**
 * Row numbers down the left of the on-screen board.
 * Slot 2's grid is rotated 180°, so the top edge is rank 10.
 */
export function rowNumbersAlongLeft(slot) {
  const numbers = numbers1to10();
  return slot === 2 ? numbers.reverse() : numbers;
}

/**
 * Setup-grid labels in local drawing order (front/midline at the top).
 * Slot 2 mirrors columns on submit, so the left cell is file J, not A.
 */
export function setupColLetters(slot) {
  return colLettersAlongTop(slot);
}

export function setupRowNumbers(slot) {
  return ABSOLUTE_ROWS_BY_SLOT[slot].map((absRow) => String(absRow + 1));
}
