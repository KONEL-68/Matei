import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryExplorer } from '../../pages/QueryExplorer';
import { authFetch } from '@/lib/auth';

vi.mock('@/lib/auth', () => ({
  authFetch: vi.fn(async (url: string) => {
    if (url.includes('/api/queries/1')) {
      return {
        ok: true,
        json: async () => [
          {
            query_hash: 'abc123',
            statement_text: 'SELECT * FROM orders WHERE id = @p1',
            database_name: 'SalesDB',
            execution_count: 150,
            cpu_ms_per_sec: 12.5,
            elapsed_ms_per_sec: 25.3,
            reads_per_sec: 500,
            writes_per_sec: 10,
            avg_cpu_ms: 8.2,
            avg_elapsed_ms: 16.1,
            avg_reads: 250,
            avg_writes: 5,
            sample_count: 10,
          },
          {
            query_hash: 'def456',
            statement_text: 'INSERT INTO logs VALUES (@p1, @p2)',
            database_name: 'LogDB',
            execution_count: 5000,
            cpu_ms_per_sec: 5.0,
            elapsed_ms_per_sec: 6.0,
            reads_per_sec: 100,
            writes_per_sec: 200,
            avg_cpu_ms: 1.0,
            avg_elapsed_ms: 1.2,
            avg_reads: 20,
            avg_writes: 40,
            sample_count: 10,
          },
        ],
      };
    }
    return { ok: true, json: async () => [] };
  }),
}));

function renderQueryExplorer() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/instances/1/queries']}>
        <Routes>
          <Route path="/instances/:id/queries" element={<QueryExplorer />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('QueryExplorer', () => {
  it('renders heading and controls', async () => {
    renderQueryExplorer();
    expect(await screen.findByText('Query Explorer')).toBeInTheDocument();
    expect(screen.getByText('1h')).toBeInTheDocument();
    expect(screen.getByText('6h')).toBeInTheDocument();
    expect(screen.getByText('24h')).toBeInTheDocument();
    expect(screen.getByText('CPU')).toBeInTheDocument();
    expect(screen.getByText('Reads')).toBeInTheDocument();
    expect(screen.getByText('Duration')).toBeInTheDocument();
    expect(screen.getByText('Executions')).toBeInTheDocument();
  });

  it('renders query rows', async () => {
    renderQueryExplorer();
    expect(await screen.findByText(/SELECT \* FROM orders/)).toBeInTheDocument();
    expect(screen.getByText(/INSERT INTO logs/)).toBeInTheDocument();
  });

  it('renders table column headers', async () => {
    renderQueryExplorer();
    expect(await screen.findByText('Statement')).toBeInTheDocument();
    expect(screen.getByText('Database')).toBeInTheDocument();
    expect(screen.getByText('CPU ms/s')).toBeInTheDocument();
    expect(screen.getByText('Reads/s')).toBeInTheDocument();
  });

  it('shows sort buttons with active state', async () => {
    renderQueryExplorer();
    await screen.findByText('Query Explorer');

    // CPU button should be active by default (bg-blue-600 class)
    const cpuBtn = screen.getByText('CPU');
    expect(cpuBtn.className).toContain('bg-blue-600');

    // Click Reads to change sort
    const readsBtn = screen.getByText('Reads');
    fireEvent.click(readsBtn);
    expect(readsBtn.className).toContain('bg-blue-600');
  });

  it('shows empty state when no data', async () => {
    vi.mocked(authFetch).mockImplementationOnce(async () => ({
      ok: true,
      json: async () => [],
    }) as Response);

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/instances/1/queries']}>
          <Routes>
            <Route path="/instances/:id/queries" element={<QueryExplorer />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText('No query stats data available yet.')).toBeInTheDocument();
  });
});
