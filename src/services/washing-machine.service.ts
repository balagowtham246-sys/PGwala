import { supabase } from '@/lib/supabase';
import { fail, ok, ServiceResult } from '@/lib/service-result';
import { endTrace, recordRoundTrip, startTrace } from '@/lib/perf-monitor';

export const CYCLE_DURATION_MINUTES = 45;

export interface WashingMachineStatusData {
  property_id: string;
  status: 'free' | 'in_use';
  current_resident_id: string | null;
  current_resident_name: string | null;
  current_resident_room: string | null;
  started_at: string | null;
  updated_at: string;
}

export interface WashingMachineUnitData {
  id: string;
  property_id: string;
  machine_number: number;
  machine_name: string;
  is_active: boolean;
  status: 'free' | 'in_use';
  current_resident_id: string | null;
  current_resident_name: string | null;
  current_resident_room: string | null;
  started_at: string | null;
  updated_at: string;
}

export type WashingMachineRequestStatus = 'none' | 'pending' | 'accepted' | 'rejected';

export interface FetchWashingMachineStatusResult {
  machines: WashingMachineUnitData[] | null;
  residentEnabled?: boolean;
  requestStatus?: WashingMachineRequestStatus;
}

export type StartWashingMachineResult =
  | { status: 'started'; machineName?: string; usedLegacyFallback: boolean }
  | { status: 'not_enabled'; errorMessage: string };

export function formatCountdown(
  startedAtIso: string | null,
  nowMs: number
): { label: string; remainingSeconds: number } {
  if (!startedAtIso) {
    return {
      label: `${CYCLE_DURATION_MINUTES}m left`,
      remainingSeconds: CYCLE_DURATION_MINUTES * 60,
    };
  }
  try {
    const startedMs = new Date(startedAtIso).getTime();
    if (Number.isNaN(startedMs)) {
      return {
        label: `${CYCLE_DURATION_MINUTES}m left`,
        remainingSeconds: CYCLE_DURATION_MINUTES * 60,
      };
    }
    const elapsedSeconds = Math.max(0, Math.floor((nowMs - startedMs) / 1000));
    const remainingSeconds = Math.max(0, CYCLE_DURATION_MINUTES * 60 - elapsedSeconds);
    if (remainingSeconds === 0) {
      return { label: 'Finishing soon', remainingSeconds: 0 };
    }
    const mins = Math.ceil(remainingSeconds / 60);
    return { label: `~${mins}m left`, remainingSeconds };
  } catch {
    return {
      label: `${CYCLE_DURATION_MINUTES}m left`,
      remainingSeconds: CYCLE_DURATION_MINUTES * 60,
    };
  }
}

export function getRemainingWashSeconds(startedAtIso: string | null): number {
  return formatCountdown(startedAtIso, Date.now()).remainingSeconds;
}

export async function fetchWashingMachineStatus(
  propertyId: string,
  userRole: 'owner' | 'student'
): Promise<ServiceResult<FetchWashingMachineStatusResult>> {
  const traceLabel = `wm:status:${propertyId}`;
  startTrace(traceLabel);
  try {
    // 1. Try multi-unit RPC
    const { data: rpcRes, error } = await supabase.rpc('get_or_create_wm_units', {
      p_property_id: propertyId,
    });
    recordRoundTrip(traceLabel);

    if (!error && rpcRes && rpcRes.success) {
      const unitList: WashingMachineUnitData[] = (rpcRes.machines ?? []).map((m: any) => ({
        id: m.id,
        property_id: m.property_id,
        machine_number: m.machine_number ?? 1,
        machine_name: m.machine_name ?? `Machine ${m.machine_number ?? 1}`,
        is_active: m.is_active ?? true,
        status: m.status ?? 'free',
        current_resident_id: m.current_resident_id,
        current_resident_name: m.current_resident_name,
        current_resident_room: m.current_resident_room,
        started_at: m.started_at,
        updated_at: m.updated_at,
      }));

      return ok({
        machines: unitList,
        residentEnabled:
          userRole === 'student' ? (rpcRes.resident_enabled ?? true) : undefined,
        requestStatus:
          userRole === 'student' ? (rpcRes.request_status ?? 'none') : undefined,
      });
    }

    // Fallback to legacy single-unit RPC if migration not yet applied
    const { data: legacyRes, error: legacyErr } = await supabase.rpc(
      'get_or_create_wm_status',
      {
        p_property_id: propertyId,
      }
    );
    recordRoundTrip(traceLabel);

    if (legacyErr) {
      return fail(legacyErr, legacyErr.message || 'Could not load washing machine status.');
    }

    if (legacyRes && legacyRes.success) {
      return ok({
        machines: [
          {
            id: legacyRes.property_id,
            property_id: legacyRes.property_id,
            machine_number: 1,
            machine_name: 'Washing Machine 1',
            is_active: true,
            status: legacyRes.status,
            current_resident_id: legacyRes.current_resident_id,
            current_resident_name: legacyRes.current_resident_name,
            current_resident_room: legacyRes.current_resident_room,
            started_at: legacyRes.started_at,
            updated_at: legacyRes.updated_at,
          },
        ],
      });
    }

    return ok({ machines: null });
  } catch (err: unknown) {
    return fail(err, 'Could not load washing machine status.');
  } finally {
    endTrace(traceLabel);
  }
}

export async function requestWashingMachineAccess(
  propertyId: string
): Promise<ServiceResult<void>> {
  const traceLabel = `wm:request-access:${propertyId}`;
  startTrace(traceLabel);
  try {
    const { data: res, error } = await supabase.rpc('request_wm_access', {
      p_property_id: propertyId,
    });
    recordRoundTrip(traceLabel);

    if (error) {
      return fail(error, error.message || 'Could not submit request.');
    }
    if (res?.success) {
      return ok(undefined);
    }
    return fail(new Error(res?.error || 'Could not send request.'));
  } catch (err: unknown) {
    return fail(err, 'Could not submit request.');
  } finally {
    endTrace(traceLabel);
  }
}

function isMissingRpcError(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  if (err.code === 'PGRST202' || err.code === '42883') return true;
  const msg = (err.message || '').toLowerCase();
  return (
    msg.includes('does not exist') ||
    msg.includes('could not find the function') ||
    msg.includes('schema cache') ||
    msg.includes('missing unit') ||
    msg.includes('function not found')
  );
}

export async function startWashingMachineUnit(
  propertyId: string,
  targetMachineId?: string
): Promise<ServiceResult<StartWashingMachineResult>> {
  const traceLabel = `wm:start:${propertyId}`;
  startTrace(traceLabel);
  try {
    // Try multi-unit RPC
    const { data: rpcRes, error } = await supabase.rpc('start_washing_machine_unit', {
      p_property_id: propertyId,
      p_machine_id: targetMachineId || null,
    });
    recordRoundTrip(traceLabel);

    if (!error && rpcRes) {
      if (rpcRes.success) {
        return ok({
          status: 'started',
          machineName: rpcRes.machine_name ?? rpcRes.machine?.machine_name,
          usedLegacyFallback: false,
        });
      }

      if (rpcRes.not_enabled) {
        return ok({
          status: 'not_enabled',
          errorMessage: rpcRes.error || 'Please request access from owner.',
        });
      }

      // Domain rejections (machine busy, out of order, active wash on another machine)
      // must fail directly instead of falling back to legacy single-machine RPC.
      return fail(new Error(rpcRes.error || 'Could not start washing machine.'));
    }

    if (error && !isMissingRpcError(error)) {
      return fail(error, error.message || 'Could not start washing machine.');
    }

    // Legacy fallback only when multi-unit RPC is not yet deployed
    const { data: legacyRes, error: legacyErr } = await supabase.rpc(
      'start_washing_machine',
      {
        p_property_id: propertyId,
      }
    );
    recordRoundTrip(traceLabel);

    if (legacyErr) {
      return fail(legacyErr, legacyErr.message || 'Could not start machine.');
    }
    if (!legacyRes?.success) {
      return fail(new Error(legacyRes?.error || 'Could not start machine.'));
    }

    return ok({
      status: 'started',
      usedLegacyFallback: true,
    });
  } catch (err: unknown) {
    return fail(err, 'Washing machine could not be started.');
  } finally {
    endTrace(traceLabel);
  }
}

export async function releaseWashingMachineUnit(
  propertyId: string,
  targetMachineId?: string
): Promise<ServiceResult<{ usedLegacyFallback: boolean }>> {
  const traceLabel = `wm:release:${propertyId}`;
  startTrace(traceLabel);
  try {
    const { data: rpcRes, error } = await supabase.rpc('release_washing_machine_unit', {
      p_property_id: propertyId,
      p_machine_id: targetMachineId || null,
    });
    recordRoundTrip(traceLabel);

    if (!error && rpcRes) {
      if (rpcRes.success) {
        return ok({ usedLegacyFallback: false });
      }
      return fail(new Error(rpcRes.error || 'Could not mark machine free.'));
    }

    if (error && !isMissingRpcError(error)) {
      return fail(error, error.message || 'Could not mark machine free.');
    }

    // Legacy fallback only when multi-unit RPC is not yet deployed
    const { data: legacyRes, error: legacyErr } = await supabase.rpc(
      'release_washing_machine',
      {
        p_property_id: propertyId,
      }
    );
    recordRoundTrip(traceLabel);

    if (legacyErr) {
      return fail(legacyErr, legacyErr.message || 'Could not mark free.');
    }
    if (!legacyRes?.success) {
      return fail(new Error(legacyRes?.error || 'Could not mark free.'));
    }

    return ok({ usedLegacyFallback: true });
  } catch (err: unknown) {
    return fail(err, 'Could not mark machine free.');
  } finally {
    endTrace(traceLabel);
  }
}
