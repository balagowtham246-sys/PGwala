export type PriorityKey = 'low' | 'medium' | 'high' | 'urgent';

const PRIORITY_WEIGHT: Record<string, number> = {
  urgent: 4,
  high: 3,
  medium: 2,
  low: 1,
};

const ACTIVE_STATUSES = new Set(['open', 'in_progress']);

/**
 * Sorts maintenance complaints so active issues appear before resolved/rejected ones,
 * ordered by priority (urgent -> high -> medium -> low) and then newest first.
 */
export function sortComplaintsByUrgencyThenDate<
  T extends { priority: string; status: string; created_at: string },
>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const aActive = ACTIVE_STATUSES.has(a.status) ? 1 : 0;
    const bActive = ACTIVE_STATUSES.has(b.status) ? 1 : 0;
    if (aActive !== bActive) {
      return bActive - aActive;
    }

    const aWeight = PRIORITY_WEIGHT[a.priority] ?? 2;
    const bWeight = PRIORITY_WEIGHT[b.priority] ?? 2;
    if (aWeight !== bWeight) {
      return bWeight - aWeight;
    }

    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
}
