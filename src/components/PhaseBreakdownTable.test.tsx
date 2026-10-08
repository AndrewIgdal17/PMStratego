/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PhaseBreakdownTable } from './PhaseBreakdownTable.tsx';

const q1 = {
  reveal_wins: 1,
  reveal_attacks: 2,
  trade_sum: 3,
  trade_count: 2,
  attack_wins: 1,
  attacks: 4,
  avenge_kills: 1,
  avenge_opportunities: 2,
};

const emptyBin = {
  reveal_wins: 0,
  reveal_attacks: 0,
  trade_sum: 0,
  trade_count: 0,
  attack_wins: 0,
  attacks: 0,
  avenge_kills: 0,
  avenge_opportunities: 0,
};

afterEach(() => {
  cleanup();
});

describe('PhaseBreakdownTable', () => {
  it('formats a present quarter and dashes a missing one', () => {
    render(
      <PhaseBreakdownTable
        slot={1}
        phaseStats={{
          slot1: { by_capture_quarter: { q1, q2: emptyBin } },
        }}
      />,
    );

    expect(screen.getByText('Q1').closest('tr')?.textContent).toBe('Q150%1.525%50%4');
    expect(screen.getByText('Q2').closest('tr')?.textContent).toBe('Q2\u2014\u2014\u2014\u20140');
    expect(screen.getByText('Q3').closest('tr')?.textContent).toBe('Q3\u2014\u2014\u2014\u2014\u2014');
    expect(screen.getByText('Q4').closest('tr')?.textContent).toBe('Q4\u2014\u2014\u2014\u2014\u2014');
    expect(screen.getByRole('heading', { name: /Phase Breakdown/ })).toBeTruthy();
  });

  it('renders nothing when by_capture_quarter is missing', () => {
    const missing = render(<PhaseBreakdownTable slot={1} phaseStats={{ slot1: {} }} />);
    expect(missing.container.querySelector('table')).toBeNull();
    expect(missing.container.querySelector('h3')).toBeNull();
    missing.unmount();

    const otherSlot = render(
      <PhaseBreakdownTable slot={2} phaseStats={{ slot1: { by_capture_quarter: { q1 } } }} />,
    );
    expect(otherSlot.container.querySelector('table')).toBeNull();
    otherSlot.unmount();

    const absent = render(<PhaseBreakdownTable slot={1} phaseStats={null} />);
    expect(absent.container.querySelector('table')).toBeNull();
  });
});
