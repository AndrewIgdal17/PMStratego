import type { Slot } from '../types.ts';

export type ChartPoint = { x: number; y: number };

// Shared SVG scale from materialSparkline (gameSummary.js) and renderLineChart
// (gameDetail.js). Domain always includes 0 so the zero line sits inside the
// plot. X uses the same padding on both sides.
export function chartPoints(
  series: number[],
  width: number,
  height: number,
  padding: number,
): { points: ChartPoint[]; zeroY: number; min: number; max: number } {
  const min = Math.min(0, ...series);
  const max = Math.max(0, ...series);
  const range = max - min || 1;
  const yPos = (v: number) => padding + (1 - (v - min) / range) * (height - 2 * padding);
  const points = series.map((v, i) => ({
    x: padding + (i / Math.max(series.length - 1, 1)) * (width - 2 * padding),
    y: yPos(v),
  }));
  return { points, zeroY: yPos(0), min, max };
}

// Sparkline and LineChart leave a wider left gutter for axis labels.
// Y scale stays chartPoints; X is shifted so the right pad is unchanged.
export function labeledChartPoints(
  series: number[],
  width: number,
  height: number,
  padding: number,
  labelPad: number,
): { points: ChartPoint[]; zeroY: number; min: number; max: number } {
  const shift = labelPad - padding;
  const scaled = chartPoints(series, width - shift, height, padding);
  return {
    ...scaled,
    points: scaled.points.map((point) => ({ x: point.x + shift, y: point.y })),
  };
}

// Slot 1 sees the stored player-1 curve. Slot 2 sees the negation.
export function perspectiveCurve(curveP1: number[], slot: Slot): number[] {
  return slot === 1 ? curveP1 : curveP1.map((v) => -v);
}
