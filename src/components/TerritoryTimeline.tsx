export interface LaneCounts {
  left: number;
  center: number;
  right: number;
  total: number;
}

export interface TerritorySample {
  move_number?: number;
  p1?: LaneCounts;
  p2?: LaneCounts;
  p1_in_enemy?: number;
  p2_in_enemy?: number;
}

export interface NormalizedTerritorySample {
  move_number?: number;
  p1: LaneCounts;
  p2: LaneCounts;
}

const WIDTH = 520;
const HEIGHT = 140;
const PAD = 16;
const LABEL_PAD = 28;
const LEGEND_H = 28;

const LANES = [
  { key: 'left', p1: 'rgba(20,120,70,0.55)', p2: 'rgba(140,40,40,0.55)' },
  { key: 'center', p1: 'rgba(60,170,110,0.5)', p2: 'rgba(190,70,70,0.5)' },
  { key: 'right', p1: 'rgba(130,220,170,0.45)', p2: 'rgba(230,130,130,0.45)' },
] as const;

function hasLanes(sample: TerritorySample): sample is NormalizedTerritorySample {
  return sample.p1 != null && sample.p2 != null;
}

function emptyLanes(total: number): LaneCounts {
  return { left: 0, center: 0, right: 0, total };
}

/** Legacy samples stored only `{ p1_in_enemy, p2_in_enemy }`. Lane charts need totals plus zeroed lanes. */
export function normalizeTerritoryTimeline(timeline: TerritorySample[]): NormalizedTerritorySample[] {
  return timeline.map((sample) => {
    if (hasLanes(sample)) return sample;
    return {
      move_number: sample.move_number,
      p1: emptyLanes(sample.p1_in_enemy ?? 0),
      p2: emptyLanes(sample.p2_in_enemy ?? 0),
    };
  });
}

interface TerritoryTimelineProps {
  timeline: TerritorySample[];
}

export function TerritoryTimeline({ timeline }: TerritoryTimelineProps) {
  if (timeline.length < 2) return null;
  const samples = normalizeTerritoryTimeline(timeline);
  const chartH = HEIGHT - LEGEND_H;
  const maxPieces = Math.max(
    1,
    ...samples.flatMap((sample) => [
      sample.p1.total,
      sample.p2.total,
      sample.p1.left,
      sample.p1.center,
      sample.p1.right,
      sample.p2.left,
      sample.p2.center,
      sample.p2.right,
    ]),
  );
  const yPos = (value: number) => PAD + (1 - value / maxPieces) * (chartH - 2 * PAD);
  const xPos = (index: number) =>
    LABEL_PAD + (index / Math.max(samples.length - 1, 1)) * (WIDTH - LABEL_PAD - PAD);
  const poly = (getter: (sample: NormalizedTerritorySample) => number) =>
    samples.map((sample, index) => `${xPos(index)},${yPos(getter(sample))}`).join(' ');
  const legendY = chartH + 10;

  return (
    <div id="game-territory">
      <h3>
        Territory Control by Lane{' '}
        <span
          className="stat-help"
          data-tooltip="How many of each player's pieces are in the enemy half of the board, broken down by left (cols 0–3), center (cols 4–5), and right (cols 6–9) lanes. Shows flanking maneuvers and corridor control."
        >
          ?
        </span>
      </h3>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="detail-curve">
        <text x="2" y={PAD + 4} fontSize="9" fill="rgba(255,255,255,0.45)">
          {maxPieces}
        </text>
        <text x="2" y={chartH - PAD + 2} fontSize="9" fill="rgba(255,255,255,0.45)">
          0
        </text>
        {LANES.map((lane) => (
          <g key={lane.key}>
            <polyline points={poly((sample) => sample.p1[lane.key])} fill="none" stroke={lane.p1} strokeWidth="1" />
            <polyline points={poly((sample) => sample.p2[lane.key])} fill="none" stroke={lane.p2} strokeWidth="1" />
          </g>
        ))}
        <polyline
          points={poly((sample) => sample.p1.total)}
          fill="none"
          stroke="rgba(100,200,150,0.95)"
          strokeWidth="2.5"
        />
        <polyline
          points={poly((sample) => sample.p2.total)}
          fill="none"
          stroke="rgba(200,100,100,0.95)"
          strokeWidth="2.5"
        />
        <g fontSize="7.5" fill="rgba(255,255,255,0.7)">
          <line x1="28" y1={legendY} x2="42" y2={legendY} stroke="rgba(20,120,70,0.8)" strokeWidth="1.5" />
          <text x="45" y={legendY + 3}>P1 L</text>
          <line x1="72" y1={legendY} x2="86" y2={legendY} stroke="rgba(60,170,110,0.8)" strokeWidth="1.5" />
          <text x="89" y={legendY + 3}>P1 C</text>
          <line x1="116" y1={legendY} x2="130" y2={legendY} stroke="rgba(130,220,170,0.8)" strokeWidth="1.5" />
          <text x="133" y={legendY + 3}>P1 R</text>
          <line x1="160" y1={legendY} x2="174" y2={legendY} stroke="rgba(100,200,150,0.95)" strokeWidth="2.5" />
          <text x="177" y={legendY + 3}>P1 tot</text>
          <line x1="220" y1={legendY} x2="234" y2={legendY} stroke="rgba(140,40,40,0.8)" strokeWidth="1.5" />
          <text x="237" y={legendY + 3}>P2 L</text>
          <line x1="264" y1={legendY} x2="278" y2={legendY} stroke="rgba(190,70,70,0.8)" strokeWidth="1.5" />
          <text x="281" y={legendY + 3}>P2 C</text>
          <line x1="308" y1={legendY} x2="322" y2={legendY} stroke="rgba(230,130,130,0.8)" strokeWidth="1.5" />
          <text x="325" y={legendY + 3}>P2 R</text>
          <line x1="352" y1={legendY} x2="366" y2={legendY} stroke="rgba(200,100,100,0.95)" strokeWidth="2.5" />
          <text x="369" y={legendY + 3}>P2 tot</text>
        </g>
      </svg>
    </div>
  );
}
