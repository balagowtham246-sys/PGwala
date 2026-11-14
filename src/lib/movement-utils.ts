/**
 * Shared movement log sorting and local-calendar-day grouping utilities.
 */

export function getLocalDateKey(isoString: string): string {
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) {
    return isoString.split('T')[0] || 'unknown';
  }
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatMovementDayLabel(isoString: string): string {
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) {
    return isoString.split('T')[0] || isoString;
  }

  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  if (d.toDateString() === today.toDateString()) {
    return 'Today';
  }
  if (d.toDateString() === yesterday.toDateString()) {
    return 'Yesterday';
  }

  return d.toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function sortLogsDescending<T extends { event_time: string }>(logs: T[]): T[] {
  return [...logs].sort(
    (a, b) => new Date(b.event_time).getTime() - new Date(a.event_time).getTime()
  );
}

export function groupLogsByLocalDay<T extends { event_time: string }>(
  logs: T[]
): { dateKey: string; dateTitle: string; items: T[] }[] {
  const sorted = sortLogsDescending(logs);
  const map = new Map<string, T[]>();

  for (const log of sorted) {
    const key = getLocalDateKey(log.event_time);
    if (!map.has(key)) {
      map.set(key, []);
    }
    map.get(key)!.push(log);
  }

  const sortedKeys = Array.from(map.keys()).sort((a, b) => b.localeCompare(a));
  return sortedKeys.map((key) => {
    const items = map.get(key)!;
    return {
      dateKey: key,
      dateTitle: formatMovementDayLabel(items[0].event_time),
      items,
    };
  });
}

/**
 * Returns true if the current local time is past the resident's expected return time
 * (e.g., "Evening (~8:00 PM)", "Night (~10:00 PM)", or custom "7:30 PM").
 */
export function isLateReturn(
  expectedReturnTime?: string | null,
  now: Date = new Date()
): boolean {
  if (!expectedReturnTime) return false;
  const trimmed = expectedReturnTime.trim();
  if (!trimmed) return false;

  const lower = trimmed.toLowerCase();
  if (lower.includes('tomorrow')) return false;

  // Match explicit clock times like "8:00 PM", "10:30 pm", "7 PM"
  const match = trimmed.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
  if (!match) return false;

  let hour = parseInt(match[1], 10);
  const minute = match[2] ? parseInt(match[2], 10) : 0;
  const meridiem = match[3].toLowerCase();

  if (meridiem === 'pm' && hour < 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;

  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const expectedMinutes = hour * 60 + minute;
  return currentMinutes > expectedMinutes;
}

/**
 * Returns whether the resident has been checked OUT for at least `thresholdHours` (default 10h).
 */
export function isOutOverHours(
  direction: 'IN' | 'OUT' | null | undefined,
  eventTimeIso: string | null | undefined,
  thresholdHours: number = 10,
  now: Date = new Date()
): { isOver: boolean; hoursOut: number } {
  if (direction !== 'OUT' || !eventTimeIso) {
    return { isOver: false, hoursOut: 0 };
  }
  const eventMs = new Date(eventTimeIso).getTime();
  if (Number.isNaN(eventMs)) {
    return { isOver: false, hoursOut: 0 };
  }
  const diffHours = Math.floor((now.getTime() - eventMs) / (1000 * 60 * 60));
  return {
    isOver: diffHours >= thresholdHours,
    hoursOut: Math.max(0, diffHours),
  };
}

/**
 * Counts distinct local calendar days in `now`'s month where the resident checked OUT.
 */
export function countDaysOutThisMonth(
  logs: { direction: string; event_time: string }[],
  now: Date = new Date()
): number {
  const targetYear = now.getFullYear();
  const targetMonth = now.getMonth();
  const uniqueDays = new Set<string>();

  for (const log of logs) {
    if (log.direction !== 'OUT') continue;
    const d = new Date(log.event_time);
    if (Number.isNaN(d.getTime())) continue;
    if (d.getFullYear() === targetYear && d.getMonth() === targetMonth) {
      uniqueDays.add(getLocalDateKey(log.event_time));
    }
  }

  return uniqueDays.size;
}
