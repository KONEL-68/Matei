import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GroupsSettings } from '../../components/settings/GroupsSettings';

vi.mock('@/lib/auth', () => ({
  authFetch: vi.fn(async (url: string) => {
    if (url === '/api/groups') {
      return {
        ok: true,
        json: async () => [
          { id: 1, name: 'Production', description: 'Prod servers', position: 1, instance_count: 3, created_at: '2026-03-22T00:00:00Z' },
          { id: 2, name: 'Development', description: null, position: 2, instance_count: 0, created_at: '2026-03-22T00:00:00Z' },
        ],
      };
    }
    if (url === '/api/instances') {
      return {
        ok: true,
        json: async () => [
          { id: 1, name: 'Prod-1', host: 'sql1', group_id: 1 },
          { id: 2, name: 'Dev-1', host: 'sql2', group_id: null },
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

describe('GroupsSettings', () => {
  it('renders group list', async () => {
    renderWithQuery(<GroupsSettings />);
    expect(await screen.findByText('Production')).toBeInTheDocument();
    expect(screen.getByText('Development')).toBeInTheDocument();
  });

  it('shows instance count for each group', async () => {
    renderWithQuery(<GroupsSettings />);
    expect(await screen.findByText('3 instances')).toBeInTheDocument();
    expect(screen.getByText('0 instances')).toBeInTheDocument();
  });

  it('shows Add Group button', async () => {
    renderWithQuery(<GroupsSettings />);
    expect(await screen.findByText('Add Group')).toBeInTheDocument();
  });

  it('shows form when Add Group is clicked', async () => {
    renderWithQuery(<GroupsSettings />);
    const addBtn = await screen.findByText('Add Group');
    fireEvent.click(addBtn);
    expect(screen.getByText('New Group')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Production')).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
    expect(screen.getByText('Create')).toBeInTheDocument();
  });

  it('shows Edit and Delete buttons for each group', async () => {
    renderWithQuery(<GroupsSettings />);
    const editButtons = await screen.findAllByText('Edit');
    const deleteButtons = screen.getAllByText('Delete');
    expect(editButtons).toHaveLength(2);
    expect(deleteButtons).toHaveLength(2);
  });

  it('shows description when present', async () => {
    renderWithQuery(<GroupsSettings />);
    expect(await screen.findByText('Prod servers')).toBeInTheDocument();
  });
});
