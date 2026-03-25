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
    last_grant_kb: 1024,
    last_used_grant_kb: 512,
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
    last_grant_kb: null,
    last_used_grant_kb: null,
  },
];

const mockProcedures = [
  { database_name: 'MyDB', procedure_name: 'dbo.GetUser', execution_count: 10000, total_cpu_ms: 5000, total_elapsed_ms: 12000, total_reads: 500000, total_writes: 1000, avg_cpu_ms: 0.5, avg_elapsed_ms: 1.2, avg_reads: 50, sample_count: 12 },
];

function renderAnalysis() {
  mockAuthFetch.mockImplementation(async (url: string) => {
    if (url.includes('/tracked')) {
      return { ok: true, json: async () => [] } as Response;
    }
    if (url.includes('/procedure-stats')) {
      return { ok: true, json: async () => mockProcedures } as Response;
    }
    if (url.includes('/waits')) {
      return { ok: true, json: async () => ({ session_waits: [], current_requests: [] }) } as Response;
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

  it('renders all 3 tabs', async () => {
    renderAnalysis();
    expect(await screen.findByText('Top Queries')).toBeInTheDocument();
    expect(screen.getByText('Tracked Queries')).toBeInTheDocument();
    expect(screen.getByText('Top Procedures')).toBeInTheDocument();
  });

  it('defaults to Top Queries tab with Totals mode active', async () => {
    renderAnalysis();
    expect(await screen.findByTestId('top-queries-tab')).toBeInTheDocument();
    expect(screen.getByText('Totals')).toBeInTheDocument();
    expect(screen.getByText('Avg per execution')).toBeInTheDocument();
    expect(screen.getByText('Impact')).toBeInTheDocument();
  });

  it('Top Queries: shows query rows', async () => {
    renderAnalysis();
    expect(await screen.findByText(/SELECT \* FROM users/)).toBeInTheDocument();
    expect(screen.getByText(/UPDATE orders/)).toBeInTheDocument();
  });

  it('Top Queries: toggle switches to Avg mode and changes headers', async () => {
    renderAnalysis();
    await screen.findByText(/SELECT \* FROM users/);
    fireEvent.click(screen.getByText('Avg per execution'));
    expect(screen.getByText('Avg Duration (ms)')).toBeInTheDocument();
    expect(screen.getByText('Avg CPU time (ms)')).toBeInTheDocument();
  });

  it('Top Queries: impact mode shows impact dots', async () => {
    renderAnalysis();
    await screen.findByText(/SELECT \* FROM users/);
    fireEvent.click(screen.getByText('Impact'));
    const dots = document.querySelectorAll('.rounded-full');
    expect(dots.length).toBeGreaterThan(0);
  });

  it('switches to Tracked Queries tab with empty state', async () => {
    renderAnalysis();
    fireEvent.click(screen.getByText('Tracked Queries'));
    expect(await screen.findByTestId('tracked-queries-tab')).toBeInTheDocument();
    expect(await screen.findByText(/No tracked queries yet/)).toBeInTheDocument();
  });

  it('switches to Top Procedures tab and shows data', async () => {
    renderAnalysis();
    fireEvent.click(screen.getByText('Top Procedures'));
    expect(await screen.findByTestId('top-procedures-tab')).toBeInTheDocument();
    expect(await screen.findByText('dbo.GetUser')).toBeInTheDocument();
  });

  it('Top Procedures: shows error state on fetch failure', async () => {
    mockAuthFetch.mockImplementation(async (url: string) => {
      if (url.includes('/tracked')) {
        return { ok: true, json: async () => [] } as Response;
      }
      if (url.includes('/procedure-stats')) {
        throw new Error('Connection failed');
      }
      if (url.includes('/api/queries/')) {
        return { ok: true, json: async () => mockQueries } as Response;
      }
      return { ok: true, json: async () => [] } as Response;
    });

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <AnalysisSection instanceId="1" range="1h" timeWindow={null} />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByText('Top Procedures'));
    expect(await screen.findByText(/Failed to load procedures/)).toBeInTheDocument();
  });

  it('Top Queries: default column headers show Totals labels', async () => {
    renderAnalysis();
    await screen.findByText(/SELECT \* FROM users/);
    expect(screen.getByText('Duration (ms)')).toBeInTheDocument();
    expect(screen.getByText('CPU time (ms)')).toBeInTheDocument();
    expect(screen.getByText('Logical reads')).toBeInTheDocument();
  });
});
