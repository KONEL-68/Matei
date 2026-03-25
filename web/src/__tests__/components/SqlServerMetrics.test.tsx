import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SqlServerMetrics } from '../../components/SqlServerMetrics';

vi.mock('@/lib/auth', () => ({
  authFetch: vi.fn(),
}));

vi.mock('@/lib/theme', () => ({
  useTheme: () => ({ theme: 'dark', toggleTheme: () => {} }),
}));

// Mock Recharts to avoid SVG rendering issues in jsdom
vi.mock('recharts', () => ({
  LineChart: ({ children }: { children: React.ReactNode }) => <div data-testid="line-chart">{children}</div>,
  Line: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { authFetch } from '@/lib/auth';
const mockAuthFetch = vi.mocked(authFetch);

const mockPerfData = {
  latest: [
    { counter_name: 'Batch Requests/sec', cntr_value: 150, collected_at: '2026-03-25T10:00:00Z' },
    { counter_name: 'Page life expectancy', cntr_value: 3600, collected_at: '2026-03-25T10:00:00Z' },
  ],
  series: [
    { bucket: '2026-03-25T09:50:00Z', counter_name: 'Batch Requests/sec', cntr_value: 120 },
    { bucket: '2026-03-25T09:51:00Z', counter_name: 'Batch Requests/sec', cntr_value: 140 },
    { bucket: '2026-03-25T09:50:00Z', counter_name: 'Page life expectancy', cntr_value: 3500 },
    { bucket: '2026-03-25T09:51:00Z', counter_name: 'Page life expectancy', cntr_value: 3600 },
  ],
};

const mockServerConfig = {
  server_collation: 'SQL_Latin1_General_CP1_CI_AS',
  xp_cmdshell: 0,
  clr_enabled: 1,
  external_scripts_enabled: 0,
  remote_access: 1,
  max_degree_of_parallelism: 4,
  max_server_memory_mb: 16384,
  cost_threshold_for_parallelism: 50,
};

const defaultProps = {
  instanceId: '1',
  range: { from: '2026-03-25T09:00:00Z', to: '2026-03-25T10:00:00Z' },
  health: { version: 'Microsoft SQL Server 2022', edition: 'Enterprise Edition' },
};

function renderComponent(props = defaultProps) {
  mockAuthFetch.mockImplementation(async (url: string) => {
    if (url.includes('/perf-counters')) {
      return { ok: true, json: async () => mockPerfData } as Response;
    }
    if (url.includes('/server-config')) {
      return { ok: true, json: async () => mockServerConfig } as Response;
    }
    return { ok: true, json: async () => ({}) } as Response;
  });

  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SqlServerMetrics {...props} />
    </QueryClientProvider>,
  );
}

describe('SqlServerMetrics', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('renders the main container', () => {
    renderComponent();
    expect(screen.getByTestId('sql-server-metrics')).toBeInTheDocument();
  });

  it('renders single collapsible section with subsection headers', () => {
    renderComponent();
    expect(screen.getByText('SQL Server Metrics')).toBeInTheDocument();
    expect(screen.getByText('General')).toBeInTheDocument();
    expect(screen.getByText('Latches and Locks')).toBeInTheDocument();
    expect(screen.getByText('Buffer Cache')).toBeInTheDocument();
    expect(screen.getByText('Server Properties')).toBeInTheDocument();
    expect(screen.getByText('Server Configuration Options')).toBeInTheDocument();
  });

  it('shows chart titles since section is open by default', async () => {
    renderComponent();
    expect(await screen.findByText('Batch Requests/sec')).toBeInTheDocument();
    expect(screen.getByText('SQL Compilations/sec')).toBeInTheDocument();
    expect(screen.getByText('User Connections')).toBeInTheDocument();
  });

  it('Server Properties shows version and edition from health prop', async () => {
    renderComponent();
    expect(await screen.findByText('Microsoft SQL Server 2022')).toBeInTheDocument();
    expect(screen.getByText('Enterprise Edition')).toBeInTheDocument();
  });

  it('Server Configuration Options shows config values after loading', async () => {
    renderComponent();
    expect(await screen.findByText('SQL_Latin1_General_CP1_CI_AS')).toBeInTheDocument();
    expect(screen.getByText('16,384')).toBeInTheDocument();
    expect(screen.getByText('50')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
  });

  it('fetches perf-counters with correct range params', () => {
    renderComponent();
    expect(mockAuthFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/metrics/1/perf-counters?from='),
    );
  });

  it('handles missing health gracefully', async () => {
    const { health: _, ...propsWithoutHealth } = defaultProps;
    renderComponent(propsWithoutHealth as typeof defaultProps);
    // Should show N/A for missing health fields
    const naValues = await screen.findAllByText('N/A');
    expect(naValues.length).toBeGreaterThanOrEqual(2);
  });

  it('handles server-config fetch failure gracefully', async () => {
    mockAuthFetch.mockImplementation(async (url: string) => {
      if (url.includes('/perf-counters')) {
        return { ok: true, json: async () => mockPerfData } as Response;
      }
      if (url.includes('/server-config')) {
        return { ok: false, json: async () => ({ error: 'fail' }) } as Response;
      }
      return { ok: true, json: async () => ({}) } as Response;
    });

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <SqlServerMetrics {...defaultProps} />
      </QueryClientProvider>,
    );

    expect(await screen.findByText('No data available')).toBeInTheDocument();
  });
});
