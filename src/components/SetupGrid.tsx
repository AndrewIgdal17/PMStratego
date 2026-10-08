import type { JSX } from 'react';
import { PieceToken } from './PieceToken.tsx';
import {
  LOCAL_ROWS,
  SETUP_COLS,
  cellKey,
  displayRowLabel,
} from '../lib/setupPlacement.ts';
import type { Slot } from '../types.ts';

interface SetupGridProps {
  placements: ReadonlyMap<string, string>;
  color: string;
  slot: Slot;
  locked: boolean;
  formationLabel: string;
  onCell: (localRow: number, localCol: number) => void;
}

export function SetupGrid({
  placements,
  color,
  slot,
  locked,
  formationLabel,
  onCell,
}: SetupGridProps): JSX.Element {
  return (
    <>
      <p className="grid-label enemy-label">Enemy side</p>
      <p id="formation-label" className="formation-label" hidden={!formationLabel}>
        {formationLabel}
      </p>
      <div className="board-frame setup-frame">
        <div className="board-col-labels" id="setup-col-labels">
          {SETUP_COLS.map((col) => (
            <span key={col}>{String.fromCharCode(65 + col)}</span>
          ))}
        </div>
        <div className="board-inner">
          <div className="board-row-labels" id="setup-row-labels">
            {LOCAL_ROWS.map((row) => (
              <span key={row}>{displayRowLabel(slot, row)}</span>
            ))}
          </div>
          <div
            id="territory-grid"
            className="territory-grid"
            aria-disabled={locked}
            style={{ gridTemplateColumns: `repeat(${SETUP_COLS.length}, 1fr)` }}
          >
            {LOCAL_ROWS.map((row) =>
              SETUP_COLS.map((col) => {
                const rank = placements.get(cellKey(row, col));
                return (
                  <div
                    key={cellKey(row, col)}
                    className={rank ? 'territory-cell occupied' : 'territory-cell'}
                    data-local-row={row}
                    data-local-col={col}
                    onClick={() => {
                      if (locked) return;
                      onCell(row, col);
                    }}
                  >
                    {rank ? <PieceToken rank={rank} isMine color={color} /> : null}
                  </div>
                );
              }),
            )}
          </div>
        </div>
      </div>
      <p className="grid-label back-label">Your back row</p>
    </>
  );
}
