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
  rls: {
    user1AnnouncementIds: string[];
    user2AnnouncementIds: string[];
    expectedAnnouncements: {
      user1: string[];
      user2: string[];
    };
    residentCannotInsertAnnouncement: boolean;
    residentCannotUpdateAnnouncement: boolean;
    residentCannotDeleteAnnouncement: boolean;
    ownerCannotSpoofAnnouncementOwner: boolean;
    user1WardenIds: string[];
    expectedWarden1Id: string;
    user1VisibleProfileIds: string[];
    expectedUser1Profiles: string[];
    inactiveResidentPropCount: number;
    inactiveResidentWardenCount: number;
    residentCannotUpdateUpi: boolean;
    residentCannotUpdateWifi: boolean;
    residentCannotUpdateCurfew: boolean;
    residentCannotUpdateMealTime: boolean;
    residentCannotUpdateRent: boolean;
    res1EmergencyContact: string | null;
    res1RentUnchanged: boolean;
    res2EmergencyContact: string | null;
    tooLongEmergencyRejected: boolean;
    wm: {
      startM1Success: boolean;
      startM2RejectedCode: string | null;
      startM2Success: boolean;
      startLegacyRejectedCode: string | null;
      startLegacySuccess: boolean;
      otherResidentReleaseSuccess: boolean;
      outsiderReleaseSuccess: boolean;
      ownerReleaseM1Success: boolean;
      startM2AfterReleaseSuccess: boolean;
      ownReleaseM2Success: boolean;
    };
    phase12Rls: {
      owner1InsertedExpense: boolean;
      owner2VisibleExpenseCount: number;
      residentVisibleExpenseCount: number;
      owner2CannotInsertProp1Expense: boolean;
      owner1InsertedReservation: boolean;
      duplicateBedReservationBlocked: boolean;
      owner2VisibleReservationCount: number;
      residentVisibleReservationCount: number;
      owner2CannotInsertProp1Reservation: boolean;
      warden1CanSeeOwner1Phone: boolean;
      leaveForcesFoodFalse: boolean;
      onLeaveExcludedFromAudience: boolean;
      checkInClearsLeave: boolean;
      returnedRestoredToAudience: boolean;
      acFeeAppliedCorrectly: boolean;
      cancelPaidBlocked: boolean;
      paymentReversedAndReopened: boolean;
      unpaidBillCancelled: boolean;
    };
  };
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

  it('scopes announcements SELECT by property and normalized room, and blocks resident writes', () => {
    expect(result.rls.user1AnnouncementIds).toEqual(
      result.rls.expectedAnnouncements.user1
    );
    expect(result.rls.user2AnnouncementIds).toEqual(
      result.rls.expectedAnnouncements.user2
    );
    expect(result.rls.residentCannotInsertAnnouncement).toBe(true);
    expect(result.rls.residentCannotUpdateAnnouncement).toBe(true);
    expect(result.rls.residentCannotDeleteAnnouncement).toBe(true);
    expect(result.rls.ownerCannotSpoofAnnouncementOwner).toBe(true);
  });

  it('scopes property_wardens, profiles, and properties exclusively to active residents', () => {
    expect(result.rls.user1WardenIds).toEqual([result.rls.expectedWarden1Id]);
    expect(result.rls.user1VisibleProfileIds).toEqual(
      result.rls.expectedUser1Profiles
    );
    expect(result.rls.inactiveResidentPropCount).toBe(0);
    expect(result.rls.inactiveResidentWardenCount).toBe(0);
  });

  it('blocks residents from mutating properties.upi_id, wifi_password, curfew_time, food_menus.meal_time, or rent', () => {
    expect(result.rls.residentCannotUpdateUpi).toBe(true);
    expect(result.rls.residentCannotUpdateWifi).toBe(true);
    expect(result.rls.residentCannotUpdateCurfew).toBe(true);
    expect(result.rls.residentCannotUpdateMealTime).toBe(true);
    expect(result.rls.residentCannotUpdateRent).toBe(true);
  });

  it('updates only caller active emergency_contact via set_my_emergency_contact RPC', () => {
    expect(result.rls.res1EmergencyContact).toBe('Parent 9123456789');
    expect(result.rls.res1RentUnchanged).toBe(true);
    expect(result.rls.res2EmergencyContact).toBeNull();
    expect(result.rls.tooLongEmergencyRejected).toBe(true);
  });

  it('enforces single active washing machine per resident and strict release authorization', () => {
    expect(result.rls.wm).toEqual({
      startM1Success: true,
      startM2RejectedCode: 'WM_RESIDENT_ACTIVE_SESSION',
      startM2Success: false,
      startLegacyRejectedCode: 'WM_RESIDENT_ACTIVE_SESSION',
      startLegacySuccess: false,
      otherResidentReleaseSuccess: false,
      outsiderReleaseSuccess: false,
      ownerReleaseM1Success: true,
      startM2AfterReleaseSuccess: true,
      ownReleaseM2Success: true,
    });
  });

  it('enforces owner-only RLS isolation on property_expenses and bed_reservations plus unique active slot booking', () => {
    expect(result.rls.phase12Rls).toEqual({
      owner1InsertedExpense: true,
      owner2VisibleExpenseCount: 0,
      residentVisibleExpenseCount: 0,
      owner2CannotInsertProp1Expense: true,
      owner1InsertedReservation: true,
      duplicateBedReservationBlocked: true,
      owner2VisibleReservationCount: 0,
      residentVisibleReservationCount: 0,
      owner2CannotInsertProp1Reservation: true,
      warden1CanSeeOwner1Phone: true,
      leaveForcesFoodFalse: true,
      onLeaveExcludedFromAudience: true,
      checkInClearsLeave: true,
      returnedRestoredToAudience: true,
      acFeeAppliedCorrectly: true,
      cancelPaidBlocked: true,
      paymentReversedAndReopened: true,
      unpaidBillCancelled: true,
    });
  });
});
