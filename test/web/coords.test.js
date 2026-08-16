import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatAbsCoord,
  colLettersAlongTop,
  rowNumbersAlongLeft,
  setupColLetters,
  setupRowNumbers,
} from "../../web/js/coords.js";

test("A1 is absolute (0, 0) and J10 is absolute (9, 9)", () => {
  assert.equal(formatAbsCoord(0, 0), "A1");
  assert.equal(formatAbsCoord(9, 9), "J10");
  assert.equal(formatAbsCoord(6, 0), "A7");
});

test("slot 1 and spectators read files A–J left-to-right and ranks 1–10 top-to-bottom", () => {
  assert.deepEqual(colLettersAlongTop(1), ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"]);
  assert.deepEqual(rowNumbersAlongLeft(1), ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]);
  assert.deepEqual(colLettersAlongTop(0), colLettersAlongTop(1));
  assert.deepEqual(rowNumbersAlongLeft(0), rowNumbersAlongLeft(1));
});

test("slot 2's rotated board still labels the same physical squares", () => {
  // Top-left on slot 2's screen is absolute (9, 9) = J10.
  assert.deepEqual(colLettersAlongTop(2), ["J", "I", "H", "G", "F", "E", "D", "C", "B", "A"]);
  assert.deepEqual(rowNumbersAlongLeft(2), ["10", "9", "8", "7", "6", "5", "4", "3", "2", "1"]);
});

test("the same square keeps one name in both players' move logs", () => {
  const square = formatAbsCoord(3, 4); // E4
  assert.equal(square, "E4");
  // Slot 2 display of that square is (9-3, 9-4) = (6, 5), which is still E4
  // in shared notation — not F7, which player-relative labels would produce.
  assert.notEqual(formatAbsCoord(6, 5), square);
});

test("setup labels match the absolute squares after slot-2 column mirroring", () => {
  assert.deepEqual(setupColLetters(1), ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"]);
  assert.deepEqual(setupRowNumbers(1), ["7", "8", "9", "10"]);
  assert.deepEqual(setupColLetters(2), ["J", "I", "H", "G", "F", "E", "D", "C", "B", "A"]);
  assert.deepEqual(setupRowNumbers(2), ["4", "3", "2", "1"]);
});
