import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Login } from '../../pages/Login';

vi.mock('@/lib/auth', () => ({
  login: vi.fn(),
}));

describe('Login', () => {
  it('renders login form', () => {
    render(<MemoryRouter><Login /></MemoryRouter>);
    expect(screen.getByText('Matei')).toBeInTheDocument();
    expect(screen.getByText('Sign in')).toBeInTheDocument();
    expect(screen.getByText('Username')).toBeInTheDocument();
    expect(screen.getByText('Password')).toBeInTheDocument();
  });
});
