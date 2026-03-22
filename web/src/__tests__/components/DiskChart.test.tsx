import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DiskChart, linearRegression, daysUntilFull } from '../../components/DiskChart';

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

describe('daysUntilFull', () => {
  it('returns null for flat/decreasing trend', () => {
    const points = [
      { x: 0, y: 50 },
      { x: 86400000, y: 50 },
    ];
    expect(daysUntilFull(points)).toBeNull();
  });

  it('returns correct days for increasing trend', () => {
    // Goes from 50% to 60% in 1 day → 10%/day → 40% remaining → 4 days
    const day = 86400000;
    const points = [
      { x: 0, y: 50 },
      { x: day, y: 60 },
    ];
    const days = daysUntilFull(points);
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
