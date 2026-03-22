import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FileIoChart } from '../../components/FileIoChart';

vi.mock('@/lib/auth', () => ({
  authFetch: vi.fn(),
}));

vi.mock('@/lib/theme', () => ({
  useTheme: () => ({ theme: 'light', setTheme: vi.fn() }),
}));

vi.mock('recharts', () => ({
  LineChart: ({ children }: { children: React.ReactNode }) => <div data-testid="line-chart">{children}</div>,
  Line: () => <div data-testid="line" />,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  Legend: () => null,
  ReferenceLine: ({ label }: { label?: { value: string } }) => <div data-testid="ref-line">{label?.value}</div>,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { authFetch } from '@/lib/auth';
const mockAuthFetch = authFetch as ReturnType<typeof vi.fn>;

function renderWithQuery(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('FileIoChart', () => {
  it('renders nothing when no data', async () => {
    mockAuthFetch.mockResolvedValueOnce({ ok: true, json: async () => [] });
    const { container } = renderWithQuery(<FileIoChart instanceId="1" range="1h" />);
    await new Promise((r) => setTimeout(r, 50));
    expect(container.querySelector('[data-testid="line-chart"]')).toBeNull();
  });

  it('renders chart with threshold lines', async () => {
    const data = [
      { bucket: '2026-03-22T10:00:00Z', file_key: 'DB/data.mdf', avg_read_latency_ms: 55, avg_write_latency_ms: 3 },
      { bucket: '2026-03-22T10:01:00Z', file_key: 'DB/data.mdf', avg_read_latency_ms: 12, avg_write_latency_ms: 5 },
    ];
    mockAuthFetch.mockResolvedValueOnce({ ok: true, json: async () => data });
    renderWithQuery(<FileIoChart instanceId="1" range="1h" />);

    expect(await screen.findByTestId('line-chart')).toBeInTheDocument();
    // Threshold reference lines
    expect(screen.getByText('20ms')).toBeInTheDocument();
    expect(screen.getByText('50ms')).toBeInTheDocument();
  });
});
