import { describe, it, expect } from 'vitest';
import { dailyPartitionInfo, monthlyPartitionInfo, buildDropStatement } from '../../jobs/partition-manager.js';

describe('partition-manager', () => {
  describe('dailyPartitionInfo', () => {
    it('generates correct partition name and bounds for a given date', () => {
      const date = new Date(2026, 2, 20); // March 20, 2026
      const result = dailyPartitionInfo('os_cpu', date);

      expect(result.partitionName).toBe('os_cpu_20260320');
      expect(result.startDate).toBe('2026-03-20');
      expect(result.endDate).toBe('2026-03-21');
    });

    it('generates correct partitions for next 7 days', () => {
      const baseDate = new Date(2026, 2, 28); // March 28 — crosses month boundary
      const partitions = [];
      for (let i = 0; i <= 7; i++) {
        const d = new Date(baseDate);
        d.setDate(d.getDate() + i);
        partitions.push(dailyPartitionInfo('wait_stats_raw', d));
      }

      expect(partitions).toHaveLength(8);
      expect(partitions[0].partitionName).toBe('wait_stats_raw_20260328');
      expect(partitions[0].startDate).toBe('2026-03-28');
      expect(partitions[3].partitionName).toBe('wait_stats_raw_20260331');
      expect(partitions[4].partitionName).toBe('wait_stats_raw_20260401');
      expect(partitions[4].startDate).toBe('2026-04-01');
      expect(partitions[4].endDate).toBe('2026-04-02');
    });

    it('handles year boundary correctly', () => {
      const date = new Date(2026, 11, 31); // December 31, 2026
      const result = dailyPartitionInfo('os_memory', date);

      expect(result.partitionName).toBe('os_memory_20261231');
      expect(result.startDate).toBe('2026-12-31');
      expect(result.endDate).toBe('2027-01-01');
    });
  });

  describe('monthlyPartitionInfo', () => {
    it('generates correct monthly partition name and bounds', () => {
      const date = new Date(2026, 2, 15); // March 15
      const result = monthlyPartitionInfo('os_cpu_5min', date);

      expect(result.partitionName).toBe('os_cpu_5min_202603');
      expect(result.startDate).toBe('2026-03-01');
      expect(result.endDate).toBe('2026-04-01');
    });

    it('handles December → January boundary', () => {
      const date = new Date(2026, 11, 1); // December
      const result = monthlyPartitionInfo('wait_stats_hourly', date);

      expect(result.partitionName).toBe('wait_stats_hourly_202612');
      expect(result.startDate).toBe('2026-12-01');
      expect(result.endDate).toBe('2027-01-01');
    });
  });

  describe('buildDropStatement', () => {
    it('builds correct DROP TABLE statement', () => {
      const stmt = buildDropStatement('os_cpu_20260310');
      expect(stmt).toBe('DROP TABLE IF EXISTS os_cpu_20260310');
    });

    it('builds correct DROP for monthly partition', () => {
      const stmt = buildDropStatement('wait_stats_5min_202601');
      expect(stmt).toBe('DROP TABLE IF EXISTS wait_stats_5min_202601');
    });
  });
});
