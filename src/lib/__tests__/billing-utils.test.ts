import {
  formatPaiseToRupees,
  rupeesToPaise,
  calculateEbSplit,
  isNonCollegeDeparture,
  isEveningOrNightWindow,
  getBillReportState,
  PRESET_REJECTION_REASONS,
  getOverdueDays,
  formatDueStatus,
  buildWhatsAppReminderUrl,
  buildMonthlyRentSummaryText,
  buildMonthlyRentCsv,
  buildPaymentReceiptShareText,
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

  describe('getBillReportState', () => {
    it('returns none state when report is null or undefined', () => {
      expect(getBillReportState(null)).toEqual({
        status: 'none',
        isPending: false,
        isRejected: false,
        isApproved: false,
        rejectionReason: null,
      });
      expect(getBillReportState(undefined)).toEqual({
        status: 'none',
        isPending: false,
        isRejected: false,
        isApproved: false,
        rejectionReason: null,
      });
      expect(getBillReportState({ status: '' })).toEqual({
        status: 'none',
        isPending: false,
        isRejected: false,
        isApproved: false,
        rejectionReason: null,
      });
    });

    it('identifies pending report submissions', () => {
      const res = getBillReportState({ status: 'pending' });
      expect(res.status).toBe('pending');
      expect(res.isPending).toBe(true);
      expect(res.isRejected).toBe(false);
      expect(res.isApproved).toBe(false);
      expect(res.rejectionReason).toBeNull();
    });

    it('identifies rejected report submissions with specific owner reason', () => {
      const res = getBillReportState({
        status: 'rejected',
        rejection_reason: 'Amount does not match bill total',
      });
      expect(res.status).toBe('rejected');
      expect(res.isPending).toBe(false);
      expect(res.isRejected).toBe(true);
      expect(res.isApproved).toBe(false);
      expect(res.rejectionReason).toBe('Amount does not match bill total');
    });

    it('provides fallback reason when rejection reason is omitted or empty', () => {
      const res = getBillReportState({ status: 'rejected', rejection_reason: '' });
      expect(res.isRejected).toBe(true);
      expect(res.rejectionReason).toBe('Payment proof could not be verified by owner.');
    });

    it('identifies approved report submissions', () => {
      const res = getBillReportState({ status: 'approved' });
      expect(res.status).toBe('approved');
      expect(res.isApproved).toBe(true);
      expect(res.isPending).toBe(false);
      expect(res.isRejected).toBe(false);
    });

    it('handles unexpected statuses gracefully', () => {
      const res = getBillReportState({ status: 'cancelled' });
      expect(res.status).toBe('none');
      expect(res.isPending).toBe(false);
      expect(res.isRejected).toBe(false);
      expect(res.isApproved).toBe(false);
    });

    it('exports preset rejection reasons array', () => {
      expect(PRESET_REJECTION_REASONS.length).toBeGreaterThan(0);
      expect(PRESET_REJECTION_REASONS).toContain('Screenshot blurred or unreadable');
      expect(PRESET_REJECTION_REASONS).toContain('Amount does not match bill total');
    });
  });

  describe('due ageing and WhatsApp reminder helpers', () => {
    it('computes overdue days and formats due status', () => {
      const now = new Date(2026, 10, 14); // 14 Nov 2026
      expect(getOverdueDays('2026-11-05', now)).toBe(9);
      expect(getOverdueDays('2026-11-20', now)).toBe(0);

      expect(formatDueStatus('2026-11-05', now)).toEqual({
        label: 'Due 5 Nov • 9d overdue',
        isOverdue: true,
      });
      expect(formatDueStatus('2026-11-20', now)).toEqual({
        label: 'Due 20 Nov',
        isOverdue: false,
      });
    });

    it('builds WhatsApp URLs for 10-digit Indian phone numbers and rejects invalid ones', () => {
      const url = buildWhatsAppReminderUrl('9876543210', 'Rent due');
      expect(url).toBe('https://wa.me/919876543210?text=Rent%20due');
      expect(buildWhatsAppReminderUrl(null, 'Rent due')).toBeNull();
      expect(buildWhatsAppReminderUrl('12345', 'Rent due')).toBeNull();
    });
  });

  describe('monthly rent report export formatters', () => {
    const sampleBills = [
      {
        full_name: 'Arun Kumar',
        room_number: '101',
        phone_number: '9876543210',
        rent_paise: 800000,
        wm_paise: 50000,
        total_paise: 850000,
        status: 'settled',
      },
      {
        full_name: 'Karthik, Raj',
        room_number: '102',
        phone_number: '9876543211',
        rent_paise: 750000,
        wm_paise: 0,
        total_paise: 750000,
        status: 'unpaid',
      },
    ];

    it('builds a WhatsApp-ready monthly rent summary with pending resident list', () => {
      const text = buildMonthlyRentSummaryText({
        propertyName: 'Sunrise PG',
        monthLabel: 'November 2026',
        rentBills: sampleBills,
      });
      expect(text).toContain('*Sunrise PG — Rent Report (November 2026)*');
      expect(text).toContain('Expected: ₹16,000');
      expect(text).toContain('Collected: ₹8,500 (1/2 paid)');
      expect(text).toContain('Pending: ₹7,500 (1 unpaid)');
      expect(text).toContain('Room 102 — Karthik, Raj: ₹7,500');
    });

    it('builds RFC-4180 escaped CSV rows', () => {
      const csv = buildMonthlyRentCsv({
        propertyName: 'Sunrise PG',
        monthLabel: 'November 2026',
        rentBills: sampleBills,
      });
      const lines = csv.split('\n');
      expect(lines).toHaveLength(3);
      expect(lines[1]).toBe('Sunrise PG,November 2026,101,Arun Kumar,9876543210,8000,500,8500,Paid');
      expect(lines[2]).toBe('Sunrise PG,November 2026,102,"Karthik, Raj",9876543211,7500,0,7500,Pending');
    });
  });

  describe('buildPaymentReceiptShareText', () => {
    it('formats a paid receipt with line items and reference notes', () => {
      const text = buildPaymentReceiptShareText({
        receiptNumber: 'RCT-202611-0012',
        propertyName: 'Shalom Residency',
        residentName: 'Balagowtham V S',
        roomNumber: 'D',
        amountPaise: 650000,
        method: 'upi',
        paymentDate: '2026-11-06',
        status: 'approved',
        notes: 'GPay Ref 482910',
        allocations: [
          { description: 'Room Rent (Nov 2026)', amountPaise: 600000 },
          { description: 'Washing Machine', amountPaise: 50000 },
        ],
      });

      expect(text).toContain('*PG Rent Receipt (PAID)*');
      expect(text).toContain('Receipt No: RCT-202611-0012');
      expect(text).toContain('PG: Shalom Residency');
      expect(text).toContain('Resident: Balagowtham V S · Room D');
      expect(text).toContain('Amount: ₹6,500');
      expect(text).toContain('Method: UPI');
      expect(text).toContain('• Room Rent (Nov 2026): ₹6,000');
      expect(text).toContain('• Washing Machine: ₹500');
      expect(text).toContain('Note: GPay Ref 482910');
    });

    it('marks reversed receipts and reversed allocations clearly', () => {
      const text = buildPaymentReceiptShareText({
        receiptNumber: 'RCT-202611-0013',
        propertyName: 'Shalom Residency',
        residentName: 'Naveen J M',
        amountPaise: 10000,
        method: 'cash',
        paymentDate: '2026-11-07',
        status: 'reversed',
        allocations: [
          { description: 'EB Meter Share', amountPaise: 10000, status: 'reversed' },
        ],
      });

      expect(text).toContain('*PG Rent Receipt (REVERSED)*');
      expect(text).toContain('• EB Meter Share (Reversed): ₹100');
    });
  });
});

