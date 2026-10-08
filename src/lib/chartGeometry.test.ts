import { describe, expect, it } from 'vitest';
import { chartPoints, perspectiveCurve } from './chartGeometry';

describe('perspectiveCurve', () => {
  it('returns the player-1 curve as-is for slot 1', () => {
    const curve = [1, -2, 4];
    expect(perspectiveCurve(curve, 1)).toBe(curve);
  });

  it('negates the curve for slot 2', () => {
    expect(perspectiveCurve([1, -2, 0, 4], 2)).toEqual([-1, 2, -0, -4]);
  });
});

describe('chartPoints', () => {
  it('includes zero in the domain and places the zero line between min and max', () => {
    const { min, max, zeroY, points } = chartPoints([-10, 0, 10], 100, 50, 5);
    expect(min).toBe(-10);
    expect(max).toBe(10);
    // y = pad + (1 - (v - min) / range) * (height - 2*pad)
    // y(-10) = 5 + 40 = 45, y(0) = 5 + 20 = 25, y(10) = 5
    expect(zeroY).toBe(25);
    expect(points.map((p) => p.y)).toEqual([45, 25, 5]);
    expect(points.map((p) => p.x)).toEqual([5, 50, 95]);
    expect(points[0]!.y).toBeGreaterThan(zeroY);
    expect(points[2]!.y).toBeLessThan(zeroY);
  });

  it('keeps min at zero when every value is positive so the zero line is the baseline', () => {
    const { min, max, zeroY, points } = chartPoints([2, 4], 100, 40, 0);
    expect(min).toBe(0);
    expect(max).toBe(4);
    expect(zeroY).toBe(40);
    expect(points[0]?.y).toBe(20);
    expect(points[1]?.y).toBe(0);
  });
});
