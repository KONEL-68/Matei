import { describe, it, expect } from 'vitest';
import { insertGapBreaks, fillAllNulls } from '@/lib/chart-utils';

describe('insertGapBreaks', () => {
  it('returns data unchanged when fewer than 2 points', () => {
    const single = [{ ts: 1000, bucket: '2024-01-01T00:00:00Z', value: 10 }];
    expect(insertGapBreaks(single)).toEqual(single);
    expect(insertGapBreaks([])).toEqual([]);
  });

  it('does not insert breaks for evenly spaced data', () => {
    const data = Array.from({ length: 10 }, (_, i) => ({
      ts: 1000 + i * 30000,
      bucket: new Date(1000 + i * 30000).toISOString(),
      cpu: i * 10,
    }));
    const result = insertGapBreaks(data);
    expect(result.length).toBe(10);
  });

  it('inserts two null break points at a large gap', () => {
    // 10 points at 30s intervals, then a 10-minute gap, then 5 more points
    const base = 1700000000000;
    const data = [
      ...Array.from({ length: 10 }, (_, i) => ({
        ts: base + i * 30000,
        bucket: new Date(base + i * 30000).toISOString(),
        cpu: 50,
        mem: 1024,
      })),
      ...Array.from({ length: 5 }, (_, i) => ({
        ts: base + 9 * 30000 + 600000 + i * 30000, // 10min gap after last point
        bucket: new Date(base + 9 * 30000 + 600000 + i * 30000).toISOString(),
        cpu: 60,
        mem: 2048,
      })),
    ];

    const result = insertGapBreaks(data);
    // Should have 15 original + 2 null break points = 17
    expect(result.length).toBe(17);

    // The break points should have null metric values
    const breakPoints = result.filter(p => p.cpu === null);
    expect(breakPoints.length).toBe(2);
    expect(breakPoints[0].mem).toBeNull();
    expect(breakPoints[1].mem).toBeNull();

    // Break points should have valid bucket strings
    expect(breakPoints[0].bucket).toBeTruthy();
    expect(breakPoints[1].bucket).toBeTruthy();
  });

  it('uses custom bucketKey for the timestamp field', () => {
    const base = 1700000000000;
    // 5 points at 30s, then a 10-minute gap, then 2 more
    const data = [
      ...Array.from({ length: 5 }, (_, i) => ({
        ts: base + i * 30000,
        time: `t${i}`,
        val: i as number | null,
      })),
      ...Array.from({ length: 2 }, (_, i) => ({
        ts: base + 4 * 30000 + 600000 + i * 30000,
        time: `t${5 + i}`,
        val: (5 + i) as number | null,
      })),
    ];

    const result = insertGapBreaks(data, 'time');
    expect(result.length).toBe(9); // 7 original + 2 breaks
    // Break points should populate 'time' key
    const breaks = result.filter(p => p.val === null);
    expect(breaks.length).toBe(2);
    expect(typeof breaks[0].time).toBe('string');
  });

  it('does not break on gaps smaller than 10x median', () => {
    const base = 1700000000000;
    // Intervals: 30s, 30s, 30s, 90s (3x median, under 10x threshold)
    const data = [
      { ts: base, bucket: 'a', v: 1 },
      { ts: base + 30000, bucket: 'b', v: 2 },
      { ts: base + 60000, bucket: 'c', v: 3 },
      { ts: base + 90000, bucket: 'd', v: 4 },
      { ts: base + 180000, bucket: 'e', v: 5 }, // 90s gap, 3x median
    ];
    const result = insertGapBreaks(data);
    expect(result.length).toBe(5); // no breaks inserted
  });
});

describe('fillAllNulls', () => {
  it('forward-fills then backward-fills specified keys', () => {
    const data = [
      { ts: 1, cpu: null as number | null, mem: 100 },
      { ts: 2, cpu: 50, mem: null as number | null },
      { ts: 3, cpu: null as number | null, mem: null as number | null },
    ];

    const result = fillAllNulls(data, ['cpu', 'mem']);

    // Forward fill: [null,100] -> [50,100] -> [50,100]
    // Backward fill on leading null: [50,100] -> [50,100] -> [50,100]
    expect(result[0].cpu).toBe(50);
    expect(result[0].mem).toBe(100);
    expect(result[1].cpu).toBe(50);
    expect(result[1].mem).toBe(100);
    expect(result[2].cpu).toBe(50);
    expect(result[2].mem).toBe(100);
  });

  it('does not mutate original data', () => {
    const data = [
      { ts: 1, val: null as number | null },
      { ts: 2, val: 42 },
    ];
    const result = fillAllNulls(data, ['val']);
    expect(result[0].val).toBe(42); // backward filled
    expect(data[0].val).toBeNull(); // original unchanged
  });

  it('returns empty array for empty input', () => {
    expect(fillAllNulls([], ['a'])).toEqual([]);
  });
});
