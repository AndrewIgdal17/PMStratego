import type { HeatCell } from '../lib/profileStats.ts';
import { isLake } from '../rules/board.ts';

const CELL = 22;
const GAP = 2;
const BOARD = CELL * 10 + GAP * 9;

interface CombatHeatmapProps {
  heatmap: Record<string, HeatCell> | null | undefined;
}

export function CombatHeatmap({ heatmap }: CombatHeatmapProps) {
  if (!heatmap || Object.keys(heatmap).length === 0) return null;

  let maxAttacks = 0;
  for (const cell of Object.values(heatmap)) {
    if (cell.attacks > maxAttacks) maxAttacks = cell.attacks;
  }

  const squares = [];
  for (let row = 0; row < 10; row += 1) {
    for (let col = 0; col < 10; col += 1) {
      const key = `${row},${col}`;
      const x = col * (CELL + GAP);
      const y = row * (CELL + GAP);
      if (isLake(row, col)) {
        squares.push(
          <rect key={key} x={x} y={y} width={CELL} height={CELL} fill="rgba(50,80,120,0.4)" rx="2" />,
        );
        continue;
      }

      const data = heatmap[key];
      if (!data || data.attacks === 0) {
        squares.push(
          <rect key={key} x={x} y={y} width={CELL} height={CELL} fill="rgba(255,255,255,0.03)" rx="2" />,
        );
        continue;
      }

      const intensity = maxAttacks > 0 ? data.attacks / maxAttacks : 0;
      const winRate = data.wins / data.attacks;
      const red = Math.round(200 * (1 - winRate) * intensity);
      const green = Math.round(200 * winRate * intensity);
      squares.push(
        <g key={key}>
          <rect
            x={x}
            y={y}
            width={CELL}
            height={CELL}
            fill={`rgba(${red},${green},50,${0.2 + intensity * 0.6})`}
            rx="2"
          />
          {data.attacks >= 3 ? (
            <text
              x={x + CELL / 2}
              y={y + CELL / 2 + 1}
              textAnchor="middle"
              dominantBaseline="middle"
              fill="rgba(255,255,255,0.7)"
              fontSize="7"
            >
              {data.attacks}
            </text>
          ) : null}
        </g>,
      );
    }
  }

  return (
    <div className="heatmap-container">
      <h3>
        Combat Heatmap{' '}
        <span
          className="stat-help"
          data-tooltip="Where your attacks land on the board. Green = high win rate, Red = low win rate. Brighter = more attacks."
        >
          ?
        </span>
      </h3>
      <div className="heatmap-legend">
        <span className="legend-loss">Losses</span>
        <span className="legend-win">Wins</span>
      </div>
      <svg viewBox={`0 0 ${BOARD} ${BOARD}`} className="heatmap-board">
        {squares}
      </svg>
    </div>
  );
}
