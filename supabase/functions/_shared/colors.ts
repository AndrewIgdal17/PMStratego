// Server-side copy of the 8-swatch palette rendered by web/js/setup.js's
// PLAYER_COLORS. Deliberately duplicated (not cross-imported) -- it's an
// 8-item hex list, and this keeps the Edge Function runtime free of any
// dependency on the frontend bundle.
export const PLAYER_COLOR_HEXES = [
  "#4a7a4a",
  "#3a5a8a",
  "#6a4a8a",
  "#3a7a7a",
  "#8a7a3a",
  "#8a3a4a",
  "#5a6a7a",
  "#8a6a3a",
] as const;

export function firstAvailableColor(taken: (string | null)[]): string {
  return PLAYER_COLOR_HEXES.find((hex) => !taken.includes(hex)) ?? PLAYER_COLOR_HEXES[0];
}

export type ColorClaimError = "NOT_ALLOWED" | "INVALID_COLOR" | "COLOR_TAKEN";
export type ColorClaimResult = { ok: true } | { ok: false; error: ColorClaimError };

export function validateColorClaim(
  status: string,
  requestedHex: string,
  ownSlot: 1 | 2,
  player1Color: string | null,
  player2Color: string | null,
): ColorClaimResult {
  if (status !== "setup") {
    return { ok: false, error: "NOT_ALLOWED" };
  }

  if (!(PLAYER_COLOR_HEXES as readonly string[]).includes(requestedHex)) {
    return { ok: false, error: "INVALID_COLOR" };
  }

  const ownColor = ownSlot === 1 ? player1Color : player2Color;
  const otherColor = ownSlot === 1 ? player2Color : player1Color;

  if (requestedHex === ownColor) {
    return { ok: true };
  }

  if (requestedHex === otherColor) {
    return { ok: false, error: "COLOR_TAKEN" };
  }

  return { ok: true };
}
