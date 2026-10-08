import { describe, it, expect } from 'vitest';
import { normalizeRank } from './normalizeRank';

describe('normalizeRank', () => {
  it('converts string numeric ranks to numbers', () => {
    expect(normalizeRank("1")).toBe(1);
    expect(normalizeRank("10")).toBe(10);
  });
  it('passes through numeric ranks', () => {
    expect(normalizeRank(1)).toBe(1);
  });
  it('passes through BOMB and FLAG as strings', () => {
    expect(normalizeRank("BOMB")).toBe("BOMB");
    expect(normalizeRank("FLAG")).toBe("FLAG");
  });
  it('returns null for null/undefined', () => {
    expect(normalizeRank(null)).toBeNull();
    expect(normalizeRank(undefined)).toBeNull();
  });
});
