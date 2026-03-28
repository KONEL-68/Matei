import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type pg from 'pg';
import type { AppConfig } from '../../config.js';

// Mock collectAll before importing the scheduler
vi.mock('../../collector/worker-pool.js', () => ({
  collectAll: vi.fn(),
}));

import { CollectorScheduler } from '../../collector/scheduler.js';
import { collectAll } from '../../collector/worker-pool.js';

const mockedCollectAll = vi.mocked(collectAll);

function createMockPgPool(rows: Record<string, unknown>[] = []): pg.Pool {
  return {
    query: vi.fn().mockResolvedValue({ rows }),
  } as unknown as pg.Pool;
}

function createMockConfig(overrides: Partial<AppConfig['collector']> = {}): AppConfig {
  return {
    encryptionKey: 'test-encryption-key-32-chars-long',
    collector: {
      intervalMs: 30_000,
      workers: 40,
      ...overrides,
    },
  } as AppConfig;
}

function createMockLog() {
  return {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  };
}

function createInstanceRows(count: number): Record<string, unknown>[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    host: `server-${i + 1}`,
    port: 1433,
    auth_type: 'sql',
    encrypted_credentials: Buffer.from(`creds-${i + 1}`),
  }));
}

/** Helper: start scheduler, flush the immediate tick, return cleanup fn */
async function startAndFlushFirstTick(scheduler: CollectorScheduler): Promise<void> {
  scheduler.start();
  // Flush microtasks so the immediate void this.tick() resolves
  await vi.advanceTimersByTimeAsync(0);
}

describe('CollectorScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockedCollectAll.mockReset();
    mockedCollectAll.mockResolvedValue({ success: 1, failed: 0 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('start()', () => {
    it('should run the first cycle immediately on start', async () => {
      const pgPool = createMockPgPool(createInstanceRows(2));
      const config = createMockConfig();
      const log = createMockLog();

      const scheduler = new CollectorScheduler(pgPool, config, log);
      await startAndFlushFirstTick(scheduler);

      expect(pgPool.query).toHaveBeenCalledTimes(1);
      expect(mockedCollectAll).toHaveBeenCalledTimes(1);

      // Clean up: clear timer, cycling is already false
      scheduler.start(); // no-op
      void scheduler.stop();
      await vi.advanceTimersByTimeAsync(200);
    });

    it('should set running status to true', async () => {
      const pgPool = createMockPgPool();
      const config = createMockConfig();
      const log = createMockLog();

      const scheduler = new CollectorScheduler(pgPool, config, log);

      expect(scheduler.getStatus().running).toBe(false);
      scheduler.start();
      expect(scheduler.getStatus().running).toBe(true);

      void scheduler.stop();
      await vi.advanceTimersByTimeAsync(200);
    });

    it('should be idempotent — calling start twice does not create duplicate timers', async () => {
      const pgPool = createMockPgPool(createInstanceRows(1));
      const config = createMockConfig({ intervalMs: 5000 });
      const log = createMockLog();

      const scheduler = new CollectorScheduler(pgPool, config, log);
      scheduler.start();
      scheduler.start(); // second call should be a no-op

      // Flush immediate tick
      await vi.advanceTimersByTimeAsync(0);
      expect(mockedCollectAll).toHaveBeenCalledTimes(1);

      // Advance one interval — should be 2 total, not 3+
      await vi.advanceTimersByTimeAsync(5000);
      expect(mockedCollectAll).toHaveBeenCalledTimes(2);

      void scheduler.stop();
      await vi.advanceTimersByTimeAsync(200);
    });

    it('should log the interval and worker count on start', async () => {
      const pgPool = createMockPgPool();
      const config = createMockConfig({ intervalMs: 5000, workers: 10 });
      const log = createMockLog();

      const scheduler = new CollectorScheduler(pgPool, config, log);
      scheduler.start();

      expect(log.info).toHaveBeenCalledWith(
        expect.stringContaining('5000ms'),
      );
      expect(log.info).toHaveBeenCalledWith(
        expect.stringContaining('10'),
      );

      void scheduler.stop();
      await vi.advanceTimersByTimeAsync(200);
    });
  });

  describe('stop()', () => {
    it('should set running status to false', async () => {
      const pgPool = createMockPgPool();
      const config = createMockConfig();
      const log = createMockLog();

      const scheduler = new CollectorScheduler(pgPool, config, log);
      await startAndFlushFirstTick(scheduler);

      void scheduler.stop();
      await vi.advanceTimersByTimeAsync(200);

      expect(scheduler.getStatus().running).toBe(false);
    });

    it('should clear the interval timer and prevent further cycles', async () => {
      const pgPool = createMockPgPool(createInstanceRows(1));
      const config = createMockConfig({ intervalMs: 1000 });
      const log = createMockLog();

      const scheduler = new CollectorScheduler(pgPool, config, log);
      await startAndFlushFirstTick(scheduler);

      const callsAfterFirstCycle = mockedCollectAll.mock.calls.length;

      void scheduler.stop();
      await vi.advanceTimersByTimeAsync(200);

      // Advance time — no more cycles should fire
      await vi.advanceTimersByTimeAsync(10_000);
      expect(mockedCollectAll).toHaveBeenCalledTimes(callsAfterFirstCycle);
    });

    it('should wait for an in-progress cycle to finish before resolving', async () => {
      vi.useRealTimers(); // need real timers for this concurrency test

      let resolveCollect!: (value: { success: number; failed: number }) => void;
      mockedCollectAll.mockReturnValue(
        new Promise((resolve) => {
          resolveCollect = resolve;
        }),
      );

      const pgPool = createMockPgPool(createInstanceRows(1));
      const config = createMockConfig({ intervalMs: 60_000 });
      const log = createMockLog();

      const scheduler = new CollectorScheduler(pgPool, config, log);
      scheduler.start();

      // Give the immediate tick time to start
      await new Promise((r) => setTimeout(r, 50));

      // Start stop — it should not resolve until the cycle finishes
      let stopped = false;
      const stopPromise = scheduler.stop().then(() => {
        stopped = true;
      });

      await new Promise((r) => setTimeout(r, 50));
      expect(stopped).toBe(false);

      // Now let the cycle finish
      resolveCollect({ success: 1, failed: 0 });
      await stopPromise;
      expect(stopped).toBe(true);
    });

    it('should log that the scheduler has stopped', async () => {
      const pgPool = createMockPgPool();
      const config = createMockConfig();
      const log = createMockLog();

      const scheduler = new CollectorScheduler(pgPool, config, log);
      await startAndFlushFirstTick(scheduler);

      void scheduler.stop();
      await vi.advanceTimersByTimeAsync(200);

      expect(log.info).toHaveBeenCalledWith('Collector scheduler stopped');
    });
  });

  describe('cycle skipping', () => {
    it('should skip a cycle if the previous one is still running', async () => {
      vi.useRealTimers();

      let resolveCollect!: (value: { success: number; failed: number }) => void;
      mockedCollectAll.mockReturnValueOnce(
        new Promise((resolve) => {
          resolveCollect = resolve;
        }),
      );

      const pgPool = createMockPgPool(createInstanceRows(1));
      const config = createMockConfig({ intervalMs: 100 });
      const log = createMockLog();

      const scheduler = new CollectorScheduler(pgPool, config, log);
      scheduler.start();

      // Wait for the interval to fire while first cycle is still running
      await new Promise((r) => setTimeout(r, 250));

      expect(log.info).toHaveBeenCalledWith(
        'Previous collection cycle still running, skipping',
      );

      // Finish the first cycle and clean up
      resolveCollect({ success: 1, failed: 0 });
      await scheduler.stop();
    });
  });

  describe('tick() — collection cycle', () => {
    it('should query PostgreSQL for enabled instances', async () => {
      const pgPool = createMockPgPool(createInstanceRows(3));
      const config = createMockConfig();
      const log = createMockLog();

      const scheduler = new CollectorScheduler(pgPool, config, log);
      await startAndFlushFirstTick(scheduler);

      expect(pgPool.query).toHaveBeenCalledWith(
        'SELECT id, host, port, auth_type, encrypted_credentials FROM instances WHERE is_enabled = true',
      );

      void scheduler.stop();
      await vi.advanceTimersByTimeAsync(200);
    });

    it('should pass correct arguments to collectAll', async () => {
      const pgPool = createMockPgPool(createInstanceRows(2));
      const config = createMockConfig({ workers: 15 });
      const log = createMockLog();

      const scheduler = new CollectorScheduler(pgPool, config, log);
      await startAndFlushFirstTick(scheduler);

      expect(mockedCollectAll).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ id: 1, host: 'server-1', port: 1433 }),
          expect.objectContaining({ id: 2, host: 'server-2', port: 1433 }),
        ]),
        pgPool,
        config.encryptionKey,
        15,
        log,
      );

      void scheduler.stop();
      await vi.advanceTimersByTimeAsync(200);
    });

    it('should convert encrypted_credentials buffer to utf8 string', async () => {
      const pgPool = createMockPgPool([
        {
          id: 1,
          host: 'srv',
          port: 1433,
          auth_type: 'sql',
          encrypted_credentials: Buffer.from('encrypted-data'),
        },
      ]);
      const config = createMockConfig();
      const log = createMockLog();

      const scheduler = new CollectorScheduler(pgPool, config, log);
      await startAndFlushFirstTick(scheduler);

      expect(mockedCollectAll).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ encrypted_credentials: 'encrypted-data' }),
        ]),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
      );

      void scheduler.stop();
      await vi.advanceTimersByTimeAsync(200);
    });

    it('should handle null encrypted_credentials (Windows auth)', async () => {
      const pgPool = createMockPgPool([
        {
          id: 1,
          host: 'srv',
          port: 1433,
          auth_type: 'windows',
          encrypted_credentials: null,
        },
      ]);
      const config = createMockConfig();
      const log = createMockLog();

      const scheduler = new CollectorScheduler(pgPool, config, log);
      await startAndFlushFirstTick(scheduler);

      expect(mockedCollectAll).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ encrypted_credentials: null }),
        ]),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
      );

      void scheduler.stop();
      await vi.advanceTimersByTimeAsync(200);
    });

    it('should skip collection when no enabled instances exist', async () => {
      const pgPool = createMockPgPool([]);
      const config = createMockConfig();
      const log = createMockLog();

      const scheduler = new CollectorScheduler(pgPool, config, log);
      await startAndFlushFirstTick(scheduler);

      expect(mockedCollectAll).not.toHaveBeenCalled();
      expect(log.info).toHaveBeenCalledWith('No enabled instances to collect');

      void scheduler.stop();
      await vi.advanceTimersByTimeAsync(200);
    });

    it('should update status after a successful cycle', async () => {
      mockedCollectAll.mockResolvedValue({ success: 3, failed: 1 });

      const pgPool = createMockPgPool(createInstanceRows(4));
      const config = createMockConfig();
      const log = createMockLog();

      const scheduler = new CollectorScheduler(pgPool, config, log);
      await startAndFlushFirstTick(scheduler);

      const status = scheduler.getStatus();
      expect(status.instancesCount).toBe(4);
      expect(status.lastSuccess).toBe(3);
      expect(status.lastFailed).toBe(1);
      expect(status.lastCycleMs).toBeTypeOf('number');
      expect(status.lastCycleAt).toBeInstanceOf(Date);

      void scheduler.stop();
      await vi.advanceTimersByTimeAsync(200);
    });

    it('should log errors from collectAll without crashing', async () => {
      mockedCollectAll.mockRejectedValue(new Error('database connection lost'));

      const pgPool = createMockPgPool(createInstanceRows(1));
      const config = createMockConfig();
      const log = createMockLog();

      const scheduler = new CollectorScheduler(pgPool, config, log);
      await startAndFlushFirstTick(scheduler);

      expect(log.error).toHaveBeenCalledWith(
        expect.any(Error),
        'Collection cycle failed',
      );

      // Scheduler should still be running — not crashed
      expect(scheduler.getStatus().running).toBe(true);

      void scheduler.stop();
      await vi.advanceTimersByTimeAsync(200);
    });

    it('should log errors from pgPool.query without crashing', async () => {
      const pgPool = createMockPgPool();
      (pgPool.query as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('connection refused'),
      );
      const config = createMockConfig();
      const log = createMockLog();

      const scheduler = new CollectorScheduler(pgPool, config, log);
      await startAndFlushFirstTick(scheduler);

      expect(log.error).toHaveBeenCalledWith(
        expect.any(Error),
        'Collection cycle failed',
      );
      expect(scheduler.getStatus().running).toBe(true);

      void scheduler.stop();
      await vi.advanceTimersByTimeAsync(200);
    });
  });

  describe('getStatus()', () => {
    it('should return a copy of the status (not a reference)', () => {
      const pgPool = createMockPgPool();
      const config = createMockConfig();
      const log = createMockLog();

      const scheduler = new CollectorScheduler(pgPool, config, log);
      const s1 = scheduler.getStatus();
      const s2 = scheduler.getStatus();

      expect(s1).toEqual(s2);
      expect(s1).not.toBe(s2);
    });

    it('should have sensible defaults before any cycle runs', () => {
      const pgPool = createMockPgPool();
      const config = createMockConfig();
      const log = createMockLog();

      const scheduler = new CollectorScheduler(pgPool, config, log);
      const status = scheduler.getStatus();

      expect(status).toEqual({
        running: false,
        lastCycleMs: null,
        lastCycleAt: null,
        instancesCount: 0,
        lastSuccess: 0,
        lastFailed: 0,
      });
    });
  });

  describe('interval timing', () => {
    it('should run cycles at the configured interval', async () => {
      const pgPool = createMockPgPool(createInstanceRows(1));
      const config = createMockConfig({ intervalMs: 5000 });
      const log = createMockLog();

      const scheduler = new CollectorScheduler(pgPool, config, log);
      scheduler.start();

      // First immediate tick
      await vi.advanceTimersByTimeAsync(0);
      expect(mockedCollectAll).toHaveBeenCalledTimes(1);

      // After 5s — second tick
      await vi.advanceTimersByTimeAsync(5000);
      expect(mockedCollectAll).toHaveBeenCalledTimes(2);

      // After another 5s — third tick
      await vi.advanceTimersByTimeAsync(5000);
      expect(mockedCollectAll).toHaveBeenCalledTimes(3);

      void scheduler.stop();
      await vi.advanceTimersByTimeAsync(200);
    });

    it('should not fire extra ticks between intervals', async () => {
      const pgPool = createMockPgPool(createInstanceRows(1));
      const config = createMockConfig({ intervalMs: 10_000 });
      const log = createMockLog();

      const scheduler = new CollectorScheduler(pgPool, config, log);
      scheduler.start();

      // First immediate tick
      await vi.advanceTimersByTimeAsync(0);
      expect(mockedCollectAll).toHaveBeenCalledTimes(1);

      // Halfway through interval — no new tick
      await vi.advanceTimersByTimeAsync(5000);
      expect(mockedCollectAll).toHaveBeenCalledTimes(1);

      // Full interval — second tick
      await vi.advanceTimersByTimeAsync(5000);
      expect(mockedCollectAll).toHaveBeenCalledTimes(2);

      void scheduler.stop();
      await vi.advanceTimersByTimeAsync(200);
    });
  });
});
