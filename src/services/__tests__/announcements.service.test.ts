import AsyncStorage from '@react-native-async-storage/async-storage';

import { invokeEdgeFunction } from '@/lib/edge-functions';
import { resetPerfMonitor } from '@/lib/perf-monitor';
import { clearQueryCache } from '@/lib/query-cache';
import { supabase } from '@/lib/supabase';
import {
  fetchAnnouncements,
  fetchAnnouncementTargets,
  sendAnnouncement,
} from '../announcements.service';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
  },
}));

jest.mock('@/lib/edge-functions', () => ({
  invokeEdgeFunction: jest.fn(),
}));

const mockedFrom = supabase.from as jest.Mock;
const mockedInvokeEdgeFunction = invokeEdgeFunction as jest.Mock;

function mockResidentsQuery(
  rows: {
    id: string;
    full_name: string;
    room_number: string;
    phone_number: string | null;
    profile_id?: string | null;
  }[]
) {
  return {
    select: () => ({
      eq: () => ({
        eq: () => ({
          order: jest.fn().mockResolvedValue({
            data: rows,
            error: null,
          }),
        }),
      }),
    }),
  };
}

describe('announcements.service', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    resetPerfMonitor();
    await clearQueryCache();
    await AsyncStorage.clear();
  });

  it('normalizes room labels, merges case-insensitive room variants, and sorts rooms naturally', async () => {
    mockedFrom.mockImplementation((table: string) => {
      if (table === 'residents') {
        return mockResidentsQuery([
          {
            id: 'res-1',
            full_name: 'Riya',
            room_number: 'Room 102',
            phone_number: '9876543210',
            profile_id: 'prof-1',
          },
          {
            id: 'res-2',
            full_name: 'Asha',
            room_number: 'Room Room D',
            phone_number: '9876543211',
            profile_id: 'prof-2',
          },
          {
            id: 'res-3',
            full_name: 'Priya',
            room_number: 'd',
            phone_number: '9876543212',
            profile_id: null,
          },
          {
            id: 'res-4',
            full_name: 'Kiran',
            room_number: '2',
            phone_number: '9876543213',
            profile_id: 'prof-4',
          },
          {
            id: 'res-5',
            full_name: 'Vikram',
            room_number: 'Rm 101',
            phone_number: '9876543214',
            profile_id: 'prof-5',
          },
        ]);
      }
      throw new Error(`Unexpected table: ${table}`);
    });

    const res = await fetchAnnouncementTargets('prop-1');

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.residents.map((r) => r.roomNumber)).toEqual([
        '102',
        'D',
        'd',
        '2',
        '101',
      ]);
      expect(res.data.rooms).toEqual([
        { roomNumber: '2', label: 'Room 2', residentCount: 1 },
        { roomNumber: '101', label: 'Room 101', residentCount: 1 },
        { roomNumber: '102', label: 'Room 102', residentCount: 1 },
        { roomNumber: 'D', label: 'Room D', residentCount: 2 },
      ]);
    }
  });

  it('sends push announcement via edge function and persists row in announcements table', async () => {
    mockedInvokeEdgeFunction.mockResolvedValueOnce({ success: true });

    const insertMock = jest.fn().mockImplementation((payload: Record<string, unknown>) => ({
      select: () => ({
        single: jest.fn().mockResolvedValue({
          data: {
            id: 'ann-1',
            property_id: payload.property_id,
            title: payload.title,
            message: payload.message,
            audience: payload.audience,
            room_number: payload.room_number,
            channel: payload.channel,
            recipient_count: payload.recipient_count,
            created_at: '2026-11-20T09:00:00.000Z',
          },
          error: null,
        }),
      }),
    }));

    mockedFrom.mockImplementation((table: string) => {
      if (table === 'residents') {
        return mockResidentsQuery([
          {
            id: 'res-1',
            full_name: 'Asha',
            room_number: '101',
            phone_number: '9876543210',
            profile_id: 'prof-1',
          },
          {
            id: 'res-2',
            full_name: 'Meera',
            room_number: '102',
            phone_number: '9876543211',
            profile_id: null,
          },
        ]);
      }
      if (table === 'announcements') {
        return { insert: insertMock };
      }
      throw new Error(`Unexpected table: ${table}`);
    });

    const res = await sendAnnouncement({
      propertyId: 'prop-1',
      propertyName: 'Sunrise PG',
      ownerId: 'owner-1',
      title: 'Water Tank Cleaning',
      message: 'Supply off from 10 AM to 12 PM.',
      audience: 'all',
      channel: 'push',
    });

    expect(mockedInvokeEdgeFunction).toHaveBeenCalledTimes(1);
    expect(mockedInvokeEdgeFunction).toHaveBeenCalledWith('send-announcement', {
      property_id: 'prop-1',
      property_name: 'Sunrise PG',
      title: 'Water Tank Cleaning',
      message: 'Supply off from 10 AM to 12 PM.',
      audience: 'all',
      room_number: null,
      recipient_profile_ids: ['prof-1'],
    });
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        property_id: 'prop-1',
        owner_id: 'owner-1',
        title: 'Water Tank Cleaning',
        audience: 'all',
        room_number: null,
        channel: 'push',
        recipient_count: 2,
      })
    );

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.pushDeliveredVia).toBe('edge_function');
      expect(res.data.item.id).toBe('ann-1');
      expect(res.data.item.recipientCount).toBe(2);
    }
  });

  it('falls back to local AsyncStorage persistence when push edge function fails and announcements table returns 42P01', async () => {
    mockedInvokeEdgeFunction.mockRejectedValueOnce(new Error('Edge function unavailable'));

    const missingTableError = {
      code: '42P01',
      message: 'relation "public.announcements" does not exist',
    };

    mockedFrom.mockImplementation((table: string) => {
      if (table === 'residents') {
        return mockResidentsQuery([
          {
            id: 'res-1',
            full_name: 'Asha',
            room_number: 'D',
            phone_number: '9876543210',
            profile_id: 'prof-1',
          },
          {
            id: 'res-2',
            full_name: 'Divya',
            room_number: '101',
            phone_number: '9876543211',
            profile_id: 'prof-2',
          },
        ]);
      }
      if (table === 'announcements') {
        return {
          insert: () => ({
            select: () => ({
              single: jest.fn().mockResolvedValue({
                data: null,
                error: missingTableError,
              }),
            }),
          }),
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: jest.fn().mockResolvedValue({
                  data: null,
                  error: missingTableError,
                }),
              }),
            }),
          }),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    });

    const sendRes = await sendAnnouncement({
      propertyId: 'prop-1',
      propertyName: 'Sunrise PG',
      ownerId: 'owner-1',
      title: 'Gate Closing Time',
      message: 'Main gate closes at 10:30 PM.',
      audience: 'all',
      channel: 'push',
    });

    expect(sendRes.ok).toBe(true);
    if (sendRes.ok) {
      expect(sendRes.data.pushDeliveredVia).toBe('local_fallback');
      expect(sendRes.data.item.id.startsWith('local-')).toBe(true);
      expect(sendRes.data.item.recipientCount).toBe(2);
    }

    const historyRes = await fetchAnnouncements('prop-1', { forceRefresh: true });
    expect(historyRes.ok).toBe(true);
    if (historyRes.ok) {
      expect(historyRes.data).toHaveLength(1);
      expect(historyRes.data[0].title).toBe('Gate Closing Time');
      expect(historyRes.data[0].recipientCount).toBe(2);
    }
  });

  it('filters whatsapp announcement targets to a single room when roomNumber "Room D" matches "D"', async () => {
    const insertMock = jest.fn().mockImplementation((payload: Record<string, unknown>) => ({
      select: () => ({
        single: jest.fn().mockResolvedValue({
          data: {
            id: 'ann-wa-1',
            property_id: payload.property_id,
            title: payload.title,
            message: payload.message,
            audience: payload.audience,
            room_number: payload.room_number,
            channel: payload.channel,
            recipient_count: payload.recipient_count,
            created_at: '2026-11-20T10:30:00.000Z',
          },
          error: null,
        }),
      }),
    }));

    mockedFrom.mockImplementation((table: string) => {
      if (table === 'residents') {
        return mockResidentsQuery([
          {
            id: 'res-1',
            full_name: 'Asha',
            room_number: 'D',
            phone_number: '9876543210',
            profile_id: 'prof-1',
          },
          {
            id: 'res-2',
            full_name: 'Priya',
            room_number: 'Room D',
            phone_number: '+91 91234 56789',
            profile_id: 'prof-2',
          },
          {
            id: 'res-3',
            full_name: 'Kiran',
            room_number: '101',
            phone_number: '9988776655',
            profile_id: 'prof-3',
          },
        ]);
      }
      if (table === 'announcements') {
        return { insert: insertMock };
      }
      throw new Error(`Unexpected table: ${table}`);
    });

    const res = await sendAnnouncement({
      propertyId: 'prop-1',
      propertyName: 'Sunrise PG',
      ownerId: 'owner-1',
      title: 'AC Servicing',
      message: 'Technician visiting Room D at 4 PM.',
      audience: 'room',
      roomNumber: 'Room D',
      channel: 'whatsapp',
    });

    expect(mockedInvokeEdgeFunction).not.toHaveBeenCalled();
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        audience: 'room',
        room_number: 'D',
        channel: 'whatsapp',
        recipient_count: 2,
      })
    );

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.pushDeliveredVia).toBe('not_applicable');
      expect(res.data.item.roomNumber).toBe('D');
      expect(res.data.item.recipientCount).toBe(2);
      expect(res.data.whatsappMessage).toBe(
        '*AC Servicing*\nSunrise PG (Room D)\n\nTechnician visiting Room D at 4 PM.'
      );
      expect(res.data.whatsappRecipients).toHaveLength(2);
      expect(res.data.whatsappRecipients.map((r) => r.fullName)).toEqual(['Asha', 'Priya']);
      expect(res.data.whatsappRecipients[0].url).toContain('https://wa.me/919876543210?text=');
      expect(res.data.whatsappRecipients[1].url).toContain('https://wa.me/919123456789?text=');
    }
  });
});
