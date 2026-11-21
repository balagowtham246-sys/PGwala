import {
  AudienceResident,
  FoodAlertRecord,
  alertHeadline,
  countTargeted,
  createIdempotencyKey,
  describeSendResult,
  formatAlertTime,
  formatFoodAlertBody,
  isFoodAlertExpired,
  isFoodAlertExpiredAtIst,
  istDateIso,
  latestAlertPerMeal,
  uniqueRooms,
  validateAlertForm,
} from '../food-alert-utils';

const residents: AudienceResident[] = [
  { resident_id: 'r1', full_name: 'Asha', room_number: '101' },
  { resident_id: 'r2', full_name: 'Bala', room_number: '101' },
  { resident_id: 'r3', full_name: 'Charan', room_number: '20' },
  { resident_id: 'r4', full_name: 'Dev', room_number: '3' },
];

const baseForm = {
  meal: 'dinner' as const,
  status: 'ready' as const,
  audience: 'all' as const,
  rooms: [],
  residentIds: [],
  message: '',
};

describe('food-alert-utils', () => {
  describe('validateAlertForm', () => {
    it('accepts a valid everyone alert', () => {
      expect(validateAlertForm(baseForm)).toBeNull();
    });
    it('requires meal and status', () => {
      expect(validateAlertForm({ ...baseForm, meal: null })).toMatch(/meal/i);
      expect(validateAlertForm({ ...baseForm, status: null })).toMatch(/status/i);
    });
    it('requires rooms when targeting rooms', () => {
      expect(validateAlertForm({ ...baseForm, audience: 'rooms' })).toMatch(/room/i);
      expect(validateAlertForm({ ...baseForm, audience: 'rooms', rooms: ['101'] })).toBeNull();
    });
    it('requires residents when targeting individuals', () => {
      expect(validateAlertForm({ ...baseForm, audience: 'residents' })).toMatch(/resident/i);
      expect(validateAlertForm({ ...baseForm, audience: 'residents', residentIds: ['r1'] })).toBeNull();
    });
    it('rejects overlong messages', () => {
      expect(validateAlertForm({ ...baseForm, message: 'x'.repeat(201) })).toMatch(/200/);
    });
  });

  describe('audience helpers', () => {
    it('sorts rooms naturally and removes duplicates', () => {
      expect(uniqueRooms(residents)).toEqual(['3', '20', '101']);
    });
    it('counts targeted residents per audience', () => {
      expect(countTargeted(residents, 'all', [], [])).toBe(4);
      expect(countTargeted(residents, 'rooms', ['101'], [])).toBe(2);
      expect(countTargeted(residents, 'residents', [], ['r3', 'r4', 'missing'])).toBe(2);
    });
  });

  describe('idempotency key', () => {
    it('is within server-side length limits and varies by input', () => {
      const a = createIdempotencyKey(1700000000000, 0.1);
      const b = createIdempotencyKey(1700000000001, 0.9);
      expect(a.length).toBeGreaterThanOrEqual(8);
      expect(a.length).toBeLessThanOrEqual(80);
      expect(a).not.toBe(b);
    });
  });

  describe('latestAlertPerMeal', () => {
    const mk = (id: string, meal: any, status: any, at: string, date = '2026-11-15'): FoodAlertRecord => ({
      id,
      property_id: 'p',
      meal_type: meal,
      status,
      message: null,
      audience_type: 'all',
      dispatch_status: 'sent',
      recipients_count: 1,
      push_sent: 1,
      push_failed: 0,
      no_token_count: 0,
      alert_date: date,
      created_at: at,
    });
    it('keeps the newest alert per meal so delayed/cancelled updates replace ready', () => {
      const out = latestAlertPerMeal(
        [
          mk('a', 'dinner', 'ready', '2026-11-15T14:00:00Z'),
          mk('b', 'dinner', 'delayed', '2026-11-15T14:30:00Z'),
          mk('c', 'lunch', 'cancelled', '2026-11-15T07:00:00Z'),
          mk('d', 'dinner', 'ready', '2026-11-14T14:30:00Z', '2026-11-14'),
        ],
        '2026-11-15'
      );
      expect(out.dinner?.id).toBe('b');
      expect(out.lunch?.status).toBe('cancelled');
      expect(out.breakfast).toBeUndefined();
    });
  });

  describe('text helpers', () => {
    it('builds headlines', () => {
      expect(alertHeadline('dinner', 'delayed')).toBe('Dinner is delayed');
      expect(alertHeadline('lunch', 'cancelled')).toBe('Lunch is cancelled');
      expect(alertHeadline('breakfast', 'ready')).toBe('Breakfast is ready');
    });
    it('describes send results including in-app fallback and failures', () => {
      expect(
        describeSendResult({ targeted: 5, push_sent: 3, push_failed: 0, in_app_only: 2, dispatch_status: 'sent' })
      ).toEqual({
        title: 'Alert sent to 5 residents',
        detail: 'Push delivered to 3. 2 will see it in the app.',
      });
      expect(
        describeSendResult({ targeted: 1, push_sent: 0, push_failed: 0, in_app_only: 1, dispatch_status: 'no_push' })
          .detail
      ).toMatch(/in the app/);
      expect(
        describeSendResult({ targeted: 4, push_sent: 2, push_failed: 2, in_app_only: 0, dispatch_status: 'partial' })
          .detail
      ).toMatch(/failed for 2/);
      expect(
        describeSendResult({ targeted: 1, push_sent: 0, push_failed: 1, in_app_only: 0, dispatch_status: 'failed' })
          .detail
      ).toMatch(/still see it in the app/);
      expect(
        describeSendResult({ targeted: 1, push_sent: 0, push_failed: 0, in_app_only: 0, dispatch_status: 'sent', duplicate: true })
          .title
      ).toBe('Already sent');
    });
    it('computes the IST date', () => {
      expect(istDateIso(new Date('2026-11-15T20:00:00Z'))).toBe('2026-11-16');
      expect(istDateIso(new Date('2026-11-15T10:00:00Z'))).toBe('2026-11-15');
    });
    it('formats same-day times with Today prefix and lowercase meridiem', () => {
      const now = new Date('2026-11-15T12:00:00');
      expect(formatAlertTime('2026-11-15T09:30:00', now)).toMatch(/^Today, /);
      expect(formatAlertTime('2026-11-15T20:05:00', now)).toContain('pm');
      expect(formatAlertTime('2026-11-10T09:30:00', now)).not.toMatch(/^Today/);
    });
    it('expires prior-day and past-meal food alerts automatically', () => {
      const staleNov15 = new Date(2026, 10, 15, 20, 0, 0).toISOString();
      const nov16Noon = new Date(2026, 10, 16, 12, 0, 0);
      expect(isFoodAlertExpired('dinner', staleNov15, nov16Noon)).toBe(true);

      const sameDayMorning = new Date(2026, 10, 16, 8, 0, 0).toISOString();
      expect(
        isFoodAlertExpired('breakfast', sameDayMorning, new Date(2026, 10, 16, 10, 0, 0))
      ).toBe(false);
      expect(
        isFoodAlertExpired('breakfast', sameDayMorning, new Date(2026, 10, 16, 12, 0, 0))
      ).toBe(true);
    });
    it('formats specific food alert body using meal time or returns empty string without placeholder copy', () => {
      expect(formatFoodAlertBody('dinner', 'ready', null, '20:00')).toBe(
        'Dinner is served at 8:00 pm.'
      );
      expect(formatFoodAlertBody('lunch', 'delayed', 'Delayed by 15 mins', '13:00')).toBe(
        'Delayed by 15 mins'
      );
      expect(formatFoodAlertBody('dinner', 'ready', null, null)).toBe('');
    });

    it('evaluates meal cutoffs and midnight boundaries strictly in IST regardless of host timezone', () => {
      // 2026-11-16T05:59:00Z === 11:29 IST (1 min before 11:30 breakfast cutoff)
      const createdMorningIst = '2026-11-16T02:30:00.000Z'; // 08:00 IST
      expect(
        isFoodAlertExpiredAtIst(
          'breakfast',
          createdMorningIst,
          new Date('2026-11-16T05:59:00.000Z')
        )
      ).toBe(false);
      // 2026-11-16T06:00:00Z === 11:30 IST (breakfast cutoff reached)
      expect(
        isFoodAlertExpiredAtIst(
          'breakfast',
          createdMorningIst,
          new Date('2026-11-16T06:00:00.000Z')
        )
      ).toBe(true);
      // 2026-11-16T18:35:00Z === 2026-11-17T00:05:00 IST (post-midnight in IST, expires prior dinner alert)
      expect(
        isFoodAlertExpiredAtIst(
          'dinner',
          '2026-11-16T14:30:00.000Z',
          new Date('2026-11-16T18:35:00.000Z')
        )
      ).toBe(true);
    });
  });
});
