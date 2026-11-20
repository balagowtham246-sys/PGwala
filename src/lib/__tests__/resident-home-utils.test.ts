import {
  getChatLastSeenStorageKey,
  getFirstName,
  getNextUpcomingMeal,
  getSmartDefaultMeal,
  hasUnreadChatMessage,
} from '@/lib/resident-home-utils';

describe('resident-home-utils', () => {
  it('picks the next upcoming meal by hour of day', () => {
    expect(getNextUpcomingMeal(new Date(2026, 10, 14, 8, 30))).toBe('breakfast');
    expect(getNextUpcomingMeal(new Date(2026, 10, 14, 12, 0))).toBe('lunch');
    expect(getNextUpcomingMeal(new Date(2026, 10, 14, 15, 0))).toBe('dinner');
    expect(getNextUpcomingMeal(new Date(2026, 10, 14, 21, 45))).toBe('dinner');
  });

  it('picks smart upcoming published meal without stepping backward', () => {
    const lunchAfternoon = new Date(2026, 10, 14, 12, 30);
    // Current slot is lunch, lunch is missing, dinner is published -> dinner
    expect(
      getSmartDefaultMeal(
        { breakfast: { id: '1' }, lunch: null, dinner: { id: '3' } },
        lunchAfternoon
      )
    ).toBe('dinner');
    // Only breakfast published after lunch -> stay on lunch (show empty state, never jump back to breakfast)
    expect(
      getSmartDefaultMeal(
        { breakfast: { id: '1' }, lunch: null, dinner: null },
        lunchAfternoon
      )
    ).toBe('lunch');
    // Dinner time, only breakfast/lunch published -> stay on dinner
    expect(
      getSmartDefaultMeal(
        { breakfast: { id: '1' }, lunch: { id: '2' }, dinner: null },
        new Date(2026, 10, 14, 17, 0)
      )
    ).toBe('dinner');
  });

  it('extracts first name safely', () => {
    expect(getFirstName('Bala Krishnan')).toBe('Bala');
    expect(getFirstName('  Naveen  ')).toBe('Naveen');
    expect(getFirstName('')).toBe('Resident');
  });

  it('detects unread chat messages against last-seen timestamp', () => {
    expect(getChatLastSeenStorageKey('prop-1')).toBe('pgwala_chat_last_seen_prop-1');
    expect(hasUnreadChatMessage(null, null)).toBe(false);
    expect(hasUnreadChatMessage('2026-11-14T10:00:00Z', null)).toBe(true);
    expect(
      hasUnreadChatMessage('2026-11-14T10:05:00Z', '2026-11-14T10:00:00Z')
    ).toBe(true);
    expect(
      hasUnreadChatMessage('2026-11-14T10:00:00Z', '2026-11-14T10:05:00Z')
    ).toBe(false);
  });
});
