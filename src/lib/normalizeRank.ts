import type { Rank } from '../types';

export function normalizeRank(rank: string | number | null | undefined): Rank | null {
  if (rank == null) return null;
  if (rank === "BOMB" || rank === "FLAG") return rank;
  const n = Number(rank);
  if (n >= 1 && n <= 10 && Number.isInteger(n)) return n as Rank;
  return null;
}
