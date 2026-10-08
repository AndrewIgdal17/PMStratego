import type { JSX } from 'react';
import { ARMY_COMPOSITION } from '../rules/pieces.ts';
import { RANK_NAME } from '../types.ts';

interface PieceSidebarProps {
  remaining: ReadonlyMap<string, number>;
  selectedRank: string | null;
  onSelect: (rank: string) => void;
}

export function PieceSidebar({ remaining, selectedRank, onSelect }: PieceSidebarProps): JSX.Element {
  return (
    <aside className="piece-sidebar">
      <h3>Pieces</h3>
      <div id="tray" className="tray">
        {ARMY_COMPOSITION.map((entry) => {
          const rank = String(entry.rank);
          const count = remaining.get(rank) ?? 0;
          const exhausted = count <= 0;
          const selected = !exhausted && selectedRank === rank;
          const className = ['tray-chip', exhausted ? 'exhausted' : '', selected ? 'selected' : '']
            .filter(Boolean)
            .join(' ');
          return (
            <button
              key={rank}
              type="button"
              className={className}
              data-rank={rank}
              disabled={exhausted}
              onClick={() => {
                if (!exhausted) onSelect(rank);
              }}
            >
              {`${RANK_NAME[rank] ?? rank} x${count}`}
            </button>
          );
        })}
      </div>
    </aside>
  );
}
