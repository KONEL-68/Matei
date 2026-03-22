import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WaitsChart } from '../../components/WaitsChart';

vi.mock('@/lib/auth', () => ({
  authFetch: vi.fn(),
}));

vi.mock('@/lib/theme', () => ({
  useTheme: () => ({ theme: 'dark', setTheme: vi.fn() }),
}));

vi.mock('recharts', () => ({
  BarChart: ({ children }: { children: React.ReactNode }) => <div data-testid="bar-chart">{children}</div>,
  Bar: () => <div data-testid="bar" />,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  Legend: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { authFetch } from '@/lib/auth';
const mockAuthFetch = authFetch as ReturnType<typeof vi.fn>;

function renderWithQuery(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('WaitsChart', () => {
  it('renders nothing when no data', async () => {
    mockAuthFetch.mockResolvedValueOnce({ ok: true, json: async () => [] });
    const { container } = renderWithQuery(<WaitsChart instanceId="1" range="1h" />);
    await new Promise((r) => setTimeout(r, 50));
    expect(container.querySelector('[data-testid="bar-chart"]')).toBeNull();
  });

  it('renders stacked bar chart with data', async () => {
    const data = [
      { bucket: '2026-03-22T10:00:00Z', wait_type: 'CXPACKET', wait_ms_per_sec: 12.5 },
      { bucket: '2026-03-22T10:01:00Z', wait_type: 'CXPACKET', wait_ms_per_sec: 8.0 },
    ];
    mockAuthFetch.mockResolvedValueOnce({ ok: true, json: async () => data });
    renderWithQuery(<WaitsChart instanceId="1" range="1h" />);

    expect(await screen.findByText('Wait Stats Over Time (ms/sec)')).toBeInTheDocument();
    expect(screen.getByTestId('bar-chart')).toBeInTheDocument();
  });

  it('does not fetch when enabled=false', () => {
    mockAuthFetch.mockClear();
    const { container } = renderWithQuery(<WaitsChart instanceId="1" range="1h" enabled={false} />);
    expect(container.querySelector('[data-testid="bar-chart"]')).toBeNull();
    expect(mockAuthFetch).not.toHaveBeenCalled();
  });
});
