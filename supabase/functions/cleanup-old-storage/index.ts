import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cleanup-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface CleanupItem {
  id: string;
  path: string;
}

function jsonResponse(status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function extractRelativeStoragePath(raw: string, bucket: string): string | null {
  const trimmed = (raw || '').trim();
  if (!trimmed) return null;
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
    return trimmed.replace(/^\/+/, '');
  }
  const marker = `/${bucket}/`;
  const idx = trimmed.indexOf(marker);
  if (idx === -1) return null;
  const after = trimmed.slice(idx + marker.length).split('?')[0];
  return after ? decodeURIComponent(after) : null;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse(405, { success: false, error: 'Method not allowed.' });
  }

  try {
    const expectedSecret = Deno.env.get('CLEANUP_CRON_SECRET') ?? '';
    const providedSecret = req.headers.get('x-cleanup-secret') ?? '';
    if (!expectedSecret || providedSecret !== expectedSecret) {
      return jsonResponse(401, { success: false, error: 'Unauthorized cleanup trigger.' });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse(500, { success: false, error: 'Server configuration missing.' });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    let proofDays = 90;
    let complaintDays = 60;
    let batchLimit = 100;
    try {
      const body = await req.json();
      if (typeof body?.proof_retention_days === 'number') proofDays = body.proof_retention_days;
      if (typeof body?.complaint_retention_days === 'number') complaintDays = body.complaint_retention_days;
      if (typeof body?.batch_limit === 'number') batchLimit = body.batch_limit;
    } catch {
      // Empty body uses default 90d / 60d retention windows
    }

    const { data, error } = await adminClient.rpc('get_storage_cleanup_candidates', {
      p_proof_retention_days: proofDays,
      p_complaint_retention_days: complaintDays,
      p_batch_limit: batchLimit,
    });

    if (error) {
      return jsonResponse(500, { success: false, error: error.message });
    }

    const proofs: CleanupItem[] = Array.isArray(data?.proofs) ? data.proofs : [];
    const complaints: CleanupItem[] = Array.isArray(data?.complaints) ? data.complaints : [];

    // 1. Delete old approved payment proof images (> 90 days) while preserving ledger & UTR
    let deletedProofs = 0;
    if (proofs.length > 0) {
      const proofPaths = proofs
        .map((p) => extractRelativeStoragePath(p.path, 'payment-proofs'))
        .filter((p): p is string => Boolean(p));

      if (proofPaths.length > 0) {
        await adminClient.storage.from('payment-proofs').remove(proofPaths);
      }

      const proofIds = proofs.map((p) => p.id);
      const { error: updateErr } = await adminClient
        .from('student_payment_reports')
        .update({ screenshot_url: null })
        .in('id', proofIds);

      if (!updateErr) {
        deletedProofs = proofIds.length;
      }
    }

    // 2. Delete old resolved complaint photos (> 60 days)
    let deletedComplaints = 0;
    if (complaints.length > 0) {
      const complaintPaths = complaints
        .map((c) => extractRelativeStoragePath(c.path, 'complaint-photos'))
        .filter((p): p is string => Boolean(p));

      if (complaintPaths.length > 0) {
        await adminClient.storage.from('complaint-photos').remove(complaintPaths);
      }

      const complaintIds = complaints.map((c) => c.id);
      const { error: updateErr } = await adminClient
        .from('complaints')
        .update({ photo_url: null })
        .in('id', complaintIds);

      if (!updateErr) {
        deletedComplaints = complaintIds.length;
      }
    }

    return jsonResponse(200, {
      success: true,
      deleted_proofs: deletedProofs,
      deleted_complaints: deletedComplaints,
      has_more: proofs.length >= batchLimit || complaints.length >= batchLimit,
    });
  } catch (err) {
    console.error('[cleanup-old-storage] error:', err);
    return jsonResponse(500, { success: false, error: 'Storage cleanup failed.' });
  }
});
