import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { InstanceForm } from '../../components/InstanceForm';

vi.mock('@/lib/auth', () => ({
  authFetch: vi.fn(async () => ({
    ok: true,
    json: async () => [
      { id: 1, name: 'Production' },
      { id: 2, name: 'Staging' },
    ],
  })),
}));

function renderForm(props?: Partial<Parameters<typeof InstanceForm>[0]>) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const defaultProps = {
    onSubmit: vi.fn(),
    onCancel: vi.fn(),
    onTest: vi.fn(),
    isSubmitting: false,
    isTesting: false,
    testResult: null,
    ...props,
  };
  return render(
    <QueryClientProvider client={qc}>
      <InstanceForm {...defaultProps} />
    </QueryClientProvider>,
  );
}

describe('InstanceForm', () => {
  it('renders required form fields', () => {
    renderForm();
    expect(screen.getByPlaceholderText('Production Server 1')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('192.168.1.100 or sqlserver.domain.com')).toBeInTheDocument();
    expect(screen.getByText('Authentication')).toBeInTheDocument();
    expect(screen.getByText('Test Connection')).toBeInTheDocument();
    expect(screen.getByText('Save')).toBeInTheDocument();
  });

  it('shows group selector when groups are loaded', async () => {
    renderForm();
    expect(await screen.findByText('Group')).toBeInTheDocument();
    expect(screen.getByText('Production')).toBeInTheDocument();
    expect(screen.getByText('Staging')).toBeInTheDocument();
    expect(screen.getByText('No group')).toBeInTheDocument();
  });

  it('renders with initial values', () => {
    renderForm({ initial: { name: 'Test Server', host: '10.0.0.1', port: 1434 } });
    expect(screen.getByDisplayValue('Test Server')).toBeInTheDocument();
    expect(screen.getByDisplayValue('10.0.0.1')).toBeInTheDocument();
    expect(screen.getByDisplayValue('1434')).toBeInTheDocument();
  });
});
