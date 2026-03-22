import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { Instances } from '../../pages/Instances';

vi.mock('@/lib/auth', () => ({
  authFetch: vi.fn(async (url: string) => {
    if (url === '/api/instances') {
      return {
        ok: true,
        json: async () => [
          { id: 1, name: 'Prod-1', host: 'sql1', port: 1433, auth_type: 'sql', status: 'online', last_seen: new Date().toISOString(), is_enabled: true, created_at: '', updated_at: '', group_id: 1, group_name: 'Production' },
          { id: 2, name: 'Dev-1', host: 'sql2', port: 1433, auth_type: 'sql', status: 'unknown', last_seen: null, is_enabled: true, created_at: '', updated_at: '', group_id: null, group_name: null },
        ],
      };
    }
    if (url === '/api/groups') {
      return { ok: true, json: async () => [{ id: 1, name: 'Production' }] };
    }
    return { ok: true, json: async () => [] };
  }),
}));

function renderInstances() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><Instances /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Instances', () => {
  it('renders instance list with names', async () => {
    renderInstances();
    expect(await screen.findByText('Prod-1')).toBeInTheDocument();
    expect(screen.getByText('Dev-1')).toBeInTheDocument();
  });

  it('shows Group column header', async () => {
    renderInstances();
    expect(await screen.findByText('Group')).toBeInTheDocument();
  });

  it('renders Add Instance button', async () => {
    renderInstances();
    expect(await screen.findByText('Add Instance')).toBeInTheDocument();
  });
});
