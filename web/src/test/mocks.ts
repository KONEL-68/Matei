import { vi } from 'vitest';

// Mock responses keyed by URL pattern
const mockResponses: Map<string, unknown> = new Map();

export function setMockResponse(urlPattern: string, data: unknown) {
  mockResponses.set(urlPattern, data);
}

export function clearMockResponses() {
  mockResponses.clear();
}

export function createMockAuthFetch() {
  return vi.fn(async (url: string) => {
    for (const [pattern, data] of mockResponses) {
      if (url.includes(pattern)) {
        return {
          ok: true,
          status: 200,
          json: async () => data,
        };
      }
    }
    return { ok: true, status: 200, json: async () => [] };
  });
}
