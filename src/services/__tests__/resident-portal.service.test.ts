import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  clearOfflineQueue,
  flushOfflineQueue,
  getOfflineQueue,
} from '@/lib/offline-queue';
import { resetPerfMonitor } from '@/lib/perf-monitor';
import { clearQueryCache } from '@/lib/query-cache';
import { supabase } from '@/lib/supabase';
import { defaultOfflineExecutors } from '@/services/offline-executors';
import {
  fetchResidentAccommodation,
  fetchResidentMultiDayMenus,
  updateResidentEmergencyContact,
} from '../resident-portal.service';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
    rpc: jest.fn(),
  },
}));

const mockedFrom = supabase.from as jest.Mock;
const mockedRpc = supabase.rpc as jest.Mock;

describe('resident-portal.service', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    resetPerfMonitor();
    await clearQueryCache();
    await AsyncStorage.clear();
  });

  describe('fetchResidentAccommodation', () => {
    it('loads full accommodation details and owner contact on migrated schema', async () => {
      mockedFrom.mockImplementation((table: string) => {
        if (table === 'residents') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: jest.fn().mockResolvedValue({
                    data: {
                      id: 'res-1',
                      property_id: 'prop-1',
                      room_number: 'D',
                      bed_label: 'Bed 2',
                      joining_date: '2026-08-01',
                      monthly_rent_paise: 850000,
                      deposit_paise: 1500000,
                      emergency_contact: '9876543210',
                      property: {
                        name: 'Sunrise PG',
                        address: '12 Anna Nagar, Chennai',
                        owner_id: 'owner-1',
                      },
                    },
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }

        if (table === 'profiles') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: jest.fn().mockResolvedValue({
                  data: {
                    full_name: 'Karthik Rajan',
                    phone_number: '9988776655',
                  },
                  error: null,
                }),
              }),
            }),
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      });

      const res = await fetchResidentAccommodation('user-1');

      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.data).toEqual({
          residentId: 'res-1',
          propertyId: 'prop-1',
          propertyName: 'Sunrise PG',
          propertyAddress: '12 Anna Nagar, Chennai',
          roomNumber: 'D',
          bedLabel: 'Bed 2',
          joiningDate: '2026-08-01',
          monthlyRentPaise: 850000,
          depositPaise: 1500000,
          emergencyContact: '9876543210',
          ownerName: 'Karthik Rajan',
          ownerPhone: '9988776655',
          wifiSsid: null,
          wifiPassword: null,
          curfewTime: null,
          wardenName: null,
          wardenPhone: null,
        });
      }
    });

    it('falls back to basic query and local metadata when extended columns return 42703 or 42501', async () => {
      await AsyncStorage.setItem(
        '@pgwala_resident_meta:res-1',
        JSON.stringify({
          bed_label: 'Bed 1',
          joining_date: '2026-09-15',
          deposit_paise: 1000000,
          emergency_contact: 'Parent 9123456789',
        })
      );

      for (const errCode of ['42703', '42501']) {
        jest.clearAllMocks();
        const selectCalls: string[] = [];

        mockedFrom.mockImplementation((table: string) => {
          if (table === 'residents') {
            return {
              select: (cols: string) => {
                selectCalls.push(cols);
                const isRichQuery = cols.includes('bed_label');
                return {
                  eq: () => ({
                    eq: () => ({
                      maybeSingle: jest.fn().mockResolvedValue(
                        isRichQuery
                          ? {
                              data: null,
                              error: {
                                code: errCode,
                                message:
                                  errCode === '42703'
                                    ? 'column residents.bed_label does not exist'
                                    : 'permission denied for column bed_label',
                              },
                            }
                          : {
                              data: {
                                id: 'res-1',
                                property_id: 'prop-1',
                                room_number: '101',
                                monthly_rent_paise: 750000,
                                property: [
                                  {
                                    name: 'Green View PG',
                                    address: null,
                                    owner_id: 'owner-2',
                                  },
                                ],
                              },
                              error: null,
                            }
                      ),
                    }),
                  }),
                };
              },
            };
          }

          if (table === 'profiles') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: jest.fn().mockResolvedValue({
                    data: { full_name: 'Meena', phone_number: null },
                    error: null,
                  }),
                }),
              }),
            };
          }

          throw new Error(`Unexpected table: ${table}`);
        });

        const res = await fetchResidentAccommodation('user-1');

        expect(selectCalls).toHaveLength(2);
        expect(selectCalls[0]).toContain('bed_label');
        expect(selectCalls[1]).not.toContain('bed_label');
        expect(res.ok).toBe(true);
        if (res.ok) {
          expect(res.data).toEqual({
            residentId: 'res-1',
            propertyId: 'prop-1',
            propertyName: 'Green View PG',
            propertyAddress: null,
            roomNumber: '101',
            bedLabel: 'Bed 1',
            joiningDate: '2026-09-15',
            monthlyRentPaise: 750000,
            depositPaise: 1000000,
            emergencyContact: 'Parent 9123456789',
            ownerName: 'Meena',
            ownerPhone: null,
            wifiSsid: null,
            wifiPassword: null,
            curfewTime: null,
            wardenName: null,
            wardenPhone: null,
          });
        }
      }
    });

    it('hydrates Wi-Fi, curfew, and active warden contact when configured on DB', async () => {
      mockedFrom.mockImplementation((table: string) => {
        if (table === 'residents') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: jest.fn().mockResolvedValue({
                    data: {
                      id: 'res-1',
                      property_id: 'prop-1',
                      room_number: '101',
                      bed_label: 'Bed A',
                      joining_date: '2026-08-01',
                      monthly_rent_paise: 900000,
                      deposit_paise: 1500000,
                      emergency_contact: null,
                      property: {
                        name: 'Sunrise PG',
                        address: '12 Anna Nagar',
                        owner_id: 'owner-1',
                        wifi_ssid: 'Sunrise-5G',
                        wifi_password: 'wifi@2026',
                        curfew_time: '22:30',
                      },
                    },
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }

        if (table === 'property_wardens') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: jest.fn().mockResolvedValue({
                    data: { warden_profile_id: 'warden-1' },
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }

        if (table === 'profiles') {
          return {
            select: () => ({
              eq: (_col: string, id: string) => ({
                maybeSingle: jest.fn().mockResolvedValue({
                  data:
                    id === 'owner-1'
                      ? { full_name: 'Karthik Rajan', phone_number: '9988776655' }
                      : id === 'warden-1'
                        ? { full_name: 'Suresh Kumar', phone_number: '9876501234' }
                        : null,
                  error: null,
                }),
              }),
            }),
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      });

      const res = await fetchResidentAccommodation('user-1');

      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.data).toMatchObject({
          propertyName: 'Sunrise PG',
          ownerName: 'Karthik Rajan',
          ownerPhone: '9988776655',
          wifiSsid: 'Sunrise-5G',
          wifiPassword: 'wifi@2026',
          curfewTime: '22:30',
          wardenName: 'Suresh Kumar',
          wardenPhone: '9876501234',
        });
      }
    });

    it('merges @pgwala_property_meta on unmigrated DB and falls back to null when unset or warden RLS-blocked', async () => {
      await AsyncStorage.setItem(
        '@pgwala_property_meta:prop-1',
        JSON.stringify({
          wifi_ssid: 'LocalPG-WiFi',
          wifi_password: 'secret123',
          curfew_time: '22:00',
        })
      );

      mockedFrom.mockImplementation((table: string) => {
        if (table === 'residents') {
          return {
            select: (cols: string) => {
              const isRich = cols.includes('wifi_ssid');
              return {
                eq: () => ({
                  eq: () => ({
                    maybeSingle: jest.fn().mockResolvedValue(
                      isRich
                        ? {
                            data: null,
                            error: {
                              code: '42703',
                              message: 'column properties.wifi_ssid does not exist',
                            },
                          }
                        : {
                            data: {
                              id: 'res-1',
                              property_id: 'prop-1',
                              room_number: '101',
                              monthly_rent_paise: 800000,
                              property: {
                                name: 'Sunrise PG',
                                address: null,
                                owner_id: 'owner-1',
                              },
                            },
                            error: null,
                          }
                    ),
                  }),
                }),
              };
            },
          };
        }

        if (table === 'property_wardens') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: jest.fn().mockResolvedValue({
                    data: null,
                    error: { code: '42501', message: 'permission denied for table property_wardens' },
                  }),
                }),
              }),
            }),
          };
        }

        if (table === 'profiles') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: jest.fn().mockResolvedValue({
                  data: { full_name: 'Karthik Rajan', phone_number: null },
                  error: null,
                }),
              }),
            }),
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      });

      const localFallbackRes = await fetchResidentAccommodation('user-1');
      expect(localFallbackRes.ok).toBe(true);
      if (localFallbackRes.ok) {
        expect(localFallbackRes.data).toMatchObject({
          ownerName: 'Karthik Rajan',
          ownerPhone: null,
          wifiSsid: 'LocalPG-WiFi',
          wifiPassword: 'secret123',
          curfewTime: '22:00',
          wardenName: null,
          wardenPhone: null,
        });
      }

      // Now clear local property meta and test null missing-state values
      await AsyncStorage.removeItem('@pgwala_property_meta:prop-1');
      const unsetRes = await fetchResidentAccommodation('user-1');
      expect(unsetRes.ok).toBe(true);
      if (unsetRes.ok) {
        expect(unsetRes.data?.wifiSsid).toBeNull();
        expect(unsetRes.data?.wifiPassword).toBeNull();
        expect(unsetRes.data?.curfewTime).toBeNull();
        expect(unsetRes.data?.wardenName).toBeNull();
        expect(unsetRes.data?.wardenPhone).toBeNull();
      }
    });
  });

  describe('updateResidentEmergencyContact', () => {
    it('calls set_my_emergency_contact RPC and syncs AsyncStorage when RPC succeeds', async () => {
      mockedRpc.mockResolvedValueOnce({ error: null });

      const res = await updateResidentEmergencyContact('res-1', '  98765 43210  ');

      expect(mockedRpc).toHaveBeenCalledWith('set_my_emergency_contact', {
        p_value: '98765 43210',
      });
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.data).toEqual({
          emergencyContact: '98765 43210',
          savedLocally: false,
        });
      }

      const stored = await AsyncStorage.getItem(
        '@pgwala_resident_emergency_contact:res-1'
      );
      expect(JSON.parse(stored!)).toEqual({
        value: '98765 43210',
        pendingLocalFallback: false,
      });
    });

    it('falls back to AsyncStorage when RPC returns 42883 and surfaces fallback in fetchResidentAccommodation', async () => {
      mockedRpc.mockResolvedValueOnce({
        error: {
          code: '42883',
          message: 'function public.set_my_emergency_contact(text) does not exist',
        },
      });

      const updateRes = await updateResidentEmergencyContact(
        'res-1',
        'Ramesh 9900112233'
      );

      expect(updateRes.ok).toBe(true);
      if (updateRes.ok) {
        expect(updateRes.data).toEqual({
          emergencyContact: 'Ramesh 9900112233',
          savedLocally: true,
        });
      }

      const stored = await AsyncStorage.getItem(
        '@pgwala_resident_emergency_contact:res-1'
      );
      expect(JSON.parse(stored!)).toEqual({
        value: 'Ramesh 9900112233',
        pendingLocalFallback: true,
      });

      mockedFrom.mockImplementation((table: string) => {
        if (table === 'residents') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: jest.fn().mockResolvedValue({
                    data: {
                      id: 'res-1',
                      property_id: 'prop-1',
                      room_number: '101',
                      bed_label: null,
                      joining_date: null,
                      monthly_rent_paise: 800000,
                      deposit_paise: 0,
                      emergency_contact: null,
                      property: { name: 'Sunrise PG', address: null, owner_id: null },
                    },
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      });

      const fetchRes = await fetchResidentAccommodation('user-1');
      expect(fetchRes.ok).toBe(true);
      if (fetchRes.ok) {
        expect(fetchRes.data?.emergencyContact).toBe('Ramesh 9900112233');
      }
    });

    it('returns fail when RPC throws an unexpected non-schema error', async () => {
      mockedRpc.mockResolvedValueOnce({
        error: {
          code: '500',
          message: 'internal server error',
        },
      });

      const res = await updateResidentEmergencyContact('res-1', '9876543210');
      expect(res.ok).toBe(false);
    });

    it('queues set_my_emergency_contact offline when network fails and replays via defaultOfflineExecutors', async () => {
      await clearOfflineQueue();
      mockedRpc.mockRejectedValueOnce(new Error('Network request failed'));

      const queuedRes = await updateResidentEmergencyContact(
        'res-1',
        'Ramesh 9900112233'
      );
      expect(queuedRes.ok).toBe(true);
      if (queuedRes.ok) {
        expect(queuedRes.data).toEqual({
          emergencyContact: 'Ramesh 9900112233',
          savedLocally: true,
          queued: true,
        });
      }

      const queuedItems = await getOfflineQueue();
      expect(queuedItems).toHaveLength(1);
      expect(queuedItems[0].operation).toBe('set_my_emergency_contact');
      expect(queuedItems[0].payload).toEqual({
        residentId: 'res-1',
        value: 'Ramesh 9900112233',
      });

      mockedRpc.mockResolvedValueOnce({ error: null });
      const summary = await flushOfflineQueue(defaultOfflineExecutors);
      expect(summary.succeeded).toBe(1);
      expect(summary.remainingCount).toBe(0);
      expect(mockedRpc).toHaveBeenLastCalledWith('set_my_emergency_contact', {
        p_value: 'Ramesh 9900112233',
      });

      const storedAfterSync = await AsyncStorage.getItem(
        '@pgwala_resident_emergency_contact:res-1'
      );
      expect(JSON.parse(storedAfterSync!)).toEqual({
        value: 'Ramesh 9900112233',
        pendingLocalFallback: false,
      });
    });
  });

  describe('fetchResidentMultiDayMenus', () => {
    it('buckets published menus across a 7-day range and populates publishedDates', async () => {
      const datesIso = [
        '2026-11-20',
        '2026-11-21',
        '2026-11-22',
        '2026-11-23',
        '2026-11-24',
        '2026-11-25',
        '2026-11-26',
      ];

      const inSpy = jest.fn().mockResolvedValue({
        data: [
          {
            id: 'm-1',
            menu_date: '2026-11-20',
            meal_type: 'breakfast',
            items: 'Idli, Vada, Sambar',
            notes: 'Served until 9:30 AM',
          },
          {
            id: 'm-2',
            menu_date: '2026-11-20',
            meal_type: 'dinner',
            items: 'Chapati, Dal Tadka',
            notes: null,
          },
          {
            id: 'm-3',
            menu_date: '2026-11-22',
            meal_type: 'lunch',
            items: 'Veg Biryani, Raita',
            notes: 'Sunday special',
          },
        ],
        error: null,
      });

      mockedFrom.mockImplementation((table: string) => {
        if (table === 'food_menus') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  in: inSpy,
                }),
              }),
            }),
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      });

      const res = await fetchResidentMultiDayMenus('prop-1', datesIso);

      expect(inSpy).toHaveBeenCalledWith('menu_date', datesIso);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(Object.keys(res.data.byDate)).toEqual(datesIso);
        expect(res.data.publishedDates).toEqual(['2026-11-20', '2026-11-22']);
        expect(res.data.byDate['2026-11-20'].breakfast?.items).toBe(
          'Idli, Vada, Sambar'
        );
        expect(res.data.byDate['2026-11-20'].lunch).toBeNull();
        expect(res.data.byDate['2026-11-20'].dinner?.items).toBe(
          'Chapati, Dal Tadka'
        );
        expect(res.data.byDate['2026-11-21']).toEqual({
          breakfast: null,
          lunch: null,
          dinner: null,
        });
        expect(res.data.byDate['2026-11-22'].lunch?.notes).toBe(
          'Sunday special'
        );
      }
    });

    it('returns empty map without querying when propertyId or datesIso is empty', async () => {
      const res = await fetchResidentMultiDayMenus('', []);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.data).toEqual({ byDate: {}, publishedDates: [] });
      }
      expect(mockedFrom).not.toHaveBeenCalled();
    });

    it('hydrates meal_time from DB and falls back to basic select + @pgwala_meal_time when unmigrated', async () => {
      await AsyncStorage.setItem(
        '@pgwala_meal_time:prop-1:2026-11-20:breakfast',
        '08:00'
      );

      mockedFrom.mockImplementation((table: string) => {
        if (table === 'food_menus') {
          return {
            select: (cols: string) => {
              const hasMealTimeCol = cols.includes('meal_time');
              return {
                eq: () => ({
                  eq: () => ({
                    in: jest.fn().mockResolvedValue(
                      hasMealTimeCol
                        ? {
                            data: null,
                            error: {
                              code: '42703',
                              message: 'column food_menus.meal_time does not exist',
                            },
                          }
                        : {
                            data: [
                              {
                                id: 'm-1',
                                menu_date: '2026-11-20',
                                meal_type: 'breakfast',
                                items: 'Idli, Sambar',
                                notes: null,
                              },
                            ],
                            error: null,
                          }
                    ),
                  }),
                }),
              };
            },
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      });

      const fallbackRes = await fetchResidentMultiDayMenus('prop-1', ['2026-11-20']);
      expect(fallbackRes.ok).toBe(true);
      if (fallbackRes.ok) {
        expect(fallbackRes.data.byDate['2026-11-20'].breakfast?.meal_time).toBe(
          '08:00'
        );
      }

      // Now simulate migrated DB returning meal_time directly
      mockedFrom.mockImplementation((table: string) => {
        if (table === 'food_menus') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  in: jest.fn().mockResolvedValue({
                    data: [
                      {
                        id: 'm-2',
                        menu_date: '2026-11-20',
                        meal_type: 'dinner',
                        items: 'Chapati, Dal',
                        notes: null,
                        meal_time: '20:00',
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

      const migratedRes = await fetchResidentMultiDayMenus('prop-1', ['2026-11-20']);
      expect(migratedRes.ok).toBe(true);
      if (migratedRes.ok) {
        expect(migratedRes.data.byDate['2026-11-20'].dinner?.meal_time).toBe(
          '20:00'
        );
      }
    });
  });
});
