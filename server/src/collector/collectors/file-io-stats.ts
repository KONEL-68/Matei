import type sql from 'mssql';

export interface FileIoSnapshot {
  database_name: string;
  file_name: string;
  file_type: string;
  physical_name: string;
  database_id: number;
  file_id: number;
  num_of_reads: number;
  num_of_bytes_read: number;
  io_stall_read_ms: number;
  num_of_writes: number;
  num_of_bytes_written: number;
  io_stall_write_ms: number;
  io_stall: number;
  size_on_disk_bytes: number;
  collected_at_utc: Date;
}

export interface FileIoDelta {
  database_name: string;
  file_name: string;
  file_type: string;
  num_of_reads_delta: number;
  num_of_bytes_read_delta: number;
  io_stall_read_ms_delta: number;
  num_of_writes_delta: number;
  num_of_bytes_written_delta: number;
  io_stall_write_ms_delta: number;
  size_on_disk_bytes: number;
  read_bytes_per_sec: number;
  write_bytes_per_sec: number;
  read_latency_ms: number;
  write_latency_ms: number;
}

interface PreviousState {
  snapshot: FileIoSnapshot[];
  collectedAt: Date;
  sqlserverStartTime: Date;
}

// In-memory store for previous snapshots per instance
const previousSnapshots = new Map<number, PreviousState>();

const QUERY = `
SELECT
    DB_NAME(vfs.database_id)    AS database_name,
    mf.name                     AS file_name,
    mf.type_desc                AS file_type,
    mf.physical_name,
    vfs.database_id,
    vfs.file_id,
    vfs.num_of_reads,
    vfs.num_of_bytes_read,
    vfs.io_stall_read_ms,
    vfs.num_of_writes,
    vfs.num_of_bytes_written,
    vfs.io_stall_write_ms,
    vfs.io_stall,
    vfs.size_on_disk_bytes,
    GETUTCDATE()                AS collected_at_utc
FROM sys.dm_io_virtual_file_stats(NULL, NULL) vfs
JOIN sys.master_files mf
    ON vfs.database_id = mf.database_id
    AND vfs.file_id = mf.file_id
ORDER BY vfs.io_stall DESC
`;

/**
 * Compute delta between current and previous file I/O snapshots.
 * Exported for testing.
 */
export function computeFileIoDelta(
  current: FileIoSnapshot[],
  previous: FileIoSnapshot[],
  elapsedSeconds: number,
): FileIoDelta[] {
  const prevMap = new Map(
    previous.map((r) => [`${r.database_id}:${r.file_id}`, r]),
  );
  const deltas: FileIoDelta[] = [];

  for (const curr of current) {
    const key = `${curr.database_id}:${curr.file_id}`;
    const prev = prevMap.get(key);
    if (!prev) continue;

    const readsDelta = curr.num_of_reads - prev.num_of_reads;
    const byteReadDelta = curr.num_of_bytes_read - prev.num_of_bytes_read;
    const stallReadDelta = curr.io_stall_read_ms - prev.io_stall_read_ms;
    const writesDelta = curr.num_of_writes - prev.num_of_writes;
    const byteWriteDelta = curr.num_of_bytes_written - prev.num_of_bytes_written;
    const stallWriteDelta = curr.io_stall_write_ms - prev.io_stall_write_ms;

    // Skip if counters went backwards (shouldn't happen without restart, but be safe)
    if (byteReadDelta < 0 || byteWriteDelta < 0) continue;

    const seconds = elapsedSeconds > 0 ? elapsedSeconds : 1;

    deltas.push({
      database_name: curr.database_name,
      file_name: curr.file_name,
      file_type: curr.file_type,
      num_of_reads_delta: readsDelta,
      num_of_bytes_read_delta: byteReadDelta,
      io_stall_read_ms_delta: stallReadDelta,
      num_of_writes_delta: writesDelta,
      num_of_bytes_written_delta: byteWriteDelta,
      io_stall_write_ms_delta: stallWriteDelta,
      size_on_disk_bytes: curr.size_on_disk_bytes,
      read_bytes_per_sec: byteReadDelta / seconds,
      write_bytes_per_sec: byteWriteDelta / seconds,
      read_latency_ms: readsDelta > 0 ? stallReadDelta / readsDelta : 0,
      write_latency_ms: writesDelta > 0 ? stallWriteDelta / writesDelta : 0,
    });
  }

  return deltas;
}

/**
 * Collect file I/O stats and compute delta.
 * Returns null on first collection or after instance restart.
 */
export async function collectFileIoStats(
  request: sql.Request,
  instanceId: number,
  sqlserverStartTime: Date,
): Promise<FileIoDelta[] | null> {
  const result = await request.query(QUERY);
  const currentSnapshot = result.recordset as FileIoSnapshot[];
  const collectedAt = currentSnapshot[0]?.collected_at_utc ?? new Date();

  const prev = previousSnapshots.get(instanceId);

  // Store current snapshot for next cycle
  previousSnapshots.set(instanceId, {
    snapshot: currentSnapshot,
    collectedAt,
    sqlserverStartTime,
  });

  // First collection — no previous data
  if (!prev) {
    return null;
  }

  // Instance restarted — sqlserver_start_time changed
  if (prev.sqlserverStartTime.getTime() !== sqlserverStartTime.getTime()) {
    return null;
  }

  const elapsedSeconds =
    (collectedAt.getTime() - prev.collectedAt.getTime()) / 1000;

  return computeFileIoDelta(currentSnapshot, prev.snapshot, elapsedSeconds);
}

/** Clear stored snapshot for an instance. */
export function clearSnapshot(instanceId: number): void {
  previousSnapshots.delete(instanceId);
}

/** Reset all stored snapshots (used in testing). */
export function resetAllSnapshots(): void {
  previousSnapshots.clear();
}
