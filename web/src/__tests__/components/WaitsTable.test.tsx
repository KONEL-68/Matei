import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WaitsTable } from '../../components/WaitsTable';

describe('WaitsTable', () => {
  it('shows empty state when no data', () => {
    render(<WaitsTable data={[]} />);
    expect(screen.getByText('No wait stats data available')).toBeInTheDocument();
  });

  it('renders wait types sorted by ms/sec', () => {
    const data = [
      { wait_type: 'LCK_M_X', waiting_tasks_count: 100, wait_time_ms: 5000, max_wait_time_ms: 500, signal_wait_time_ms: 200, wait_ms_per_sec: 10.5 },
      { wait_type: 'CXPACKET', waiting_tasks_count: 500, wait_time_ms: 15000, max_wait_time_ms: 1000, signal_wait_time_ms: 100, wait_ms_per_sec: 25.0 },
    ];
    render(<WaitsTable data={data} />);
    expect(screen.getByText('CXPACKET')).toBeInTheDocument();
    expect(screen.getByText('LCK_M_X')).toBeInTheDocument();

    // CXPACKET should appear first (higher ms/sec, default sort)
    const cells = screen.getAllByRole('cell');
    const waitTypeValues = cells.filter((c) => c.textContent === 'CXPACKET' || c.textContent === 'LCK_M_X');
    expect(waitTypeValues[0].textContent).toBe('CXPACKET');
  });
});
