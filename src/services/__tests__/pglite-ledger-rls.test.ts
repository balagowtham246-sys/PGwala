/**
 * @jest-environment node
 */
/// <reference types="node" />
import { execFileSync } from 'node:child_process';
import path from 'node:path';

interface PgliteSuiteResult {
  duplicateChargeRejected: boolean;
  negativeChargeRejected: boolean;
  owner1ChargeIds: string[];
  owner2ChargeIds: string[];
  res1Allocations: { receipt_number: string; charge_id: string }[];
  res2ReportIds: string[];
}

describe('Postgres ledger & RLS scoping invariants (PGlite)', () => {
  let result: PgliteSuiteResult;

  beforeAll(() => {
    const scriptPath = path.resolve(process.cwd(), 'scripts', 'pglite-ledger-rls.mjs');
    const stdout = execFileSync(process.execPath, [scriptPath], {
      encoding: 'utf8',
      timeout: 30_000,
    });
    result = JSON.parse(stdout.trim()) as PgliteSuiteResult;
  });

  it('enforces uniqueness on (resident_id, category, billing_period_start) and positive amounts', () => {
    expect(result.duplicateChargeRejected).toBe(true);
    expect(result.negativeChargeRejected).toBe(true);
  });

  it('scopes owner queries strictly to properties owned by the caller', () => {
    expect(result.owner1ChargeIds).toEqual(['chg-1', 'chg-2']);
    expect(result.owner2ChargeIds).toEqual(['chg-3']);
  });

  it('scopes resident billing & allocation queries strictly to caller profile_id', () => {
    expect(result.res1Allocations).toEqual([
      { receipt_number: 'RCPT-001', charge_id: 'chg-1' },
    ]);
    expect(result.res2ReportIds).toEqual(['rep-1']);
  });
});
