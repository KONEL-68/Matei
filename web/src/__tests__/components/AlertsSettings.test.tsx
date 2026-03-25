import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AlertsSettings } from '../../components/settings/AlertsSettings';
import { authFetch } from '@/lib/auth';

vi.mock('@/lib/auth', () => ({
  authFetch: vi.fn(async (url: string): Promise<Response> => {
    if (url === '/api/settings') {
      return {
        ok: true,
        json: async () => ({
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
        }),
      };
    }
    if (url === '/api/settings/webhook') {
      return {
        ok: true,
        json: async () => ({ url: 'https://hooks.slack.com/test', enabled: true }),
      };
    }
    return { ok: true, json: async () => ({}) };
  }),
}));

function renderWithQuery(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('AlertsSettings', () => {
  it('renders threshold table with all metrics', async () => {
    renderWithQuery(<AlertsSettings />);
    expect(await screen.findByText('CPU')).toBeInTheDocument();
    expect(screen.getByText('Memory')).toBeInTheDocument();
    expect(screen.getByText('Disk')).toBeInTheDocument();
    expect(screen.getByText('File I/O Latency')).toBeInTheDocument();
    expect(screen.getByText('Blocking')).toBeInTheDocument();
    expect(screen.getByText('Unreachable')).toBeInTheDocument();
  });

  it('shows threshold values from API', async () => {
    renderWithQuery(<AlertsSettings />);
    expect(await screen.findByText('>= 75% (3 cycles)')).toBeInTheDocument();
    expect(screen.getByText('>= 90% (3 cycles)')).toBeInTheDocument();
    expect(screen.getByText('< 512 MB available')).toBeInTheDocument();
    expect(screen.getByText('> 90% used')).toBeInTheDocument();
    expect(screen.getByText('> 95% used')).toBeInTheDocument();
  });

  it('renders table column headers', async () => {
    renderWithQuery(<AlertsSettings />);
    expect(await screen.findByText('Metric')).toBeInTheDocument();
    expect(screen.getByText('Warning')).toBeInTheDocument();
    expect(screen.getByText('Critical')).toBeInTheDocument();
  });

  it('renders webhook configuration section', async () => {
    renderWithQuery(<AlertsSettings />);
    expect(await screen.findByText('Webhook Notifications')).toBeInTheDocument();
    expect(screen.getByText('Enabled')).toBeInTheDocument();
    expect(screen.getByText('Save')).toBeInTheDocument();
    expect(screen.getByText('Test')).toBeInTheDocument();
  });

  it('shows loading state initially', () => {
    const mockFetch = vi.mocked(authFetch);
    mockFetch.mockImplementation(() => new Promise(() => {}));
    renderWithQuery(<AlertsSettings />);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });
});
