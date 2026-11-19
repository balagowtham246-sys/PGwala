# `pgwala` Feature Inventory & Pre-Refactor Baseline Contract

This document records every implemented route, role guard, backend dependency (Supabase tables, RPCs, Edge Functions, Storage buckets, Realtime channels), and core user flow **prior to refactoring**. No refactoring may alter or remove any documented behavior below.

---

## 1. Global Architecture & Guards

- **Root Layout** ([src/app/_layout.tsx](file:///c:/Users/balag/pgwala/src/app/_layout.tsx)):
  - Wraps app in `Sentry.wrap`, `ThemeProvider`, `UpdateGuard` (`expo-updates` OTA check), `AuthProvider`, and `PropertyProvider`.
  - Enforces role-based redirects via `evaluateNavigationRedirect` ([src/lib/navigation-guards.ts](file:///c:/Users/balag/pgwala/src/lib/navigation-guards.ts)).
  - Registers device push tokens (`registerForPushNotifications`, `subscribeToPushTokenChanges`) for `student` and `warden` roles only.
- **Navigation Roles**:
  - `owner` -> `/owner-tabs` (5-tab `SwipeableTabsShell`: `maintenance`, `menu`, `home`, `gate`, `bill`)
  - `student` -> `/resident-tabs` (5-tab `SwipeableTabsShell`: `maintenance`, `menu`, `home`, `gate`, `bill`)
  - `warden` -> `/warden-dashboard` (plus `warden-settings`, `student-profile-edit`)
  - Unauthenticated -> `/login`

---

## 2. Authentication & Shared Routes

| Route | Role(s) | Backend Dependencies | Critical Flows Preserved |
|---|---|---|---|
| `login` ([login.tsx](file:///c:/Users/balag/pgwala/src/app/login.tsx)) | Public / Unauthenticated | `supabase.auth.signInWithPassword`, table `profiles`, `biometric-auth.ts` (`SecureStore` + `LocalAuthentication`) | Email/password sign-in, OS-neutral biometric unlock, forced password change prompt when `must_change_password` is true |
| `receipt-detail` ([receipt-detail.tsx](file:///c:/Users/balag/pgwala/src/app/receipt-detail.tsx)) | `owner`, `student` | Table `payments`, RPC `reverse_payment` | Receipt summary view; owner-only payment reversal with confirmation |

---

## 3. Owner Portal Routes

| Route | Role Guard | Supabase Tables / Storage | RPCs / Edge Functions / Realtime | Critical Flows Preserved |
|---|---|---|---|---|
| `owner-tabs` ([owner-tabs.tsx](file:///c:/Users/balag/pgwala/src/app/owner-tabs.tsx)) | `owner` | — | — | 5-page `SwipeableTabsShell` hosting `owner-complaints`, `food-menu`, `(tabs)/index`, `student-in-out`, `billing-management` |
| `(tabs)/index` ([index.tsx](file:///c:/Users/balag/pgwala/src/app/(tabs)/index.tsx)) | `owner` (redirects to `owner-tabs`) | `charges`, `student_payment_reports`, `residents`, `movement_logs`, `food_menus`, `complaints`, `washing_machines` | RPCs: `get_owner_dashboard_summary`, `release_washing_machine_unit`; Realtime channels: 2 | Property metrics, pending payments/complaints overview, quick navigation tiles, washing machine unit monitoring & owner release |
| `billing-management` ([billing-management.tsx](file:///c:/Users/balag/pgwala/src/app/billing-management.tsx)) | `owner` | `properties`, `residents`, `resident_opt_ins`, `washing_machine_requests`, `charges`, `student_payment_reports`, `payment_allocations` | RPCs: `generate_monthly_bills`, `update_resident_rent`, `allocate_eb_bill`, `toggle_resident_wm_billing`, `confirm_monthly_payment`, `reject_student_payment_report` | Monthly rent generation, per-resident rent edit, EB bill allocation, washing machine billing toggle, payment proof review (confirm/reject), strictly online financial mutations |
| `food-menu` ([food-menu.tsx](file:///c:/Users/balag/pgwala/src/app/food-menu.tsx)) | `owner` | `properties`, `food_menus` | — | Weekly breakfast/lunch/dinner menu editing & publishing per property |
| `student-in-out` ([student-in-out.tsx](file:///c:/Users/balag/pgwala/src/app/student-in-out.tsx)) | `owner` | `properties`, `residents`, `movement_logs` | — | Property-wide resident gate movement log viewer with fallback query on `resident_id` |
| `owner-complaints` ([owner-complaints.tsx](file:///c:/Users/balag/pgwala/src/app/owner-complaints.tsx)) | `owner` | `properties`, `complaints` | — | View, filter, and update status of resident maintenance complaints |
| `add-resident` ([add-resident.tsx](file:///c:/Users/balag/pgwala/src/app/add-resident.tsx)) | `owner` | `properties` | Edge Function: `create-resident` | Multi-step resident onboarding (creates auth user + resident record via `create-resident` with session refresh & 409/400/404 handling) |
| `edit-resident` ([edit-resident.tsx](file:///c:/Users/balag/pgwala/src/app/edit-resident.tsx)) | `owner` | `residents` | RPCs: `link_resident_profile`, `unlink_resident_profile` | Edit resident room/active state and link/unlink profile account |
| `owner-properties` ([owner-properties.tsx](file:///c:/Users/balag/pgwala/src/app/owner-properties.tsx)) | `owner` | `properties` (via `PropertyContext`) | — | Multi-PG switcher, add new PG property, edit property name/address |
| `owner-wardens` ([owner-wardens.tsx](file:///c:/Users/balag/pgwala/src/app/owner-wardens.tsx)) | `owner` | — | Edge Function: `manage-warden` | Assign, inspect, or remove property warden via `invokeEdgeFunction('manage-warden', ...)` |
| `owner-notifications` ([owner-notifications.tsx](file:///c:/Users/balag/pgwala/src/app/owner-notifications.tsx)) | `owner` | Local `AsyncStorage` (`@pgwala_owner_notif_prefs`) | — | Non-college exit alert preferences, evening-only & rate-limit toggles |
| `owner-settings` ([owner-settings.tsx](file:///c:/Users/balag/pgwala/src/app/owner-settings.tsx)) | `owner` | `washing_machines` | RPC: `set_property_wm_count` | Washing machine count config, biometric settings, sign-out |
| `owner-profile-edit` ([owner-profile-edit.tsx](file:///c:/Users/balag/pgwala/src/app/owner-profile-edit.tsx)) | `owner` | `profiles` | — | Update owner profile name/phone |

---

## 4. Resident (`student`) Portal Routes

| Route | Role Guard | Supabase Tables / Storage | RPCs / Edge Functions / Realtime | Critical Flows Preserved |
|---|---|---|---|---|
| `resident-tabs` ([resident-tabs.tsx](file:///c:/Users/balag/pgwala/src/app/resident-tabs.tsx)) | `student` | — | — | 5-page `SwipeableTabsShell` hosting `student-complaints`, `student-menu`, `student-dashboard`, `student-gate-history`, `student-billing` |
| `student-dashboard` ([student-dashboard.tsx](file:///c:/Users/balag/pgwala/src/app/student-dashboard.tsx)) | `student` | `residents`, `charges`, `food_menus`, `movement_logs`, `property_chat_messages` | RPCs: `get_student_dashboard_summary`, `record_student_movement` | Resident overview, dues summary, today's menu preview, gate IN/OUT status toggle (`record_student_movement`), unread chat badge, embedded `WashingMachineCard` |
| `student-billing` ([student-billing.tsx](file:///c:/Users/balag/pgwala/src/app/student-billing.tsx)) | `student` | `residents`, `charges`, `student_payment_reports`, `payment_allocations`; Storage bucket: `payment-proofs` | RPC: `submit_student_payment_proof` | View open/paid charges, payment allocation breakdown, upload payment screenshot + submit payment report (strictly online) |
| `student-complaints` ([student-complaints.tsx](file:///c:/Users/balag/pgwala/src/app/student-complaints.tsx)) | `student` | `residents`, `complaints`; Storage bucket: `complaint-photos` | — | List active/resolved complaints; submit new complaint with optional photo upload (text-only complaints eligible for offline queue on network failure) |
| `student-menu` ([student-menu.tsx](file:///c:/Users/balag/pgwala/src/app/student-menu.tsx)) | `student` | `residents`, `food_menus` | — | Weekly/daily hostel food menu view |
| `student-food-updates` ([student-food-updates.tsx](file:///c:/Users/balag/pgwala/src/app/student-food-updates.tsx)) | `student` | `food_alerts`, `residents` (`meal_opt_in`) | RPC: `set_my_meal_opt_in` | View warden/owner food announcements + toggle daily `meal_opt_in` (eligible for offline queue on network failure) |
| `student-gate-history` ([student-gate-history.tsx](file:///c:/Users/balag/pgwala/src/app/student-gate-history.tsx)) | `student` | `residents`, `movement_logs` | RPC: `record_student_movement` | View personal gate IN/OUT timeline and record movement |
| `student-chat` ([student-chat.tsx](file:///c:/Users/balag/pgwala/src/app/student-chat.tsx)) | `student` | `residents`, `property_chat_messages` | Realtime channels: 2 | Property community chat with realtime updates |
| `student-accommodation` ([student-accommodation.tsx](file:///c:/Users/balag/pgwala/src/app/student-accommodation.tsx)) | `student` | `residents`, `profiles` | — | View room/bed/property accommodation details |
| `student-settings` ([student-settings.tsx](file:///c:/Users/balag/pgwala/src/app/student-settings.tsx)) | `student` | `residents` | — | Biometric settings, accommodation link, food updates link, sign-out |
| `student-profile-edit` ([student-profile-edit.tsx](file:///c:/Users/balag/pgwala/src/app/student-profile-edit.tsx)) | `student`, `warden` | `profiles` | — | Update user name/phone |

---

## 5. Warden Portal Routes

| Route | Role Guard | Supabase Tables / Storage | RPCs / Edge Functions / Realtime | Critical Flows Preserved |
|---|---|---|---|---|
| `warden-dashboard` ([warden-dashboard.tsx](file:///c:/Users/balag/pgwala/src/app/warden-dashboard.tsx)) | `warden` | `property_wardens`, `food_alerts` | RPC: `get_alert_audience`; Edge Function: `send-food-alert` | Send targeted food announcements (all, rooms, specific residents) with idempotency key |
| `warden-settings` ([warden-settings.tsx](file:///c:/Users/balag/pgwala/src/app/warden-settings.tsx)) | `warden` | `property_wardens` | — | Warden profile, biometric settings, sign-out |

---

## 6. Shared Complex Components

| Component | Consumers | Backend Dependencies | Critical Flows Preserved |
|---|---|---|---|
| `WashingMachineCard` ([washing-machine-card.tsx](file:///c:/Users/balag/pgwala/src/components/washing-machine-card.tsx)) | `student-dashboard.tsx` | `resident_opt_ins` Realtime | RPCs: `get_or_create_wm_units` (fallback `get_or_create_wm_status`), `request_wm_access`, `start_washing_machine_unit` (fallback `start_washing_machine`), `release_washing_machine_unit` (fallback `release_washing_machine`); 4 Realtime subscriptions | Live machine unit timers, opt-in access request workflow, start/release machine cycle with legacy single-unit RPC fallback |

---

## 7. Explicitly Approved Offline Mutation Policy

Only the following **3 non-financial resident mutations** may be queued offline when network connectivity fails:
1. `gate_movement_log` (`record_student_movement` RPC)
2. `food_opt_in` (`set_my_meal_opt_in` RPC)
3. `complaint_submit` (`complaints` insert — text-only; complaints with attached local photos require live upload)

All financial, billing, resident onboarding, warden management, food menu, and washing machine mutations remain **strictly online**.

