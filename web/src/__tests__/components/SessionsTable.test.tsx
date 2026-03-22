import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SessionsTable } from '../../components/SessionsTable';

describe('SessionsTable', () => {
  it('shows empty state when no sessions', () => {
    render(<SessionsTable data={[]} />);
    expect(screen.getByText('No active sessions')).toBeInTheDocument();
  });

  it('renders sessions with blocking highlighted', () => {
    const data = [
      { session_id: 55, request_id: 1, blocking_session_id: null, session_status: 'running', request_status: 'running', login_name: 'admin', host_name: 'WEB1', program_name: 'SSMS', database_name: 'DB1', command: 'SELECT', wait_type: null, wait_time_ms: null, elapsed_time_ms: 5000, cpu_time_ms: 3000, logical_reads: 10000, writes: 100, open_transaction_count: 1, granted_memory_kb: 1024, current_statement: 'SELECT * FROM orders' },
      { session_id: 60, request_id: 1, blocking_session_id: 55, session_status: 'suspended', request_status: 'suspended', login_name: 'app', host_name: 'APP1', program_name: '.Net', database_name: 'DB1', command: 'UPDATE', wait_type: 'LCK_M_X', wait_time_ms: 3000, elapsed_time_ms: 3000, cpu_time_ms: 100, logical_reads: 500, writes: 10, open_transaction_count: 1, granted_memory_kb: 512, current_statement: 'UPDATE orders SET status = 1' },
    ];
    render(<SessionsTable data={data} />);

    // Both sessions rendered (55 appears twice: as SPID and as blocker of 60)
    expect(screen.getAllByText('55')).toHaveLength(2);
    expect(screen.getByText('60')).toBeInTheDocument();

    // Blocker indicator
    expect(screen.getByText('!')).toBeInTheDocument();
  });
});
