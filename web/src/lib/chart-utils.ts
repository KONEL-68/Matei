/**
 * Shared chart utilities for time-series gap detection.
 *
 * When the backend is offline (e.g. overnight), there are large gaps in the
 * collected data. Without gap handling, Recharts draws continuous lines across
 * these gaps which is misleading. These utilities insert null-valued points at
 * detected gaps so that `connectNulls={false}` on Line/Area components breaks
 * the line visually.
 */

/**
 * Insert null-valued break points at large time gaps so Recharts breaks lines.
 *
 * Works with any array of objects that has a numeric `ts` field. All other
 * fields on the gap-break points are set to null. The caller must also set
 * `connectNulls={false}` on Line/Area components for the gaps to render.
 *
 * Threshold: 10x the median interval between consecutive points.
 *
 * @param data  Array sorted by `ts` ascending. Each element must have a numeric
 *              `ts` field; all other fields should be number | string | null.
 * @param bucketKey  Name of the string timestamp field to populate on gap
 *                   points (default: `"bucket"`). Set to the field your XAxis
 *                   uses as dataKey so Recharts can still render the point.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function insertGapBreaks<T extends { ts: number; [key: string]: any }>(
  data: T[],
  bucketKey: string = 'bucket',
): T[] {
  if (data.length < 2) return data;

  // Compute median interval
  const intervals: number[] = [];
  for (let i = 1; i < data.length; i++) {
    intervals.push(data[i].ts - data[i - 1].ts);
  }
  intervals.sort((a, b) => a - b);
  const median = intervals[Math.floor(intervals.length / 2)];
  const threshold = median * 10;

  const result: T[] = [data[0]];
  for (let i = 1; i < data.length; i++) {
    const prev = data[i - 1];
    const curr = data[i];
    if (curr.ts - prev.ts > threshold) {
      // Build a null point: keep ts and bucketKey, null everything else
      const nullPoint: Record<string, unknown> = {};
      for (const key of Object.keys(prev)) {
        nullPoint[key] = null;
      }
      const nullPoint2: Record<string, unknown> = { ...nullPoint };

      nullPoint.ts = prev.ts + 1;
      nullPoint[bucketKey] = new Date(prev.ts + 1).toISOString();

      nullPoint2.ts = curr.ts - 1;
      nullPoint2[bucketKey] = new Date(curr.ts - 1).toISOString();

      result.push(nullPoint as T, nullPoint2 as T);
    }
    result.push(curr);
  }
  return result;
}

/**
 * Generate evenly-spaced tick values for a numeric time axis.
 *
 * @param minTs  Start of the time range (epoch ms).
 * @param maxTs  End of the time range (epoch ms).
 * @param count  Desired number of ticks (default 10). Actual count may differ
 *               slightly due to rounding to a "nice" interval.
 */
export function generateTicks(minTs: number, maxTs: number, count: number = 10): number[] {
  if (maxTs <= minTs || count < 1) return [];
  const interval = (maxTs - minTs) / count;
  const ticks: number[] = [];
  for (let i = 1; i < count; i++) {
    ticks.push(Math.round(minTs + i * interval));
  }
  return ticks;
}

/**
 * Forward-fill then backward-fill sparse metric nulls.
 *
 * Used by OverviewTimeline where a single row may have some metrics collected
 * and others null (because different metrics have different collection
 * frequencies). This fills those "natural" nulls so that only the synthetic
 * nulls from `insertGapBreaks` actually break lines.
 *
 * @param data  Array of data points.
 * @param keys  The metric keys to fill (e.g. ['cpu', 'memory', 'waits']).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function fillAllNulls<T extends { [key: string]: any }>(
  data: T[],
  keys: string[],
): T[] {
  if (data.length === 0) return data;
  const result = data.map(pt => ({ ...pt }));

  // Forward fill
  const last: Record<string, unknown> = {};
  for (const k of keys) last[k] = null;
  for (const pt of result) {
    for (const k of keys) {
      if (pt[k] != null) last[k] = pt[k];
      else (pt as Record<string, unknown>)[k] = last[k];
    }
  }

  // Backward fill (catches leading nulls)
  const next: Record<string, unknown> = {};
  for (const k of keys) next[k] = null;
  for (let i = result.length - 1; i >= 0; i--) {
    const pt = result[i];
    for (const k of keys) {
      if (pt[k] != null) next[k] = pt[k];
      else (pt as Record<string, unknown>)[k] = next[k];
    }
  }

  return result;
}
