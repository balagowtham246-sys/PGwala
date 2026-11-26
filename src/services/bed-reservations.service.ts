import { fail, ok, ServiceResult } from '@/lib/service-result';
import { supabase } from '@/lib/supabase';
import { normalizeRoomCode } from '@/lib/ux-utils';

export type BedReservationStatus = 'reserved' | 'converted' | 'cancelled';

export interface BedReservation {
  id: string;
  property_id: string;
  room_number: string;
  bed_label: string;
  prospect_name: string;
  phone_number: string;
  expected_join_date: string;
  token_advance_paise: number;
  status: BedReservationStatus;
  converted_resident_id: string | null;
  created_at: string;
}

export interface CreateBedReservationInput {
  propertyId: string;
  roomNumber: string;
  bedLabel: string;
  prospectName: string;
  phoneNumber: string;
  expectedJoinDate: string;
  tokenAdvancePaise: number;
}

function isMissingTableError(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  const msg = (err.message || '').toLowerCase();
  return (
    err.code === '42P01' ||
    err.code === 'PGRST205' ||
    msg.includes('does not exist') ||
    msg.includes('could not find the table') ||
    msg.includes('schema cache')
  );
}

function isUniqueViolation(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  const msg = (err.message || '').toLowerCase();
  return err.code === '23505' || msg.includes('duplicate key') || msg.includes('unique constraint');
}

export function buildBedSlotKey(roomNumber: string, bedLabel: string): string {
  const normRoom = (normalizeRoomCode(roomNumber) || roomNumber.trim()).toLowerCase();
  const normBed = bedLabel.trim().toLowerCase();
  return `${normRoom}::${normBed}`;
}

export async function fetchActiveBedReservations(
  propertyId: string
): Promise<ServiceResult<BedReservation[]>> {
  try {
    const { data, error } = await supabase
      .from('bed_reservations')
      .select(
        'id, property_id, room_number, bed_label, prospect_name, phone_number, expected_join_date, token_advance_paise, status, converted_resident_id, created_at'
      )
      .eq('property_id', propertyId)
      .eq('status', 'reserved')
      .order('expected_join_date', { ascending: true });

    if (error) {
      if (isMissingTableError(error)) {
        return ok([]);
      }
      return fail(error, 'Could not load bed reservations.');
    }

    return ok((data as BedReservation[]) ?? []);
  } catch (err) {
    return fail(err, 'Could not load bed reservations.');
  }
}

export async function createBedReservation(
  input: CreateBedReservationInput
): Promise<ServiceResult<BedReservation>> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const cleanRoom = normalizeRoomCode(input.roomNumber) || input.roomNumber.trim();
    const cleanBed = input.bedLabel.trim();

    const { data, error } = await supabase
      .from('bed_reservations')
      .insert({
        property_id: input.propertyId,
        room_number: cleanRoom,
        bed_label: cleanBed,
        prospect_name: input.prospectName.trim(),
        phone_number: input.phoneNumber.trim(),
        expected_join_date: input.expectedJoinDate.trim(),
        token_advance_paise: Math.max(0, Math.round(input.tokenAdvancePaise || 0)),
        status: 'reserved',
        created_by: user?.id ?? null,
      })
      .select(
        'id, property_id, room_number, bed_label, prospect_name, phone_number, expected_join_date, token_advance_paise, status, converted_resident_id, created_at'
      )
      .single();

    if (error) {
      if (isMissingTableError(error)) {
        return fail(
          new Error('Bed reservations require the latest database migration. Please push migration 35.')
        );
      }
      if (isUniqueViolation(error)) {
        return fail(new Error('This bed is already reserved. Refresh to see the latest status.'));
      }
      return fail(error, 'Could not reserve bed.');
    }

    return ok(data as BedReservation);
  } catch (err) {
    return fail(err, 'Could not reserve bed.');
  }
}

export async function cancelBedReservation(
  reservationId: string
): Promise<ServiceResult<void>> {
  try {
    const { error } = await supabase
      .from('bed_reservations')
      .update({
        status: 'cancelled',
        updated_at: new Date().toISOString(),
      })
      .eq('id', reservationId);

    if (error) {
      return fail(error, 'Could not cancel reservation.');
    }

    return ok(undefined);
  } catch (err) {
    return fail(err, 'Could not cancel reservation.');
  }
}

export async function markBedReservationConverted(
  reservationId: string,
  residentId: string
): Promise<ServiceResult<void>> {
  try {
    const { error } = await supabase
      .from('bed_reservations')
      .update({
        status: 'converted',
        converted_resident_id: residentId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', reservationId);

    if (error) {
      if (isMissingTableError(error)) {
        return ok(undefined);
      }
      return fail(error, 'Could not mark reservation as converted.');
    }

    return ok(undefined);
  } catch (err) {
    return fail(err, 'Could not mark reservation as converted.');
  }
}
