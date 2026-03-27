import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PermissionsTable } from '../../components/PermissionsTable';

vi.mock('@/lib/auth', () => ({
  authFetch: vi.fn(),
}));

import { authFetch } from '@/lib/auth';
const mockAuthFetch = vi.mocked(authFetch);

const mockPermissions = {
  collected_at: '2026-03-27T00:38:00Z',
  roles: [
    {
      role_name: 'sysadmin',
      windows_logins: 15,
      ad_accounts: 52,
      sql_logins: 8,
      members: [
        { login_name: 'DOMAIN\\admin1', login_type: 'Windows login' },
        { login_name: 'sa', login_type: 'SQL login' },
      ],
    },
    {
      role_name: 'serveradmin',
      windows_logins: 3,
      ad_accounts: 10,
      sql_logins: 1,
      members: [],
    },
  ],
};

function renderComponent(instanceId = '1') {
  mockAuthFetch.mockImplementation(async () => {
    return { ok: true, json: async () => mockPermissions } as Response;
  });

  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PermissionsTable instanceId={instanceId} />
    </QueryClientProvider>,
  );
}

describe('PermissionsTable', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('renders the collapsible section with Permissions title', () => {
    renderComponent();
    expect(screen.getByText('Permissions')).toBeInTheDocument();
  });

  it('shows loading spinner initially', () => {
    mockAuthFetch.mockImplementation(() => new Promise(() => {})); // never resolves
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <PermissionsTable instanceId="1" />
      </QueryClientProvider>,
    );
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('shows "No data available" when API returns null', async () => {
    mockAuthFetch.mockImplementation(async () => {
      return { ok: false, json: async () => null } as Response;
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <PermissionsTable instanceId="1" />
      </QueryClientProvider>,
    );
    expect(await screen.findByText('No data available')).toBeInTheDocument();
  });

  it('renders the sampled-at timestamp after data loads', async () => {
    renderComponent();
    expect(await screen.findByText(/Permissions sampled at/)).toBeInTheDocument();
  });

  it('renders role rows with correct counts', async () => {
    renderComponent();
    expect(await screen.findByText('sysadmin')).toBeInTheDocument();
    expect(screen.getByText('serveradmin')).toBeInTheDocument();
    expect(screen.getByText('15')).toBeInTheDocument();
    expect(screen.getByText('52')).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument();
  });

  it('expands role row to show members on click', async () => {
    renderComponent();
    const sysadminRow = await screen.findByTestId('role-row-sysadmin');
    fireEvent.click(sysadminRow);
    expect(await screen.findByText('DOMAIN\\admin1')).toBeInTheDocument();
    expect(screen.getByText('sa')).toBeInTheDocument();
    expect(screen.getByText('Windows login')).toBeInTheDocument();
    expect(screen.getByText('SQL login')).toBeInTheDocument();
  });

  it('shows "No members" for roles with empty members list', async () => {
    renderComponent();
    const serveradminRow = await screen.findByTestId('role-row-serveradmin');
    fireEvent.click(serveradminRow);
    expect(await screen.findByText('No members')).toBeInTheDocument();
  });

  it('collapses expanded role on second click', async () => {
    renderComponent();
    const sysadminRow = await screen.findByTestId('role-row-sysadmin');
    fireEvent.click(sysadminRow);
    expect(await screen.findByText('DOMAIN\\admin1')).toBeInTheDocument();
    fireEvent.click(sysadminRow);
    expect(screen.queryByText('DOMAIN\\admin1')).not.toBeInTheDocument();
  });

  it('fetches permissions with correct URL', () => {
    renderComponent('42');
    expect(mockAuthFetch).toHaveBeenCalledWith('/api/metrics/42/permissions');
  });

  it('renders table headers', async () => {
    renderComponent();
    expect(await screen.findByText('Access')).toBeInTheDocument();
    expect(screen.getByText('Windows logins')).toBeInTheDocument();
    expect(screen.getByText('Active Directory accounts')).toBeInTheDocument();
    expect(screen.getByText('SQL logins')).toBeInTheDocument();
  });
});
