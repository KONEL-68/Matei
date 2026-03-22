import { describe, it, expect } from 'vitest';
import { buildBlockingTrees } from '../../routes/metrics.js';

describe('buildBlockingTrees', () => {
  it('returns empty array for no sessions', () => {
    expect(buildBlockingTrees([])).toEqual([]);
  });

  it('builds a simple chain: blocker -> blocked', () => {
    const rows = [
      { session_id: 55, blocking_session_id: null, login_name: 'admin', database_name: 'DB1', wait_type: null, wait_time_ms: null, elapsed_time_ms: 5000, current_statement: 'UPDATE t SET x=1' },
      { session_id: 60, blocking_session_id: 55, login_name: 'app', database_name: 'DB1', wait_type: 'LCK_M_X', wait_time_ms: 3000, elapsed_time_ms: 3000, current_statement: 'SELECT * FROM t' },
    ];

    const trees = buildBlockingTrees(rows);
    expect(trees).toHaveLength(1);
    expect(trees[0].session_id).toBe(55);
    expect(trees[0].children).toHaveLength(1);
    expect(trees[0].children[0].session_id).toBe(60);
  });

  it('builds a multi-level chain: A -> B -> C', () => {
    const rows = [
      { session_id: 10, blocking_session_id: null, login_name: 'root', database_name: 'DB', wait_type: null, wait_time_ms: null, elapsed_time_ms: null, current_statement: null },
      { session_id: 20, blocking_session_id: 10, login_name: 'app', database_name: 'DB', wait_type: 'LCK_M_S', wait_time_ms: 5000, elapsed_time_ms: 5000, current_statement: null },
      { session_id: 30, blocking_session_id: 20, login_name: 'app2', database_name: 'DB', wait_type: 'LCK_M_S', wait_time_ms: 3000, elapsed_time_ms: 3000, current_statement: null },
    ];

    const trees = buildBlockingTrees(rows);
    expect(trees).toHaveLength(1);
    expect(trees[0].session_id).toBe(10);
    expect(trees[0].children).toHaveLength(1);
    expect(trees[0].children[0].session_id).toBe(20);
    expect(trees[0].children[0].children).toHaveLength(1);
    expect(trees[0].children[0].children[0].session_id).toBe(30);
  });

  it('handles multiple independent chains', () => {
    const rows = [
      { session_id: 10, blocking_session_id: null, login_name: 'a', database_name: 'DB', wait_type: null, wait_time_ms: null, elapsed_time_ms: null, current_statement: null },
      { session_id: 20, blocking_session_id: 10, login_name: 'b', database_name: 'DB', wait_type: 'LCK_M_X', wait_time_ms: 1000, elapsed_time_ms: 1000, current_statement: null },
      { session_id: 30, blocking_session_id: null, login_name: 'c', database_name: 'DB2', wait_type: null, wait_time_ms: null, elapsed_time_ms: null, current_statement: null },
      { session_id: 40, blocking_session_id: 30, login_name: 'd', database_name: 'DB2', wait_type: 'LCK_M_S', wait_time_ms: 2000, elapsed_time_ms: 2000, current_statement: null },
    ];

    const trees = buildBlockingTrees(rows);
    expect(trees).toHaveLength(2);
  });

  it('handles blocker not in data set (blocked session becomes root)', () => {
    const rows = [
      { session_id: 60, blocking_session_id: 55, login_name: 'app', database_name: 'DB', wait_type: 'LCK_M_X', wait_time_ms: 3000, elapsed_time_ms: 3000, current_statement: null },
    ];

    const trees = buildBlockingTrees(rows);
    expect(trees).toHaveLength(1);
    expect(trees[0].session_id).toBe(60);
  });

  it('handles cycles safely (A blocks B, B blocks A)', () => {
    const rows = [
      { session_id: 10, blocking_session_id: 20, login_name: 'a', database_name: 'DB', wait_type: 'LCK_M_X', wait_time_ms: 5000, elapsed_time_ms: 5000, current_statement: null },
      { session_id: 20, blocking_session_id: 10, login_name: 'b', database_name: 'DB', wait_type: 'LCK_M_S', wait_time_ms: 3000, elapsed_time_ms: 3000, current_statement: null },
    ];

    const trees = buildBlockingTrees(rows);
    // Should not infinite-loop; both sessions appear somewhere in the output
    const allIds = new Set<number>();
    function collectIds(nodes: typeof trees) {
      for (const n of nodes) {
        allIds.add(n.session_id);
        collectIds(n.children);
      }
    }
    collectIds(trees);
    expect(allIds.has(10)).toBe(true);
    expect(allIds.has(20)).toBe(true);
  });

  it('a session cannot be its own blocker', () => {
    const rows = [
      { session_id: 10, blocking_session_id: 10, login_name: 'a', database_name: 'DB', wait_type: 'LCK_M_X', wait_time_ms: 1000, elapsed_time_ms: 1000, current_statement: null },
    ];

    const trees = buildBlockingTrees(rows);
    // Session 10 blocks itself — should still produce output without infinite loop
    expect(trees.length).toBeGreaterThanOrEqual(1);
  });
});
