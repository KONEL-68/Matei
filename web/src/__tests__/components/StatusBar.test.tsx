import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusBar } from '../../components/StatusBar';

const baseCpu = [{ sql_cpu_pct: 12 }];
const baseWaits = [{ wait_type: 'ASYNC_NETWORK_IO', wait_ms_per_sec: 133 }];
const baseSessions = [{ blocking_session_id: null }, { blocking_session_id: 0 }];
const baseFileIo = [{ avg_read_latency_ms: 0.3, avg_write_latency_ms: 8.4 }];
const basePerfCounters = {
  latest: [
    { counter_name: 'Page life expectancy', cntr_value: 74160 },
    { counter_name: 'Memory Grants Pending', cntr_value: 0 },
    { counter_name: 'Pending Tasks', cntr_value: 2 },
  ],
};

describe('StatusBar', () => {
  it('renders all 8 KPI labels', () => {
    render(
      <StatusBar
        cpuData={baseCpu}
        waitsData={baseWaits}
        sessionsData={baseSessions}
        fileIoData={baseFileIo}
        perfCounters={basePerfCounters}
      />,
    );

    const bar = screen.getByTestId('status-bar');
    expect(bar).toBeInTheDocument();
    expect(screen.getByText(/CPU 12%/)).toBeInTheDocument();
    expect(screen.getByText(/Top Wait:/)).toBeInTheDocument();
    expect(screen.getByText(/ASYNC_NETWORK_IO/)).toBeInTheDocument();
    expect(screen.getByText(/Blocked 0/)).toBeInTheDocument();
    expect(screen.getByText(/Pending 2/)).toBeInTheDocument();
    expect(screen.getByText(/Read IO 0.3ms/)).toBeInTheDocument();
    expect(screen.getByText(/Write IO 8.4ms/)).toBeInTheDocument();
    expect(screen.getByText(/PLE 20.6h/)).toBeInTheDocument();
    expect(screen.getByText(/Mem Grants Pending 0/)).toBeInTheDocument();
  });

  it('shows yellow dot for CPU >= 75', () => {
    const { container } = render(
      <StatusBar
        cpuData={[{ sql_cpu_pct: 80 }]}
        waitsData={[]}
        sessionsData={[]}
        fileIoData={[]}
      />,
    );

    const cpuSpan = screen.getByText(/CPU 80%/).closest('span');
    const dot = cpuSpan?.querySelector('.rounded-full');
    expect(dot?.className).toContain('bg-yellow-400');
  });

  it('shows red dot for CPU >= 90', () => {
    render(
      <StatusBar
        cpuData={[{ sql_cpu_pct: 95 }]}
        waitsData={[]}
        sessionsData={[]}
        fileIoData={[]}
      />,
    );

    const cpuSpan = screen.getByText(/CPU 95%/).closest('span');
    const dot = cpuSpan?.querySelector('.rounded-full');
    expect(dot?.className).toContain('bg-red-500');
  });

  it('shows red dot for PLE < 300', () => {
    render(
      <StatusBar
        cpuData={[{ sql_cpu_pct: 10 }]}
        waitsData={[]}
        sessionsData={[]}
        fileIoData={[]}
        perfCounters={{ latest: [{ counter_name: 'Page life expectancy', cntr_value: 200 }] }}
      />,
    );

    const pleSpan = screen.getByText(/PLE 200s/).closest('span');
    const dot = pleSpan?.querySelector('.rounded-full');
    expect(dot?.className).toContain('bg-red-500');
  });

  it('shows gray dots when no data', () => {
    const { container } = render(
      <StatusBar cpuData={[]} waitsData={[]} sessionsData={[]} fileIoData={[]} />,
    );

    const bar = screen.getByTestId('status-bar');
    const dots = bar.querySelectorAll('.bg-gray-500');
    // CPU, Top Wait, Pending, Read IO, Write IO, PLE, Mem Grants = 7 gray (Blocked stays green at 0)
    expect(dots.length).toBeGreaterThanOrEqual(5);
  });

  it('renders as a thin strip (compact height)', () => {
    render(
      <StatusBar cpuData={baseCpu} waitsData={baseWaits} sessionsData={baseSessions} fileIoData={baseFileIo} perfCounters={basePerfCounters} />,
    );

    const bar = screen.getByTestId('status-bar');
    expect(bar.className).toContain('py-1.5');
    expect(bar.className).toContain('text-xs');
  });

  it('shows blocked count with red dot when >= 5', () => {
    const sessions = Array.from({ length: 6 }, () => ({ blocking_session_id: 1 }));
    render(
      <StatusBar cpuData={baseCpu} waitsData={[]} sessionsData={sessions} fileIoData={[]} />,
    );

    const blockedSpan = screen.getByText(/Blocked 6/).closest('span');
    const dot = blockedSpan?.querySelector('.rounded-full');
    expect(dot?.className).toContain('bg-red-500');
  });
});
