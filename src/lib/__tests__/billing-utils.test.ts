import {
  formatPaiseToRupees,
  rupeesToPaise,
  calculateEbSplit,
  isNonCollegeDeparture,
  isEveningOrNightWindow,
} from '../billing-utils';

describe('billing-utils', () => {
  describe('formatPaiseToRupees', () => {
    it('formats positive paise values correctly to Indian Rupee notation', () => {
      expect(formatPaiseToRupees(800000)).toBe('₹8,000');
      expect(formatPaiseToRupees(150000)).toBe('₹1,500');
      expect(formatPaiseToRupees(5000)).toBe('₹50');
      expect(formatPaiseToRupees(100)).toBe('₹1');
    });

    it('rounds partial paise to the nearest rupee', () => {
      expect(formatPaiseToRupees(800049)).toBe('₹8,000');
      expect(formatPaiseToRupees(800050)).toBe('₹8,001');
    });

    it('handles zero and invalid inputs gracefully', () => {
      expect(formatPaiseToRupees(0)).toBe('₹0');
      expect(formatPaiseToRupees(NaN)).toBe('₹0');
      expect(formatPaiseToRupees(Infinity)).toBe('₹0');
    });
  });

  describe('rupeesToPaise', () => {
    it('converts whole rupees into integer paise', () => {
      expect(rupeesToPaise(8000)).toBe(800000);
      expect(rupeesToPaise(1)).toBe(100);
      expect(rupeesToPaise(450.5)).toBe(45050);
    });

    it('handles 0 or negative values by returning 0', () => {
      expect(rupeesToPaise(0)).toBe(0);
      expect(rupeesToPaise(-500)).toBe(0);
      expect(rupeesToPaise(NaN)).toBe(0);
    });
  });

  describe('calculateEbSplit', () => {
    const mockResidents = [
      { id: '1', full_name: 'Charlie Doe', room_number: '101' },
      { id: '2', full_name: 'Alice Smith', room_number: '101' },
      { id: '3', full_name: 'Bob Johnson', room_number: '101' },
    ];

    it('splits evenly when total is evenly divisible', () => {
      const split = calculateEbSplit(300, mockResidents);
      expect(split).toHaveLength(3);
      expect(split[0].shareRupees).toBe(100);
      expect(split[1].shareRupees).toBe(100);
      expect(split[2].shareRupees).toBe(100);

      const sum = split.reduce((acc, curr) => acc + curr.shareRupees, 0);
      expect(sum).toBe(300);
    });

    it('deterministically distributes remainder whole rupees to sorted residents without remainder loss', () => {
      // 1000 / 3 = 333 each with 1 remainder
      const split = calculateEbSplit(1000, mockResidents);
      expect(split).toHaveLength(3);

      // Sorted alphabetically: Alice (0), Bob (1), Charlie (2)
      // Alice gets 334, Bob gets 333, Charlie gets 333
      expect(split[0].full_name).toBe('Alice Smith');
      expect(split[0].shareRupees).toBe(334);

      expect(split[1].full_name).toBe('Bob Johnson');
      expect(split[1].shareRupees).toBe(333);

      expect(split[2].full_name).toBe('Charlie Doe');
      expect(split[2].shareRupees).toBe(333);

      const sum = split.reduce((acc, curr) => acc + curr.shareRupees, 0);
      expect(sum).toBe(1000);
    });

    it('handles remainder of 2 across 3 residents', () => {
      // 1001 / 3 = 333 with 2 remainder -> first two get 334, third gets 333
      const split = calculateEbSplit(1001, mockResidents);
      expect(split[0].shareRupees).toBe(334);
      expect(split[1].shareRupees).toBe(334);
      expect(split[2].shareRupees).toBe(333);

      const sum = split.reduce((acc, curr) => acc + curr.shareRupees, 0);
      expect(sum).toBe(1001);
    });

    it('returns empty array if no residents or zero total', () => {
      expect(calculateEbSplit(0, mockResidents)).toEqual([]);
      expect(calculateEbSplit(500, [])).toEqual([]);
    });
  });

  describe('isNonCollegeDeparture', () => {
    it('returns false for college-related departure purposes', () => {
      expect(isNonCollegeDeparture('College')).toBe(false);
      expect(isNonCollegeDeparture('Attending college lectures')).toBe(false);
      expect(isNonCollegeDeparture('going to class')).toBe(false);
      expect(isNonCollegeDeparture('Tuition Class')).toBe(false);
    });

    it('returns true for non-college purposes', () => {
      expect(isNonCollegeDeparture('Market shopping')).toBe(true);
      expect(isNonCollegeDeparture('Home Visit')).toBe(true);
      expect(isNonCollegeDeparture('Movie with friends')).toBe(true);
      expect(isNonCollegeDeparture('')).toBe(true);
      expect(isNonCollegeDeparture(null)).toBe(true);
      expect(isNonCollegeDeparture(undefined)).toBe(true);
    });
  });

  describe('isEveningOrNightWindow', () => {
    it('detects evening and night hours correctly (18:00 - 05:59)', () => {
      const evening7pm = new Date(2026, 10, 7, 19, 0, 0);
      expect(isEveningOrNightWindow(evening7pm)).toBe(true);

      const lateNight11pm = new Date(2026, 10, 7, 23, 30, 0);
      expect(isEveningOrNightWindow(lateNight11pm)).toBe(true);

      const earlyMorning3am = new Date(2026, 10, 7, 3, 0, 0);
      expect(isEveningOrNightWindow(earlyMorning3am)).toBe(true);
    });

    it('detects daytime hours correctly (06:00 - 17:59)', () => {
      const morning10am = new Date(2026, 10, 7, 10, 0, 0);
      expect(isEveningOrNightWindow(morning10am)).toBe(false);

      const afternoon2pm = new Date(2026, 10, 7, 14, 0, 0);
      expect(isEveningOrNightWindow(afternoon2pm)).toBe(false);

      const afternoon5pm = new Date(2026, 10, 7, 17, 59, 0);
      expect(isEveningOrNightWindow(afternoon5pm)).toBe(false);
    });
  });
});

