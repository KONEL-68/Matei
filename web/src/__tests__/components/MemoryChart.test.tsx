import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryChart } from '../../components/MemoryChart';

vi.mock('@/lib/theme', () => ({
  useTheme: () => ({ theme: 'light', toggleTheme: vi.fn() }),
}));

vi.mock('recharts', () => ({
  AreaChart: ({ children }: { children: React.ReactNode }) => <div data-testid="area-chart">{children}</div>,
  Area: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  Legend: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

describe('MemoryChart', () => {
  it('shows "No memory data available" when empty', () => {
    render(<MemoryChart data={[]} />);
    expect(screen.getByText('No memory data available')).toBeInTheDocument();
  });

  it('renders chart with data', () => {
    const data = [
      { os_total_memory_mb: 16384, os_available_memory_mb: 4096, os_used_memory_mb: 12288, sql_committed_mb: 8192, sql_target_mb: 12288, collected_at: '2026-03-22T10:00:00Z' },
    ];
    render(<MemoryChart data={data} />);
    expect(screen.getByText('Memory Usage')).toBeInTheDocument();
    expect(screen.getByTestId('area-chart')).toBeInTheDocument();
  });
});
