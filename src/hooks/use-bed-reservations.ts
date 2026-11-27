import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '@/lib/query-keys';
import { broadcastPropertySync } from '@/lib/realtime-sync';
import { PropertyGenderType } from '@/lib/ux-utils';
import {
  BedReservation,
  cancelBedReservation,
  createBedReservation,
  CreateBedReservationInput,
  fetchActiveBedReservations,
} from '@/services/bed-reservations.service';
import {
  fetchRoomsWithOccupancy,
  RoomWithOccupancy,
} from '@/services/residents.service';

export function usePropertyRoomsQuery(
  propertyId: string | null | undefined,
  propertyGender?: PropertyGenderType
) {
  return useQuery<RoomWithOccupancy[], Error>({
    queryKey: queryKeys.residents.rooms(propertyId ?? ''),
    enabled: Boolean(propertyId),
    queryFn: async () => {
      const res = await fetchRoomsWithOccupancy(propertyId!, {
        propertyGender,
      });
      if (!res.ok) {
        throw new Error(res.error.message);
      }
      return res.data;
    },
  });
}

export function useActiveBedReservationsQuery(
  propertyId: string | null | undefined
) {
  return useQuery<BedReservation[], Error>({
    queryKey: queryKeys.residents.reservations(propertyId ?? ''),
    enabled: Boolean(propertyId),
    queryFn: async () => {
      const res = await fetchActiveBedReservations(propertyId!);
      if (!res.ok) {
        throw new Error(res.error.message);
      }
      return res.data;
    },
  });
}

export function useCreateBedReservationMutation() {
  const qc = useQueryClient();

  return useMutation<BedReservation, Error, CreateBedReservationInput>({
    mutationFn: async (input) => {
      const res = await createBedReservation(input);
      if (!res.ok) {
        throw new Error(res.error.message);
      }
      return res.data;
    },
    onSettled: (_data, err, variables) => {
      if (!err) broadcastPropertySync('residents', variables.propertyId);
      void qc.invalidateQueries({
        queryKey: queryKeys.residents.reservations(variables.propertyId),
      });
      void qc.invalidateQueries({
        queryKey: queryKeys.residents.rooms(variables.propertyId),
      });
    },
  });
}

export function useCancelBedReservationMutation() {
  const qc = useQueryClient();

  return useMutation<
    void,
    Error,
    { reservationId: string; propertyId: string },
    {
      reservationsKey: ReturnType<typeof queryKeys.residents.reservations>;
      previousReservations: BedReservation[] | undefined;
    }
  >({
    mutationFn: async ({ reservationId }) => {
      const res = await cancelBedReservation(reservationId);
      if (!res.ok) {
        throw new Error(res.error.message);
      }
    },
    onMutate: async ({ reservationId, propertyId }) => {
      const reservationsKey = queryKeys.residents.reservations(propertyId);
      await qc.cancelQueries({ queryKey: reservationsKey });
      const previousReservations =
        qc.getQueryData<BedReservation[]>(reservationsKey);
      if (previousReservations) {
        qc.setQueryData<BedReservation[]>(
          reservationsKey,
          previousReservations.filter((r) => r.id !== reservationId)
        );
      }
      return { reservationsKey, previousReservations };
    },
    onError: (_err, _vars, context) => {
      if (!context) return;
      qc.setQueryData(context.reservationsKey, context.previousReservations);
    },
    onSettled: (_data, err, variables) => {
      if (!err) broadcastPropertySync('residents', variables.propertyId);
      void qc.invalidateQueries({
        queryKey: queryKeys.residents.reservations(variables.propertyId),
      });
      void qc.invalidateQueries({
        queryKey: queryKeys.residents.rooms(variables.propertyId),
      });
    },
  });
}
