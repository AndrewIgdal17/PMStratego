import { labeledChartPoints } from '../lib/chartGeometry.ts';

const WIDTH = 520;
const HEIGHT = 150;
const PAD = 16;
const LABEL_PAD = 36;

interface LineChartProps {
  title: string;
  tooltip: string;
  series: number[];
  markerIndex?: number | null;
}

export function LineChart({ title, tooltip, series, markerIndex }: LineChartProps) {
  if (series.length === 0) return null;
  const { points, zeroY, min, max } = labeledChartPoints(series, WIDTH, HEIGHT, PAD, LABEL_PAD);
  const pointList = points.map((point) => `${point.x},${point.y}`).join(' ');
  const topLabel = max > 0 ? `+${max}` : `${max}`;
  const markerPoint =
    markerIndex != null && markerIndex >= 0 && markerIndex < points.length ? points[markerIndex] : undefined;

  return (
    <div className="line-chart">
      <h3>
        {title}{' '}
        <span className="stat-help" data-tooltip={tooltip}>
          ?
        </span>
      </h3>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="detail-curve">
        <text x="2" y={PAD + 4} fontSize="10" fill="rgba(255,255,255,0.45)">
          {topLabel}
        </text>
        <text x="2" y={HEIGHT - PAD + 2} fontSize="10" fill="rgba(255,255,255,0.45)">
          {min}
        </text>
        <line
          x1={LABEL_PAD}
          y1={zeroY}
          x2={WIDTH - PAD}
          y2={zeroY}
          stroke="rgba(255,255,255,0.25)"
          strokeWidth="0.5"
          strokeDasharray="3,3"
        />
        <polyline
          points={pointList}
          fill="none"
          stroke="rgba(100,200,150,0.9)"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        {markerPoint ? (
          <line
            x1={markerPoint.x}
            y1={PAD}
            x2={markerPoint.x}
            y2={HEIGHT - PAD}
            stroke="rgba(255,200,50,0.7)"
            strokeWidth="1"
            strokeDasharray="3,3"
          />
        ) : null}
      </svg>
    </div>
  );
}
