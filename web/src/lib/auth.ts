const TOKEN_KEY = 'matei_access_token';
const REFRESH_KEY = 'matei_refresh_token';

export function getAccessToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_KEY);
}

export function setTokens(accessToken: string, refreshToken: string): void {
  localStorage.setItem(TOKEN_KEY, accessToken);
  localStorage.setItem(REFRESH_KEY, refreshToken);
}

export function clearTokens(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
}

export function isAuthenticated(): boolean {
  return !!getAccessToken();
}

/**
 * Fetch wrapper that attaches the Authorization header and handles 401 auto-refresh.
 */
export async function authFetch(url: string, opts?: RequestInit): Promise<Response> {
  const token = getAccessToken();
  const headers = new Headers(opts?.headers);
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  let res = await fetch(url, { ...opts, headers });

  // If 401, try refreshing the token
  if (res.status === 401 && getRefreshToken()) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      // Retry with new token
      const newHeaders = new Headers(opts?.headers);
      newHeaders.set('Authorization', `Bearer ${getAccessToken()!}`);
      res = await fetch(url, { ...opts, headers: newHeaders });
    }
  }

  return res;
}

async function tryRefresh(): Promise<boolean> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return false;

  try {
    const res = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });

    if (!res.ok) {
      clearTokens();
      return false;
    }

    const data = await res.json();
    setTokens(data.accessToken, data.refreshToken);
    return true;
  } catch {
    clearTokens();
    return false;
  }
}

export async function login(username: string, password: string): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });

  const data = await res.json();

  if (!res.ok) {
    return { ok: false, error: data.error ?? 'Login failed' };
  }

  setTokens(data.accessToken, data.refreshToken);
  return { ok: true };
}

export function logout(): void {
  clearTokens();
  window.location.href = '/login';
}
