import { normalizeUpiUtr } from '../upi-verification';

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
});
