// web/js/formationRowMap.js
//
// formations.js stores each formation's cells with a local row 0-3, where
// index 0 is the row nearest the midline (front) and index 3 is the row
// farthest from the midline (back) -- see setup.js's original comment.
// Slot 1's territory (absolute rows 6-9) and slot 2's territory (absolute
// rows 0-3) sit on opposite sides of the lakes, so "nearest the midline"
// maps to a different absolute row for each slot. Both the human setup
// screen and the bot's automatic formation placement consume the same
// formations.js catalog and must apply this same mapping.
export const ABSOLUTE_ROWS_BY_SLOT = {
  1: [6, 7, 8, 9],
  2: [3, 2, 1, 0],
};
