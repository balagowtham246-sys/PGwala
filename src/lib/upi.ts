export const UPI_ID_REGEX = /^[a-zA-Z0-9._-]+@[a-zA-Z]+$/;

/**
 * Validates an Indian UPI VPA handle (e.g. "name@okaxis", "9876543210@ybl").
 */
export function isValidUpiId(raw: string | null | undefined): boolean {
  const clean = (raw || '').trim();
  if (!clean) return false;
  return UPI_ID_REGEX.test(clean);
}

export interface UpiPaymentUrlInput {
  upiId: string | null | undefined;
  payeeName: string;
  amountPaise: number;
  note?: string;
}

/**
 * Builds an RFC-compliant `upi://pay` deep link when a valid owner UPI ID and
 * positive amount exist; returns null otherwise.
 */
export function buildUpiPaymentUrl(input: UpiPaymentUrlInput): string | null {
  const pa = (input.upiId || '').trim();
  if (!isValidUpiId(pa)) return null;
  if (!Number.isFinite(input.amountPaise) || input.amountPaise <= 0) {
    return null;
  }

  const pn = (input.payeeName || 'PG Owner').trim() || 'PG Owner';
  const am = (Math.round(input.amountPaise) / 100).toFixed(2);
  const tn = (input.note || 'PG Rent & Dues').trim() || 'PG Rent & Dues';

  const query = [
    `pa=${encodeURIComponent(pa)}`,
    `pn=${encodeURIComponent(pn)}`,
    `am=${encodeURIComponent(am)}`,
    'cu=INR',
    `tn=${encodeURIComponent(tn)}`,
  ].join('&');

  return `upi://pay?${query}`;
}
