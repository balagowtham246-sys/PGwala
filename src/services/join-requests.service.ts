import { EdgeFunctionError, invokeEdgeFunction } from '@/lib/edge-functions';
import { normalizeInviteCode } from '@/lib/invite-utils';
import { supabase } from '@/lib/supabase';
import { PropertyGenderType, ResidentGender } from '@/lib/ux-utils';

const FUNCTION_NAME = 'resident-join-request';

export interface InvitePropertyPreview {
  id: string;
  name: string;
  address: string | null;
  gender_type: PropertyGenderType;
}

export interface JoinRequestItem {
  id: string;
  property_id: string;
  profile_id: string;
  full_name: string;
  email: string;
  phone_number: string;
  gender: ResidentGender | null;
  emergency_contact: string | null;
  room_hint: string | null;
  status: 'pending' | 'approved' | 'rejected';
  rejection_reason: string | null;
  reviewed_at: string | null;
  created_at: string;
  property?: {
    name?: string | null;
  } | null;
}

export interface PropertyInviteSettings {
  invite_code: string | null;
  invite_enabled: boolean;
}

async function invokePublicJoinFunction<T = Record<string, unknown>>(
  body: Record<string, unknown>
): Promise<T> {
  const { data, error, response } = await supabase.functions.invoke(
    FUNCTION_NAME,
    { body }
  );

  if (error) {
    const res = response ?? ((error as { context?: Response }).context);
    const status = res?.status;
    let message = '';
    let code: string | undefined;
    try {
      const payload =
        res && typeof res.json === 'function' ? await res.json() : null;
      const serverMsg = payload?.error ?? payload?.message;
      if (serverMsg) message = String(serverMsg);
      if (payload?.code) code = String(payload.code);
    } catch {
      // ignore body parse failure
    }
    if (status === 404 && !code) {
      throw new EdgeFunctionError(
        'Join service is not deployed yet. Ask your PG owner or deploy resident-join-request.',
        404,
        'NOT_FOUND'
      );
    }
    throw new EdgeFunctionError(
      message || error.message || 'Could not reach join service.',
      status,
      code
    );
  }

  if (data && (data as { success?: boolean }).success === false) {
    const d = data as { error?: string; code?: string };
    throw new EdgeFunctionError(
      String(d.error ?? 'Request failed.'),
      undefined,
      d.code
    );
  }

  return data as T;
}

export async function lookupPropertyByInviteCode(
  rawCode: string
): Promise<InvitePropertyPreview> {
  const code = normalizeInviteCode(rawCode);
  const data = await invokePublicJoinFunction<{
    success: true;
    property: InvitePropertyPreview;
  }>({
    action: 'lookup',
    invite_code: code,
  });
  return data.property;
}

export async function submitResidentJoinRequest(input: {
  invite_code: string;
  full_name: string;
  email: string;
  password: string;
  phone_number: string;
  gender: ResidentGender | null;
  emergency_contact?: string;
  room_hint?: string;
}): Promise<{ request_id: string; property_name: string }> {
  return invokePublicJoinFunction<{
    success: true;
    request_id: string;
    property_name: string;
  }>({
    action: 'submit',
    ...input,
    invite_code: normalizeInviteCode(input.invite_code),
  });
}

export async function fetchPropertyInviteSettings(
  propertyId: string
): Promise<PropertyInviteSettings> {
  const { data, error } = await supabase
    .from('properties')
    .select('invite_code, invite_enabled')
    .eq('id', propertyId)
    .maybeSingle();

  if (error || !data) {
    return { invite_code: null, invite_enabled: true };
  }

  return {
    invite_code: (data as { invite_code?: string | null }).invite_code ?? null,
    invite_enabled:
      (data as { invite_enabled?: boolean }).invite_enabled !== false,
  };
}

export async function fetchPropertyJoinRequests(
  propertyId: string
): Promise<JoinRequestItem[]> {
  const { data, error } = await supabase
    .from('resident_join_requests')
    .select(
      'id, property_id, profile_id, full_name, email, phone_number, gender, emergency_contact, room_hint, status, rejection_reason, reviewed_at, created_at'
    )
    .eq('property_id', propertyId)
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    // Gracefully return empty if migration hasn't been pushed yet
    const msg = (error.message || '').toLowerCase();
    if (error.code === '42P01' || msg.includes('does not exist')) {
      return [];
    }
    throw error;
  }

  return (data as JoinRequestItem[]) ?? [];
}

export async function fetchPendingJoinRequestsCount(
  propertyId: string
): Promise<number> {
  const { count, error } = await supabase
    .from('resident_join_requests')
    .select('id', { count: 'exact', head: true })
    .eq('property_id', propertyId)
    .eq('status', 'pending');

  if (error) return 0;
  return count ?? 0;
}

export async function fetchMyLatestJoinRequest(
  profileId: string
): Promise<JoinRequestItem | null> {
  const { data, error } = await supabase
    .from('resident_join_requests')
    .select('*, property:properties(name)')
    .eq('profile_id', profileId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return data as JoinRequestItem;
}

export async function approveJoinRequest(input: {
  request_id: string;
  room_number: string;
  bed_label?: string | null;
  monthly_rent_paise: number;
  deposit_paise?: number;
}): Promise<{ resident_id: string }> {
  return invokeEdgeFunction<{ success: true; resident_id: string }>(
    FUNCTION_NAME,
    {
      action: 'approve',
      ...input,
    }
  );
}

export async function rejectJoinRequest(input: {
  request_id: string;
  rejection_reason?: string;
}): Promise<void> {
  await invokeEdgeFunction(FUNCTION_NAME, {
    action: 'reject',
    ...input,
  });
}

export async function regeneratePropertyInviteCode(
  propertyId: string
): Promise<string> {
  const data = await invokeEdgeFunction<{
    success: true;
    invite_code: string;
  }>(FUNCTION_NAME, {
    action: 'regenerate_code',
    property_id: propertyId,
  });
  return data.invite_code;
}

export async function togglePropertyInviteEnabled(
  propertyId: string,
  inviteEnabled: boolean
): Promise<boolean> {
  const data = await invokeEdgeFunction<{
    success: true;
    invite_enabled: boolean;
  }>(FUNCTION_NAME, {
    action: 'toggle_invite',
    property_id: propertyId,
    invite_enabled: inviteEnabled,
  });
  return data.invite_enabled;
}
