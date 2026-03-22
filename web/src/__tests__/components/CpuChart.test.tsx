import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CpuChart } from '../../components/CpuChart';

vi.mock('@/lib/theme', () => ({
  useTheme: () => ({ theme: 'light', toggleTheme: vi.fn() }),
}));

// Mock recharts to avoid canvas issues in jsdom
vi.mock('recharts', () => ({
  LineChart: ({ children }: { children: React.ReactNode }) => <div data-testid="line-chart">{children}</div>,
  Line: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  Legend: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

describe('CpuChart', () => {
  it('shows "No CPU data available" when data is empty', () => {
    render(<CpuChart data={[]} />);
    expect(screen.getByText('No CPU data available')).toBeInTheDocument();
  });

  it('renders chart with data', () => {
    const data = [
      { sql_cpu_pct: 30, other_process_cpu_pct: 10, system_idle_pct: 60, collected_at: '2026-03-22T10:00:00Z' },
      { sql_cpu_pct: 40, other_process_cpu_pct: 15, system_idle_pct: 45, collected_at: '2026-03-22T10:01:00Z' },
    ];
    render(<CpuChart data={data} />);
    expect(screen.getByText('CPU Utilization (%)')).toBeInTheDocument();
    expect(screen.getByTestId('line-chart')).toBeInTheDocument();
  });
});
