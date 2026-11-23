/**
 * Billing & Financial Utilities for PGwala
 */

/**
 * Converts integer paise into formatted INR string (e.g. 800000 paise -> "₹8,000")
 */
export function formatPaiseToRupees(paise: number): string {
  if (isNaN(paise) || !isFinite(paise)) return '₹0';
  const rs = Math.round(paise / 100);
  return `₹${rs.toLocaleString('en-IN')}`;
}

/**
 * Converts whole rupees into integer paise (e.g. 8000 -> 800000)
 */
export function rupeesToPaise(rupees: number): number {
  if (isNaN(rupees) || !isFinite(rupees) || rupees <= 0) return 0;
  return Math.round(rupees * 100);
}

export interface SplitResident {
  id: string;
  full_name: string;
  room_number: string;
}

export interface SplitResult<T extends SplitResident> {
  id: string;
  full_name: string;
  room_number: string;
  shareRupees: number;
  item: T;
}

/**
 * Calculates deterministic whole-rupee split for a room bill across selected residents.
 * Guarantees sum of split shares equals the original totalRupees without fractional paise loss.
 */
export function calculateEbSplit<T extends SplitResident>(
  totalRupees: number,
  residents: T[]
): (T & { shareRupees: number })[] {
  if (!residents || residents.length === 0 || totalRupees <= 0) {
    return [];
  }

  const n = residents.length;
  const baseRupees = Math.floor(totalRupees / n);
  const remainderRupees = totalRupees % n;

  // Sort residents deterministically by full_name
  const sorted = [...residents].sort((a, b) =>
    a.full_name.localeCompare(b.full_name)
  );

  return sorted.map((resident, index) => ({
    ...resident,
    shareRupees: index < remainderRupees ? baseRupees + 1 : baseRupees,
  }));
}

/**
 * Checks if a gate departure purpose is non-college/non-class
 */
export function isNonCollegeDeparture(purpose: string | null | undefined): boolean {
  if (!purpose) return true;
  const cleaned = purpose.trim().toLowerCase();
  if (!cleaned) return true;
  return !(
    cleaned === 'college' ||
    cleaned.includes('college') ||
    cleaned.includes('class')
  );
}

/**
 * Checks if current hour falls within the evening/night monitoring window (6 PM to 6 AM)
 */
export function isEveningOrNightWindow(date = new Date()): boolean {
  const hour = date.getHours();
  return hour >= 18 || hour < 6;
}

export type BillPaymentReportStatus = 'pending' | 'rejected' | 'approved' | 'none';

export interface BillReportInfo {
  status: string;
  rejection_reason?: string | null;
}

export interface BillReportState {
  status: BillPaymentReportStatus;
  isPending: boolean;
  isRejected: boolean;
  isApproved: boolean;
  rejectionReason: string | null;
}

export const PRESET_REJECTION_REASONS = [
  'Screenshot blurred or unreadable',
  'Amount does not match bill total',
  'Transaction reference not found',
  'Payment not credited to PG account',
  'Duplicate or older screenshot attached',
] as const;

/**
 * Resolves the verification state of a student's payment report submission.
 */
export function getBillReportState(
  report?: BillReportInfo | null
): BillReportState {
  if (!report || !report.status) {
    return {
      status: 'none',
      isPending: false,
      isRejected: false,
      isApproved: false,
      rejectionReason: null,
    };
  }

  const rawStatus = report.status.toLowerCase().trim();
  if (rawStatus === 'pending') {
    return {
      status: 'pending',
      isPending: true,
      isRejected: false,
      isApproved: false,
      rejectionReason: null,
    };
  }

  if (rawStatus === 'rejected') {
    return {
      status: 'rejected',
      isPending: false,
      isRejected: true,
      isApproved: false,
      rejectionReason:
        report.rejection_reason && report.rejection_reason.trim()
          ? report.rejection_reason.trim()
          : 'Payment proof could not be verified by owner.',
    };
  }

  if (rawStatus === 'approved') {
    return {
      status: 'approved',
      isPending: false,
      isRejected: false,
      isApproved: true,
      rejectionReason: null,
    };
  }

  return {
    status: 'none',
    isPending: false,
    isRejected: false,
    isApproved: false,
    rejectionReason: null,
  };
}

/**
 * Computes full calendar days overdue for a YYYY-MM-DD due date string.
 */
export function getOverdueDays(
  dueDateIso?: string | null,
  now: Date = new Date()
): number {
  if (!dueDateIso) return 0;
  const parts = dueDateIso.split('T')[0].split('-').map((n) => parseInt(n, 10));
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return 0;

  const due = new Date(parts[0], parts[1] - 1, parts[2]);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffMs = today.getTime() - due.getTime();
  return diffMs > 0 ? Math.floor(diffMs / (1000 * 60 * 60 * 24)) : 0;
}

/**
 * Formats a due date with overdue ageing (e.g., "Due 5 Nov • 9d overdue").
 */
export function formatDueStatus(
  dueDateIso?: string | null,
  now: Date = new Date()
): { label: string; isOverdue: boolean } | null {
  if (!dueDateIso) return null;
  const parts = dueDateIso.split('T')[0].split('-').map((n) => parseInt(n, 10));
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return null;

  const due = new Date(parts[0], parts[1] - 1, parts[2]);
  const formatted = due.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
  });
  const overdueDays = getOverdueDays(dueDateIso, now);

  if (overdueDays > 0) {
    return {
      label: `Due ${formatted} • ${overdueDays}d overdue`,
      isOverdue: true,
    };
  }
  return {
    label: `Due ${formatted}`,
    isOverdue: false,
  };
}

/**
 * Builds a WhatsApp deep link (`https://wa.me/...`) for a resident phone number.
 */
export function buildWhatsAppReminderUrl(
  phone: string | null | undefined,
  message: string
): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 10) return null;
  const normalized = digits.length === 10 ? `91${digits}` : digits;
  return `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
}

export interface MonthlyRentExportRow {
  full_name: string;
  room_number: string;
  phone_number?: string | null;
  rent_paise: number;
  wm_paise: number;
  total_paise: number;
  status: string;
}

/**
 * Generates a clean, WhatsApp-ready monthly rent collection summary for PG owners.
 */
export function buildMonthlyRentSummaryText(params: {
  propertyName: string;
  monthLabel: string;
  rentBills: MonthlyRentExportRow[];
}): string {
  const { propertyName, monthLabel, rentBills } = params;
  let totalExpectedPaise = 0;
  let totalCollectedPaise = 0;
  let paidCount = 0;
  const unpaidRows: MonthlyRentExportRow[] = [];

  for (const row of rentBills) {
    const amt = row.total_paise || 0;
    totalExpectedPaise += amt;
    if (row.status === 'paid' || row.status === 'settled') {
      totalCollectedPaise += amt;
      paidCount += 1;
    } else {
      unpaidRows.push(row);
    }
  }

  const pendingPaise = Math.max(0, totalExpectedPaise - totalCollectedPaise);
  const lines: string[] = [
    `*${propertyName} — Rent Report (${monthLabel})*`,
    `Expected: ${formatPaiseToRupees(totalExpectedPaise)}`,
    `Collected: ${formatPaiseToRupees(totalCollectedPaise)} (${paidCount}/${rentBills.length} paid)`,
    `Pending: ${formatPaiseToRupees(pendingPaise)} (${unpaidRows.length} unpaid)`,
  ];

  if (unpaidRows.length > 0) {
    lines.push('', '*Pending Residents:*');
    for (const row of unpaidRows) {
      lines.push(
        `• Room ${row.room_number} — ${row.full_name}: ${formatPaiseToRupees(row.total_paise)}`
      );
    }
  } else if (rentBills.length > 0) {
    lines.push('', 'All residents have settled rent for this month.');
  }

  return lines.join('\n');
}

function escapeCsvCell(value: string | number): string {
  const str = String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Generates an RFC-4180 CSV spreadsheet string for monthly rent collection.
 */
export function buildMonthlyRentCsv(params: {
  propertyName: string;
  monthLabel: string;
  rentBills: MonthlyRentExportRow[];
}): string {
  const header = 'Property,Month,Room,Resident,Phone,Rent (INR),Washing Machine (INR),Total (INR),Status';
  const rows = params.rentBills.map((row) =>
    [
      params.propertyName,
      params.monthLabel,
      row.room_number,
      row.full_name,
      row.phone_number ?? '',
      Math.round((row.rent_paise || 0) / 100),
      Math.round((row.wm_paise || 0) / 100),
      Math.round((row.total_paise || 0) / 100),
      row.status === 'paid' || row.status === 'settled' ? 'Paid' : 'Pending',
    ]
      .map(escapeCsvCell)
      .join(',')
  );
  return [header, ...rows].join('\n');
}

export interface ReceiptShareInput {
  receiptNumber: string;
  status: 'approved' | 'reversed';
  amountPaise: number;
  method: string;
  paymentDate: string;
  propertyName: string;
  propertyAddress?: string | null;
  residentName: string;
  roomNumber?: string | null;
  notes?: string | null;
  allocations?: { description: string; amountPaise: number; status?: string }[];
}

/**
 * Formats a clean, shareable digital payment receipt for WhatsApp / HRA sharing.
 */
export function buildPaymentReceiptShareText(input: ReceiptShareInput): string {
  const statusLabel = input.status === 'reversed' ? 'REVERSED' : 'PAID';
  const lines: string[] = [
    `*PG Rent Receipt (${statusLabel})*`,
    `Receipt No: ${input.receiptNumber}`,
    `PG: ${input.propertyName}${input.propertyAddress ? ` (${input.propertyAddress})` : ''}`,
    `Resident: ${input.residentName}${input.roomNumber ? ` · Room ${input.roomNumber}` : ''}`,
    `Amount: ${formatPaiseToRupees(input.amountPaise)}`,
    `Method: ${input.method.toUpperCase()}`,
    `Date: ${input.paymentDate}`,
  ];

  if (input.allocations && input.allocations.length > 0) {
    lines.push('', '*Bill Breakdown:*');
    for (const alloc of input.allocations) {
      const reversedTag = alloc.status === 'reversed' ? ' (Reversed)' : '';
      lines.push(
        `• ${alloc.description}${reversedTag}: ${formatPaiseToRupees(alloc.amountPaise)}`
      );
    }
  }

  if (input.notes?.trim()) {
    lines.push('', `Note: ${input.notes.trim()}`);
  }

  lines.push('', 'Generated via PGwala');
  return lines.join('\n');
}

