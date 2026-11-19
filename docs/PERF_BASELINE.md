# Performance & Complexity Baseline (`Before` Refactoring)

Captured before modifying any of the 6 target monoliths.

---

## 1. Automated Verification Baseline

| Metric | Baseline Measurement |
|---|---|
| `npx tsc --noEmit` | **0 errors** (exit 0) |
| `npx expo lint` | **0 errors**, **89 warnings** |
| `npm test` | **12 suites passed / 12 total**, **92 tests passed**, **3.157 s** |
| Android Metro Bundle (`npx expo export --platform android`) | **9,806,323 bytes** (`9.8 MB` Hermes `.hbc`, 4,457 modules, 39,830 ms) |
| Web Static Export (`npx expo export --platform web`) | Failed pre-refactor on `owner-tabs` (`TypeError: (0 , t.codegenNativeCommands) is not a function` from `react-native-pager-view` SSR); Android `.hbc` used as bundle metric |

---

## 2. Target Monolith File Sizes & Supabase Round-Trips on Initial Mount

| File | Size (Bytes) | Lines | Initial Mount Query Pattern | Initial Round-Trips (Happy Path / Fallback) | Existing Cache |
|---|---:|---:|---|---|---|
| [billing-management.tsx](file:///c:/Users/balag/pgwala/src/app/billing-management.tsx) | 100,801 | 2,900 | Sequential: `properties` (optional) → `residents` → `resident_opt_ins` → `washing_machine_requests` → `charges` → `student_payment_reports` → `payment_allocations` | **6–7 sequential** | None |
| [index.tsx](file:///c:/Users/balag/pgwala/src/app/(tabs)/index.tsx) | 78,157 | 2,414 | Parallel fast path (`get_owner_dashboard_summary` + `charges` + `student_payment_reports`); fallback adds `residents` + 4 parallel + fallback `movement_logs` | **3 parallel (1 wave)** / **9 queries (3 waves)** fallback | Ad-hoc `AsyncStorage` (`owner_dash_cache_*`) |
| [food-menu.tsx](file:///c:/Users/balag/pgwala/src/app/food-menu.tsx) | 50,597 | 1,675 | `loadOwnerProperty` (`properties`) → `loadMenusForDate` (`food_menus`) | **1–2 sequential** | None |
| [washing-machine-card.tsx](file:///c:/Users/balag/pgwala/src/components/washing-machine-card.tsx) | 49,849 | 1,617 | `get_or_create_wm_units` (fallback `get_or_create_wm_status`) | **1–2** + 4 Realtime listeners | None |
| [student-dashboard.tsx](file:///c:/Users/balag/pgwala/src/app/student-dashboard.tsx) | 49,317 | 1,641 | `residents` → (`get_student_dashboard_summary` + `charges`) → `property_chat_messages` (+ fallback `food_menus` + `movement_logs`) | **5–6 across 3 waves** | Ad-hoc `AsyncStorage` (`student_dash_cache_*`) |
| [student-billing.tsx](file:///c:/Users/balag/pgwala/src/app/student-billing.tsx) | 48,791 | 1,535 | Sequential: `residents` → `charges` → `student_payment_reports` → `payment_allocations` | **4 sequential** | None |

---

## 3. Baseline Observations
1. `billing-management.tsx` and `student-billing.tsx` execute sequential query chains that can be parallelized inside `src/services/billing.service.ts` once `residents` / `charges` are resolved, reducing multi-wave network latency even on cold cache misses.
2. Only 2 of the 6 monoliths cache initial reads, using duplicate ad-hoc `AsyncStorage` JSON keys without TTLs, invalidation hooks, or timing instrumentation.
3. Cache read/write overhead (`AsyncStorage` JSON parse/stringify vs in-memory `Map`) is currently unmeasured and will be benchmarked in `src/lib/__tests__/perf-benchmark.test.ts` after Phase 1.

