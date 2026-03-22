import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { KpiRow } from '../../components/KpiRow';

vi.mock('recharts', () => ({
  LineChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Line: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

describe('KpiRow', () => {
  it('renders all 4 KPIs from perf_counters', () => {
    render(
      <KpiRow
        perfCounters={{
          latest: [
            { counter_name: 'Batch Requests/sec', cntr_value: 250 },
            { counter_name: 'User Connections', cntr_value: 42 },
            { counter_name: 'Deadlocks/sec', cntr_value: 0 },
            { counter_name: 'Page life expectancy', cntr_value: 5000 },
          ],
          series: [],
        }}
      />,
    );

    expect(screen.getByTestId('kpi-row')).toBeInTheDocument();
    expect(screen.getByText('250')).toBeInTheDocument(); // Batch Req/s
    expect(screen.getByText('42')).toBeInTheDocument(); // Connections
    expect(screen.getByText('0.00')).toBeInTheDocument(); // Deadlocks
    expect(screen.getByText('1.4h')).toBeInTheDocument(); // PLE = 5000s = 1.4h
  });

  it('shows critical for high deadlocks', () => {
    render(
      <KpiRow
        perfCounters={{
          latest: [
            { counter_name: 'Batch Requests/sec', cntr_value: 100 },
            { counter_name: 'User Connections', cntr_value: 10 },
            { counter_name: 'Deadlocks/sec', cntr_value: 2 },
            { counter_name: 'Page life expectancy', cntr_value: 200 },
          ],
          series: [],
        }}
      />,
    );

    // Deadlocks >= 1 is critical
    expect(screen.getByText('2.0')).toBeInTheDocument();
    // PLE < 300 is critical
    expect(screen.getByText('200s')).toBeInTheDocument();
  });

  it('renders with no perf_counters data', () => {
    render(<KpiRow />);
    expect(screen.getByTestId('kpi-row')).toBeInTheDocument();
    // Should show defaults (0s)
    expect(screen.getByText('0s')).toBeInTheDocument(); // PLE
  });
});
