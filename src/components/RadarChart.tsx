import { radarAxes, showRadar, type PlayerStats } from '../lib/profileStats.ts';

const CX = 100;
const CY = 100;
const RADIUS = 70;

interface RadarChartProps {
  stats: PlayerStats | null;
}

function point(index: number, scale: number, count: number): [number, number] {
  const angle = -Math.PI / 2 + index * ((2 * Math.PI) / count);
  return [CX + RADIUS * scale * Math.cos(angle), CY + RADIUS * scale * Math.sin(angle)];
}

export function RadarChart({ stats }: RadarChartProps) {
  if (!showRadar(stats) || !stats) return null;
  const axes = radarAxes(stats);
  const count = axes.length;
  const rings = [0.25, 0.5, 0.75, 1];

  return (
    <div className="radar-container">
      <h3>Your Stratego DNA</h3>
      <svg viewBox="0 0 200 200" className="radar-chart">
        {rings.map((scale) => (
          <polygon
            key={scale}
            points={Array.from({ length: count }, (_, index) => point(index, scale, count).join(',')).join(' ')}
            fill="none"
            stroke="rgba(255,255,255,0.1)"
            strokeWidth="0.5"
          />
        ))}
        {axes.map((axis, index) => {
          const [endX, endY] = point(index, 1, count);
          const [labelX, labelY] = point(index, 1.2, count);
          return (
            <g key={axis.label}>
              <line
                x1={CX}
                y1={CY}
                x2={endX}
                y2={endY}
                stroke="rgba(255,255,255,0.15)"
                strokeWidth="0.5"
              />
              <text
                x={labelX}
                y={labelY}
                textAnchor="middle"
                dominantBaseline="middle"
                fill="rgba(255,255,255,0.7)"
                fontSize="7"
              >
                {axis.label}
              </text>
            </g>
          );
        })}
        <polygon
          points={axes
            .map((axis, index) => point(index, Math.max(0.05, axis.value), count).join(','))
            .join(' ')}
          fill="rgba(100,200,150,0.25)"
          stroke="rgba(100,200,150,0.8)"
          strokeWidth="1.5"
        />
        {axes.map((axis, index) => {
          const [dotX, dotY] = point(index, Math.max(0.05, axis.value), count);
          return (
            <circle key={axis.label} className="radar-dot" cx={dotX} cy={dotY} r="4" fill="rgba(100,200,150,0.9)">
              <title>{`${axis.label}: ${axis.raw}\n${axis.desc}`}</title>
            </circle>
          );
        })}
      </svg>
    </div>
  );
}
