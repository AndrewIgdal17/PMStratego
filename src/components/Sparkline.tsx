import { labeledChartPoints, perspectiveCurve } from '../lib/chartGeometry.ts';
import type { Slot } from '../types.ts';

const WIDTH = 180;
const HEIGHT = 50;
const PAD = 4;
const LABEL_PAD = 18;

interface SparklineProps {
  curve: number[];
  slot: Slot;
}

export function Sparkline({ curve, slot }: SparklineProps) {
  if (curve.length === 0) return null;
  const data = perspectiveCurve(curve, slot);
  const { points, zeroY, min, max } = labeledChartPoints(data, WIDTH, HEIGHT, PAD, LABEL_PAD);
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return null;

  const pointList = points.map((point) => `${point.x},${point.y}`).join(' ');
  const area = `${first.x},${zeroY} ${pointList} ${last.x},${zeroY}`;
  const finalVal = data[data.length - 1] ?? 0;
  const color = finalVal >= 0 ? '100,200,150' : '200,100,100';
  const topLabel = max > 0 ? `+${max}` : `${max}`;
  const badge = finalVal >= 0 ? `+${finalVal}` : `${finalVal}`;
  const badgeColor = finalVal >= 0 ? '#6c6' : '#c66';

  return (
    <div
      className="curve-container"
      data-tooltip={`Material advantage over ${data.length} combats. Final: ${badge} rank-value.`}
    >
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="material-spark-lg">
        <text x="2" y={PAD + 3} fontSize="5" fill="rgba(255,255,255,0.4)">
          {topLabel}
        </text>
        <text x="2" y={HEIGHT - PAD + 1} fontSize="5" fill="rgba(255,255,255,0.4)">
          {min}
        </text>
        <line
          x1={LABEL_PAD}
          y1={zeroY}
          x2={WIDTH - PAD}
          y2={zeroY}
          stroke="rgba(255,255,255,0.2)"
          strokeWidth="0.5"
          strokeDasharray="2,2"
        />
        <polygon points={area} fill={`rgba(${color},0.1)`} />
        <polyline
          points={pointList}
          fill="none"
          stroke={`rgba(${color},0.8)`}
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
      <span className="curve-badge" style={{ color: badgeColor }}>
        {badge}
      </span>
    </div>
  );
}
