export type UpiVerificationStatus = 'verified_match' | 'warning' | 'unverified';

export interface UpiExtractedData {
  is_upi_receipt: boolean;
  app_name: string | null;
  utr_number: string | null;
  amount_rupees: number | null;
  payee_upi_id: string | null;
  payee_name: string | null;
  payment_date: string | null;
  transaction_status: 'SUCCESS' | 'PENDING' | 'FAILED' | 'UNKNOWN';
  confidence: 'high' | 'medium' | 'low';
}

export interface UpiProofScanResult {
  hard_blocked: boolean;
  block_code?: 'DUPLICATE_SCREENSHOT' | 'DUPLICATE_UTR' | null;
  block_message?: string | null;
  screenshot_sha256: string | null;
  verification_status: UpiVerificationStatus;
  warnings: string[];
  extracted: UpiExtractedData | null;
}

const STALE_RECEIPT_MAX_DAYS = 45;

/**
 * Extracts and normalizes a 12-digit Indian NPCI UPI UTR / RRN from raw text.
 */
export function normalizeUpiUtr(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const match = raw.match(/(?:^|[^0-9])([0-9]{12})(?:[^0-9]|$)/);
  if (match && match[1]) return match[1];
  const digits = raw.replace(/\D/g, '');
  return digits.length === 12 ? digits : null;
}

/**
 * Pure client-side mirror of the Edge Function discrepancy evaluator
 * (useful for unit testing and deterministic UI formatting).
 */
export function evaluateUpiVerification(params: {
  extracted: UpiExtractedData;
  expectedAmountPaise: number;
  ownerUpiId?: string | null;
  nowMs?: number;
}): {
  verification_status: UpiVerificationStatus;
  warnings: string[];
} {
  const { extracted, expectedAmountPaise, ownerUpiId, nowMs = Date.now() } = params;
  const warnings: string[] = [];

  if (!extracted.is_upi_receipt) {
    warnings.push('Image does not look like a UPI payment confirmation screenshot.');
    return { verification_status: 'warning', warnings };
  }

  if (extracted.transaction_status === 'FAILED') {
    warnings.push('Screenshot shows a FAILED transaction.');
  } else if (extracted.transaction_status === 'PENDING') {
    warnings.push('Screenshot shows a PENDING/processing payment, not completed.');
  }

  if (typeof extracted.amount_rupees === 'number' && Number.isFinite(extracted.amount_rupees)) {
    const extractedPaise = Math.round(extracted.amount_rupees * 100);
    if (Math.abs(extractedPaise - expectedAmountPaise) >= 100) {
      const expectedRupees = Math.round(expectedAmountPaise / 100).toLocaleString('en-IN');
      const detectedRupees = Math.round(extracted.amount_rupees).toLocaleString('en-IN');
      warnings.push(
        `Amount mismatch: screenshot shows ₹${detectedRupees}, bill is ₹${expectedRupees}.`
      );
    }
  } else {
    warnings.push('Could not clearly read the paid amount from the screenshot.');
  }

  const cleanOwnerUpi = (ownerUpiId || '').trim().toLowerCase();
  const cleanPayeeUpi = (extracted.payee_upi_id || '').trim().toLowerCase();
  if (
    cleanOwnerUpi.includes('@') &&
    cleanPayeeUpi.includes('@') &&
    cleanOwnerUpi !== cleanPayeeUpi
  ) {
    warnings.push(`Payee UPI (${cleanPayeeUpi}) differs from PG UPI (${cleanOwnerUpi}).`);
  }

  if (extracted.payment_date) {
    const parsed = new Date(extracted.payment_date);
    if (!Number.isNaN(parsed.getTime())) {
      const ageDays = Math.floor((nowMs - parsed.getTime()) / (1000 * 60 * 60 * 24));
      if (ageDays > STALE_RECEIPT_MAX_DAYS) {
        warnings.push(`Receipt date (${extracted.payment_date}) is ${ageDays} days old.`);
      }
    }
  }

  if (!normalizeUpiUtr(extracted.utr_number)) {
    warnings.push('12-digit UPI UTR / Transaction ID was not visible in the screenshot.');
  }

  return {
    verification_status: warnings.length === 0 ? 'verified_match' : 'warning',
    warnings,
  };
}

/**
 * Formats a concise 1-line summary of extracted UPI receipt fields for badges.
 */
export function formatExtractedUpiSummary(extracted: UpiExtractedData | null | undefined): string {
  if (!extracted) return '';
  const parts: string[] = [];
  if (typeof extracted.amount_rupees === 'number' && Number.isFinite(extracted.amount_rupees)) {
    parts.push(`₹${Math.round(extracted.amount_rupees).toLocaleString('en-IN')}`);
  }
  if (extracted.app_name) {
    parts.push(extracted.app_name);
  }
  const utr = normalizeUpiUtr(extracted.utr_number);
  if (utr) {
    parts.push(`UTR ${utr}`);
  }
  return parts.join(' · ');
}
