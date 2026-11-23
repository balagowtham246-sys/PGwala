# Production & SaaS Readiness Checklist for Vibe-Coded Apps

Use this checklist before pitching, launching, or shipping any vibe-coded app to real customers.

## 1. Security & Multi-Tenant Isolation
- [ ] **Row-Level Security (RLS)** enabled on every table — never rely on client-side filtering (`property_id`, `org_id`, `user_id`) alone.
- [ ] **No secrets in client code** — `service_role` keys, third-party API keys, and admin actions live strictly in Edge Functions / backend.
- [ ] **Server-side role & ownership checks** inside every RPC and Edge Function (never trust client-sent role or recipient lists).
- [ ] **Revoke `anon` / `PUBLIC` access** on private tables, RPCs, and storage buckets; use short-lived signed URLs for private files.
- [ ] **Revoke stale access** — when a user is deactivated or removed, invalidate their push tokens and block active-user policies immediately.

## 2. Data Integrity & Concurrency
- [ ] **Idempotency keys** on payments, notifications, and form submissions so double-taps or retries never duplicate records or pushes.
- [ ] **Database constraints & unique indexes** for invariants (e.g., no duplicate phone/email, no double-booked slots, no negative amounts).
- [ ] **Payload parity** — verify backend/Edge Functions actually save *every* field the UI form collects (common AI bug: silently dropped fields).
- [ ] **Server-side auto-expiry / cleanup** — timers, locks, and rejected/orphaned storage uploads are cleaned up server-side, not only in client state.
- [ ] **Atomic transactions (RPCs)** for multi-table writes (e.g., creating a payment + settling a bill + generating a receipt).

## 3. Performance & Mobile/Web Responsiveness
- [ ] **No queries inside list items** — fetch at the screen level and pass props down.
- [ ] **Virtualized lists** (`FlatList` / `FlashList` / virtualized tables) instead of `ScrollView` + `.map()` for dynamic data.
- [ ] **Explicit column selects** (no `SELECT *`) and collapse multi-query waterfalls into single composite RPCs where hot.
- [ ] **No render/focus loops** — stabilize `useEffect` / `useFocusEffect` / `useCallback` dependencies and memoize context providers.
- [ ] **Non-blocking mutations** — use optimistic updates or background cache invalidation so buttons/modals feel instant.

## 4. Real-World UX & Edge Cases
- [ ] **No hardcoded demo/founder branding** (remove test names, dummy emails, placeholder copy).
- [ ] **Distinguish empty vs. completed states** (e.g., *"Bill not generated yet"* vs. *"All dues settled"*).
- [ ] **Remove fake/unwired UI controls** — never leave dead toggles, placeholder tabs, or half-built buttons visible to users.
- [ ] **Match UI to real user literacy** — simplify staff/operator screens to 1–2 tap flows.
- [ ] **Offline & slow-network resilience** — clear error states with Retry, image compression before upload, and queuing/graceful fallback for critical actions.

## 5. SaaS & Operations Readiness
- [ ] **Fast onboarding** — bulk import (CSV) or 2-minute setup so a new customer doesn't abandon on Day 1.
- [ ] **Data export** — 1-tap share/CSV export so customers trust they own their data.
- [ ] **Automated verification gate** — typecheck (`tsc`), linter, and unit/RLS tests pass before every release.
- [ ] **Crash & error monitoring** (e.g., Sentry) + force-update/version guard for mobile apps.
- [ ] **Zero-cost / free-tier hygiene** — compress uploads, delete rejected/orphan files, and avoid paid APIs when native deep links (e.g., WhatsApp / UPI / Share sheet) work for free.
