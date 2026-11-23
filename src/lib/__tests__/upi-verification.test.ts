import {
  evaluateUpiVerification,
  formatExtractedUpiSummary,
  normalizeUpiUtr,
  UpiExtractedData,
} from '../upi-verification';

describe('upi-verification', () => {
  describe('normalizeUpiUtr', () => {
    it('extracts 12-digit NPCI UTR from clean and prefixed strings', () => {
      expect(normalizeUpiUtr('432819203948')).toBe('432819203948');
      expect(normalizeUpiUtr('UTR: 432819203948 (GPay)')).toBe('432819203948');
      expect(normalizeUpiUtr('Ref No 4328-1920-3948')).toBe('432819203948');
    });

    it('returns null for short, empty, or non-12-digit strings', () => {
      expect(normalizeUpiUtr('')).toBeNull();
      expect(normalizeUpiUtr(null)).toBeNull();
      expect(normalizeUpiUtr('12345')).toBeNull();
      expect(normalizeUpiUtr('12345678901234')).toBeNull();
    });
  });

  describe('evaluateUpiVerification', () => {
    const nowMs = new Date('2026-11-23T12:00:00Z').getTime();

    const validReceipt: UpiExtractedData = {
      is_upi_receipt: true,
      app_name: 'GPay',
      utr_number: '432819203948',
      amount_rupees: 6500,
      payee_upi_id: 'shalompg@okaxis',
      payee_name: 'Shalom Residency',
      payment_date: '2026-11-22',
      transaction_status: 'SUCCESS',
      confidence: 'high',
    };

    it('returns verified_match when amount, payee UPI, UTR, date, and status all match', () => {
      const res = evaluateUpiVerification({
        extracted: validReceipt,
        expectedAmountPaise: 650000,
        ownerUpiId: 'SHALOMPG@OKAXIS',
        nowMs,
      });

      expect(res.verification_status).toBe('verified_match');
      expect(res.warnings).toEqual([]);
    });

    it('flags amount mismatch, payee UPI mismatch, failed status, and stale date', () => {
      const res = evaluateUpiVerification({
        extracted: {
          ...validReceipt,
          amount_rupees: 6000,
          payee_upi_id: 'someoneelse@ybl',
          payment_date: '2026-09-01',
          transaction_status: 'FAILED',
        },
        expectedAmountPaise: 650000,
        ownerUpiId: 'shalompg@okaxis',
        nowMs,
      });

      expect(res.verification_status).toBe('warning');
      expect(res.warnings).toEqual(
        expect.arrayContaining([
          expect.stringContaining('FAILED'),
          expect.stringContaining('Amount mismatch'),
          expect.stringContaining('Payee UPI'),
          expect.stringContaining('days old'),
        ])
      );
    });

    it('flags non-UPI images immediately', () => {
      const res = evaluateUpiVerification({
        extracted: { ...validReceipt, is_upi_receipt: false },
        expectedAmountPaise: 650000,
        nowMs,
      });

      expect(res.verification_status).toBe('warning');
      expect(res.warnings[0]).toContain('does not look like a UPI');
    });

    it('flags missing 12-digit UTR', () => {
      const res = evaluateUpiVerification({
        extracted: { ...validReceipt, utr_number: null },
        expectedAmountPaise: 650000,
        nowMs,
      });

      expect(res.verification_status).toBe('warning');
      expect(res.warnings).toContain(
        '12-digit UPI UTR / Transaction ID was not visible in the screenshot.'
      );
    });
  });

  describe('formatExtractedUpiSummary', () => {
    it('formats concise amount + app + UTR summary', () => {
      const summary = formatExtractedUpiSummary({
        is_upi_receipt: true,
        app_name: 'PhonePe',
        utr_number: '432819203948',
        amount_rupees: 6500,
        payee_upi_id: null,
        payee_name: null,
        payment_date: null,
        transaction_status: 'SUCCESS',
        confidence: 'high',
      });
      expect(summary).toBe('₹6,500 · PhonePe · UTR 432819203948');
      expect(formatExtractedUpiSummary(null)).toBe('');
    });
  });
});
