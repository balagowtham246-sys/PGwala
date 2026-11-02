// Genuine PostgreSQL Integration Test Suite for PGwala
// Uses @electric-sql/pglite to run the official PostgreSQL 16/18 engine in WebAssembly.

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { PGlite } = require('./pgtest/node_modules/@electric-sql/pglite');

async function runPgIntegrationTests() {
  console.log('===============================================================');
  console.log('   PGWALA GENUINE POSTGRESQL INTEGRATION TEST SUITE            ');
  console.log('===============================================================');

  const db = new PGlite();

  // Print engine version
  const verRes = await db.query('SELECT version();');
  console.log(`[Engine] ${verRes.rows[0].version}\n`);

  // --------------------------------------------------------------------------
  // STEP 1: Set up Supabase Auth mock environment & Core Schema
  // --------------------------------------------------------------------------
  console.log('[Step 1] Bootstrapping Auth Schema & Core PGwala Infrastructure...');
  await db.exec(`
    CREATE SCHEMA IF NOT EXISTS auth;
    DO $$ BEGIN
        CREATE ROLE anon;
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN
        CREATE ROLE authenticated;
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;

    GRANT USAGE ON SCHEMA public TO anon, authenticated;

    CREATE TABLE IF NOT EXISTS auth.users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email TEXT UNIQUE,
        created_at TIMESTAMPTZ DEFAULT now()
    );

    -- Mock auth.uid() that reads from session variable
    CREATE OR REPLACE FUNCTION auth.uid()
    RETURNS UUID
    LANGUAGE sql
    STABLE
    AS $$
        SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::UUID;
    $$;

    DO $$ BEGIN
        CREATE TYPE public.user_role AS ENUM ('owner', 'student');
    EXCEPTION
        WHEN duplicate_object THEN NULL;
    END $$;

    -- Profiles
    CREATE TABLE IF NOT EXISTS public.profiles (
        id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
        full_name TEXT NOT NULL,
        phone_number TEXT,
        role public.user_role NOT NULL DEFAULT 'student',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Properties
    CREATE TABLE IF NOT EXISTS public.properties (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        address TEXT,
        owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Residents
    CREATE TABLE IF NOT EXISTS public.residents (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE RESTRICT,
        profile_id UUID UNIQUE REFERENCES public.profiles(id) ON DELETE SET NULL,
        full_name TEXT NOT NULL,
        phone_number TEXT,
        room_number TEXT NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    GRANT SELECT ON TABLE public.profiles TO authenticated;
    GRANT SELECT ON TABLE public.properties TO authenticated;
    GRANT SELECT ON TABLE public.residents TO authenticated;

    -- Mock storage tables (pre-managed in live Supabase)
    CREATE SCHEMA IF NOT EXISTS storage;
    CREATE TABLE IF NOT EXISTS storage.buckets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        public BOOLEAN DEFAULT false
    );
    CREATE TABLE IF NOT EXISTS storage.objects (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        bucket_id TEXT REFERENCES storage.buckets(id),
        name TEXT,
        owner UUID,
        created_at TIMESTAMPTZ DEFAULT now()
    );

    -- Helpers
    CREATE OR REPLACE FUNCTION public.set_updated_at()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    SET search_path = ''
    AS $$
    BEGIN
        NEW.updated_at = now();
        RETURN NEW;
    END;
    $$;

    CREATE OR REPLACE FUNCTION public.is_owner()
    RETURNS BOOLEAN
    LANGUAGE sql
    SECURITY DEFINER
    SET search_path = ''
    STABLE
    AS $$
        SELECT EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = (SELECT auth.uid()) AND role = 'owner'
        );
    $$;

    CREATE OR REPLACE FUNCTION public.get_my_property_ids()
    RETURNS SETOF UUID
    LANGUAGE sql
    SECURITY DEFINER
    SET search_path = ''
    STABLE
    AS $$
        SELECT id FROM public.properties
        WHERE owner_id = (SELECT auth.uid());
    $$;
  `);
  console.log('  ✓ Core auth, profiles, properties, and residents initialized.');

  // --------------------------------------------------------------------------
  // STEP 2: Simulate Existing Legacy Billing Schema (to test migration compatibility)
  // --------------------------------------------------------------------------
  console.log('\n[Step 2] Simulating Pre-existing / Legacy Billing Schema...');
  await db.exec(`
    -- Create enums
    DO $$ BEGIN
        CREATE TYPE public.charge_category AS ENUM ('rent', 'electricity', 'washing_machine', 'opening_balance');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;

    DO $$ BEGIN
        CREATE TYPE public.charge_status AS ENUM ('outstanding', 'settled', 'cancelled');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;

    DO $$ BEGIN
        CREATE TYPE public.billing_payment_method AS ENUM ('cash', 'upi');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;

    DO $$ BEGIN
        CREATE TYPE public.billing_payment_status AS ENUM ('approved', 'reversed');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;

    DO $$ BEGIN
        CREATE TYPE public.student_report_status AS ENUM ('pending', 'approved', 'rejected');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;

    -- Legacy charges table
    CREATE TABLE IF NOT EXISTS public.charges (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE RESTRICT,
        resident_id UUID NOT NULL REFERENCES public.residents(id) ON DELETE RESTRICT,
        category public.charge_category NOT NULL,
        description TEXT NOT NULL,
        billing_period_start DATE NOT NULL,
        billing_period_end DATE NOT NULL,
        due_date DATE NOT NULL,
        amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
        status public.charge_status NOT NULL DEFAULT 'outstanding',
        is_opening_balance BOOLEAN NOT NULL DEFAULT false,
        reference_note TEXT,
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Legacy payments table
    CREATE TABLE IF NOT EXISTS public.payments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE RESTRICT,
        resident_id UUID NOT NULL REFERENCES public.residents(id) ON DELETE RESTRICT,
        receipt_number TEXT NOT NULL UNIQUE,
        amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
        unallocated_amount_paise BIGINT NOT NULL DEFAULT 0 CHECK (unallocated_amount_paise >= 0),
        method public.billing_payment_method NOT NULL,
        payment_date DATE NOT NULL,
        status public.billing_payment_status NOT NULL DEFAULT 'approved',
        notes TEXT,
        student_report_id UUID,
        recorded_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
        reversal_reason TEXT,
        reversed_at TIMESTAMPTZ,
        reversed_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Legacy payment_allocations with the old broken table-wide UNIQUE (charge_id) constraint
    -- and WITHOUT the status column!
    CREATE TABLE IF NOT EXISTS public.payment_allocations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        payment_id UUID NOT NULL REFERENCES public.payments(id) ON DELETE RESTRICT,
        charge_id UUID NOT NULL REFERENCES public.charges(id) ON DELETE RESTRICT,
        settled_amount_paise BIGINT NOT NULL CHECK (settled_amount_paise > 0),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT uq_payment_allocation_charge UNIQUE (charge_id)
    );

    -- Legacy student_payment_reports WITHOUT has_corrections or correction_details
    CREATE TABLE IF NOT EXISTS public.student_payment_reports (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE RESTRICT,
        resident_id UUID NOT NULL REFERENCES public.residents(id) ON DELETE RESTRICT,
        amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
        claimed_method public.billing_payment_method NOT NULL,
        payment_date DATE NOT NULL,
        reference_number TEXT,
        notes TEXT,
        status public.student_report_status NOT NULL DEFAULT 'pending',
        rejection_reason TEXT,
        approved_payment_id UUID REFERENCES public.payments(id) ON DELETE SET NULL,
        reviewed_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
        reviewed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  console.log('  ✓ Legacy schema created with legacy table-wide constraint uq_payment_allocation_charge.');

  // --------------------------------------------------------------------------
  // STEP 3: Apply Billing, Account Linking & Security Hardening Migrations
  // --------------------------------------------------------------------------
  console.log('\n[Step 3] Applying migrations to existing schema...');
  const migrationSqlPath = path.resolve(__dirname, '../supabase/billing_and_payments_migration.sql');
  const migrationSql = fs.readFileSync(migrationSqlPath, 'utf8');

  const linkMigrationPath = path.resolve(__dirname, '../supabase/link_resident_migration.sql');
  const linkMigrationSql = fs.readFileSync(linkMigrationPath, 'utf8');

  const hardeningMigrationPath = path.resolve(__dirname, '../supabase/billing_security_hardening.sql');
  const hardeningMigrationSql = fs.readFileSync(hardeningMigrationPath, 'utf8');

  const complaintsMigrationPath = path.resolve(__dirname, '../supabase/complaints_migration.sql');
  const complaintsMigrationSql = fs.readFileSync(complaintsMigrationPath, 'utf8');

  const wmStatusMigrationPath = path.resolve(__dirname, '../supabase/washing_machine_status_migration.sql');
  const wmStatusMigrationSql = fs.readFileSync(wmStatusMigrationPath, 'utf8');

  const onboardingMigrationPath = path.resolve(__dirname, '../supabase/unified_resident_onboarding_migration.sql');
  const onboardingMigrationSql = fs.readFileSync(onboardingMigrationPath, 'utf8');

  const movementMigrationPath = path.resolve(__dirname, '../supabase/student_movement_attendance_migration.sql');
  const movementMigrationSql = fs.readFileSync(movementMigrationPath, 'utf8');

  const simplifiedBillingPath = path.resolve(__dirname, '../supabase/simplified_monthly_billing_migration.sql');
  const simplifiedBillingSql = fs.readFileSync(simplifiedBillingPath, 'utf8');

  try {
    await db.exec(migrationSql);
    console.log('  ✓ billing_and_payments_migration.sql executed successfully.');

    await db.exec(linkMigrationSql);
    console.log('  ✓ link_resident_migration.sql executed successfully.');

    await db.exec(hardeningMigrationSql);
    console.log('  ✓ billing_security_hardening.sql executed successfully.');

    await db.exec(complaintsMigrationSql);
    console.log('  ✓ complaints_migration.sql executed successfully.');

    await db.exec(wmStatusMigrationSql);
    console.log('  ✓ washing_machine_status_migration.sql executed successfully.');

    await db.exec(onboardingMigrationSql);
    console.log('  ✓ unified_resident_onboarding_migration.sql executed successfully.');

    await db.exec(movementMigrationSql);
    console.log('  ✓ student_movement_attendance_migration.sql executed successfully.');

    await db.exec(simplifiedBillingSql);
    console.log('  ✓ simplified_monthly_billing_migration.sql executed successfully.');
  } catch (err) {
    console.error('  ✗ Migration failed:', err);
    throw err;
  }

  // Verify that legacy constraint was dropped and new status column added
  const colCheck = await db.query(`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'payment_allocations' AND column_name = 'status';
  `);
  assert.strictEqual(colCheck.rows.length, 1, 'Column status must exist in payment_allocations');
  console.log('  ✓ Verified: payment_allocations.status column upgraded successfully.');

  const reportColCheck = await db.query(`
    SELECT column_name 
    FROM information_schema.columns 
    WHERE table_name = 'student_payment_reports' AND column_name IN ('has_corrections', 'correction_details');
  `);
  assert.strictEqual(reportColCheck.rows.length, 2, 'Columns has_corrections and correction_details must exist');
  console.log('  ✓ Verified: student_payment_reports correction audit columns upgraded successfully.');

  // --------------------------------------------------------------------------
  // STEP 4: Seed Test Data (2 Owners, 2 Properties, 4 Residents)
  // --------------------------------------------------------------------------
  console.log('\n[Step 4] Seeding Test Domain Entities (Multi-tenant test environment)...');
  
  // Owner 1 & Property 1
  const owner1Id = '11111111-1111-1111-1111-111111111111';
  const owner2Id = '22222222-2222-2222-2222-222222222222';
  const prop1Id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const prop2Id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

  // Residents in Prop 1
  const res1Id = '00000001-0000-0000-0000-000000000001'; // Alice (Room 101)
  const res2Id = '00000002-0000-0000-0000-000000000002'; // Bob (Room 101)
  const res3Id = '00000003-0000-0000-0000-000000000003'; // Charlie (Room 101)
  // Resident in Prop 2
  const res4Id = '00000004-0000-0000-0000-000000000004'; // David (Room 201)

  // Students Auth
  const student1Auth = '33333333-3333-3333-3333-333333333333';
  const student2Auth = '44444444-4444-4444-4444-444444444444';

  await db.exec(`
    INSERT INTO auth.users (id, email) VALUES
      ('${owner1Id}', 'owner1@pgwala.test'),
      ('${owner2Id}', 'owner2@pgwala.test'),
      ('${student1Auth}', 'alice@student.test'),
      ('${student2Auth}', 'bob@student.test');

    INSERT INTO public.profiles (id, full_name, role) VALUES
      ('${owner1Id}', 'Owner One', 'owner'),
      ('${owner2Id}', 'Owner Two', 'owner'),
      ('${student1Auth}', 'Alice Student', 'student'),
      ('${student2Auth}', 'Bob Student', 'student');

    INSERT INTO public.properties (id, name, owner_id, is_active) VALUES
      ('${prop1Id}', 'Sunrise PG', '${owner1Id}', true),
      ('${prop2Id}', 'Sunset PG', '${owner2Id}', true);

    INSERT INTO public.residents (id, property_id, profile_id, full_name, room_number, is_active) VALUES
      ('${res1Id}', '${prop1Id}', '${student1Auth}', 'Alice Smith', '101', true),
      ('${res2Id}', '${prop1Id}', '${student2Auth}', 'Bob Jones', '101', true),
      ('${res3Id}', '${prop1Id}', NULL, 'Charlie Brown', '101', true),
      ('${res4Id}', '${prop2Id}', NULL, 'David Miller', '201', true);
  `);
  console.log('  ✓ Seeded 2 owners, 2 properties, and 4 residents.');

  // Helper to set auth context and role
  async function asUser(userId, role = 'postgres') {
    if (role === 'anon') {
      await db.exec(`
        SET ROLE anon;
        SET request.jwt.claim.sub = '';
      `);
    } else if (role === 'authenticated') {
      await db.exec(`
        SET ROLE authenticated;
        SET request.jwt.claim.sub = '${userId || ''}';
      `);
    } else {
      await db.exec(`
        RESET ROLE;
        SET request.jwt.claim.sub = '${userId || ''}';
      `);
    }
  }

  // --------------------------------------------------------------------------
  // TEST A: Monthly Charge Generation & Duplicate Prevention
  // --------------------------------------------------------------------------
  console.log('\n[Test A] Monthly Charge Generation & Duplicate Prevention:');
  await asUser(owner1Id);

  // Generate for 2026-11-01
  const genRes1 = await db.query(`
    SELECT public.generate_monthly_charges('${prop1Id}', '2026-11-01'::DATE, 900000) AS res;
  `);
  const genData1 = genRes1.rows[0].res;
  assert.strictEqual(genData1.success, true);
  assert.strictEqual(genData1.rent_charges_created, 3, 'Should create rent charges for 3 residents in Prop 1');
  console.log('  ✓ First run created 3 rent charges of ₹9,000 for active residents.');

  // Run again for same month: must be idempotent and create 0 duplicates!
  const genRes2 = await db.query(`
    SELECT public.generate_monthly_charges('${prop1Id}', '2026-11-01'::DATE, 900000) AS res;
  `);
  const genData2 = genRes2.rows[0].res;
  assert.strictEqual(genData2.success, true);
  assert.strictEqual(genData2.rent_charges_created, 0, 'Duplicate run must create 0 new charges');
  console.log('  ✓ Duplicate run for same month created 0 charges (Idempotent).');

  // Verify unique index on charges
  const chargeCount = await db.query(`
    SELECT COUNT(*) AS cnt FROM public.charges WHERE property_id = '${prop1Id}' AND category = 'rent';
  `);
  assert.strictEqual(parseInt(chargeCount.rows[0].cnt, 10), 3);
  console.log('  ✓ Invariant verified: Exactly 3 rent charges exist.');

  // --------------------------------------------------------------------------
  // TEST B: EB Deterministic Allocation, Min-Share & Stable Ordering
  // --------------------------------------------------------------------------
  console.log('\n[Test B] EB Deterministic Allocation Invariants:');

  // B1: Bill of ₹1,000 (100,000 paise) among 3 residents (Alice, Bob, Charlie)
  // Remainder = 1000 - (333 * 3) = 1 rupee.
  // Alphabetical sort: Alice, Bob, Charlie.
  // Alice gets ₹334 (33,400 paise), Bob gets ₹333, Charlie gets ₹333.
  const ebRes1 = await db.query(`
    SELECT public.allocate_eb_bill(
      '${prop1Id}',
      '101',
      '2026-10-01'::DATE,
      '2026-10-31'::DATE,
      '2026-11-05'::DATE,
      100000,
      ARRAY['${res2Id}', '${res3Id}', '${res1Id}']::UUID[], -- deliberately unsorted input array
      'October EB Bill'
    ) AS res;
  `);
  assert.strictEqual(ebRes1.rows[0].res.success, true);
  console.log('  ✓ EB bill allocated successfully.');

  // Verify deterministic distribution and exact sum
  const ebShares = await db.query(`
    SELECT ea.resident_name_snapshot, ea.allocated_amount_paise
    FROM public.eb_allocations ea
    ORDER BY ea.allocated_amount_paise DESC, ea.resident_name_snapshot ASC;
  `);
  assert.strictEqual(ebShares.rows.length, 3);
  assert.strictEqual(ebShares.rows[0].resident_name_snapshot, 'Alice Smith');
  assert.strictEqual(parseInt(ebShares.rows[0].allocated_amount_paise, 10), 33400); // ₹334
  assert.strictEqual(parseInt(ebShares.rows[1].allocated_amount_paise, 10), 33300); // ₹333
  assert.strictEqual(parseInt(ebShares.rows[2].allocated_amount_paise, 10), 33300); // ₹333

  const ebSum = ebShares.rows.reduce((sum, r) => sum + parseInt(r.allocated_amount_paise, 10), 0);
  assert.strictEqual(ebSum, 100000, 'Sum of shares must equal exactly 100,000 paise (₹1,000)');
  console.log('  ✓ Stable ordering verified: Alice Smith received +₹1 remainder. Total = ₹1,000.');

  // B2: Duplicate resident ID rejection
  const dupEbRes = await db.query(`
    SELECT public.allocate_eb_bill(
      '${prop1Id}', '101', '2026-11-01'::DATE, '2026-11-30'::DATE, '2026-12-05'::DATE,
      50000, ARRAY['${res1Id}', '${res1Id}']::UUID[], 'Test'
    ) AS res;
  `);
  assert.strictEqual(dupEbRes.rows[0].res.success, false);
  assert(dupEbRes.rows[0].res.error.includes('Duplicate resident IDs'));
  console.log('  ✓ Duplicate resident IDs in allocation array rejected.');

  // B3: Under-minimum share rejection (< ₹1 per person)
  const underMinEb = await db.query(`
    SELECT public.allocate_eb_bill(
      '${prop1Id}', '101', '2026-11-01'::DATE, '2026-11-30'::DATE, '2026-12-05'::DATE,
      200, ARRAY['${res1Id}', '${res2Id}', '${res3Id}']::UUID[], 'Test'
    ) AS res;
  `);
  assert.strictEqual(underMinEb.rows[0].res.success, false);
  assert(underMinEb.rows[0].res.error.includes('must be at least ₹3'));
  console.log('  ✓ Under-minimum bill (< ₹1/person) rejected.');

  // B4: Duplicate room bill for same period rejection
  const dupPeriodEb = await db.query(`
    SELECT public.allocate_eb_bill(
      '${prop1Id}', '101', '2026-10-01'::DATE, '2026-10-31'::DATE, '2026-11-05'::DATE,
      100000, ARRAY['${res1Id}', '${res2Id}', '${res3Id}']::UUID[], 'Test'
    ) AS res;
  `);
  assert.strictEqual(dupPeriodEb.rows[0].res.success, false);
  assert(dupPeriodEb.rows[0].res.error.includes('already been recorded'));
  console.log('  ✓ Duplicate EB bill for same room and period rejected.');

  // --------------------------------------------------------------------------
  // TEST C: Student Payment Report & Concurrency Approval / Correction Audit
  // --------------------------------------------------------------------------
  console.log('\n[Test C] Student Report Approval & Owner Correction Audit:');
  
  // Student submits report for ₹9,000 via UPI
  await asUser(student1Auth);
  const repRes = await db.query(`
    INSERT INTO public.student_payment_reports (
      property_id, resident_id, amount_paise, claimed_method, payment_date, reference_number, notes
    ) VALUES (
      '${prop1Id}', '${res1Id}', 900000, 'upi', '2026-10-25'::DATE, 'UPI12345678', 'Paid via GPay'
    ) RETURNING id;
  `);
  const reportId = repRes.rows[0].id;
  console.log('  ✓ Student submitted payment report.');

  // Owner 1 approves report, but corrects the amount to ₹8,500 cash
  await asUser(owner1Id);
  const approveRes = await db.query(`
    SELECT public.approve_payment_and_allocate(
      '${prop1Id}',
      '${res1Id}',
      850000, -- ₹8,500 (Owner corrected from ₹9,000)
      'cash',  -- Cash (Owner corrected from UPI)
      '2026-10-26'::DATE,
      'Resident gave cash; GPay had failed',
      '${reportId}'
    ) AS res;
  `);
  const approveData = approveRes.rows[0].res;
  assert.strictEqual(approveData.success, true);
  assert.strictEqual(approveData.has_corrections, true);
  const payment1Id = approveData.payment_id;
  console.log('  ✓ Payment approved with corrections logged.');

  // Verify student_payment_reports row audit trail
  const repAudit = await db.query(`
    SELECT status, has_corrections, correction_details, amount_paise, claimed_method
    FROM public.student_payment_reports WHERE id = '${reportId}';
  `);
  const repRow = repAudit.rows[0];
  assert.strictEqual(repRow.status, 'approved');
  assert.strictEqual(repRow.has_corrections, true);
  assert.strictEqual(parseInt(repRow.amount_paise, 10), 900000, 'Original student amount must be preserved');
  assert.strictEqual(repRow.claimed_method, 'upi', 'Original student method must be preserved');
  assert.strictEqual(repRow.correction_details.approved.amount_paise, 850000);
  console.log('  ✓ Preserved student original values and logged structured correction_details.');

  // Duplicate approval attempt on already approved report
  const dupApprove = await db.query(`
    SELECT public.approve_payment_and_allocate(
      '${prop1Id}', '${res1Id}', 850000, 'cash', '2026-10-26'::DATE, 'Duplicate', '${reportId}'
    ) AS res;
  `);
  assert.strictEqual(dupApprove.rows[0].res.success, false);
  assert(dupApprove.rows[0].res.error.includes('already been reviewed'));
  console.log('  ✓ Concurrency protection: Duplicate approval rejected.');

  // --------------------------------------------------------------------------
  // TEST D: Payment Mathematical Invariant & Partial Settlement Rule
  // --------------------------------------------------------------------------
  console.log('\n[Test D] Payment Mathematical Invariant & Strict Settlement:');
  // For Alice:
  // Alice had:
  // - Charge 1 (Rent): ₹9,000 (900,000 paise)
  // - Charge 2 (EB): ₹334 (33,400 paise)
  // Owner approved ₹8,500:
  // Oldest charge is ₹9,000. ₹8,500 < ₹9,000!
  // Per strict rule: NO partial settlement! Rent remains outstanding, EB remains outstanding.
  // The entire ₹8,500 becomes unallocated_amount_paise!
  const p1Check = await db.query(`
    SELECT amount_paise, unallocated_amount_paise FROM public.payments WHERE id = '${payment1Id}';
  `);
  const p1Row = p1Check.rows[0];
  assert.strictEqual(parseInt(p1Row.amount_paise, 10), 850000);
  assert.strictEqual(parseInt(p1Row.unallocated_amount_paise, 10), 850000);

  const allocCount1 = await db.query(`
    SELECT COUNT(*) AS cnt FROM public.payment_allocations WHERE payment_id = '${payment1Id}';
  `);
  assert.strictEqual(parseInt(allocCount1.rows[0].cnt, 10), 0);
  console.log('  ✓ Strict settlement rule verified: Charge of ₹9,000 not partially settled; ₹8,500 stored as unallocated credit.');

  // Invariant check: payment amount == sum(active allocations) + unallocated
  const inv1 = await db.query(`
    SELECT p.amount_paise, 
           COALESCE(SUM(pa.settled_amount_paise), 0) AS active_alloc,
           p.unallocated_amount_paise
    FROM public.payments p
    LEFT JOIN public.payment_allocations pa ON pa.payment_id = p.id AND pa.status = 'active'
    WHERE p.id = '${payment1Id}'
    GROUP BY p.id;
  `);
  const inv1Row = inv1.rows[0];
  assert.strictEqual(
    parseInt(inv1Row.amount_paise, 10),
    parseInt(inv1Row.active_alloc, 10) + parseInt(inv1Row.unallocated_amount_paise, 10),
    'Invariant: amount_paise == active_alloc + unallocated_amount_paise'
  );
  console.log('  ✓ Invariant holds: ₹8,500 = ₹0 active alloc + ₹8,500 unallocated credit.');

  // --------------------------------------------------------------------------
  // TEST E: Credit Application Workflow & FIFO Policy (Oldest-First EXIT)
  // --------------------------------------------------------------------------
  console.log('\n[Test E] Credit Application Workflow & Oldest-First EXIT Policy:');

  // Currently, Alice has ₹8,500 credit in Payment 1.
  // Oldest charge is Rent (₹9,000). Second charge is EB (₹334).
  // When apply_unallocated_credit is called:
  // Since ₹8,500 < ₹9,000, it cannot settle the oldest charge.
  // Strict FIFO chronological policy requires it to EXIT without skipping to newer charges!
  const creditRes1 = await db.query(`
    SELECT public.apply_unallocated_credit('${res1Id}') AS res;
  `);
  assert.strictEqual(creditRes1.rows[0].res.charges_settled_count, 0);
  console.log('  ✓ Strict FIFO verified: Credit did not skip the oldest unaffordable charge of ₹9,000.');

  // Now, owner records a second payment of ₹1,000 (100,000 paise) for Alice
  const pay2Res = await db.query(`
    SELECT public.approve_payment_and_allocate(
      '${prop1Id}', '${res1Id}', 100000, 'cash', '2026-10-27'::DATE, 'Second installment'
    ) AS res;
  `);
  const payment2Id = pay2Res.rows[0].res.payment_id;
  // This second payment of ₹1,000 alone is also < ₹9,000, so it stores ₹1,000 credit.
  // Total available credit across payments: ₹8,500 + ₹1,000 = ₹9,500!
  console.log('  ✓ Second payment of ₹1,000 recorded. Total resident credit = ₹9,500.');

  // Now apply unallocated credit across multiple payments:
  // Payment 1 has ₹8,500 (still < ₹9,000).
  // But wait! Can Payment 1 settle ₹9,000? Payment 1 only has ₹8,500.
  // What about Payment 2? It has ₹1,000.
  // Under our per-payment strict settlement rule, individual charges are settled by single allocations.
  // Let's test adding a ₹500 charge or settling EB if rent is paid:
  // Let's approve a payment of ₹9,000 to settle Rent:
  const payRentRes = await db.query(`
    SELECT public.approve_payment_and_allocate(
      '${prop1Id}', '${res1Id}', 900000, 'upi', '2026-10-28'::DATE, 'Rent payment'
    ) AS res;
  `);
  const paymentRentId = payRentRes.rows[0].res.payment_id;
  assert.strictEqual(payRentRes.rows[0].res.settled_charges_count, 1, 'Rent charge settled');
  console.log('  ✓ Rent charge of ₹9,000 settled directly by dedicated payment.');

  // Now the oldest outstanding charge for Alice is the EB charge of ₹334 (33,400 paise)!
  // Payment 1 has ₹8,500 credit available.
  // Apply credit now: Payment 1 has ₹8,500 >= ₹334, so it should settle the EB charge!
  const creditRes2 = await db.query(`
    SELECT public.apply_unallocated_credit('${res1Id}') AS res;
  `);
  const creditData2 = creditRes2.rows[0].res;
  assert.strictEqual(creditData2.success, true);
  assert.strictEqual(creditData2.charges_settled_count, 1);
  assert.strictEqual(creditData2.total_credit_applied_paise, 33400);
  console.log('  ✓ Credit applied: EB charge of ₹334 settled using Payment 1 unallocated credit.');

  // Check updated credit on Payment 1: ₹8,500 - ₹334 = ₹8,166 (816,600 paise)
  const p1Check2 = await db.query(`
    SELECT amount_paise, unallocated_amount_paise FROM public.payments WHERE id = '${payment1Id}';
  `);
  assert.strictEqual(parseInt(p1Check2.rows[0].unallocated_amount_paise, 10), 816600);

  // Invariant check on Payment 1 after credit application:
  // amount_paise (850,000) == active_alloc (33,400) + unallocated (816,600)
  assert.strictEqual(
    parseInt(p1Check2.rows[0].amount_paise, 10),
    33400 + 816600
  );
  console.log('  ✓ Invariant holds after credit application: 850,000 = 33,400 + 816,600.');

  // --------------------------------------------------------------------------
  // TEST F: Payment Reversal Before & After Credit Application
  // --------------------------------------------------------------------------
  console.log('\n[Test F] Payment Reversal & Reopened Settlement Invariants:');

  // Reversing Payment 1 (which has an active allocation for the EB charge):
  const revRes = await db.query(`
    SELECT public.reverse_payment('${payment1Id}', 'Student payment bounced') AS res;
  `);
  assert.strictEqual(revRes.rows[0].res.success, true);
  assert.strictEqual(revRes.rows[0].res.charges_reopened_count, 1);
  console.log('  ✓ Payment 1 reversed: 1 settled charge reopened.');

  // Check that the EB charge is back to 'outstanding'
  const ebCheck = await db.query(`
    SELECT status FROM public.charges WHERE category = 'electricity' AND resident_id = '${res1Id}';
  `);
  assert.strictEqual(ebCheck.rows[0].status, 'outstanding');

  // Check that allocation for Payment 1 is 'reversed' and NOT deleted
  const allocHist = await db.query(`
    SELECT status, settled_amount_paise FROM public.payment_allocations WHERE payment_id = '${payment1Id}';
  `);
  assert.strictEqual(allocHist.rows.length, 1);
  assert.strictEqual(allocHist.rows[0].status, 'reversed');
  console.log('  ✓ Historical allocation preserved with status = "reversed".');

  // Check that unallocated credit on Payment 1 was zeroed
  const p1RevCheck = await db.query(`
    SELECT status, unallocated_amount_paise FROM public.payments WHERE id = '${payment1Id}';
  `);
  assert.strictEqual(p1RevCheck.rows[0].status, 'reversed');
  assert.strictEqual(parseInt(p1RevCheck.rows[0].unallocated_amount_paise, 10), 0);
  console.log('  ✓ Payment 1 unallocated credit zeroed upon reversal.');

  // Partial unique index test: Now that allocation on the EB charge is 'reversed',
  // can a new payment settle this reopened EB charge without unique violation?
  const newSettleRes = await db.query(`
    SELECT public.approve_payment_and_allocate(
      '${prop1Id}', '${res1Id}', 33400, 'cash', '2026-10-29'::DATE, 'Re-settling EB charge'
    ) AS res;
  `);
  assert.strictEqual(newSettleRes.rows[0].res.success, true);
  assert.strictEqual(newSettleRes.rows[0].res.settled_charges_count, 1);
  console.log('  ✓ Partial unique index verified: Reopened charge successfully re-settled by new payment!');

  // Verify that payment_allocations table holds BOTH the reversed allocation and the active allocation:
  const ebAllocs = await db.query(`
    SELECT pa.id, pa.status, pa.settled_amount_paise, p.receipt_number
    FROM public.payment_allocations pa
    JOIN public.payments p ON p.id = pa.payment_id
    JOIN public.charges c ON c.id = pa.charge_id
    WHERE c.category = 'electricity' AND c.resident_id = '${res1Id}'
    ORDER BY pa.created_at ASC;
  `);
  assert.strictEqual(ebAllocs.rows.length, 2);
  assert.strictEqual(ebAllocs.rows[0].status, 'reversed');
  assert.strictEqual(ebAllocs.rows[1].status, 'active');
  console.log('  ✓ Audit trail complete: Table contains 1 reversed allocation and 1 active allocation.');

  // --------------------------------------------------------------------------
  // TEST G: Cross-Property Authorization & Security Boundaries
  // --------------------------------------------------------------------------
  console.log('\n[Test G] Cross-Property Authorization & Direct Access Restrictions:');

  // Owner 2 attempts to query billing summary of Alice (who belongs to Owner 1's property)
  await asUser(owner2Id);
  const crossSumm = await db.query(`
    SELECT public.get_resident_billing_summary('${res1Id}') AS res;
  `);
  assert.strictEqual(crossSumm.rows[0].res.success, false);
  assert(crossSumm.rows[0].res.error.includes('Unauthorized'));
  console.log('  ✓ Cross-property leak prevented: Owner 2 cannot query Alice summary.');

  // Owner 2 attempts to allocate EB to Owner 1's property
  const crossEb = await db.query(`
    SELECT public.allocate_eb_bill(
      '${prop1Id}', '101', '2026-11-01'::DATE, '2026-11-30'::DATE, '2026-12-05'::DATE,
      100000, ARRAY['${res1Id}']::UUID[], 'Unauthorized attempt'
    ) AS res;
  `);
  assert.strictEqual(crossEb.rows[0].res.success, false);
  assert(crossEb.rows[0].res.error.includes('do not own this property'));
  console.log('  ✓ Cross-property modification prevented: Owner 2 cannot bill Owner 1 property.');

  // --------------------------------------------------------------------------
  // TEST H: Security Hardening & Least-Privilege Verification
  // --------------------------------------------------------------------------
  console.log('\n[Test H] Security Hardening & Least-Privilege Verification:');

  // H.1 Unauthenticated caller (anon role) denied
  console.log('  Testing unauthenticated (anon) caller access...');
  await asUser(null, 'anon');

  // Anon calling generate_monthly_charges
  let anonBlocked = false;
  try {
    const res = await db.query(`SELECT public.generate_monthly_charges('${prop1Id}', '2026-11-01'::DATE, 900000) AS res;`);
    anonBlocked = res.rows[0].res.success === false;
  } catch (err) {
    anonBlocked = true; // permission denied error from revoke
  }
  assert.strictEqual(anonBlocked, true, 'Anon must not execute generate_monthly_charges');

  // Anon calling generate_receipt_number helper
  let anonReceiptBlocked = false;
  try {
    await db.query(`SELECT public.generate_receipt_number('${prop1Id}');`);
  } catch (err) {
    anonReceiptBlocked = true;
  }
  assert.strictEqual(anonReceiptBlocked, true, 'Anon must not execute internal generate_receipt_number helper');

  // Anon querying billing tables directly
  let anonSelectBlocked = false;
  try {
    await db.query(`SELECT * FROM public.charges;`);
  } catch (err) {
    anonSelectBlocked = true;
  }
  assert.strictEqual(anonSelectBlocked, true, 'Anon must not SELECT from public.charges');
  console.log('  ✓ Unauthenticated (anon) caller completely denied.');

  // H.2 Student attempting owner-only RPCs denied
  console.log('  Testing student attempting owner-only RPCs...');
  await asUser(student1Auth, 'authenticated');

  const ownerOnlyCalls = [
    { name: 'generate_monthly_charges', sql: `SELECT public.generate_monthly_charges('${prop1Id}', '2026-11-01'::DATE, 900000) AS res;` },
    { name: 'approve_payment_and_allocate', sql: `SELECT public.approve_payment_and_allocate('${prop1Id}', '${res1Id}', 50000, 'cash', '2026-11-01'::DATE, 'Test') AS res;` },
    { name: 'reverse_payment', sql: `SELECT public.reverse_payment('${payment1Id}', 'Test reversal') AS res;` },
    { name: 'reject_student_payment_report', sql: `SELECT public.reject_student_payment_report('${reportId}', 'Test reject') AS res;` },
    { name: 'allocate_eb_bill', sql: `SELECT public.allocate_eb_bill('${prop1Id}', '101', '2026-11-01'::DATE, '2026-11-30'::DATE, '2026-12-05'::DATE, 100000, ARRAY['${res1Id}']::UUID[], 'Test') AS res;` },
    { name: 'record_opening_balance', sql: `SELECT public.record_opening_balance('${res1Id}', 'rent', 50000, '2026-11-01'::DATE, 'Test') AS res;` },
    { name: 'toggle_washing_machine', sql: `SELECT public.toggle_washing_machine('${res1Id}', true) AS res;` },
    { name: 'apply_unallocated_credit', sql: `SELECT public.apply_unallocated_credit('${res1Id}') AS res;` },
    { name: 'link_resident_profile', sql: `SELECT public.link_resident_profile('${res2Id}', 'alice@example.com') AS res;` },
    { name: 'unlink_resident_profile', sql: `SELECT public.unlink_resident_profile('${res1Id}') AS res;` },
  ];

  for (const call of ownerOnlyCalls) {
    const res = await db.query(call.sql);
    assert.strictEqual(res.rows[0].res.success, false, `Student must be denied for ${call.name}`);
    assert(res.rows[0].res.error.toLowerCase().includes('unauthorized'), `Error must state unauthorized for ${call.name}`);
  }
  console.log('  ✓ All 10 owner-only RPCs verified: student invocation strictly rejected.');

  // H.3 Student reading another resident's billing data denied under RLS
  console.log('  Testing student RLS isolation...');
  const crossCharges = await db.query(`
    SELECT * FROM public.charges WHERE resident_id = '${res2Id}';
  `);
  assert.strictEqual(crossCharges.rows.length, 0, 'Student must not see another resident charges');

  const crossPayments = await db.query(`
    SELECT * FROM public.payments WHERE resident_id = '${res2Id}';
  `);
  assert.strictEqual(crossPayments.rows.length, 0, 'Student must not see another resident payments');

  const ownCharges = await db.query(`
    SELECT * FROM public.charges WHERE resident_id = '${res1Id}';
  `);
  assert(ownCharges.rows.length > 0, 'Student can read own charges under RLS');
  console.log('  ✓ RLS isolation confirmed: student cannot read another resident charges or payments.');

  // H.4 Student attempting direct financial mutations denied (least-privilege table grants)
  console.log('  Testing direct table write revokes on authenticated...');
  let payInsertDenied = false;
  try {
    await db.query(`INSERT INTO public.payments (property_id, resident_id, receipt_number, amount_paise, method, payment_date, recorded_by) VALUES ('${prop1Id}', '${res1Id}', 'HACK-1', 10000, 'cash', '2026-11-01'::DATE, '${student1Auth}');`);
  } catch (err) {
    payInsertDenied = true;
  }
  assert.strictEqual(payInsertDenied, true, 'Direct INSERT into payments must be denied');

  let allocInsertDenied = false;
  try {
    await db.query(`INSERT INTO public.payment_allocations (payment_id, charge_id, settled_amount_paise) VALUES ('${payment1Id}', '${res1Id}', 1000);`);
  } catch (err) {
    allocInsertDenied = true;
  }
  assert.strictEqual(allocInsertDenied, true, 'Direct INSERT into payment_allocations must be denied');

  let chargeUpdateDenied = false;
  try {
    await db.query(`UPDATE public.charges SET status = 'settled' WHERE resident_id = '${res1Id}';`);
  } catch (err) {
    chargeUpdateDenied = true;
  }
  assert.strictEqual(chargeUpdateDenied, true, 'Direct UPDATE on charges must be denied');

  let chargeTruncateDenied = false;
  try {
    await db.query(`TRUNCATE public.charges;`);
  } catch (err) {
    chargeTruncateDenied = true;
  }
  assert.strictEqual(chargeTruncateDenied, true, 'TRUNCATE on charges must be denied');

  let reportDeleteDenied = false;
  try {
    await db.query(`DELETE FROM public.student_payment_reports WHERE resident_id = '${res1Id}';`);
  } catch (err) {
    reportDeleteDenied = true;
  }
  assert.strictEqual(reportDeleteDenied, true, 'Direct DELETE on student_payment_reports must be denied');
  console.log('  ✓ Least-privilege confirmed: Direct financial table writes and TRUNCATE blocked.');

  // H.5 Student payment report INSERT security
  console.log('  Testing student payment report insertion policies...');
  // Status column injection prevented
  let statusInjectionDenied = false;
  try {
    await db.query(`
      INSERT INTO public.student_payment_reports (
        property_id, resident_id, amount_paise, claimed_method, payment_date, status
      ) VALUES (
        '${prop1Id}', '${res1Id}', 50000, 'upi', '2026-11-01'::DATE, 'approved'
      );
    `);
  } catch (err) {
    statusInjectionDenied = true;
  }
  assert.strictEqual(statusInjectionDenied, true, 'Student cannot inject status into payment report');

  // Submitting report for another resident denied under RLS
  let crossResidentReportDenied = false;
  try {
    await db.query(`
      INSERT INTO public.student_payment_reports (
        property_id, resident_id, amount_paise, claimed_method, payment_date
      ) VALUES (
        '${prop1Id}', '${res2Id}', 50000, 'upi', '2026-11-01'::DATE
      );
    `);
  } catch (err) {
    crossResidentReportDenied = true;
  }
  assert.strictEqual(crossResidentReportDenied, true, 'Student cannot submit report for another resident');

  // Legitimate student report succeeds
  const legitReport = await db.query(`
    INSERT INTO public.student_payment_reports (
      property_id, resident_id, amount_paise, claimed_method, payment_date, reference_number, notes
    ) VALUES (
      '${prop1Id}', '${res1Id}', 50000, 'upi', '2026-11-01'::DATE, 'UPI-LEGIT', 'Legitimate claim'
    ) RETURNING id;
  `);
  assert.strictEqual(legitReport.rows.length, 1, 'Legitimate student report must succeed');
  console.log('  ✓ Payment report workflow secured: status injection blocked, cross-resident submission blocked, legitimate submission verified.');

  // ==========================================================================
  // [Test I] Complaints & Maintenance Ticketing Invariants & Workflow
  // ==========================================================================
  console.log('\n[Test I] Complaints & Maintenance Ticketing Invariants & Workflow:');

  // I.1 Student Alice submits a valid complaint
  await asUser(student1Auth, 'authenticated');
  const aliceComplaint = await db.query(`
    INSERT INTO public.complaints (
      property_id, resident_id, category, priority, title, description
    ) VALUES (
      '${prop1Id}', '${res1Id}', 'plumbing', 'high', 'Geyser not heating water', 'Cold water since this morning in Room 101'
    ) RETURNING id, status, created_at;
  `);
  assert.strictEqual(aliceComplaint.rows.length, 1, 'Alice must be able to submit a complaint');
  const complaintId = aliceComplaint.rows[0].id;
  assert.strictEqual(aliceComplaint.rows[0].status, 'open', 'Complaint default status must be open');
  console.log('  ✓ Student Alice submitted plumbing complaint with default status "open".');

  // I.2 Student status injection denied
  let complaintStatusTamperDenied = false;
  try {
    await db.query(`
      INSERT INTO public.complaints (
        property_id, resident_id, category, priority, title, description, status
      ) VALUES (
        '${prop1Id}', '${res1Id}', 'electrical', 'low', 'Tubelight flickering', 'Flickering in Room 101', 'resolved'
      );
    `);
  } catch (err) {
    complaintStatusTamperDenied = true;
  }
  assert.strictEqual(complaintStatusTamperDenied, true, 'Student cannot inject resolved status on insert');
  console.log('  ✓ Column privilege enforced: Student status injection on complaint insert rejected.');

  // I.3 Cross-resident complaint submission denied under RLS
  let crossResidentComplaintDenied = false;
  try {
    await db.query(`
      INSERT INTO public.complaints (
        property_id, resident_id, category, priority, title, description
      ) VALUES (
        '${prop1Id}', '${res2Id}', 'wifi_internet', 'urgent', 'Wi-Fi not working', 'Wi-Fi dead in Room 102'
      );
    `);
  } catch (err) {
    crossResidentComplaintDenied = true;
  }
  assert.strictEqual(crossResidentComplaintDenied, true, 'Alice cannot file complaint on behalf of Bob');
  console.log('  ✓ RLS enforced: Cross-resident complaint creation rejected.');

  // I.4 Owner 1 views complaint for Property 1
  await asUser(owner1Id, 'authenticated');
  const owner1Complaints = await db.query(`
    SELECT id, title, status FROM public.complaints
    WHERE property_id = '${prop1Id}';
  `);
  assert.strictEqual(owner1Complaints.rows.length, 1, 'Owner 1 must see Alice complaint');
  assert.strictEqual(owner1Complaints.rows[0].id, complaintId);
  console.log('  ✓ Owner 1 successfully viewed complaint for Property 1.');

  // I.5 Cross-tenant isolation: Owner 2 and Student Bob cannot view Alice complaint
  await asUser(owner2Id, 'authenticated');
  const owner2Complaints = await db.query(`
    SELECT id FROM public.complaints WHERE id = '${complaintId}';
  `);
  assert.strictEqual(owner2Complaints.rows.length, 0, 'Owner 2 must not see Owner 1 complaint under RLS');

  await asUser(student2Auth, 'authenticated');
  const bobComplaints = await db.query(`
    SELECT id FROM public.complaints WHERE id = '${complaintId}';
  `);
  assert.strictEqual(bobComplaints.rows.length, 0, 'Student Bob must not see Alice complaint under RLS');
  console.log('  ✓ Cross-tenant RLS confirmed: Neither Owner 2 nor Student Bob can view Alice complaint.');

  // I.6 Owner 1 updates ticket: in_progress -> resolved
  await asUser(owner1Id, 'authenticated');
  await db.query(`
    UPDATE public.complaints
    SET status = 'in_progress', owner_notes = 'Plumber booked for 2 PM'
    WHERE id = '${complaintId}';
  `);

  const inProgCheck = await db.query(`
    SELECT status, owner_notes FROM public.complaints WHERE id = '${complaintId}';
  `);
  assert.strictEqual(inProgCheck.rows[0].status, 'in_progress');
  assert.strictEqual(inProgCheck.rows[0].owner_notes, 'Plumber booked for 2 PM');

  // Mark resolved
  await db.query(`
    UPDATE public.complaints
    SET status = 'resolved', owner_notes = 'Heating element replaced by vendor', resolved_at = now()
    WHERE id = '${complaintId}';
  `);

  const resolvedCheck = await db.query(`
    SELECT status, owner_notes, resolved_at FROM public.complaints WHERE id = '${complaintId}';
  `);
  assert.strictEqual(resolvedCheck.rows[0].status, 'resolved');
  assert.ok(resolvedCheck.rows[0].resolved_at !== null, 'resolved_at must be populated');
  console.log('  ✓ Owner 1 updated complaint lifecycle to in_progress and then resolved with vendor notes.');

  // I.7 Student Alice verifies resolution notes and resolved status
  await asUser(student1Auth, 'authenticated');
  const aliceView = await db.query(`
    SELECT status, owner_notes, resolved_at FROM public.complaints WHERE id = '${complaintId}';
  `);
  assert.strictEqual(aliceView.rows.length, 1);
  assert.strictEqual(aliceView.rows[0].status, 'resolved');
  assert.strictEqual(aliceView.rows[0].owner_notes, 'Heating element replaced by vendor');
  console.log('  ✓ Student Alice verified the resolved status and resolution note.');

  // I.8 Unauthenticated access denied
  await asUser(null, 'anon');
  let anonComplaintDenied = false;
  try {
    await db.query(`SELECT * FROM public.complaints;`);
  } catch (err) {
    anonComplaintDenied = true;
  }
  assert.strictEqual(anonComplaintDenied, true, 'Anonymous users must be completely denied on complaints table');
  console.log('  ✓ Anonymous caller completely denied access to complaints.');
  await asUser(null);

  // ==========================================================================
  // [Test J] Real-time Washing Machine Availability & Atomic State Invariants
  // ==========================================================================
  console.log('\n[Test J] Real-time Washing Machine Availability & Atomic State Invariants:');

  // J.1 Initialization: Property machine defaults to 'free' with NULL occupant
  await asUser(owner1Id, 'authenticated');
  const initRes = await db.query(`SELECT public.get_or_create_wm_status('${prop1Id}') AS res;`);
  assert.strictEqual(initRes.rows[0].res.success, true);
  assert.strictEqual(initRes.rows[0].res.status, 'free');
  assert.strictEqual(initRes.rows[0].res.current_resident_id, null);
  console.log('  ✓ Machine initialized to "free" status with NULL occupant.');

  // J.2 Owner read-only enforcement: Owner cannot call start_washing_machine
  const ownerStartRes = await db.query(`SELECT public.start_washing_machine('${prop1Id}') AS res;`);
  assert.strictEqual(ownerStartRes.rows[0].res.success, false);
  assert(ownerStartRes.rows[0].res.error.includes('Only active residents'));
  console.log('  ✓ Owner read-only confirmed: Owner cannot start washing machine session.');

  // J.3 Authorized Resident Alice starts using the free machine
  await asUser(student1Auth, 'authenticated');
  const aliceStartRes = await db.query(`SELECT public.start_washing_machine('${prop1Id}') AS res;`);
  assert.strictEqual(aliceStartRes.rows[0].res.success, true);
  assert.strictEqual(aliceStartRes.rows[0].res.status, 'in_use');
  assert.strictEqual(aliceStartRes.rows[0].res.current_resident_id, res1Id);
  assert.strictEqual(aliceStartRes.rows[0].res.current_resident_name, 'Alice Smith');
  console.log('  ✓ Resident Alice started washing machine session. State is now "in_use".');

  // J.4 Database Check Invariant: status = 'in_use' requires current_resident_id and started_at
  const dbCheckInUse = await db.query(`SELECT * FROM public.washing_machine_status WHERE property_id = '${prop1Id}';`);
  assert.strictEqual(dbCheckInUse.rows[0].status, 'in_use');
  assert.strictEqual(dbCheckInUse.rows[0].current_resident_id, res1Id);
  assert.ok(dbCheckInUse.rows[0].started_at !== null);
  console.log('  ✓ Database invariant verified: status "in_use" holds non-null resident ID and started_at.');

  // J.5 Concurrency / Duplicate protection: Second resident Bob attempts to start occupied machine
  await asUser(student2Auth, 'authenticated');
  const bobStartAttempt = await db.query(`SELECT public.start_washing_machine('${prop1Id}') AS res;`);
  assert.strictEqual(bobStartAttempt.rows[0].res.success, false);
  assert(bobStartAttempt.rows[0].res.error.includes('currently in use'));
  console.log('  ✓ Concurrency protection: Second resident rejected from starting occupied machine.');

  // J.6 Tamper protection: Second resident Bob attempts to release Alice session
  const bobReleaseAttempt = await db.query(`SELECT public.release_washing_machine('${prop1Id}') AS res;`);
  assert.strictEqual(bobReleaseAttempt.rows[0].res.success, false);
  assert(bobReleaseAttempt.rows[0].res.error.includes('Only the resident who started this wash session'));
  console.log('  ✓ Session security: Unauthorized resident blocked from releasing someone else session.');

  // J.7 Cross-property isolation: Resident from Prop 1 cannot access Prop 2 machine
  const crossPropAttempt = await db.query(`SELECT public.get_or_create_wm_status('${prop2Id}') AS res;`);
  assert.strictEqual(crossPropAttempt.rows[0].res.success, false);
  assert(crossPropAttempt.rows[0].res.error.includes('Unauthorized'));
  console.log('  ✓ Multi-tenant isolation: Resident cannot inspect or mutate another property machine.');

  // J.8 Direct table writes & TRUNCATE blocked by least-privilege
  let directWmUpdateBlocked = false;
  try {
    await db.query(`UPDATE public.washing_machine_status SET status = 'free' WHERE property_id = '${prop1Id}';`);
  } catch (err) {
    directWmUpdateBlocked = true;
  }
  assert.strictEqual(directWmUpdateBlocked, true, 'Direct UPDATE on washing_machine_status must be blocked');
  console.log('  ✓ Least-privilege verified: Direct table mutations on washing_machine_status blocked.');

  // J.9 Session Owner Alice marks machine free
  await asUser(student1Auth, 'authenticated');
  const aliceReleaseRes = await db.query(`SELECT public.release_washing_machine('${prop1Id}') AS res;`);
  assert.strictEqual(aliceReleaseRes.rows[0].res.success, true);
  assert.strictEqual(aliceReleaseRes.rows[0].res.status, 'free');
  console.log('  ✓ Resident Alice marked machine free.');

  // J.10 Database Check Invariant: status = 'free' clears resident and started_at
  const dbCheckFree = await db.query(`SELECT * FROM public.washing_machine_status WHERE property_id = '${prop1Id}';`);
  assert.strictEqual(dbCheckFree.rows[0].status, 'free');
  assert.strictEqual(dbCheckFree.rows[0].current_resident_id, null);
  assert.strictEqual(dbCheckFree.rows[0].started_at, null);
  console.log('  ✓ Database invariant verified: status "free" clears resident ID and started_at.');

  // J.11 Unauthenticated (anon) caller completely denied
  await asUser(null, 'anon');
  let anonWmDenied = false;
  try {
    await db.query(`SELECT * FROM public.washing_machine_status;`);
  } catch (err) {
    anonWmDenied = true;
  }
  assert.strictEqual(anonWmDenied, true, 'Anon cannot query washing_machine_status table');
  console.log('  ✓ Anonymous caller completely denied access to washing machine status.');
  await asUser(null);

  // ==========================================================================
  // [Test K] Unified Resident & Auth Onboarding Invariants
  // ==========================================================================
  console.log('\n[Test K] Unified Resident & Auth Onboarding Invariants:');

  const newStudentAuthId = '55555555-5555-5555-5555-555555555555';
  await db.exec(`INSERT INTO auth.users (id, email) VALUES ('${newStudentAuthId}', 'rahul@student.test');`);

  // K.1 Owner 1 creates resident linked to new student auth account
  await asUser(owner1Id, 'authenticated');
  const createRes = await db.query(`
    SELECT public.create_or_link_resident_with_auth(
      '${prop1Id}',
      '${newStudentAuthId}',
      'Rahul Sharma',
      '103',
      '9876543210',
      true
    ) AS res;
  `);
  assert.strictEqual(createRes.rows[0].res.success, true);
  assert.strictEqual(createRes.rows[0].res.is_existing, false);
  const newResidentId = createRes.rows[0].res.resident_id;
  console.log('  ✓ Owner 1 created resident profile and linked auth user atomically.');

  // K.2 Verify database records
  const profileCheck = await db.query(`SELECT role, must_change_password FROM public.profiles WHERE id = '${newStudentAuthId}';`);
  assert.strictEqual(profileCheck.rows[0].role, 'student');
  assert.strictEqual(profileCheck.rows[0].must_change_password, true);

  const residentCheck = await db.query(`SELECT property_id, room_number, profile_id FROM public.residents WHERE id = '${newResidentId}';`);
  assert.strictEqual(residentCheck.rows[0].property_id, prop1Id);
  assert.strictEqual(residentCheck.rows[0].room_number, '103');
  assert.strictEqual(residentCheck.rows[0].profile_id, newStudentAuthId);
  console.log('  ✓ Verified: profile role=student, must_change_password=true, resident room=103.');

  // K.3 Cross-property owner isolation: Owner 2 cannot link resident to Owner 1 property
  await asUser(owner2Id, 'authenticated');
  const crossOwnerAttempt = await db.query(`
    SELECT public.create_or_link_resident_with_auth(
      '${prop1Id}',
      '${newStudentAuthId}',
      'Rahul Hacker',
      '999'
    ) AS res;
  `);
  assert.strictEqual(crossOwnerAttempt.rows[0].res.success, false);
  assert(crossOwnerAttempt.rows[0].res.error.includes('Unauthorized'));
  console.log('  ✓ Cross-property isolation: Owner 2 cannot create/modify resident on Owner 1 property.');

  // K.4 Student privilege boundary: Student cannot invoke create_or_link_resident_with_auth
  await asUser(student1Auth, 'authenticated');
  const studentAttempt = await db.query(`
    SELECT public.create_or_link_resident_with_auth(
      '${prop1Id}',
      '${newStudentAuthId}',
      'Student Hack',
      '101'
    ) AS res;
  `);
  assert.strictEqual(studentAttempt.rows[0].res.success, false);
  assert(studentAttempt.rows[0].res.error.includes('Unauthorized'));
  console.log('  ✓ Role privilege enforced: Student cannot call create_or_link_resident_with_auth.');

  // K.5 Owner account protection: Cannot convert an existing owner profile into a resident
  await asUser(owner1Id, 'authenticated');
  const ownerConvertAttempt = await db.query(`
    SELECT public.create_or_link_resident_with_auth(
      '${prop1Id}',
      '${owner2Id}',
      'Owner Two As Student',
      '105'
    ) AS res;
  `);
  assert.strictEqual(ownerConvertAttempt.rows[0].res.success, false);
  assert(ownerConvertAttempt.rows[0].res.error.includes('owner account'));
  console.log('  ✓ Role integrity enforced: Existing owner profile cannot be converted into a resident.');

  // K.6 Password change must_change_password update grant verification
  await asUser(newStudentAuthId, 'authenticated');
  await db.query(`
    UPDATE public.profiles
    SET must_change_password = false
    WHERE id = '${newStudentAuthId}';
  `);
  const updatedProf = await db.query(`SELECT must_change_password FROM public.profiles WHERE id = '${newStudentAuthId}';`);
  assert.strictEqual(updatedProf.rows[0].must_change_password, false);
  console.log('  ✓ Student successfully cleared must_change_password after password change.');
  await asUser(null);

  // ==========================================================================
  // [Test L] Student-Driven Gate Movement & View-Only Attendance Invariants
  // ==========================================================================
  console.log('\n[Test L] Student-Driven Gate Movement & Attendance Invariants:');

  // L.1 Student Alice records OUT with purpose, return time, and dinner required
  await asUser(student1Auth, 'authenticated');
  const aliceOutRes = await db.query(`
    SELECT public.record_student_movement(
      'OUT'::public.movement_direction,
      'College',
      '5:30 PM',
      true,
      'Attending lab sessions'
    ) AS res;
  `);
  assert.strictEqual(aliceOutRes.rows[0].res.success, true);
  assert.strictEqual(aliceOutRes.rows[0].res.direction, 'OUT');
  assert.strictEqual(aliceOutRes.rows[0].res.purpose, 'College');
  assert.strictEqual(aliceOutRes.rows[0].res.expected_return_time, '5:30 PM');
  assert.strictEqual(aliceOutRes.rows[0].res.food_required, true);
  console.log('  ✓ Student Alice marked OUT with purpose "College", return "5:30 PM", food_required=true.');

  // L.2 Student Bob records OUT with food NOT required (dining outside)
  await asUser(student2Auth, 'authenticated');
  const bobOutRes = await db.query(`
    SELECT public.record_student_movement(
      'OUT'::public.movement_direction,
      'Home Visit',
      'Tomorrow 10:00 AM',
      false,
      'Visiting family for the weekend'
    ) AS res;
  `);
  assert.strictEqual(bobOutRes.rows[0].res.success, true);
  assert.strictEqual(bobOutRes.rows[0].res.direction, 'OUT');
  assert.strictEqual(bobOutRes.rows[0].res.food_required, false);
  console.log('  ✓ Student Bob marked OUT with food_required=false ("No dinner needed").');

  // L.3 Owner 1 queries live movement logs and attendance status
  await asUser(owner1Id, 'authenticated');
  const ownerLogs = await db.query(`
    SELECT ml.direction, ml.purpose, ml.expected_return_time, ml.food_required, r.full_name
    FROM public.movement_logs ml
    JOIN public.residents r ON r.id = ml.resident_id
    WHERE r.property_id = '${prop1Id}'
    ORDER BY ml.event_time DESC
    LIMIT 2;
  `);
  assert.strictEqual(ownerLogs.rows.length, 2);
  assert.strictEqual(ownerLogs.rows[0].full_name, 'Bob Jones');
  assert.strictEqual(ownerLogs.rows[0].food_required, false);
  assert.strictEqual(ownerLogs.rows[1].full_name, 'Alice Smith');
  assert.strictEqual(ownerLogs.rows[1].food_required, true);

  // Invariant: Inside residents ALWAYS want food; outside residents only count if food_required=true
  // At this point: Alice is OUT (food=true), Bob is OUT (food=false), Charlie is IN (food=true), Rahul is IN (food=true).
  // Total meals needed = 2 (Charlie + Rahul inside) + 1 (Alice outside with food) = 3.
  const activeResidents = await db.query(`
    SELECT r.id, r.full_name,
      COALESCE((
        SELECT ml.direction FROM public.movement_logs ml
        WHERE ml.resident_id = r.id ORDER BY ml.event_time DESC LIMIT 1
      ), 'IN') as status,
      COALESCE((
        SELECT ml.food_required FROM public.movement_logs ml
        WHERE ml.resident_id = r.id ORDER BY ml.event_time DESC LIMIT 1
      ), true) as food_required
    FROM public.residents r
    WHERE r.property_id = '${prop1Id}' AND r.is_active = true;
  `);
  const insideCount = activeResidents.rows.filter(r => r.status === 'IN').length;
  const outsideMealsCount = activeResidents.rows.filter(r => r.status === 'OUT' && r.food_required).length;
  const totalMealsNeeded = insideCount + outsideMealsCount;
  assert.strictEqual(insideCount, 2, 'Charlie and Rahul are inside');
  assert.strictEqual(outsideMealsCount, 1, 'Alice is the only outside resident needing food');
  assert.strictEqual(totalMealsNeeded, 3, 'Total meals must be insideCount + outsideMealsCount');
  console.log('  ✓ Owner 1 verified live attendance and food requirements (inside residents always counted in meals needed).');

  // L.4 Student Alice returns and records IN (1-tap check-in)
  await asUser(student1Auth, 'authenticated');
  const aliceInRes = await db.query(`
    SELECT public.record_student_movement('IN'::public.movement_direction) AS res;
  `);
  assert.strictEqual(aliceInRes.rows[0].res.success, true);
  assert.strictEqual(aliceInRes.rows[0].res.direction, 'IN');
  console.log('  ✓ Student Alice marked IN (1-tap check-in back at the PG).');

  // L.5 Cross-tenant & unauthenticated isolation
  await asUser(null, 'anon');
  let anonMovementDenied = false;
  try {
    await db.query(`SELECT public.record_student_movement('IN'::public.movement_direction) AS res;`);
  } catch (err) {
    anonMovementDenied = true;
  }
  assert.strictEqual(anonMovementDenied, true, 'Anonymous caller must be denied from recording movement');
  console.log('  ✓ Anonymous caller completely denied access to record_student_movement.');
  await asUser(null);

  // ==========================================================================
  // [Test M] Simplified Month-Wise Billing & Payment Proof Invariants
  // ==========================================================================
  console.log('\n[Test M] Simplified Month-Wise Billing & Payment Proof Invariants:');

  // Opt-in Alice to washing machine for test
  await db.query(`
    INSERT INTO public.resident_opt_ins (resident_id, feature_name, is_enabled, effective_from_date)
    VALUES ('${res1Id}', 'washing_machine', true, CURRENT_DATE)
    ON CONFLICT (resident_id, feature_name)
    DO UPDATE SET is_enabled = true;
  `);

  // M.1 Owner 1 generates monthly bills for December 2026
  await asUser(owner1Id, 'authenticated');
  const genBillsRes = await db.query(`
    SELECT public.generate_monthly_bills(
      '${prop1Id}',
      '2026-12-01'::DATE,
      800000::BIGINT
    ) AS res;
  `);
  assert.strictEqual(genBillsRes.rows[0].res.success, true);
  assert(genBillsRes.rows[0].res.created_count >= 3);
  console.log(`  ✓ Owner 1 generated December 2026 bills (${genBillsRes.rows[0].res.created_count} bills created).`);

  // M.2 Verify rent + washing machine breakdown
  const aliceBill = await db.query(`
    SELECT id, amount_paise, rent_amount_paise, wm_amount_paise, status, description
    FROM public.charges
    WHERE resident_id = '${res1Id}' AND billing_period_start = '2026-12-01'::DATE;
  `);
  assert.strictEqual(aliceBill.rows.length, 1);
  assert.strictEqual(Number(aliceBill.rows[0].rent_amount_paise), 800000); // ₹8,000
  assert.strictEqual(Number(aliceBill.rows[0].wm_amount_paise), 50000); // ₹500
  assert.strictEqual(Number(aliceBill.rows[0].amount_paise), 850000); // ₹8,500
  assert.strictEqual(aliceBill.rows[0].status, 'outstanding');
  const aliceChargeId = aliceBill.rows[0].id;
  console.log('  ✓ Alice bill verified: ₹8,000 Rent + ₹500 Washing Machine = ₹8,500 Total.');

  const bobBill = await db.query(`
    SELECT id, amount_paise, rent_amount_paise, wm_amount_paise, status
    FROM public.charges
    WHERE resident_id = '${res2Id}' AND billing_period_start = '2026-12-01'::DATE;
  `);
  assert.strictEqual(bobBill.rows.length, 1);
  assert.strictEqual(Number(bobBill.rows[0].wm_amount_paise), 0); // No washing machine
  assert.strictEqual(Number(bobBill.rows[0].amount_paise), 800000); // ₹8,000
  const bobChargeId = bobBill.rows[0].id;
  console.log('  ✓ Bob bill verified: ₹8,000 Rent + ₹0 Washing Machine = ₹8,000 Total.');

  // M.3 Idempotency: Running generate_monthly_bills again creates 0 new charges
  const duplicateGen = await db.query(`
    SELECT public.generate_monthly_bills(
      '${prop1Id}',
      '2026-12-01'::DATE,
      800000::BIGINT
    ) AS res;
  `);
  assert.strictEqual(duplicateGen.rows[0].res.created_count, 0, 'Duplicate bill generation must create 0 new charges');
  console.log('  ✓ Idempotency verified: re-running bill generation skips already billed residents.');

  // M.4 Student Alice submits payment proof (UPI with screenshot & ref)
  await asUser(student1Auth, 'authenticated');
  const submitProofRes = await db.query(`
    SELECT public.submit_student_payment_proof(
      '${aliceChargeId}',
      'upi',
      'https://supabase.co/storage/v1/object/public/payment-proofs/alice_nov_upi.png',
      'UPI-DEC-ALICE-12345',
      'Paid full ₹8500 via GPay'
    ) AS res;
  `);
  assert.strictEqual(submitProofRes.rows[0].res.success, true);
  const aliceProofReportId = submitProofRes.rows[0].res.report_id;
  console.log('  ✓ Student Alice submitted UPI payment proof with screenshot URL and reference number.');

  // M.5 Owner 1 reviews recent report and confirms payment
  await asUser(owner1Id, 'authenticated');
  const pendingReportQuery = await db.query(`
    SELECT r.id, r.amount_paise, r.claimed_method, r.screenshot_url, r.reference_number, r.status
    FROM public.student_payment_reports r
    WHERE r.id = '${aliceProofReportId}';
  `);
  assert.strictEqual(pendingReportQuery.rows[0].status, 'pending');
  assert.strictEqual(pendingReportQuery.rows[0].screenshot_url, 'https://supabase.co/storage/v1/object/public/payment-proofs/alice_nov_upi.png');

  const confirmRes = await db.query(`
    SELECT public.confirm_monthly_payment(
      '${aliceChargeId}',
      '${aliceProofReportId}',
      'upi',
      'Confirmed payment via UPI receipt'
    ) AS res;
  `);
  assert.strictEqual(confirmRes.rows[0].res.success, true);
  assert(confirmRes.rows[0].res.receipt_number.startsWith('RCT-'));

  // Verify Alice charge is now settled and report approved
  const aliceSettled = await db.query(`SELECT status FROM public.charges WHERE id = '${aliceChargeId}';`);
  assert.strictEqual(aliceSettled.rows[0].status, 'settled');
  const aliceReportApproved = await db.query(`SELECT status FROM public.student_payment_reports WHERE id = '${aliceProofReportId}';`);
  assert.strictEqual(aliceReportApproved.rows[0].status, 'approved');
  console.log('  ✓ Owner 1 confirmed payment: Charge marked settled, payment receipt generated, report approved.');

  // M.6 Owner 1 marks Bob directly as Paid (Cash / In-person without student app submission)
  const bobCashConfirm = await db.query(`
    SELECT public.confirm_monthly_payment(
      '${bobChargeId}',
      NULL,
      'cash',
      'Received cash directly from student'
    ) AS res;
  `);
  assert.strictEqual(bobCashConfirm.rows[0].res.success, true);
  const bobSettled = await db.query(`SELECT status FROM public.charges WHERE id = '${bobChargeId}';`);
  assert.strictEqual(bobSettled.rows[0].status, 'settled');
  console.log('  ✓ Owner 1 directly marked Bob as Paid for in-person cash payment.');

  // M.7 Cross-tenant isolation: Owner 2 cannot confirm Owner 1 charge
  await asUser(owner2Id, 'authenticated');
  const crossOwnerConfirm = await db.query(`
    SELECT public.confirm_monthly_payment('${bobChargeId}') AS res;
  `);
  assert.strictEqual(crossOwnerConfirm.rows[0].res.success, false);
  console.log('  ✓ Cross-tenant security: Owner 2 denied from confirming Owner 1 charges.');

  // M.8 Owner 1 generates January 2027 bills with custom ₹9,000 rent (verifies p_default_rent_paise is respected)
  await asUser(owner1Id, 'authenticated');
  const customRentGenRes = await db.query(`
    SELECT public.generate_monthly_bills(
      '${prop1Id}',
      '2027-01-01'::DATE,
      900000::BIGINT
    ) AS res;
  `);
  assert.strictEqual(customRentGenRes.rows[0].res.success, true);
  assert(customRentGenRes.rows[0].res.created_count >= 3);

  const bobJanBill = await db.query(`
    SELECT amount_paise, rent_amount_paise, wm_amount_paise, status
    FROM public.charges
    WHERE resident_id = '${res2Id}' AND billing_period_start = '2027-01-01'::DATE;
  `);
  assert.strictEqual(Number(bobJanBill.rows[0].rent_amount_paise), 900000, 'Custom ₹9,000 rent must be applied');
  assert.strictEqual(Number(bobJanBill.rows[0].amount_paise), 900000);
  console.log('  ✓ Custom rent amount input verified: bills generated at ₹9,000.');

  // M.9 Re-running generate_monthly_bills with new rent updates existing unpaid bills (does not get stuck)
  const updateBillsGenRes = await db.query(`
    SELECT public.generate_monthly_bills(
      '${prop1Id}',
      '2027-01-01'::DATE,
      950000::BIGINT
    ) AS res;
  `);
  assert.strictEqual(updateBillsGenRes.rows[0].res.success, true);
  assert(updateBillsGenRes.rows[0].res.updated_count >= 3);

  const bobJanUpdatedBill = await db.query(`
    SELECT amount_paise, rent_amount_paise
    FROM public.charges
    WHERE resident_id = '${res2Id}' AND billing_period_start = '2027-01-01'::DATE;
  `);
  assert.strictEqual(Number(bobJanUpdatedBill.rows[0].rent_amount_paise), 950000, 'Unpaid bills must update to ₹9,500');
  console.log('  ✓ Re-running with updated rent amount updates existing unpaid bills to ₹9,500.');

  // M.10 Atomic RPC update_resident_rent updates resident profile and current unpaid charge
  const updateRentRes = await db.query(`
    SELECT public.update_resident_rent(
      '${prop1Id}',
      '${res2Id}',
      1000000::BIGINT,
      '2027-01-01'::DATE
    ) AS res;
  `);
  assert.strictEqual(updateRentRes.rows[0].res.success, true);

  const bobJanEditedBill = await db.query(`
    SELECT amount_paise, rent_amount_paise
    FROM public.charges
    WHERE resident_id = '${res2Id}' AND billing_period_start = '2027-01-01'::DATE;
  `);
  assert.strictEqual(Number(bobJanEditedBill.rows[0].rent_amount_paise), 1000000);
  assert.strictEqual(Number(bobJanEditedBill.rows[0].amount_paise), 1000000);
  console.log('  ✓ update_resident_rent atomically updated resident rent and current unpaid bill to ₹10,000.');

  // M.11 Atomic RPC toggle_resident_wm_billing updates washing machine opt-in and unpaid bill breakdown
  const toggleWmRes = await db.query(`
    SELECT public.toggle_resident_wm_billing(
      '${prop1Id}',
      '${res2Id}',
      true,
      '2027-01-01'::DATE
    ) AS res;
  `);
  assert.strictEqual(toggleWmRes.rows[0].res.success, true);

  const bobJanWmBill = await db.query(`
    SELECT amount_paise, rent_amount_paise, wm_amount_paise
    FROM public.charges
    WHERE resident_id = '${res2Id}' AND billing_period_start = '2027-01-01'::DATE;
  `);
  assert.strictEqual(Number(bobJanWmBill.rows[0].rent_amount_paise), 1000000);
  assert.strictEqual(Number(bobJanWmBill.rows[0].wm_amount_paise), 50000);
  assert.strictEqual(Number(bobJanWmBill.rows[0].amount_paise), 1050000);
  console.log('  ✓ toggle_resident_wm_billing atomically updated washing machine opt-in and bill total to ₹10,500.');
  await asUser(null);

  console.log('\n===============================================================');
  console.log('   ALL POSTGRESQL DATABASE INTEGRATION TESTS PASSED (13/13)     ');
  console.log('===============================================================');
}

runPgIntegrationTests().catch((err) => {
  console.error('\n❌ TEST RUN FAILED:', err);
  process.exit(1);
});
