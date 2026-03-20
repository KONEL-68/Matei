import type pg from 'pg';

export interface AlertRule {
  alertType: string;
  severity: 'warning' | 'critical';
  message: string;
}

interface CycleData {
  instanceId: number;
  cpu?: { sql_cpu_pct: number; other_process_cpu_pct: number };
  memory?: { os_available_memory_mb: number; sql_memory_low_notification: boolean };
  disk?: Array<{ volume_mount_point: string; used_pct: number }>;
  fileIo?: Array<{ file_name: string; read_latency_ms: number; write_latency_ms: number }>;
  blocking?: Array<{ session_id: number; wait_time_ms: number }>;
  reachable: boolean;
}

// Track consecutive cycle counts per instance+type
const consecutiveCounts = new Map<string, number>();

// Cooldown tracking: last alert time per instance+type
const lastAlertTime = new Map<string, number>();

const COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes

function counterKey(instanceId: number, alertType: string): string {
  return `${instanceId}:${alertType}`;
}

function incrementCounter(instanceId: number, alertType: string): number {
  const key = counterKey(instanceId, alertType);
  const count = (consecutiveCounts.get(key) ?? 0) + 1;
  consecutiveCounts.set(key, count);
  return count;
}

function resetCounter(instanceId: number, alertType: string): void {
  consecutiveCounts.delete(counterKey(instanceId, alertType));
}

function getCounter(instanceId: number, alertType: string): number {
  return consecutiveCounts.get(counterKey(instanceId, alertType)) ?? 0;
}

function isDuplicate(instanceId: number, alertType: string, now: number): boolean {
  const key = counterKey(instanceId, alertType);
  const lastTime = lastAlertTime.get(key);
  if (lastTime && now - lastTime < COOLDOWN_MS) {
    return true;
  }
  return false;
}

function markAlertSent(instanceId: number, alertType: string, now: number): void {
  lastAlertTime.set(counterKey(instanceId, alertType), now);
}

/**
 * Evaluate alert rules for a single instance's cycle data.
 * Returns alerts to create (already deduplicated).
 * Exported for testing.
 */
export function evaluateAlerts(data: CycleData, now: number = Date.now()): AlertRule[] {
  const alerts: AlertRule[] = [];

  // CPU checks
  if (data.cpu) {
    const totalCpu = data.cpu.sql_cpu_pct + data.cpu.other_process_cpu_pct;
    if (totalCpu > 90) {
      const count = incrementCounter(data.instanceId, 'cpu_critical');
      resetCounter(data.instanceId, 'cpu_warning');
      if (count >= 3) {
        alerts.push({
          alertType: 'cpu_critical',
          severity: 'critical',
          message: `CPU usage > 90% for ${count} consecutive cycles (current: ${totalCpu}%)`,
        });
      }
    } else if (totalCpu > 75) {
      const count = incrementCounter(data.instanceId, 'cpu_warning');
      resetCounter(data.instanceId, 'cpu_critical');
      if (count >= 3) {
        alerts.push({
          alertType: 'cpu_warning',
          severity: 'warning',
          message: `CPU usage > 75% for ${count} consecutive cycles (current: ${totalCpu}%)`,
        });
      }
    } else {
      resetCounter(data.instanceId, 'cpu_critical');
      resetCounter(data.instanceId, 'cpu_warning');
    }
  }

  // Memory checks
  if (data.memory) {
    if (data.memory.os_available_memory_mb < 512) {
      alerts.push({
        alertType: 'memory_critical',
        severity: 'critical',
        message: `OS available memory critically low: ${data.memory.os_available_memory_mb} MB`,
      });
    }
    if (data.memory.sql_memory_low_notification) {
      alerts.push({
        alertType: 'memory_sql_low',
        severity: 'warning',
        message: 'SQL Server memory low notification active',
      });
    }
  }

  // Disk checks
  if (data.disk) {
    for (const vol of data.disk) {
      if (vol.used_pct > 95) {
        alerts.push({
          alertType: `disk_critical:${vol.volume_mount_point}`,
          severity: 'critical',
          message: `Disk ${vol.volume_mount_point} usage at ${vol.used_pct}% (> 95%)`,
        });
      } else if (vol.used_pct > 90) {
        alerts.push({
          alertType: `disk_warning:${vol.volume_mount_point}`,
          severity: 'warning',
          message: `Disk ${vol.volume_mount_point} usage at ${vol.used_pct}% (> 90%)`,
        });
      }
    }
  }

  // File I/O latency checks
  if (data.fileIo) {
    for (const file of data.fileIo) {
      if (file.read_latency_ms > 50 || file.write_latency_ms > 50) {
        alerts.push({
          alertType: `io_critical:${file.file_name}`,
          severity: 'critical',
          message: `File ${file.file_name} I/O latency critical: read=${file.read_latency_ms.toFixed(1)}ms write=${file.write_latency_ms.toFixed(1)}ms`,
        });
      } else if (file.read_latency_ms > 20 || file.write_latency_ms > 20) {
        alerts.push({
          alertType: `io_warning:${file.file_name}`,
          severity: 'warning',
          message: `File ${file.file_name} I/O latency elevated: read=${file.read_latency_ms.toFixed(1)}ms write=${file.write_latency_ms.toFixed(1)}ms`,
        });
      }
    }
  }

  // Blocking checks
  if (data.blocking) {
    for (const session of data.blocking) {
      const waitSec = session.wait_time_ms / 1000;
      if (waitSec > 300) {
        alerts.push({
          alertType: `blocking_critical:${session.session_id}`,
          severity: 'critical',
          message: `Session ${session.session_id} blocked for ${waitSec.toFixed(0)}s (> 300s)`,
        });
      } else if (waitSec > 60) {
        alerts.push({
          alertType: `blocking_warning:${session.session_id}`,
          severity: 'warning',
          message: `Session ${session.session_id} blocked for ${waitSec.toFixed(0)}s (> 60s)`,
        });
      }
    }
  }

  // Instance unreachable check
  if (!data.reachable) {
    const count = incrementCounter(data.instanceId, 'unreachable');
    if (count >= 3) {
      alerts.push({
        alertType: 'unreachable',
        severity: 'critical',
        message: `Instance unreachable for ${count} consecutive cycles`,
      });
    }
  } else {
    resetCounter(data.instanceId, 'unreachable');
  }

  // Apply deduplication (cooldown)
  const deduplicated: AlertRule[] = [];
  for (const alert of alerts) {
    if (!isDuplicate(data.instanceId, alert.alertType, now)) {
      markAlertSent(data.instanceId, alert.alertType, now);
      deduplicated.push(alert);
    }
  }

  return deduplicated;
}

/**
 * Write alerts to the database.
 */
export async function writeAlerts(
  pgPool: pg.Pool,
  instanceId: number,
  alerts: AlertRule[],
): Promise<void> {
  if (alerts.length === 0) return;

  const values: unknown[] = [];
  const placeholders: string[] = [];
  let idx = 1;

  for (const alert of alerts) {
    placeholders.push(`($${idx++}, $${idx++}, $${idx++}, $${idx++})`);
    values.push(instanceId, alert.alertType, alert.severity, alert.message);
  }

  await pgPool.query(
    `INSERT INTO alerts (instance_id, alert_type, severity, message)
     VALUES ${placeholders.join(', ')}`,
    values,
  );
}

/** Reset all counters and cooldowns (used in testing). */
export function resetAlertState(): void {
  consecutiveCounts.clear();
  lastAlertTime.clear();
}
