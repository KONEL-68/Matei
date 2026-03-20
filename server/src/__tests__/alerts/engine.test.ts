import { describe, it, expect, beforeEach } from 'vitest';
import { evaluateAlerts, resetAlertState } from '../../alerts/engine.js';

beforeEach(() => {
  resetAlertState();
});

describe('alert engine', () => {
  it('CPU > 90% for 3 cycles triggers critical alert', () => {
    const data = {
      instanceId: 1,
      cpu: { sql_cpu_pct: 80, other_process_cpu_pct: 15 }, // total 95%
      reachable: true,
    };

    // Cycle 1 — no alert yet
    let alerts = evaluateAlerts(data, 1000);
    expect(alerts).toHaveLength(0);

    // Cycle 2 — no alert yet
    alerts = evaluateAlerts(data, 2000);
    expect(alerts).toHaveLength(0);

    // Cycle 3 — critical alert fires
    alerts = evaluateAlerts(data, 3000);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe('critical');
    expect(alerts[0].alertType).toBe('cpu_critical');
  });

  it('CPU > 75% but < 90% for 3 cycles triggers warning', () => {
    const data = {
      instanceId: 2,
      cpu: { sql_cpu_pct: 60, other_process_cpu_pct: 20 }, // total 80%
      reachable: true,
    };

    evaluateAlerts(data, 1000);
    evaluateAlerts(data, 2000);
    const alerts = evaluateAlerts(data, 3000);

    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe('warning');
    expect(alerts[0].alertType).toBe('cpu_warning');
  });

  it('CPU dropping below threshold resets counter', () => {
    const highCpu = {
      instanceId: 3,
      cpu: { sql_cpu_pct: 80, other_process_cpu_pct: 15 }, // 95%
      reachable: true,
    };
    const normalCpu = {
      instanceId: 3,
      cpu: { sql_cpu_pct: 30, other_process_cpu_pct: 10 }, // 40%
      reachable: true,
    };

    evaluateAlerts(highCpu, 1000);
    evaluateAlerts(highCpu, 2000);
    // Drop to normal — resets counter
    evaluateAlerts(normalCpu, 3000);
    // Back to high — counter starts over
    evaluateAlerts(highCpu, 4000);
    evaluateAlerts(highCpu, 5000);
    const alerts = evaluateAlerts(highCpu, 6000);
    // Should fire again because counter reset
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe('critical');
  });

  it('disk > 95% triggers critical', () => {
    const data = {
      instanceId: 4,
      disk: [{ volume_mount_point: 'C:\\', used_pct: 96 }],
      reachable: true,
    };

    const alerts = evaluateAlerts(data, 1000);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe('critical');
    expect(alerts[0].alertType).toContain('disk_critical');
  });

  it('disk > 90% but < 95% triggers warning', () => {
    const data = {
      instanceId: 5,
      disk: [{ volume_mount_point: 'D:\\', used_pct: 92 }],
      reachable: true,
    };

    const alerts = evaluateAlerts(data, 1000);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe('warning');
    expect(alerts[0].alertType).toContain('disk_warning');
  });

  it('deduplication: same alert within 15min cooldown is NOT created twice', () => {
    const data = {
      instanceId: 6,
      disk: [{ volume_mount_point: 'C:\\', used_pct: 97 }],
      reachable: true,
    };

    const now = Date.now();
    const alerts1 = evaluateAlerts(data, now);
    expect(alerts1).toHaveLength(1);

    // 5 minutes later — within cooldown
    const alerts2 = evaluateAlerts(data, now + 5 * 60 * 1000);
    expect(alerts2).toHaveLength(0);

    // 16 minutes later — past cooldown
    const alerts3 = evaluateAlerts(data, now + 16 * 60 * 1000);
    expect(alerts3).toHaveLength(1);
  });

  it('instance unreachable 3+ cycles triggers critical', () => {
    const data = {
      instanceId: 7,
      reachable: false,
    };

    evaluateAlerts(data, 1000);
    evaluateAlerts(data, 2000);
    const alerts = evaluateAlerts(data, 3000);

    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe('critical');
    expect(alerts[0].alertType).toBe('unreachable');
  });

  it('instance becomes reachable resets unreachable counter', () => {
    const unreachable = { instanceId: 8, reachable: false };
    const reachable = { instanceId: 8, reachable: true };

    evaluateAlerts(unreachable, 1000);
    evaluateAlerts(unreachable, 2000);
    // Back online
    evaluateAlerts(reachable, 3000);
    // Offline again — counter restarts
    evaluateAlerts(unreachable, 4000);
    evaluateAlerts(unreachable, 5000);
    const alerts = evaluateAlerts(unreachable, 6000);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].alertType).toBe('unreachable');
  });

  it('memory low notification triggers warning', () => {
    const data = {
      instanceId: 9,
      memory: { os_available_memory_mb: 2048, sql_memory_low_notification: true },
      reachable: true,
    };

    const alerts = evaluateAlerts(data, 1000);
    expect(alerts.some((a) => a.severity === 'warning' && a.alertType === 'memory_sql_low')).toBe(true);
  });

  it('memory < 512 MB triggers critical', () => {
    const data = {
      instanceId: 10,
      memory: { os_available_memory_mb: 256, sql_memory_low_notification: false },
      reachable: true,
    };

    const alerts = evaluateAlerts(data, 1000);
    expect(alerts.some((a) => a.severity === 'critical' && a.alertType === 'memory_critical')).toBe(true);
  });

  it('file I/O read latency > 50ms triggers critical', () => {
    const data = {
      instanceId: 11,
      fileIo: [{ file_name: 'testdb_data', read_latency_ms: 55, write_latency_ms: 5 }],
      reachable: true,
    };

    const alerts = evaluateAlerts(data, 1000);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe('critical');
    expect(alerts[0].alertType).toContain('io_critical');
  });

  it('file I/O write latency > 20ms but < 50ms triggers warning', () => {
    const data = {
      instanceId: 12,
      fileIo: [{ file_name: 'testdb_log', read_latency_ms: 5, write_latency_ms: 25 }],
      reachable: true,
    };

    const alerts = evaluateAlerts(data, 1000);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe('warning');
    expect(alerts[0].alertType).toContain('io_warning');
  });

  it('blocking session > 300s triggers critical', () => {
    const data = {
      instanceId: 13,
      blocking: [{ session_id: 55, wait_time_ms: 400_000 }], // 400 seconds
      reachable: true,
    };

    const alerts = evaluateAlerts(data, 1000);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe('critical');
    expect(alerts[0].alertType).toContain('blocking_critical');
  });

  it('blocking session > 60s but < 300s triggers warning', () => {
    const data = {
      instanceId: 14,
      blocking: [{ session_id: 77, wait_time_ms: 90_000 }], // 90 seconds
      reachable: true,
    };

    const alerts = evaluateAlerts(data, 1000);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe('warning');
    expect(alerts[0].alertType).toContain('blocking_warning');
  });
});
