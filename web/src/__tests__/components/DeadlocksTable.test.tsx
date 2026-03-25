import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DeadlocksTable } from '../../components/DeadlocksTable';

vi.mock('@/lib/auth', () => ({
  authFetch: vi.fn(),
}));

import { authFetch } from '@/lib/auth';
const mockAuthFetch = vi.mocked(authFetch);

function renderWithQuery(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('DeadlocksTable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows empty state when no deadlocks', async () => {
    mockAuthFetch.mockImplementation(async () => ({ ok: true, json: async () => [] }) as Response);
    renderWithQuery(<DeadlocksTable instanceId="1" range="1h" />);
    expect(await screen.findByText('No deadlocks detected in this time range.')).toBeInTheDocument();
  });

  it('renders deadlock rows with count badge', async () => {
    const deadlocks = [
      { id: 1, deadlock_time: '2026-03-22T10:00:00Z', victim_spid: 55, victim_query: 'UPDATE t SET x=1', collected_at: '2026-03-22T10:00:05Z' },
      { id: 2, deadlock_time: '2026-03-22T11:00:00Z', victim_spid: null, victim_query: null, collected_at: '2026-03-22T11:00:05Z' },
    ];
    mockAuthFetch.mockImplementation(async () => ({ ok: true, json: async () => deadlocks }) as Response);
    renderWithQuery(<DeadlocksTable instanceId="1" range="1h" />);

    expect(await screen.findByText('55')).toBeInTheDocument();
    expect(screen.getByText('UPDATE t SET x=1')).toBeInTheDocument();
  });

  it('shows dash for null victim fields', async () => {
    const deadlocks = [
      { id: 1, deadlock_time: '2026-03-22T10:00:00Z', victim_spid: null, victim_query: null, collected_at: '2026-03-22T10:00:05Z' },
    ];
    mockAuthFetch.mockImplementation(async () => ({ ok: true, json: async () => deadlocks }) as Response);
    renderWithQuery(<DeadlocksTable instanceId="1" range="1h" />);

    const dashes = await screen.findAllByText('-');
    expect(dashes.length).toBeGreaterThanOrEqual(2);
  });

  it('toggles Show/Hide XML button on click', async () => {
    const deadlocks = [
      { id: 1, deadlock_time: '2026-03-22T10:00:00Z', victim_spid: 55, victim_query: 'SELECT 1', collected_at: '2026-03-22T10:00:05Z' },
    ];
    const detail = {
      id: 1, instance_id: 1, deadlock_time: '2026-03-22T10:00:00Z',
      victim_spid: 55, victim_query: 'SELECT 1',
      deadlock_xml: '<deadlock><victim-list/></deadlock>',
      collected_at: '2026-03-22T10:00:05Z',
    };
    mockAuthFetch.mockImplementation(async (url: string) => {
      if (url.includes('/deadlocks/')) return { ok: true, json: async () => detail } as Response;
      return { ok: true, json: async () => deadlocks } as Response;
    });

    renderWithQuery(<DeadlocksTable instanceId="1" range="1h" />);

    const showBtn = await screen.findByText('Show XML');
    fireEvent.click(showBtn);
    expect(screen.getByText('Hide XML')).toBeInTheDocument();

    // Click again to hide
    fireEvent.click(screen.getByText('Hide XML'));
    expect(screen.getByText('Show XML')).toBeInTheDocument();
  });

  it('renders table headers', async () => {
    const deadlocks = [
      { id: 1, deadlock_time: '2026-03-22T10:00:00Z', victim_spid: 55, victim_query: 'SELECT 1', collected_at: '2026-03-22T10:00:05Z' },
    ];
    mockAuthFetch.mockImplementation(async () => ({ ok: true, json: async () => deadlocks }) as Response);
    renderWithQuery(<DeadlocksTable instanceId="1" range="1h" />);

    expect(await screen.findByText('Time')).toBeInTheDocument();
    expect(screen.getByText('Victim SPID')).toBeInTheDocument();
    expect(screen.getByText('Victim Query')).toBeInTheDocument();
    expect(screen.getByText('Detail')).toBeInTheDocument();
  });
});
