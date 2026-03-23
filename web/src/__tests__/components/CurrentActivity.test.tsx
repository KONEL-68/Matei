import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CurrentActivity } from '../../components/CurrentActivity';

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

async function waitForSessions() {
  // Wait for session data to load by checking the session count
  await waitFor(() => {
    const badge = screen.getByTestId('session-count');
    expect(badge.textContent).not.toBe('0 sessions');
  });
}

const baseSessions = [
  {
    session_id: 51, request_id: 1, blocking_session_id: null,
    session_status: 'sleeping', request_status: 'running',
    login_name: 'app_user', host_name: 'web01', program_name: 'MyApp',
    database_name: 'AppDB', command: 'SELECT', wait_type: null,
    wait_time_ms: null, wait_resource: null, elapsed_time_ms: 2500,
    cpu_time_ms: 1200, logical_reads: 5000, writes: 10,
    open_transaction_count: 1, granted_memory_kb: 1024, current_statement: 'SELECT * FROM users',
  },
  {
    session_id: 52, request_id: 1, blocking_session_id: 51,
    session_status: 'suspended', request_status: 'suspended',
    login_name: 'report_user', host_name: 'web02', program_name: 'Reports',
    database_name: 'AppDB', command: 'UPDATE', wait_type: 'LCK_M_X',
    wait_time_ms: 8000, wait_resource: 'OBJECT: AppDB.dbo.users', elapsed_time_ms: 10000,
    cpu_time_ms: 200, logical_reads: 100, writes: 0,
    open_transaction_count: 1, granted_memory_kb: 512, current_statement: 'UPDATE users SET active = 0',
  },
  {
    session_id: 53, request_id: null, blocking_session_id: null,
    session_status: 'sleeping', request_status: null,
    login_name: 'sa', host_name: 'sql01', program_name: 'SSMS',
    database_name: 'master', command: null, wait_type: 'WAITFOR',
    wait_time_ms: 60000, wait_resource: null, elapsed_time_ms: 60000,
    cpu_time_ms: 0, logical_reads: 0, writes: 0,
    open_transaction_count: 0, granted_memory_kb: null, current_statement: 'WAITFOR DELAY',
  },
  {
    session_id: 54, request_id: 1, blocking_session_id: null,
    session_status: 'running', request_status: 'running',
    login_name: 'app_user', host_name: 'web03', program_name: 'MyApp',
    database_name: 'LogDB', command: 'INSERT', wait_type: null,
    wait_time_ms: null, wait_resource: null, elapsed_time_ms: 500,
    cpu_time_ms: 400, logical_reads: 200, writes: 50,
    open_transaction_count: 1, granted_memory_kb: 256, current_statement: 'INSERT INTO logs VALUES(...)',
  },
  {
    session_id: 55, request_id: 1, blocking_session_id: null,
    session_status: 'running', request_status: 'running',
    login_name: 'matei_svc', host_name: 'monitor01', program_name: 'Matei Monitor',
    database_name: 'master', command: 'SELECT', wait_type: null,
    wait_time_ms: null, wait_resource: null, elapsed_time_ms: 100,
    cpu_time_ms: 50, logical_reads: 10, writes: 0,
    open_transaction_count: 0, granted_memory_kb: 128, current_statement: 'SELECT @@VERSION',
  },
];

function mockSessions(sessions = baseSessions) {
  mockAuthFetch.mockImplementation(async () => ({
    ok: true,
    json: async () => sessions,
  } as Response));
}

describe('CurrentActivity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders session count excluding WAITFOR sessions', async () => {
    mockSessions();
    renderWithQuery(<CurrentActivity instanceId="1" />);
    await waitForSessions();

    const badge = screen.getByTestId('session-count');
    // 4 sessions total, 1 WAITFOR -> 3 sessions
    expect(badge.textContent).toContain('3 sessions');
  });

  it('hides WAITFOR sessions by default', async () => {
    mockSessions();
    renderWithQuery(<CurrentActivity instanceId="1" />);
    await waitForSessions();

    // WAITFOR session (53) should be hidden
    expect(screen.queryByTestId('session-row-53')).not.toBeInTheDocument();
    // Non-WAITFOR sessions should be visible
    expect(screen.getByTestId('session-row-51')).toBeInTheDocument();
  });

  it('shows WAITFOR sessions when "show system sessions" is toggled', async () => {
    mockSessions();
    renderWithQuery(<CurrentActivity instanceId="1" />);
    await waitForSessions();

    const toggle = screen.getByTestId('show-system-toggle');
    fireEvent.click(toggle);

    expect(screen.getByTestId('session-row-53')).toBeInTheDocument();
  });

  it('filters by status', async () => {
    mockSessions();
    renderWithQuery(<CurrentActivity instanceId="1" />);
    await waitForSessions();

    const statusSelect = screen.getByTestId('filter-status');
    fireEvent.change(statusSelect, { target: { value: 'running' } });

    // Only sessions 51 (request_status=running) and 54 (request_status=running) should remain
    expect(screen.getByTestId('session-row-51')).toBeInTheDocument();
    expect(screen.getByTestId('session-row-54')).toBeInTheDocument();
    expect(screen.queryByTestId('session-row-52')).not.toBeInTheDocument();
  });

  it('filters by blocking (is blocked)', async () => {
    mockSessions();
    renderWithQuery(<CurrentActivity instanceId="1" />);
    await waitForSessions();

    const blockingSelect = screen.getByTestId('filter-blocking');
    fireEvent.change(blockingSelect, { target: { value: 'is_blocked' } });

    // Only session 52 (blocked by 51) should remain
    expect(screen.getByTestId('session-row-52')).toBeInTheDocument();
    expect(screen.queryByTestId('session-row-51')).not.toBeInTheDocument();
    expect(screen.queryByTestId('session-row-54')).not.toBeInTheDocument();
  });

  it('filters by blocking (is blocker)', async () => {
    mockSessions();
    renderWithQuery(<CurrentActivity instanceId="1" />);
    await waitForSessions();

    const blockingSelect = screen.getByTestId('filter-blocking');
    fireEvent.change(blockingSelect, { target: { value: 'is_blocker' } });

    // Only session 51 (blocker of 52) should remain
    expect(screen.getByTestId('session-row-51')).toBeInTheDocument();
    expect(screen.queryByTestId('session-row-52')).not.toBeInTheDocument();
  });

  it('filters by elapsed time', async () => {
    mockSessions();
    renderWithQuery(<CurrentActivity instanceId="1" />);
    await waitForSessions();

    const elapsedSelect = screen.getByTestId('filter-elapsed');
    fireEvent.change(elapsedSelect, { target: { value: '5s' } });

    // Session 52 (10000ms) should remain, 51 (2500ms) should NOT remain since < 5000
    expect(screen.getByTestId('session-row-52')).toBeInTheDocument();
    expect(screen.queryByTestId('session-row-54')).not.toBeInTheDocument(); // 500ms
  });

  it('filters by login', async () => {
    mockSessions();
    renderWithQuery(<CurrentActivity instanceId="1" />);
    await waitForSessions();

    const loginSelect = screen.getByTestId('filter-login');
    fireEvent.change(loginSelect, { target: { value: 'report_user' } });

    expect(screen.getByTestId('session-row-52')).toBeInTheDocument();
    expect(screen.queryByTestId('session-row-51')).not.toBeInTheDocument();
  });

  it('filters by database', async () => {
    mockSessions();
    renderWithQuery(<CurrentActivity instanceId="1" />);
    await waitForSessions();

    const dbSelect = screen.getByTestId('filter-database');
    fireEvent.change(dbSelect, { target: { value: 'LogDB' } });

    expect(screen.getByTestId('session-row-54')).toBeInTheDocument();
    expect(screen.queryByTestId('session-row-51')).not.toBeInTheDocument();
  });

  it('clears all filters', async () => {
    mockSessions();
    renderWithQuery(<CurrentActivity instanceId="1" />);
    await waitForSessions();

    // Apply a filter
    const statusSelect = screen.getByTestId('filter-status');
    fireEvent.change(statusSelect, { target: { value: 'running' } });
    expect(screen.queryByTestId('session-row-52')).not.toBeInTheDocument();

    // Clear
    fireEvent.click(screen.getByTestId('clear-filters'));

    // All non-WAITFOR sessions should be back
    expect(screen.getByTestId('session-row-51')).toBeInTheDocument();
    expect(screen.getByTestId('session-row-52')).toBeInTheDocument();
    expect(screen.getByTestId('session-row-54')).toBeInTheDocument();
  });

  it('expands row to show full details', async () => {
    mockSessions();
    renderWithQuery(<CurrentActivity instanceId="1" />);
    await waitForSessions();

    fireEvent.click(screen.getByTestId('session-row-52'));

    const detail = screen.getByTestId('session-detail-52');
    expect(detail).toBeInTheDocument();
    expect(detail.textContent).toContain('LCK_M_X');
    expect(detail.textContent).toContain('OBJECT: AppDB.dbo.users');
  });

  it('shows auto-refresh toggle', async () => {
    mockSessions();
    renderWithQuery(<CurrentActivity instanceId="1" />);

    const toggle = await screen.findByTestId('auto-refresh-toggle');
    expect(toggle.textContent).toContain('Auto-refresh ON');

    fireEvent.click(toggle);
    expect(toggle.textContent).toContain('Auto-refresh OFF');
  });

  it('shows last updated timestamp', async () => {
    mockSessions();
    renderWithQuery(<CurrentActivity instanceId="1" />);

    const lastUpdated = await screen.findByTestId('last-updated');
    expect(lastUpdated.textContent).toContain('Last updated:');
  });

  it('hides monitoring sessions (Matei Monitor) by default', async () => {
    mockSessions();
    renderWithQuery(<CurrentActivity instanceId="1" />);
    await waitForSessions();

    expect(screen.queryByTestId('session-row-55')).not.toBeInTheDocument();
  });

  it('shows monitoring sessions when "Show monitoring sessions" is toggled', async () => {
    mockSessions();
    renderWithQuery(<CurrentActivity instanceId="1" />);
    await waitForSessions();

    const toggle = screen.getByTestId('show-monitoring-toggle');
    fireEvent.click(toggle);

    expect(screen.getByTestId('session-row-55')).toBeInTheDocument();
  });

  it('excludes monitoring sessions from session count', async () => {
    mockSessions();
    renderWithQuery(<CurrentActivity instanceId="1" />);
    await waitForSessions();

    const badge = screen.getByTestId('session-count');
    // 5 total: 51, 52, 53 (WAITFOR), 54, 55 (monitor) -> 3 counted
    expect(badge.textContent).toContain('3 sessions');
  });
});
