import type pg from 'pg';
import type { AppConfig } from '../config.js';
import type { InstanceRecord } from '../lib/mssql.js';
import { collectAll } from './worker-pool.js';

export interface CollectorStatus {
  running: boolean;
  lastCycleMs: number | null;
  lastCycleAt: Date | null;
  instancesCount: number;
  lastSuccess: number;
  lastFailed: number;
}

export class CollectorScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private cycling = false;
  private status: CollectorStatus = {
    running: false,
    lastCycleMs: null,
    lastCycleAt: null,
    instancesCount: 0,
    lastSuccess: 0,
    lastFailed: 0,
  };

  constructor(
    private pgPool: pg.Pool,
    private config: AppConfig,
    private log: { info: (...args: unknown[]) => void; error: (...args: unknown[]) => void; warn: (...args: unknown[]) => void },
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.status.running = true;

    this.log.info(`Collector scheduler starting (interval: ${this.config.collector.intervalMs}ms, workers: ${this.config.collector.workers})`);

    // Run first cycle immediately
    void this.tick();

    this.timer = setInterval(() => void this.tick(), this.config.collector.intervalMs);
  }

  async stop(): Promise<void> {
    this.running = false;
    this.status.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    // Wait for current cycle to finish
    while (this.cycling) {
      await new Promise((r) => setTimeout(r, 100));
    }
    this.log.info('Collector scheduler stopped');
  }

  getStatus(): CollectorStatus {
    return { ...this.status };
  }

  private async tick(): Promise<void> {
    if (this.cycling) {
      this.log.info('Previous collection cycle still running, skipping');
      return;
    }

    this.cycling = true;
    const startTime = Date.now();

    try {
      // Fetch all enabled instances
      const result = await this.pgPool.query(
        'SELECT id, host, port, auth_type, encrypted_credentials FROM instances WHERE is_enabled = true',
      );

      const instances: InstanceRecord[] = result.rows.map((row) => ({
        id: row.id,
        host: row.host,
        port: row.port,
        auth_type: row.auth_type,
        encrypted_credentials: row.encrypted_credentials
          ? row.encrypted_credentials.toString('utf8')
          : null,
      }));

      this.status.instancesCount = instances.length;

      if (instances.length === 0) {
        this.log.info('No enabled instances to collect');
        this.cycling = false;
        return;
      }

      this.log.info(`Collection cycle starting: ${instances.length} instances`);

      const { success, failed } = await collectAll(
        instances,
        this.pgPool,
        this.config.encryptionKey,
        this.config.collector.workers,
        this.log,
      );

      const durationMs = Date.now() - startTime;
      this.status.lastCycleMs = durationMs;
      this.status.lastCycleAt = new Date();
      this.status.lastSuccess = success;
      this.status.lastFailed = failed;

      this.log.info(
        `Collection cycle complete: ${success} ok, ${failed} failed, ${durationMs}ms`,
      );
    } catch (err) {
      this.log.error(err, 'Collection cycle failed');
    } finally {
      this.cycling = false;
    }
  }
}
