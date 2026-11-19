import AsyncStorage from '@react-native-async-storage/async-storage';

import { resetPerfMonitor } from '@/lib/perf-monitor';
import { clearQueryCache } from '@/lib/query-cache';
import { supabase } from '@/lib/supabase';
import {
  checkoutResident,
  fetchRoomsWithOccupancy,
  updateResidentWithLock,
} from '../residents.service';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
    rpc: jest.fn(),
    channel: jest.fn(),
    removeChannel: jest.fn(),
  },
}));

const mockedFrom = supabase.from as jest.Mock;

describe('residents.service', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    resetPerfMonitor();
    await clearQueryCache();
    await AsyncStorage.clear();
  });

  describe('fetchRoomsWithOccupancy', () => {
    it('computes free vs occupied bed counts and respects excludeResidentId and gender compatibility', async () => {
      mockedFrom.mockImplementation((table: string) => {
        if (table === 'rooms') {
          return {
            select: () => ({
              eq: jest.fn().mockResolvedValue({
                data: [
                  {
                    id: 'room-101',
                    property_id: 'prop-1',
                    room_number: '101',
                    total_beds: 3,
                    gender_type: 'boys',
                  },
                  {
                    id: 'room-102',
                    property_id: 'prop-1',
                    room_number: '102',
                    total_beds: 2,
                    gender_type: 'girls',
                  },
                  {
                    id: 'room-103',
                    property_id: 'prop-1',
                    room_number: '103',
                    total_beds: 2,
                    gender_type: 'coed',
                  },
                ],
                error: null,
              }),
            }),
          };
        }

        if (table === 'residents') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  order: jest.fn().mockResolvedValue({
                    data: [
                      {
                        id: 'res-1',
                        property_id: 'prop-1',
                        full_name: 'Arjun',
                        room_number: '101',
                        bed_label: 'Bed 1',
                        phone_number: '9876543210',
                        gender: 'male',
                        is_active: true,
                      },
                      {
                        id: 'res-2',
                        property_id: 'prop-1',
                        full_name: 'Vikram',
                        room_number: '101',
                        bed_label: 'Bed 3',
                        phone_number: '9876543211',
                        gender: 'male',
                        is_active: true,
                      },
                      {
                        id: 'res-3',
                        property_id: 'prop-1',
                        full_name: 'Ananya',
                        room_number: '102',
                        bed_label: 'Bed 1',
                        phone_number: '9876543212',
                        gender: 'female',
                        is_active: true,
                      },
                    ],
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      });

      // 1. Check baseline counts for a female resident on a co-ed property
      const res = await fetchRoomsWithOccupancy('prop-1', {
        residentGender: 'female',
        propertyGender: 'coed',
      });

      expect(res.ok).toBe(true);
      if (res.ok) {
        const room101 = res.data.find((r) => r.roomNumber === '101')!;
        const room102 = res.data.find((r) => r.roomNumber === '102')!;
        const room103 = res.data.find((r) => r.roomNumber === '103')!;

        expect(room101.totalBeds).toBe(3);
        expect(room101.occupiedBeds).toBe(2);
        expect(room101.freeBeds).toBe(1);
        expect(room101.isGenderAllowed).toBe(false);
        expect(room101.beds[0]).toEqual({
          bedLabel: 'Bed 1',
          isFree: false,
          occupiedBy: { id: 'res-1', fullName: 'Arjun' },
        });
        expect(room101.beds[1]).toEqual({
          bedLabel: 'Bed 2',
          isFree: true,
          occupiedBy: null,
        });
        expect(room101.beds[2]).toEqual({
          bedLabel: 'Bed 3',
          isFree: false,
          occupiedBy: { id: 'res-2', fullName: 'Vikram' },
        });

        expect(room102.totalBeds).toBe(2);
        expect(room102.occupiedBeds).toBe(1);
        expect(room102.freeBeds).toBe(1);
        expect(room102.isGenderAllowed).toBe(true);

        expect(room103.totalBeds).toBe(2);
        expect(room103.occupiedBeds).toBe(0);
        expect(room103.freeBeds).toBe(2);
        expect(room103.isGenderAllowed).toBe(true);
      }

      // 2. Check excludeResidentId frees the excluded resident's own bed
      const excludedRes = await fetchRoomsWithOccupancy('prop-1', {
        residentGender: 'male',
        propertyGender: 'coed',
        excludeResidentId: 'res-1',
      });

      expect(excludedRes.ok).toBe(true);
      if (excludedRes.ok) {
        const room101 = excludedRes.data.find((r) => r.roomNumber === '101')!;
        expect(room101.occupiedBeds).toBe(1);
        expect(room101.freeBeds).toBe(2);
        expect(room101.beds[0].isFree).toBe(true);
        expect(room101.beds[0].occupiedBy).toBeNull();
        expect(room101.isGenderAllowed).toBe(true);
      }
    });

    it('inherits propertyGender when a room is marked coed on a girls or boys property', async () => {
      mockedFrom.mockImplementation((table: string) => {
        if (table === 'rooms') {
          return {
            select: () => ({
              eq: jest.fn().mockResolvedValue({
                data: [
                  {
                    id: 'room-201',
                    property_id: 'prop-girls',
                    room_number: '201',
                    total_beds: 2,
                    gender_type: 'coed',
                  },
                ],
                error: null,
              }),
            }),
          };
        }
        if (table === 'residents') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  order: jest.fn().mockResolvedValue({ data: [], error: null }),
                }),
              }),
            }),
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      });

      const res = await fetchRoomsWithOccupancy('prop-girls', {
        residentGender: 'male',
        propertyGender: 'girls',
      });

      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.data).toHaveLength(1);
        expect(res.data[0].genderType).toBe('girls');
        expect(res.data[0].isGenderAllowed).toBe(false);
      }
    });
  });

  describe('updateResidentWithLock', () => {
    it('returns stale when updated_at in database does not match loadedUpdatedAt', async () => {
      const updateSpy = jest.fn();

      mockedFrom.mockImplementation((table: string) => {
        if (table === 'residents') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: jest.fn().mockResolvedValue({
                  data: {
                    id: 'res-1',
                    updated_at: '2026-11-19T12:30:00Z',
                  },
                  error: null,
                }),
              }),
            }),
            update: updateSpy,
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      });

      const res = await updateResidentWithLock(
        'res-1',
        'prop-1',
        '2026-11-19T10:00:00Z',
        { notes: 'Updated note' }
      );

      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.data.status).toBe('stale');
      }
      expect(updateSpy).not.toHaveBeenCalled();
    });

    it('returns bed_taken when target bed is already occupied by another resident', async () => {
      const updateSpy = jest.fn();

      mockedFrom.mockImplementation((table: string) => {
        if (table === 'rooms') {
          return {
            select: () => ({
              eq: jest.fn().mockResolvedValue({
                data: [
                  {
                    id: 'room-101',
                    property_id: 'prop-1',
                    room_number: '101',
                    total_beds: 2,
                    gender_type: 'boys',
                  },
                ],
                error: null,
              }),
            }),
          };
        }
        if (table === 'residents') {
          return {
            select: (cols: string) => {
              if (cols === 'id, updated_at') {
                return {
                  eq: () => ({
                    maybeSingle: jest.fn().mockResolvedValue({
                      data: {
                        id: 'res-1',
                        updated_at: '2026-11-19T10:00:00Z',
                      },
                      error: null,
                    }),
                  }),
                };
              }
              return {
                eq: () => ({
                  eq: () => ({
                    order: jest.fn().mockResolvedValue({
                      data: [
                        {
                          id: 'res-1',
                          property_id: 'prop-1',
                          full_name: 'Arjun',
                          room_number: '101',
                          bed_label: 'Bed 1',
                          phone_number: '9876543210',
                          gender: 'male',
                          is_active: true,
                        },
                        {
                          id: 'res-2',
                          property_id: 'prop-1',
                          full_name: 'Karthik',
                          room_number: '101',
                          bed_label: 'Bed 2',
                          phone_number: '9876543219',
                          gender: 'male',
                          is_active: true,
                        },
                      ],
                      error: null,
                    }),
                  }),
                }),
              };
            },
            update: updateSpy,
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      });

      const res = await updateResidentWithLock(
        'res-1',
        'prop-1',
        '2026-11-19T10:00:00Z',
        {
          room_number: '101',
          bed_label: 'Bed 2',
          gender: 'male',
        }
      );

      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.data.status).toBe('bed_taken');
        if (res.data.status === 'bed_taken') {
          expect(res.data.message).toContain('Karthik');
        }
      }
      expect(updateSpy).not.toHaveBeenCalled();
    });

    it('returns saved with new updatedAt when lock matches and target bed is free', async () => {
      const updateEqMock = jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            maybeSingle: jest.fn().mockResolvedValue({
              data: { id: 'res-1', updated_at: '2026-11-19T11:00:00Z' },
              error: null,
            }),
          }),
        }),
      });

      mockedFrom.mockImplementation((table: string) => {
        if (table === 'rooms') {
          return {
            select: () => ({
              eq: jest.fn().mockResolvedValue({
                data: [
                  {
                    id: 'room-101',
                    property_id: 'prop-1',
                    room_number: '101',
                    total_beds: 2,
                    gender_type: 'boys',
                  },
                ],
                error: null,
              }),
            }),
          };
        }
        if (table === 'residents') {
          return {
            select: (cols: string) => {
              if (cols === 'id, updated_at') {
                return {
                  eq: () => ({
                    maybeSingle: jest.fn().mockResolvedValue({
                      data: {
                        id: 'res-1',
                        updated_at: '2026-11-19T10:00:00Z',
                      },
                      error: null,
                    }),
                  }),
                };
              }
              return {
                eq: () => ({
                  eq: () => ({
                    order: jest.fn().mockResolvedValue({
                      data: [
                        {
                          id: 'res-1',
                          property_id: 'prop-1',
                          full_name: 'Arjun',
                          room_number: '101',
                          bed_label: 'Bed 1',
                          phone_number: '9876543210',
                          gender: 'male',
                          is_active: true,
                        },
                      ],
                      error: null,
                    }),
                  }),
                }),
              };
            },
            update: jest.fn().mockReturnValue({
              eq: updateEqMock,
            }),
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      });

      const res = await updateResidentWithLock(
        'res-1',
        'prop-1',
        '2026-11-19T10:00:00Z',
        {
          room_number: '101',
          bed_label: 'Bed 2',
          gender: 'male',
        }
      );

      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.data).toEqual({
          status: 'saved',
          updatedAt: '2026-11-19T11:00:00Z',
        });
      }
    });
  });

  describe('checkoutResident', () => {
    it('marks resident inactive with left_at and creates final charge when generateFinalBill is true', async () => {
      const insertChargeMock = jest.fn().mockResolvedValue({ error: null });
      const residentUpdateEqMock = jest.fn().mockResolvedValue({ error: null });
      const residentUpdateMock = jest.fn().mockReturnValue({
        eq: residentUpdateEqMock,
      });

      mockedFrom.mockImplementation((table: string) => {
        if (table === 'charges') {
          return { insert: insertChargeMock };
        }
        if (table === 'residents') {
          return { update: residentUpdateMock };
        }
        throw new Error(`Unexpected table: ${table}`);
      });

      const res = await checkoutResident({
        residentId: 'res-1',
        propertyId: 'prop-1',
        leavingDateIso: '2026-11-19',
        generateFinalBill: true,
        finalBillPaise: 506700,
      });

      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.data.finalBillCreated).toBe(true);
      }

      expect(insertChargeMock).toHaveBeenCalledWith({
        property_id: 'prop-1',
        resident_id: 'res-1',
        category: 'rent',
        amount_paise: 506700,
        rent_amount_paise: 506700,
        wm_amount_paise: 0,
        status: 'outstanding',
        billing_period_start: '2026-11-01',
        due_date: '2026-11-19',
      });

      expect(residentUpdateMock).toHaveBeenCalledWith({
        is_active: false,
        left_at: '2026-11-19',
      });
      expect(residentUpdateEqMock).toHaveBeenCalledWith('id', 'res-1');
    });

    it('marks resident inactive without creating charge when generateFinalBill is false', async () => {
      const insertChargeMock = jest.fn();
      const residentUpdateEqMock = jest.fn().mockResolvedValue({ error: null });
      const residentUpdateMock = jest.fn().mockReturnValue({
        eq: residentUpdateEqMock,
      });

      mockedFrom.mockImplementation((table: string) => {
        if (table === 'charges') {
          return { insert: insertChargeMock };
        }
        if (table === 'residents') {
          return { update: residentUpdateMock };
        }
        throw new Error(`Unexpected table: ${table}`);
      });

      const res = await checkoutResident({
        residentId: 'res-2',
        propertyId: 'prop-1',
        leavingDateIso: '2026-11-19',
        generateFinalBill: false,
        finalBillPaise: 0,
      });

      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.data.finalBillCreated).toBe(false);
      }
      expect(insertChargeMock).not.toHaveBeenCalled();
      expect(residentUpdateMock).toHaveBeenCalledWith({
        is_active: false,
        left_at: '2026-11-19',
      });
      expect(residentUpdateEqMock).toHaveBeenCalledWith('id', 'res-2');
    });
  });
});
