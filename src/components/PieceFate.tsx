import { fateBars, type FateBar } from '../lib/profileStats.ts';

interface PieceFateProps {
  killsByRank: Record<string, number> | null | undefined;
  deathsByRank: Record<string, number> | null | undefined;
}

function FateChart({ title, bars, color }: { title: string; bars: FateBar[]; color: string }) {
  if (bars.length === 0) return null;
  return (
    <div className="fate-chart">
      <h4>{title}</h4>
      {bars.map((bar) => (
        <div key={bar.rank} className="fate-bar-row">
          <span className="fate-label">{bar.label}</span>
          <div className="fate-bar" style={{ width: `${bar.widthPct}%`, background: color }} />
          <span className="fate-count">{bar.count}</span>
        </div>
      ))}
    </div>
  );
}

export function PieceFate({ killsByRank, deathsByRank }: PieceFateProps) {
  if (!killsByRank || Object.keys(killsByRank).length === 0) return null;
  const kills = fateBars(killsByRank);
  const deaths = fateBars(deathsByRank);
  if (kills.length === 0 && deaths.length === 0) return null;

  return (
    <div className="piece-fate-section">
      <details className="stats-section" open>
        <summary>Signature Weapons</summary>
        <div className="fate-grid">
          <FateChart title="You Kill With" bars={kills} color="rgba(100,200,100,0.6)" />
          <FateChart title="You Die To" bars={deaths} color="rgba(200,100,100,0.6)" />
        </div>
      </details>
    </div>
  );
}
