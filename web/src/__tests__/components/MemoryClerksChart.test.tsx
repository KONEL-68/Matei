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
  Legend: () => null,
  Cell: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { authFetch } from '@/lib/auth';
const mockAuthFetch = vi.mocked(authFetch);

const mockClerks = [
  { bucket: '2026-03-25T10:00:00Z', clerk_type: 'MEMORYCLERK_SQLBUFFERPOOL', size_mb: 4096 },
  { bucket: '2026-03-25T10:00:00Z', clerk_type: 'CACHESTORE_SQLCP', size_mb: 512 },
  { bucket: '2026-03-25T10:00:00Z', clerk_type: 'OBJECTSTORE_LOCK_MANAGER', size_mb: 128 },
  { bucket: '2026-03-25T10:00:00Z', clerk_type: 'MEMORYCLERK_SQLQUERYPLAN', size_mb: 256 },
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

  it('renders the title', async () => {
    mockAuthFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockClerks,
    } as Response);

    renderWithQuery(<MemoryClerksChart instanceId="1" rangeParams="range=1h" />);
    expect(await screen.findByText('Memory Clerks (MB)')).toBeInTheDocument();
  });

  it('renders the bar chart when data is loaded', async () => {
    mockAuthFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockClerks,
    } as Response);

    renderWithQuery(<MemoryClerksChart instanceId="1" rangeParams="range=1h" />);
    expect(await screen.findByTestId('bar-chart')).toBeInTheDocument();
  });

  it('shows "No data" when API returns empty array', async () => {
    mockAuthFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    } as Response);

    renderWithQuery(<MemoryClerksChart instanceId="1" rangeParams="range=1h" />);
    expect(await screen.findByText('No data')).toBeInTheDocument();
  });

  it('shows "No data" on fetch failure (returns empty on !ok)', async () => {
    mockAuthFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => [],
    } as Response);

    renderWithQuery(<MemoryClerksChart instanceId="1" rangeParams="range=1h" />);
    expect(await screen.findByText('No data')).toBeInTheDocument();
  });

  it('calls authFetch with the correct URL', () => {
    mockAuthFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockClerks,
    } as Response);

    renderWithQuery(<MemoryClerksChart instanceId="42" rangeParams="range=1h" />);
    expect(mockAuthFetch).toHaveBeenCalledWith('/api/metrics/42/memory-clerks?range=1h');
  });

  it('has the data-testid attribute on container', async () => {
    mockAuthFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    } as Response);

    renderWithQuery(<MemoryClerksChart instanceId="1" rangeParams="range=1h" />);
    expect(await screen.findByTestId('memory-clerks-chart')).toBeInTheDocument();
  });
});
