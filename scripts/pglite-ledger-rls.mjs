import { PGlite } from '@electric-sql/pglite';

async function main() {
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

    console.log(
      JSON.stringify({
        duplicateChargeRejected,
        negativeChargeRejected,
        owner1ChargeIds: owner1Charges.rows.map((r) => r.id),
        owner2ChargeIds: owner2Charges.rows.map((r) => r.id),
        res1Allocations: res1Allocations.rows,
        res2ReportIds: res2Reports.rows.map((r) => r.id),
      })
    );
  } finally {
    await db.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

