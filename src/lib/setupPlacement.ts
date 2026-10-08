import type { Placement } from './supabaseClient.ts';
import { ABSOLUTE_ROWS_BY_SLOT } from '../data/formationRowMap.ts';
import { ARMY_COMPOSITION } from '../rules/pieces.ts';
import type { Slot } from '../types.ts';

/** Local setup rows. Index 0 is the row nearest the midline. */
export const LOCAL_ROWS = [0, 1, 2, 3] as const;

export const SETUP_COLS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

/**
 * Client copy of `COUNTDOWN_SECONDS` in `supabase/functions/start-game/index.ts`.
 * The setup screen starts the game this many seconds after `both_submitted_at`.
 */
export const COUNTDOWN_SECONDS = 10;

export function cellKey(localRow: number, localCol: number): string {
  return `${localRow},${localCol}`;
}

export function remainingByRank(placements: ReadonlyMap<string, string>): Map<string, number> {
  const counts = new Map(ARMY_COMPOSITION.map((entry) => [String(entry.rank), entry.count]));
  for (const rank of placements.values()) {
    counts.set(String(rank), (counts.get(String(rank)) ?? 0) - 1);
  }
  return counts;
}

/**
 * Submit payload. Local row 0 is the front. Slot 2 mirrors columns and uses
 * the reversed absolute rows in `ABSOLUTE_ROWS_BY_SLOT`.
 */
export function toAbsolutePlacements(
  placements: ReadonlyMap<string, string>,
  slot: Slot,
): Placement[] {
  const rows = ABSOLUTE_ROWS_BY_SLOT[slot];
  const payload: Placement[] = [];
  for (const [key, rank] of placements) {
    const [rowText, colText] = key.split(',');
    const localRow = Number(rowText);
    const localCol = Number(colText);
    const row = rows[localRow];
    if (row === undefined || Number.isNaN(localCol)) continue;
    const col = slot === 2 ? 9 - localCol : localCol;
    payload.push({ rank, row, col });
  }
  return payload;
}

/**
 * 1-based display row for a local setup row.
 * Display-space labels matching game.js `renderBoard` (`row + 1`) after
 * slot 2's 180° rotation. Both seats' territory is display rows 7–10.
 * Phase 1 Task 10.
 */
export function displayRowLabel(slot: Slot, localRow: number): number {
  const absRow = ABSOLUTE_ROWS_BY_SLOT[slot][localRow];
  if (absRow === undefined) return localRow + 1;
  const displayRow = slot === 2 ? 9 - absRow : absRow;
  return displayRow + 1;
}
