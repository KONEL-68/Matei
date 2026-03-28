import { describe, it, expect, vi } from 'vitest';
import { runBaselineComputation, startBaselineJob } from '../../jobs/baseline-job.js';

function createMockPool() {
  return { query: vi.fn() };
}

function createMockLog() {
  return { info: vi.fn(), error: vi.fn() };
}

describe('baseline-job', () => {
  describe('runBaselineComputation', () => {
    it('runs all 4 metric queries and logs total', async () => {
      const pool = createMockPool();
      const log = createMockLog();

      pool.query
        .mockResolvedValueOnce({ rowCount: 24 })  // cpu
        .mockResolvedValueOnce({ rowCount: 24 })  // memory
        .mockResolvedValueOnce({ rowCount: 24 })  // waits
        .mockResolvedValueOnce({ rowCount: 24 }); // disk_io

      await runBaselineComputation(pool as never, log);

      expect(pool.query).toHaveBeenCalledTimes(4);
      expect(log.info).toHaveBeenCalledWith('Baseline computation starting');
      expect(log.info).toHaveBeenCalledWith('Baseline computation complete: 96 rows upserted');
    });

    it('continues with remaining metrics if one fails', async () => {
      const pool = createMockPool();
      const log = createMockLog();

      pool.query
        .mockResolvedValueOnce({ rowCount: 24 })  // cpu
        .mockRejectedValueOnce(new Error('memory table missing'))  // memory fails
        .mockResolvedValueOnce({ rowCount: 24 })  // waits
        .mockResolvedValueOnce({ rowCount: 24 }); // disk_io

      await runBaselineComputation(pool as never, log);

      expect(pool.query).toHaveBeenCalledTimes(4);
      expect(log.error).toHaveBeenCalledWith(
        expect.stringContaining('metric=memory'),
      );
      expect(log.info).toHaveBeenCalledWith('Baseline computation complete: 72 rows upserted');
    });

    it('handles null rowCount gracefully', async () => {
      const pool = createMockPool();
      const log = createMockLog();

      pool.query
        .mockResolvedValueOnce({ rowCount: null })
        .mockResolvedValueOnce({ rowCount: null })
        .mockResolvedValueOnce({ rowCount: null })
        .mockResolvedValueOnce({ rowCount: null });

      await runBaselineComputation(pool as never, log);

      expect(log.info).toHaveBeenCalledWith('Baseline computation complete: 0 rows upserted');
    });

    it('each query contains ON CONFLICT upsert', async () => {
      const pool = createMockPool();
      const log = createMockLog();

      pool.query.mockResolvedValue({ rowCount: 0 });

      await runBaselineComputation(pool as never, log);

      for (let i = 0; i < 4; i++) {
        const sql = pool.query.mock.calls[i][0] as string;
        expect(sql).toContain('ON CONFLICT');
        expect(sql).toContain('DO UPDATE SET');
      }
    });

    it('cpu query references os_cpu_hourly with 7 day window', async () => {
      const pool = createMockPool();
      const log = createMockLog();

      pool.query.mockResolvedValue({ rowCount: 0 });

      await runBaselineComputation(pool as never, log);

      const cpuSql = pool.query.mock.calls[0][0] as string;
      expect(cpuSql).toContain('os_cpu_hourly');
      expect(cpuSql).toContain("'7 days'");
      expect(cpuSql).toContain("'cpu'");
    });

    it('waits query uses CTE to sum across wait types first', async () => {
      const pool = createMockPool();
      const log = createMockLog();

      pool.query.mockResolvedValue({ rowCount: 0 });

      await runBaselineComputation(pool as never, log);

      const waitsSql = pool.query.mock.calls[2][0] as string;
      expect(waitsSql).toContain('hourly_totals');
      expect(waitsSql).toContain('wait_stats_hourly');
      expect(waitsSql).toContain("'waits'");
    });
  });

  describe('startBaselineJob', () => {
    it('runs immediately and returns interval timer', async () => {
      const pool = createMockPool();
      const log = createMockLog();

      pool.query.mockResolvedValue({ rowCount: 0 });

      const timer = startBaselineJob(pool as never, log);
      expect(timer).toBeDefined();

      // Wait for the immediate async run to complete
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(pool.query).toHaveBeenCalled();
      clearInterval(timer);
    });
  });
});
