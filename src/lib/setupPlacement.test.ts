import { describe, expect, it } from 'vitest';
import { ARMY_COMPOSITION } from '../rules/pieces.ts';
import {
  cellKey,
  displayRowLabel,
  remainingByRank,
  toAbsolutePlacements,
} from './setupPlacement.ts';

describe('setup placement remap', () => {
  it('keeps slot 1 columns and maps local rows onto 6–9', () => {
    const placements = new Map<string, string>([
      [cellKey(0, 0), 'FLAG'],
      [cellKey(3, 9), 'BOMB'],
    ]);

    expect(toAbsolutePlacements(placements, 1)).toEqual([
      { rank: 'FLAG', row: 6, col: 0 },
      { rank: 'BOMB', row: 9, col: 9 },
    ]);
  });

  it('mirrors slot 2 columns and uses the reversed absolute rows', () => {
    const placements = new Map<string, string>([
      [cellKey(0, 0), '9'],
      [cellKey(3, 9), '1'],
    ]);

    expect(toAbsolutePlacements(placements, 2)).toEqual([
      { rank: '9', row: 3, col: 9 },
      { rank: '1', row: 0, col: 0 },
    ]);
  });

  it('labels both seats as display rows 7–10', () => {
    expect([0, 1, 2, 3].map((row) => displayRowLabel(1, row))).toEqual([7, 8, 9, 10]);
    expect([0, 1, 2, 3].map((row) => displayRowLabel(2, row))).toEqual([7, 8, 9, 10]);
  });

  it('decrements remaining counts as pieces are placed', () => {
    const placements = new Map<string, string>([
      ['0,0', '1'],
      ['0,1', '9'],
    ]);
    const remaining = remainingByRank(placements);
    const marshal = ARMY_COMPOSITION.find((entry) => String(entry.rank) === '1');
    const scout = ARMY_COMPOSITION.find((entry) => String(entry.rank) === '9');
    expect(remaining.get('1')).toBe((marshal?.count ?? 0) - 1);
    expect(remaining.get('9')).toBe((scout?.count ?? 0) - 1);
  });
});
