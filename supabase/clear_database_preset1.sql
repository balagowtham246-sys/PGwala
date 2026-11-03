-- ==============================================================================
-- PGwala Database Reset - Preset 1: Operational & Test Data Clearance
-- Target Database: cbhguuqxxwoazdffmejr (PGwala Production)
-- Description:
--   Clears all transactional test data (movement logs, food menus, complaints,
--   charges, payments, eb bills, washing machine states, resident directory,
--   and student profiles).
--   PRESERVES:
--     - Owner user account & profile (Shalom)
--     - PG Properties (Shalom Residency, Shalom girls pg)
--     - Database schema, tables, indexes, triggers, and RLS policies
-- ==============================================================================

BEGIN;

-- 1. Allocation & Verification child tables
DELETE FROM public.payment_allocations;
DELETE FROM public.student_payment_reports;
DELETE FROM public.payments;
DELETE FROM public.eb_allocations;
DELETE FROM public.eb_room_bills;

-- 2. Billing & Opt-in records
DELETE FROM public.charges;
DELETE FROM public.resident_opt_ins;

-- 3. Operational records: Complaints, Gate Logs, Food Menus
DELETE FROM public.complaints;
DELETE FROM public.movement_logs;
DELETE FROM public.food_menus;

-- 4. Live Machine States
DELETE FROM public.washing_machine_status;

-- 5. Resident directory
DELETE FROM public.residents;

-- 6. Student test profiles (Preserves Owner profile)
DELETE FROM public.profiles WHERE role = 'student';

COMMIT;

