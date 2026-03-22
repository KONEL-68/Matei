import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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
    if (url.includes('/disk')) {
      return {
        ok: true,
        json: async () => [
          { volume_mount_point: 'C:\\', logical_volume_name: 'OS', total_mb: 512000, available_mb: 200000, used_mb: 312000, used_pct: 60.9 },
          { volume_mount_point: 'D:\\', logical_volume_name: 'Data', total_mb: 1024000, available_mb: 50000, used_mb: 974000, used_pct: 95.1 },
        ],
      };
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
          sql_committed_mb: 4096,
          sql_target_mb: 8192,
          buffer_pool_mb: 3072,
          plan_cache_mb: 512,
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

function renderDetail() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/instances/1']}>
        <Routes>
          <Route path="/instances/:id" element={<InstanceDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('InstanceDetail', () => {
  it('renders all time range buttons including Custom', async () => {
    renderDetail();
    expect(await screen.findByText('1h')).toBeInTheDocument();
    expect(screen.getByText('6h')).toBeInTheDocument();
    expect(screen.getByText('24h')).toBeInTheDocument();
    expect(screen.getByText('7d')).toBeInTheDocument();
    expect(screen.getByText('30d')).toBeInTheDocument();
    expect(screen.getByText('1y')).toBeInTheDocument();
    expect(screen.getByText('Custom')).toBeInTheDocument();
  });

  it('renders KPI row', async () => {
    renderDetail();
    expect(await screen.findByTestId('kpi-row')).toBeInTheDocument();
  });

  it('renders compact disk card in grid', async () => {
    renderDetail();
    expect(await screen.findByText('Disk Space')).toBeInTheDocument();
  });

  it('renders instance header with name and version', async () => {
    renderDetail();
    expect(await screen.findByText('PROD-SQL1')).toBeInTheDocument();
    expect(screen.getByText('16.0.4135.4')).toBeInTheDocument();
    expect(screen.getByText('Enterprise')).toBeInTheDocument();
  });

  it('renders collapsible sections', async () => {
    renderDetail();
    expect(await screen.findByText('Wait Stats History')).toBeInTheDocument();
    expect(screen.getByText('Active Sessions')).toBeInTheDocument();
    expect(screen.getByText('File I/O')).toBeInTheDocument();
    expect(screen.getByText('Deadlocks')).toBeInTheDocument();
  });

  it('renders SQL Memory Breakdown section', async () => {
    renderDetail();
    expect(await screen.findByText('SQL Memory Breakdown')).toBeInTheDocument();
  });

  it('renders Query Explorer link button', async () => {
    renderDetail();
    const links = await screen.findAllByText(/Query Explorer/);
    expect(links.length).toBeGreaterThanOrEqual(1);
  });
});
