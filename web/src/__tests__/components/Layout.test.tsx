import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { Layout } from '../../components/Layout';

vi.mock('@/lib/auth', () => ({
  authFetch: vi.fn(async () => ({ ok: true, json: async () => ({ count: 3 }) })),
  logout: vi.fn(),
}));

vi.mock('@/lib/theme', () => ({
  useTheme: () => ({ theme: 'dark', toggleTheme: vi.fn() }),
}));

vi.mock('@/lib/utils', () => ({
  cn: (...args: string[]) => args.filter(Boolean).join(' '),
}));

function renderLayout() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/dashboard']}>
        <Layout />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Layout', () => {
  it('renders Matei branding and subtitle', () => {
    renderLayout();
    expect(screen.getByText('Matei')).toBeInTheDocument();
    expect(screen.getByText('SQL Server Monitoring')).toBeInTheDocument();
  });

  it('renders all navigation items', () => {
    renderLayout();
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Instances')).toBeInTheDocument();
    expect(screen.getByText('Alerts')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  it('shows alert count badge on Alerts nav item', async () => {
    renderLayout();
    expect(await screen.findByText('3')).toBeInTheDocument();
  });

  it('renders theme toggle and logout buttons', () => {
    renderLayout();
    expect(screen.getByText('Light mode')).toBeInTheDocument();
    expect(screen.getByText('Logout')).toBeInTheDocument();
  });

  it('calls logout on logout button click', async () => {
    const { logout } = await import('@/lib/auth');
    renderLayout();
    fireEvent.click(screen.getByText('Logout'));
    expect(logout).toHaveBeenCalled();
  });
});
