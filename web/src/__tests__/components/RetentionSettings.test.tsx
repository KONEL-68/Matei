import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RetentionSettings } from '../../components/settings/RetentionSettings';

describe('RetentionSettings', () => {
  it('renders table headers', () => {
    render(<RetentionSettings />);
    expect(screen.getByText('Tier')).toBeInTheDocument();
    expect(screen.getByText('Retention')).toBeInTheDocument();
    expect(screen.getByText('Detail')).toBeInTheDocument();
  });

  it('renders all three retention tiers', () => {
    render(<RetentionSettings />);
    expect(screen.getByText('Raw metrics')).toBeInTheDocument();
    expect(screen.getByText('5-minute aggregates')).toBeInTheDocument();
    expect(screen.getByText('Hourly aggregates')).toBeInTheDocument();
  });

  it('shows correct retention periods', () => {
    render(<RetentionSettings />);
    expect(screen.getByText('7 days')).toBeInTheDocument();
    expect(screen.getByText('30 days')).toBeInTheDocument();
    expect(screen.getByText('1 year')).toBeInTheDocument();
  });

  it('shows detail descriptions', () => {
    render(<RetentionSettings />);
    expect(screen.getByText('Full-resolution data, partitioned by day')).toBeInTheDocument();
    expect(screen.getByText('Averaged/rolled-up metrics')).toBeInTheDocument();
    expect(screen.getByText('Long-term trend data')).toBeInTheDocument();
  });

  it('shows read-only notice', () => {
    render(<RetentionSettings />);
    expect(screen.getByText(/Data retention policy/)).toBeInTheDocument();
    expect(screen.getByText(/read-only/)).toBeInTheDocument();
  });
});
