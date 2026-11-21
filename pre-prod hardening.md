Batch 1 — Security & Database Integrity (Do First)

Promote supabase-ux-upgrade.sql into supabase/migrations/ & Deploy

Convert Sections 1–9 (rooms, announcements, set_my_emergency_contact, upi_id, wifi_*, curfew_time, meal_time, property_wardens resident RLS, column GRANT UPDATE) into a proper timestamped migration in supabase/migrations/ so supabase db push / CI tracks everything cleanly.
Verify with verify-rls.mjs.

Enforce Single Active Washing Machine Session in SQL RPC

Currently enforced in UI/client (washing-machine-card.tsx). Add an atomic server-side check inside start_washing_machine_unit (supabase/migrations/) rejecting concurrent starts if EXISTS (SELECT 1 FROM public.washing_machines WHERE current_resident_id = v_resident_id AND status = 'in_use') so two devices cannot race.

Expand PGlite & Live RLS Security Tests (pglite-ledger-rls.test.ts)

Add automated negative & positive RLS assertions for:
Residents can SELECT only all or their own room's announcements, and cannot INSERT/UPDATE/DELETE.
Residents can SELECT only their own property's active property_wardens row.
Residents cannot update properties.upi_id, wifi_password, curfew_time, or food_menus.meal_time.
set_my_emergency_contact updates only auth.uid()'s active residents row.

Build & Deploy supabase/functions/send-announcement

Right now supabase/functions/ only has create-resident, manage-warden, and send-food-alert.
Implement send-announcement Edge Function (matching send-food-alert auth/service-role/Expo Push pattern) so owner Push Announcements in owner-announcements.tsx deliver real remote push notifications instead of falling back locally.

Audit app.json Permissions & Native Config

Remove unused "android.permission.RECORD_AUDIO" (PGwala has no audio recording; unused sensitive permissions trigger Google Play rejections).
Add ios.bundleIdentifier ("com.pgwala.app"), verify expo-local-authentication FaceID usage string, and verify expo-notifications icon/channel config.
Batch 2 — Performance, Efficiency & Bundle Size

Create a Shared ResidentContext to Eliminate Redundant residents Queries

Currently student-dashboard, student-menu, student-announcements, student-accommodation, student-settings, student-gate-history, student-billing, and student-complaints each independently query residents + properties on mount/focus.
Introduce ResidentProvider (src/context/resident-context.tsx) hydrating { residentId, propertyId, propertyName, roomNumber, bedLabel, curfewTime, ownerPhone, ownerUpiId } once with SWR caching + focus refresh, cutting resident-side network round trips by ~50%.

Virtualize Long Lists (ScrollView + .map() → FlatList / SectionList)

Convert residents-directory.tsx, billing-management.tsx, owner-complaints.tsx, and student-gate-history.tsx to FlatList / SectionList with keyExtractor, initialNumToRender, and React.memo row components so 100+ resident properties scroll at 60 fps.

Debounce Realtime Refetches & Audit Channel Cleanup

In index.tsx, residents-directory.tsx, washing-machine-card.tsx, and student-chat.tsx, coalesce burst Postgres Realtime events (e.g., 300 ms debounce) and unsubscribe when screens lose focus or app backgrounds.

Bundle Size & Dependency Hygiene

Audit package.json for unused packages (e.g., check if @expo/ui, expo-glass-effect, expo-symbols, or template images/routes like explore.tsx / owner-tabs / resident-tabs duplicates are unused and can be pruned).
Run npx expo-doctor and npx expo export --platform android --dump-sourcemap (with source-map-explorer or bundle size inspection) + compress PNGs in assets/images/.
Batch 3 — Structure & Maintainability (Refactor Oversized Files)

Split 1,200+ Line Monolith Screens into Focused Subcomponents & Hooks

Current largest files in src/:
owner-complaints.tsx (1,861 lines)
billing-management.tsx (1,770 lines)
resident-profile.tsx (1,673 lines)
add-resident.tsx (1,665 lines)
index.tsx (1,652 lines)
edit-resident.tsx (1,526 lines)
student-complaints.tsx (1,278 lines)
student-in-out.tsx (1,252 lines)
Extract modals (Checkout modal, Record Payment modal, Log Complaint modal, Bulk Remind modal) and form sections into src/components/<feature>/ so route files stay under ~400–500 lines and styles aren't duplicated across screens.

Consolidate Repeated Modal / Input Styles & Date/Phone Formatters

Extract shared modal card, text input, and pill styles from owner-properties.tsx, add-resident.tsx, edit-resident.tsx, and student-accommodation.tsx into @/components/ui/owner.
Batch 4 — Consistency & Zero-Warning Code Quality

Drive ESLint Warnings from 43 to 0 (npx expo lint --max-warnings=0)

Clean up the remaining 43 pre-existing warnings in legacy files (owner-wardens.tsx, receipt-detail.tsx, student-chat.tsx, resident-tabs-context.tsx, and require() order warnings in older *.test.ts files).

Audit Error Handling & Offline Queue Coverage

Ensure every user-triggered mutation uses extractErrorMessage (never raw err instanceof Error which hides PostgREST objects).
Verify offline queue replay (src/services/offline-executors.ts) covers set_my_emergency_contact cleanly alongside food_opt_in, gate_movement_log, and complaint_submit.

Verify Android Hardware Back Button & Swipeable Tab Pager Edge Cases

Test BackHandler inside SwipeableTabsShell (owner-tabs and resident-tabs) and all modals (GoingOutModal, MachineBookingModal, PaymentProofModal, CalendarDatePickerModal) so pressing hardware Back closes the modal or returns to Home instead of exiting the app unexpectedly.
Batch 5 — Production Build & Release Readiness

Configure Sentry, EAS Updates & Release Profiles (app.json, eas.json)

Set EXPO_PUBLIC_SENTRY_DSN in EAS production environment secrets, configure runtimeVersion ({ "policy": "appVersion" }) + updates.url for eas update OTA patches, and verify expo-updates + UpdateGuard compatibility.

Device Smoke Test on a Real Development / Preview APK (eas build --profile preview --platform android)

Test native-only flows that cannot be verified in Expo Go or Web:
Remote & local push notifications (expo-notifications channel + permission flow + return-time reminder + WM queue alert)
upi://pay deep-link opening GPay / PhonePe / Paytm + screenshot upload
Camera & Gallery attachment on Complaints & Payment Proof
Biometric lock (expo-local-authentication)
Offline airplane-mode toggle + automatic queue flush on reconnect.