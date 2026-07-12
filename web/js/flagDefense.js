// web/js/flagDefense.js
import { RANK } from "./rules/pieces.js";

export function findOwnFlag(pieces, botSlot) {
  return pieces.find(
    (p) => p.alive && p.playerSlot === botSlot && p.rank === RANK.FLAG,
  ) ?? null;
}
