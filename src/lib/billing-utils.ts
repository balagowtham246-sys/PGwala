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

