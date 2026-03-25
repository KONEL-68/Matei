import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TopWaitsTable } from '../../components/TopWaitsTable';

describe('TopWaitsTable', () => {
  it('renders nothing when data is empty', () => {
    const { container } = render(<TopWaitsTable data={[]} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders table with heading and column headers', () => {
    const data = [
      { wait_type: 'CXPACKET', wait_ms_per_sec: 25, wait_time_ms: 15000 },
    ];
    render(<TopWaitsTable data={data} />);
    expect(screen.getByText('Top Waits')).toBeInTheDocument();
    expect(screen.getByText('Wait Type')).toBeInTheDocument();
    expect(screen.getByText('ms/sec')).toBeInTheDocument();
    expect(screen.getByText('% of total')).toBeInTheDocument();
  });

  it('shows top 5 waits sorted by ms/sec descending', () => {
    const data = [
      { wait_type: 'WAIT_A', wait_ms_per_sec: 5, wait_time_ms: 5000 },
      { wait_type: 'WAIT_B', wait_ms_per_sec: 20, wait_time_ms: 20000 },
      { wait_type: 'WAIT_C', wait_ms_per_sec: 1, wait_time_ms: 1000 },
      { wait_type: 'WAIT_D', wait_ms_per_sec: 50, wait_time_ms: 50000 },
      { wait_type: 'WAIT_E', wait_ms_per_sec: 10, wait_time_ms: 10000 },
      { wait_type: 'WAIT_F', wait_ms_per_sec: 2, wait_time_ms: 2000 },
    ];
    render(<TopWaitsTable data={data} />);

    // WAIT_C (1 ms/sec) should not appear since only top 5 are shown
    expect(screen.getByText('WAIT_D')).toBeInTheDocument();
    expect(screen.getByText('WAIT_B')).toBeInTheDocument();
    expect(screen.getByText('WAIT_E')).toBeInTheDocument();
    expect(screen.getByText('WAIT_A')).toBeInTheDocument();
    expect(screen.getByText('WAIT_F')).toBeInTheDocument();
    expect(screen.queryByText('WAIT_C')).not.toBeInTheDocument();

    // First row should be WAIT_D (highest ms/sec)
    const cells = screen.getAllByRole('cell');
    const waitTypeCells = cells.filter(c => c.classList.contains('font-mono'));
    expect(waitTypeCells[0].textContent).toBe('WAIT_D');
  });

  it('shows percentage of total wait time', () => {
    const data = [
      { wait_type: 'CXPACKET', wait_ms_per_sec: 25, wait_time_ms: 7500 },
      { wait_type: 'ASYNC_NETWORK_IO', wait_ms_per_sec: 10, wait_time_ms: 2500 },
    ];
    render(<TopWaitsTable data={data} />);

    // total = 10000, CXPACKET = 75%, ASYNC_NETWORK_IO = 25%
    expect(screen.getByText('75%')).toBeInTheDocument();
    expect(screen.getByText('25%')).toBeInTheDocument();
  });

  it('applies red background for high ms/sec waits', () => {
    const data = [
      { wait_type: 'HIGH_WAIT', wait_ms_per_sec: 15, wait_time_ms: 15000 },
      { wait_type: 'LOW_WAIT', wait_ms_per_sec: 1, wait_time_ms: 1000 },
    ];
    render(<TopWaitsTable data={data} />);

    const highRow = screen.getByText('HIGH_WAIT').closest('tr');
    expect(highRow?.className).toContain('bg-red-50');

    const lowRow = screen.getByText('LOW_WAIT').closest('tr');
    expect(lowRow?.className).not.toContain('bg-red-50');
    expect(lowRow?.className).not.toContain('bg-yellow-50');
  });
});
