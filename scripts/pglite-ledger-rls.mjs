import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import fs from 'node:fs';
import path from 'node:path';

async function runLedgerInvariants() {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE TABLE properties (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        name TEXT NOT NULL
      );

      CREATE TABLE residents (
        id TEXT PRIMARY KEY,
        property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
        profile_id TEXT NOT NULL,
        full_name TEXT NOT NULL,
        room_number TEXT NOT NULL,
        monthly_rent_paise INTEGER NOT NULL CHECK (monthly_rent_paise >= 0),
        is_active BOOLEAN NOT NULL DEFAULT true
      );

      CREATE TABLE charges (
        id TEXT PRIMARY KEY,
        property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
        resident_id TEXT NOT NULL REFERENCES residents(id) ON DELETE CASCADE,
        category TEXT NOT NULL CHECK (category IN ('rent', 'electricity')),
        amount_paise INTEGER NOT NULL CHECK (amount_paise >= 0),
        status TEXT NOT NULL CHECK (status IN ('outstanding', 'settled')),
        billing_period_start DATE NOT NULL,
        UNIQUE (resident_id, category, billing_period_start)
      );

      CREATE TABLE payments (
        id TEXT PRIMARY KEY,
        property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
        resident_id TEXT NOT NULL REFERENCES residents(id) ON DELETE CASCADE,
        receipt_number TEXT NOT NULL UNIQUE,
        amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
        method TEXT NOT NULL,
        payment_date DATE NOT NULL
      );

      CREATE TABLE payment_allocations (
        id TEXT PRIMARY KEY,
        charge_id TEXT NOT NULL REFERENCES charges(id) ON DELETE CASCADE,
        payment_id TEXT NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
        amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
        status TEXT NOT NULL CHECK (status IN ('active', 'reversed'))
      );

      CREATE TABLE student_payment_reports (
        id TEXT PRIMARY KEY,
        property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
        resident_id TEXT NOT NULL REFERENCES residents(id) ON DELETE CASCADE,
        charge_id TEXT NOT NULL REFERENCES charges(id) ON DELETE CASCADE,
        amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
        status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected'))
      );

      INSERT INTO properties (id, owner_id, name) VALUES
        ('prop-1', 'owner-1', 'Alpha PG'),
        ('prop-2', 'owner-2', 'Beta PG');

      INSERT INTO residents (id, property_id, profile_id, full_name, room_number, monthly_rent_paise) VALUES
        ('res-1', 'prop-1', 'user-1', 'Asha', '101', 800000),
        ('res-2', 'prop-1', 'user-2', 'Bala', '102', 850000),
        ('res-3', 'prop-2', 'user-3', 'Charan', '201', 900000);

      INSERT INTO charges (id, property_id, resident_id, category, amount_paise, status, billing_period_start) VALUES
        ('chg-1', 'prop-1', 'res-1', 'rent', 800000, 'settled', '2026-11-01'),
        ('chg-2', 'prop-1', 'res-2', 'rent', 850000, 'outstanding', '2026-11-01'),
        ('chg-3', 'prop-2', 'res-3', 'rent', 900000, 'outstanding', '2026-11-01');

      INSERT INTO payments (id, property_id, resident_id, receipt_number, amount_paise, method, payment_date) VALUES
        ('pay-1', 'prop-1', 'res-1', 'RCPT-001', 800000, 'upi', '2026-11-05');

      INSERT INTO payment_allocations (id, charge_id, payment_id, amount_paise, status) VALUES
        ('alloc-1', 'chg-1', 'pay-1', 800000, 'active');

      INSERT INTO student_payment_reports (id, property_id, resident_id, charge_id, amount_paise, status) VALUES
        ('rep-1', 'prop-1', 'res-2', 'chg-2', 850000, 'pending'),
        ('rep-2', 'prop-2', 'res-3', 'chg-3', 900000, 'pending');
    `);

    let duplicateChargeRejected = false;
    try {
      await db.query(
        `INSERT INTO charges (id, property_id, resident_id, category, amount_paise, status, billing_period_start)
         VALUES ('chg-dup', 'prop-1', 'res-1', 'rent', 800000, 'outstanding', '2026-11-01')`
      );
    } catch {
      duplicateChargeRejected = true;
    }

    let negativeChargeRejected = false;
    try {
      await db.query(
        `INSERT INTO charges (id, property_id, resident_id, category, amount_paise, status, billing_period_start)
         VALUES ('chg-neg', 'prop-1', 'res-1', 'electricity', -100, 'outstanding', '2026-11-01')`
      );
    } catch {
      negativeChargeRejected = true;
    }

    const owner1Charges = await db.query(
      `SELECT c.id FROM charges c
       JOIN properties p ON p.id = c.property_id
       WHERE p.owner_id = $1
       ORDER BY c.id`,
      ['owner-1']
    );

    const owner2Charges = await db.query(
      `SELECT c.id FROM charges c
       JOIN properties p ON p.id = c.property_id
       WHERE p.owner_id = $1
       ORDER BY c.id`,
      ['owner-2']
    );

    const res1Allocations = await db.query(
      `SELECT py.receipt_number, pa.charge_id
       FROM payment_allocations pa
       JOIN charges c ON c.id = pa.charge_id
       JOIN residents r ON r.id = c.resident_id
       JOIN payments py ON py.id = pa.payment_id
       WHERE r.profile_id = $1 AND pa.status = 'active'`,
      ['user-1']
    );

    const res2Reports = await db.query(
      `SELECT spr.id
       FROM student_payment_reports spr
       JOIN residents r ON r.id = spr.resident_id
       WHERE r.profile_id = $1`,
      ['user-2']
    );

    return {
      duplicateChargeRejected,
      negativeChargeRejected,
      owner1ChargeIds: owner1Charges.rows.map((r) => r.id),
      owner2ChargeIds: owner2Charges.rows.map((r) => r.id),
      res1Allocations: res1Allocations.rows,
      res2ReportIds: res2Reports.rows.map((r) => r.id),
    };
  } finally {
    await db.close();
  }
}

async function asAuthenticatedUser(db, userId, fn) {
  await db.exec('BEGIN');
  try {
    await db.exec('SET LOCAL ROLE authenticated');
    await db.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [userId]);
    await db.query(`SELECT set_config('request.jwt.claim.role', 'authenticated', true)`);
    const out = await fn();
    await db.exec('COMMIT');
    return out;
  } catch (err) {
    try {
      await db.exec('ROLLBACK');
    } catch {
      // ignore rollback error
    }
    throw err;
  }
}

async function expectRejected(db, userId, sql, params = []) {
  try {
    const res = await asAuthenticatedUser(db, userId, () => db.query(sql, params));
    // For UPDATE/DELETE under RLS with no matching USING row, affectedRows === 0
    // counts as blocked; fail if any row was modified or inserted.
    if (res && typeof res.affectedRows === 'number' && res.affectedRows === 0) {
      return true;
    }
    return false;
  } catch {
    return true;
  }
}

async function runRealMigrationRlsTests() {
  const db = new PGlite({ extensions: { uuid_ossp, pgcrypto } });
  try {
    await db.exec(`
      DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      DO $$ BEGIN CREATE ROLE service_role NOLOGIN BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      CREATE SCHEMA IF NOT EXISTS auth;
      CREATE SCHEMA IF NOT EXISTS extensions;
      CREATE TABLE IF NOT EXISTS auth.users (
        id UUID PRIMARY KEY, email TEXT, phone TEXT,
        raw_user_meta_data JSONB DEFAULT '{}'::jsonb,
        raw_app_meta_data JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT now()
      );
      CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS
        $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      CREATE OR REPLACE FUNCTION auth.role() RETURNS TEXT LANGUAGE sql STABLE AS
        $$ SELECT current_setting('request.jwt.claim.role', true) $$;
      CREATE OR REPLACE FUNCTION auth.jwt() RETURNS JSONB LANGUAGE sql STABLE AS
        $$ SELECT '{}'::jsonb $$;
      GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
      GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;
      CREATE SCHEMA IF NOT EXISTS storage;
      CREATE TABLE IF NOT EXISTS storage.buckets (
        id TEXT PRIMARY KEY, name TEXT, public BOOLEAN DEFAULT false,
        file_size_limit BIGINT, allowed_mime_types TEXT[], owner UUID,
        created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS storage.objects (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id TEXT, name TEXT,
        owner UUID, metadata JSONB, created_at TIMESTAMPTZ DEFAULT now()
      );
      ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
      CREATE OR REPLACE FUNCTION storage.foldername(name TEXT) RETURNS TEXT[] LANGUAGE sql IMMUTABLE AS
        $$ SELECT string_to_array(name, '/') $$;
      CREATE OR REPLACE FUNCTION storage.filename(name TEXT) RETURNS TEXT LANGUAGE sql IMMUTABLE AS
        $$ SELECT (string_to_array(name, '/'))[array_length(string_to_array(name, '/'), 1)] $$;
      DO $$ BEGIN CREATE PUBLICATION supabase_realtime; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);

    const migrationsDir = path.resolve(process.cwd(), 'supabase', 'migrations');
    const migrationFiles = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of migrationFiles) {
      await db.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf8'));
    }

    const IDS = {
      owner1: '10000000-0000-4000-8000-000000000001',
      owner2: '10000000-0000-4000-8000-000000000002',
      warden1: '10000000-0000-4000-8000-000000000003',
      warden2: '10000000-0000-4000-8000-000000000004',
      user1: '10000000-0000-4000-8000-000000000011',
      user2: '10000000-0000-4000-8000-000000000012',
      user3: '10000000-0000-4000-8000-000000000013',
      userInactive: '10000000-0000-4000-8000-000000000014',
      prop1: '20000000-0000-4000-8000-000000000001',
      prop2: '20000000-0000-4000-8000-000000000002',
      res1: '30000000-0000-4000-8000-000000000001',
      res2: '30000000-0000-4000-8000-000000000002',
      res3: '30000000-0000-4000-8000-000000000003',
      resInactive: '30000000-0000-4000-8000-000000000004',
      pw1: '40000000-0000-4000-8000-000000000001',
      pw2: '40000000-0000-4000-8000-000000000002',
      annAll: '50000000-0000-4000-8000-000000000001',
      annRoomD: '50000000-0000-4000-8000-000000000002',
      annRoom101: '50000000-0000-4000-8000-000000000003',
      annProp2: '50000000-0000-4000-8000-000000000004',
      menu1: '60000000-0000-4000-8000-000000000001',
      m1: '70000000-0000-4000-8000-000000000001',
      m2: '70000000-0000-4000-8000-000000000002',
    };

    await db.exec(`
      INSERT INTO auth.users (id, email) VALUES
        ('${IDS.owner1}', 'o1@test.in'),
        ('${IDS.owner2}', 'o2@test.in'),
        ('${IDS.warden1}', 'w1@test.in'),
        ('${IDS.warden2}', 'w2@test.in'),
        ('${IDS.user1}', 'u1@test.in'),
        ('${IDS.user2}', 'u2@test.in'),
        ('${IDS.user3}', 'u3@test.in'),
        ('${IDS.userInactive}', 'u4@test.in');

      INSERT INTO public.profiles (id, full_name, phone_number, role) VALUES
        ('${IDS.owner1}', 'Owner One', '9800000001', 'owner'),
        ('${IDS.owner2}', 'Owner Two', '9800000002', 'owner'),
        ('${IDS.warden1}', 'Warden One', '9800000003', 'warden'),
        ('${IDS.warden2}', 'Warden Two', '9800000004', 'warden'),
        ('${IDS.user1}', 'Resident One', '9800000011', 'student'),
        ('${IDS.user2}', 'Resident Two', '9800000012', 'student'),
        ('${IDS.user3}', 'Resident Three', '9800000013', 'student'),
        ('${IDS.userInactive}', 'Former Resident', '9800000014', 'student')
      ON CONFLICT (id) DO UPDATE SET
        full_name = EXCLUDED.full_name,
        phone_number = EXCLUDED.phone_number,
        role = EXCLUDED.role;

      INSERT INTO public.properties (id, owner_id, name, address, is_active, upi_id, wifi_ssid, wifi_password, curfew_time) VALUES
        ('${IDS.prop1}', '${IDS.owner1}', 'Alpha PG', '1st Main', true, 'alpha@okicici', 'AlphaWiFi', 'pass1234', '22:30'),
        ('${IDS.prop2}', '${IDS.owner2}', 'Beta PG', '2nd Main', true, 'beta@okicici', 'BetaWiFi', 'secret99', '23:00');

      INSERT INTO public.property_wardens (id, property_id, warden_profile_id, assigned_by, is_active) VALUES
        ('${IDS.pw1}', '${IDS.prop1}', '${IDS.warden1}', '${IDS.owner1}', true),
        ('${IDS.pw2}', '${IDS.prop2}', '${IDS.warden2}', '${IDS.owner2}', true);

      INSERT INTO public.residents (id, property_id, profile_id, full_name, phone_number, room_number, monthly_rent_paise, is_active) VALUES
        ('${IDS.res1}', '${IDS.prop1}', '${IDS.user1}', 'Resident One', '9800000011', 'Room D', 800000, true),
        ('${IDS.res2}', '${IDS.prop1}', '${IDS.user2}', 'Resident Two', '9800000012', '101', 800000, true),
        ('${IDS.res3}', '${IDS.prop2}', '${IDS.user3}', 'Resident Three', '9800000013', 'D', 900000, true),
        ('${IDS.resInactive}', '${IDS.prop1}', '${IDS.userInactive}', 'Former Resident', '9800000014', '102', 800000, false);

      INSERT INTO public.resident_opt_ins (resident_id, feature_name, is_enabled, effective_from_date) VALUES
        ('${IDS.res1}', 'washing_machine', true, CURRENT_DATE),
        ('${IDS.res2}', 'washing_machine', true, CURRENT_DATE);

      INSERT INTO public.announcements (id, property_id, owner_id, title, message, audience, room_number, channel, recipient_count) VALUES
        ('${IDS.annAll}', '${IDS.prop1}', '${IDS.owner1}', 'All Notice', 'General water maintenance', 'all', NULL, 'push', 2),
        ('${IDS.annRoomD}', '${IDS.prop1}', '${IDS.owner1}', 'Room D Notice', 'AC filter cleanup in Room D', 'room', 'D', 'push', 1),
        ('${IDS.annRoom101}', '${IDS.prop1}', '${IDS.owner1}', 'Room 101 Notice', 'Window repair in 101', 'room', '101', 'push', 1),
        ('${IDS.annProp2}', '${IDS.prop2}', '${IDS.owner2}', 'Beta Notice', 'Beta PG meeting', 'all', NULL, 'push', 1);

      INSERT INTO public.food_menus (id, property_id, menu_date, meal_type, items, meal_time, is_published) VALUES
        ('${IDS.menu1}', '${IDS.prop1}', CURRENT_DATE, 'dinner', 'Chapati & Dal', '20:00', true);

      INSERT INTO public.washing_machines (id, property_id, machine_number, machine_name, is_active, status) VALUES
        ('${IDS.m1}', '${IDS.prop1}', 1, 'Washing Machine 1', true, 'free'),
        ('${IDS.m2}', '${IDS.prop1}', 2, 'Washing Machine 2', true, 'free');
    `);

    // 1. Announcements RLS scoping
    const user1Announcements = await asAuthenticatedUser(db, IDS.user1, () =>
      db.query(`SELECT id FROM public.announcements ORDER BY id`)
    );
    const user2Announcements = await asAuthenticatedUser(db, IDS.user2, () =>
      db.query(`SELECT id FROM public.announcements ORDER BY id`)
    );
    const residentCannotInsertAnnouncement = await expectRejected(
      db,
      IDS.user1,
      `INSERT INTO public.announcements (property_id, owner_id, title, message, audience)
       VALUES ($1, $2, 'Fake', 'Fake body', 'all')`,
      [IDS.prop1, IDS.user1]
    );
    const residentCannotUpdateAnnouncement = await expectRejected(
      db,
      IDS.user1,
      `UPDATE public.announcements SET title = 'Hacked' WHERE id = $1`,
      [IDS.annAll]
    );
    const residentCannotDeleteAnnouncement = await expectRejected(
      db,
      IDS.user1,
      `DELETE FROM public.announcements WHERE id = $1`,
      [IDS.annAll]
    );
    const ownerCannotSpoofAnnouncementOwner = await expectRejected(
      db,
      IDS.owner1,
      `INSERT INTO public.announcements (property_id, owner_id, title, message, audience)
       VALUES ($1, $2, 'Spoof', 'Body', 'all')`,
      [IDS.prop1, IDS.owner2]
    );

    // 2. Property wardens & profiles scoping + inactive resident exclusion
    const user1Wardens = await asAuthenticatedUser(db, IDS.user1, () =>
      db.query(`SELECT warden_profile_id FROM public.property_wardens`)
    );
    const user1Profiles = await asAuthenticatedUser(db, IDS.user1, () =>
      db.query(`SELECT id FROM public.profiles ORDER BY id`)
    );
    const inactiveResidentProps = await asAuthenticatedUser(db, IDS.userInactive, () =>
      db.query(`SELECT id FROM public.properties`)
    );
    const inactiveResidentWardens = await asAuthenticatedUser(db, IDS.userInactive, () =>
      db.query(`SELECT id FROM public.property_wardens`)
    );

    // 3. Resident write blocks on owner-managed columns
    const residentCannotUpdateUpi = await expectRejected(
      db,
      IDS.user1,
      `UPDATE public.properties SET upi_id = 'hacker@okicici' WHERE id = $1`,
      [IDS.prop1]
    );
    const residentCannotUpdateWifi = await expectRejected(
      db,
      IDS.user1,
      `UPDATE public.properties SET wifi_password = 'pwned' WHERE id = $1`,
      [IDS.prop1]
    );
    const residentCannotUpdateCurfew = await expectRejected(
      db,
      IDS.user1,
      `UPDATE public.properties SET curfew_time = '23:59' WHERE id = $1`,
      [IDS.prop1]
    );
    const residentCannotUpdateMealTime = await expectRejected(
      db,
      IDS.user1,
      `UPDATE public.food_menus SET meal_time = '23:00' WHERE id = $1`,
      [IDS.menu1]
    );
    const residentCannotUpdateRent = await expectRejected(
      db,
      IDS.user1,
      `UPDATE public.residents SET monthly_rent_paise = 0 WHERE id = $1`,
      [IDS.res1]
    );

    // 4. set_my_emergency_contact RPC
    await asAuthenticatedUser(db, IDS.user1, () =>
      db.query(`SELECT public.set_my_emergency_contact($1)`, ['  Parent 9123456789  '])
    );
    const tooLongEmergencyRejected = await expectRejected(
      db,
      IDS.user1,
      `SELECT public.set_my_emergency_contact($1)`,
      ['x'.repeat(121)]
    );
    const emergencyContactsAfter = await db.query(
      `SELECT id, emergency_contact, monthly_rent_paise FROM public.residents ORDER BY id`
    );
    const res1Row = emergencyContactsAfter.rows.find((r) => r.id === IDS.res1);
    const res2Row = emergencyContactsAfter.rows.find((r) => r.id === IDS.res2);

    // 5. Washing machine single active session + release authorization
    const startM1 = (
      await asAuthenticatedUser(db, IDS.user1, () =>
        db.query(`SELECT public.start_washing_machine_unit($1, $2) AS res`, [IDS.prop1, IDS.m1])
      )
    ).rows[0].res;

    const startM2SameResident = (
      await asAuthenticatedUser(db, IDS.user1, () =>
        db.query(`SELECT public.start_washing_machine_unit($1, $2) AS res`, [IDS.prop1, IDS.m2])
      )
    ).rows[0].res;

    const startLegacySameResident = (
      await asAuthenticatedUser(db, IDS.user1, () =>
        db.query(`SELECT public.start_washing_machine($1) AS res`, [IDS.prop1])
      )
    ).rows[0].res;

    const otherResidentRelease = (
      await asAuthenticatedUser(db, IDS.user2, () =>
        db.query(`SELECT public.release_washing_machine_unit($1, $2) AS res`, [IDS.prop1, IDS.m1])
      )
    ).rows[0].res;

    const outsiderRelease = (
      await asAuthenticatedUser(db, IDS.user3, () =>
        db.query(`SELECT public.release_washing_machine_unit($1, $2) AS res`, [IDS.prop1, IDS.m1])
      )
    ).rows[0].res;

    const ownerReleaseM1 = (
      await asAuthenticatedUser(db, IDS.owner1, () =>
        db.query(`SELECT public.release_washing_machine_unit($1, $2) AS res`, [IDS.prop1, IDS.m1])
      )
    ).rows[0].res;

    const startM2AfterRelease = (
      await asAuthenticatedUser(db, IDS.user1, () =>
        db.query(`SELECT public.start_washing_machine_unit($1, $2) AS res`, [IDS.prop1, IDS.m2])
      )
    ).rows[0].res;

    const ownReleaseM2 = (
      await asAuthenticatedUser(db, IDS.user1, () =>
        db.query(`SELECT public.release_washing_machine_unit($1, NULL) AS res`, [IDS.prop1])
      )
    ).rows[0].res;

    // --- Phase 1 & 2 RLS: property_expenses & bed_reservations ---
    const owner1InsertedExpense = await asAuthenticatedUser(db, IDS.owner1, async () => {
      const r = await db.query(
        `INSERT INTO public.property_expenses (property_id, category, amount_paise, notes, created_by)
         VALUES ($1, 'salary', 800000, 'Cook salary', $2) RETURNING id`,
        [IDS.prop1, IDS.owner1]
      );
      return r.rows.length === 1;
    });

    const owner2VisibleExpenses = await asAuthenticatedUser(db, IDS.owner2, () =>
      db.query(`SELECT id FROM public.property_expenses`)
    );
    const residentVisibleExpenses = await asAuthenticatedUser(db, IDS.user1, () =>
      db.query(`SELECT id FROM public.property_expenses`)
    );
    let owner2CannotInsertProp1Expense = false;
    try {
      await asAuthenticatedUser(db, IDS.owner2, () =>
        db.query(
          `INSERT INTO public.property_expenses (property_id, category, amount_paise)
           VALUES ($1, 'water', 50000)`,
          [IDS.prop1]
        )
      );
    } catch {
      owner2CannotInsertProp1Expense = true;
    }

    const owner1InsertedReservation = await asAuthenticatedUser(db, IDS.owner1, async () => {
      const r = await db.query(
        `INSERT INTO public.bed_reservations (property_id, room_number, bed_label, prospect_name, phone_number, expected_join_date, token_advance_paise, created_by)
         VALUES ($1, '101', 'Bed 2', 'Karthik', '9876543210', '2026-12-01', 100000, $2) RETURNING id`,
        [IDS.prop1, IDS.owner1]
      );
      return r.rows.length === 1;
    });

    let duplicateBedReservationBlocked = false;
    try {
      await asAuthenticatedUser(db, IDS.owner1, () =>
        db.query(
          `INSERT INTO public.bed_reservations (property_id, room_number, bed_label, prospect_name, phone_number, expected_join_date)
           VALUES ($1, '101', 'bed 2', 'Other', '9876543211', '2026-12-02')`,
          [IDS.prop1]
        )
      );
    } catch {
      duplicateBedReservationBlocked = true;
    }

    const owner2VisibleReservations = await asAuthenticatedUser(db, IDS.owner2, () =>
      db.query(`SELECT id FROM public.bed_reservations`)
    );
    const residentVisibleReservations = await asAuthenticatedUser(db, IDS.user1, () =>
      db.query(`SELECT id FROM public.bed_reservations`)
    );
    let owner2CannotInsertProp1Reservation = false;
    try {
      await asAuthenticatedUser(db, IDS.owner2, () =>
        db.query(
          `INSERT INTO public.bed_reservations (property_id, room_number, bed_label, prospect_name, phone_number, expected_join_date)
           VALUES ($1, '102', 'Bed 1', 'Intruder', '9876500000', '2026-12-01')`,
          [IDS.prop1]
        )
      );
    } catch {
      owner2CannotInsertProp1Reservation = true;
    }

    // --- Migration 37 RLS: Warden 1 can read Owner 1 phone, NOT Owner 2 ---
    await db.query(`UPDATE public.profiles SET phone_number = '9876543210' WHERE id = $1`, [IDS.owner1]);
    await db.query(`UPDATE public.profiles SET phone_number = '9999999999' WHERE id = $1`, [IDS.owner2]);
    const warden1OwnerProfiles = await asAuthenticatedUser(db, IDS.warden1, () =>
      db.query(`SELECT id, phone_number FROM public.profiles WHERE id IN ($1, $2) ORDER BY id`, [
        IDS.owner1,
        IDS.owner2,
      ])
    );
    const warden1CanSeeOwner1Phone =
      warden1OwnerProfiles.rows.length === 1 &&
      warden1OwnerProfiles.rows[0].id === IDS.owner1 &&
      warden1OwnerProfiles.rows[0].phone_number === '9876543210';

    // --- Migration 38: Multi-Day Home Visit / Vacation Leave ---
    const leaveOutRes = await asAuthenticatedUser(db, IDS.user1, async () => {
      const r = await db.query(
        `SELECT public.record_student_movement('OUT', 'Semester Break', 'Returns 5 Dec', true, NULL, '2026-12-05'::date) AS res`
      );
      return r.rows[0].res;
    });
    const leaveForcesFoodFalse =
      leaveOutRes?.success === true &&
      leaveOutRes?.food_required === false &&
      leaveOutRes?.expected_return_date === '2026-12-05';

    const audienceWhileOnLeave = await asAuthenticatedUser(db, IDS.warden1, () =>
      db.query(`SELECT resident_id FROM public.get_alert_audience($1)`, [IDS.prop1])
    );
    const onLeaveExcludedFromAudience = !audienceWhileOnLeave.rows.some(
      (r) => r.resident_id === IDS.res1
    );

    const leaveInRes = await asAuthenticatedUser(db, IDS.user1, async () => {
      const r = await db.query(`SELECT public.record_student_movement('IN') AS res`);
      return r.rows[0].res;
    });
    const checkInClearsLeave =
      leaveInRes?.success === true && leaveInRes?.expected_return_date === null;

    const audienceAfterReturn = await asAuthenticatedUser(db, IDS.warden1, () =>
      db.query(`SELECT resident_id FROM public.get_alert_audience($1)`, [IDS.prop1])
    );
    const returnedRestoredToAudience = audienceAfterReturn.rows.some(
      (r) => r.resident_id === IDS.res1
    );

    // --- Migration 40: Room AC (+₹500) & Owner Bill Reversal / Cancel ---
    await db.query(
      `INSERT INTO public.rooms (property_id, room_number, total_beds, gender_type, is_ac)
       VALUES ($1, '101', 2, 'coed', true), ($1, 'D', 2, 'coed', false)
       ON CONFLICT (property_id, room_number) DO UPDATE SET is_ac = EXCLUDED.is_ac`,
      [IDS.prop1]
    );

    await asAuthenticatedUser(db, IDS.owner1, () =>
      db.query(
        `SELECT public.generate_monthly_bills($1, '2026-12-01'::date, 800000)`,
        [IDS.prop1]
      )
    );

    const acChargesRes = await db.query(
      `SELECT id, resident_id, rent_amount_paise, wm_amount_paise, ac_amount_paise, amount_paise, status
       FROM public.charges
       WHERE property_id = $1 AND billing_period_start = '2026-12-01'::date AND category = 'rent'
       ORDER BY resident_id`,
      [IDS.prop1]
    );
    const res1Chg = acChargesRes.rows.find((c) => c.resident_id === IDS.res1); // Room D (Non-AC)
    const res2Chg = acChargesRes.rows.find((c) => c.resident_id === IDS.res2); // Room 101 (AC)
    const acFeeAppliedCorrectly =
      Number(res2Chg?.ac_amount_paise) === 50000 &&
      Number(res2Chg?.amount_paise) === 800000 + 50000 + 50000 &&
      Number(res1Chg?.ac_amount_paise) === 0 &&
      Number(res1Chg?.amount_paise) === 800000 + 50000;

    // Confirm payment on res2Chg, verify cancel is blocked while paid, then reverse payment
    await asAuthenticatedUser(db, IDS.owner1, () =>
      db.query(
        `SELECT public.confirm_monthly_payment($1, NULL, 'cash')`,
        [res2Chg.id]
      )
    );
    const cancelPaidBlockedRes = await asAuthenticatedUser(db, IDS.owner1, async () => {
      const r = await db.query(
        `SELECT public.cancel_unpaid_charge($1, 'Mistake') AS res`,
        [res2Chg.id]
      );
      return r.rows[0].res;
    });
    const cancelPaidBlocked = cancelPaidBlockedRes?.success === false;

    const reverseRes = await asAuthenticatedUser(db, IDS.owner1, async () => {
      const r = await db.query(
        `SELECT public.reverse_charge_payments($1, 'Wrong resident') AS res`,
        [res2Chg.id]
      );
      return r.rows[0].res;
    });
    const afterReverseChg = await db.query(
      `SELECT status FROM public.charges WHERE id = $1`,
      [res2Chg.id]
    );
    const paymentReversedAndReopened =
      reverseRes?.success === true && afterReverseChg.rows[0]?.status === 'outstanding';

    // Now cancel unpaid res1Chg
    const cancelUnpaidRes = await asAuthenticatedUser(db, IDS.owner1, async () => {
      const r = await db.query(
        `SELECT public.cancel_unpaid_charge($1, 'Generated by mistake') AS res`,
        [res1Chg.id]
      );
      return r.rows[0].res;
    });
    const afterCancelChg = await db.query(
      `SELECT status FROM public.charges WHERE id = $1`,
      [res1Chg.id]
    );
    const unpaidBillCancelled =
      cancelUnpaidRes?.success === true && afterCancelChg.rows[0]?.status === 'cancelled';

    return {
      user1AnnouncementIds: user1Announcements.rows.map((r) => r.id),
      user2AnnouncementIds: user2Announcements.rows.map((r) => r.id),
      expectedAnnouncements: {
        user1: [IDS.annAll, IDS.annRoomD],
        user2: [IDS.annAll, IDS.annRoom101],
      },
      residentCannotInsertAnnouncement,
      residentCannotUpdateAnnouncement,
      residentCannotDeleteAnnouncement,
      ownerCannotSpoofAnnouncementOwner,
      user1WardenIds: user1Wardens.rows.map((r) => r.warden_profile_id),
      expectedWarden1Id: IDS.warden1,
      user1VisibleProfileIds: user1Profiles.rows.map((r) => r.id),
      expectedUser1Profiles: [IDS.owner1, IDS.warden1, IDS.user1],
      inactiveResidentPropCount: inactiveResidentProps.rows.length,
      inactiveResidentWardenCount: inactiveResidentWardens.rows.length,
      residentCannotUpdateUpi,
      residentCannotUpdateWifi,
      residentCannotUpdateCurfew,
      residentCannotUpdateMealTime,
      residentCannotUpdateRent,
      res1EmergencyContact: res1Row?.emergency_contact ?? null,
      res1RentUnchanged: Number(res1Row?.monthly_rent_paise) === 800000,
      res2EmergencyContact: res2Row?.emergency_contact ?? null,
      tooLongEmergencyRejected,
      wm: {
        startM1Success: startM1.success,
        startM2RejectedCode: startM2SameResident.code ?? null,
        startM2Success: startM2SameResident.success,
        startLegacyRejectedCode: startLegacySameResident.code ?? null,
        startLegacySuccess: startLegacySameResident.success,
        otherResidentReleaseSuccess: otherResidentRelease.success,
        outsiderReleaseSuccess: outsiderRelease.success,
        ownerReleaseM1Success: ownerReleaseM1.success,
        startM2AfterReleaseSuccess: startM2AfterRelease.success,
        ownReleaseM2Success: ownReleaseM2.success,
      },
      phase12Rls: {
        owner1InsertedExpense,
        owner2VisibleExpenseCount: owner2VisibleExpenses.rows.length,
        residentVisibleExpenseCount: residentVisibleExpenses.rows.length,
        owner2CannotInsertProp1Expense,
        owner1InsertedReservation,
        duplicateBedReservationBlocked,
        owner2VisibleReservationCount: owner2VisibleReservations.rows.length,
        residentVisibleReservationCount: residentVisibleReservations.rows.length,
        owner2CannotInsertProp1Reservation,
        warden1CanSeeOwner1Phone,
        leaveForcesFoodFalse,
        onLeaveExcludedFromAudience,
        checkInClearsLeave,
        returnedRestoredToAudience,
        acFeeAppliedCorrectly,
        cancelPaidBlocked,
        paymentReversedAndReopened,
        unpaidBillCancelled,
      },
    };
  } finally {
    await db.close();
  }
}

async function main() {
  const [ledger, rls] = await Promise.all([
    runLedgerInvariants(),
    runRealMigrationRlsTests(),
  ]);
  console.log(JSON.stringify({ ...ledger, rls }));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
