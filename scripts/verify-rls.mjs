#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const out = {};
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eqIndex = line.indexOf('=');
    if (eqIndex <= 0) continue;
    const key = line.slice(0, eqIndex).trim();
    let value = line.slice(eqIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const rootDir = process.cwd();
const envVars = {
  ...loadEnvFile(path.join(rootDir, '.env')),
  ...loadEnvFile(path.join(rootDir, '.env.test')),
  ...process.env,
};

const strictMode = process.argv.includes('--strict');
const supabaseUrl = envVars.SUPABASE_TEST_URL || envVars.EXPO_PUBLIC_SUPABASE_URL;
const supabaseKey =
  envVars.SUPABASE_TEST_PUBLISHABLE_KEY || envVars.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

const REQUIRED_CREDENTIAL_KEYS = [
  'TEST_OWNER_EMAIL',
  'TEST_OWNER_PASSWORD',
  'TEST_OTHER_OWNER_EMAIL',
  'TEST_OTHER_OWNER_PASSWORD',
  'TEST_WARDEN_EMAIL',
  'TEST_WARDEN_PASSWORD',
  'TEST_RESIDENT_EMAIL',
  'TEST_RESIDENT_PASSWORD',
  'TEST_OTHER_RESIDENT_EMAIL',
  'TEST_OTHER_RESIDENT_PASSWORD',
];

const missingKeys = [];
if (!supabaseUrl || supabaseUrl.includes('your-project-ref')) {
  missingKeys.push('SUPABASE_TEST_URL (or EXPO_PUBLIC_SUPABASE_URL)');
}
if (!supabaseKey || supabaseKey.includes('your_key_here')) {
  missingKeys.push('SUPABASE_TEST_PUBLISHABLE_KEY (or EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY)');
}
for (const key of REQUIRED_CREDENTIAL_KEYS) {
  const val = envVars[key];
  if (!val || val === 'replace-me' || val.endsWith('@example.com')) {
    missingKeys.push(key);
  }
}

if (missingKeys.length > 0) {
  console.log('\n[verify-rls] SKIPPED: Real Supabase RLS test credentials are not configured.');
  console.log('Copy `.env.test.example` to `.env.test` and populate these non-prod variables:');
  for (const key of missingKeys) {
    console.log(`  - ${key}`);
  }
  console.log('\nThen re-run: npm run test:rls\n');
  process.exit(strictMode ? 1 : 0);
}

function makeClient() {
  return createClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

async function signInAs(label, email, password) {
  const client = makeClient();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data?.user) {
    throw new Error(`[${label}] signInWithPassword failed: ${error?.message || 'no user'}`);
  }
  return { client, user: data.user };
}

const assertions = [];
function assert(condition, description) {
  if (!condition) {
    assertions.push({ ok: false, description });
    console.error(`  FAIL: ${description}`);
  } else {
    assertions.push({ ok: true, description });
    console.log(`  PASS: ${description}`);
  }
}

async function run() {
  console.log('[verify-rls] Starting live Supabase RLS isolation checks...\n');

  const anon = makeClient();
  const owner = await signInAs('owner', envVars.TEST_OWNER_EMAIL, envVars.TEST_OWNER_PASSWORD);
  const otherOwner = await signInAs(
    'other_owner',
    envVars.TEST_OTHER_OWNER_EMAIL,
    envVars.TEST_OTHER_OWNER_PASSWORD
  );
  const warden = await signInAs('warden', envVars.TEST_WARDEN_EMAIL, envVars.TEST_WARDEN_PASSWORD);
  const resident = await signInAs(
    'resident',
    envVars.TEST_RESIDENT_EMAIL,
    envVars.TEST_RESIDENT_PASSWORD
  );
  const otherResident = await signInAs(
    'other_resident',
    envVars.TEST_OTHER_RESIDENT_EMAIL,
    envVars.TEST_OTHER_RESIDENT_PASSWORD
  );

  // 1. Resolve Owner's primary property & Resident's primary row
  const { data: ownerProps, error: ownerPropErr } = await owner.client
    .from('properties')
    .select('id, owner_id')
    .eq('owner_id', owner.user.id)
    .limit(1);
  assert(!ownerPropErr && ownerProps && ownerProps.length > 0, 'Owner can read own property');
  const ownerPropId = ownerProps?.[0]?.id;

  const { data: resRows, error: resErr } = await resident.client
    .from('residents')
    .select('id, property_id, profile_id')
    .eq('profile_id', resident.user.id)
    .limit(1);
  assert(!resErr && resRows && resRows.length > 0, 'Resident can read own resident record');
  const residentId = resRows?.[0]?.id;

  // 2. Anon client must see 0 private rows
  for (const table of [
    'properties',
    'residents',
    'charges',
    'student_payment_reports',
    'payment_allocations',
    'complaints',
    'movement_logs',
  ]) {
    const { data } = await anon.from(table).select('id').limit(5);
    assert(!data || data.length === 0, `Anon cannot read private table "${table}"`);
  }

  // 3. Cross-tenant owner isolation (otherOwner cannot see owner's property/residents/charges/complaints/logs/menus)
  if (ownerPropId) {
    for (const table of [
      'properties',
      'residents',
      'charges',
      'student_payment_reports',
      'complaints',
      'movement_logs',
      'food_menus',
    ]) {
      const col = table === 'properties' ? 'id' : 'property_id';
      const { data } = await otherOwner.client
        .from(table)
        .select('id')
        .eq(col, ownerPropId)
        .limit(5);
      assert(
        !data || data.length === 0,
        `Other owner gets 0 rows from owner property in "${table}"`
      );
    }
  }

  // 4. Cross-resident isolation & write protection
  if (residentId) {
    for (const table of [
      'charges',
      'student_payment_reports',
      'complaints',
      'movement_logs',
    ]) {
      const { data } = await otherResident.client
        .from(table)
        .select('id')
        .eq('resident_id', residentId)
        .limit(5);
      assert(
        !data || data.length === 0,
        `Other resident gets 0 rows for target resident in "${table}"`
      );
    }

    // Resident cannot update charges directly
    const { data: resCharges } = await resident.client
      .from('charges')
      .select('id, amount_paise')
      .eq('resident_id', residentId)
      .limit(1);
    if (resCharges && resCharges[0]) {
      const { error: updErr, data: updData } = await resident.client
        .from('charges')
        .update({ amount_paise: 1 })
        .eq('id', resCharges[0].id)
        .select('id');
      assert(
        Boolean(updErr) || !updData || updData.length === 0,
        'Resident cannot directly tamper with charges row'
      );
    }
  }

  // 5. Resident cannot mutate food_menus directly
  if (ownerPropId) {
    const { error: menuErr, data: menuData } = await resident.client
      .from('food_menus')
      .insert({
        property_id: ownerPropId,
        menu_date: '2099-01-01',
        meal_type: 'breakfast',
        items: ['RLS probe'],
        is_published: false,
      })
      .select('id');
    assert(
      Boolean(menuErr) || !menuData || menuData.length === 0,
      'Resident cannot insert into food_menus'
    );
  }

  // 6. Warden cannot read another owner's property_wardens or food_alerts outside assigned property
  const { data: wardenAssign } = await warden.client
    .from('property_wardens')
    .select('property_id')
    .eq('warden_id', warden.user.id);
  const wardenPropIds = new Set((wardenAssign || []).map((w) => w.property_id));
  const { data: otherProps } = await otherOwner.client
    .from('properties')
    .select('id')
    .eq('owner_id', otherOwner.user.id)
    .limit(1);
  const otherPropId = otherProps?.[0]?.id;
  if (otherPropId && !wardenPropIds.has(otherPropId)) {
    const { data: leakedAlerts } = await warden.client
      .from('food_alerts')
      .select('id')
      .eq('property_id', otherPropId)
      .limit(5);
    assert(
      !leakedAlerts || leakedAlerts.length === 0,
      'Warden gets 0 food_alerts from unassigned property'
    );
  }

  const failed = assertions.filter((a) => !a.ok);
  console.log(`\n[verify-rls] Completed: ${assertions.length - failed.length}/${assertions.length} passed.`);
  if (failed.length > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('[verify-rls] Fatal error:', err?.message || err);
  process.exit(1);
});

