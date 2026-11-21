// Replays supabase/migrations/*.sql in PGlite with minimal Supabase stubs.
import { PGlite } from '@electric-sql/pglite';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve('supabase/migrations');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
const db = new PGlite({ extensions: { uuid_ossp, pgcrypto } });

await db.exec(`
  DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE service_role NOLOGIN BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  CREATE SCHEMA IF NOT EXISTS auth;
  CREATE SCHEMA IF NOT EXISTS extensions;
  CREATE TABLE IF NOT EXISTS auth.users (id UUID PRIMARY KEY, email TEXT, phone TEXT,
    raw_user_meta_data JSONB DEFAULT '{}'::jsonb, raw_app_meta_data JSONB DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ DEFAULT now());
  CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS
    $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  CREATE OR REPLACE FUNCTION auth.role() RETURNS TEXT LANGUAGE sql STABLE AS
    $$ SELECT current_setting('request.jwt.claim.role', true) $$;
  CREATE OR REPLACE FUNCTION auth.jwt() RETURNS JSONB LANGUAGE sql STABLE AS
    $$ SELECT '{}'::jsonb $$;
  GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;
  CREATE SCHEMA IF NOT EXISTS storage;
  CREATE TABLE IF NOT EXISTS storage.buckets (id TEXT PRIMARY KEY, name TEXT, public BOOLEAN DEFAULT false,
    file_size_limit BIGINT, allowed_mime_types TEXT[], owner UUID, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now());
  CREATE TABLE IF NOT EXISTS storage.objects (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id TEXT, name TEXT,
    owner UUID, metadata JSONB, created_at TIMESTAMPTZ DEFAULT now());
  ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
  CREATE OR REPLACE FUNCTION storage.foldername(name TEXT) RETURNS TEXT[] LANGUAGE sql IMMUTABLE AS
    $$ SELECT string_to_array(name, '/') $$;
  CREATE OR REPLACE FUNCTION storage.filename(name TEXT) RETURNS TEXT LANGUAGE sql IMMUTABLE AS
    $$ SELECT (string_to_array(name, '/'))[array_length(string_to_array(name, '/'), 1)] $$;
  DO $$ BEGIN CREATE PUBLICATION supabase_realtime; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
`);

let failed = 0;
for (const f of files) {
  const sql = fs.readFileSync(path.join(dir, f), 'utf8');
  try {
    await db.exec(sql);
    console.log(`OK   ${f}`);
  } catch (e) {
    failed += 1;
    console.log(`FAIL ${f}: ${e.message}`);
    try { await db.exec('ROLLBACK'); } catch {}
  }
}
// Second pass: idempotency of the two new migrations.
for (const f of files.filter((x) => x >= '20260101000023')) {
  try {
    await db.exec(fs.readFileSync(path.join(dir, f), 'utf8'));
    console.log(`RERUN OK   ${f}`);
  } catch (e) {
    failed += 1;
    console.log(`RERUN FAIL ${f}: ${e.message}`);
    try { await db.exec('ROLLBACK'); } catch {}
  }
}
process.exit(failed ? 1 : 0);
