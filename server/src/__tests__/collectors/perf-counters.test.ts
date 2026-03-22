import { describe, it, expect, beforeEach } from 'vitest';
import { computePerfCounterValues, resetAllSnapshots } from '../../collector/collectors/perf-counters.js';
import type { PerfCounterSnapshot } from '../../collector/collectors/perf-counters.js';

describe('perf-counters collector', () => {
  beforeEach(() => {
    resetAllSnapshots();
  });

  it('computes per-second rate for cumulative counters', () => {
    const previous: PerfCounterSnapshot[] = [
      { counter_name: 'Batch Requests/sec', cntr_value: 1000, cntr_type: 272696576 },
      { counter_name: 'User Connections', cntr_value: 50, cntr_type: 65792 },
    ];
    const current: PerfCounterSnapshot[] = [
      { counter_name: 'Batch Requests/sec', cntr_value: 1300, cntr_type: 272696576 },
      { counter_name: 'User Connections', cntr_value: 55, cntr_type: 65792 },
    ];

    const results = computePerfCounterValues(current, previous, 30);
    expect(results).toHaveLength(2);

    const batchReqs = results.find((r) => r.counter_name === 'Batch Requests/sec');
    expect(batchReqs).toBeDefined();
    expect(batchReqs!.cntr_value).toBe(10); // 300 / 30 = 10

    const userConns = results.find((r) => r.counter_name === 'User Connections');
    expect(userConns).toBeDefined();
    expect(userConns!.cntr_value).toBe(55); // Instantaneous, as-is
  });

  it('passes through instantaneous counters without delta', () => {
    const previous: PerfCounterSnapshot[] = [
      { counter_name: 'Page life expectancy', cntr_value: 5000, cntr_type: 65792 },
    ];
    const current: PerfCounterSnapshot[] = [
      { counter_name: 'Page life expectancy', cntr_value: 4500, cntr_type: 65792 },
    ];

    const results = computePerfCounterValues(current, previous, 30);
    expect(results).toHaveLength(1);
    expect(results[0].cntr_value).toBe(4500);
  });

  it('skips rate counters with negative delta (counter reset)', () => {
    const previous: PerfCounterSnapshot[] = [
      { counter_name: 'Batch Requests/sec', cntr_value: 1000, cntr_type: 272696576 },
    ];
    const current: PerfCounterSnapshot[] = [
      { counter_name: 'Batch Requests/sec', cntr_value: 500, cntr_type: 272696576 },
    ];

    const results = computePerfCounterValues(current, previous, 30);
    // Rate counter with negative delta should be skipped
    const batchReqs = results.find((r) => r.counter_name === 'Batch Requests/sec');
    expect(batchReqs).toBeUndefined();
  });

  it('skips rate counters not present in previous snapshot', () => {
    const previous: PerfCounterSnapshot[] = [];
    const current: PerfCounterSnapshot[] = [
      { counter_name: 'Batch Requests/sec', cntr_value: 500, cntr_type: 272696576 },
      { counter_name: 'User Connections', cntr_value: 10, cntr_type: 65792 },
    ];

    const results = computePerfCounterValues(current, previous, 30);
    // Only instantaneous counter should appear
    expect(results).toHaveLength(1);
    expect(results[0].counter_name).toBe('User Connections');
  });

  it('handles zero elapsed seconds gracefully', () => {
    const previous: PerfCounterSnapshot[] = [
      { counter_name: 'Batch Requests/sec', cntr_value: 1000, cntr_type: 272696576 },
    ];
    const current: PerfCounterSnapshot[] = [
      { counter_name: 'Batch Requests/sec', cntr_value: 1300, cntr_type: 272696576 },
    ];

    // Should use 1 second as minimum
    const results = computePerfCounterValues(current, previous, 0);
    expect(results[0].cntr_value).toBe(300);
  });
});
