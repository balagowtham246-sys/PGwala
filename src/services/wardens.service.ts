import { invokeEdgeFunction } from '@/lib/edge-functions';
import { endTrace, recordRoundTrip, startTrace } from '@/lib/perf-monitor';
import { fail, ok, ServiceResult } from '@/lib/service-result';
import { supabase } from '@/lib/supabase';

export interface WardenInfo {
  profile_id: string;
  full_name: string;
  email: string | null;
  phone_number: string | null;
}

export type OwnerWardensMap = Record<string, WardenInfo | null>;

interface RawOwnerWardenRpcRow {
  property_id: string;
  profile_id: string;
  full_name: string | null;
  phone_number: string | null;
  email: string | null;
}

/**
 * Fetches active wardens for all owner properties in a single Postgres RPC (~30ms),
 * with a fast direct PostgREST fallback (zero Edge Function cold starts) if
 * migration 29 has not yet been pushed.
 */
export async function fetchOwnerWardens(
  propertyIds: string[]
): Promise<ServiceResult<OwnerWardensMap>> {
  const map: OwnerWardensMap = {};
  for (const id of propertyIds) {
    map[id] = null;
  }
  if (propertyIds.length === 0) {
    return ok(map);
  }

  const traceLabel = 'wardens:owner:list';
  startTrace(traceLabel);
  try {
    // Fast Path 1: Single-query SQL RPC (includes full_name, phone_number, email)
    const { data: rpcData, error: rpcError } = await supabase.rpc('get_owner_wardens');
    recordRoundTrip(traceLabel, 1);

    if (!rpcError && Array.isArray(rpcData)) {
      for (const row of rpcData as RawOwnerWardenRpcRow[]) {
        if (row.property_id && row.profile_id) {
          map[row.property_id] = {
            profile_id: row.profile_id,
            full_name: row.full_name ?? '',
            phone_number: row.phone_number ?? null,
            email: row.email ?? null,
          };
        }
      }
      return ok(map);
    }

    // Fast Path 2: Direct PostgREST fallback (no Edge Function cold start)
    const { data: pwRows, error: pwError } = await supabase
      .from('property_wardens')
      .select('property_id, warden_profile_id')
      .in('property_id', propertyIds)
      .eq('is_active', true);
    recordRoundTrip(traceLabel, 1);

    if (pwError) {
      return fail(pwError, 'Could not load wardens.');
    }

    const activeAssignments = (pwRows ?? []) as {
      property_id: string;
      warden_profile_id: string;
    }[];

    if (activeAssignments.length === 0) {
      return ok(map);
    }

    const profileIds = [...new Set(activeAssignments.map((r) => r.warden_profile_id))];
    const { data: profileRows } = await supabase
      .from('profiles')
      .select('id, full_name, phone_number')
      .in('id', profileIds);
    recordRoundTrip(traceLabel, 1);

    const profileById = new Map<string, { full_name: string | null; phone_number: string | null }>();
    for (const pr of (profileRows ?? []) as {
      id: string;
      full_name: string | null;
      phone_number: string | null;
    }[]) {
      profileById.set(pr.id, pr);
    }

    for (const assignment of activeAssignments) {
      const pr = profileById.get(assignment.warden_profile_id);
      map[assignment.property_id] = {
        profile_id: assignment.warden_profile_id,
        full_name: pr?.full_name ?? 'Warden',
        phone_number: pr?.phone_number ?? null,
        email: null,
      };
    }

    return ok(map);
  } catch (err) {
    return fail(err, 'Could not load wardens.');
  } finally {
    endTrace(traceLabel);
  }
}

export async function assignPropertyWarden(input: {
  propertyId: string;
  fullName: string;
  email: string;
  phoneNumber?: string;
  temporaryPassword: string;
}): Promise<ServiceResult<WardenInfo>> {
  try {
    const res = await invokeEdgeFunction<{ warden?: WardenInfo }>('manage-warden', {
      action: 'create_and_assign',
      property_id: input.propertyId,
      full_name: input.fullName,
      email: input.email,
      phone_number: input.phoneNumber || undefined,
      temporary_password: input.temporaryPassword,
    });
    if (!res.warden) {
      return fail(new Error('Warden assigned, but no warden details were returned.'));
    }
    return ok(res.warden);
  } catch (err) {
    return fail(err, 'Could not assign warden.');
  }
}

export async function removePropertyWarden(
  propertyId: string
): Promise<ServiceResult<void>> {
  try {
    await invokeEdgeFunction('manage-warden', {
      action: 'remove',
      property_id: propertyId,
    });
    return ok(undefined);
  } catch (err) {
    return fail(err, 'Could not remove warden.');
  }
}
