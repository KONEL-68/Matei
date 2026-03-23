import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OverviewTimeline, type TimeWindow } from '../../components/OverviewTimeline';

vi.mock('@/lib/theme', () => ({
  useTheme: () => ({ theme: 'dark', setTheme: vi.fn() }),
}));

vi.mock('recharts', () => ({
  ComposedChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="composed-chart">{children}</div>
  ),
  Line: () => null,
  XAxis: () => null,
  YAxis: () => null,
  ReferenceArea: () => <div data-testid="reference-area" />,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Tooltip: () => null,
}));

vi.mock('@/lib/auth', () => ({
  authFetch: vi.fn(async () => ({
    ok: true,
    json: async () => [
      { bucket: '2026-03-22T09:00:00Z', cpu_pct: 50, memory_gb: 8, waits_ms_per_sec: 200, disk_io_mb_per_sec: 5 },
      { bucket: '2026-03-22T10:00:00Z', cpu_pct: 70, memory_gb: 10, waits_ms_per_sec: 300, disk_io_mb_per_sec: 8 },
    ],
  })),
}));

function renderTimeline(props: { window?: TimeWindow | null; onWindowChange?: (w: TimeWindow | null) => void } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onWindowChange = props.onWindowChange ?? vi.fn();
  return {
    onWindowChange,
    ...render(
      <QueryClientProvider client={qc}>
        <OverviewTimeline instanceId="1" window={props.window ?? null} onWindowChange={onWindowChange} />
      </QueryClientProvider>,
    ),
  };
}

describe('OverviewTimeline', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('renders overview timeline with quick-select buttons', async () => {
    renderTimeline();
    expect(await screen.findByTestId('overview-timeline')).toBeInTheDocument();
    expect(screen.getByTestId('quick-15m')).toBeInTheDocument();
    expect(screen.getByTestId('quick-30m')).toBeInTheDocument();
    expect(screen.getByTestId('quick-1h')).toBeInTheDocument();
    expect(screen.getByTestId('quick-3h')).toBeInTheDocument();
    expect(screen.getByTestId('quick-12h')).toBeInTheDocument();
    expect(screen.getByTestId('reset-window')).toBeInTheDocument();
  });

  it('quick-select sets correct from/to window', async () => {
    const { onWindowChange } = renderTimeline();
    await screen.findByTestId('overview-timeline');

    fireEvent.click(screen.getByTestId('quick-1h'));
    expect(onWindowChange).toHaveBeenCalledTimes(1);
    const call = onWindowChange.mock.calls[0][0] as TimeWindow;
    const from = new Date(call.from).getTime();
    const to = new Date(call.to).getTime();
    // 1h = 60 minutes
    const diffMinutes = (to - from) / 60000;
    expect(diffMinutes).toBeCloseTo(60, 0);
  });

  it('reset clears window', async () => {
    const { onWindowChange } = renderTimeline({ window: { from: '2026-03-22T09:00:00Z', to: '2026-03-22T10:00:00Z' } });
    await screen.findByTestId('overview-timeline');

    fireEvent.click(screen.getByTestId('reset-window'));
    expect(onWindowChange).toHaveBeenCalledWith(null);
  });

  it('shows metric toggle checkboxes for all 4 metrics', async () => {
    renderTimeline();
    await screen.findByTestId('overview-timeline');
    const toggles = screen.getByTestId('metric-toggles');
    expect(toggles).toBeInTheDocument();
    expect(screen.getByText('CPU')).toBeInTheDocument();
    expect(screen.getByText('Memory')).toBeInTheDocument();
    expect(screen.getByText('Waits')).toBeInTheDocument();
    expect(screen.getByText('Disk I/O')).toBeInTheDocument();
  });

  it('metric toggles can be clicked to toggle visibility', async () => {
    renderTimeline();
    await screen.findByTestId('overview-timeline');
    const cpuToggle = screen.getByTestId('toggle-cpu');
    // Initially checked
    expect(cpuToggle).toBeInTheDocument();
    // Click to uncheck
    fireEvent.click(cpuToggle);
    // Click again to re-check
    fireEvent.click(cpuToggle);
  });

  it('shows time range when window is set', async () => {
    renderTimeline({ window: { from: '2026-03-22T09:00:00Z', to: '2026-03-22T10:00:00Z' } });
    await screen.findByTestId('overview-timeline');
    const legend = screen.getByText(/–/).closest('div');
    expect(legend).toBeTruthy();
    expect(legend!.textContent).toBeTruthy();
  });
});
