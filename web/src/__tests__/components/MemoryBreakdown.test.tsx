import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryBreakdown } from '../../components/MemoryBreakdown';

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

describe('MemoryBreakdown', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows "Memory Surplus" with green when deficit <= 0 (committed < target)', async () => {
    mockAuthFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        total_mb: 8192,
        target_mb: 10240,
        stolen_mb: 2048,
        database_cache_mb: 4096,
        deficit_mb: -2048,
      }),
    } as Response);

    renderWithQuery(<MemoryBreakdown instanceId="1" />);

    expect(await screen.findByText('Memory Surplus')).toBeInTheDocument();
    // Should NOT show "Memory Deficit"
    expect(screen.queryByText('Memory Deficit')).not.toBeInTheDocument();
  });

  it('shows "Memory Deficit" with red when deficit > 0 (committed > target)', async () => {
    mockAuthFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        total_mb: 10240,
        target_mb: 8192,
        stolen_mb: 2048,
        database_cache_mb: 4096,
        deficit_mb: 2048,
      }),
    } as Response);

    renderWithQuery(<MemoryBreakdown instanceId="1" />);

    expect(await screen.findByText('Memory Deficit')).toBeInTheDocument();
    expect(screen.queryByText('Memory Surplus')).not.toBeInTheDocument();
  });

  it('renders 5 progress bars evenly distributed', async () => {
    mockAuthFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        total_mb: 16384,
        target_mb: 14336,
        stolen_mb: 3096,
        database_cache_mb: 6800,
        deficit_mb: 2048,
      }),
    } as Response);

    renderWithQuery(<MemoryBreakdown instanceId="1" />);

    // Wait for data to load
    await screen.findByText('Total Server Memory');

    // All 5 labels should be present
    expect(screen.getByText('Total Server Memory')).toBeInTheDocument();
    expect(screen.getByText('Target Server Memory')).toBeInTheDocument();
    expect(screen.getByText('Stolen Server Memory')).toBeInTheDocument();
    expect(screen.getByText('Database Cache Memory')).toBeInTheDocument();
    expect(screen.getByText('Memory Deficit')).toBeInTheDocument();
  });

  it('uses flex-col justify-evenly layout (no large empty space)', async () => {
    mockAuthFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        total_mb: 8192,
        target_mb: 8192,
        stolen_mb: 1024,
        database_cache_mb: 4096,
        deficit_mb: 0,
      }),
    } as Response);

    const { container } = renderWithQuery(<MemoryBreakdown instanceId="1" />);

    await screen.findByText('Total Server Memory');

    // The card should NOT have h-full class
    const card = container.querySelector('[data-testid="memory-breakdown"]');
    expect(card).toBeInTheDocument();
    expect(card?.className).not.toContain('h-full');

    // The bars container should use justify-evenly
    const barsContainer = card?.querySelector('.justify-evenly');
    expect(barsContainer).toBeInTheDocument();
  });
});
