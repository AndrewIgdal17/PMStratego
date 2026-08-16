import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { PLAYER_COLOR_HEXES, firstAvailableColor, validateColorClaim } from "./colors.ts";

Deno.test("PLAYER_COLOR_HEXES has exactly 8 unique hexes", () => {
  assertEquals(PLAYER_COLOR_HEXES.length, 8);
  assertEquals(new Set(PLAYER_COLOR_HEXES).size, 8);
});

Deno.test("firstAvailableColor: nothing taken returns the first palette color", () => {
  assertEquals(firstAvailableColor([]), PLAYER_COLOR_HEXES[0]);
});

Deno.test("firstAvailableColor: skips a taken color and returns the next one", () => {
  assertEquals(firstAvailableColor([PLAYER_COLOR_HEXES[0]]), PLAYER_COLOR_HEXES[1]);
});

Deno.test("firstAvailableColor: skips nulls without treating them as taken", () => {
  assertEquals(firstAvailableColor([null, PLAYER_COLOR_HEXES[0]]), PLAYER_COLOR_HEXES[1]);
});

Deno.test("validateColorClaim: rejects when game is not in setup", () => {
  const result = validateColorClaim("active", PLAYER_COLOR_HEXES[2], 1, PLAYER_COLOR_HEXES[0], PLAYER_COLOR_HEXES[1]);
  assertEquals(result, { ok: false, error: "NOT_ALLOWED" });
});

Deno.test("validateColorClaim: rejects a hex not in the palette", () => {
  const result = validateColorClaim("setup", "#000000", 1, PLAYER_COLOR_HEXES[0], PLAYER_COLOR_HEXES[1]);
  assertEquals(result, { ok: false, error: "INVALID_COLOR" });
});

Deno.test("validateColorClaim: rejects a color already committed by the other slot", () => {
  const result = validateColorClaim("setup", PLAYER_COLOR_HEXES[1], 1, PLAYER_COLOR_HEXES[0], PLAYER_COLOR_HEXES[1]);
  assertEquals(result, { ok: false, error: "COLOR_TAKEN" });
});

Deno.test("validateColorClaim: allows re-picking your own current color as a no-op", () => {
  const result = validateColorClaim("setup", PLAYER_COLOR_HEXES[0], 1, PLAYER_COLOR_HEXES[0], PLAYER_COLOR_HEXES[1]);
  assertEquals(result, { ok: true });
});

Deno.test("validateColorClaim: allows claiming a free, never-before-taken color", () => {
  const result = validateColorClaim("setup", PLAYER_COLOR_HEXES[2], 1, PLAYER_COLOR_HEXES[0], PLAYER_COLOR_HEXES[1]);
  assertEquals(result, { ok: true });
});

Deno.test("validateColorClaim: works symmetrically for slot 2 against slot 1's color", () => {
  const result = validateColorClaim("setup", PLAYER_COLOR_HEXES[0], 2, PLAYER_COLOR_HEXES[0], PLAYER_COLOR_HEXES[1]);
  assertEquals(result, { ok: false, error: "COLOR_TAKEN" });
});
