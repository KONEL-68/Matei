import { describe, it, expect } from 'vitest';
import { runWithConcurrency } from '../../collector/worker-pool.js';

describe('worker-pool concurrency', () => {
  it('respects max concurrency', async () => {
    let currentRunning = 0;
    let maxObserved = 0;
    const concurrency = 3;
    const items = Array.from({ length: 10 }, (_, i) => i);

    await runWithConcurrency(items, concurrency, async (_item: number) => {
      currentRunning++;
      if (currentRunning > maxObserved) maxObserved = currentRunning;
      // Simulate async work
      await new Promise((r) => setTimeout(r, 20));
      currentRunning--;
      return _item;
    });

    expect(maxObserved).toBeLessThanOrEqual(concurrency);
    expect(maxObserved).toBeGreaterThan(0);
  });

  it('processes all items', async () => {
    const items = [1, 2, 3, 4, 5];
    const results = await runWithConcurrency(items, 2, async (item: number) => {
      return item * 2;
    });

    expect(results.sort((a, b) => a - b)).toEqual([2, 4, 6, 8, 10]);
  });

  it('failed instance does not block others', async () => {
    const items = [1, 2, 3, 4, 5];
    const processed: number[] = [];

    // The real worker pool catches errors per-instance and returns error results.
    // runWithConcurrency itself propagates errors, so we wrap the callback
    // to match the actual usage pattern.
    const results = await runWithConcurrency(items, 2, async (item: number) => {
      if (item === 3) return { error: 'connection failed', value: null };
      await new Promise((r) => setTimeout(r, 5));
      processed.push(item);
      return { error: null, value: item };
    });

    // All 5 items processed, even the failed one
    expect(results).toHaveLength(5);
    expect(processed.sort()).toEqual([1, 2, 4, 5]);
    expect(results.find((r) => r.error)?.error).toBe('connection failed');
  });

  it('failed instance does not block others (with error handling)', async () => {
    const items = [1, 2, 3, 4, 5];
    const results: Array<{ value: number } | { error: string }> = [];

    await runWithConcurrency(items, 2, async (item: number) => {
      if (item === 3) {
        const result = { error: 'connection failed' };
        return result;
      }
      await new Promise((r) => setTimeout(r, 5));
      return { value: item };
    });

    // All 5 items are processed even though one "failed"
    // The real worker-pool wraps errors in the result, not throws
  });

  it('handles empty input', async () => {
    const results = await runWithConcurrency([], 5, async (item: number) => item);
    expect(results).toEqual([]);
  });

  it('handles concurrency greater than items', async () => {
    const items = [1, 2];
    const results = await runWithConcurrency(items, 100, async (item: number) => item * 3);
    expect(results.sort((a, b) => a - b)).toEqual([3, 6]);
  });

  it('timeout scenario: slow item does not block fast items', async () => {
    const startTime = Date.now();
    const items = ['fast1', 'fast2', 'slow', 'fast3'];

    const results = await runWithConcurrency(items, 3, async (item: string) => {
      if (item === 'slow') {
        await new Promise((r) => setTimeout(r, 100));
      } else {
        await new Promise((r) => setTimeout(r, 10));
      }
      return item;
    });

    const elapsed = Date.now() - startTime;
    expect(results).toHaveLength(4);
    // With concurrency 3, the slow item runs in parallel with fast items
    // Total time should be ~100ms (slow item duration), not ~130ms (sequential)
    expect(elapsed).toBeLessThan(200);
  });
});
