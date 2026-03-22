import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { Settings } from '../../pages/Settings';

vi.mock('@/lib/auth', () => ({
  authFetch: vi.fn(async (url: string) => {
    if (url.includes('/api/groups')) {
      return { ok: true, json: async () => [] };
    }
    if (url.includes('/api/settings')) {
      return {
        ok: true,
        json: async () => ({
          retention: { raw_days: 7, aggregate_5min_days: 30, aggregate_hourly_days: 365 },
          alertThresholds: {
            cpu_warning: { threshold: 75, cycles: 3 },
            cpu_critical: { threshold: 90, cycles: 3 },
            memory_critical: { available_mb: 512 },
            disk_warning: { used_pct: 90 },
            disk_critical: { used_pct: 95 },
            io_warning: { latency_ms: 20 },
            io_critical: { latency_ms: 50 },
            blocking_warning: { seconds: 60 },
            blocking_critical: { seconds: 300 },
            unreachable: { cycles: 3 },
          },
          collector: { workers: 40, interval_ms: 15000 },
        }),
      };
    }
    if (url.includes('/api/collector/status')) {
      return { ok: true, json: async () => ({ running: true, lastCycleMs: 500, lastCycleAt: new Date().toISOString(), instancesCount: 5, lastSuccess: 5, lastFailed: 0 }) };
    }
    if (url.includes('/api/instances')) {
      return { ok: true, json: async () => [] };
    }
    if (url.includes('/api/users')) {
      return { ok: true, json: async () => [] };
    }
    if (url.includes('/api/settings/webhook')) {
      return { ok: true, json: async () => ({ url: '', enabled: false }) };
    }
    return { ok: true, json: async () => ({}) };
  }),
}));

function renderSettings() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><Settings /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Settings', () => {
  it('renders all 5 tabs', () => {
    renderSettings();
    expect(screen.getByText('Groups')).toBeInTheDocument();
    expect(screen.getByText('Alerts')).toBeInTheDocument();
    expect(screen.getByText('Retention')).toBeInTheDocument();
    expect(screen.getByText('Users')).toBeInTheDocument();
    expect(screen.getByText('About')).toBeInTheDocument();
  });

  it('switches to Retention tab and shows policy', async () => {
    renderSettings();
    fireEvent.click(screen.getByText('Retention'));
    expect(await screen.findByText('7 days')).toBeInTheDocument();
    expect(screen.getByText('30 days')).toBeInTheDocument();
    expect(screen.getByText('1 year')).toBeInTheDocument();
  });

  it('switches to Alerts tab and shows thresholds', async () => {
    renderSettings();
    fireEvent.click(screen.getByText('Alerts'));
    expect(await screen.findByText('CPU')).toBeInTheDocument();
    expect(screen.getByText('Memory')).toBeInTheDocument();
    expect(screen.getByText('Disk')).toBeInTheDocument();
  });

  it('switches to About tab and shows collector status', async () => {
    renderSettings();
    fireEvent.click(screen.getByText('About'));
    expect(await screen.findByText('0.1.0')).toBeInTheDocument();
  });
});
