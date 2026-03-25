import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OverviewMetricCharts } from '../../components/OverviewMetricCharts';

vi.mock('@/lib/auth', () => ({
  authFetch: vi.fn(async () => ({ ok: true, json: async () => [] })),
}));

import { authFetch } from '@/lib/auth';
const mockAuthFetch = vi.mocked(authFetch);

vi.mock('@/lib/theme', () => ({
  useTheme: () => ({ theme: 'light', toggleTheme: vi.fn() }),
}));

vi.mock('recharts', () => ({
  LineChart: ({ children }: { children: React.ReactNode }) => <div data-testid="line-chart">{children}</div>,
  BarChart: ({ children }: { children: React.ReactNode }) => <div data-testid="bar-chart">{children}</div>,
  Line: () => null,
  Bar: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  Legend: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

function renderWithQuery(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('OverviewMetricCharts', () => {
  it('renders the container with data-testid', () => {
    renderWithQuery(<OverviewMetricCharts instanceId="1" window={null} />);
    expect(screen.getByTestId('overview-metric-charts')).toBeInTheDocument();
  });

  it('shows empty panels when no data is returned', async () => {
    renderWithQuery(<OverviewMetricCharts instanceId="1" window={null} />);
    // When API returns [], each chart shows "No data"
    const noDataElements = await screen.findAllByText('No data');
    expect(noDataElements).toHaveLength(4);
  });

  it('renders all four chart panel titles', async () => {
    renderWithQuery(<OverviewMetricCharts instanceId="1" window={null} />);
    expect(await screen.findByText('CPU Utilization (%)')).toBeInTheDocument();
    expect(screen.getByText('SQL Memory (GB)')).toBeInTheDocument();
    expect(screen.getByText('Wait Stats (ms/sec)')).toBeInTheDocument();
    expect(screen.getByText('Throughput (MB/s)')).toBeInTheDocument();
  });

  it('passes time window params when provided', () => {
    mockAuthFetch.mockClear();

    renderWithQuery(
      <OverviewMetricCharts
        instanceId="42"
        window={{ from: '2026-03-22T10:00:00Z', to: '2026-03-22T11:00:00Z' }}
      />,
    );

    // Verify authFetch was called with time window params
    const urlsCalled = mockAuthFetch.mock.calls.map((c) => c[0] as string);
    const hasCpuWithWindow = urlsCalled.some(
      (url) => url.includes('/cpu') && url.includes('from=') && url.includes('to='),
    );
    expect(hasCpuWithWindow).toBe(true);
  });
});
