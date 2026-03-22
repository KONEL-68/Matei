import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StatusBar } from '../../components/StatusBar';

vi.mock('@/lib/auth', () => ({
  authFetch: vi.fn(),
}));

import { authFetch } from '@/lib/auth';
const mockAuthFetch = vi.mocked(authFetch);

function renderWithQuery(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

function mockAllEndpoints(overrides?: {
  cpu?: unknown[];
  waits?: unknown[];
  sessions?: unknown[];
  fileIo?: unknown[];
  perfCounters?: unknown;
}) {
  const cpu = overrides?.cpu ?? [{ sql_cpu_pct: 12 }];
  const waits = overrides?.waits ?? [{ wait_type: 'ASYNC_NETWORK_IO', wait_ms_per_sec: 133 }];
  const sessions = overrides?.sessions ?? [{ blocking_session_id: null }];
  const fileIo = overrides?.fileIo ?? [{ avg_read_latency_ms: 0.3, avg_write_latency_ms: 8.4 }];
  const perfCounters = overrides?.perfCounters ?? {
    latest: [
      { counter_name: 'Page life expectancy', cntr_value: 74160 },
      { counter_name: 'Memory Grants Pending', cntr_value: 0 },
      { counter_name: 'Pending Tasks', cntr_value: 2 },
    ],
  };

  mockAuthFetch.mockImplementation(async (url: string) => {
    if (url.includes('/cpu')) return { ok: true, json: async () => cpu } as Response;
    if (url.includes('/waits')) return { ok: true, json: async () => waits } as Response;
    if (url.includes('/sessions')) return { ok: true, json: async () => sessions } as Response;
    if (url.includes('/file-io')) return { ok: true, json: async () => fileIo } as Response;
    if (url.includes('/perf-counters')) return { ok: true, json: async () => perfCounters } as Response;
    return { ok: true, json: async () => [] } as Response;
  });
}

describe('StatusBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders all 8 KPI labels and Live indicator', async () => {
    mockAllEndpoints();
    renderWithQuery(<StatusBar instanceId="1" />);

    expect(await screen.findByText(/CPU 12%/)).toBeInTheDocument();
    expect(screen.getByText(/ASYNC_NETWORK_IO/)).toBeInTheDocument();
    expect(screen.getByText(/Blocked 0/)).toBeInTheDocument();
    expect(screen.getByText(/Pending 2/)).toBeInTheDocument();
    expect(screen.getByText(/Read IO 0.3ms/)).toBeInTheDocument();
    expect(screen.getByText(/Write IO 8.4ms/)).toBeInTheDocument();
    expect(screen.getByText(/PLE 20.6h/)).toBeInTheDocument();
    expect(screen.getByText(/Mem Grants Pending 0/)).toBeInTheDocument();
    expect(screen.getByText('Live')).toBeInTheDocument();
  });

  it('shows yellow dot for CPU >= 75', async () => {
    mockAllEndpoints({ cpu: [{ sql_cpu_pct: 80 }] });
    renderWithQuery(<StatusBar instanceId="1" />);

    const cpuSpan = (await screen.findByText(/CPU 80%/)).closest('span');
    const dot = cpuSpan?.querySelector('.rounded-full');
    expect(dot?.className).toContain('bg-yellow-400');
  });

  it('shows red dot for CPU >= 90', async () => {
    mockAllEndpoints({ cpu: [{ sql_cpu_pct: 95 }] });
    renderWithQuery(<StatusBar instanceId="1" />);

    const cpuSpan = (await screen.findByText(/CPU 95%/)).closest('span');
    const dot = cpuSpan?.querySelector('.rounded-full');
    expect(dot?.className).toContain('bg-red-500');
  });

  it('shows red dot for PLE < 300', async () => {
    mockAllEndpoints({
      perfCounters: { latest: [{ counter_name: 'Page life expectancy', cntr_value: 200 }] },
    });
    renderWithQuery(<StatusBar instanceId="1" />);

    const pleSpan = (await screen.findByText(/PLE 200s/)).closest('span');
    const dot = pleSpan?.querySelector('.rounded-full');
    expect(dot?.className).toContain('bg-red-500');
  });

  it('renders as a thin strip (compact height)', async () => {
    mockAllEndpoints();
    renderWithQuery(<StatusBar instanceId="1" />);

    const bar = await screen.findByTestId('status-bar');
    expect(bar.className).toContain('py-1.5');
    expect(bar.className).toContain('text-xs');
  });

  it('shows blocked count with red dot when >= 5', async () => {
    const sessions = Array.from({ length: 6 }, () => ({ blocking_session_id: 1 }));
    mockAllEndpoints({ sessions });
    renderWithQuery(<StatusBar instanceId="1" />);

    const blockedSpan = (await screen.findByText(/Blocked 6/)).closest('span');
    const dot = blockedSpan?.querySelector('.rounded-full');
    expect(dot?.className).toContain('bg-red-500');
  });

  it('fetches data independently from time range (uses own query keys)', async () => {
    mockAllEndpoints();
    renderWithQuery(<StatusBar instanceId="1" />);

    await screen.findByTestId('status-bar');

    // All calls should use range=1h or no range (sessions) — never user-selected range
    for (const call of mockAuthFetch.mock.calls) {
      const url = call[0] as string;
      if (url.includes('/sessions')) {
        expect(url).not.toContain('range=');
      } else {
        expect(url).toContain('range=1h');
      }
    }
  });

  it('shows Live indicator with tooltip', async () => {
    mockAllEndpoints();
    renderWithQuery(<StatusBar instanceId="1" />);

    const liveSpan = (await screen.findByText('Live')).closest('span');
    expect(liveSpan?.getAttribute('title')).toBe('Showing latest values, independent of time range filter');
  });
});
