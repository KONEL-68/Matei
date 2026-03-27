import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryClerksChart } from '../../components/MemoryClerksChart';

vi.mock('@/lib/auth', () => ({
  authFetch: vi.fn(),
}));

vi.mock('@/lib/theme', () => ({
  useTheme: () => ({ theme: 'dark', toggleTheme: () => {} }),
}));

// Mock Recharts to avoid SVG rendering issues in jsdom
vi.mock('recharts', () => ({
  BarChart: ({ children }: { children: React.ReactNode }) => <div data-testid="bar-chart">{children}</div>,
  Bar: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  Cell: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { authFetch } from '@/lib/auth';
const mockAuthFetch = vi.mocked(authFetch);

const mockClerks = [
  { type: 'MEMORYCLERK_SQLBUFFERPOOL', size_mb: 4096 },
  { type: 'CACHESTORE_SQLCP', size_mb: 512 },
  { type: 'OBJECTSTORE_LOCK_MANAGER', size_mb: 128 },
  { type: 'MEMORYCLERK_SQLQUERYPLAN', size_mb: 256 },
];

function renderWithQuery(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

describe('MemoryClerksChart', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the title', () => {
    mockAuthFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockClerks,
    } as Response);

    renderWithQuery(<MemoryClerksChart instanceId="1" />);
    expect(screen.getByText('Memory Clerks')).toBeInTheDocument();
  });

  it('renders the bar chart when data is loaded', async () => {
    mockAuthFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockClerks,
    } as Response);

    renderWithQuery(<MemoryClerksChart instanceId="1" />);
    expect(await screen.findByTestId('bar-chart')).toBeInTheDocument();
  });

  it('shows loading state initially', () => {
    // Never resolve to keep loading state
    mockAuthFetch.mockReturnValueOnce(new Promise(() => {}));

    renderWithQuery(<MemoryClerksChart instanceId="1" />);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('shows error message on fetch failure', async () => {
    mockAuthFetch.mockRejectedValueOnce(new Error('Network error'));

    renderWithQuery(<MemoryClerksChart instanceId="1" />);
    expect(await screen.findByText('Failed to load memory clerks')).toBeInTheDocument();
  });

  it('shows "No data" when API returns empty array', async () => {
    mockAuthFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    } as Response);

    renderWithQuery(<MemoryClerksChart instanceId="1" />);
    expect(await screen.findByText('No data')).toBeInTheDocument();
  });

  it('calls authFetch with the correct URL', () => {
    mockAuthFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockClerks,
    } as Response);

    renderWithQuery(<MemoryClerksChart instanceId="42" />);
    expect(mockAuthFetch).toHaveBeenCalledWith('/api/metrics/42/live/memory-clerks');
  });

  it('has the data-testid attribute on container', () => {
    mockAuthFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockClerks,
    } as Response);

    renderWithQuery(<MemoryClerksChart instanceId="1" />);
    expect(screen.getByTestId('memory-clerks-chart')).toBeInTheDocument();
  });
});
