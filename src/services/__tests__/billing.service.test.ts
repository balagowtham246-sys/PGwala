import { resetPerfMonitor } from '@/lib/perf-monitor';
import { clearQueryCache } from '@/lib/query-cache';
import { supabase } from '@/lib/supabase';
import {
  confirmMonthlyPayment,
  extractPaymentProofStoragePath,
  getOwnerBilling,
  getStudentBilling,
  rejectStudentPaymentReport,
  submitStudentPaymentProof,
  withdrawStudentPaymentProof,
} from '../billing.service';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

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

  it('confirms monthly payment and normalizes reject payment report errors', async () => {
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

  it('coalesces concurrent double-tap payment proof submissions for the same chargeId', async () => {
    let resolveRpc: (value: unknown) => void = () => {};
    mockedRpc.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRpc = resolve;
        })
    );

    const p1 = submitStudentPaymentProof({
      residentId: 'res-1',
      chargeId: 'chg-double',
      paymentMethod: 'cash',
    });
    const p2 = submitStudentPaymentProof({
      residentId: 'res-1',
      chargeId: 'chg-double',
      paymentMethod: 'cash',
    });
    resolveRpc({ data: { success: true }, error: null });

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(mockedRpc).toHaveBeenCalledTimes(1);
    expect(r1).toEqual({ ok: true, data: null });
    expect(r2).toEqual({ ok: true, data: null });
  });

  it('uses single-roundtrip get_owner_billing_summary RPC and maps exact OwnerBillingSnapshot shape', async () => {
    mockedRpc.mockResolvedValueOnce({
      data: {
        success: true,
        property: { id: 'prop-1', name: 'Alpha PG' },
        residents: [
          {
            id: 'res-1',
            full_name: 'Asha',
            room_number: '101',
            phone_number: '9999999999',
            monthly_rent_paise: 800000,
            is_active: true,
          },
          {
            id: 'res-2',
            full_name: 'Bala',
            room_number: '102',
            phone_number: '8888888888',
            monthly_rent_paise: 750000,
            is_active: true,
          },
        ],
        opt_ins: [{ resident_id: 'res-1', is_enabled: true }],
        wm_pending_requests: [{ resident_id: 'res-2' }],
        charges: [
          {
            id: 'chg-rent-1',
            resident_id: 'res-1',
            category: 'rent',
            amount_paise: 850000,
            rent_amount_paise: 800000,
            wm_amount_paise: 50000,
            status: 'settled',
            due_date: '2026-11-05',
          },
          {
            id: 'chg-eb-2',
            resident_id: 'res-2',
            category: 'electricity',
            amount_paise: 120000,
            rent_amount_paise: 0,
            wm_amount_paise: 0,
            status: 'outstanding',
            due_date: '2026-11-10',
          },
        ],
        reports: [
          {
            id: 'rep-eb-2',
            resident_id: 'res-2',
            charge_id: 'chg-eb-2',
            amount_paise: 120000,
            claimed_method: 'upi',
            payment_date: '2026-11-06',
            reference_number: 'UTR-EB-1',
            screenshot_url: 'res-2/eb.jpg',
            notes: null,
            status: 'pending',
            rejection_reason: null,
          },
        ],
        payment_allocations: [
          {
            charge_id: 'chg-rent-1',
            payment: {
              id: 'pay-1',
              receipt_number: 'RCPT-101',
              payment_date: '2026-11-04',
              method: 'upi',
            },
          },
        ],
      },
      error: null,
    });

    const res = await getOwnerBilling({
      userId: 'owner-1',
      selectedPropertyId: 'prop-1',
      selectedPropertyName: 'Alpha PG',
      monthIsoStart: '2026-11-01',
    });

    expect(mockedFrom).not.toHaveBeenCalled();
    expect(mockedRpc).toHaveBeenCalledWith('get_owner_billing_summary', {
      p_property_id: 'prop-1',
      p_billing_month: '2026-11-01',
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.propertyId).toBe('prop-1');
      expect(res.data.propertyName).toBe('Alpha PG');
      expect(res.data.availableRooms).toEqual(['101', '102']);
      expect(res.data.allResidents).toHaveLength(2);
      expect(res.data.rentBills[0]).toMatchObject({
        resident_id: 'res-1',
        opt_in_wm: true,
        status: 'paid',
        receipt_number: 'RCPT-101',
        paid_date: '2026-11-04',
        paid_method: 'upi',
        due_date: '2026-11-05',
      });
      expect(res.data.rentBills[1]).toMatchObject({
        resident_id: 'res-2',
        wm_request_pending: true,
        status: 'not_generated',
        charge_id: null,
      });
      expect(res.data.ebBills[1]).toMatchObject({
        resident_id: 'res-2',
        charge_id: 'chg-eb-2',
        amount_paise: 120000,
        status: 'unpaid',
        has_pending_report: true,
        due_date: '2026-11-10',
      });
      expect(res.data.ebBills[1].pending_report?.id).toBe('rep-eb-2');
    }
  });

  it('uses single-roundtrip get_student_billing_summary RPC and maps exact StudentBillingSnapshot shape', async () => {
    mockedRpc.mockResolvedValueOnce({
      data: {
        success: true,
        resident: {
          id: 'res-1',
          property_id: 'prop-1',
          full_name: 'Asha',
          room_number: '101',
          property_name: 'Alpha PG',
          owner_upi_id: 'owner@oksbi',
          owner_upi_payee_name: 'Alpha Residency',
        },
        charges: [
          {
            id: 'chg-rent-nov',
            resident_id: 'res-1',
            category: 'rent',
            amount_paise: 850000,
            rent_amount_paise: 800000,
            wm_amount_paise: 50000,
            status: 'outstanding',
            billing_period_start: '2026-11-01',
            due_date: '2026-11-05',
          },
          {
            id: 'chg-eb-nov',
            resident_id: 'res-1',
            category: 'electricity',
            amount_paise: 90000,
            rent_amount_paise: 0,
            wm_amount_paise: 0,
            status: 'outstanding',
            billing_period_start: '2026-11-01',
            due_date: '2026-11-10',
          },
          {
            id: 'chg-rent-oct',
            resident_id: 'res-1',
            category: 'rent',
            amount_paise: 800000,
            rent_amount_paise: 800000,
            wm_amount_paise: 0,
            status: 'settled',
            billing_period_start: '2026-10-01',
            due_date: '2026-10-05',
          },
        ],
        reports: [
          {
            id: 'rep-nov',
            charge_id: 'chg-rent-nov',
            amount_paise: 850000,
            claimed_method: 'upi',
            reference_number: 'UTR-NOV-1',
            screenshot_url: 'res-1/nov.jpg',
            notes: 'Paid',
            status: 'pending',
            rejection_reason: null,
            created_at: '2026-11-02T10:00:00Z',
          },
        ],
        payment_allocations: [
          {
            charge_id: 'chg-rent-oct',
            payment: {
              id: 'pay-oct',
              receipt_number: 'RCPT-100',
              payment_date: '2026-10-04',
              method: 'upi',
            },
          },
        ],
      },
      error: null,
    });

    const res = await getStudentBilling('user-1');

    expect(mockedFrom).not.toHaveBeenCalled();
    expect(mockedRpc).toHaveBeenCalledWith('get_student_billing_summary', {
      p_resident_id: null,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data).toMatchObject({
        residentId: 'res-1',
        residentName: 'Asha',
        roomNumber: '101',
        propertyName: 'Alpha PG',
        ownerUpiId: 'owner@oksbi',
        ownerUpiPayeeName: 'Alpha Residency',
      });
      expect(res.data.currentRentBill).toMatchObject({
        charge_id: 'chg-rent-nov',
        rent_paise: 800000,
        wm_paise: 50000,
        total_paise: 850000,
        status: 'unpaid',
      });
      expect(res.data.currentRentBill?.pending_report?.id).toBe('rep-nov');
      expect(res.data.currentEbBill?.charge_id).toBe('chg-eb-nov');
      expect(res.data.pastBills).toHaveLength(1);
      expect(res.data.pastBills[0]).toMatchObject({
        charge_id: 'chg-rent-oct',
        status: 'paid',
        receipt_number: 'RCPT-100',
        payment_id: 'pay-oct',
        paid_date: '2026-10-04',
        paid_method: 'upi',
      });
    }
  });

  it('deletes rejected payment proof screenshot from payment-proofs storage bucket', async () => {
    const remove = jest.fn().mockResolvedValue({ data: [], error: null });
    mockedStorageFrom.mockReturnValue({ remove });
    mockedRpc.mockResolvedValueOnce({
      data: {
        success: true,
        screenshot_url: 'res-1/1700000000_proof.jpg',
      },
      error: null,
    });

    const res = await rejectStudentPaymentReport({
      reportId: 'rep-reject-1',
      rejectionReason: 'Screenshot blurred',
    });

    expect(res).toEqual({ ok: true, data: null });
    expect(mockedStorageFrom).toHaveBeenCalledWith('payment-proofs');
    expect(remove).toHaveBeenCalledWith(['res-1/1700000000_proof.jpg']);
    expect(
      extractPaymentProofStoragePath(
        'https://demo.supabase.co/storage/v1/object/sign/payment-proofs/res-1/proof.jpg?token=abc'
      )
    ).toBe('res-1/proof.jpg');
  });

  it('never mixes Nov EB into Dec Rent, hides cancelled bills, and surfaces all unpaid bills with AC + partial balance', async () => {
    mockedRpc.mockResolvedValueOnce({
      data: {
        success: true,
        resident: {
          id: 'res-1',
          property_id: 'prop-1',
          full_name: 'Balgowtham',
          room_number: 'C',
          property_name: 'Sri Lakshmi PG',
          owner_upi_id: 'rajesh@okaxis',
          owner_upi_payee_name: 'Sri Lakshmi PG',
        },
        charges: [
          {
            id: 'chg-rent-dec',
            resident_id: 'res-1',
            category: 'rent',
            amount_paise: 1000000,
            rent_amount_paise: 900000,
            wm_amount_paise: 50000,
            ac_amount_paise: 50000,
            status: 'outstanding',
            billing_period_start: '2026-12-01',
            due_date: '2026-12-05',
          },
          {
            id: 'chg-rent-dec-cancelled',
            resident_id: 'res-1',
            category: 'rent',
            amount_paise: 950000,
            rent_amount_paise: 900000,
            wm_amount_paise: 50000,
            ac_amount_paise: 0,
            status: 'cancelled',
            billing_period_start: '2026-12-01',
            due_date: '2026-12-05',
          },
          {
            id: 'chg-rent-nov',
            resident_id: 'res-1',
            category: 'rent',
            amount_paise: 1000000,
            rent_amount_paise: 900000,
            wm_amount_paise: 50000,
            ac_amount_paise: 50000,
            status: 'outstanding',
            billing_period_start: '2026-11-01',
            due_date: '2026-11-05',
          },
          {
            id: 'chg-eb-nov',
            resident_id: 'res-1',
            category: 'electricity',
            amount_paise: 10000,
            rent_amount_paise: 0,
            wm_amount_paise: 0,
            ac_amount_paise: 0,
            status: 'outstanding',
            billing_period_start: '2026-11-01',
            due_date: '2026-11-10',
          },
          {
            id: 'chg-rent-oct',
            resident_id: 'res-1',
            category: 'rent',
            amount_paise: 1000000,
            rent_amount_paise: 900000,
            wm_amount_paise: 50000,
            ac_amount_paise: 50000,
            status: 'settled',
            billing_period_start: '2026-10-01',
            due_date: '2026-10-05',
          },
        ],
        reports: [],
        payment_allocations: [
          {
            charge_id: 'chg-rent-nov',
            settled_amount_paise: 400000,
            payment: {
              id: 'pay-nov-part',
              receipt_number: 'RCPT-NOV-1',
              payment_date: '2026-11-03',
              method: 'upi',
            },
          },
          {
            charge_id: 'chg-rent-oct',
            settled_amount_paise: 1000000,
            payment: {
              id: 'pay-oct',
              receipt_number: 'RCPT-OCT-1',
              payment_date: '2026-10-03',
              method: 'upi',
            },
          },
        ],
      },
      error: null,
    });

    const res = await getStudentBilling('user-1');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.currentRentBill?.charge_id).toBe('chg-rent-dec');
      expect(res.data.currentEbBill).toBeNull(); // Nov EB must NOT be paired with Dec Rent
      expect(res.data.unpaidBills.map((b) => b.charge_id)).toEqual([
        'chg-rent-dec',
        'chg-rent-nov',
        'chg-eb-nov',
      ]);
      expect(res.data.unpaidBills[0]).toMatchObject({
        ac_paise: 50000,
        paid_paise: 0,
        remaining_paise: 1000000,
      });
      expect(res.data.unpaidBills[1]).toMatchObject({
        charge_id: 'chg-rent-nov',
        paid_paise: 400000,
        remaining_paise: 600000,
      });
      expect(res.data.pastBills.map((b) => b.charge_id)).toEqual(['chg-rent-oct']);
    }
  });

  it('withdraws pending student payment proof and cleans up storage screenshot', async () => {
    const remove = jest.fn().mockResolvedValue({ data: [], error: null });
    mockedStorageFrom.mockReturnValue({ remove });
    mockedRpc.mockResolvedValueOnce({
      data: {
        success: true,
        screenshot_url: 'res-1/pending_proof.jpg',
        message: 'Payment proof withdrawn.',
      },
      error: null,
    });

    const res = await withdrawStudentPaymentProof({
      reportId: 'rep-pending-1',
    });

    expect(mockedRpc).toHaveBeenCalledWith('withdraw_student_payment_proof', {
      p_report_id: 'rep-pending-1',
    });
    expect(mockedStorageFrom).toHaveBeenCalledWith('payment-proofs');
    expect(remove).toHaveBeenCalledWith(['res-1/pending_proof.jpg']);
    expect(res).toEqual({
      ok: true,
      data: { message: 'Payment proof withdrawn.' },
    });
  });
});
