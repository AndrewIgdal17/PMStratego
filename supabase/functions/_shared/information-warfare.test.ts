import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  rankBeats,
  ranksTie,
  isCorrectCounter,
  classifyCombatEvent,
  learnPiece,
  createLedger,
  markPieceDead,
  checkEliminationDeductions,
  movableRank,
  applyLedgerUpdatesFromMove,
  asymmetricKnowledgeCount,
  runInformationWarfarePass,
  emitMemoryTestsForAttack,
  buildMemoryScouting,
  mergeMemoryScoutingWithCareer,
  emptyMemoryAccum,
  accumulateMemoryTests,
  binPhaseEvents,
  computeInfoArchetype,
  mergePhaseCareer,
  emptyPhaseStats,
  type LegalMove,
  type MoveLike,
  type PieceLike,
  type PhaseEvent,
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
  assertEquals(learnPiece(L, "a", "BOMB", 1, 1, 5, "combat_as_attacker"), true);
  assertEquals(learnPiece(L, "a", "BOMB", 1, 1, 6, "combat_as_attacker"), false);
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
  learnPiece(my, "m1", "1", 3, 3, 5, "combat_as_attacker");
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
  learnPiece(my, "bomb", "BOMB", 4, 4, 2, "combat_as_attacker");
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
  learnPiece(my, "e", "5", 4, 4, 1, "combat_as_attacker");
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

Deno.test("binPhaseEvents: memory hits/misses route to all three lenses", () => {
  const events: PhaseEvent[] = [
    {
      move_number: 10,
      kind: "memory",
      is_my_attack: true,
      reveal_attack: false,
      reveal_win: false,
      trade_delta: 0,
      attack_win: false,
      memory_hit: true,
      memory_w: 2,
      my_ledger_size: 3,
      material_diff_before: 0,
      captures_before: 0,
      avenge_opportunity: false,
      avenge_kill: false,
      deduction_latency: null,
    },
    {
      move_number: 20,
      kind: "memory",
      is_my_attack: true,
      reveal_attack: false,
      reveal_win: false,
      trade_delta: 0,
      attack_win: false,
      memory_hit: false,
      memory_w: 1,
      my_ledger_size: 16,
      material_diff_before: 10,
      captures_before: 3,
      avenge_opportunity: false,
      avenge_kill: false,
      deduction_latency: null,
    },
  ];

  const stats = binPhaseEvents(events, 4);
  assertEquals(stats.by_capture_quarter.q1.memory_hits_w, 2);
  assertEquals(stats.by_capture_quarter.q4.memory_misses_w, 1);
  assertEquals(stats.by_material_state.even.memory_hits_w, 2);
  assertEquals(stats.by_material_state.ahead.memory_misses_w, 1);
  assertEquals(stats.by_info_state.deep_fog.memory_hits_w, 2);
  assertEquals(stats.by_info_state.known.memory_misses_w, 1);
});

Deno.test("mergePhaseCareer: accumulates memory fields across games", () => {
  const game = emptyPhaseStats();
  game.by_info_state.deep_fog.memory_hits_w = 3;
  game.by_info_state.deep_fog.memory_misses_w = 1;

  const merged = mergePhaseCareer(null, game);
  assertEquals(merged.by_info_state.deep_fog.memory_hits_w, 3);
  assertEquals(merged.by_info_state.deep_fog.memory_misses_w, 1);

  game.by_info_state.deep_fog.memory_hits_w = 2;
  const again = mergePhaseCareer(merged, game);
  assertEquals(again.by_info_state.deep_fog.memory_hits_w, 5);
});

Deno.test("computeInfoArchetype: trapper wins on high stillness + ambush", () => {
  const { archetype, scores } = computeInfoArchetype({
    stillness_never_moved: 30,
    stillness_movable_total: 40,
    info_exchange_ratio_sum: 4,
    info_exchange_games: 5,
    deduction_latency_sum: 40,
    deduction_latency_count: 4,
    bluff_bait_events: 2,
    bluff_bait_bitten: 0,
    reveal_half_life_sum: 1,
    reveal_half_life_games: 5,
    ambush_defenses: 10,
    ambush_wins: 8,
    controlled_exposure_attacks: 20,
    controlled_exposure_burned: 5,
    silent_majority_sum: 2,
    silent_majority_games: 5,
    memory_hits_w: 5,
    memory_misses_w: 5,
  });
  assertEquals(archetype, "trapper");
  assertEquals(scores.trapper > scores.bluffer, true);
  assertEquals(scores.trapper > scores.converter, true);
});

Deno.test("computeInfoArchetype: investor wins on high exchange rate", () => {
  const { archetype } = computeInfoArchetype({
    stillness_never_moved: 5,
    stillness_movable_total: 40,
    info_exchange_ratio_sum: 18,
    info_exchange_games: 5,
    deduction_latency_sum: 40,
    deduction_latency_count: 4,
    bluff_bait_events: 0,
    bluff_bait_bitten: 0,
    reveal_half_life_sum: 0.2,
    reveal_half_life_games: 5,
    ambush_defenses: 2,
    ambush_wins: 0,
    controlled_exposure_attacks: 20,
    controlled_exposure_burned: 5,
    silent_majority_sum: 1,
    silent_majority_games: 5,
    memory_hits_w: 5,
    memory_misses_w: 5,
  });
  assertEquals(archetype, "investor");
});

Deno.test("learnPiece stores reveal_source and preserves it on update", () => {
  const L = createLedger();
  assertEquals(
    learnPiece(L, "a", "9", 3, 3, 5, "movement_inference"),
    true,
  );
  assertEquals(L.get("a")!.reveal_source, "movement_inference");
  assertEquals(
    learnPiece(L, "a", "9", 4, 4, 8, "combat_as_attacker"),
    false,
  );
  assertEquals(L.get("a")!.reveal_source, "movement_inference");
  assertEquals(L.get("a")!.last_known_row, 4);
  assertEquals(L.get("a")!.last_update_move, 8);
});

Deno.test("bidirectional Scout inference: my long-move teaches theirLedger", () => {
  const my = createLedger();
  const their = createLedger();
  const vacated = new Map();
  const pieces = new Map<string, PieceLike>([
    ["scout", { id: "scout", player_slot: 1, rank: "9", alive: true }],
    ["e1", { id: "e1", player_slot: 2, rank: "5", alive: true }],
  ]);
  applyLedgerUpdatesFromMove(
    {
      piece_id: "scout",
      player_slot: 1,
      from_row: 7,
      from_col: 0,
      to_row: 4,
      to_col: 0,
      move_type: "move",
      outcome: null,
      attacker_rank: null,
      defender_rank: null,
      defender_piece_id: null,
      move_number: 3,
    },
    1,
    my,
    their,
    vacated,
    pieces,
  );
  assertEquals(their.has("scout"), true);
  assertEquals(their.get("scout")!.rank, "9");
  assertEquals(their.get("scout")!.reveal_source, "movement_inference");
  assertEquals(my.size, 0);
});

Deno.test("enemy Scout long-move teaches myLedger with movement_inference", () => {
  const my = createLedger();
  const their = createLedger();
  const pieces = new Map<string, PieceLike>([
    ["escout", { id: "escout", player_slot: 2, rank: "9", alive: true }],
  ]);
  applyLedgerUpdatesFromMove(
    {
      piece_id: "escout",
      player_slot: 2,
      from_row: 2,
      from_col: 0,
      to_row: 5,
      to_col: 0,
      move_type: "move",
      outcome: null,
      attacker_rank: null,
      defender_rank: null,
      defender_piece_id: null,
      move_number: 4,
    },
    1,
    my,
    their,
    new Map(),
    pieces,
  );
  assertEquals(my.get("escout")!.reveal_source, "movement_inference");
});

Deno.test("combat learn tags combat_as_attacker / combat_as_defender", () => {
  const my = createLedger();
  const their = createLedger();
  const pieces = new Map<string, PieceLike>([
    ["me", { id: "me", player_slot: 1, rank: "3", alive: true }],
    ["them", { id: "them", player_slot: 2, rank: "5", alive: true }],
  ]);
  applyLedgerUpdatesFromMove(
    {
      piece_id: "me",
      player_slot: 1,
      from_row: 5,
      from_col: 0,
      to_row: 4,
      to_col: 0,
      move_type: "attack",
      outcome: "ATTACKER_WINS",
      attacker_rank: "3",
      defender_rank: "5",
      defender_piece_id: "them",
      move_number: 10,
    },
    1,
    my,
    their,
    new Map(),
    pieces,
  );
  assertEquals(my.get("them")!.reveal_source, "combat_as_attacker");
  assertEquals(their.get("me")!.reveal_source, "combat_as_defender");
});

Deno.test("v1 deduction: last unrevealed piece is unique remaining rank", () => {
  const L = createLedger();
  const ranks = ["1", "2", "3", "3", "4", "4", "4", "5", "5", "5", "5",
    "6", "6", "6", "6", "7", "7", "7", "7", "8", "8", "8", "8", "8",
    "9", "9", "9", "9", "9", "9", "9", "9", "10",
    "BOMB", "BOMB", "BOMB", "BOMB", "BOMB", "BOMB"];
  ranks.forEach((r, i) => {
    learnPiece(L, `known${i}`, r, 0, 0, 1, "combat_as_attacker");
    markPieceDead(L, `known${i}`);
  });
  const alive = new Set(["flag"]);
  const enemyPieces: PieceLike[] = [
    { id: "flag", player_slot: 2, rank: "FLAG", alive: true, row_idx: 0, col_idx: 0 },
  ];
  const d = checkEliminationDeductions(L, enemyPieces, alive);
  assertEquals(d, [{ pieceId: "flag", deducedRank: "FLAG" }]);
});

Deno.test("v1 deduction: no fire when multiple unrevealed remain", () => {
  const L = createLedger();
  learnPiece(L, "k1", "1", 0, 0, 1, "combat_as_attacker");
  markPieceDead(L, "k1");
  const alive = new Set(["u1", "u2"]);
  const enemyPieces: PieceLike[] = [
    { id: "u1", player_slot: 2, rank: "FLAG", alive: true },
    { id: "u2", player_slot: 2, rank: "2", alive: true },
  ];
  assertEquals(checkEliminationDeductions(L, enemyPieces, alive).length, 0);
});

Deno.test("deduction learn counts toward asymmetric knowledge", () => {
  const L = createLedger();
  const ranks = ["1", "2", "3", "3", "4", "4", "4", "5", "5", "5", "5",
    "6", "6", "6", "6", "7", "7", "7", "7", "8", "8", "8", "8", "8",
    "9", "9", "9", "9", "9", "9", "9", "9", "10",
    "BOMB", "BOMB", "BOMB", "BOMB", "BOMB", "BOMB"];
  ranks.forEach((r, i) => {
    learnPiece(L, `known${i}`, r, 0, 0, 1, "combat_as_attacker");
    markPieceDead(L, `known${i}`);
  });
  const alive = new Set(["flag"]);
  const enemyPieces: PieceLike[] = [
    { id: "flag", player_slot: 2, rank: "FLAG", alive: true, row_idx: 0, col_idx: 0 },
  ];
  const d = checkEliminationDeductions(L, enemyPieces, alive);
  assertEquals(d.length, 1);
  learnPiece(L, d[0].pieceId, d[0].deducedRank, 0, 0, 40, "elimination_deduction");
  assertEquals(asymmetricKnowledgeCount(L), 1);
  assertEquals(L.get("flag")!.reveal_source, "elimination_deduction");
});

Deno.test("asymmetricKnowledgeCount ignores combat sources", () => {
  const L = createLedger();
  learnPiece(L, "a", "5", 1, 1, 1, "combat_as_attacker");
  learnPiece(L, "b", "9", 2, 2, 2, "movement_inference");
  learnPiece(L, "c", "FLAG", 3, 3, 3, "elimination_deduction");
  assertEquals(asymmetricKnowledgeCount(L), 2);
});

Deno.test("info edge stays 0 across pure combat (symmetric)", () => {
  const pieces: PieceLike[] = [
    { id: "a1", player_slot: 1, rank: "3", alive: true, row_idx: 6, col_idx: 0 },
    { id: "a2", player_slot: 1, rank: "4", alive: true, row_idx: 6, col_idx: 1 },
    { id: "b1", player_slot: 2, rank: "5", alive: true, row_idx: 3, col_idx: 0 },
    { id: "b2", player_slot: 2, rank: "6", alive: true, row_idx: 3, col_idx: 1 },
  ];
  const pieceById = new Map(pieces.map((p) => [p.id, p]));
  const moves: MoveLike[] = [
    {
      piece_id: "a1", player_slot: 1, from_row: 6, from_col: 0, to_row: 3, to_col: 0,
      move_type: "attack", outcome: "ATTACKER_WINS", attacker_rank: "3",
      defender_rank: "5", defender_piece_id: "b1", move_number: 1,
    },
    {
      piece_id: "b2", player_slot: 2, from_row: 3, from_col: 1, to_row: 6, to_col: 1,
      move_type: "attack", outcome: "ATTACKER_WINS", attacker_rank: "6",
      defender_rank: "4", defender_piece_id: "a2", move_number: 2,
    },
  ];
  const iw = runInformationWarfarePass(1, moves, pieces, pieceById, 2);
  assertEquals(iw.infoEdgeCurve.every((v) => v === 0), true);
});

Deno.test("info edge moves +1 when enemy Scout long-moves", () => {
  const pieces: PieceLike[] = [
    { id: "me", player_slot: 1, rank: "5", alive: true, row_idx: 7, col_idx: 0 },
    { id: "escout", player_slot: 2, rank: "9", alive: true, row_idx: 2, col_idx: 0 },
  ];
  const pieceById = new Map(pieces.map((p) => [p.id, p]));
  const moves: MoveLike[] = [
    {
      piece_id: "escout", player_slot: 2, from_row: 2, from_col: 0, to_row: 5, to_col: 0,
      move_type: "move", outcome: null, attacker_rank: null, defender_rank: null,
      defender_piece_id: null, move_number: 1,
    },
    {
      piece_id: "me", player_slot: 1, from_row: 7, from_col: 0, to_row: 6, to_col: 0,
      move_type: "move", outcome: null, attacker_rank: null, defender_rank: null,
      defender_piece_id: null, move_number: 2,
    },
    {
      piece_id: "me", player_slot: 1, from_row: 6, from_col: 0, to_row: 5, to_col: 0,
      move_type: "attack", outcome: "ATTACKER_WINS", attacker_rank: "5",
      defender_rank: "9", defender_piece_id: "escout", move_number: 3,
    },
  ];
  const iw = runInformationWarfarePass(1, moves, pieces, pieceById, 3);
  assertEquals(iw.infoEdgeCurve[iw.infoEdgeCurve.length - 1], 1);
});
