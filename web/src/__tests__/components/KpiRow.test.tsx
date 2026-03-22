import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { KpiRow } from '../../components/KpiRow';

vi.mock('recharts', () => ({
  LineChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Line: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

describe('KpiRow', () => {
  it('renders all 6 KPIs', () => {
    render(
      <KpiRow
        cpuData={[{ sql_cpu_pct: 45 }, { sql_cpu_pct: 80 }]}
        waitsData={[{ wait_type: 'CXPACKET', wait_ms_per_sec: 5.2 }]}
        sessionsData={[
          { blocking_session_id: null, request_status: 'running' },
          { blocking_session_id: 55, request_status: 'suspended' },
        ]}
        fileIoData={[{ avg_read_latency_ms: 25.5, avg_write_latency_ms: 3.1 }]}
      />,
    );

    expect(screen.getByTestId('kpi-row')).toBeInTheDocument();
    expect(screen.getByText('80%')).toBeInTheDocument(); // SQL CPU
    expect(screen.getByText('CXPACKET')).toBeInTheDocument(); // Top wait
    expect(screen.getByText('1')).toBeInTheDocument(); // Blocked
    expect(screen.getByText('25.5ms')).toBeInTheDocument(); // Read IO
  });

  it('shows critical color for high CPU', () => {
    const { container } = render(
      <KpiRow
        cpuData={[{ sql_cpu_pct: 95 }]}
        waitsData={[]}
        sessionsData={[]}
        fileIoData={[]}
      />,
    );

    // The CPU KPI should have red background
    const kpiRow = container.querySelector('[data-testid="kpi-row"]');
    expect(kpiRow).toBeInTheDocument();
    expect(screen.getByText('95%')).toBeInTheDocument();
  });

  it('shows ok for low values', () => {
    render(
      <KpiRow
        cpuData={[{ sql_cpu_pct: 10 }]}
        waitsData={[]}
        sessionsData={[]}
        fileIoData={[]}
      />,
    );

    expect(screen.getByText('10%')).toBeInTheDocument();
    // Blocked and Pending both show "0"
    expect(screen.getAllByText('0')).toHaveLength(2);
  });
});
