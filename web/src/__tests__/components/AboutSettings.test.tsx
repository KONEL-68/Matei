import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AboutSettings } from '../../components/settings/AboutSettings';

vi.mock('@/lib/auth', () => ({
  authFetch: vi.fn(async () => ({
    ok: true,
    json: async () => ({
      running: true,
      lastCycleMs: 450,
      lastCycleAt: '2026-03-22T10:00:00Z',
      instancesCount: 5,
      lastSuccess: 4,
      lastFailed: 1,
    }),
  })),
}));

import { authFetch } from '@/lib/auth';
const mockAuthFetch = vi.mocked(authFetch);

function renderWithQuery(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('AboutSettings', () => {
  it('renders application info', () => {
    renderWithQuery(<AboutSettings />);
    expect(screen.getByText('Matei')).toBeInTheDocument();
    expect(screen.getByText('0.1.0')).toBeInTheDocument();
    expect(screen.getByText('MIT')).toBeInTheDocument();
  });

  it('renders section headings', () => {
    renderWithQuery(<AboutSettings />);
    expect(screen.getByText('Application')).toBeInTheDocument();
    expect(screen.getByText('Collector Status')).toBeInTheDocument();
  });

  it('shows collector status when data loads', async () => {
    renderWithQuery(<AboutSettings />);
    expect(await screen.findByText('Yes')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('450ms')).toBeInTheDocument();
    expect(screen.getByText(/4 ok/)).toBeInTheDocument();
    expect(screen.getByText(/1 failed/)).toBeInTheDocument();
  });

  it('shows loading state before data arrives', () => {
    // Override mock to return a promise that never resolves
    mockAuthFetch.mockImplementationOnce(() => new Promise(() => {}));
    renderWithQuery(<AboutSettings />);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });
});
