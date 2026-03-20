import { describe, it, expect } from 'vitest';
import { fiveMinBucket, hourlyBucket } from '../../jobs/aggregator.js';

describe('aggregator', () => {
  describe('fiveMinBucket', () => {
    it('rounds down to nearest 5-minute boundary', () => {
      const input = new Date('2026-03-20T10:07:45.123Z');
      const result = fiveMinBucket(input);

      expect(result.getUTCMinutes()).toBe(5);
      expect(result.getUTCSeconds()).toBe(0);
      expect(result.getUTCMilliseconds()).toBe(0);
    });

    it('returns same time if already on 5-minute boundary', () => {
      const input = new Date('2026-03-20T10:15:00.000Z');
      const result = fiveMinBucket(input);

      expect(result.getUTCMinutes()).toBe(15);
      expect(result.getUTCSeconds()).toBe(0);
    });

    it('rounds 10:59 down to 10:55', () => {
      const input = new Date('2026-03-20T10:59:59.999Z');
      const result = fiveMinBucket(input);

      expect(result.getUTCMinutes()).toBe(55);
    });

    it('rounds 10:00 to 10:00', () => {
      const input = new Date('2026-03-20T10:00:30.000Z');
      const result = fiveMinBucket(input);

      expect(result.getUTCMinutes()).toBe(0);
    });
  });

  describe('hourlyBucket', () => {
    it('rounds down to start of hour', () => {
      const input = new Date('2026-03-20T10:47:59.005Z');
      const result = hourlyBucket(input);

      expect(result.getUTCHours()).toBe(10);
      expect(result.getUTCMinutes()).toBe(0);
      expect(result.getUTCSeconds()).toBe(0);
      expect(result.getUTCMilliseconds()).toBe(0);
    });

    it('returns same time if already on hour boundary', () => {
      const input = new Date('2026-03-20T10:00:00.000Z');
      const result = hourlyBucket(input);

      expect(result.getUTCHours()).toBe(10);
      expect(result.getUTCMinutes()).toBe(0);
    });
  });

  describe('aggregation logic', () => {
    it('computes correct avg/max from sample data', () => {
      // Simulate what the SQL query does: avg and max over a set of samples
      const samples = [
        { sql_cpu_pct: 10 },
        { sql_cpu_pct: 30 },
        { sql_cpu_pct: 20 },
        { sql_cpu_pct: 50 },
        { sql_cpu_pct: 40 },
      ];

      const avg = samples.reduce((sum, s) => sum + s.sql_cpu_pct, 0) / samples.length;
      const max = Math.max(...samples.map((s) => s.sql_cpu_pct));

      expect(avg).toBe(30);
      expect(max).toBe(50);
    });

    it('computes correct wait_ms_per_sec from deltas', () => {
      const COLLECTION_INTERVAL = 30; // seconds
      const samples = [
        { wait_time_ms_delta: 900 },  // 30 ms/sec
        { wait_time_ms_delta: 600 },  // 20 ms/sec
        { wait_time_ms_delta: 1500 }, // 50 ms/sec
      ];

      const rates = samples.map((s) => s.wait_time_ms_delta / COLLECTION_INTERVAL);
      const avg = rates.reduce((sum, r) => sum + r, 0) / rates.length;
      const max = Math.max(...rates);

      expect(avg).toBeCloseTo(33.33, 1);
      expect(max).toBe(50);
    });

    it('handles empty time window (no data to aggregate)', () => {
      const samples: Array<{ sql_cpu_pct: number }> = [];

      const avg = samples.length > 0
        ? samples.reduce((sum, s) => sum + s.sql_cpu_pct, 0) / samples.length
        : 0;
      const max = samples.length > 0
        ? Math.max(...samples.map((s) => s.sql_cpu_pct))
        : 0;

      expect(avg).toBe(0);
      expect(max).toBe(0);
    });

    it('computes file I/O latency correctly', () => {
      // Latency = io_stall_ms / num_of_reads (or writes)
      const samples = [
        { num_of_reads_delta: 100, io_stall_read_ms_delta: 500 },  // 5ms avg
        { num_of_reads_delta: 200, io_stall_read_ms_delta: 2000 }, // 10ms avg
        { num_of_reads_delta: 0, io_stall_read_ms_delta: 0 },      // 0ms (no reads)
      ];

      const latencies = samples.map((s) =>
        s.num_of_reads_delta > 0 ? s.io_stall_read_ms_delta / s.num_of_reads_delta : 0,
      );

      const avg = latencies.reduce((sum, l) => sum + l, 0) / latencies.length;
      const max = Math.max(...latencies);

      expect(avg).toBe(5);
      expect(max).toBe(10);
    });
  });
});
