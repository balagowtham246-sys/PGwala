import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '@/lib/query-keys';
import { supabase } from '@/lib/supabase';
import {
  checkoutResident,
  fetchResidentProfile,
  fetchResidentsDirectory,
  ResidentDirectoryItem,
  ResidentProfileData,
  ResidentUpdatePatch,
  updateResidentWithLock,
  UpdateResidentLockResult,
} from '@/services/residents.service';

export interface ActiveResidentPeer {
  id: string;
  room_number: string;
  phone_number: string | null;
  full_name: string;
}

export function useResidentsDirectoryQuery(propertyId: string | null | undefined) {
  return useQuery<ResidentDirectoryItem[], Error>({
    queryKey: queryKeys.residents.directory(propertyId ?? ''),
    enabled: Boolean(propertyId),
    queryFn: async () => {
      const res = await fetchResidentsDirectory(propertyId!);
      if (!res.ok) {
        throw new Error(res.error.message);
      }
      return res.data;
    },
  });
}

export function useResidentProfileQuery(residentId: string | undefined) {
  return useQuery<ResidentProfileData, Error>({
    queryKey: queryKeys.residents.detail(residentId ?? ''),
    enabled: Boolean(residentId),
    queryFn: async () => {
      const res = await fetchResidentProfile(residentId!);
      if (!res.ok) {
        throw new Error(res.error.message);
      }
      return res.data;
    },
  });
}

export function useActiveResidentPeersQuery(propertyId: string | null | undefined) {
  return useQuery<ActiveResidentPeer[], Error>({
    queryKey: queryKeys.residents.activePeers(propertyId ?? ''),
    enabled: Boolean(propertyId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('residents')
        .select('id, room_number, phone_number, full_name')
        .eq('property_id', propertyId!)
        .eq('is_active', true);

      if (error) throw error;
      return (data as ActiveResidentPeer[]) ?? [];
    },
  });
}

export interface UpdateResidentWithLockVariables {
  residentId: string;
  propertyId: string;
  loadedUpdatedAt: string | null;
  patch: ResidentUpdatePatch;
}

interface UpdateResidentMutationContext {
  detailKey: ReturnType<typeof queryKeys.residents.detail>;
  previousDetail: ResidentProfileData | undefined;
  previousDirectoryQueries: [
    readonly unknown[],
    ResidentDirectoryItem[] | undefined,
  ][];
}

export function useUpdateResidentWithLockMutation() {
  const qc = useQueryClient();

  return useMutation<
    UpdateResidentLockResult,
    Error,
    UpdateResidentWithLockVariables,
    UpdateResidentMutationContext
  >({
    mutationFn: async ({ residentId, propertyId, loadedUpdatedAt, patch }) => {
      const res = await updateResidentWithLock(
        residentId,
        propertyId,
        loadedUpdatedAt,
        patch
      );
      if (!res.ok) {
        throw new Error(res.error.message);
      }
      return res.data;
    },
    onMutate: async ({ residentId, patch }) => {
      await qc.cancelQueries({ queryKey: queryKeys.residents.all });
      const detailKey = queryKeys.residents.detail(residentId);
      const previousDetail = qc.getQueryData<ResidentProfileData>(detailKey);
      const previousDirectoryQueries = qc.getQueriesData<ResidentDirectoryItem[]>({
        queryKey: ['residents', 'directory'],
      });

      if (previousDetail) {
        qc.setQueryData<ResidentProfileData>(detailKey, {
          ...previousDetail,
          ...(patch.full_name !== undefined ? { fullName: patch.full_name } : {}),
          ...(patch.room_number !== undefined ? { roomNumber: patch.room_number } : {}),
          ...(patch.bed_label !== undefined ? { bedLabel: patch.bed_label } : {}),
          ...(patch.phone_number !== undefined ? { phoneNumber: patch.phone_number } : {}),
          ...(patch.gender !== undefined ? { gender: patch.gender } : {}),
          ...(patch.joining_date !== undefined ? { joiningDate: patch.joining_date } : {}),
          ...(patch.monthly_rent_paise !== undefined
            ? { monthlyRentPaise: patch.monthly_rent_paise }
            : {}),
          ...(patch.deposit_paise !== undefined
            ? { depositPaise: patch.deposit_paise }
            : {}),
          ...(patch.emergency_contact !== undefined
            ? { emergencyContact: patch.emergency_contact }
            : {}),
          ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
        });
      }

      for (const [key, list] of previousDirectoryQueries) {
        if (!list) continue;
        qc.setQueryData<ResidentDirectoryItem[]>(
          key,
          list.map((item) => {
            if (item.id !== residentId) return item;
            return {
              ...item,
              ...(patch.full_name !== undefined ? { fullName: patch.full_name } : {}),
              ...(patch.room_number !== undefined ? { roomNumber: patch.room_number } : {}),
              ...(patch.bed_label !== undefined ? { bedLabel: patch.bed_label } : {}),
              ...(patch.phone_number !== undefined ? { phoneNumber: patch.phone_number } : {}),
              ...(patch.gender !== undefined ? { gender: patch.gender } : {}),
              ...(patch.joining_date !== undefined ? { joiningDate: patch.joining_date } : {}),
              ...(patch.monthly_rent_paise !== undefined
                ? { monthlyRentPaise: patch.monthly_rent_paise }
                : {}),
              ...(patch.deposit_paise !== undefined
                ? { depositPaise: patch.deposit_paise }
                : {}),
            };
          })
        );
      }

      return { detailKey, previousDetail, previousDirectoryQueries };
    },
    onSuccess: (result, _variables, context) => {
      if (result.status !== 'saved' && context) {
        qc.setQueryData(context.detailKey, context.previousDetail);
        for (const [key, list] of context.previousDirectoryQueries) {
          qc.setQueryData(key, list);
        }
      }
    },
    onError: (_err, _variables, context) => {
      if (!context) return;
      qc.setQueryData(context.detailKey, context.previousDetail);
      for (const [key, list] of context.previousDirectoryQueries) {
        qc.setQueryData(key, list);
      }
    },
    onSettled: (_data, _err, variables) => {
      void qc.invalidateQueries({
        queryKey: queryKeys.residents.detail(variables.residentId),
      });
      void qc.invalidateQueries({
        queryKey: queryKeys.residents.directory(variables.propertyId),
      });
      void qc.invalidateQueries({
        queryKey: queryKeys.residents.activePeers(variables.propertyId),
      });
      void qc.invalidateQueries({
        queryKey: ['dashboard', 'owner', variables.propertyId],
      });
      void qc.invalidateQueries({
        queryKey: ['billing', 'owner', variables.propertyId],
      });
      void qc.invalidateQueries({
        queryKey: queryKeys.movement.property(variables.propertyId),
      });
    },
  });
}

export interface CheckoutResidentVariables {
  residentId: string;
  propertyId: string;
  leavingDateIso: string;
  generateFinalBill: boolean;
  finalBillPaise: number;
}

interface CheckoutResidentMutationContext {
  detailKey: ReturnType<typeof queryKeys.residents.detail>;
  directoryKey: ReturnType<typeof queryKeys.residents.directory>;
  previousDetail: ResidentProfileData | undefined;
  previousDirectory: ResidentDirectoryItem[] | undefined;
}

export function useCheckoutResidentMutation() {
  const qc = useQueryClient();

  return useMutation<
    { finalBillCreated: boolean; releasedMachinesCount: number },
    Error,
    CheckoutResidentVariables,
    CheckoutResidentMutationContext
  >({
    mutationFn: async (input) => {
      const res = await checkoutResident(input);
      if (!res.ok) {
        throw new Error(res.error.message);
      }
      return res.data;
    },
    onMutate: async ({ residentId, propertyId, leavingDateIso }) => {
      const detailKey = queryKeys.residents.detail(residentId);
      const directoryKey = queryKeys.residents.directory(propertyId);
      await Promise.all([
        qc.cancelQueries({ queryKey: detailKey }),
        qc.cancelQueries({ queryKey: directoryKey }),
      ]);
      const previousDetail = qc.getQueryData<ResidentProfileData>(detailKey);
      const previousDirectory = qc.getQueryData<ResidentDirectoryItem[]>(directoryKey);

      if (previousDetail) {
        qc.setQueryData<ResidentProfileData>(detailKey, {
          ...previousDetail,
          isActive: false,
          leftAt: leavingDateIso,
        });
      }
      if (previousDirectory) {
        qc.setQueryData<ResidentDirectoryItem[]>(
          directoryKey,
          previousDirectory.filter((item) => item.id !== residentId)
        );
      }

      return { detailKey, directoryKey, previousDetail, previousDirectory };
    },
    onError: (_err, _vars, context) => {
      if (!context) return;
      qc.setQueryData(context.detailKey, context.previousDetail);
      qc.setQueryData(context.directoryKey, context.previousDirectory);
    },
    onSettled: (_data, _err, variables) => {
      void qc.invalidateQueries({
        queryKey: queryKeys.residents.detail(variables.residentId),
      });
      void qc.invalidateQueries({
        queryKey: queryKeys.residents.directory(variables.propertyId),
      });
      void qc.invalidateQueries({
        queryKey: queryKeys.residents.activePeers(variables.propertyId),
      });
      void qc.invalidateQueries({
        queryKey: ['dashboard', 'owner', variables.propertyId],
      });
      void qc.invalidateQueries({
        queryKey: ['billing', 'owner', variables.propertyId],
      });
      void qc.invalidateQueries({
        queryKey: queryKeys.movement.property(variables.propertyId),
      });
      void qc.invalidateQueries({
        queryKey: queryKeys.washingMachine.property(variables.propertyId),
      });
    },
  });
}
