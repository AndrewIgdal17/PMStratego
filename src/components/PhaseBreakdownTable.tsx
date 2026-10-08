import type { Slot } from '../types.ts';

const DASH = '\u2014';
const QUARTERS = ['q1', 'q2', 'q3', 'q4'] as const;

export interface CaptureQuarterBin {
  reveal_wins?: number;
  reveal_attacks?: number;
  trade_sum?: number;
  trade_count?: number;
  attack_wins?: number;
  attacks?: number | null;
  avenge_kills?: number;
  avenge_opportunities?: number;
}

export interface PhaseStatsSlot {
  by_capture_quarter?: Partial<Record<(typeof QUARTERS)[number], CaptureQuarterBin | null>> | null;
}

export interface PhaseStats {
  slot1?: PhaseStatsSlot | null;
  slot2?: PhaseStatsSlot | null;
}

function pct(num: number | undefined, den: number | null | undefined): string {
  if (den != null && den > 0) return `${(((num ?? 0) / den) * 100).toFixed(0)}%`;
  return DASH;
}

interface PhaseBreakdownTableProps {
  phaseStats?: PhaseStats | null;
  slot: Slot;
}

export function PhaseBreakdownTable({ phaseStats, slot }: PhaseBreakdownTableProps) {
  const quarters = (slot === 1 ? phaseStats?.slot1 : phaseStats?.slot2)?.by_capture_quarter;
  if (!quarters) return null;

  return (
    <div id="game-phase-stats">
      <h3>
        Phase Breakdown{' '}
        <span
          className="stat-help"
          data-tooltip="Metrics binned by capture quartile — Q1 is opening fog, Q4 is endgame. Captures = attack kills + defense kills. Attack WR only counts combats you initiated. Avenge = kill a piece that previously killed yours."
        >
          ?
        </span>
      </h3>
      <table className="history-table phase-table">
        <thead>
          <tr>
            <th>Phase</th>
            <th>Reveal Eff</th>
            <th>Trade Eff</th>
            <th>Attack WR</th>
            <th>Avenge</th>
            <th>Attacks</th>
          </tr>
        </thead>
        <tbody>
          {QUARTERS.map((quarter) => {
            const bin = quarters[quarter];
            if (!bin) {
              return (
                <tr key={quarter}>
                  <td>{quarter.toUpperCase()}</td>
                  <td>{DASH}</td>
                  <td>{DASH}</td>
                  <td>{DASH}</td>
                  <td>{DASH}</td>
                  <td>{DASH}</td>
                </tr>
              );
            }
            return (
              <tr key={quarter}>
                <td>{quarter.toUpperCase()}</td>
                <td>{pct(bin.reveal_wins, bin.reveal_attacks)}</td>
                <td>{bin.trade_count ? ((bin.trade_sum ?? 0) / bin.trade_count).toFixed(1) : DASH}</td>
                <td>{pct(bin.attack_wins, bin.attacks)}</td>
                <td>{pct(bin.avenge_kills, bin.avenge_opportunities)}</td>
                <td>{bin.attacks ?? DASH}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
