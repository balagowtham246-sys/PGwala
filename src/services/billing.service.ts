import AsyncStorage from '@react-native-async-storage/async-storage';

import { endTrace, recordRoundTrip, startTrace } from '@/lib/perf-monitor';
import { uploadStorageWithRetry } from '@/lib/image-upload';
import { invalidatePrefix } from '@/lib/query-cache';
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
  normalized_utr?: string | null;
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
  screenshotUrl?: string | null;
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
  normalized_utr?: string | null;
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

interface RawOwnerResidentRow {
  id: string;
  full_name: string;
  room_number: string;
  phone_number: string | null;
  monthly_rent_paise: number | null;
  is_active: boolean;
}

interface RawOwnerOptInRow {
  resident_id: string;
  is_enabled: boolean;
}

interface RawWmPendingRequestRow {
  resident_id: string;
}

interface RawOwnerBillingRpcResponse {
  success?: boolean;
  error?: string;
  property?: { id: string; name: string } | null;
  residents?: RawOwnerResidentRow[];
  opt_ins?: RawOwnerOptInRow[];
  wm_pending_requests?: RawWmPendingRequestRow[];
  charges?: RawChargeRow[];
  reports?: RawOwnerReportRow[];
  payment_allocations?: RawPaymentAllocRow[];
}

interface RawStudentBillingRpcResponse {
  success?: boolean;
  error?: string;
  resident?: {
    id: string;
    property_id: string | null;
    full_name: string;
    room_number: string;
    property_name: string | null;
    owner_upi_id: string | null;
    owner_upi_payee_name: string | null;
  } | null;
  charges?: RawChargeRow[];
  reports?: RawStudentReportRow[];
  payment_allocations?: RawPaymentAllocRow[];
}

interface SettledPaymentInfo {
  id: string;
  receipt: string;
  date: string;
  method: string;
}

function buildPaymentAllocationMap(
  allocData: RawPaymentAllocRow[] | null | undefined
): Map<string, SettledPaymentInfo> {
  const paymentMap = new Map<string, SettledPaymentInfo>();
  if (allocData) {
    for (const a of allocData) {
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

function buildOwnerBillingSnapshot(params: {
  propertyId: string;
  propertyName: string;
  residents: RawOwnerResidentRow[];
  optIns: RawOwnerOptInRow[];
  wmPendingRequests: RawWmPendingRequestRow[];
  charges: RawChargeRow[];
  reports: RawOwnerReportRow[];
  paymentMap: Map<string, SettledPaymentInfo>;
}): OwnerBillingSnapshot {
  const {
    propertyId,
    propertyName,
    residents,
    optIns,
    wmPendingRequests,
    charges,
    reports,
    paymentMap,
  } = params;

  const availableRooms = Array.from(
    new Set(residents.map((r) => r.room_number))
  ).sort();
  const allResidents: RoomResidentInfo[] = residents.map((r) => ({
    id: r.id,
    full_name: r.full_name,
    room_number: r.room_number,
  }));

  if (residents.length === 0) {
    return {
      propertyId,
      propertyName,
      rentBills: [],
      ebBills: [],
      allResidents,
      availableRooms,
    };
  }

  const wmMap = new Map<string, boolean>();
  for (const o of optIns) {
    wmMap.set(o.resident_id, o.is_enabled);
  }

  const wmPendingRequestSet = new Set<string>();
  for (const req of wmPendingRequests) {
    wmPendingRequestSet.add(req.resident_id);
  }

  const rentChargeMap = new Map<string, RawChargeRow>();
  const ebChargeMap = new Map<string, RawChargeRow>();
  for (const c of charges) {
    if (c.category === 'rent') {
      rentChargeMap.set(c.resident_id, c);
    } else if (c.category === 'electricity') {
      ebChargeMap.set(c.resident_id, c);
    }
  }

  const reportByChargeMap = new Map<string, RawOwnerReportRow>();
  for (const rep of reports) {
    if (rep.charge_id && !reportByChargeMap.has(rep.charge_id)) {
      reportByChargeMap.set(rep.charge_id, rep);
    }
  }

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

  return {
    propertyId,
    propertyName,
    rentBills,
    ebBills,
    allResidents,
    availableRooms,
  };
}

export const BILLING_CACHE_PREFIX = 'billing:';

/**
 * Fetches owner billing state for a property and month via the single-roundtrip
 * `get_owner_billing_summary` RPC.
 */
export async function getOwnerBilling(
  params: GetOwnerBillingParams
): Promise<ServiceResult<OwnerBillingSnapshot>> {
  const { selectedPropertyId, selectedPropertyName, monthIsoStart } = params;
  const traceLabel = `billing:owner:${selectedPropertyId || 'auto'}:${monthIsoStart.slice(0, 7)}`;
  startTrace(traceLabel);

  try {
    const activePropId = selectedPropertyId || null;
    const activePropName = selectedPropertyName || null;

    const { data: rpcData, error: rpcError } = await supabase.rpc(
      'get_owner_billing_summary',
      {
        p_property_id: activePropId,
        p_billing_month: monthIsoStart,
      }
    );
    recordRoundTrip(traceLabel, 1);

    if (rpcError) throw rpcError;

    const payload = rpcData as RawOwnerBillingRpcResponse | null;
    if (!payload || payload.success === false) {
      throw new Error(
        payload?.error || 'Could not load billing information.'
      );
    }

    if (!payload.property?.id) {
      return ok({
        propertyId: null,
        propertyName: activePropName || 'My PG',
        rentBills: [],
        ebBills: [],
        allResidents: [],
        availableRooms: [],
      });
    }

    const resolvedPropertyId = payload.property.id;
    const resolvedPropertyName =
      activePropName || payload.property.name || 'My PG';
    const paymentMap = buildPaymentAllocationMap(payload.payment_allocations);
    const snapshot = buildOwnerBillingSnapshot({
      propertyId: resolvedPropertyId,
      propertyName: resolvedPropertyName,
      residents: payload.residents ?? [],
      optIns: payload.opt_ins ?? [],
      wmPendingRequests: payload.wm_pending_requests ?? [],
      charges: payload.charges ?? [],
      reports: payload.reports ?? [],
      paymentMap,
    });

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

export function extractPaymentProofStoragePath(
  pathOrUrl: string | null | undefined
): string | null {
  if (!pathOrUrl) return null;
  const trimmed = pathOrUrl.trim();
  if (!trimmed) return null;
  if (
    trimmed.startsWith('file:') ||
    trimmed.startsWith('ph:') ||
    trimmed.startsWith('content:')
  ) {
    return null;
  }

  const publicPrefix = '/storage/v1/object/public/payment-proofs/';
  const signPrefix = '/storage/v1/object/sign/payment-proofs/';

  if (trimmed.includes(publicPrefix)) {
    const part = trimmed.split(publicPrefix)[1];
    return part ? decodeURIComponent(part.split('?')[0]) : null;
  }
  if (trimmed.includes(signPrefix)) {
    const part = trimmed.split(signPrefix)[1];
    return part ? decodeURIComponent(part.split('?')[0]) : null;
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return null;
  }
  return trimmed.replace(/^\/+/, '');
}

/**
 * Rejects a student payment report with an owner reason (strictly online RPC)
 * and best-effort deletes the rejected screenshot from `payment-proofs` storage.
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

    const storagePath = extractPaymentProofStoragePath(
      (typeof data.screenshot_url === 'string' ? data.screenshot_url : null) ??
        params.screenshotUrl
    );
    if (storagePath && supabase.storage?.from) {
      try {
        await supabase.storage.from('payment-proofs').remove([storagePath]);
      } catch {
        // Non-fatal: report rejection already succeeded
      }
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

async function readLocalPropertyUpiMeta(
  propId: string | null,
  initial: { ownerUpiId: string | null; ownerUpiPayeeName: string | null }
): Promise<{ ownerUpiId: string | null; ownerUpiPayeeName: string | null }> {
  let { ownerUpiId, ownerUpiPayeeName } = initial;
  if (!propId || (ownerUpiId && ownerUpiPayeeName)) {
    return { ownerUpiId, ownerUpiPayeeName };
  }

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

  return { ownerUpiId, ownerUpiPayeeName };
}

function buildStudentBillingSnapshot(params: {
  residentId: string;
  residentName: string;
  roomNumber: string;
  propertyName: string;
  ownerUpiId: string | null;
  ownerUpiPayeeName: string | null;
  charges: RawChargeRow[];
  reports: RawStudentReportRow[];
  paymentMap: Map<string, SettledPaymentInfo>;
}): StudentBillingSnapshot {
  const {
    residentId,
    residentName,
    roomNumber,
    propertyName,
    ownerUpiId,
    ownerUpiPayeeName,
    charges,
    reports,
    paymentMap,
  } = params;

  const pendingReportMap = new Map<string, RawStudentReportRow>();
  for (const rep of reports) {
    if (rep.charge_id && !pendingReportMap.has(rep.charge_id)) {
      pendingReportMap.set(rep.charge_id, rep);
    }
  }

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

  return {
    residentId,
    residentName,
    roomNumber,
    propertyName,
    ownerUpiId,
    ownerUpiPayeeName,
    currentRentBill,
    currentEbBill,
    pastBills,
  };
}

export interface PreResolvedStudentContext {
  residentId: string;
  residentName: string;
  roomNumber: string;
  propertyId: string;
  propertyName: string;
  ownerUpiId?: string | null;
  ownerUpiPayeeName?: string | null;
}

/**
 * Fetches student billing snapshot (current & past charges, payment reports, receipts)
 * via the single-roundtrip `get_student_billing_summary` RPC.
 */
export async function getStudentBilling(
  userId: string,
  options?: {
    residentContext?: PreResolvedStudentContext | null;
  }
): Promise<ServiceResult<StudentBillingSnapshot>> {
  const traceLabel = `billing:student:${userId}`;
  startTrace(traceLabel);

  try {
    const { data: rpcData, error: rpcError } = await supabase.rpc(
      'get_student_billing_summary',
      {
        p_resident_id: options?.residentContext?.residentId ?? null,
      }
    );
    recordRoundTrip(traceLabel, 1);

    if (rpcError) throw rpcError;

    const payload = rpcData as RawStudentBillingRpcResponse | null;
    if (!payload || payload.success === false) {
      throw new Error(
        payload?.error || 'Could not load your billing details.'
      );
    }

    if (!payload.resident?.id) {
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

    const res = payload.resident;
    const propId =
      res.property_id || options?.residentContext?.propertyId || null;
    const upiMeta = await readLocalPropertyUpiMeta(propId, {
      ownerUpiId:
        res.owner_upi_id?.trim() ||
        options?.residentContext?.ownerUpiId?.trim() ||
        null,
      ownerUpiPayeeName:
        res.owner_upi_payee_name?.trim() ||
        options?.residentContext?.ownerUpiPayeeName?.trim() ||
        null,
    });

    const snapshot = buildStudentBillingSnapshot({
      residentId: res.id,
      residentName:
        res.full_name || options?.residentContext?.residentName || 'Resident',
      roomNumber:
        res.room_number || options?.residentContext?.roomNumber || '',
      propertyName:
        res.property_name ||
        options?.residentContext?.propertyName ||
        'My PG',
      ownerUpiId: upiMeta.ownerUpiId,
      ownerUpiPayeeName: upiMeta.ownerUpiPayeeName,
      charges: payload.charges ?? [],
      reports: payload.reports ?? [],
      paymentMap: buildPaymentAllocationMap(payload.payment_allocations),
    });

    return ok(snapshot);
  } catch (err) {
    return fail(err, 'Could not load your billing details.');
  } finally {
    endTrace(traceLabel);
  }
}

const inFlightPaymentProofs = new Map<string, Promise<ServiceResult<null>>>();

/**
 * Uploads optional payment screenshot to `payment-proofs` storage bucket and
 * submits the payment proof via RPC (strictly online). Coalesces concurrent
 * double-tap submissions for the same resident + chargeId.
 */
export async function submitStudentPaymentProof(
  params: SubmitStudentPaymentProofParams
): Promise<ServiceResult<null>> {
  const flightKey = `${params.residentId}:${params.chargeId}`;
  const existingFlight = inFlightPaymentProofs.get(flightKey);
  if (existingFlight) {
    return existingFlight;
  }

  const run = (async (): Promise<ServiceResult<null>> => {
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

          const { error: uploadErr } = await uploadStorageWithRetry({
            bucket: 'payment-proofs',
            path: fileName,
            bytes,
            fileUri: params.screenshot.uri,
            contentType: `image/${fileExt === 'png' ? 'png' : 'jpeg'}`,
            upsert: true,
            maxAttempts: 2,
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

      const rpcPayload: Record<string, unknown> = {
        p_charge_id: params.chargeId,
        p_claimed_method: params.paymentMethod,
        p_screenshot_url: uploadedScreenshotPath || undefined,
        p_reference_number: params.referenceNumber?.trim() || undefined,
        p_notes: params.notes?.trim() || undefined,
      };

      const { data, error } = await supabase.rpc(
        'submit_student_payment_proof',
        rpcPayload
      );
      recordRoundTrip(traceLabel, 1);

      if (error) throw error;
      if (!data?.success) {
        throw new Error(data?.error || 'Failed to submit payment proof.');
      }

      await Promise.all([
        invalidatePrefix(BILLING_CACHE_PREFIX),
        invalidatePrefix('dashboard:student:'),
      ]);
      return ok(null);
    } catch (err) {
      return fail(err, 'Could not send payment report.');
    } finally {
      endTrace(traceLabel);
    }
  })();

  inFlightPaymentProofs.set(flightKey, run);
  try {
    return await run;
  } finally {
    inFlightPaymentProofs.delete(flightKey);
  }
}
