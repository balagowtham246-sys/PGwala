import {
  countDaysOutThisMonth,
  formatMovementDayLabel,
  formatShortReturnDate,
  getLocalDateKey,
  groupLogsByLocalDay,
  isLateReturn,
  isLeaveOverdue,
  isOnMultiDayLeave,
  isOutOverHours,
  sortLogsDescending,
} from '../movement-utils';

describe('movement-utils', () => {
  test('sortLogsDescending orders newest events first regardless of input order', () => {
    const logs = [
      { id: '1', event_time: '2026-11-12T08:00:00.000Z' },
      { id: '2', event_time: '2026-11-13T16:15:00.000Z' },
      { id: '3', event_time: '2026-11-13T01:59:00.000Z' },
    ];

    const sorted = sortLogsDescending(logs);
    expect(sorted.map((l) => l.id)).toEqual(['2', '3', '1']);
  });

  test('formatMovementDayLabel returns Today and Yesterday for recent local dates', () => {
    const now = new Date();
    const yesterday = new Date();
    yesterday.setDate(now.getDate() - 1);

    expect(formatMovementDayLabel(now.toISOString())).toBe('Today');
    expect(formatMovementDayLabel(yesterday.toISOString())).toBe('Yesterday');
  });

  test('groupLogsByLocalDay groups events by local date and preserves newest-first order', () => {
    const now = new Date();
    const earlierToday = new Date(now);
    earlierToday.setHours(1, 59, 0, 0);
    const laterToday = new Date(now);
    laterToday.setHours(16, 15, 0, 0);
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    yesterday.setHours(3, 40, 0, 0);

    const groups = groupLogsByLocalDay([
      { id: 'early-today', event_time: earlierToday.toISOString() },
      { id: 'yesterday', event_time: yesterday.toISOString() },
      { id: 'late-today', event_time: laterToday.toISOString() },
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0].dateTitle).toBe('Today');
    expect(groups[0].dateKey).toBe(getLocalDateKey(now.toISOString()));
    expect(groups[0].items.map((i) => i.id)).toEqual(['late-today', 'early-today']);
    expect(groups[1].dateTitle).toBe('Yesterday');
    expect(groups[1].items.map((i) => i.id)).toEqual(['yesterday']);
  });

  test('isLateReturn flags past expected return times and ignores Tomorrow Morning', () => {
    const at9Pm = new Date(2026, 10, 13, 21, 0, 0);
    expect(isLateReturn('Evening (~8:00 PM)', at9Pm)).toBe(true);
    expect(isLateReturn('Night (~10:00 PM)', at9Pm)).toBe(false);
    expect(isLateReturn('Tomorrow Morning', at9Pm)).toBe(false);
    expect(isLateReturn('7:30 PM tonight', at9Pm)).toBe(true);
    expect(isLateReturn(null, at9Pm)).toBe(false);
  });

  test('isOutOverHours flags OUT events >= 10 hours', () => {
    const now = new Date(2026, 10, 14, 22, 0, 0);
    const elevenHoursAgo = new Date(now.getTime() - 11 * 60 * 60 * 1000).toISOString();
    const threeHoursAgo = new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString();

    expect(isOutOverHours('OUT', elevenHoursAgo, 10, now)).toEqual({
      isOver: true,
      hoursOut: 11,
    });
    expect(isOutOverHours('OUT', threeHoursAgo, 10, now)).toEqual({
      isOver: false,
      hoursOut: 3,
    });
    expect(isOutOverHours('IN', elevenHoursAgo, 10, now)).toEqual({
      isOver: false,
      hoursOut: 0,
    });
  });

  test('countDaysOutThisMonth counts unique days with OUT events in current month', () => {
    const now = new Date(2026, 10, 14, 12, 0, 0); // Nov 2026
    const logs = [
      { direction: 'OUT', event_time: new Date(2026, 10, 2, 9, 0).toISOString() },
      { direction: 'OUT', event_time: new Date(2026, 10, 2, 18, 0).toISOString() }, // same day
      { direction: 'IN', event_time: new Date(2026, 10, 3, 9, 0).toISOString() }, // IN ignored
      { direction: 'OUT', event_time: new Date(2026, 10, 10, 10, 0).toISOString() },
      { direction: 'OUT', event_time: new Date(2026, 9, 28, 10, 0).toISOString() }, // Oct ignored
    ];
    expect(countDaysOutThisMonth(logs, now)).toBe(2);
  });

  test('isOnMultiDayLeave detects active OUT logs with valid expected_return_date', () => {
    expect(isOnMultiDayLeave({ direction: 'OUT', expected_return_date: '2026-12-05' })).toBe(true);
    expect(isOnMultiDayLeave({ direction: 'OUT', expected_return_date: null })).toBe(false);
    expect(isOnMultiDayLeave({ direction: 'IN', expected_return_date: '2026-12-05' })).toBe(false);
    expect(isOnMultiDayLeave(null)).toBe(false);
  });

  test('isLeaveOverdue & isLateReturn do not flag nightly curfew during active multi-day leave', () => {
    const dec3LateNight = new Date(2026, 11, 3, 23, 30, 0); // Dec 3, 11:30 PM
    const dec5Night = new Date(2026, 11, 5, 23, 30, 0); // Dec 5 (return date itself)
    const dec6Morning = new Date(2026, 11, 6, 8, 0, 0); // Dec 6 (day after return date)

    expect(isLeaveOverdue('2026-12-05', dec3LateNight)).toBe(false);
    expect(isLeaveOverdue('2026-12-05', dec5Night)).toBe(false);
    expect(isLeaveOverdue('2026-12-05', dec6Morning)).toBe(true);

    // Even if expected_return_time has a clock string, expectedReturnDate takes precedence
    expect(isLateReturn('Evening (~8:00 PM)', dec3LateNight, '2026-12-05')).toBe(false);
    expect(isLateReturn('Returns 5 Dec', dec5Night, '2026-12-05')).toBe(false);
    expect(isLateReturn('Returns 5 Dec', dec6Morning, '2026-12-05')).toBe(true);
  });

  test('formatShortReturnDate formats Today, Tomorrow, and short calendar dates', () => {
    const nov27 = new Date(2026, 10, 27, 10, 0, 0);
    expect(formatShortReturnDate('2026-11-27', nov27)).toBe('Today');
    expect(formatShortReturnDate('2026-11-28', nov27)).toBe('Tomorrow');
    expect(formatShortReturnDate('2026-12-05', nov27)).toMatch(/5\s*Dec|Dec\s*5/);
  });
});
