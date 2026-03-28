import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We need to mock fetch globally before importing the module
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import {
  getAccessToken,
  getRefreshToken,
  setTokens,
  clearTokens,
  isAuthenticated,
  authFetch,
  login,
  logout,
} from '@/lib/auth';

describe('auth', () => {
  beforeEach(() => {
    localStorage.clear();
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('token storage', () => {
    it('getAccessToken returns null when no token stored', () => {
      expect(getAccessToken()).toBeNull();
    });

    it('getRefreshToken returns null when no token stored', () => {
      expect(getRefreshToken()).toBeNull();
    });

    it('setTokens stores both tokens in localStorage', () => {
      setTokens('access123', 'refresh456');
      expect(getAccessToken()).toBe('access123');
      expect(getRefreshToken()).toBe('refresh456');
    });

    it('clearTokens removes both tokens from localStorage', () => {
      setTokens('access123', 'refresh456');
      clearTokens();
      expect(getAccessToken()).toBeNull();
      expect(getRefreshToken()).toBeNull();
    });
  });

  describe('isAuthenticated', () => {
    it('returns false when no access token exists', () => {
      expect(isAuthenticated()).toBe(false);
    });

    it('returns true when an access token exists', () => {
      setTokens('token', 'refresh');
      expect(isAuthenticated()).toBe(true);
    });
  });

  describe('authFetch', () => {
    it('attaches Authorization header when token exists', async () => {
      setTokens('my-token', 'my-refresh');
      mockFetch.mockResolvedValueOnce(new Response('ok', { status: 200 }));

      await authFetch('/api/test');

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('/api/test');
      expect(opts.headers.get('Authorization')).toBe('Bearer my-token');
    });

    it('does not attach Authorization header when no token exists', async () => {
      mockFetch.mockResolvedValueOnce(new Response('ok', { status: 200 }));

      await authFetch('/api/test');

      const [, opts] = mockFetch.mock.calls[0];
      expect(opts.headers.get('Authorization')).toBeNull();
    });

    it('passes through request options', async () => {
      setTokens('tok', 'ref');
      mockFetch.mockResolvedValueOnce(new Response('ok', { status: 200 }));

      await authFetch('/api/data', {
        method: 'POST',
        body: JSON.stringify({ key: 'val' }),
      });

      const [, opts] = mockFetch.mock.calls[0];
      expect(opts.method).toBe('POST');
      expect(opts.body).toBe('{"key":"val"}');
    });

    it('retries with new token after successful refresh on 401', async () => {
      setTokens('expired-token', 'valid-refresh');

      // First call: 401
      mockFetch.mockResolvedValueOnce(new Response('unauthorized', { status: 401 }));
      // Refresh call: success
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ accessToken: 'new-access', refreshToken: 'new-refresh' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      // Retry call: success
      mockFetch.mockResolvedValueOnce(new Response('ok', { status: 200 }));

      const res = await authFetch('/api/secure');

      expect(res.status).toBe(200);
      expect(mockFetch).toHaveBeenCalledTimes(3);

      // Verify new tokens were stored
      expect(getAccessToken()).toBe('new-access');
      expect(getRefreshToken()).toBe('new-refresh');

      // Verify retry used the new token
      const [, retryOpts] = mockFetch.mock.calls[2];
      expect(retryOpts.headers.get('Authorization')).toBe('Bearer new-access');
    });

    it('returns 401 response when refresh fails', async () => {
      setTokens('expired', 'bad-refresh');

      // First call: 401
      mockFetch.mockResolvedValueOnce(new Response('unauthorized', { status: 401 }));
      // Refresh call: fails
      mockFetch.mockResolvedValueOnce(new Response('invalid', { status: 403 }));

      const res = await authFetch('/api/secure');

      expect(res.status).toBe(401);
      // Tokens should be cleared after failed refresh
      expect(getAccessToken()).toBeNull();
      expect(getRefreshToken()).toBeNull();
    });

    it('returns 401 response when no refresh token exists', async () => {
      setTokens('expired', 'ref');
      clearTokens(); // Ensure no refresh token
      localStorage.setItem('matei_access_token', 'expired');

      mockFetch.mockResolvedValueOnce(new Response('unauthorized', { status: 401 }));

      const res = await authFetch('/api/secure');

      // Should not attempt refresh since there's no refresh token
      expect(res.status).toBe(401);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('clears tokens when refresh throws a network error', async () => {
      setTokens('expired', 'valid-refresh');

      mockFetch.mockResolvedValueOnce(new Response('unauthorized', { status: 401 }));
      // Refresh call throws
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const res = await authFetch('/api/secure');

      expect(res.status).toBe(401);
      expect(getAccessToken()).toBeNull();
      expect(getRefreshToken()).toBeNull();
    });
  });

  describe('login', () => {
    it('stores tokens and returns ok on successful login', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ accessToken: 'acc', refreshToken: 'ref' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );

      const result = await login('admin', 'password123');

      expect(result).toEqual({ ok: true });
      expect(getAccessToken()).toBe('acc');
      expect(getRefreshToken()).toBe('ref');

      // Verify correct request was made
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('/api/auth/login');
      expect(opts.method).toBe('POST');
      expect(JSON.parse(opts.body)).toEqual({ username: 'admin', password: 'password123' });
    });

    it('returns error message on failed login', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: 'Invalid credentials' }),
          { status: 401, headers: { 'Content-Type': 'application/json' } },
        ),
      );

      const result = await login('admin', 'wrong');

      expect(result).toEqual({ ok: false, error: 'Invalid credentials' });
      expect(getAccessToken()).toBeNull();
    });

    it('returns default error when server provides no error message', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({}),
          { status: 500, headers: { 'Content-Type': 'application/json' } },
        ),
      );

      const result = await login('admin', 'pass');

      expect(result).toEqual({ ok: false, error: 'Login failed' });
    });
  });

  describe('logout', () => {
    it('clears tokens and redirects to /login', () => {
      setTokens('acc', 'ref');

      // Mock window.location.href setter
      const locationSpy = vi.spyOn(window, 'location', 'get').mockReturnValue({
        ...window.location,
        href: '',
      } as Location);

      // We need to use Object.defineProperty for href assignment
      const hrefSetter = vi.fn();
      Object.defineProperty(window, 'location', {
        value: { href: '' },
        writable: true,
        configurable: true,
      });

      logout();

      expect(getAccessToken()).toBeNull();
      expect(getRefreshToken()).toBeNull();
      expect(window.location.href).toBe('/login');

      locationSpy.mockRestore();
    });
  });
});
