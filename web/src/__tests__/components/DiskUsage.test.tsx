import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/lib/auth', () => ({
  authFetch: vi.fn(),
}));

vi.mock('recharts', () => ({
  LineChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Line: () => null,
  Tooltip: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { authFetch } from '@/lib/auth';
import { DiskUsage } from '../../components/DiskUsage';

const mockAuthFetch = authFetch as ReturnType<typeof vi.fn>;

function renderWithQuery(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

function makeDiskVolume(overrides: Record<string, unknown> = {}) {
  return {
    volume_mount_point: 'C:\\',
    logical_volume_name: 'System',
    total_mb: 512000,
    available_mb: 256000,
    used_mb: 256000,
    used_pct: 50,
    avg_read_latency_ms: 1.5,
    avg_write_latency_ms: 2.3,
    transfers_per_sec: 120.5,
    sparklines: {
      read_latency: [
        { t: 1, v: 1.0 },
        { t: 2, v: 1.5 },
        { t: 3, v: 2.0 },
      ],
      write_latency: [
        { t: 1, v: 2.0 },
        { t: 2, v: 2.3 },
        { t: 3, v: 2.5 },
      ],
      transfers: [
        { t: 1, v: 100 },
        { t: 2, v: 120 },
        { t: 3, v: 130 },
      ],
    },
    ...overrides,
  };
}

describe('DiskUsage', () => {
  beforeEach(() => {
    mockAuthFetch.mockReset();
  });

  it('shows loading state initially', () => {
    // Never resolve the fetch so we stay in loading state
    mockAuthFetch.mockReturnValue(new Promise(() => {}));
    renderWithQuery(<DiskUsage instanceId="1" timeWindow={null} />);

    expect(screen.getByText('Loading disk usage...')).toBeInTheDocument();
  });

  it('shows empty state when API returns no volumes', async () => {
    mockAuthFetch.mockResolvedValueOnce({ ok: true, json: async () => [] });
    renderWithQuery(<DiskUsage instanceId="1" timeWindow={null} />);

    expect(await screen.findByText('No disk data available.')).toBeInTheDocument();
  });

  it('shows empty state when API returns error', async () => {
    mockAuthFetch.mockResolvedValueOnce({ ok: false });
    renderWithQuery(<DiskUsage instanceId="1" timeWindow={null} />);

    expect(await screen.findByText('No disk data available.')).toBeInTheDocument();
  });

  it('renders table headers when volumes exist', async () => {
    mockAuthFetch.mockResolvedValueOnce({ ok: true, json: async () => [makeDiskVolume()] });
    renderWithQuery(<DiskUsage instanceId="1" timeWindow={null} />);

    expect(await screen.findByText('Disk')).toBeInTheDocument();
    expect(screen.getByText('Space used')).toBeInTheDocument();
    expect(screen.getByText('Avg. read time')).toBeInTheDocument();
    expect(screen.getByText('Avg. write time')).toBeInTheDocument();
    expect(screen.getByText('Transfers/sec')).toBeInTheDocument();
  });

  it('renders disk label with logical volume name and mount point', async () => {
    mockAuthFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [makeDiskVolume({ volume_mount_point: 'D:\\', logical_volume_name: 'Data' })],
    });
    renderWithQuery(<DiskUsage instanceId="1" timeWindow={null} />);

    expect(await screen.findByText('Data (D:)')).toBeInTheDocument();
  });

  it('renders mount point only when no logical volume name', async () => {
    mockAuthFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [makeDiskVolume({ volume_mount_point: 'E:\\', logical_volume_name: '' })],
    });
    renderWithQuery(<DiskUsage instanceId="1" timeWindow={null} />);

    expect(await screen.findByText('E:')).toBeInTheDocument();
  });

  it('formats disk size in GB', async () => {
    mockAuthFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [makeDiskVolume({ total_mb: 512000, available_mb: 256000 })],
    });
    renderWithQuery(<DiskUsage instanceId="1" timeWindow={null} />);

    expect(await screen.findByText(/250\.00 GB free of 500\.00 GB/)).toBeInTheDocument();
  });

  it('formats disk size in TB for large volumes', async () => {
    mockAuthFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [makeDiskVolume({ total_mb: 2097152, available_mb: 1048576 })],
    });
    renderWithQuery(<DiskUsage instanceId="1" timeWindow={null} />);

    expect(await screen.findByText(/1\.00 TB free of 2\.00 TB/)).toBeInTheDocument();
  });

  it('formats disk size in MB for small volumes', async () => {
    mockAuthFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [makeDiskVolume({ total_mb: 500, available_mb: 200 })],
    });
    renderWithQuery(<DiskUsage instanceId="1" timeWindow={null} />);

    expect(await screen.findByText(/200 MB free of 500 MB/)).toBeInTheDocument();
  });

  it('sorts volumes with logical names before unnamed, then alphabetically by mount point', async () => {
    const volumes = [
      makeDiskVolume({ volume_mount_point: 'E:\\', logical_volume_name: '' }),
      makeDiskVolume({ volume_mount_point: 'D:\\', logical_volume_name: 'Data' }),
      makeDiskVolume({ volume_mount_point: 'C:\\', logical_volume_name: 'System' }),
    ];
    mockAuthFetch.mockResolvedValueOnce({ ok: true, json: async () => volumes });
    renderWithQuery(<DiskUsage instanceId="1" timeWindow={null} />);

    const cells = await screen.findAllByRole('cell');
    // First column cells are disk labels
    const diskLabels = cells
      .filter((_, i) => i % 5 === 0) // first column of each row
      .map((c) => c.textContent);

    // Named volumes first (C:\, D:\) sorted by mount point, then unnamed (E:\)
    expect(diskLabels).toEqual(['System (C:)', 'Data (D:)', 'E:']);
  });

  it('passes timeWindow params to API when provided', async () => {
    mockAuthFetch.mockResolvedValue({ ok: true, json: async () => [] });
    renderWithQuery(
      <DiskUsage instanceId="42" timeWindow={{ from: '2026-01-01T00:00:00Z', to: '2026-01-02T00:00:00Z' }} />,
    );

    await screen.findByText('No disk data available.');

    const url = mockAuthFetch.mock.calls[0][0] as string;
    expect(url).toContain('/api/metrics/42/disk-usage?from=');
    expect(url).toContain('from=2026-01-01T00%3A00%3A00Z');
    expect(url).toContain('to=2026-01-02T00%3A00%3A00Z');
  });

  it('uses default range=1h when no timeWindow provided', async () => {
    mockAuthFetch.mockResolvedValueOnce({ ok: true, json: async () => [] });
    renderWithQuery(<DiskUsage instanceId="5" timeWindow={null} />);

    await screen.findByText('No disk data available.');

    expect(mockAuthFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/metrics/5/disk-usage?range=1h'),
    );
  });
});
