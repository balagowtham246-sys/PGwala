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
