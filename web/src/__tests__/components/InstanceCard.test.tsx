import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { InstanceCard, type OverviewInstance } from '../../components/InstanceCard';

vi.mock('@/lib/auth', () => ({
  authFetch: vi.fn(async () => ({ ok: true, json: async () => ({}) })),
}));

function makeInstance(overrides: Partial<OverviewInstance> = {}): OverviewInstance {
  return {
    id: 1, name: 'PROD-SQL1', host: 'sql1', port: 1433, status: 'online',
    last_seen: '2026-03-22T10:00:00Z', group_id: 1, group_name: 'Production',
    cpu: { sql_cpu_pct: 45, other_process_cpu_pct: 10, system_idle_pct: 45 },
    memory: { os_total_memory_mb: 16384, os_available_memory_mb: 4096, sql_committed_mb: 8192, sql_target_mb: 12288 },
    health: { version: '16.0.4135.4', edition: 'Enterprise Edition', uptime_seconds: 86400 },
    top_waits: [{ wait_type: 'CXPACKET', wait_ms_per_sec: 12.5 }],
    total_wait_ms_per_sec: 150,
    disk_io_mb_per_sec: 5.3,
    alert_count: 0,
    first_alert_message: null,
    healthy_since: '2026-03-22T08:00:00Z',
    ...overrides,
  };
}

function renderCard(inst: OverviewInstance, onRefresh = vi.fn()) {
  return render(
    <MemoryRouter>
      <InstanceCard inst={inst} onRefresh={onRefresh} />
    </MemoryRouter>,
  );
}

describe('InstanceCard', () => {
  it('renders instance name and status dot', () => {
    renderCard(makeInstance());
    expect(screen.getByText('PROD-SQL1')).toBeInTheDocument();
    expect(screen.getByTestId('status-dot')).toHaveClass('bg-emerald-500');
  });

  it('renders 3 KPIs: waits, cpu, disk io', () => {
    renderCard(makeInstance());
    expect(screen.getByTestId('kpi-waits').textContent).toBe('150ms/s');
    expect(screen.getByTestId('kpi-cpu').textContent).toBe('45%');
    expect(screen.getByTestId('kpi-disk-io').textContent).toBe('5.3 MB/s');
  });

  it('shows healthy state with green bar when no alerts', () => {
    renderCard(makeInstance());
    const statusBar = screen.getByTestId('card-status-bar');
    expect(statusBar.textContent).toContain('Healthy');
    expect(statusBar.className).toContain('bg-emerald-50');
  });

  it('shows alert state with alert message and count', () => {
    renderCard(makeInstance({
      alert_count: 3,
      first_alert_message: 'CPU critical: 95%',
    }));
    const statusBar = screen.getByTestId('card-status-bar');
    expect(statusBar.textContent).toContain('CPU critical: 95%');
    expect(statusBar.textContent).toContain('+2 more');
  });

  it('shows unreachable status with red dot', () => {
    renderCard(makeInstance({ status: 'unreachable', health: null }));
    expect(screen.getByTestId('status-dot')).toHaveClass('bg-red-500');
  });

  it('formats waits as s/s when >= 1000', () => {
    renderCard(makeInstance({ total_wait_ms_per_sec: 1500 }));
    expect(screen.getByTestId('kpi-waits').textContent).toBe('1.5s/s');
  });

  it('shows dashes when no data available', () => {
    renderCard(makeInstance({ cpu: null, total_wait_ms_per_sec: null, disk_io_mb_per_sec: null }));
    expect(screen.getByTestId('kpi-waits').textContent).toBe('\u2014');
    expect(screen.getByTestId('kpi-cpu').textContent).toBe('\u2014');
    expect(screen.getByTestId('kpi-disk-io').textContent).toBe('\u2014');
  });

  it('shows subtitle with version info from health', () => {
    renderCard(makeInstance());
    expect(screen.getByText(/SQL Server.*Enterprise.*v16/)).toBeInTheDocument();
  });
});
