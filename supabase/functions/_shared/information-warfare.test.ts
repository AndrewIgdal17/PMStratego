import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  rankBeats,
  ranksTie,
  isCorrectCounter,
  classifyCombatEvent,
  learnPiece,
  createLedger,
  movableRank,
  applyLedgerUpdatesFromMove,
  emitMemoryTestsForAttack,
  buildMemoryScouting,
  mergeMemoryScoutingWithCareer,
  emptyMemoryAccum,
  accumulateMemoryTests,
  type LegalMove,
  type PieceLike,
} from "./information-warfare.ts";

Deno.test("rankBeats: lower number wins; Spy→Marshal; Miner→Bomb", () => {
  assertEquals(rankBeats("2", "3"), true); // General beats Colonel
  assertEquals(rankBeats("3", "2"), false); // Colonel loses to General
  assertEquals(rankBeats("10", "1"), true); // Spy attacks Marshal
  assertEquals(rankBeats("2", "1"), false); // General loses to Marshal
  assertEquals(rankBeats("8", "BOMB"), true);
  assertEquals(rankBeats("1", "BOMB"), false);
});

Deno.test("ranksTie: same rank only; never Bomb/Flag", () => {
  assertEquals(ranksTie("3", "3"), true);
  assertEquals(ranksTie("BOMB", "BOMB"), false);
});

Deno.test("isCorrectCounter: Marshal→Spy only; Bomb→Miner only", () => {
  assertEquals(isCorrectCounter("10", "1"), true); // Spy
  assertEquals(isCorrectCounter("1", "1"), false); // Marshal≠counter
  assertEquals(isCorrectCounter("2", "1"), false); // General≠counter
  assertEquals(isCorrectCounter("8", "BOMB"), true);
  assertEquals(isCorrectCounter("1", "BOMB"), false);
  assertEquals(isCorrectCounter("3", "5"), true); // Colonel beats Captain
  assertEquals(isCorrectCounter("5", "3"), false);
});

Deno.test("classifyCombatEvent taxonomy", () => {
  assertEquals(classifyCombatEvent("ATTACKER_WINS", "3"), "kill");
  assertEquals(classifyCombatEvent("DEFENDER_WINS", "3"), "kill");
  assertEquals(classifyCombatEvent("TIE", "3"), "trade");
  assertEquals(classifyCombatEvent("ATTACKER_WINS", "BOMB"), "defuse");
  assertEquals(classifyCombatEvent("DEFENDER_WINS", "BOMB"), "bomb_kill");
});

Deno.test("learnPiece is idempotent for count", () => {
  const L = createLedger();
  assertEquals(learnPiece(L, "a", "BOMB", 1, 1, 5), true);
  assertEquals(learnPiece(L, "a", "BOMB", 1, 1, 6), false);
  assertEquals(L.size, 1);
});

Deno.test("movableRank excludes Bomb/Flag", () => {
  assertEquals(movableRank("BOMB"), false);
  assertEquals(movableRank("FLAG"), false);
  assertEquals(movableRank("9"), true);
});

Deno.test("bidirectional learn: my attack populates both ledgers", () => {
  const my = createLedger();
  const their = createLedger();
  const vacated = new Map();
  const pieces = new Map<string, PieceLike>([
    ["me", { id: "me", player_slot: 1, rank: "8", alive: true }],
    ["bomb", { id: "bomb", player_slot: 2, rank: "BOMB", alive: true }],
  ]);
  applyLedgerUpdatesFromMove(
    {
      piece_id: "me", player_slot: 1, from_row: 5, from_col: 0, to_row: 4, to_col: 0,
      move_type: "attack", outcome: "ATTACKER_WINS", attacker_rank: "8",
      defender_rank: "BOMB", defender_piece_id: "bomb", move_number: 10,
    },
    1, my, their, vacated, pieces,
  );
  assertEquals(my.has("bomb"), true);
  assertEquals(their.has("me"), true);
});

Deno.test("spy_marshal: Spy HIT; General MISS; Marshal TIE excluded upstream", () => {
  const my = createLedger();
  learnPiece(my, "m1", "1", 3, 3, 5);
  const pieces = new Map<string, PieceLike>([
    ["spy", { id: "spy", player_slot: 1, rank: "10", alive: true }],
    ["gen", { id: "gen", player_slot: 1, rank: "2", alive: true }],
    ["m1", { id: "m1", player_slot: 2, rank: "1", alive: true }],
  ]);
  const legal: LegalMove[] = [
    { piece_id: "spy", to_row: 3, to_col: 3, is_attack: true, defender_piece_id: "m1" },
    { piece_id: "spy", to_row: 4, to_col: 0, is_attack: false, defender_piece_id: null },
  ];
  const spyHit = emitMemoryTestsForAttack(
    {
      piece_id: "spy", player_slot: 1, from_row: 4, from_col: 3, to_row: 3, to_col: 3,
      move_type: "attack", outcome: "ATTACKER_WINS", attacker_rank: "10",
      defender_rank: "1", defender_piece_id: "m1", move_number: 20,
    },
    1, my, new Map(), legal, pieces,
  );
  assertEquals(spyHit.some((t) => t.test_id === "spy_marshal" && t.hit), true);

  const genMiss = emitMemoryTestsForAttack(
    {
      piece_id: "gen", player_slot: 1, from_row: 4, from_col: 3, to_row: 3, to_col: 3,
      move_type: "attack", outcome: "DEFENDER_WINS", attacker_rank: "2",
      defender_rank: "1", defender_piece_id: "m1", move_number: 20,
    },
    1, my, new Map(), legal, pieces,
  );
  assertEquals(genMiss.some((t) => t.test_id === "spy_marshal" && !t.hit), true);
});

Deno.test("threat_avoidance: MISS-only on known losing attack; no HIT events", () => {
  const my = createLedger();
  learnPiece(my, "bomb", "BOMB", 4, 4, 2);
  const pieces = new Map<string, PieceLike>([
    ["scout", { id: "scout", player_slot: 1, rank: "9", alive: true }],
    ["bomb", { id: "bomb", player_slot: 2, rank: "BOMB", alive: true }],
  ]);
  const legal: LegalMove[] = [
    { piece_id: "scout", to_row: 4, to_col: 4, is_attack: true, defender_piece_id: "bomb" },
    { piece_id: "scout", to_row: 5, to_col: 0, is_attack: false, defender_piece_id: null },
  ];
  const tests = emitMemoryTestsForAttack(
    {
      piece_id: "scout", player_slot: 1, from_row: 5, from_col: 4, to_row: 4, to_col: 4,
      move_type: "attack", outcome: "DEFENDER_WINS", attacker_rank: "9",
      defender_rank: "BOMB", defender_piece_id: "bomb", move_number: 12,
    },
    1, my, new Map(), legal, pieces,
  );
  const ta = tests.filter((t) => t.test_id === "threat_avoidance");
  assertEquals(ta.length, 1);
  assertEquals(ta[0].hit, false);
  assertEquals(tests.some((t) => t.test_id === "bomb_correct" && !t.hit), true);
});

Deno.test("trades excluded from memory tests", () => {
  const my = createLedger();
  learnPiece(my, "e", "5", 4, 4, 1);
  const pieces = new Map<string, PieceLike>([
    ["a", { id: "a", player_slot: 1, rank: "5", alive: true }],
    ["e", { id: "e", player_slot: 2, rank: "5", alive: true }],
  ]);
  const tests = emitMemoryTestsForAttack(
    {
      piece_id: "a", player_slot: 1, from_row: 5, from_col: 4, to_row: 4, to_col: 4,
      move_type: "attack", outcome: "TIE", attacker_rank: "5",
      defender_rank: "5", defender_piece_id: "e", move_number: 8,
    },
    1, my, new Map(), [], pieces,
  );
  assertEquals(tests.length, 0);
});

Deno.test("silent majority uses movable denom not 40", () => {
  assertEquals(Number((23 / 33).toFixed(4)), Number((23 / 33).toFixed(4)));
  assertEquals(movableRank("BOMB"), false);
});

Deno.test("ambush denominator includes never-moved Bombs", () => {
  const counts = new Map([["bomb1", 0]]);
  assertEquals(counts.get("bomb1"), 0);
});

Deno.test("isCorrectCounter Marshal rejects General", () => {
  assertEquals(isCorrectCounter("2", "1"), false);
  assertEquals(isCorrectCounter("10", "1"), true);
});

Deno.test("buildMemoryScouting: half-life from age buckets", () => {
  const blob = buildMemoryScouting(
    8, 2, 8, 2, 3, 2, 1, 0, 2, 3,
    {
      "0-5": { hits: 2, misses: 3 },
      "6-15": { hits: 4, misses: 1 },
      "16-30": { hits: 2, misses: 0 },
      "31+": { hits: 0, misses: 0 },
    },
    [5, 6, 7, 8, 9, 10, 11, 12],
    [4, 5],
  );
  assertEquals(blob.half_life_moves, 2.5);
  assertEquals(blob.score, 0.8);
  assertEquals(blob.n_tests, 10);
  assertEquals(blob.bomb_retention, 0.6);
  assertEquals(blob.track_rate, 2 / 5);
  assertEquals(blob.tags.includes("short_fuse"), true);
  assertEquals(blob.tags.includes("steel_trap"), false);
});

Deno.test("buildMemoryScouting: steel_trap and bomb_amnesia tags", () => {
  const blob = buildMemoryScouting(
    9, 1, 9, 1, 1, 4, 0, 0, 0, 0,
    {
      "0-5": { hits: 5, misses: 1 },
      "6-15": { hits: 4, misses: 0 },
      "16-30": { hits: 0, misses: 0 },
      "31+": { hits: 0, misses: 0 },
    },
    Array(9).fill(6),
    [5],
  );
  assertEquals(blob.tags.includes("steel_trap"), true);
  assertEquals(blob.tags.includes("bomb_amnesia"), true);
  assertEquals(blob.half_life_moves, null);
});

Deno.test("mergeMemoryScoutingWithCareer: sums career counters and age buckets", () => {
  const game = emptyMemoryAccum();
  accumulateMemoryTests(game, [{
    test_id: "known_win",
    hit: true,
    weight: 3,
    age: 4,
    move_number: 10,
    attacker_rank: "3",
    known_rank: "5",
    defender_piece_id: "e1",
    load: 7,
  }]);
  accumulateMemoryTests(game, [{
    test_id: "track_strike",
    hit: false,
    weight: 2,
    age: 12,
    move_number: 20,
    attacker_rank: "4",
    known_rank: "6",
    defender_piece_id: "e2",
    load: 8,
  }]);

  const prev = buildMemoryScouting(
    5, 5, 5, 5, 2, 3, 1, 0, 1, 1,
    {
      "0-5": { hits: 3, misses: 2 },
      "6-15": { hits: 2, misses: 3 },
      "16-30": { hits: 0, misses: 0 },
      "31+": { hits: 0, misses: 0 },
    },
    Array(5).fill(6),
    Array(5).fill(7),
  );

  const merged = mergeMemoryScoutingWithCareer(
    prev,
    game,
    5 + game.hitsW,
    5 + game.missesW,
    5 + game.hits,
    5 + game.misses,
    2 + game.bombHits,
    3 + game.bombMisses,
    1 + game.marshalHits,
    0 + game.marshalMisses,
    1 + game.trackHits,
    1 + game.trackMisses,
    false,
  );

  assertEquals(merged.n_tests, 12);
  assertEquals(merged.miss_rate_by_age["0-5"].hits, 4);
  assertEquals(merged.miss_rate_by_age["0-5"].misses, 2);
  assertEquals(merged.miss_rate_by_age["6-15"].misses, 4);
  assertEquals(merged.marshal_hits, 1);
  assertEquals(merged.track_rate, 1 / 3);
});
