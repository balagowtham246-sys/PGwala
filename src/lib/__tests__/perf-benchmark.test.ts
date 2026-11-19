jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

import { endTrace, getPerfSnapshot, recordRoundTrip, resetPerfMonitor, startTrace } from '../perf-monitor';
import { clearQueryCache, getCached, setCached } from '../query-cache';

describe('perf-benchmark (cache overhead vs round-trip baseline)', () => {
  beforeEach(async () => {
    resetPerfMonitor();
    await clearQueryCache();
  });

  it('measures cold-miss vs warm-cache read latency and cache serialization overhead', async () => {
    const samplePayload = {
      residents: Array.from({ length: 40 }, (_, i) => ({
        id: `res-${i}`,
        full_name: `Resident ${i}`,
        room_number: `${100 + (i % 15)}`,
        rent_paise: 850000,
        status: i % 3 === 0 ? 'settled' : 'outstanding',
      })),
      totals: { totalDue: 25500000, collected: 11050000 },
    };

    startTrace('billing:cold-miss');
    recordRoundTrip('billing:cold-miss', 4);
    await setCached('bench:billing:p1', samplePayload, 60_000);
    const coldTrace = endTrace('billing:cold-miss');

    startTrace('billing:warm-hit');
    const cached = await getCached<typeof samplePayload>('bench:billing:p1');
    const warmTrace = endTrace('billing:warm-hit');

    const snapshot = getPerfSnapshot();

    expect(cached?.residents).toHaveLength(40);
    expect(coldTrace?.networkRoundTrips).toBe(4);
    expect(warmTrace?.networkRoundTrips).toBe(0);
    expect(snapshot.totals.cacheReads).toBe(1);
    expect(snapshot.totals.cacheWrites).toBe(1);
    expect(snapshot.totals.avgCacheReadMs).toBeLessThan(100);
    expect(snapshot.totals.avgCacheWriteMs).toBeLessThan(100);
  });
});
