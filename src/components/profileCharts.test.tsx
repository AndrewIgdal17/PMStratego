/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AchievementsGrid } from './AchievementsGrid.tsx';
import { CombatHeatmap } from './CombatHeatmap.tsx';
import { LineChart } from './LineChart.tsx';
import { PieceFate } from './PieceFate.tsx';
import { RadarChart } from './RadarChart.tsx';
import { Sparkline } from './Sparkline.tsx';
import { StatsSections } from './StatsSections.tsx';
import { ACHIEVEMENTS, zeroPlayerStats } from '../lib/profileStats.ts';

afterEach(() => {
  cleanup();
});

describe('profile charts', () => {
  it('hides the radar until a game exists and draws six axes after that', () => {
    const hidden = render(<RadarChart stats={zeroPlayerStats()} />);
    expect(hidden.container.querySelector('.radar-chart')).toBeNull();
    hidden.unmount();

    render(<RadarChart stats={zeroPlayerStats({ wins: 1 })} />);
    expect(screen.getByText('Your Stratego DNA')).toBeTruthy();
    expect(document.querySelectorAll('.radar-chart text')).toHaveLength(6);
  });

  it('paints lakes from the rules module and labels busy squares', () => {
    render(
      <CombatHeatmap
        heatmap={{
          '4,2': { attacks: 9, wins: 9 },
          '0,0': { attacks: 5, wins: 1 },
        }}
      />,
    );
    expect(screen.getByText('5')).toBeTruthy();
    expect(screen.queryByText('9')).toBeNull();
    expect(screen.getByRole('heading', { name: /Combat Heatmap/ })).toBeTruthy();
  });

  it('charts kills and deaths without the flag', () => {
    render(
      <PieceFate
        killsByRank={{ '1': 4, FLAG: 8 }}
        deathsByRank={{ '9': 2 }}
      />,
    );
    expect(screen.getByText('Signature Weapons')).toBeTruthy();
    expect(screen.getByText('Marshal')).toBeTruthy();
    expect(screen.getByText('Scout')).toBeTruthy();
    expect(screen.queryByText('Flag')).toBeNull();
  });

  it('renders memory extras only when the section has data', () => {
    const { container } = render(
      <StatsSections
        stats={zeroPlayerStats({
          memory_scouting: { tags: ['steel_trap'], half_life_moves: 12 },
          phase_career: {
            by_material_state: { behind: { memory_hits_w: 1, memory_misses_w: 1 } },
          },
        })}
      />,
    );
    expect(container.querySelectorAll('details.stats-section')).toHaveLength(11);
    expect(screen.getByText('Steel Trap 🧠')).toBeTruthy();
    expect(screen.getByText('Behind 50%')).toBeTruthy();
    expect(screen.getByText('~12 moves')).toBeTruthy();
  });

  it('lists every achievement from the source map', () => {
    render(<AchievementsGrid achievements={[{ achievement_key: 'kingmaker', unlocked_at: '', game_id: null }]} stats={null} />);
    expect(screen.getAllByText('?')).toHaveLength(ACHIEVEMENTS.length);
    expect(document.querySelectorAll('.achievement-item')).toHaveLength(ACHIEVEMENTS.length);
    expect(document.querySelectorAll('.achievement-item.unlocked')).toHaveLength(1);
  });

  it('flips the sparkline for slot 2 and skips an empty line chart', () => {
    const spark = render(<Sparkline curve={[2, -4]} slot={2} />);
    expect(spark.container.querySelector('.curve-badge')?.textContent).toBe('+4');
    spark.unmount();

    const empty = render(
      <LineChart title="Material Curve" tooltip="Rank-value advantage" series={[]} />,
    );
    expect(empty.queryByText('Material Curve')).toBeNull();
    empty.unmount();

    const chart = render(
      <LineChart title="Material Curve" tooltip="Rank-value advantage" series={[0, 2, -1]} markerIndex={1} />,
    );
    expect(chart.getByText('Material Curve')).toBeTruthy();
    expect(chart.container.querySelectorAll('.detail-curve line')).toHaveLength(2);
  });
});
