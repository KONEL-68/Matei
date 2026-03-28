import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BlockingHistory } from '../../components/BlockingHistory';

vi.mock('@/lib/auth', () => ({
  authFetch: vi.fn(),
}));

import { authFetch } from '@/lib/auth';
const mockAuthFetch = vi.mocked(authFetch);

function renderWithQuery(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const sampleEvents = [
  {
    id: 1,
    event_time: '2026-03-28T14:30:00Z',
    head_blocker_spid: 55,
    head_blocker_login: 'sa',
    head_blocker_host: 'APP-SERVER',
    head_blocker_app: 'MyApp',
    head_blocker_db: 'ProductionDB',
    head_blocker_sql: 'UPDATE orders SET status = 1',
    chain_json: [
      {
        spid: 55,
        login: 'sa',
        hostname: 'APP-SERVER',
        database: 'ProductionDB',
        app: 'MyApp',
        wait_type: null,
        wait_time_ms: null,
        wait_resource: null,
        sql_text: 'UPDATE orders SET status = 1',
        blocked_by: null,
        command: 'UPDATE',
      },
      {
        spid: 60,
        login: 'app_user',
        hostname: 'WEB-01',
        database: 'ProductionDB',
        app: 'WebApp',
        wait_type: 'LCK_M_X',
        wait_time_ms: 135000,
        wait_resource: 'KEY: 5:72057594038845440 (a1b2c3d4)',
        sql_text: "SELECT * FROM orders WHERE id = '123'",
        blocked_by: 55,
        command: 'SELECT',
      },
    ],
    total_blocked_count: 1,
    max_wait_time_ms: 135000,
  },
];

describe('BlockingHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function mockFetch(events: unknown[], config?: { blocked_process_threshold: number }) {
    mockAuthFetch.mockImplementation(async (url: string) => {
      if (url.includes('/blocking/config')) {
        if (config != null) {
          return { ok: true, json: async () => config } as Response;
        }
        return { ok: false } as Response;
      }
      return { ok: true, json: async () => events } as Response;
    });
  }

  it('shows empty state when no blocking events', async () => {
    mockFetch([], { blocked_process_threshold: 10 });
    renderWithQuery(<BlockingHistory instanceId="1" range="1h" timeWindow={null} />);
    expect(await screen.findByText('No blocking events detected in this time range.')).toBeInTheDocument();
  });

  it('shows warning banner when threshold is 0 and no events', async () => {
    mockFetch([], { blocked_process_threshold: 0 });
    renderWithQuery(<BlockingHistory instanceId="1" range="1h" timeWindow={null} />);
    expect(await screen.findByText(/Blocked Process Threshold is not configured/)).toBeInTheDocument();
    expect(screen.getByText(/blocked process threshold.*10/)).toBeInTheDocument();
    expect(screen.getByText(/No blocking events can be detected until/)).toBeInTheDocument();
  });

  it('shows warning banner when threshold is 0 and events exist', async () => {
    mockFetch(sampleEvents, { blocked_process_threshold: 0 });
    renderWithQuery(<BlockingHistory instanceId="1" range="1h" timeWindow={null} />);
    expect(await screen.findByText(/Blocked Process Threshold is not configured/)).toBeInTheDocument();
    // Table should still render
    expect(screen.getByText('SPID 55')).toBeInTheDocument();
  });

  it('does not show banner when threshold is positive', async () => {
    mockFetch(sampleEvents, { blocked_process_threshold: 10 });
    renderWithQuery(<BlockingHistory instanceId="1" range="1h" timeWindow={null} />);
    expect(await screen.findByText('SPID 55')).toBeInTheDocument();
    expect(screen.queryByText(/Blocked Process Threshold is not configured/)).not.toBeInTheDocument();
  });

  it('does not show banner when config fetch fails', async () => {
    mockFetch([], undefined);
    renderWithQuery(<BlockingHistory instanceId="1" range="1h" timeWindow={null} />);
    expect(await screen.findByText('No blocking events detected in this time range.')).toBeInTheDocument();
    expect(screen.queryByText(/Blocked Process Threshold is not configured/)).not.toBeInTheDocument();
  });

  it('renders table headers', async () => {
    mockFetch(sampleEvents);
    renderWithQuery(<BlockingHistory instanceId="1" range="1h" timeWindow={null} />);

    expect(await screen.findByText('Time First Occurs')).toBeInTheDocument();
    // "Head Blocker" appears in both table header and row badge
    const headBlockerEls = screen.getAllByText('Head Blocker');
    expect(headBlockerEls.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Database')).toBeInTheDocument();
    expect(screen.getByText('Application')).toBeInTheDocument();
    expect(screen.getByText('Blocked')).toBeInTheDocument();
    expect(screen.getByText('Max Wait')).toBeInTheDocument();
  });

  it('renders blocking event rows', async () => {
    mockFetch(sampleEvents);
    renderWithQuery(<BlockingHistory instanceId="1" range="1h" timeWindow={null} />);

    expect(await screen.findByText('SPID 55')).toBeInTheDocument();
    expect(screen.getByText('sa')).toBeInTheDocument();
    expect(screen.getByText('ProductionDB')).toBeInTheDocument();
    expect(screen.getByText('MyApp')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument(); // blocked count
    expect(screen.getByText('2m 15s')).toBeInTheDocument(); // 135000ms
  });

  it('expands row to show blocking chain on click', async () => {
    mockFetch(sampleEvents);
    renderWithQuery(<BlockingHistory instanceId="1" range="1h" timeWindow={null} />);

    // Wait for rows to render
    const spid = await screen.findByText('SPID 55');
    const row = spid.closest('tr')!;
    fireEvent.click(row);

    // Should show expanded chain details
    expect(await screen.findByText('Blocking Chain')).toBeInTheDocument();
    expect(screen.getByText('HEAD BLOCKER')).toBeInTheDocument();
    expect(screen.getByText('SPID 60')).toBeInTheDocument();
    expect(screen.getByText('LCK_M_X')).toBeInTheDocument();
  });

  it('collapses expanded row on second click', async () => {
    mockFetch(sampleEvents);
    renderWithQuery(<BlockingHistory instanceId="1" range="1h" timeWindow={null} />);

    const spid = await screen.findByText('SPID 55');
    const row = spid.closest('tr')!;

    // Expand
    fireEvent.click(row);
    expect(await screen.findByText('Blocking Chain')).toBeInTheDocument();

    // Collapse
    fireEvent.click(row);
    expect(screen.queryByText('Blocking Chain')).not.toBeInTheDocument();
  });

  it('shows dash for null fields', async () => {
    const eventsWithNulls = [{
      ...sampleEvents[0],
      head_blocker_login: null,
      head_blocker_db: null,
      head_blocker_app: null,
    }];
    mockFetch(eventsWithNulls);
    renderWithQuery(<BlockingHistory instanceId="1" range="1h" timeWindow={null} />);

    const dashes = await screen.findAllByText('-');
    expect(dashes.length).toBeGreaterThanOrEqual(2);
  });

  it('applies red border for events over 5 minutes', async () => {
    const longBlockEvent = [{
      ...sampleEvents[0],
      max_wait_time_ms: 400000, // >5min
    }];
    mockFetch(longBlockEvent);
    renderWithQuery(<BlockingHistory instanceId="1" range="1h" timeWindow={null} />);

    const spid = await screen.findByText('SPID 55');
    const row = spid.closest('tr')!;
    expect(row.className).toContain('border-l-red-500');
  });

  it('applies yellow border for events over 1 minute', async () => {
    const medBlockEvent = [{
      ...sampleEvents[0],
      max_wait_time_ms: 90000, // >1min, <5min
    }];
    mockFetch(medBlockEvent);
    renderWithQuery(<BlockingHistory instanceId="1" range="1h" timeWindow={null} />);

    const spid = await screen.findByText('SPID 55');
    const row = spid.closest('tr')!;
    expect(row.className).toContain('border-l-yellow-500');
  });

  it('uses from/to params when timeWindow is provided', async () => {
    mockFetch([]);
    const tw = { from: '2026-03-28T10:00:00Z', to: '2026-03-28T11:00:00Z' };
    renderWithQuery(<BlockingHistory instanceId="1" range="1h" timeWindow={tw} />);

    await screen.findByText('No blocking events detected in this time range.');
    expect(mockAuthFetch).toHaveBeenCalledWith(
      expect.stringContaining('from=')
    );
    expect(mockAuthFetch).toHaveBeenCalledWith(
      expect.stringContaining('to=')
    );
  });

  it('shows View Estimated Plan and View Actual Plan buttons in expanded chain', async () => {
    mockFetch(sampleEvents);
    renderWithQuery(<BlockingHistory instanceId="1" range="1h" timeWindow={null} />);

    const spid = await screen.findByText('SPID 55');
    fireEvent.click(spid.closest('tr')!);

    const estimatedButtons = await screen.findAllByText('View Estimated Plan');
    expect(estimatedButtons.length).toBeGreaterThanOrEqual(1);
    const actualButtons = screen.getAllByText('View Actual Plan');
    expect(actualButtons.length).toBeGreaterThanOrEqual(1);
  });

  it('fetches and displays estimated plan XML on button click', async () => {
    mockFetch(sampleEvents);
    renderWithQuery(<BlockingHistory instanceId="1" range="1h" timeWindow={null} />);

    const spid = await screen.findByText('SPID 55');
    fireEvent.click(spid.closest('tr')!);

    const estimatedButtons = await screen.findAllByText('View Estimated Plan');

    // Mock the plan fetch response
    mockAuthFetch.mockImplementation(async (url: string) => {
      if (url.includes('/blocking/plan')) {
        return { ok: true, json: async () => ({ plan: '<ShowPlanXML/>', source: 'cached' }) } as Response;
      }
      if (url.includes('/blocking/config')) {
        return { ok: true, json: async () => ({ blocked_process_threshold: 10 }) } as Response;
      }
      return { ok: true, json: async () => sampleEvents } as Response;
    });

    fireEvent.click(estimatedButtons[0]);

    expect(await screen.findByText('<ShowPlanXML/>')).toBeInTheDocument();
    expect(screen.getByText('Estimated Execution Plan (XML)')).toBeInTheDocument();
    expect(screen.getByText('cached')).toBeInTheDocument();
    expect(screen.getByText('Close')).toBeInTheDocument();
    expect(screen.getByText('Copy XML')).toBeInTheDocument();
  });

  it('fetches and displays actual plan with wait stats', async () => {
    mockFetch(sampleEvents);
    renderWithQuery(<BlockingHistory instanceId="1" range="1h" timeWindow={null} />);

    const spid = await screen.findByText('SPID 55');
    fireEvent.click(spid.closest('tr')!);

    const actualButtons = await screen.findAllByText('View Actual Plan');

    const planXml = '<ShowPlanXML><WaitStats><Wait WaitType="PAGEIOLATCH_SH" WaitTimeMs="500" WaitCount="3"/></WaitStats></ShowPlanXML>';
    mockAuthFetch.mockImplementation(async (url: string) => {
      if (url.includes('/blocking/plan')) {
        return { ok: true, json: async () => ({ plan: planXml, source: 'live' }) } as Response;
      }
      if (url.includes('/blocking/config')) {
        return { ok: true, json: async () => ({ blocked_process_threshold: 10 }) } as Response;
      }
      return { ok: true, json: async () => sampleEvents } as Response;
    });

    fireEvent.click(actualButtons[0]);

    expect(await screen.findByText('Actual Execution Plan (XML)')).toBeInTheDocument();
    expect(screen.getByText('live')).toBeInTheDocument();
    // Wait stats table should appear
    expect(screen.getByText('Wait Statistics')).toBeInTheDocument();
    expect(screen.getByText('PAGEIOLATCH_SH')).toBeInTheDocument();
  });

  it('shows error message when plan fetch fails', async () => {
    mockFetch(sampleEvents);
    renderWithQuery(<BlockingHistory instanceId="1" range="1h" timeWindow={null} />);

    const spid = await screen.findByText('SPID 55');
    fireEvent.click(spid.closest('tr')!);

    const estimatedButtons = await screen.findAllByText('View Estimated Plan');

    mockAuthFetch.mockImplementation(async (url: string) => {
      if (url.includes('/blocking/plan')) {
        return { ok: false, json: async () => ({ error: 'No plan available for this session' }) } as Response;
      }
      if (url.includes('/blocking/config')) {
        return { ok: true, json: async () => ({ blocked_process_threshold: 10 }) } as Response;
      }
      return { ok: true, json: async () => sampleEvents } as Response;
    });

    fireEvent.click(estimatedButtons[0]);

    expect(await screen.findByText('No plan available for this session')).toBeInTheDocument();
  });

  it('closes plan display when Close button is clicked', async () => {
    mockFetch(sampleEvents);
    renderWithQuery(<BlockingHistory instanceId="1" range="1h" timeWindow={null} />);

    const spid = await screen.findByText('SPID 55');
    fireEvent.click(spid.closest('tr')!);

    const estimatedButtons = await screen.findAllByText('View Estimated Plan');

    mockAuthFetch.mockImplementation(async (url: string) => {
      if (url.includes('/blocking/plan')) {
        return { ok: true, json: async () => ({ plan: '<ShowPlanXML/>', source: 'live' }) } as Response;
      }
      if (url.includes('/blocking/config')) {
        return { ok: true, json: async () => ({ blocked_process_threshold: 10 }) } as Response;
      }
      return { ok: true, json: async () => sampleEvents } as Response;
    });

    fireEvent.click(estimatedButtons[0]);

    const closeBtn = await screen.findByText('Close');
    fireEvent.click(closeBtn);

    await waitFor(() => {
      expect(screen.queryByText('Estimated Execution Plan (XML)')).not.toBeInTheDocument();
    });
  });

  it('calls correct API endpoint with spid, sql, and type params', async () => {
    mockFetch(sampleEvents);
    renderWithQuery(<BlockingHistory instanceId="1" range="1h" timeWindow={null} />);

    const spid = await screen.findByText('SPID 55');
    fireEvent.click(spid.closest('tr')!);

    const actualButtons = await screen.findAllByText('View Actual Plan');

    mockAuthFetch.mockImplementation(async (url: string) => {
      if (url.includes('/blocking/plan')) {
        return { ok: true, json: async () => ({ plan: '<xml/>', source: 'live' }) } as Response;
      }
      if (url.includes('/blocking/config')) {
        return { ok: true, json: async () => ({ blocked_process_threshold: 10 }) } as Response;
      }
      return { ok: true, json: async () => sampleEvents } as Response;
    });

    fireEvent.click(actualButtons[0]);

    await screen.findByText('Actual Execution Plan (XML)');

    expect(mockAuthFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/metrics/1/blocking/plan?spid=55')
    );
    expect(mockAuthFetch).toHaveBeenCalledWith(
      expect.stringContaining('type=actual')
    );
  });

  it('highlights SQL keywords in expanded chain', async () => {
    mockFetch(sampleEvents);
    renderWithQuery(<BlockingHistory instanceId="1" range="1h" timeWindow={null} />);

    const spid = await screen.findByText('SPID 55');
    fireEvent.click(spid.closest('tr')!);

    // SQL keywords should be highlighted with text-blue-400
    await screen.findByText('Blocking Chain');
    const blueSpans = document.querySelectorAll('.text-blue-400');
    expect(blueSpans.length).toBeGreaterThan(0);
  });
});
