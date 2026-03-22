import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { Alerts } from '../../pages/Alerts';

vi.mock('@/lib/auth', () => ({
  authFetch: vi.fn(async () => ({
    ok: true,
    json: async () => [
      { id: 1, instance_id: 1, instance_name: 'Prod-1', alert_type: 'cpu_critical', severity: 'critical', message: 'CPU > 90% for 3 cycles', acknowledged: false, created_at: new Date().toISOString() },
      { id: 2, instance_id: 2, instance_name: 'Dev-1', alert_type: 'disk_warning', severity: 'warning', message: 'Disk > 90%', acknowledged: true, created_at: new Date().toISOString() },
    ],
  })),
}));

function renderAlerts() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><Alerts /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Alerts', () => {
  it('renders alerts page title', () => {
    renderAlerts();
    expect(screen.getByText('Alerts')).toBeInTheDocument();
  });

  it('renders severity filter', () => {
    renderAlerts();
    expect(screen.getByText('All Severities')).toBeInTheDocument();
  });

  it('renders alert rows', async () => {
    renderAlerts();
    expect(await screen.findByText('CPU > 90% for 3 cycles')).toBeInTheDocument();
    expect(screen.getByText('Disk > 90%')).toBeInTheDocument();
  });

  it('renders Investigate button on each alert', async () => {
    renderAlerts();
    const buttons = await screen.findAllByText('Investigate');
    expect(buttons).toHaveLength(2);
  });
});
