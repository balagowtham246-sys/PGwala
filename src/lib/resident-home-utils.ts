export type MealType = 'breakfast' | 'lunch' | 'dinner';

/**
 * Returns the next upcoming meal based on the local time of day:
 * - Before 10:00 AM -> breakfast
 * - 10:00 AM to 2:59 PM -> lunch
 * - 3:00 PM onwards -> dinner
 */
export function getNextUpcomingMeal(now: Date = new Date()): MealType {
  const hour = now.getHours();
  if (hour < 10) return 'breakfast';
  if (hour < 15) return 'lunch';
  return 'dinner';
}

export function getFirstName(fullName: string | null | undefined): string {
  const trimmed = (fullName || '').trim();
  if (!trimmed) return 'Resident';
  return trimmed.split(/\s+/)[0];
}

export function getChatLastSeenStorageKey(propertyId: string): string {
  return `pgwala_chat_last_seen_${propertyId}`;
}

export function hasUnreadChatMessage(
  latestMessageIso: string | null | undefined,
  lastSeenIso: string | null | undefined
): boolean {
  if (!latestMessageIso) return false;
  const latestMs = new Date(latestMessageIso).getTime();
  if (Number.isNaN(latestMs)) return false;
  if (!lastSeenIso) return true;
  const lastSeenMs = new Date(lastSeenIso).getTime();
  if (Number.isNaN(lastSeenMs)) return true;
  return latestMs > lastSeenMs;
}
