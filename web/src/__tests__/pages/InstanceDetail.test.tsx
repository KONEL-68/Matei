import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { InstanceDetail } from '../../pages/InstanceDetail';

vi.mock('@/lib/theme', () => ({
  useTheme: () => ({ theme: 'light', setTheme: vi.fn() }),
}));

vi.mock('recharts', () => ({
  LineChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AreaChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  BarChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ComposedChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Line: () => null,
  Area: () => null,
  Bar: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  Legend: () => null,
  ReferenceLine: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/lib/auth', () => ({
  authFetch: vi.fn(async (url: string) => {
    if (url.includes('/host-info')) {
      return {
        ok: true,
        json: async () => ({
          host_platform: 'Linux',
          host_distribution: 'Ubuntu 22.04',
          host_release: '5.15.0',
          host_service_pack_level: '',
        }),
      };
    }
    if (url.includes('/health')) {
      return {
        ok: true,
        json: async () => ({
          instance_name: 'PROD-SQL1',
          edition: 'Enterprise',
          version: '16.0.4135.4',
          sp_level: '',
          uptime_seconds: 86400,
          cpu_count: 8,
          physical_memory_mb: 32768,
          committed_mb: 16384,
          target_mb: 24576,
          hadr_enabled: false,
          is_clustered: false,
          sqlserver_start_time: '2026-03-21T00:00:00Z',
          collected_at: '2026-03-22T00:00:00Z',
          instance: { name: 'PROD-SQL1', host: 'sql1', port: 1433, status: 'online', last_seen: '2026-03-22' },
        }),
      };
    }
    if (url.includes('/disk-usage')) {
      return {
        ok: true,
        json: async () => [
          {
            volume_mount_point: 'C:\\', logical_volume_name: 'OS', total_mb: 512000, available_mb: 200000, used_mb: 312000, used_pct: 60.9,
            avg_read_latency_ms: 1.2, avg_write_latency_ms: 2.5, transfers_per_sec: 100,
            sparklines: { read_latency: [], write_latency: [], transfers: [] },
          },
          {
            volume_mount_point: 'D:\\', logical_volume_name: 'Data', total_mb: 1024000, available_mb: 50000, used_mb: 974000, used_pct: 95.1,
            avg_read_latency_ms: 5.0, avg_write_latency_ms: 10.0, transfers_per_sec: 200,
            sparklines: { read_latency: [], write_latency: [], transfers: [] },
          },
        ],
      };
    }
    if (url.includes('/disk')) {
      return { ok: true, json: async () => [] };
    }
    if (url.includes('/file-io')) {
      return {
        ok: true,
        json: async () => [
          { database_name: 'MyDB', file_name: 'MyDB.mdf', file_type: 'ROWS', total_reads: 5000, total_writes: 1000, avg_read_latency_ms: 55.2, avg_write_latency_ms: 3.1 },
        ],
      };
    }
    if (url.includes('/memory/breakdown')) {
      return {
        ok: true,
        json: async () => ({
          total_mb: 16384,
          target_mb: 14336,
          stolen_mb: 3096,
          database_cache_mb: 6800,
          deficit_mb: 2048,
        }),
      };
    }
    if (url.includes('/perf-counters')) {
      return {
        ok: true,
        json: async () => ({
          latest: [
            { counter_name: 'Batch Requests/sec', cntr_value: 150 },
            { counter_name: 'User Connections', cntr_value: 42 },
            { counter_name: 'Deadlocks/sec', cntr_value: 0 },
            { counter_name: 'Page life expectancy', cntr_value: 5000 },
          ],
          series: [],
        }),
      };
    }
    if (url.includes('/blocking-chains')) {
      return { ok: true, json: async () => [] };
    }
    if (url.includes('/deadlocks')) {
      return { ok: true, json: async () => [] };
    }
    if (url.includes('/waits')) {
      return { ok: true, json: async () => [{ wait_type: 'CXPACKET', wait_ms_per_sec: 5.2, wait_time_ms: 10000 }] };
    }
    if (url.includes('/cpu')) {
      return { ok: true, json: async () => [{ sql_cpu_pct: 45, other_process_cpu_pct: 10, system_idle_pct: 45, collected_at: '2026-03-22T10:00:00Z' }] };
    }
    // memory, sessions
    return { ok: true, json: async () => [] };
  }),
}));

function renderDetail(initialPath = '/instances/1') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/instances/:id" element={<InstanceDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('InstanceDetail', () => {
  it('renders overview timeline on History tab', async () => {
    renderDetail();
    expect(await screen.findByText('PROD-SQL1')).toBeInTheDocument();
    // Overview timeline controls are rendered (overview range + window buttons)
    expect(screen.getByTestId('status-bar')).toBeInTheDocument();
  });

  it('renders status bar with sticky container', async () => {
    renderDetail();
    const stickyContainer = await screen.findByTestId('sticky-statusbar');
    expect(stickyContainer).toBeInTheDocument();
    expect(stickyContainer.className).toContain('sticky');
    expect(stickyContainer.className).toContain('z-10');
    expect(stickyContainer.className).toContain('bg-gray-950');
    expect(screen.getByTestId('status-bar')).toBeInTheDocument();
  });

  it('renders compact disk card in grid', async () => {
    renderDetail();
    expect(await screen.findByText('Disks')).toBeInTheDocument();
  });

  it('disk card shows free GB of total GB', async () => {
    renderDetail();
    // C:\ mock: available_mb=200000 → 200000/1024=195.31 GB free of 512000/1024=500.00 GB
    expect(await screen.findByText(/195\.31 GB free of 500\.00 GB/)).toBeInTheDocument();
    // D:\ mock: available_mb=50000 → 50000/1024=48.83 GB free of 1024000/1024=1000.00 GB
    expect(screen.getByText(/48\.83 GB free of 1000\.00 GB/)).toBeInTheDocument();
  });

  it('renders instance header with name and version', async () => {
    renderDetail();
    expect(await screen.findByText('PROD-SQL1')).toBeInTheDocument();
    expect(screen.getAllByText('16.0.4135.4').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Enterprise').length).toBeGreaterThanOrEqual(1);
  });

  it('renders collapsible sections in correct order on History tab', async () => {
    renderDetail();
    expect(await screen.findByTestId('analysis-section')).toBeInTheDocument();
    expect(screen.getByText('Disks')).toBeInTheDocument();
    expect(screen.getByText('Blocking')).toBeInTheDocument();
    expect(screen.getByText('Databases')).toBeInTheDocument();
  });

  it('renders overview metric charts section', async () => {
    renderDetail();
    expect(await screen.findByTestId('overview-metric-charts')).toBeInTheDocument();
  });

  it('Query Explorer button is in header, not a standalone link', async () => {
    renderDetail();
    const btn = await screen.findByTestId('query-explorer-header');
    expect(btn).toBeInTheDocument();
    expect(btn.tagName).toBe('BUTTON');
  });

  it('renders Databases section', async () => {
    renderDetail();
    expect(await screen.findByText('Databases')).toBeInTheDocument();
  });

  // Tab tests
  it('renders History and Current Activity tabs', async () => {
    renderDetail();
    const tabBar = await screen.findByTestId('tab-bar');
    expect(tabBar).toBeInTheDocument();
    expect(screen.getByText('History')).toBeInTheDocument();
    expect(screen.getByText('Current Activity')).toBeInTheDocument();
  });

  it('defaults to History tab showing charts (not Current Activity)', async () => {
    renderDetail();
    expect(await screen.findByText('PROD-SQL1')).toBeInTheDocument();
    expect(screen.queryByTestId('current-activity')).not.toBeInTheDocument();
  });

  it('switches to Current Activity tab', async () => {
    renderDetail();
    await screen.findByText('History');
    fireEvent.click(screen.getByText('Current Activity'));

    expect(screen.getByTestId('current-activity')).toBeInTheDocument();
  });

  it('switches back to History tab', async () => {
    renderDetail();
    await screen.findByText('History');
    fireEvent.click(screen.getByText('Current Activity'));
    expect(screen.getByTestId('current-activity')).toBeInTheDocument();

    fireEvent.click(screen.getByText('History'));
    expect(screen.queryByTestId('current-activity')).not.toBeInTheDocument();
  });

  it('URL param ?tab=current opens Current Activity tab', async () => {
    renderDetail('/instances/1?tab=current');
    expect(await screen.findByTestId('current-activity')).toBeInTheDocument();
  });

  it('StatusBar always visible regardless of tab', async () => {
    renderDetail();
    await screen.findByTestId('status-bar');

    fireEvent.click(screen.getByText('Current Activity'));
    expect(screen.getByTestId('status-bar')).toBeInTheDocument();

    fireEvent.click(screen.getByText('History'));
    expect(screen.getByTestId('status-bar')).toBeInTheDocument();
  });
});
