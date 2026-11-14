import { sortComplaintsByUrgencyThenDate } from '@/lib/complaint-utils';

describe('sortComplaintsByUrgencyThenDate', () => {
  it('places active issues before resolved/rejected ones', () => {
    const input = [
      { id: '1', status: 'resolved', priority: 'urgent', created_at: '2026-11-10T10:00:00Z' },
      { id: '2', status: 'open', priority: 'low', created_at: '2026-11-09T10:00:00Z' },
    ];
    const sorted = sortComplaintsByUrgencyThenDate(input);
    expect(sorted.map((i) => i.id)).toEqual(['2', '1']);
  });

  it('orders active issues by urgent -> high -> medium -> low', () => {
    const input = [
      { id: 'low', status: 'open', priority: 'low', created_at: '2026-11-12T10:00:00Z' },
      { id: 'med', status: 'in_progress', priority: 'medium', created_at: '2026-11-11T10:00:00Z' },
      { id: 'urg', status: 'open', priority: 'urgent', created_at: '2026-11-08T10:00:00Z' },
      { id: 'high', status: 'open', priority: 'high', created_at: '2026-11-10T10:00:00Z' },
    ];
    const sorted = sortComplaintsByUrgencyThenDate(input);
    expect(sorted.map((i) => i.id)).toEqual(['urg', 'high', 'med', 'low']);
  });

  it('breaks priority ties by newest created_at first without mutating input', () => {
    const input = [
      { id: 'older', status: 'open', priority: 'high', created_at: '2026-11-08T10:00:00Z' },
      { id: 'newer', status: 'open', priority: 'high', created_at: '2026-11-10T10:00:00Z' },
    ];
    const sorted = sortComplaintsByUrgencyThenDate(input);
    expect(sorted.map((i) => i.id)).toEqual(['newer', 'older']);
    expect(input[0].id).toBe('older');
  });
});
