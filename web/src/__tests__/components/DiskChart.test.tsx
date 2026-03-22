import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DiskChart } from '../../components/DiskChart';

vi.mock('@/lib/auth', () => ({
  authFetch: vi.fn(),
}));

vi.mock('@/lib/theme', () => ({
  useTheme: () => ({ theme: 'light', setTheme: vi.fn() }),
}));

vi.mock('recharts', () => ({
  LineChart: ({ children }: { children: React.ReactNode }) => <div data-testid="disk-line-chart">{children}</div>,
  Line: () => <div />,
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

describe('DiskChart', () => {
  it('renders nothing for 1h range', () => {
    const { container } = renderWithQuery(<DiskChart instanceId="1" range="1h" />);
    expect(container.querySelector('[data-testid="disk-line-chart"]')).toBeNull();
  });

  it('renders chart for 6h range with data', async () => {
    const data = [
      { bucket: '2026-03-22T10:00:00Z', volume_mount_point: 'C:\\', used_pct: 60 },
      { bucket: '2026-03-22T10:05:00Z', volume_mount_point: 'C:\\', used_pct: 61 },
    ];
    mockAuthFetch.mockResolvedValueOnce({ ok: true, json: async () => data });
    renderWithQuery(<DiskChart instanceId="1" range="6h" />);

    expect(await screen.findByText('Disk Usage Over Time (%)')).toBeInTheDocument();
    expect(screen.getByTestId('disk-line-chart')).toBeInTheDocument();
  });
});
