# PGwala Pilot Handover & Operations Guide

## 1. Database Backup & Stability Plan

### Manual Backups (`pg_dump`)
Before any major schema change or pilot milestone, take a manual logical backup using the Supabase direct Postgres connection string (do **not** commit credentials or dump files to Git):

```bash
pg_dump --dbname="postgresql://postgres:<PASSWORD>@db.<PROJECT_REF>.supabase.co:5432/postgres" \
  --no-owner --no-privileges --format=custom --file="pgwala_backup_$(date +%Y%m%d).dump"
```

For production pilots with 60+ residents, upgrade to **Supabase Pro** for automated daily backups and Point-in-Time Recovery (PITR).

> **Important:** Never add keepalive pings, cron jobs, or automated activity scripts against Supabase or Google services.

### Ordered Migration History
Canonical ordered migrations matching the live database are stored in `supabase/migrations/` (`20260101000001_pgwala_schema.sql` through `20260101000020_phase1_7_sync_profile_phone_to_residents.sql`). Always review SQL before running it in the Supabase SQL Editor.

---

## 2. APK Updates via `app_versions`

`public.app_versions` has read-only (`SELECT`) RLS for `anon` and `authenticated`. All inserts/updates are restricted to `service_role` / Supabase SQL Editor.

To publish a new Android APK release:
1. Build the preview/production APK with EAS:
   ```bash
   npx eas-cli@latest build --platform android --profile preview
   ```
2. Host the `.apk` artifact (e.g., EAS build URL or GitHub Release).
3. Update `public.app_versions` in the Supabase SQL Editor with the new `latest_version` / `min_supported_version` and `download_url`.

---

## 3. 2-Account Real-Device QA Checklist

Test with **two separate accounts** on physical Android devices (or 1 device + 1 emulator):
- **Account A:** PG Owner
- **Account B:** Resident (Student) assigned to Owner's PG

### Owner Flow
- [ ] **Home (`/(tabs)`):** Switch PG property via top header pill; confirm 4 KPI cards (`Students Inside`, `Outside`, `Rent Collections`, `Open Maintenance`) update consistently.
- [ ] **Realtime Alert:** Have Student mark `Going Out` with a non-college purpose (`Market` / `Other`); verify non-college departure alert banner appears on Owner Home.
- [ ] **Bottom Nav:** Tap all 5 tabs (`Maintenance`, `Menu`, `Home`, `Gate`, `Bill`) and verify light haptic feedback and instant navigation.
- [ ] **Menu (`/food-menu`):** Publish today's breakfast/lunch/dinner menu.
- [ ] **Bill (`/billing-management`):** Inspect pending payment proof image and approve/reject.
- [ ] **Notifications (`/owner-notifications`):** Verify only wired alert settings (`nonCollegeAlerts`, `eveningOnly`, `rateLimitEnabled`) are shown.

### Student Flow
- [ ] **Home (`/student-dashboard`):** Verify greeting, room badge, washing machine card, gate tracker, dues card, and today's mess menu.
- [ ] **Gate (`/student-dashboard` & `/student-gate-history`):** Mark `Going Out` (with dinner toggle) and `Mark Inside`; verify history updates.
- [ ] **Menu (`/student-menu`):** Confirm published meals appear read-only.
- [ ] **Bill (`/student-billing`):** Upload a payment proof screenshot and verify signed URL preview.
- [ ] **Maintenance (`/student-complaints`):** Submit a complaint with photo and confirm Owner sees it in `/owner-complaints`.
- [ ] **Profile (`/student-profile-edit`):** Update phone number and verify it syncs to `residents.phone_number` via the DB trigger.
- [ ] **Accessibility:** Enable Android "Remove animations" (reduced motion) and confirm smooth UI without jarring motion.
