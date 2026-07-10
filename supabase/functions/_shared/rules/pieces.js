export const RANK = {
  MARSHAL: 1,
  GENERAL: 2,
  COLONEL: 3,
  MAJOR: 4,
  CAPTAIN: 5,
  LIEUTENANT: 6,
  SERGEANT: 7,
  MINER: 8,
  SCOUT: 9,
  SPY: 10,
  BOMB: 'BOMB',
  FLAG: 'FLAG',
};

export const ARMY_COMPOSITION = [
  { rank: RANK.MARSHAL, count: 1 },
  { rank: RANK.GENERAL, count: 1 },
  { rank: RANK.COLONEL, count: 2 },
  { rank: RANK.MAJOR, count: 3 },
  { rank: RANK.CAPTAIN, count: 4 },
  { rank: RANK.LIEUTENANT, count: 4 },
  { rank: RANK.SERGEANT, count: 4 },
  { rank: RANK.MINER, count: 5 },
  { rank: RANK.SCOUT, count: 8 },
  { rank: RANK.SPY, count: 1 },
  { rank: RANK.BOMB, count: 6 },
  { rank: RANK.FLAG, count: 1 },
];

export const ARMY_SIZE = ARMY_COMPOSITION.reduce((sum, entry) => sum + entry.count, 0);

export function isMovableRank(rank) {
  return rank !== RANK.BOMB && rank !== RANK.FLAG;
}
