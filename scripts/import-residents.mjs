#!/usr/bin/env node
/**
 * PGwala Bulk Resident CSV Onboarding Script
 *
 * Usage:
 *   1. Dry-run validation (no DB writes):
 *      node scripts/import-residents.mjs --dry-run scripts/residents-template.csv
 *
 *   2. Live import via your deployed `create-resident` Edge Function:
 *      EXPO_PUBLIC_SUPABASE_URL=... EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=... \
 *      OWNER_EMAIL=owner@example.com OWNER_PASSWORD=... PROPERTY_ID=<uuid> \
 *      node scripts/import-residents.mjs path/to/residents.csv
 *
 * Writes a credentials summary CSV next to the input file on live import.
 */
import fs from 'node:fs';
import path from 'node:path';

const REQUIRED_COLUMNS = ['full_name', 'phone_number', 'room_number', 'gender'];
const VALID_GENDERS = new Set(['male', 'female', 'other']);

function parseCsvLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      fields.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

function parseCsvFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    throw new Error('CSV must include a header row and at least 1 resident row.');
  }
  const headers = parseCsvLine(lines[0]).map((h) => h.toLowerCase());
  for (const col of REQUIRED_COLUMNS) {
    if (!headers.includes(col)) {
      throw new Error(`Missing required CSV column: "${col}"`);
    }
  }

  return lines.slice(1).map((line, idx) => {
    const values = parseCsvLine(line);
    const row = {};
    headers.forEach((h, i) => {
      row[h] = values[i] ?? '';
    });
    return { lineNumber: idx + 2, row };
  });
}

function normalizePhone10(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  return digits;
}

function generateTempPassword(phone10) {
  const tail = phone10.slice(-4) || '1234';
  return `Pg@${tail}26`;
}

function validateRows(entries) {
  const errors = [];
  const seenPhones = new Set();
  const seenEmails = new Set();
  const seenRoomBeds = new Set();
  const normalized = [];

  for (const { lineNumber, row } of entries) {
    const fullName = (row.full_name || '').trim();
    const phone10 = normalizePhone10(row.phone_number);
    const roomNumber = (row.room_number || '').trim();
    const bedLabel = (row.bed_label || '').trim();
    const gender = (row.gender || '').trim().toLowerCase();
    const monthlyRentRupees = Number(row.monthly_rent_rupees || 0);
    const depositRupees = Number(row.deposit_rupees || 0);
    const joiningDate =
      (row.joining_date || '').trim() || new Date().toISOString().slice(0, 10);
    const email = (
      (row.email || '').trim() || `${phone10 || `res${lineNumber}`}@pgwala.local`
    ).toLowerCase();
    const tempPassword =
      (row.temporary_password || '').trim() || generateTempPassword(phone10);

    if (!fullName) errors.push(`Line ${lineNumber}: full_name is required.`);
    if (phone10.length !== 10) {
      errors.push(`Line ${lineNumber}: invalid 10-digit phone "${row.phone_number}".`);
    } else if (seenPhones.has(phone10)) {
      errors.push(`Line ${lineNumber}: duplicate phone "${phone10}" in CSV.`);
    } else {
      seenPhones.add(phone10);
    }

    if (!roomNumber) errors.push(`Line ${lineNumber}: room_number is required.`);
    if (!VALID_GENDERS.has(gender)) {
      errors.push(`Line ${lineNumber}: gender must be male, female, or other.`);
    }
    if (!Number.isFinite(monthlyRentRupees) || monthlyRentRupees < 0) {
      errors.push(`Line ${lineNumber}: invalid monthly_rent_rupees.`);
    }
    if (!Number.isFinite(depositRupees) || depositRupees < 0) {
      errors.push(`Line ${lineNumber}: invalid deposit_rupees.`);
    }
    if (seenEmails.has(email)) {
      errors.push(`Line ${lineNumber}: duplicate email "${email}" in CSV.`);
    } else {
      seenEmails.add(email);
    }
    if (roomNumber && bedLabel) {
      const rbKey = `${roomNumber.toLowerCase()}::${bedLabel.toLowerCase()}`;
      if (seenRoomBeds.has(rbKey)) {
        errors.push(`Line ${lineNumber}: duplicate Room/Bed "${roomNumber} / ${bedLabel}".`);
      } else {
        seenRoomBeds.add(rbKey);
      }
    }

    normalized.push({
      lineNumber,
      full_name: fullName,
      phone_number: phone10,
      room_number: roomNumber,
      bed_label: bedLabel || undefined,
      gender,
      monthly_rent_paise: Math.round(monthlyRentRupees * 100),
      deposit_paise: Math.round(depositRupees * 100),
      joining_date: joiningDate,
      email,
      temporary_password: tempPassword,
    });
  }

  return { normalized, errors };
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const csvPath = args.find((a) => !a.startsWith('--'));

  if (!csvPath) {
    console.error('Usage: node scripts/import-residents.mjs [--dry-run] <residents.csv>');
    process.exit(1);
  }

  const resolvedPath = path.resolve(csvPath);
  const entries = parseCsvFile(resolvedPath);
  const { normalized, errors } = validateRows(entries);

  if (errors.length > 0) {
    console.error(`Validation failed with ${errors.length} error(s):`);
    for (const err of errors) console.error(`  - ${err}`);
    process.exit(1);
  }

  console.log(`Validated ${normalized.length} resident row(s) from ${path.basename(resolvedPath)}.`);

  if (dryRun) {
    console.log('[DRY RUN] All rows look valid. No accounts were created.');
    for (const r of normalized) {
      console.log(
        `  • ${r.full_name} | Room ${r.room_number}${r.bed_label ? ` (${r.bed_label})` : ''} | ${r.phone_number} | ₹${r.monthly_rent_paise / 100}/mo | ${r.email}`
      );
    }
    return;
  }

  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const ownerEmail = process.env.OWNER_EMAIL;
  const ownerPassword = process.env.OWNER_PASSWORD;
  const propertyId = process.env.PROPERTY_ID;

  if (!supabaseUrl || !supabaseAnonKey || !ownerEmail || !ownerPassword || !propertyId) {
    console.error(
      'Missing env vars for live import. Required: EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY, OWNER_EMAIL, OWNER_PASSWORD, PROPERTY_ID'
    );
    process.exit(1);
  }

  // Sign in as the PG Owner to obtain an authenticated JWT for `create-resident`
  const authRes = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      apikey: supabaseAnonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email: ownerEmail, password: ownerPassword }),
  });

  if (!authRes.ok) {
    const body = await authRes.text();
    console.error(`Owner sign-in failed (${authRes.status}): ${body}`);
    process.exit(1);
  }

  const authJson = await authRes.json();
  const accessToken = authJson.access_token;
  const results = [];

  for (const resident of normalized) {
    const res = await fetch(`${supabaseUrl}/functions/v1/create-resident`, {
      method: 'POST',
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        property_id: propertyId,
        full_name: resident.full_name,
        phone_number: resident.phone_number,
        room_number: resident.room_number,
        bed_label: resident.bed_label,
        gender: resident.gender,
        monthly_rent_paise: resident.monthly_rent_paise,
        deposit_paise: resident.deposit_paise,
        joining_date: resident.joining_date,
        email: resident.email,
        temporary_password: resident.temporary_password,
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (res.ok && data?.success) {
      console.log(`  [OK] ${resident.full_name} (Room ${resident.room_number})`);
      results.push({ ...resident, status: 'CREATED', error: '' });
    } else {
      const errMsg = data?.error || `HTTP ${res.status}`;
      console.error(`  [FAIL] ${resident.full_name}: ${errMsg}`);
      results.push({ ...resident, status: 'FAILED', error: errMsg });
    }
  }

  const outPath = resolvedPath.replace(/\.csv$/i, '') + '-credentials-output.csv';
  const outLines = [
    'full_name,room_number,bed_label,phone_number,email,temporary_password,status,error',
    ...results.map((r) =>
      [
        r.full_name,
        r.room_number,
        r.bed_label ?? '',
        r.phone_number,
        r.email,
        r.temporary_password,
        r.status,
        r.error,
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(',')
    ),
  ];
  fs.writeFileSync(outPath, outLines.join('\n'), 'utf8');
  console.log(`\nCredentials summary written to: ${outPath}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
