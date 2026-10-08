/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { normalizeTerritoryTimeline, TerritoryTimeline } from './TerritoryTimeline.tsx';

afterEach(() => {
  cleanup();
});

describe('normalizeTerritoryTimeline', () => {
  it('keeps lane samples and fills legacy totals into the total lane only', () => {
    const modern = {
      move_number: 4,
      p1: { left: 1, center: 2, right: 0, total: 3 },
      p2: { left: 0, center: 0, right: 1, total: 1 },
    };
    expect(normalizeTerritoryTimeline([modern])[0]).toBe(modern);
    expect(
      normalizeTerritoryTimeline([
        { move_number: 1, p1_in_enemy: 2, p2_in_enemy: undefined },
        { move_number: 2, p1_in_enemy: 0, p2_in_enemy: 4 },
      ]),
    ).toEqual([
      {
        move_number: 1,
        p1: { left: 0, center: 0, right: 0, total: 2 },
        p2: { left: 0, center: 0, right: 0, total: 0 },
      },
      {
        move_number: 2,
        p1: { left: 0, center: 0, right: 0, total: 0 },
        p2: { left: 0, center: 0, right: 0, total: 4 },
      },
    ]);
  });
});

describe('TerritoryTimeline', () => {
  it('draws lane and total lines once there are two samples', () => {
    const hidden = render(
      <TerritoryTimeline timeline={[{ move_number: 1, p1_in_enemy: 1, p2_in_enemy: 1 }]} />,
    );
    expect(hidden.container.querySelector('svg')).toBeNull();
    hidden.unmount();

    const { container } = render(
      <TerritoryTimeline
        timeline={[
          { move_number: 1, p1_in_enemy: 1, p2_in_enemy: 0 },
          { move_number: 2, p1_in_enemy: 3, p2_in_enemy: 2 },
        ]}
      />,
    );
    expect(screen.getByRole('heading', { name: /Territory Control by Lane/ })).toBeTruthy();
    expect(container.querySelectorAll('polyline')).toHaveLength(8);
    const p1Total = container.querySelector('polyline[stroke="rgba(100,200,150,0.95)"]');
    expect(p1Total?.getAttribute('points')).toBe('28,69.33333333333334 504,16');
    expect(container.querySelector('svg text')?.textContent).toBe('3');
    expect(screen.getByText('P1 tot')).toBeTruthy();
    expect(screen.getByText('P2 tot')).toBeTruthy();
  });
});
