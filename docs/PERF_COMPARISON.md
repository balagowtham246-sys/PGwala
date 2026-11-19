# Performance & Modularity Comparison (`Before` vs `After`)

## 1. Automated Verification & Bundle Metrics

| Metric | Before Refactoring | After Refactoring | Delta / Notes |
|---|---:|---:|---|
| `npx tsc --noEmit` | 0 errors | **0 errors** | Clean strict TypeScript pass |
| `npx expo lint` | 0 errors, 89 warnings | **0 errors, 64 warnings** | **-25 warnings** (-28.1%) |
| `npm test` | 12 suites, 92 tests (3.157 s) | **20 suites, 117 tests (4.169 s)** | **+8 suites, +25 tests** (+1.012 s runtime incl. PGlite WASM) |
| Android `.hbc` Bundle (`npx expo export --platform android`) | 9,806,323 bytes (4,457 modules) | **9,933,335 bytes** (4,485 modules) | **+127,012 bytes (+124.0 KB / +1.30%)**, zero new npm dependencies |

> **Bundle trade-off note:** Extracting typed services (`src/services/`), SWR cache/offline queue (`src/lib/`), hooks (`src/hooks/`), and modular UI subcomponents added `124.0 KB` (`+1.30%`) to the compiled Hermes `.hbc` bundle with zero third-party dependencies.

---

## 2. Monolith File Size Reduction

| Target File | Before (Bytes / Lines) | After (Bytes / Lines) | Reduction |
|---|---:|---:|---:|
| [billing-management.tsx](file:///c:/Users/balag/pgwala/src/app/billing-management.tsx) | 100,801 B / 2,900 | **30,310 B / 948** | **-69.9% bytes** |
| [index.tsx](file:///c:/Users/balag/pgwala/src/app/(tabs)/index.tsx) | 78,157 B / 2,414 | **50,950 B / 1,651** | **-34.8% bytes** |
| [food-menu.tsx](file:///c:/Users/balag/pgwala/src/app/food-menu.tsx) | 50,597 B / 1,675 | **22,124 B / 736** | **-56.3% bytes** |
| [washing-machine-card.tsx](file:///c:/Users/balag/pgwala/src/components/washing-machine-card.tsx) | 49,849 B / 1,617 | **27,264 B / 960** | **-45.3% bytes** |
| [student-dashboard.tsx](file:///c:/Users/balag/pgwala/src/app/student-dashboard.tsx) | 49,317 B / 1,641 | **21,124 B / 667** | **-57.2% bytes** |
| [student-billing.tsx](file:///c:/Users/balag/pgwala/src/app/student-billing.tsx) | 48,791 B / 1,535 | **10,781 B / 368** | **-77.9% bytes** |

---

## 3. Network Round-Trip Waves & Cache Overhead Measurements

| Screen / Service | Before Initial Network Pattern | After Initial Network Pattern (Cold Miss) | Warm Cache Hit Behavior |
|---|---|---|---|
| Owner Billing ([billing.service.ts](file:///c:/Users/balag/pgwala/src/services/billing.service.ts)) | 6–7 sequential queries | **3–4 waves** (`properties` optional → `residents` → 4 parallel via `Promise.all` → `payment_allocations` if settled) | Instant SWR render from `billing:owner:*` + background refresh |
| Student Billing ([billing.service.ts](file:///c:/Users/balag/pgwala/src/services/billing.service.ts)) | 4 sequential queries | **2–3 waves** (`residents` → 2 parallel via `Promise.all` → `payment_allocations` if settled) | Instant SWR render from `billing:student:*` + background refresh |
| Student Dashboard ([dashboard.service.ts](file:///c:/Users/balag/pgwala/src/services/dashboard.service.ts)) | 3 waves | **2 waves** fast path (`residents` → `Promise.all([RPC, charges, chat, AsyncStorage])`) | Unified `dashboard:student:*` SWR cache |
| Owner Dashboard ([dashboard.service.ts](file:///c:/Users/balag/pgwala/src/services/dashboard.service.ts)) | 1 wave fast path / 3 waves fallback | **1 wave** fast path / 3 waves fallback | Unified `dashboard:owner:*` SWR cache |
| Food Menu ([food-menu.service.ts](file:///c:/Users/balag/pgwala/src/services/food-menu.service.ts)) | 1–2 sequential queries every date visit | 1–2 queries on cold date miss + in-flight request deduplication | **0 network round-trips** within fresh TTL (`fromCache: true`) |
| Washing Machine ([washing-machine.service.ts](file:///c:/Users/balag/pgwala/src/services/washing-machine.service.ts)) | 1–2 RPCs + 4 Realtime listeners | 1–2 RPCs + 4 Realtime listeners (strictly live, uncached) | Realtime-first (no stale timer risk) |

### Measured Cache Overhead (40-Resident Billing Snapshot, `4,252` Bytes)
- **In-memory `Map` hit (`memoryHitMs`)**: `0.0005 ms`
- **Cold JSON serialize (`serializeMs`)**: `0.0325 ms`
- **Cold JSON parse (`coldJsonParseMs`)**: `0.0331 ms`
- **`perf-benchmark.test.ts` end-to-end cache write + read + trace check**: `3 ms`

### Honest Trade-Off Summary
1. **Where caching helps:** Subsequent screen switches/tab revisits serve cached state from memory (`<1 ms`) or `AsyncStorage` immediately while refreshing in the background, and parallelized `Promise.all` batches in `billing.service.ts` and `dashboard.service.ts` cut sequential network waves even on cold misses.
2. **Where caching adds cost:** Cold-miss first loads incur an extra `AsyncStorage` serialization/write (`~0.03 ms` JS CPU + platform storage write) and `+124 KB` `.hbc` code footprint. Washing machine timer state intentionally stays uncached (Realtime-only) so stale machine occupancy is never shown.
