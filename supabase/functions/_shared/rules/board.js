const BOARD_SIZE = 10;
const LAKE_SQUARES = /* @__PURE__ */ new Set([
  "4,2",
  "4,3",
  "5,2",
  "5,3",
  "4,6",
  "4,7",
  "5,6",
  "5,7"
]);
function squareKey(row, col) {
  return `${row},${col}`;
}
function isOnBoard(row, col) {
  return row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE;
}
function isLake(row, col) {
  return LAKE_SQUARES.has(squareKey(row, col));
}
export {
  BOARD_SIZE,
  isLake,
  isOnBoard,
  squareKey
};
