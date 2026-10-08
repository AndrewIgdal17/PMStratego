/**
 * @vitest-environment jsdom
 */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PieceCareers, type PieceCareer } from './PieceCareers.tsx';

function piece(overrides: Partial<PieceCareer> & Pick<PieceCareer, 'rank' | 'kills' | 'moves_made'>): PieceCareer {
  return {
    player_slot: 1,
    distance: 1,
    alive: true,
    death_move: null,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

function killCells(container: HTMLElement): string[] {
  return [...container.querySelectorAll('tbody tr')].map((row) => row.children[1]?.textContent ?? '');
}

describe('PieceCareers', () => {
  it('keeps standouts for the viewed slot, ranked by kills then moves', () => {
    const { container } = render(
      <PieceCareers
        slot={1}
        careers={[
          piece({ rank: '8', kills: 0, moves_made: 9 }),
          piece({ rank: '9', kills: 0, moves_made: 10, distance: 30, alive: true }),
          piece({ rank: '1', kills: 2, moves_made: 4, distance: 12, alive: false, death_move: 20 }),
          piece({ rank: '2', kills: 2, moves_made: 11, distance: 3 }),
          piece({ player_slot: 2, rank: '3', kills: 9, moves_made: 9 }),
          piece({ rank: 'ZZ', kills: 1, moves_made: 0 }),
        ]}
      />,
    );

    const rows = [...container.querySelectorAll('tbody tr')];
    expect(rows.map((row) => row.children[0]?.textContent)).toEqual(['General', 'Marshal', 'ZZ', 'Scout']);
    expect(rows[1]?.children[2]?.textContent).toBe('4');
    expect(rows[1]?.children[3]?.textContent).toBe('12 sq');
    expect(rows[1]?.children[4]?.textContent).toBe('Died move 20');
    expect(rows[3]?.children[4]?.textContent).toBe('Survived');
    expect(container.textContent).not.toContain('Colonel');
    expect(container.textContent).not.toContain('Miner');
  });

  it('shows at most twelve notable pieces and hides an empty table', () => {
    const careers = Array.from({ length: 13 }, (_, index) =>
      piece({ rank: '9', kills: 20 - index, moves_made: 1 }),
    );
    const view = render(<PieceCareers slot={1} careers={careers} />);
    expect(view.container.querySelectorAll('tbody tr')).toHaveLength(12);
    expect(killCells(view.container)).toEqual(['20', '19', '18', '17', '16', '15', '14', '13', '12', '11', '10', '9']);
    view.unmount();

    const empty = render(<PieceCareers slot={1} careers={[piece({ rank: '8', kills: 0, moves_made: 3 })]} />);
    expect(empty.container.querySelector('table')).toBeNull();
  });
});
