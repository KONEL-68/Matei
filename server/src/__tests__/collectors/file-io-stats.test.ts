import { describe, it, expect } from 'vitest';
import { computeFileIoDelta, type FileIoSnapshot } from '../../collector/collectors/file-io-stats.js';

function makeSnapshot(overrides: Partial<FileIoSnapshot> & { database_id: number; file_id: number }): FileIoSnapshot {
  return {
    database_name: 'testdb',
    file_name: 'testdb_data',
    file_type: 'ROWS',
    physical_name: 'C:\\data\\testdb.mdf',
    num_of_reads: 0,
    num_of_bytes_read: 0,
    io_stall_read_ms: 0,
    num_of_writes: 0,
    num_of_bytes_written: 0,
    io_stall_write_ms: 0,
    io_stall: 0,
    size_on_disk_bytes: 1048576,
    volume_mount_point: 'C:\\',
    collected_at_utc: new Date(),
    ...overrides,
  };
}

describe('file-io-stats delta computation', () => {
  it('computes correct bytes/sec and latency', () => {
    const elapsed = 30; // 30 seconds between snapshots
    const previous: FileIoSnapshot[] = [
      makeSnapshot({
        database_id: 1,
        file_id: 1,
        num_of_reads: 1000,
        num_of_bytes_read: 10_000_000,
        io_stall_read_ms: 5000,
        num_of_writes: 500,
        num_of_bytes_written: 5_000_000,
        io_stall_write_ms: 2000,
      }),
    ];
    const current: FileIoSnapshot[] = [
      makeSnapshot({
        database_id: 1,
        file_id: 1,
        num_of_reads: 1300,
        num_of_bytes_read: 13_000_000,
        io_stall_read_ms: 6500,
        num_of_writes: 700,
        num_of_bytes_written: 7_000_000,
        io_stall_write_ms: 3000,
      }),
    ];

    const deltas = computeFileIoDelta(current, previous, elapsed);

    expect(deltas).toHaveLength(1);
    const d = deltas[0];
    expect(d.num_of_reads_delta).toBe(300);
    expect(d.num_of_bytes_read_delta).toBe(3_000_000);
    expect(d.io_stall_read_ms_delta).toBe(1500);
    expect(d.num_of_writes_delta).toBe(200);
    expect(d.num_of_bytes_written_delta).toBe(2_000_000);
    expect(d.io_stall_write_ms_delta).toBe(1000);

    // bytes/sec = delta_bytes / elapsed_seconds
    expect(d.read_bytes_per_sec).toBe(3_000_000 / 30);
    expect(d.write_bytes_per_sec).toBe(2_000_000 / 30);

    // latency = stall_delta / reads_delta
    expect(d.read_latency_ms).toBe(1500 / 300);
    expect(d.write_latency_ms).toBe(1000 / 200);
  });

  it('returns empty on first collection (no previous data)', () => {
    const current: FileIoSnapshot[] = [
      makeSnapshot({ database_id: 1, file_id: 1, num_of_reads: 100, num_of_bytes_read: 1000 }),
    ];

    // No previous data → computeFileIoDelta with empty previous returns empty
    const deltas = computeFileIoDelta(current, [], 30);
    expect(deltas).toHaveLength(0);
  });

  it('skips files with negative delta (instance restart)', () => {
    const previous: FileIoSnapshot[] = [
      makeSnapshot({
        database_id: 1,
        file_id: 1,
        num_of_reads: 10000,
        num_of_bytes_read: 50_000_000,
        num_of_writes: 5000,
        num_of_bytes_written: 25_000_000,
      }),
    ];
    const current: FileIoSnapshot[] = [
      makeSnapshot({
        database_id: 1,
        file_id: 1,
        num_of_reads: 100,
        num_of_bytes_read: 500_000,
        num_of_writes: 50,
        num_of_bytes_written: 250_000,
      }),
    ];

    const deltas = computeFileIoDelta(current, previous, 30);
    expect(deltas).toHaveLength(0);
  });

  it('zero reads: latency = 0, not NaN/Infinity', () => {
    const previous: FileIoSnapshot[] = [
      makeSnapshot({
        database_id: 1,
        file_id: 1,
        num_of_reads: 1000,
        num_of_bytes_read: 10_000_000,
        io_stall_read_ms: 5000,
        num_of_writes: 500,
        num_of_bytes_written: 5_000_000,
        io_stall_write_ms: 2000,
      }),
    ];
    // Same reads/writes as previous = zero delta for reads/writes
    const current: FileIoSnapshot[] = [
      makeSnapshot({
        database_id: 1,
        file_id: 1,
        num_of_reads: 1000,
        num_of_bytes_read: 10_000_000,
        io_stall_read_ms: 5000,
        num_of_writes: 500,
        num_of_bytes_written: 5_000_000,
        io_stall_write_ms: 2000,
      }),
    ];

    const deltas = computeFileIoDelta(current, previous, 30);
    expect(deltas).toHaveLength(1);
    const d = deltas[0];
    expect(d.read_latency_ms).toBe(0);
    expect(d.write_latency_ms).toBe(0);
    expect(Number.isNaN(d.read_latency_ms)).toBe(false);
    expect(Number.isNaN(d.write_latency_ms)).toBe(false);
    expect(Number.isFinite(d.read_latency_ms)).toBe(true);
    expect(Number.isFinite(d.write_latency_ms)).toBe(true);
  });

  it('handles multiple files across databases', () => {
    const previous: FileIoSnapshot[] = [
      makeSnapshot({ database_id: 1, file_id: 1, file_name: 'db1_data', num_of_reads: 100, num_of_bytes_read: 1000 }),
      makeSnapshot({ database_id: 2, file_id: 1, file_name: 'db2_data', num_of_reads: 200, num_of_bytes_read: 2000 }),
    ];
    const current: FileIoSnapshot[] = [
      makeSnapshot({ database_id: 1, file_id: 1, file_name: 'db1_data', num_of_reads: 150, num_of_bytes_read: 1500 }),
      makeSnapshot({ database_id: 2, file_id: 1, file_name: 'db2_data', num_of_reads: 300, num_of_bytes_read: 3000 }),
    ];

    const deltas = computeFileIoDelta(current, previous, 30);
    expect(deltas).toHaveLength(2);
    expect(deltas[0].num_of_reads_delta).toBe(50);
    expect(deltas[1].num_of_reads_delta).toBe(100);
  });

  it('skips new files not present in previous snapshot', () => {
    const previous: FileIoSnapshot[] = [
      makeSnapshot({ database_id: 1, file_id: 1 }),
    ];
    const current: FileIoSnapshot[] = [
      makeSnapshot({ database_id: 1, file_id: 1, num_of_bytes_read: 100 }),
      makeSnapshot({ database_id: 3, file_id: 1, num_of_bytes_read: 500 }),
    ];

    const deltas = computeFileIoDelta(current, previous, 30);
    expect(deltas).toHaveLength(1);
  });
});
