import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { UsersSettings } from '../../components/settings/UsersSettings';

vi.mock('@/lib/auth', () => ({
  authFetch: vi.fn(async (url: string) => {
    if (url === '/api/users') {
      return {
        ok: true,
        json: async () => [
          { id: 1, username: 'admin', role: 'admin', created_at: '2026-03-22T00:00:00Z', last_login: '2026-03-22T12:00:00Z' },
          { id: 2, username: 'viewer', role: 'admin', created_at: '2026-03-22T00:00:00Z', last_login: null },
        ],
      };
    }
    return { ok: true, json: async () => ({}) };
  }),
}));

function renderWithQuery(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('UsersSettings', () => {
  it('renders user list', async () => {
    renderWithQuery(<UsersSettings />);
    expect(await screen.findByText('admin')).toBeInTheDocument();
    expect(screen.getByText('viewer')).toBeInTheDocument();
    expect(screen.getByText('Never')).toBeInTheDocument();
  });

  it('shows add user form', async () => {
    renderWithQuery(<UsersSettings />);
    expect(await screen.findByPlaceholderText('username')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add User' })).toBeInTheDocument();
  });

  it('shows change password section', async () => {
    renderWithQuery(<UsersSettings />);
    expect(await screen.findByText('Change Password')).toBeInTheDocument();
  });

  it('shows delete buttons for each user', async () => {
    renderWithQuery(<UsersSettings />);
    const deleteButtons = await screen.findAllByText('Delete');
    expect(deleteButtons).toHaveLength(2);
  });
});
