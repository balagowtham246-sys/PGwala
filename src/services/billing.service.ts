import AsyncStorage from '@react-native-async-storage/async-storage';

import { endTrace, recordRoundTrip, startTrace } from '@/lib/perf-monitor';
import {
  getCached,
  getCachedEntry,
  invalidatePrefix,
  setCached,
} from '@/lib/query-cache';
import {
  fail,
  normalizeAppError,
  ok,
  ServiceResult,
} from '@/lib/service-result';
import {
  decodeBase64ToBytes,
  getSignedPaymentProofUrl,
  supabase,
} from '@/lib/supabase';

export type PaymentMethod = 'cash' | 'upi';
export type BillingMode = 'RENT' | 'EB' | 'COMBINED';
export type BillingFilterTab = 'ALL' | 'REVIEW' | 'UNPAID' | 'PAID';

export interface PendingPaymentReport {
  id: string;
  claimed_method: PaymentMethod;
  amount_paise: number;
  payment_date: string;
  reference_number: string | null;
  screenshot_url: string | null;
  notes: string | null;
}

export interface RejectedPaymentReport {
  id: string;
  rejection_reason: string | null;
}

export interface ResidentRentBillItem {
  resident_id: string;
  full_name: string;
  room_number: string;
  phone_number: string | null;
  opt_in_wm: boolean;
  wm_request_pending?: boolean;
  monthly_rent_paise: number;
  charge_id: string | null;
  rent_paise: number;
  wm_paise: number;
  total_paise: number;
  status: 'paid' | 'unpaid' | 'not_generated';
  has_pending_report: boolean;
  pending_report?: PendingPaymentReport | null;
  rejected_report?: RejectedPaymentReport | null;
  receipt_number?: string | null;
  paid_date?: string | null;
  paid_method?: string | null;
  due_date?: string | null;
}

export interface ResidentEbBillItem {
  resident_id: string;
  full_name: string;
  room_number: string;
  phone_number: string | null;
  charge_id: string | null;
  amount_paise: number;
  status: 'paid' | 'unpaid' | 'not_generated';
  has_pending_report: boolean;
  pending_report?: PendingPaymentReport | null;
  rejected_report?: RejectedPaymentReport | null;
  receipt_number?: string | null;
  paid_date?: string | null;
  paid_method?: string | null;
  due_date?: string | null;
}

export interface CombinedBillItem {
  resident_id: string;
  full_name: string;
  room_number: string;
  phone_number: string | null;
  rent_paise: number;
  wm_paise: number;
  eb_paise: number;
  total_paise: number;
  paid_paise: number;
  remaining_paise: number;
  has_pending_report: boolean;
  is_all_paid: boolean;
  due_date: string | null;
}

export interface RoomResidentInfo {
  id: string;
  full_name: string;
  room_number: string;
}

export interface ReviewPaymentItem {
  full_name: string;
  room_number: string;
  charge_id: string;
  bill_title: string;
  report: PendingPaymentReport;
}

export interface OwnerBillingSnapshot {
  propertyId: string | null;
  propertyName: string;
  rentBills: ResidentRentBillItem[];
  ebBills: ResidentEbBillItem[];
  allResidents: RoomResidentInfo[];
  availableRooms: string[];
}

export interface StudentPaymentReport {
  id: string;
  claimed_method: PaymentMethod;
  amount_paise: number;
  reference_number: string | null;
  screenshot_url: string | null;
  notes: string | null;
  created_at: string;
  status: 'pending' | 'rejected' | 'approved';
  rejection_reason?: string | null;
}

export interface StudentBillCardItem {
  charge_id: string;
  category: 'rent' | 'electricity';
  title: string;
  month_label: string;
  billing_month: string;
  due_date: string;
  rent_paise?: number;
  wm_paise?: number;
  total_paise: number;
  status: 'paid' | 'unpaid';
  receipt_number?: string | null;
  paid_date?: string | null;
  paid_method?: string | null;
  payment_id?: string | null;
  pending_report?: StudentPaymentReport | null;
}

export interface StudentBillingSnapshot {
  residentId: string | null;
  residentName: string;
  roomNumber: string;
  propertyName: string;
  ownerUpiId?: string | null;
  ownerUpiPayeeName?: string | null;
  currentRentBill: StudentBillCardItem | null;
  currentEbBill: StudentBillCardItem | null;
  pastBills: StudentBillCardItem[];
}

export interface SwrReadOptions<T> {
  forceNetwork?: boolean;
  onCachedData?: (cached: T) => void;
}

export interface GetOwnerBillingParams {
  userId: string;
  selectedPropertyId?: string | null;
  selectedPropertyName?: string | null;
  monthIsoStart: string;
}

export interface GenerateMonthlyBillsParams {
  propertyId: string;
  monthIsoStart: string;
  rentPaise: number;
}

export interface GenerateMonthlyBillsResult {
  created_count: number;
  updated_count: number;
  skipped_count: number;
}

export interface UpdateResidentRentParams {
  propertyId: string;
  residentId: string;
  rentPaise: number;
  monthIsoStart: string;
}

export interface AllocateEbBillParams {
  propertyId: string;
  roomNumber: string;
  monthIsoStart: string;
  monthIsoEnd: string;
  dueIsoDate: string;
  totalPaise: number;
  residentIds: string[];
  notes: string;
}

export interface ToggleWmBillingParams {
  propertyId: string;
  residentId: string;
  isEnabled: boolean;
  monthIsoStart: string;
}

export interface ConfirmMonthlyPaymentParams {
  chargeId: string;
  reportId?: string | null;
  method?: PaymentMethod;
}

export interface ConfirmMonthlyPaymentResult {
  receipt_number: string;
}

export interface RejectPaymentReportParams {
  reportId: string;
  rejectionReason: string;
}

export interface SubmitStudentPaymentProofParams {
  residentId: string;
  chargeId: string;
  paymentMethod: PaymentMethod;
  referenceNumber?: string;
  notes?: string;
  screenshot?: { uri: string; base64?: string | null } | null;
}

interface RawChargeRow {
  id: string;
  resident_id: string;
  category: string;
  amount_paise: number;
  rent_amount_paise: number | null;
  wm_amount_paise: number | null;
  status: string;
  due_date: string | null;
  billing_period_start?: string;
}

interface RawOwnerReportRow {
  id: string;
  resident_id: string;
  charge_id: string | null;
  amount_paise: number;
  claimed_method: PaymentMethod;
  payment_date: string;
  reference_number: string | null;
  screenshot_url: string | null;
  notes: string | null;
  status: string;
  rejection_reason: string | null;
}

interface RawStudentReportRow {
  id: string;
  charge_id: string | null;
  amount_paise: number;
  claimed_method: PaymentMethod;
  reference_number: string | null;
  screenshot_url: string | null;
  notes: string | null;
  status: 'pending' | 'rejected' | 'approved';
  rejection_reason: string | null;
  created_at: string;
}

interface RawPaymentAllocRow {
  charge_id: string;
  payment:
    | {
        id?: string;
        receipt_number: string;
        payment_date: string;
        method: string;
      }
    | {
        id?: string;
        receipt_number: string;
        payment_date: string;
        method: string;
      }[]
    | null;
}

interface SettledPaymentInfo {
  id: string;
  receipt: string;
  date: string;
  method: string;
}

async function fetchSettledPaymentAllocations(
  settledChargeIds: string[],
  traceLabel: string
): Promise<Map<string, SettledPaymentInfo>> {
  const paymentMap = new Map<string, SettledPaymentInfo>();
  if (settledChargeIds.length === 0) {
    return paymentMap;
  }

  const { data: allocData } = await supabase
    .from('payment_allocations')
    .select(
      `
        charge_id,
        payment:payments (
          id,
          receipt_number,
          payment_date,
          method
        )
      `
    )
    .in('charge_id', settledChargeIds)
    .eq('status', 'active');
  recordRoundTrip(traceLabel, 1);

  if (allocData) {
    for (const a of allocData as unknown as RawPaymentAllocRow[]) {
      const p = Array.isArray(a.payment) ? a.payment[0] : a.payment;
      if (p) {
        paymentMap.set(a.charge_id, {
          id: p.id || '',
          receipt: p.receipt_number,
          date: p.payment_date,
          method: p.method,
        });
      }
    }
  }

  return paymentMap;
}

export const BILLING_CACHE_PREFIX = 'billing:';

export function getOwnerBillingCacheKey(
  propertyId: string,
  monthIsoStart: string
): string {
  const monthKey = monthIsoStart.slice(0, 7);
  return `billing:owner:${propertyId}:${monthKey}`;
}

export function getStudentBillingCacheKey(userId: string): string {
  return `billing:student:${userId}`;
}

export async function getCachedOwnerBilling(
  propertyId: string,
  monthIsoStart: string
): Promise<OwnerBillingSnapshot | null> {
  return getCached<OwnerBillingSnapshot>(
    getOwnerBillingCacheKey(propertyId, monthIsoStart)
  );
}

export async function getCachedStudentBilling(
  userId: string
): Promise<StudentBillingSnapshot | null> {
  return getCached<StudentBillingSnapshot>(getStudentBillingCacheKey(userId));
}

/**
 * Fetches owner billing state for a property and month using SWR caching
 * and parallelized Supabase queries.
 */
export async function getOwnerBilling(
  params: GetOwnerBillingParams,
  options?: SwrReadOptions<OwnerBillingSnapshot>
): Promise<ServiceResult<OwnerBillingSnapshot>> {
  const { userId, selectedPropertyId, selectedPropertyName, monthIsoStart } =
    params;
  const traceLabel = `billing:owner:${selectedPropertyId || 'auto'}:${monthIsoStart.slice(0, 7)}`;
  startTrace(traceLabel);

  try {
    let activePropId = selectedPropertyId || null;
    let activePropName = selectedPropertyName || null;

    if (activePropId && !options?.forceNetwork) {
      const cached = await getCachedEntry<OwnerBillingSnapshot>(
        getOwnerBillingCacheKey(activePropId, monthIsoStart)
      );
      if (cached) {
        options?.onCachedData?.(cached.data);
      }
    }

    if (!activePropId) {
      const { data: properties, error: propErr } = await supabase
        .from('properties')
        .select('id, name')
        .eq('owner_id', userId)
        .eq('is_active', true)
        .limit(1);
      recordRoundTrip(traceLabel, 1);

      if (propErr) throw propErr;
      if (!properties || properties.length === 0) {
        return ok({
          propertyId: null,
          propertyName: activePropName || 'Shalom Residency',
          rentBills: [],
          ebBills: [],
          allResidents: [],
          availableRooms: [],
        });
      }

      activePropId = properties[0].id;
      activePropName = properties[0].name;

      if (activePropId && !options?.forceNetwork) {
        const cached = await getCachedEntry<OwnerBillingSnapshot>(
          getOwnerBillingCacheKey(activePropId, monthIsoStart)
        );
        if (cached) {
          options?.onCachedData?.(cached.data);
        }
      }
    }

    const resolvedPropertyId = activePropId as string;
    const resolvedPropertyName = activePropName || 'Shalom Residency';

    const { data: resData, error: resErr } = await supabase
      .from('residents')
      .select(
        'id, full_name, room_number, phone_number, monthly_rent_paise, is_active'
      )
      .eq('property_id', resolvedPropertyId)
      .eq('is_active', true)
      .order('room_number', { ascending: true });
    recordRoundTrip(traceLabel, 1);

    if (resErr) throw resErr;
    const residents = resData ?? [];
    const residentIds = residents.map((r) => r.id);
    const availableRooms = Array.from(
      new Set(residents.map((r) => r.room_number))
    ).sort();
    const allResidents: RoomResidentInfo[] = residents.map((r) => ({
      id: r.id,
      full_name: r.full_name,
      room_number: r.room_number,
    }));

    if (residentIds.length === 0) {
      const emptySnapshot: OwnerBillingSnapshot = {
        propertyId: resolvedPropertyId,
        propertyName: resolvedPropertyName,
        rentBills: [],
        ebBills: [],
        allResidents,
        availableRooms,
      };
      await setCached(
        getOwnerBillingCacheKey(resolvedPropertyId, monthIsoStart),
        emptySnapshot
      );
      return ok(emptySnapshot);
    }

    // Parallelize independent property/resident queries in a single batch
    const [optRes, wmReqRes, chargeRes, reportRes] = await Promise.all([
      supabase
        .from('resident_opt_ins')
        .select('resident_id, is_enabled')
        .eq('feature_name', 'washing_machine')
        .in('resident_id', residentIds),
      supabase
        .from('washing_machine_requests')
        .select('resident_id')
        .eq('property_id', resolvedPropertyId)
        .eq('status', 'pending')
        .then(
          (res) => res,
          () => ({ data: null, error: null })
        ),
      supabase
        .from('charges')
        .select(
          'id, resident_id, category, amount_paise, rent_amount_paise, wm_amount_paise, status, due_date'
        )
        .eq('property_id', resolvedPropertyId)
        .eq('billing_period_start', monthIsoStart),
      supabase
        .from('student_payment_reports')
        .select(
          'id, resident_id, charge_id, amount_paise, claimed_method, payment_date, reference_number, screenshot_url, notes, status, rejection_reason'
        )
        .eq('property_id', resolvedPropertyId)
        .in('status', ['pending', 'rejected'])
        .order('created_at', { ascending: false }),
    ]);
    recordRoundTrip(traceLabel, 1);

    if (chargeRes.error) throw chargeRes.error;

    const wmMap = new Map<string, boolean>();
    if (optRes.data) {
      for (const o of optRes.data) {
        wmMap.set(o.resident_id, o.is_enabled);
      }
    }

    const wmPendingRequestSet = new Set<string>();
    if (!wmReqRes.error && wmReqRes.data) {
      for (const req of wmReqRes.data) {
        wmPendingRequestSet.add(req.resident_id);
      }
    }

    const chargeData = (chargeRes.data ?? []) as RawChargeRow[];
    const rentChargeMap = new Map<string, RawChargeRow>();
    const ebChargeMap = new Map<string, RawChargeRow>();

    for (const c of chargeData) {
      if (c.category === 'rent') {
        rentChargeMap.set(c.resident_id, c);
      } else if (c.category === 'electricity') {
        ebChargeMap.set(c.resident_id, c);
      }
    }

    const reportByChargeMap = new Map<string, RawOwnerReportRow>();
    const reportData = (reportRes.data ?? []) as RawOwnerReportRow[];
    for (const rep of reportData) {
      if (rep.charge_id && !reportByChargeMap.has(rep.charge_id)) {
        reportByChargeMap.set(rep.charge_id, rep);
      }
    }

    const settledChargeIds = chargeData
      .filter((c) => c.status === 'settled')
      .map((c) => c.id);

    const paymentMap = await fetchSettledPaymentAllocations(
      settledChargeIds,
      traceLabel
    );

    const rentBills: ResidentRentBillItem[] = residents.map((r) => {
      const optWm = wmMap.get(r.id) ?? false;
      const defaultRent = r.monthly_rent_paise || 800000;
      const chg = rentChargeMap.get(r.id);
      const rep = chg ? reportByChargeMap.get(chg.id) : null;
      const isPendingReport = rep?.status === 'pending';
      const isRejectedReport = rep?.status === 'rejected';

      if (chg) {
        const isSettled = chg.status === 'settled';
        const pInfo = paymentMap.get(chg.id);

        return {
          resident_id: r.id,
          full_name: r.full_name,
          room_number: r.room_number,
          phone_number: r.phone_number,
          opt_in_wm: optWm,
          wm_request_pending: wmPendingRequestSet.has(r.id),
          monthly_rent_paise: defaultRent,
          charge_id: chg.id,
          rent_paise: chg.rent_amount_paise || defaultRent,
          wm_paise: chg.wm_amount_paise || (optWm ? 50000 : 0),
          total_paise: chg.amount_paise,
          status: isSettled ? 'paid' : 'unpaid',
          has_pending_report: isPendingReport,
          pending_report: isPendingReport && rep ? rep : null,
          rejected_report:
            isRejectedReport && rep
              ? { id: rep.id, rejection_reason: rep.rejection_reason }
              : null,
          receipt_number: pInfo?.receipt || null,
          paid_date: pInfo?.date || null,
          paid_method: pInfo?.method || null,
          due_date: chg.due_date || null,
        };
      }

      return {
        resident_id: r.id,
        full_name: r.full_name,
        room_number: r.room_number,
        phone_number: r.phone_number,
        opt_in_wm: optWm,
        wm_request_pending: wmPendingRequestSet.has(r.id),
        monthly_rent_paise: defaultRent,
        charge_id: null,
        rent_paise: defaultRent,
        wm_paise: optWm ? 50000 : 0,
        total_paise: defaultRent + (optWm ? 50000 : 0),
        status: 'not_generated',
        has_pending_report: false,
        pending_report: null,
        rejected_report: null,
        receipt_number: null,
        paid_date: null,
        paid_method: null,
      };
    });

    const ebBills: ResidentEbBillItem[] = residents.map((r) => {
      const chg = ebChargeMap.get(r.id);
      const rep = chg ? reportByChargeMap.get(chg.id) : null;
      const isPendingReport = rep?.status === 'pending';
      const isRejectedReport = rep?.status === 'rejected';

      if (chg) {
        const isSettled = chg.status === 'settled';
        const pInfo = paymentMap.get(chg.id);

        return {
          resident_id: r.id,
          full_name: r.full_name,
          room_number: r.room_number,
          phone_number: r.phone_number,
          charge_id: chg.id,
          amount_paise: chg.amount_paise,
          status: isSettled ? 'paid' : 'unpaid',
          has_pending_report: isPendingReport,
          pending_report: isPendingReport && rep ? rep : null,
          rejected_report:
            isRejectedReport && rep
              ? { id: rep.id, rejection_reason: rep.rejection_reason }
              : null,
          receipt_number: pInfo?.receipt || null,
          paid_date: pInfo?.date || null,
          paid_method: pInfo?.method || null,
          due_date: chg.due_date || null,
        };
      }

      return {
        resident_id: r.id,
        full_name: r.full_name,
        room_number: r.room_number,
        phone_number: r.phone_number,
        charge_id: null,
        amount_paise: 0,
        status: 'not_generated',
        has_pending_report: false,
        pending_report: null,
        rejected_report: null,
        receipt_number: null,
        paid_date: null,
        paid_method: null,
      };
    });

    const snapshot: OwnerBillingSnapshot = {
      propertyId: resolvedPropertyId,
      propertyName: resolvedPropertyName,
      rentBills,
      ebBills,
      allResidents,
      availableRooms,
    };

    await setCached(
      getOwnerBillingCacheKey(resolvedPropertyId, monthIsoStart),
      snapshot
    );

    return ok(snapshot);
  } catch (err) {
    return fail(err, 'Could not load billing information.');
  } finally {
    endTrace(traceLabel);
  }
}

/**
 * Generates or updates monthly rent bills (strictly online RPC).
 */
export async function generateMonthlyBills(
  params: GenerateMonthlyBillsParams
): Promise<ServiceResult<GenerateMonthlyBillsResult>> {
  const traceLabel = `billing:rpc:generate_monthly_bills:${params.propertyId}`;
  startTrace(traceLabel);
  try {
    const { data, error } = await supabase.rpc('generate_monthly_bills', {
      p_property_id: params.propertyId,
      p_billing_month: params.monthIsoStart,
      p_default_rent_paise: params.rentPaise,
    });
    recordRoundTrip(traceLabel, 1);

    if (error) throw error;
    if (!data?.success) {
      throw new Error(data?.error || 'Failed to generate bills.');
    }

    await invalidatePrefix(BILLING_CACHE_PREFIX);
    return ok({
      created_count: data.created_count || 0,
      updated_count: data.updated_count || 0,
      skipped_count: data.skipped_count || 0,
    });
  } catch (err) {
    return fail(err, 'Could not generate rent bills.');
  } finally {
    endTrace(traceLabel);
  }
}

/**
 * Updates monthly rent for a single resident (strictly online RPC).
 */
export async function updateResidentRent(
  params: UpdateResidentRentParams
): Promise<ServiceResult<null>> {
  const traceLabel = `billing:rpc:update_resident_rent:${params.residentId}`;
  startTrace(traceLabel);
  try {
    const { data, error } = await supabase.rpc('update_resident_rent', {
      p_property_id: params.propertyId,
      p_resident_id: params.residentId,
      p_rent_paise: params.rentPaise,
      p_billing_month: params.monthIsoStart,
    });
    recordRoundTrip(traceLabel, 1);

    if (error) throw error;
    if (!data?.success) {
      throw new Error(data?.error || 'Failed to update rent.');
    }

    await invalidatePrefix(BILLING_CACHE_PREFIX);
    return ok(null);
  } catch (err) {
    return fail(err, 'Could not update rent amount.');
  } finally {
    endTrace(traceLabel);
  }
}

/**
 * Splits and allocates a room electricity bill across occupants (strictly online RPC).
 */
export async function allocateEbBill(
  params: AllocateEbBillParams
): Promise<ServiceResult<null>> {
  const traceLabel = `billing:rpc:allocate_eb_bill:${params.propertyId}`;
  startTrace(traceLabel);
  try {
    const { data, error } = await supabase.rpc('allocate_eb_bill', {
      p_property_id: params.propertyId,
      p_room_number: params.roomNumber,
      p_period_start: params.monthIsoStart,
      p_period_end: params.monthIsoEnd,
      p_due_date: params.dueIsoDate,
      p_total_amount_paise: params.totalPaise,
      p_resident_ids: params.residentIds,
      p_notes: params.notes,
    });
    recordRoundTrip(traceLabel, 1);

    if (error) throw error;
    if (!data?.success) {
      throw new Error(data?.error || 'Failed to allocate EB bill.');
    }

    await invalidatePrefix(BILLING_CACHE_PREFIX);
    return ok(null);
  } catch (err) {
    return fail(err, 'Could not split EB bill.');
  } finally {
    endTrace(traceLabel);
  }
}

/**
 * Toggles a resident's washing machine billing opt-in (strictly online RPC).
 */
export async function toggleResidentWmBilling(
  params: ToggleWmBillingParams
): Promise<ServiceResult<null>> {
  const traceLabel = `billing:rpc:toggle_resident_wm_billing:${params.residentId}`;
  startTrace(traceLabel);
  try {
    const { data, error } = await supabase.rpc('toggle_resident_wm_billing', {
      p_property_id: params.propertyId,
      p_resident_id: params.residentId,
      p_is_enabled: params.isEnabled,
      p_billing_month: params.monthIsoStart,
    });
    recordRoundTrip(traceLabel, 1);

    if (error) throw error;
    if (!data?.success) {
      throw new Error(data?.error || 'Failed to toggle washing machine.');
    }

    await invalidatePrefix(BILLING_CACHE_PREFIX);
    return ok(null);
  } catch (err) {
    return fail(err, 'Could not update washing machine setting.');
  } finally {
    endTrace(traceLabel);
  }
}

/**
 * Confirms a monthly payment (cash or student-submitted UPI proof) strictly online.
 */
export async function confirmMonthlyPayment(
  params: ConfirmMonthlyPaymentParams
): Promise<ServiceResult<ConfirmMonthlyPaymentResult>> {
  const traceLabel = `billing:rpc:confirm_monthly_payment:${params.chargeId}`;
  startTrace(traceLabel);
  try {
    const { data, error } = await supabase.rpc('confirm_monthly_payment', {
      p_charge_id: params.chargeId,
      p_report_id: params.reportId || undefined,
      p_method: params.method || 'upi',
      p_notes: params.reportId
        ? 'Payment confirmed via student app proof'
        : 'Payment received directly in person (Cash)',
    });
    recordRoundTrip(traceLabel, 1);

    if (error) throw error;
    if (!data?.success) {
      throw new Error(data?.error || 'Failed to confirm payment.');
    }

    await invalidatePrefix(BILLING_CACHE_PREFIX);
    return ok({ receipt_number: data.receipt_number });
  } catch (err) {
    return fail(err, 'Could not confirm payment.');
  } finally {
    endTrace(traceLabel);
  }
}

/**
 * Rejects a student payment report with an owner reason (strictly online RPC).
 */
export async function rejectStudentPaymentReport(
  params: RejectPaymentReportParams
): Promise<ServiceResult<null>> {
  const traceLabel = `billing:rpc:reject_student_payment_report:${params.reportId}`;
  startTrace(traceLabel);
  try {
    const { data, error } = await supabase.rpc(
      'reject_student_payment_report',
      {
        p_report_id: params.reportId,
        p_rejection_reason: params.rejectionReason,
      }
    );
    recordRoundTrip(traceLabel, 1);

    if (error) throw error;
    if (!data?.success) {
      throw new Error(data?.error || 'Failed to reject payment proof.');
    }

    await invalidatePrefix(BILLING_CACHE_PREFIX);
    return ok(null);
  } catch (err) {
    return fail(err, 'Could not reject payment report.');
  } finally {
    endTrace(traceLabel);
  }
}

/**
 * Resolves a time-limited signed URL for a payment proof stored in `payment-proofs`.
 */
export async function resolvePaymentProofUrl(
  pathOrUrl: string | null | undefined
): Promise<string | null> {
  if (!pathOrUrl) return null;
  try {
    return await getSignedPaymentProofUrl(pathOrUrl);
  } catch (err) {
    console.warn(
      '[BillingService] Failed to sign proof url:',
      normalizeAppError(err).message
    );
    return pathOrUrl;
  }
}

const STORAGE_PROPERTY_META_PREFIX = '@pgwala_property_meta:';

async function fetchPropertyUpiMeta(
  propId: string | null
): Promise<{ ownerUpiId: string | null; ownerUpiPayeeName: string | null }> {
  let ownerUpiId: string | null = null;
  let ownerUpiPayeeName: string | null = null;
  if (!propId) {
    return { ownerUpiId, ownerUpiPayeeName };
  }

  try {
    const { data, error } = await supabase
      .from('properties')
      .select('upi_id, upi_payee_name')
      .eq('id', propId)
      .maybeSingle();
    if (!error && data) {
      const row = data as {
        upi_id?: string | null;
        upi_payee_name?: string | null;
      };
      ownerUpiId = row.upi_id?.trim() || null;
      ownerUpiPayeeName = row.upi_payee_name?.trim() || null;
    }
  } catch {
    // Ignore errors when DB columns are not yet migrated or test mocks don't handle `properties`
  }

  if (!ownerUpiId || !ownerUpiPayeeName) {
    try {
      const rawMeta = await AsyncStorage.getItem(
        `${STORAGE_PROPERTY_META_PREFIX}${propId}`
      );
      if (rawMeta) {
        const parsed = JSON.parse(rawMeta) as {
          upi_id?: string | null;
          upi_payee_name?: string | null;
          upiId?: string | null;
          upiPayeeName?: string | null;
        };
        if (!ownerUpiId) {
          ownerUpiId = (parsed.upi_id ?? parsed.upiId)?.trim() || null;
        }
        if (!ownerUpiPayeeName) {
          ownerUpiPayeeName =
            (parsed.upi_payee_name ?? parsed.upiPayeeName)?.trim() || null;
        }
      }
    } catch {
      // Non-fatal fallback read
    }
  }

  return { ownerUpiId, ownerUpiPayeeName };
}

/**
 * Fetches student billing snapshot (current & past charges, payment reports, receipts)
 * using SWR caching and parallelized Supabase queries.
 */
export async function getStudentBilling(
  userId: string,
  options?: SwrReadOptions<StudentBillingSnapshot>
): Promise<ServiceResult<StudentBillingSnapshot>> {
  const cacheKey = getStudentBillingCacheKey(userId);
  const traceLabel = cacheKey;
  startTrace(traceLabel);

  try {
    if (!options?.forceNetwork) {
      const cached = await getCachedEntry<StudentBillingSnapshot>(cacheKey);
      if (cached) {
        options?.onCachedData?.(cached.data);
      }
    }

    const { data: resData, error: resErr } = await supabase
      .from('residents')
      .select(
        `
          id,
          property_id,
          full_name,
          room_number,
          property:properties (
            id,
            name
          )
        `
      )
      .eq('profile_id', userId)
      .eq('is_active', true)
      .maybeSingle();
    recordRoundTrip(traceLabel, 1);

    if (resErr) throw resErr;
    if (!resData) {
      return ok({
        residentId: null,
        residentName: 'Resident',
        roomNumber: '',
        propertyName: 'My PG',
        ownerUpiId: null,
        ownerUpiPayeeName: null,
        currentRentBill: null,
        currentEbBill: null,
        pastBills: [],
      });
    }

    const propObj = Array.isArray(resData.property)
      ? resData.property[0]
      : resData.property;
    const propertyName = propObj?.name || 'My PG';
    const propId: string | null =
      (resData as { property_id?: string | null }).property_id ||
      (propObj as { id?: string | null } | null)?.id ||
      null;

    // Parallelize charges, payment reports, and owner UPI metadata after resolving resident
    const [chargesRes, reportsRes, upiMeta] = await Promise.all([
      supabase
        .from('charges')
        .select(
          'id, category, amount_paise, rent_amount_paise, wm_amount_paise, status, billing_period_start, due_date'
        )
        .eq('resident_id', resData.id)
        .in('category', ['rent', 'electricity'])
        .order('billing_period_start', { ascending: false }),
      supabase
        .from('student_payment_reports')
        .select(
          'id, charge_id, amount_paise, claimed_method, reference_number, screenshot_url, notes, status, rejection_reason, created_at'
        )
        .eq('resident_id', resData.id)
        .in('status', ['pending', 'rejected'])
        .order('created_at', { ascending: false }),
      fetchPropertyUpiMeta(propId),
    ]);
    recordRoundTrip(traceLabel, 1);

    if (chargesRes.error) throw chargesRes.error;

    const charges = (chargesRes.data ?? []) as RawChargeRow[];
    const reports = (reportsRes.data ?? []) as RawStudentReportRow[];

    const pendingReportMap = new Map<string, RawStudentReportRow>();
    for (const rep of reports) {
      if (rep.charge_id && !pendingReportMap.has(rep.charge_id)) {
        pendingReportMap.set(rep.charge_id, rep);
      }
    }

    const settledIds = charges
      .filter((c) => c.status === 'settled')
      .map((c) => c.id);
    const paymentMap = await fetchSettledPaymentAllocations(
      settledIds,
      traceLabel
    );

    const allBills: StudentBillCardItem[] = charges.map((c) => {
      const billingStart = c.billing_period_start || '';
      const d = new Date(billingStart);
      const monthLabel = !isNaN(d.getTime())
        ? d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
        : billingStart;

      const isSettled = c.status === 'settled';
      const pInfo = paymentMap.get(c.id);
      const pRep = pendingReportMap.get(c.id);
      const isRent = c.category === 'rent';

      return {
        charge_id: c.id,
        category: c.category as 'rent' | 'electricity',
        title: isRent ? 'Room Rent Bill' : 'Electricity (EB) Bill',
        month_label: monthLabel,
        billing_month: billingStart,
        due_date: c.due_date || '',
        rent_paise: isRent ? c.rent_amount_paise || c.amount_paise : undefined,
        wm_paise: isRent ? c.wm_amount_paise || 0 : undefined,
        total_paise: c.amount_paise,
        status: isSettled ? 'paid' : 'unpaid',
        receipt_number: pInfo?.receipt || null,
        paid_date: pInfo?.date || null,
        paid_method: pInfo?.method || null,
        payment_id: pInfo?.id || null,
        pending_report: pRep
          ? {
              id: pRep.id,
              claimed_method: pRep.claimed_method,
              amount_paise: pRep.amount_paise,
              reference_number: pRep.reference_number,
              screenshot_url: pRep.screenshot_url,
              notes: pRep.notes,
              created_at: pRep.created_at,
              status: pRep.status,
              rejection_reason: pRep.rejection_reason,
            }
          : null,
      };
    });

    const rentCharges = allBills.filter((b) => b.category === 'rent');
    const ebCharges = allBills.filter((b) => b.category === 'electricity');
    const currentRentBill = rentCharges.length > 0 ? rentCharges[0] : null;
    const currentEbBill = ebCharges.length > 0 ? ebCharges[0] : null;
    const pastBills = allBills.filter(
      (b) =>
        b.charge_id !== currentRentBill?.charge_id &&
        b.charge_id !== currentEbBill?.charge_id
    );

    const snapshot: StudentBillingSnapshot = {
      residentId: resData.id,
      residentName: resData.full_name,
      roomNumber: resData.room_number,
      propertyName,
      ownerUpiId: upiMeta.ownerUpiId,
      ownerUpiPayeeName: upiMeta.ownerUpiPayeeName,
      currentRentBill,
      currentEbBill,
      pastBills,
    };

    await setCached(cacheKey, snapshot);
    return ok(snapshot);
  } catch (err) {
    return fail(err, 'Could not load your billing details.');
  } finally {
    endTrace(traceLabel);
  }
}

/**
 * Uploads optional payment screenshot to `payment-proofs` storage bucket and
 * submits the payment proof via RPC (strictly online).
 */
export async function submitStudentPaymentProof(
  params: SubmitStudentPaymentProofParams
): Promise<ServiceResult<null>> {
  const traceLabel = `billing:rpc:submit_student_payment_proof:${params.chargeId}`;
  startTrace(traceLabel);
  try {
    let uploadedScreenshotPath: string | null = null;

    if (params.screenshot?.base64) {
      try {
        const fileExt =
          params.screenshot.uri.split('.').pop()?.toLowerCase() || 'jpg';
        const fileName = `${params.residentId}/${Date.now()}_${params.chargeId}.${fileExt}`;
        const bytes = decodeBase64ToBytes(params.screenshot.base64);

        const { error: uploadErr } = await supabase.storage
          .from('payment-proofs')
          .upload(fileName, bytes, {
            contentType: `image/${fileExt === 'png' ? 'png' : 'jpeg'}`,
            upsert: true,
          });
        recordRoundTrip(traceLabel, 1);

        if (uploadErr) {
          throw new Error(`Storage upload failed: ${uploadErr.message}`);
        }

        uploadedScreenshotPath = fileName;
      } catch (uploadException) {
        const appErr = normalizeAppError(
          uploadException,
          'Failed to upload payment screenshot. Please try again.'
        );
        throw new Error(appErr.message);
      }
    } else if (params.screenshot && !params.screenshot.base64) {
      throw new Error(
        'Image data could not be processed. Please select the screenshot again.'
      );
    }

    const { data, error } = await supabase.rpc('submit_student_payment_proof', {
      p_charge_id: params.chargeId,
      p_claimed_method: params.paymentMethod,
      p_screenshot_url: uploadedScreenshotPath || undefined,
      p_reference_number: params.referenceNumber?.trim() || undefined,
      p_notes: params.notes?.trim() || undefined,
    });
    recordRoundTrip(traceLabel, 1);

    if (error) throw error;
    if (!data?.success) {
      throw new Error(data?.error || 'Failed to submit payment proof.');
    }

    await invalidatePrefix(BILLING_CACHE_PREFIX);
    return ok(null);
  } catch (err) {
    return fail(err, 'Could not send payment report.');
  } finally {
    endTrace(traceLabel);
  }
}
