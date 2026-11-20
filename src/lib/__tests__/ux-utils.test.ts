import {
  calculateProRataFinalBillPaise,
  findDuplicatePhones,
  formatGateEventTimestamp,
  formatHhMmTo12h,
  formatIsoDateDisplay,
  formatPropertyGenderLabel,
  formatRoomLabel,
  inferPropertyGender,
  isPropertyCompatibleWithGender,
  isReturnAfterCurfew,
  maskIndianPhone,
  normalizeDishName,
  normalizeRoomCode,
  normalizeTimeMeridiemLowercase,
  parseDishList,
  parseTimeToMinutes,
  resolveExpectedReturnDate,
  serializeDishList,
  sortRoomCodes,
  toSentenceCaseStatus,
  validateIndianPhone,
} from '../ux-utils';

describe('ux-utils', () => {
  it('normalizes dish capitalization and deduplicates dish lists', () => {
    expect(normalizeDishName('idli')).toBe('Idli');
    expect(normalizeDishName('  paneer   butter masala ')).toBe('Paneer Butter Masala');
    expect(normalizeDishName('tea / coffee')).toBe('Tea / Coffee');

    expect(parseDishList('idli, Dosa, IDLI, tea / coffee')).toEqual([
      'Idli',
      'Dosa',
      'Tea / Coffee',
    ]);
    expect(serializeDishList(['idli', 'sambar', 'Idli'])).toBe('Idli, Sambar');
  });

  it('validates +91 10-digit Indian phone numbers and detects duplicates', () => {
    expect(validateIndianPhone('')).toMatchObject({ valid: false });
    expect(validateIndianPhone('12345')).toMatchObject({ valid: false });
    expect(validateIndianPhone('+91 98765-43210')).toEqual({
      valid: true,
      normalized10: '9876543210',
      formatted: '+91 98765 43210',
    });
    expect(validateIndianPhone('8667413899')).toEqual({
      valid: true,
      normalized10: '8667413899',
      formatted: '+91 86674 13899',
    });
    expect(validateIndianPhone('1234567890')).toEqual({
      valid: true,
      normalized10: '1234567890',
      formatted: '+91 12345 67890',
    });

    const dupes = findDuplicatePhones([
      { id: 'r1', phone_number: '8667413899' },
      { id: 'r2', phone_number: '+91 86674 13899' },
      { id: 'r3', phone_number: '9998887776' },
      { id: 'r4', phone_number: null },
    ]);
    expect(dupes.has('r1')).toBe(true);
    expect(dupes.has('r2')).toBe(true);
    expect(dupes.has('r3')).toBe(false);
    expect(dupes.has('r4')).toBe(false);
  });

  it('converts mixed status tokens into uniform Sentence case', () => {
    expect(toSentenceCaseStatus('PAID')).toBe('Paid');
    expect(toSentenceCaseStatus('INSIDE')).toBe('Inside');
    expect(toSentenceCaseStatus('OUT')).toBe('Outside');
    expect(toSentenceCaseStatus('URGENT')).toBe('Urgent');
    expect(toSentenceCaseStatus('IN_PROGRESS')).toBe('In progress');
    expect(toSentenceCaseStatus('out_of_order')).toBe('Out of order');
    expect(toSentenceCaseStatus('GATE IN')).toBe('Gate in');
    expect(toSentenceCaseStatus('GATE OUT')).toBe('Gate out');
    expect(toSentenceCaseStatus('UNDER REVIEW')).toBe('Under review');
    expect(toSentenceCaseStatus('REVIEW')).toBe('Under review');
    expect(toSentenceCaseStatus('REJECTED')).toBe('Rejected');
    expect(toSentenceCaseStatus('ACTIVE')).toBe('Active');
    expect(toSentenceCaseStatus('YOUR WASH')).toBe('Your wash');
    expect(toSentenceCaseStatus('NOT ENABLED')).toBe('Not enabled');
    expect(toSentenceCaseStatus('ALL IN USE')).toBe('All in use');
  });

  it('formats gate event timestamp with date when not from today', () => {
    const now = new Date(2026, 10, 19, 19, 45, 0); // 19 Nov 2026
    const sameDay = new Date(2026, 10, 19, 10, 24, 0).toISOString();
    const fiveDaysAgo = new Date(2026, 10, 14, 22, 24, 0).toISOString();

    expect(formatGateEventTimestamp(sameDay, now)).not.toContain('19 Nov');
    expect(formatGateEventTimestamp(fiveDaysAgo, now)).toContain('14 Nov');
  });

  it('infers property gender and checks resident gender compatibility', () => {
    expect(inferPropertyGender('Shalom girls pg')).toBe('girls');
    expect(inferPropertyGender('Shalom Residency')).toBe('coed');
    expect(inferPropertyGender('Custom', 'boys')).toBe('boys');
    expect(formatPropertyGenderLabel('coed')).toBe('Co-ed');
    expect(isPropertyCompatibleWithGender('girls', 'male')).toBe(false);
    expect(isPropertyCompatibleWithGender('girls', 'female')).toBe(true);
    expect(isPropertyCompatibleWithGender('coed', 'male')).toBe(true);
  });

  it('masks Indian phone numbers, formats ISO dates, sorts room codes, and computes pro-rata checkout rent', () => {
    expect(maskIndianPhone('+91 86674 13899')).toBe('+91 ••••• 13899');
    expect(maskIndianPhone(null)).toBe('Not set');
    expect(formatIsoDateDisplay('2026-11-19')).toContain('Nov');
    expect(calculateProRataFinalBillPaise(900000, '2026-11-15')).toBe(450000);
    expect(['Room D', '102', '101', '2'].sort(sortRoomCodes)).toEqual([
      '2',
      '101',
      '102',
      'Room D',
    ]);
    expect(normalizeRoomCode('Room D')).toBe('D');
    expect(normalizeRoomCode('Room Room D')).toBe('D');
    expect(normalizeRoomCode('ROOM B')).toBe('B');
    expect(formatRoomLabel('Room Room A')).toBe('Room A');
    expect(formatRoomLabel('101')).toBe('Room 101');
  });

  it('normalizes meridiem to lowercase and validates return times against curfew', () => {
    expect(normalizeTimeMeridiemLowercase('Evening (~8:00 PM)')).toBe('Evening (~8:00 pm)');
    expect(normalizeTimeMeridiemLowercase('10:24 AM')).toBe('10:24 am');
    expect(formatHhMmTo12h('20:00')).toBe('8:00 pm');
    expect(formatHhMmTo12h('07:30')).toBe('7:30 am');
    expect(formatHhMmTo12h('')).toBe('');
    expect(parseTimeToMinutes('Evening (~8:00 pm)')).toBe(20 * 60);
    expect(parseTimeToMinutes('22:30')).toBe(22 * 60 + 30);

    const departed = new Date(2026, 10, 20, 14, 0, 0).toISOString();
    const resolved = resolveExpectedReturnDate('Night (~10:00 pm)', departed);
    expect(resolved?.getHours()).toBe(22);
    expect(resolved?.getDate()).toBe(20);

    const tomorrowResolved = resolveExpectedReturnDate('Tomorrow morning', departed);
    expect(tomorrowResolved?.getDate()).toBe(21);

    expect(isReturnAfterCurfew('Night (~10:00 pm)', null)).toBe(false);
    expect(isReturnAfterCurfew('Evening (~8:00 pm)', '22:00')).toBe(false);
    expect(isReturnAfterCurfew('Late Night (~11:30 pm)', '22:00')).toBe(true);
    expect(isReturnAfterCurfew('Tomorrow morning', '22:00')).toBe(true);
  });
});
