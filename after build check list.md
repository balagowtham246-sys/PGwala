# After-Build Checklist: Rate Limiting & Post-Build Hardening

## 1. Server-Side Rate Limiting (No App Rebuild Required)
- **Supabase Auth:** Configure sign-in, signup, and OTP/email rate limits in **Supabase Dashboard → Authentication → Rate Limits**.
- **Postgres RPCs:** Add lightweight cooldown checks inside high-impact RPCs (e.g., payment proof submission, complaint creation, gate movement) to reject repeated calls from the same `auth.uid()` / `resident_id` within *N* seconds.
- **Edge Functions:** Enforce per-user (`auth.uid()`) or per-IP rate limiting (e.g., Upstash Redis or a Postgres token-bucket table) and return `429 Too Many Requests` with a `Retry-After` header.
- **Storage Buckets:** Keep `file_size_limit` and `allowed_mime_types` enforced on `payment-proofs` and `complaint-photos` buckets.

## 2. Client-Side Request Control (Shippable via `eas update`)
- **Deduplication & Caching:** TanStack Query (`staleTime: 30_000` in `src/lib/query-client.ts`) prevents repeated fetches on rapid navigation.
- **Skip Retries on `429`:** In `QueryClient` `defaultOptions.queries.retry`, skip retrying when the error status is `429` so the client backs off instead of amplifying rate-limit errors.
- **Double-Tap & Debounce Guards:** Keep `mutation.isPending` + ref guards on submit buttons, and debounce search/filter inputs that trigger network queries.

## 3. Graceful `429` UX
- Map HTTP `429` / Supabase rate-limit errors in the error normalizer to a clear user-facing message (e.g., *"Too many requests. Please wait a moment and try again."*) rather than a generic failure.

---

## 4. Caching (Implemented)
- **TanStack Query (Active on Billing & Complaints):** Configured in `src/lib/query-client.ts` (`staleTime: 30_000`, `gcTime: 15 * 60_000`, `refetchOnWindowFocus: true`, `refetchOnReconnect: true`) and mounted in `src/app/_layout.tsx` with keys in `src/lib/query-keys.ts`.
- **Legacy `AsyncStorage` SWR (`src/lib/query-cache.ts`):** Still used by unmigrated screens/services (dashboards, residents, food menus) until migrated to TanStack Query.

## 5. Load Balancing (Managed by Supabase)
- **No custom load balancer needed in repo:** Supabase manages API/Edge load balancing and Postgres connection pooling (**Supavisor**).
- **App-side load reduction:** TanStack Query caching, single-roundtrip RPCs (`get_owner_billing_summary`, `get_student_billing_summary`), composite indexes, and RLS `InitPlan` optimizations minimize server load.
- **Future scaling:** Enable **Supabase Read Replicas** on higher tiers if read traffic outgrows a single Postgres instance.

## 6. Reverse Proxy (Optional Post-Build Addition)
- **Current setup:** App connects directly to `EXPO_PUBLIC_SUPABASE_URL` (`src/lib/supabase.ts`); Supabase's API gateway acts as the reverse proxy.
- **When to add (e.g., Cloudflare Workers / Nginx):** For a custom domain (`api.pgwala.com`), ISP/network reliability, edge WAF/rate limiting, or edge caching.
- **How to enable without code refactor:** Forward `/rest/v1/*`, `/auth/v1/*`, `/storage/v1/*`, and `/functions/v1/*` to the Supabase project URL (preserving `Authorization`, `apikey`, and `Content-Type` headers) and update `EXPO_PUBLIC_SUPABASE_URL` in EAS/env config.
