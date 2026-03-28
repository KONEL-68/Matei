import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DiskChart, linearRegression, holtLinearTrend, daysUntilFull } from '../../components/DiskChart';

vi.mock('@/lib/auth', () => ({
  authFetch: vi.fn(),
}));

vi.mock('@/lib/theme', () => ({
  useTheme: () => ({ theme: 'light', setTheme: vi.fn() }),
}));

vi.mock('recharts', () => ({
  ComposedChart: ({ children }: { children: React.ReactNode }) => <div data-testid="disk-chart">{children}</div>,
  LineChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Line: () => null,
  Area: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  Legend: () => null,
  ReferenceLine: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { authFetch } from '@/lib/auth';
const mockAuthFetch = authFetch as ReturnType<typeof vi.fn>;

function renderWithQuery(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('linearRegression', () => {
  it('returns correct slope for increasing data', () => {
    const points = [
      { x: 0, y: 50 },
      { x: 1000, y: 60 },
      { x: 2000, y: 70 },
    ];
    const { slope } = linearRegression(points);
    expect(slope).toBeCloseTo(0.01, 4);
  });

  it('returns zero slope for flat data', () => {
    const points = [
      { x: 0, y: 50 },
      { x: 1000, y: 50 },
      { x: 2000, y: 50 },
    ];
    const { slope } = linearRegression(points);
    expect(slope).toBe(0);
  });
});

describe('holtLinearTrend', () => {
  it('returns zero trend for flat data', () => {
    const day = 86400000;
    const points = [
      { x: 0, y: 50 },
      { x: day, y: 50 },
      { x: day * 2, y: 50 },
    ];
    const { growthPerDay } = holtLinearTrend(points);
    expect(Math.abs(growthPerDay)).toBeLessThan(0.01);
  });

  it('detects positive trend for growing data', () => {
    const day = 86400000;
    const points = [
      { x: 0, y: 50 },
      { x: day, y: 55 },
      { x: day * 2, y: 60 },
      { x: day * 3, y: 65 },
    ];
    const { level, growthPerDay } = holtLinearTrend(points);
    expect(growthPerDay).toBeGreaterThan(0);
    expect(level).toBeGreaterThan(60);
  });

  it('handles single point', () => {
    const { level, trend, growthPerDay } = holtLinearTrend([{ x: 0, y: 42 }]);
    expect(level).toBe(42);
    expect(trend).toBe(0);
    expect(growthPerDay).toBe(0);
  });

  it('handles empty array', () => {
    const { level, trend, growthPerDay } = holtLinearTrend([]);
    expect(level).toBe(0);
    expect(trend).toBe(0);
    expect(growthPerDay).toBe(0);
  });

  it('handles irregular time spacing', () => {
    const day = 86400000;
    const points = [
      { x: 0, y: 50 },
      { x: day, y: 55 },       // +5 in 1 day
      { x: day * 4, y: 70 },   // +15 in 3 days (same rate)
    ];
    const { growthPerDay } = holtLinearTrend(points);
    expect(growthPerDay).toBeGreaterThan(3);
    expect(growthPerDay).toBeLessThan(8);
  });

  it('adapts to accelerating growth', () => {
    const day = 86400000;
    // Growth accelerates: 2, 4, 8 per day — simple average would be ~4.67
    const points = [
      { x: 0, y: 50 },
      { x: day, y: 52 },
      { x: day * 2, y: 56 },
      { x: day * 3, y: 64 },
    ];
    const { growthPerDay } = holtLinearTrend(points);
    // With default smoothing (alpha=0.3, beta=0.1) the trend adapts gradually;
    // it should be above the initial rate of 2%/day
    expect(growthPerDay).toBeGreaterThan(2);
  });
});

describe('daysUntilFull', () => {
  it('returns null days for flat/decreasing trend', () => {
    const points = [
      { x: 0, y: 50 },
      { x: 86400000, y: 50 },
    ];
    expect(daysUntilFull(points).days).toBeNull();
  });

  it('returns correct days for increasing trend', () => {
    // Goes from 50% to 60% in 1 day → 10%/day → 40% remaining → 4 days
    const day = 86400000;
    const points = [
      { x: 0, y: 50 },
      { x: day, y: 60 },
    ];
    const { days } = daysUntilFull(points);
    expect(days).toBe(4);
  });
});

describe('DiskChart', () => {
  it('shows "No disk history data yet" when API returns empty', async () => {
    mockAuthFetch.mockResolvedValueOnce({ ok: true, json: async () => [] });
    renderWithQuery(<DiskChart instanceId="1" range="1h" />);

    // 1h gets upgraded to 7d internally but still returns empty
    expect(await screen.findByText('No disk history data yet')).toBeInTheDocument();
  });

  it('renders chart with forecast labels', async () => {
    const data = [
      { bucket: '2026-03-22T10:00:00Z', volume_mount_point: 'C:\\', used_pct: 60 },
      { bucket: '2026-03-22T10:05:00Z', volume_mount_point: 'C:\\', used_pct: 61 },
    ];
    mockAuthFetch.mockResolvedValueOnce({ ok: true, json: async () => data });
    renderWithQuery(<DiskChart instanceId="1" range="6h" />);

    expect(await screen.findByTestId('disk-chart')).toBeInTheDocument();
  });

  it('shows Stable label for flat data', async () => {
    const data = [
      { bucket: '2026-03-22T10:00:00Z', volume_mount_point: 'C:\\', used_pct: 50 },
      { bucket: '2026-03-22T16:00:00Z', volume_mount_point: 'C:\\', used_pct: 50 },
    ];
    mockAuthFetch.mockResolvedValueOnce({ ok: true, json: async () => data });
    renderWithQuery(<DiskChart instanceId="1" range="7d" />);

    expect(await screen.findByText('Stable')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Edge-case tests
// ---------------------------------------------------------------------------

describe('holtLinearTrend edge cases', () => {
  const DAY = 86_400_000;

  it('detects negative trend for decreasing data', () => {
    const points = [
      { x: 0, y: 80 },
      { x: DAY, y: 75 },
      { x: DAY * 2, y: 70 },
      { x: DAY * 3, y: 65 },
    ];
    const { growthPerDay } = holtLinearTrend(points);
    expect(growthPerDay).toBeLessThan(0);
  });

  it('smooths through noisy data with outliers', () => {
    // Underlying trend: ~1%/day growth, with a big spike on day 3
    const points = [
      { x: 0, y: 50 },
      { x: DAY, y: 51 },
      { x: DAY * 2, y: 52 },
      { x: DAY * 3, y: 80 },  // outlier spike
      { x: DAY * 4, y: 54 },  // back to normal
      { x: DAY * 5, y: 55 },
    ];
    const { growthPerDay } = holtLinearTrend(points);
    // Smoothing should dampen the outlier — trend should not be wildly negative
    // nor reflect the spike; expect a modest value
    expect(growthPerDay).toBeGreaterThan(-10);
    expect(growthPerDay).toBeLessThan(10);
  });

  it('handles large real-world timestamps (~1.7e12)', () => {
    // Timestamps around March 2024
    const base = 1711000000000; // ~2024-03-21
    const points = [
      { x: base, y: 60 },
      { x: base + DAY, y: 62 },
      { x: base + DAY * 2, y: 64 },
      { x: base + DAY * 3, y: 66 },
    ];
    const { growthPerDay, level } = holtLinearTrend(points);
    expect(growthPerDay).toBeGreaterThan(1);
    expect(growthPerDay).toBeLessThan(3);
    expect(level).toBeGreaterThan(63);
    expect(level).toBeLessThan(70);
  });

  it('skips points with zero or negative time delta', () => {
    const points = [
      { x: 0, y: 50 },
      { x: DAY, y: 55 },
      { x: DAY, y: 99 },      // duplicate timestamp — should be skipped
      { x: DAY * 2, y: 60 },
    ];
    const { growthPerDay } = holtLinearTrend(points);
    // The duplicate with y=99 should be ignored; trend should be ~5%/day
    expect(growthPerDay).toBeGreaterThan(3);
    expect(growthPerDay).toBeLessThan(8);
  });
});

describe('daysUntilFull edge cases', () => {
  const DAY = 86_400_000;

  it('returns days: 0 when already at 100%', () => {
    // Need enough growth so growthPerDay > 0.01 to avoid the early null return
    const points = [
      { x: 0, y: 95 },
      { x: DAY, y: 100 },
    ];
    const result = daysUntilFull(points);
    expect(result.days).toBe(0);
  });

  it('returns days: 0 when level exceeds 100%', () => {
    // Holt smoothing with high recent values can push level above 100
    const points = [
      { x: 0, y: 90 },
      { x: DAY, y: 97 },
      { x: DAY * 2, y: 102 },  // simulated overshoot in data
    ];
    const result = daysUntilFull(points);
    expect(result.days).toBe(0);
  });

  it('returns null for very slow growth below 0.01%/day', () => {
    // Growth rate of 0.001%/day (would take 50,000 days)
    const points = [
      { x: 0, y: 50 },
      { x: DAY * 100, y: 50.1 },
    ];
    const result = daysUntilFull(points);
    expect(result.days).toBeNull();
  });

  it('returns null when daysRemaining is not finite', () => {
    // Two identical points produce zero growth
    const points = [
      { x: 0, y: 50 },
      { x: DAY, y: 50 },
    ];
    const result = daysUntilFull(points);
    expect(result.days).toBeNull();
  });

  it('returns null for decreasing trend (negative growth)', () => {
    const points = [
      { x: 0, y: 80 },
      { x: DAY, y: 75 },
      { x: DAY * 2, y: 70 },
    ];
    const result = daysUntilFull(points);
    expect(result.days).toBeNull();
    expect(result.growthPerDay).toBeLessThan(0);
  });
});

describe('linearRegression edge cases', () => {
  it('returns slope 0 and y value for a single point', () => {
    const result = linearRegression([{ x: 1000, y: 42 }]);
    expect(result.slope).toBe(0);
    expect(result.intercept).toBe(42);
  });

  it('returns slope 0 and mean y when all X values are identical (denom === 0)', () => {
    const points = [
      { x: 5000, y: 30 },
      { x: 5000, y: 40 },
      { x: 5000, y: 50 },
    ];
    const result = linearRegression(points);
    expect(result.slope).toBe(0);
    expect(result.intercept).toBe(40); // mean of 30, 40, 50
  });

  it('returns slope 0 and intercept 0 for empty array', () => {
    const result = linearRegression([]);
    expect(result.slope).toBe(0);
    expect(result.intercept).toBe(0);
  });

  it('handles large real-world timestamps without precision loss', () => {
    const base = 1711000000000;
    const points = [
      { x: base, y: 10 },
      { x: base + 1000, y: 20 },
      { x: base + 2000, y: 30 },
    ];
    const result = linearRegression(points);
    expect(result.slope).toBeCloseTo(0.01, 4);
  });
});
