jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

import { resetPerfMonitor } from '@/lib/perf-monitor';
import { clearQueryCache } from '@/lib/query-cache';
import { supabase } from '@/lib/supabase';
import {
  confirmMonthlyPayment,
  getCachedOwnerBilling,
  getCachedStudentBilling,
  getOwnerBilling,
  getStudentBilling,
  rejectStudentPaymentReport,
  submitStudentPaymentProof,
} from '../billing.service';

jest.mock('@/lib/supabase', () => ({
  decodeBase64ToBytes: jest.fn(() => new Uint8Array([1, 2, 3])),
  getSignedPaymentProofUrl: jest.fn(async (p: string) => `https://signed.example/${p}`),
  supabase: {
    from: jest.fn(),
    rpc: jest.fn(),
    storage: {
      from: jest.fn(),
    },
  },
}));

const mockedFrom = supabase.from as jest.Mock;
const mockedRpc = supabase.rpc as jest.Mock;
const mockedStorageFrom = supabase.storage.from as jest.Mock;

describe('billing.service', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    resetPerfMonitor();
    await clearQueryCache();
  });

  it('fetches owner billing with parallelized queries and caches snapshot for SWR', async () => {
    mockedFrom.mockImplementation((table: string) => {
      if (table === 'residents') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                order: jest.fn().mockResolvedValue({
                  data: [
                    {
                      id: 'res-1',
                      full_name: 'Asha',
                      room_number: '101',
                      phone_number: '9999999999',
                      monthly_rent_paise: 800000,
                      is_active: true,
                    },
                  ],
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      if (table === 'resident_opt_ins') {
        return {
          select: () => ({
            eq: () => ({
              in: jest.fn().mockResolvedValue({
                data: [{ resident_id: 'res-1', is_enabled: true }],
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'washing_machine_requests') {
        return {
          select: () => ({
            eq: () => ({
              eq: jest.fn().mockResolvedValue({ data: [], error: null }),
            }),
          }),
        };
      }
      if (table === 'charges') {
        return {
          select: () => ({
            eq: () => ({
              eq: jest.fn().mockResolvedValue({
                data: [
                  {
                    id: 'chg-1',
                    resident_id: 'res-1',
                    category: 'rent',
                    amount_paise: 850000,
                    rent_amount_paise: 800000,
                    wm_amount_paise: 50000,
                    status: 'settled',
                    due_date: '2026-11-05',
                  },
                ],
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'student_payment_reports') {
        return {
          select: () => ({
            eq: () => ({
              in: () => ({
                order: jest.fn().mockResolvedValue({ data: [], error: null }),
              }),
            }),
          }),
        };
      }
      if (table === 'payment_allocations') {
        return {
          select: () => ({
            in: () => ({
              eq: jest.fn().mockResolvedValue({
                data: [
                  {
                    charge_id: 'chg-1',
                    payment: {
                      id: 'pay-1',
                      receipt_number: 'RCPT-101',
                      payment_date: '2026-11-04',
                      method: 'upi',
                    },
                  },
                ],
                error: null,
              }),
            }),
          }),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    });

    const first = await getOwnerBilling({
      userId: 'owner-1',
      selectedPropertyId: 'prop-1',
      selectedPropertyName: 'Alpha PG',
      monthIsoStart: '2026-11-01',
    });

    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.data.rentBills).toHaveLength(1);
      expect(first.data.rentBills[0].receipt_number).toBe('RCPT-101');
      expect(first.data.rentBills[0].status).toBe('paid');
      expect(first.data.rentBills[0].opt_in_wm).toBe(true);
    }

    const onCachedData = jest.fn();
    await getOwnerBilling(
      {
        userId: 'owner-1',
        selectedPropertyId: 'prop-1',
        selectedPropertyName: 'Alpha PG',
        monthIsoStart: '2026-11-01',
      },
      { onCachedData }
    );
    expect(onCachedData).toHaveBeenCalledTimes(1);
  });

  it('fetches student billing snapshot and invalidates billing cache on confirm/reject', async () => {
    mockedFrom.mockImplementation((table: string) => {
      if (table === 'residents') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: jest.fn().mockResolvedValue({
                  data: {
                    id: 'res-1',
                    full_name: 'Asha',
                    room_number: '101',
                    property: { name: 'Alpha PG' },
                  },
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      if (table === 'charges') {
        return {
          select: () => ({
            eq: () => ({
              in: () => ({
                order: jest.fn().mockResolvedValue({
                  data: [
                    {
                      id: 'chg-rent',
                      category: 'rent',
                      amount_paise: 800000,
                      rent_amount_paise: 800000,
                      wm_amount_paise: 0,
                      status: 'outstanding',
                      billing_period_start: '2026-11-01',
                      due_date: '2026-11-05',
                    },
                  ],
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      if (table === 'student_payment_reports') {
        return {
          select: () => ({
            eq: () => ({
              in: () => ({
                order: jest.fn().mockResolvedValue({ data: [], error: null }),
              }),
            }),
          }),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    });

    const studentRes = await getStudentBilling('user-1');
    expect(studentRes.ok).toBe(true);
    if (studentRes.ok) {
      expect(studentRes.data.currentRentBill?.charge_id).toBe('chg-rent');
    }
    expect(await getCachedStudentBilling('user-1')).not.toBeNull();

    // Confirm payment invalidates billing:* cache
    mockedRpc.mockResolvedValueOnce({
      data: { success: true, receipt_number: 'RCPT-999' },
      error: null,
    });
    const confirmRes = await confirmMonthlyPayment({
      chargeId: 'chg-rent',
      method: 'cash',
    });
    expect(confirmRes).toEqual({
      ok: true,
      data: { receipt_number: 'RCPT-999' },
    });
    expect(await getCachedStudentBilling('user-1')).toBeNull();
    expect(await getCachedOwnerBilling('prop-1', '2026-11-01')).toBeNull();

    // Reject error normalization
    mockedRpc.mockResolvedValueOnce({
      data: { success: false, error: 'Report already processed' },
      error: null,
    });
    const rejectRes = await rejectStudentPaymentReport({
      reportId: 'rep-1',
      rejectionReason: 'Unclear screenshot',
    });
    expect(rejectRes.ok).toBe(false);
    if (!rejectRes.ok) {
      expect(rejectRes.error.message).toBe('Report already processed');
    }
  });

  it('uploads screenshot to payment-proofs storage and submits student payment proof online', async () => {
    const upload = jest.fn().mockResolvedValue({ error: null });
    mockedStorageFrom.mockReturnValue({ upload });
    mockedRpc.mockResolvedValueOnce({ data: { success: true }, error: null });

    const res = await submitStudentPaymentProof({
      residentId: 'res-1',
      chargeId: 'chg-1',
      paymentMethod: 'upi',
      referenceNumber: 'UTR123456',
      screenshot: { uri: 'file:///tmp/proof.png', base64: 'AQID' },
    });

    expect(mockedStorageFrom).toHaveBeenCalledWith('payment-proofs');
    expect(upload).toHaveBeenCalledTimes(1);
    expect(mockedRpc).toHaveBeenCalledWith(
      'submit_student_payment_proof',
      expect.objectContaining({
        p_charge_id: 'chg-1',
        p_claimed_method: 'upi',
        p_reference_number: 'UTR123456',
      })
    );
    expect(res).toEqual({ ok: true, data: null });
  });
});
