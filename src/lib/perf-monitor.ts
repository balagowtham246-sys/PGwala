/**
 * Lightweight dev/test-only performance instrumentation for measuring
 * mount-to-data-ready latency, Supabase network round-trips, and
 * AsyncStorage/in-memory cache read/write overhead.
 *
 * Strictly no-op in production builds.
 */

export interface TraceRecord {
  label: string;
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
  networkRoundTrips: number;
}

export interface CacheTimingSample {
  key: string;
  op: 'read' | 'write';
  durationMs: number;
  hit?: boolean;
  timestamp: number;
}

export interface PerfSnapshot {
  traces: TraceRecord[];
  cacheSamples: CacheTimingSample[];
  totals: {
    completedTraces: number;
    totalRoundTrips: number;
    cacheReads: number;
    cacheWrites: number;
    avgCacheReadMs: number;
    avgCacheWriteMs: number;
  };
}

const isPerfEnabled = (): boolean => {
  if (typeof __DEV__ !== 'undefined' && __DEV__) return true;
  return process.env.NODE_ENV === 'test';
};

const nowMs = (): number => {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
};

const activeTraces = new Map<string, TraceRecord>();
const completedTraces: TraceRecord[] = [];
const cacheSamples: CacheTimingSample[] = [];
const MAX_SAMPLES = 250;

function trimArray<T>(arr: T[]): void {
  if (arr.length > MAX_SAMPLES) {
    arr.splice(0, arr.length - MAX_SAMPLES);
  }
}

export function startTrace(label: string): void {
  if (!isPerfEnabled()) return;
  activeTraces.set(label, {
    label,
    startedAt: nowMs(),
    networkRoundTrips: 0,
  });
}

export function recordRoundTrip(label: string, count = 1): void {
  if (!isPerfEnabled()) return;
  const trace = activeTraces.get(label);
  if (trace) {
    trace.networkRoundTrips += count;
    return;
  }
  // If no active trace exists, attach to most recent trace or record standalone
  const latestCompleted = completedTraces[completedTraces.length - 1];
  if (latestCompleted && nowMs() - latestCompleted.startedAt < 5000) {
    latestCompleted.networkRoundTrips += count;
  }
}

export function endTrace(label: string): TraceRecord | null {
  if (!isPerfEnabled()) return null;
  const trace = activeTraces.get(label);
  if (!trace) return null;
  activeTraces.delete(label);
  const endedAt = nowMs();
  const completed: TraceRecord = {
    ...trace,
    endedAt,
    durationMs: Math.max(0, Number((endedAt - trace.startedAt).toFixed(3))),
  };
  completedTraces.push(completed);
  trimArray(completedTraces);
  return completed;
}

export function recordCacheRead(key: string, durationMs: number, hit: boolean): void {
  if (!isPerfEnabled()) return;
  cacheSamples.push({
    key,
    op: 'read',
    durationMs: Math.max(0, Number(durationMs.toFixed(3))),
    hit,
    timestamp: Date.now(),
  });
  trimArray(cacheSamples);
}

export function recordCacheWrite(key: string, durationMs: number): void {
  if (!isPerfEnabled()) return;
  cacheSamples.push({
    key,
    op: 'write',
    durationMs: Math.max(0, Number(durationMs.toFixed(3))),
    timestamp: Date.now(),
  });
  trimArray(cacheSamples);
}

export function getPerfSnapshot(): PerfSnapshot {
  const reads = cacheSamples.filter((s) => s.op === 'read');
  const writes = cacheSamples.filter((s) => s.op === 'write');
  const avg = (items: CacheTimingSample[]): number =>
    items.length === 0
      ? 0
      : Number((items.reduce((acc, s) => acc + s.durationMs, 0) / items.length).toFixed(3));

  return {
    traces: [...completedTraces],
    cacheSamples: [...cacheSamples],
    totals: {
      completedTraces: completedTraces.length,
      totalRoundTrips: completedTraces.reduce((acc, t) => acc + t.networkRoundTrips, 0),
      cacheReads: reads.length,
      cacheWrites: writes.length,
      avgCacheReadMs: avg(reads),
      avgCacheWriteMs: avg(writes),
    },
  };
}

export function resetPerfMonitor(): void {
  activeTraces.clear();
  completedTraces.length = 0;
  cacheSamples.length = 0;
}

