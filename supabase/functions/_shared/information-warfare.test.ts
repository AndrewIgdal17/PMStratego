import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  rankBeats,
  ranksTie,
  isCorrectCounter,
  classifyCombatEvent,
  learnPiece,
  createLedger,
  movableRank,
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
