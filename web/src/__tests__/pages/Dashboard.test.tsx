import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { Dashboard } from '../../pages/Dashboard';

function makeInstance(overrides: Record<string, unknown> = {}) {
  return {
    id: 1, name: 'Prod-1', host: 'sql1', port: 1433, status: 'online',
    last_seen: new Date().toISOString(), group_id: 1, group_name: 'Production',
    cpu: { sql_cpu_pct: 45, other_process_cpu_pct: 10, system_idle_pct: 45 },
    memory: { os_total_memory_mb: 16384, os_available_memory_mb: 4096, sql_committed_mb: 8192, sql_target_mb: 12288 },
    health: { version: '16.0.4135.4', edition: 'Enterprise', uptime_seconds: 86400 },
    top_waits: [{ wait_type: 'CXPACKET', wait_ms_per_sec: 12.5 }],
    total_wait_ms_per_sec: 12.5,
    disk_io_mb_per_sec: 5.3,
    alert_count: 0,
    first_alert_message: null,
    healthy_since: new Date().toISOString(),
    ...overrides,
  };
}

vi.mock('@/lib/auth', () => ({
  authFetch: vi.fn(async (url: string) => {
    if (url.includes('/api/metrics/overview')) {
      return {
        ok: true,
        json: async () => ({
          total: 3, online: 2, offline: 0, error: 1,
          instances: [
            makeInstance({ id: 1, name: 'Prod-1', group_id: 1, group_name: 'Production' }),
            makeInstance({ id: 2, name: 'Prod-2', group_id: 1, group_name: 'Production', cpu: null, memory: null, health: null, top_waits: [], total_wait_ms_per_sec: null, disk_io_mb_per_sec: null }),
            makeInstance({ id: 3, name: 'Dev-1', status: 'unreachable', last_seen: null, group_id: null, group_name: null, cpu: null, memory: null, health: null, top_waits: [], total_wait_ms_per_sec: null, disk_io_mb_per_sec: null, alert_count: 2, first_alert_message: 'CPU critical: 95%' }),
          ],
        }),
      };
    }
    return { ok: true, json: async () => ({}) };
  }),
}));

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Dashboard', () => {
  it('renders stat cards', async () => {
    renderWithProviders(<Dashboard />);
    expect(await screen.findByText('Total')).toBeInTheDocument();
    expect(screen.getByText('Online')).toBeInTheDocument();
    expect(screen.getByText('Error')).toBeInTheDocument();
  });

  it('renders instance cards with names', async () => {
    renderWithProviders(<Dashboard />);
    expect(await screen.findByText('Prod-1')).toBeInTheDocument();
    expect(screen.getByText('Prod-2')).toBeInTheDocument();
    expect(screen.getByText('Dev-1')).toBeInTheDocument();
  });

  it('renders grouped sections when groups exist', async () => {
    renderWithProviders(<Dashboard />);
    expect(await screen.findByText('Production')).toBeInTheDocument();
    expect(screen.getByText('Ungrouped')).toBeInTheDocument();
  });

  it('groups render with headers and instance counts', async () => {
    renderWithProviders(<Dashboard />);
    const prodGroup = await screen.findByTestId('group-Production');
    expect(prodGroup).toBeInTheDocument();
    expect(prodGroup.textContent).toContain('(2)');
    const ungrouped = screen.getByTestId('group-Ungrouped');
    expect(ungrouped.textContent).toContain('(1)');
  });

  it('ungrouped section appears at bottom', async () => {
    renderWithProviders(<Dashboard />);
    const prodGroup = await screen.findByTestId('group-Production');
    const ungroupedGroup = screen.getByTestId('group-Ungrouped');
    // Ungrouped should come after Production in DOM
    expect(prodGroup.compareDocumentPosition(ungroupedGroup) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
