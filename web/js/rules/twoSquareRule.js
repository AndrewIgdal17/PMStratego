// Official rule: a piece cannot move back and forth between the same two
// squares more than three consecutive turns. "Consecutive" means the same
// player's own last three moves were all this piece shuttling between the
// same two squares; moving any other piece in between breaks the streak.
export function violatesTwoSquareRule(playerMoveHistory, pieceId, from, to) {
  const last3 = playerMoveHistory.slice(-3);
  if (last3.length < 3) return false;
  if (!last3.every((entry) => entry.pieceId === pieceId)) return false;
  if (last3[0].to !== last3[1].from) return false;
  if (last3[1].to !== last3[2].from) return false;
  if (last3[2].to !== from) return false;

  const squares = new Set([last3[0].from, last3[0].to, last3[1].to, last3[2].to, to]);
  return squares.size === 2;
}
