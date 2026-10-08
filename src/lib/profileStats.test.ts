import { describe, expect, it } from 'vitest';
import {
  ACHIEVEMENTS,
  EMPTY_STAT,
  achievementHint,
  buildStatSections,
  fateBars,
  historyMark,
  mapPool,
  memoryCountDisplay,
  memoryPhasePercent,
  memoryScoreDisplay,
  phaseBreakdownVisible,
  radarAxes,
  showRadar,
  zeroPlayerStats,
} from './profileStats.ts';

function valueOf(label: string, stats = zeroPlayerStats()): string | number {
  const item = buildStatSections(stats)
    .flatMap((section) => section.items)
    .find((entry) => entry.label === label);
  if (!item) throw new Error(`missing stat ${label}`);
  return item.value;
}

describe('buildStatSections', () => {
  it('returns every profile section and keeps ratio stats blank at zero', () => {
    const sections = buildStatSections(zeroPlayerStats());
    expect(sections.map((section) => section.title)).toEqual([
      'Core',
      'Combat Intelligence',
      'Strategic Profile',
      'Fog & Intelligence',
      'Combat Economy',
      'Information Warfare',
      'Memory & Deduction',
      'Endgame & Clutch',
      'Records',
      'Board Geography',
      'Tempo & Rhythm',
    ]);
    expect(sections.reduce((sum, section) => sum + section.items.length, 0)).toBeGreaterThanOrEqual(36);
    expect(sections.find((section) => section.extra === 'memory')?.title).toBe('Memory & Deduction');

    for (const label of [
      'Avg Game Length',
      'Spy Success Rate',
      'Bomb Efficiency',
      'Miner Survival',
      'First Blood %',
      'Initiative Ratio',
      'Aggression Index',
      'Deep Strike Rate',
      'Reveal Efficiency',
      'Unknown Pressure',
      'First-Reveal Conversion',
      'Scout Tempo',
      'Spy Timing',
      'Trade Efficiency',
      'Avenge Rate',
      'Comeback Record',
      'Stillness Ratio',
      'Info Exchange Rate',
      'Deduction Latency',
      'Bluff Bait Rate',
      'Reveal Half-Life',
      'Ambush Yield',
      'Scout Discipline',
      'Marathon Win Rate',
      'Win by Flag %',
      'Flank Preference',
      'Lake Corridor',
      'Defense Depth',
      'Combat Cadence',
      'Opening Speed',
      'Endgame Acceleration',
    ]) {
      expect(valueOf(label), label).toBe(EMPTY_STAT);
    }
    expect(valueOf('Wins')).toBe(0);
    expect(valueOf('Marshal Showdowns')).toBe('0/0');
    expect(valueOf('Fastest Win')).toBe(EMPTY_STAT);
    expect(valueOf('Most Captures (1 game)')).toBe(EMPTY_STAT);
  });

  it('computes guarded ratios once the denominators are positive', () => {
    const stats = zeroPlayerStats({
      wins: 1,
      losses: 1,
      total_moves_all_games: 10,
      spy_combats: 4,
      spy_kills: 1,
      total_moves: 8,
      forward_moves: 2,
      scout_moves: 4,
      scout_self_reveal_events: 1,
      flank_left_moves: 1,
      flank_right_moves: 3,
      endgame_accel_early: 1,
      endgame_accel_late: 3,
      memory_hits: 4,
      memory_misses: 1,
      memory_hits_w: 8,
      memory_misses_w: 2,
    });
    expect(valueOf('Avg Game Length', stats)).toBe(5);
    expect(valueOf('Spy Success Rate', stats)).toBe('25%');
    expect(valueOf('Aggression Index', stats)).toBe('25%');
    expect(valueOf('Scout Discipline', stats)).toBe('75%');
    expect(valueOf('Flank Preference', stats)).toBe('25% Left');
    expect(valueOf('Endgame Acceleration', stats)).toBe('75% in final quarter');
    expect(valueOf('Memory Score', stats)).toBe('80% (4/5 correct)');
  });
});

describe('memory displays', () => {
  it('hides scores until five tests and falls back to the unweighted rate', () => {
    expect(memoryScoreDisplay(0, 0, 4, 0)).toEqual({ text: EMPTY_STAT, insufficient: true });
    expect(memoryCountDisplay(2, 2).insufficient).toBe(true);
    expect(memoryScoreDisplay(0, 0, 5, 0)).toEqual({ text: '100% (5/5 correct)', insufficient: false });
    expect(memoryPhasePercent(undefined)).toBe(EMPTY_STAT);
    expect(memoryPhasePercent({ memory_hits_w: 1, memory_misses_w: 1 })).toBe('50%');
    expect(phaseBreakdownVisible(null)).toBe(false);
    expect(
      phaseBreakdownVisible({ by_material_state: { behind: { memory_hits_w: 1, memory_misses_w: 0 } } }),
    ).toBe(true);
  });
});

describe('radarAxes', () => {
  it('stays hidden with no games and clamps the material axis', () => {
    expect(showRadar(null)).toBe(false);
    expect(showRadar(zeroPlayerStats())).toBe(false);
    expect(showRadar(zeroPlayerStats({ wins: 1 }))).toBe(true);

    const quiet = radarAxes(zeroPlayerStats({ wins: 1 }));
    expect(quiet.find((axis) => axis.label === 'Endgame')?.value).toBe(0.5);
    expect(quiet.find((axis) => axis.label === 'Material')?.value).toBe(0.5);

    const hot = radarAxes(zeroPlayerStats({ trade_efficiency_count: 1, trade_efficiency_sum: 20 }));
    const cold = radarAxes(zeroPlayerStats({ trade_efficiency_count: 1, trade_efficiency_sum: -20 }));
    expect(hot.find((axis) => axis.label === 'Material')?.value).toBe(1);
    expect(cold.find((axis) => axis.label === 'Material')?.value).toBe(0);
  });
});

describe('achievements and piece fate', () => {
  it('keeps the full achievement map and only hints locked career goals', () => {
    expect(ACHIEVEMENTS).toHaveLength(21);
    expect(new Set(ACHIEVEMENTS.map((entry) => entry.key)).size).toBe(21);
    const stats = zeroPlayerStats({
      career_kingmakers: 2,
      max_comeback_deficit: 9,
      career_rival_wins: { a: 1, b: 4 },
    });
    expect(achievementHint('serial_killer', stats, false)).toBe('2/3 spy kills');
    expect(achievementHint('serial_killer', stats, true)).toBeNull();
    expect(achievementHint('counterpunch', stats, false)).toBe('Best: 9/15 pts');
    expect(achievementHint('rival_hunter', stats, false)).toBe('4/5 vs top rival');
    expect(achievementHint('kingmaker', stats, false)).toBeNull();
  });

  it('drops flags and refuses to divide by a zero max', () => {
    expect(fateBars({ FLAG: 9, '1': 3, '9': 1 }).map((bar) => bar.label)).toEqual(['Marshal', 'Scout']);
    expect(fateBars({ '1': 0, BOMB: 0 })).toEqual([]);
    const [top] = fateBars({ '10': 2, '8': 4 });
    expect(top?.label).toBe('Miner');
    expect(top?.widthPct).toBe(100);
  });
});

describe('historyMark', () => {
  it('treats a missing winner as a draw', () => {
    expect(historyMark({ player_slot: 1, winner_slot: 1 })).toBe('W');
    expect(historyMark({ player_slot: 1, winner_slot: 2 })).toBe('L');
    expect(historyMark({ player_slot: 2, winner_slot: null })).toBe('D');
  });
});

describe('mapPool', () => {
  it('caps in-flight work at the limit', async () => {
    let active = 0;
    let maxActive = 0;
    const started: number[] = [];
    const release: Array<() => void> = [];
    const pending = mapPool([0, 1, 2, 3, 4, 5, 6, 7], 5, async (item) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      started.push(item);
      await new Promise<void>((resolve) => {
        release.push(resolve);
      });
      active -= 1;
      return item;
    });

    expect(started).toEqual([0, 1, 2, 3, 4]);
    expect(maxActive).toBe(5);

    release.shift()?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(started).toEqual([0, 1, 2, 3, 4, 5]);
    expect(maxActive).toBe(5);

    for (let wave = 0; wave < 4; wave += 1) {
      const batch = release.splice(0);
      for (const resolve of batch) resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    await expect(pending).resolves.toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(maxActive).toBe(5);
  });
});
