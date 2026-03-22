import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BlockingTree } from '../../components/BlockingTree';

vi.mock('@/lib/auth', () => ({
  authFetch: vi.fn(),
}));

import { authFetch } from '@/lib/auth';
const mockAuthFetch = authFetch as ReturnType<typeof vi.fn>;

function renderWithQuery(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('BlockingTree', () => {
  it('renders nothing when no blocking chains', async () => {
    mockAuthFetch.mockResolvedValueOnce({ ok: true, json: async () => [] });
    const { container } = renderWithQuery(<BlockingTree instanceId="1" />);
    // Wait for query to settle
    await new Promise((r) => setTimeout(r, 50));
    expect(container.innerHTML).toBe('');
  });

  it('renders tree with HEAD BLOCKER badge', async () => {
    const chains = [
      {
        session_id: 55,
        login_name: 'admin',
        database_name: 'DB1',
        wait_type: null,
        wait_time_ms: null,
        elapsed_time_ms: 5000,
        current_statement: 'UPDATE t SET x=1',
        children: [
          {
            session_id: 60,
            login_name: 'app',
            database_name: 'DB1',
            wait_type: 'LCK_M_X',
            wait_time_ms: 3000,
            elapsed_time_ms: 3000,
            current_statement: 'SELECT * FROM t',
            children: [],
          },
        ],
      },
    ];
    mockAuthFetch.mockResolvedValueOnce({ ok: true, json: async () => chains });
    renderWithQuery(<BlockingTree instanceId="1" />);

    expect(await screen.findByText('HEAD BLOCKER')).toBeInTheDocument();
    expect(screen.getByText('SPID 55')).toBeInTheDocument();
    expect(screen.getByText('SPID 60')).toBeInTheDocument();
    expect(screen.getByText('Blocking Chains')).toBeInTheDocument();
  });

  it('expands SQL statement on click', async () => {
    const chains = [
      {
        session_id: 55,
        login_name: 'admin',
        database_name: 'DB1',
        wait_type: null,
        wait_time_ms: null,
        elapsed_time_ms: 5000,
        current_statement: 'SELECT * FROM very_long_query',
        children: [],
      },
    ];
    mockAuthFetch.mockResolvedValueOnce({ ok: true, json: async () => chains });
    renderWithQuery(<BlockingTree instanceId="1" />);

    const showBtn = await screen.findByText('Show SQL');
    fireEvent.click(showBtn);
    expect(screen.getByText('SELECT * FROM very_long_query')).toBeInTheDocument();
    expect(screen.getByText('Hide SQL')).toBeInTheDocument();
  });
});
