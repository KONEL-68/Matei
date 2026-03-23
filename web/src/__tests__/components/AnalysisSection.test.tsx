import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { AnalysisSection } from '../../components/AnalysisSection';

vi.mock('@/lib/auth', () => ({
  authFetch: vi.fn(),
}));

import { authFetch } from '@/lib/auth';
const mockAuthFetch = vi.mocked(authFetch);

const mockQueries = [
  {
    query_hash: '0xABC',
    statement_text: 'SELECT * FROM users WHERE id = @p1',
    database_name: 'MyDB',
    execution_count: 1000,
    cpu_ms_per_sec: 5.2,
    elapsed_ms_per_sec: 12.3,
    reads_per_sec: 100,
    writes_per_sec: 10,
    avg_cpu_ms: 2.5,
    avg_elapsed_ms: 8.1,
    avg_reads: 50,
    avg_writes: 5,
    total_cpu_ms: 2500,
    total_elapsed_ms: 8100,
    total_reads: 50000,
    total_writes: 5000,
    sample_count: 10,
  },
  {
    query_hash: '0xDEF',
    statement_text: 'UPDATE orders SET status = @p1',
    database_name: 'OrderDB',
    execution_count: 500,
    cpu_ms_per_sec: 3.1,
    elapsed_ms_per_sec: 6.5,
    reads_per_sec: 200,
    writes_per_sec: 50,
    avg_cpu_ms: 1.2,
    avg_elapsed_ms: 3.5,
    avg_reads: 100,
    avg_writes: 25,
    total_cpu_ms: 600,
    total_elapsed_ms: 1750,
    total_reads: 50000,
    total_writes: 12500,
    sample_count: 5,
  },
];

const mockWaits = [
  { wait_type: 'CXPACKET', waiting_tasks_count: 5000, wait_time_ms: 120000, max_wait_time_ms: 500, signal_wait_time_ms: 1000, wait_ms_per_sec: 33.3 },
  { wait_type: 'LCK_M_X', waiting_tasks_count: 100, wait_time_ms: 50000, max_wait_time_ms: 2000, signal_wait_time_ms: 200, wait_ms_per_sec: 13.9 },
];

const mockProcedures = [
  { database_name: 'MyDB', procedure_name: 'dbo.GetUser', execution_count: 10000, total_cpu_ms: 5000, total_elapsed_ms: 12000, total_reads: 500000, total_writes: 1000, avg_cpu_ms: 0.5, avg_elapsed_ms: 1.2, avg_reads: 50, last_execution_time: '2026-03-22T10:00:00Z' },
];

function renderAnalysis() {
  mockAuthFetch.mockImplementation(async (url: string) => {
    if (url.includes('/waits')) {
      return { ok: true, json: async () => mockWaits } as Response;
    }
    if (url.includes('/procedures')) {
      return { ok: true, json: async () => mockProcedures } as Response;
    }
    if (url.includes('/api/queries/')) {
      return { ok: true, json: async () => mockQueries } as Response;
    }
    return { ok: true, json: async () => [] } as Response;
  });

  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AnalysisSection instanceId="1" range="1h" timeWindow={null} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AnalysisSection', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('renders all 4 tabs', async () => {
    renderAnalysis();
    expect(await screen.findByText('Top Queries')).toBeInTheDocument();
    expect(screen.getByText('Tracked Queries')).toBeInTheDocument();
    expect(screen.getByText('Top Waits')).toBeInTheDocument();
    expect(screen.getByText('Top Procedures')).toBeInTheDocument();
  });

  it('defaults to Top Queries tab with toggle buttons', async () => {
    renderAnalysis();
    expect(await screen.findByTestId('top-queries-tab')).toBeInTheDocument();
    expect(screen.getByText('Avg per execution')).toBeInTheDocument();
    expect(screen.getByText('Totals')).toBeInTheDocument();
    expect(screen.getByText('Impact')).toBeInTheDocument();
  });

  it('Top Queries: shows query rows', async () => {
    renderAnalysis();
    expect(await screen.findByText(/SELECT \* FROM users/)).toBeInTheDocument();
    expect(screen.getByText(/UPDATE orders/)).toBeInTheDocument();
  });

  it('Top Queries: toggle switches to Totals mode', async () => {
    renderAnalysis();
    await screen.findByText(/SELECT \* FROM users/);
    fireEvent.click(screen.getByText('Totals'));
    // Column headers should not say "Avg"
    expect(screen.getByText('Duration')).toBeInTheDocument();
  });

  it('Top Queries: impact mode shows impact dots', async () => {
    renderAnalysis();
    await screen.findByText(/SELECT \* FROM users/);
    fireEvent.click(screen.getByText('Impact'));
    // Impact dots should be rendered (colored circles)
    const dots = document.querySelectorAll('.rounded-full');
    expect(dots.length).toBeGreaterThan(0);
  });

  it('switches to Top Waits tab', async () => {
    renderAnalysis();
    await screen.findByTestId('top-queries-tab');
    fireEvent.click(screen.getByText('Top Waits'));
    expect(await screen.findByTestId('top-waits-tab')).toBeInTheDocument();
    expect(await screen.findByText('CXPACKET')).toBeInTheDocument();
    expect(screen.getByText('LCK_M_X')).toBeInTheDocument();
  });

  it('Top Waits: toggle switches between Zoom and Full Range', async () => {
    renderAnalysis();
    fireEvent.click(screen.getByText('Top Waits'));
    await screen.findByTestId('top-waits-tab');
    expect(screen.getByText('Zoom Range')).toBeInTheDocument();
    expect(screen.getByText('Full Range')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Full Range'));
    // Should re-fetch (query key changes)
    expect(mockAuthFetch).toHaveBeenCalled();
  });

  it('switches to Tracked Queries tab with empty state', async () => {
    renderAnalysis();
    fireEvent.click(screen.getByText('Tracked Queries'));
    expect(await screen.findByTestId('tracked-queries-tab')).toBeInTheDocument();
    expect(screen.getByText(/No tracked queries yet/)).toBeInTheDocument();
  });

  it('switches to Top Procedures tab and shows data', async () => {
    renderAnalysis();
    fireEvent.click(screen.getByText('Top Procedures'));
    expect(await screen.findByTestId('top-procedures-tab')).toBeInTheDocument();
    expect(await screen.findByText('dbo.GetUser')).toBeInTheDocument();
  });
});
