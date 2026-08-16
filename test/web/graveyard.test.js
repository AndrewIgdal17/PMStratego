import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GRAVEYARD_RANKS,
  buildDeadEnemyRankMap,
  tallyDeadByRank,
} from "../../web/js/graveyard.js";
import { ARMY_SIZE } from "../../web/js/rules/pieces.js";

function piece(overrides) {
  return {
    piece_id: "p",
    player_slot: 2,
    rank: null,
    row_idx: 4,
    col_idx: 4,
    alive: false,
    is_mine: false,
    ...overrides,
  };
}

function attack(overrides) {
  return {
    move_type: "attack",
    piece_id: "attacker",
    defender_piece_id: "defender",
    outcome: "ATTACKER_WINS",
    attacker_rank: "5",
    defender_rank: "7",
    from_row: 5,
    from_col: 4,
    to_row: 4,
    to_col: 4,
    ...overrides,
  };
}

test("graveyard tray slot counts match a full army of 40", () => {
  const slots = GRAVEYARD_RANKS.reduce((sum, e) => sum + e.count, 0);
  assert.equal(slots, ARMY_SIZE);
});

test("own dead pieces tally from visible ranks without needing the move log", () => {
  const pieces = [
    piece({ piece_id: "scout", is_mine: true, player_slot: 1, rank: "9", alive: false }),
    piece({ piece_id: "miner", is_mine: true, player_slot: 1, rank: 8, alive: false }),
    piece({ piece_id: "alive", is_mine: true, player_slot: 1, rank: "1", alive: true }),
  ];
  const counts = tallyDeadByRank(pieces, { isMine: true });
  assert.equal(counts.get("9"), 1);
  assert.equal(counts.get("8"), 1);
  assert.equal(counts.has("1"), false);
});

test("enemy deaths on the same square all appear when defender_piece_id is used", () => {
  const pieces = [
    piece({ piece_id: "me", is_mine: true, player_slot: 1, rank: "4", alive: true, row_idx: 4, col_idx: 4 }),
    piece({ piece_id: "sgt", is_mine: false, rank: null, row_idx: 4, col_idx: 4 }),
    piece({ piece_id: "scout", is_mine: false, rank: null, row_idx: 4, col_idx: 4 }),
  ];
  const moves = [
    attack({
      piece_id: "first-attacker",
      defender_piece_id: "sgt",
      defender_rank: "7",
      to_row: 4,
      to_col: 4,
    }),
    attack({
      piece_id: "me",
      defender_piece_id: "scout",
      defender_rank: "9",
      to_row: 4,
      to_col: 4,
    }),
  ];

  const ranks = buildDeadEnemyRankMap(pieces, moves);
  assert.equal(ranks.get("sgt"), "7");
  assert.equal(ranks.get("scout"), "9");

  const counts = tallyDeadByRank(pieces, { isMine: false, enemyRankMap: ranks });
  assert.equal(counts.get("7"), 1);
  assert.equal(counts.get("9"), 1);
});

test("position matching without skipping already-mapped ids would drop the second death", () => {
  // Documents the old bug: two dead enemies share to_row/to_col, find()
  // always returns the first, and the second combat is skipped.
  const pieces = [
    piece({ piece_id: "sgt", row_idx: 4, col_idx: 4 }),
    piece({ piece_id: "scout", row_idx: 4, col_idx: 4 }),
    piece({ piece_id: "me", is_mine: true, player_slot: 1, rank: "4", alive: true, row_idx: 4, col_idx: 4 }),
  ];
  const first = pieces.find(
    (p) => !p.alive && !p.is_mine && p.row_idx === 4 && p.col_idx === 4,
  );
  const mapped = new Map([[first.piece_id, "7"]]);
  const secondLookup = pieces.find(
    (p) => !p.alive && !p.is_mine && p.row_idx === 4 && p.col_idx === 4,
  );
  assert.equal(secondLookup.piece_id, first.piece_id);
  assert.equal(mapped.has(secondLookup.piece_id), true);
});

test("enemy attacker that dies (DEFENDER_WINS) is recovered from piece_id", () => {
  const pieces = [
    piece({ piece_id: "enemy-col", is_mine: false, rank: null, row_idx: 6, col_idx: 2 }),
    piece({ piece_id: "my-gen", is_mine: true, player_slot: 1, rank: "2", alive: true, row_idx: 5, col_idx: 2 }),
  ];
  const moves = [
    attack({
      piece_id: "enemy-col",
      defender_piece_id: "my-gen",
      outcome: "DEFENDER_WINS",
      attacker_rank: "3",
      defender_rank: "2",
      from_row: 6,
      from_col: 2,
      to_row: 5,
      to_col: 2,
    }),
  ];
  const ranks = buildDeadEnemyRankMap(pieces, moves);
  assert.equal(ranks.get("enemy-col"), "3");
  assert.equal(ranks.has("my-gen"), false);
});

test("TIE records the dead enemy defender, not the surviving-or-dead own attacker", () => {
  const pieces = [
    piece({ piece_id: "my-cap", is_mine: true, player_slot: 1, rank: "5", alive: false, row_idx: 5, col_idx: 3 }),
    piece({ piece_id: "their-cap", is_mine: false, rank: null, alive: false, row_idx: 4, col_idx: 3 }),
  ];
  const moves = [
    attack({
      piece_id: "my-cap",
      defender_piece_id: "their-cap",
      outcome: "TIE",
      attacker_rank: "5",
      defender_rank: "5",
      to_row: 4,
      to_col: 3,
    }),
  ];
  const ranks = buildDeadEnemyRankMap(pieces, moves);
  assert.equal(ranks.get("their-cap"), "5");
  assert.equal(ranks.has("my-cap"), false);
});

test("legacy games without defender_piece_id still map sequential deaths on one square", () => {
  const pieces = [
    piece({ piece_id: "sgt", row_idx: 4, col_idx: 4 }),
    piece({ piece_id: "scout", row_idx: 4, col_idx: 4 }),
    piece({ piece_id: "me", is_mine: true, player_slot: 1, rank: "4", alive: true, row_idx: 4, col_idx: 4 }),
  ];
  const moves = [
    attack({
      piece_id: "other-mine",
      defender_piece_id: null,
      defender_rank: "7",
      to_row: 4,
      to_col: 4,
    }),
    attack({
      piece_id: "me",
      defender_piece_id: null,
      defender_rank: "9",
      to_row: 4,
      to_col: 4,
    }),
  ];
  // The first attacker also needs to exist as is_mine for the fallback path.
  pieces.push(
    piece({
      piece_id: "other-mine",
      is_mine: true,
      player_slot: 1,
      rank: "6",
      alive: true,
      row_idx: 3,
      col_idx: 4,
    }),
  );

  const ranks = buildDeadEnemyRankMap(pieces, moves);
  assert.equal(ranks.get("sgt"), "7");
  assert.equal(ranks.get("scout"), "9");
});

test("unrecovered enemy deaths are omitted rather than dumped into a wrong column", () => {
  const pieces = [piece({ piece_id: "unknown", rank: null })];
  const counts = tallyDeadByRank(pieces, { isMine: false, enemyRankMap: new Map() });
  assert.equal(counts.size, 0);
});
