import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SessionBreakdown } from '../../components/SessionBreakdown';

describe('SessionBreakdown', () => {
  it('shows "No session data" when data is empty', () => {
    render(<SessionBreakdown data={[]} />);
    expect(screen.getByText('No session data')).toBeInTheDocument();
  });

  it('renders the heading', () => {
    render(<SessionBreakdown data={[]} />);
    expect(screen.getByText('Session Breakdown')).toBeInTheDocument();
  });

  it('counts sessions by status', () => {
    const data = [
      { request_status: 'running', session_status: 'running', wait_type: null },
      { request_status: 'running', session_status: 'running', wait_type: null },
      { request_status: 'suspended', session_status: 'suspended', wait_type: 'LCK_M_X' },
      { request_status: null, session_status: 'sleeping', wait_type: null },
      { request_status: 'runnable', session_status: 'runnable', wait_type: null },
    ];
    render(<SessionBreakdown data={data} />);

    expect(screen.getByText('Running')).toBeInTheDocument();
    expect(screen.getByText('Runnable')).toBeInTheDocument();
    expect(screen.getByText('Sleeping')).toBeInTheDocument();
    expect(screen.getByText('Suspended')).toBeInTheDocument();

    // Check counts: 2 running, 1 runnable, 1 sleeping, 1 suspended
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('excludes WAITFOR sessions from counts', () => {
    const data = [
      { request_status: 'running', session_status: 'running', wait_type: null },
      { request_status: 'suspended', session_status: 'suspended', wait_type: 'WAITFOR' },
      { request_status: 'suspended', session_status: 'suspended', wait_type: 'SP_SERVER_DIAGNOSTICS_SLEEP' },
    ];
    render(<SessionBreakdown data={data} />);

    // Only the running session should be counted, WAITFOR and SP_SERVER_DIAGNOSTICS_SLEEP are excluded
    const runningLabel = screen.getByText('Running');
    const countElement = runningLabel.closest('.flex')?.querySelector('.font-mono');
    expect(countElement?.textContent).toBe('1');
  });

  it('renders all four status types', () => {
    const data = [
      { request_status: 'running', session_status: 'running', wait_type: null },
    ];
    render(<SessionBreakdown data={data} />);
    expect(screen.getByText('Running')).toBeInTheDocument();
    expect(screen.getByText('Runnable')).toBeInTheDocument();
    expect(screen.getByText('Sleeping')).toBeInTheDocument();
    expect(screen.getByText('Suspended')).toBeInTheDocument();
  });
});
