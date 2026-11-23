import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const GEMINI_MODEL = 'gemini-2.5-flash';
const STALE_RECEIPT_MAX_DAYS = 45;

interface ExtractedUpiData {
  is_upi_receipt: boolean;
  app_name: string | null;
  utr_number: string | null;
  amount_rupees: number | null;
  payee_upi_id: string | null;
  payee_name: string | null;
  payment_date: string | null;
  transaction_status: 'SUCCESS' | 'PENDING' | 'FAILED' | 'UNKNOWN';
  confidence: 'high' | 'medium' | 'low';
}

function jsonResponse(status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function base64ToUint8Array(base64: string): Uint8Array {
  const clean = base64.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '').replace(/\s/g, '');
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function computeSha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hashArray = Array.from(new Uint8Array(digest));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

function normalizeUtr(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const match = raw.match(/(?:^|[^0-9])([0-9]{12})(?:[^0-9]|$)/);
  if (match && match[1]) return match[1];
  const digits = raw.replace(/\D/g, '');
  return digits.length === 12 ? digits : null;
}

function normalizeUpiHandle(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const clean = raw.trim().toLowerCase();
  return clean.includes('@') ? clean : null;
}

function evaluateDiscrepancies(params: {
  extracted: ExtractedUpiData;
  expectedAmountPaise: number;
  ownerUpiId: string | null;
}): {
  verification_status: 'verified_match' | 'warning' | 'unverified';
  warnings: string[];
} {
  const { extracted, expectedAmountPaise, ownerUpiId } = params;
  const warnings: string[] = [];

  if (!extracted.is_upi_receipt) {
    warnings.push('Image does not look like a UPI payment confirmation screenshot.');
    return { verification_status: 'warning', warnings };
  }

  if (extracted.transaction_status === 'FAILED') {
    warnings.push('Screenshot shows a FAILED transaction.');
  } else if (extracted.transaction_status === 'PENDING') {
    warnings.push('Screenshot shows a PENDING/processing payment, not completed.');
  }

  if (typeof extracted.amount_rupees === 'number' && Number.isFinite(extracted.amount_rupees)) {
    const extractedPaise = Math.round(extracted.amount_rupees * 100);
    const diffPaise = Math.abs(extractedPaise - expectedAmountPaise);
    if (diffPaise >= 100) {
      const expectedRupees = Math.round(expectedAmountPaise / 100).toLocaleString('en-IN');
      const detectedRupees = Math.round(extracted.amount_rupees).toLocaleString('en-IN');
      warnings.push(`Amount mismatch: screenshot shows ₹${detectedRupees}, bill is ₹${expectedRupees}.`);
    }
  } else {
    warnings.push('Could not clearly read the paid amount from the screenshot.');
  }

  const cleanOwnerUpi = normalizeUpiHandle(ownerUpiId);
  const cleanPayeeUpi = normalizeUpiHandle(extracted.payee_upi_id);
  if (cleanOwnerUpi && cleanPayeeUpi && cleanOwnerUpi !== cleanPayeeUpi) {
    warnings.push(`Payee UPI (${cleanPayeeUpi}) differs from PG UPI (${cleanOwnerUpi}).`);
  }

  if (extracted.payment_date) {
    const parsed = new Date(extracted.payment_date);
    if (!Number.isNaN(parsed.getTime())) {
      const ageDays = Math.floor((Date.now() - parsed.getTime()) / (1000 * 60 * 60 * 24));
      if (ageDays > STALE_RECEIPT_MAX_DAYS) {
        warnings.push(`Receipt date (${extracted.payment_date}) is ${ageDays} days old.`);
      }
    }
  }

  if (!normalizeUtr(extracted.utr_number)) {
    warnings.push('12-digit UPI UTR / Transaction ID was not visible in the screenshot.');
  }

  return {
    verification_status: warnings.length === 0 ? 'verified_match' : 'warning',
    warnings,
  };
}

async function analyzeWithGemini(
  apiKey: string,
  base64Image: string,
  mimeType: string
): Promise<ExtractedUpiData | null> {
  const prompt = [
    'You are a strict Indian UPI payment receipt extractor for a PG rent app.',
    'Analyze this image (Google Pay, PhonePe, Paytm, BHIM, CRED, Amazon Pay, or Indian bank UPI app).',
    'Return ONLY valid JSON with these exact keys:',
    '{',
    '  "is_upi_receipt": boolean,',
    '  "app_name": string | null (e.g. "GPay", "PhonePe", "Paytm", "BHIM", "CRED", "Bank App"),',
    '  "utr_number": string | null (the 12-digit UPI transaction ID / UTR / Ref No, digits only if found),',
    '  "amount_rupees": number | null (numeric INR amount paid, e.g. 6500),',
    '  "payee_upi_id": string | null (receiver VPA like name@okaxis if visible),',
    '  "payee_name": string | null (receiver name if visible),',
    '  "payment_date": string | null (YYYY-MM-DD if visible),',
    '  "transaction_status": "SUCCESS" | "PENDING" | "FAILED" | "UNKNOWN",',
    '  "confidence": "high" | "medium" | "low"',
    '}',
    'Never invent a UTR or amount that is not clearly visible in the image.',
  ].join('\n');

  const cleanBase64 = base64Image
    .replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '')
    .replace(/\s/g, '');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: prompt },
                {
                  inline_data: {
                    mime_type: mimeType || 'image/jpeg',
                    data: cleanBase64,
                  },
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.1,
            responseMimeType: 'application/json',
          },
        }),
      }
    );

    if (!res.ok) {
      return null;
    }

    const payload = await res.json();
    const rawText = payload?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof rawText !== 'string' || !rawText.trim()) return null;

    const parsed = JSON.parse(rawText);
    const statusRaw = String(parsed.transaction_status || 'UNKNOWN').toUpperCase();
    const transaction_status: ExtractedUpiData['transaction_status'] =
      statusRaw === 'SUCCESS' || statusRaw === 'PENDING' || statusRaw === 'FAILED'
        ? statusRaw
        : 'UNKNOWN';

    const confRaw = String(parsed.confidence || 'low').toLowerCase();
    const confidence: ExtractedUpiData['confidence'] =
      confRaw === 'high' || confRaw === 'medium' ? confRaw : 'low';

    return {
      is_upi_receipt: Boolean(parsed.is_upi_receipt),
      app_name: typeof parsed.app_name === 'string' ? parsed.app_name.trim() || null : null,
      utr_number: normalizeUtr(parsed.utr_number),
      amount_rupees:
        typeof parsed.amount_rupees === 'number' && Number.isFinite(parsed.amount_rupees)
          ? parsed.amount_rupees
          : null,
      payee_upi_id: normalizeUpiHandle(parsed.payee_upi_id),
      payee_name: typeof parsed.payee_name === 'string' ? parsed.payee_name.trim() || null : null,
      payment_date: typeof parsed.payment_date === 'string' ? parsed.payment_date.trim() || null : null,
      transaction_status,
      confidence,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse(405, { success: false, error: 'Method not allowed.' });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse(500, { success: false, error: 'Server configuration missing.' });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const authHeader = req.headers.get('Authorization') || req.headers.get('authorization');
    if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
      return jsonResponse(401, { success: false, error: 'Authentication required.' });
    }
    const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
    const { data: userData, error: userErr } = await adminClient.auth.getUser(jwt);
    if (userErr || !userData?.user) {
      return jsonResponse(401, { success: false, error: 'Invalid or expired session.' });
    }

    const body = await req.json();
    const chargeId = typeof body?.charge_id === 'string' ? body.charge_id.trim() : '';
    const imageBase64 = typeof body?.image_base64 === 'string' ? body.image_base64 : '';
    const mimeType = typeof body?.mime_type === 'string' ? body.mime_type : 'image/jpeg';

    if (!chargeId || !imageBase64) {
      return jsonResponse(400, {
        success: false,
        error: 'charge_id and image_base64 are required.',
      });
    }

    // Verify caller owns this charge as an active resident
    const { data: chargeRow, error: chargeErr } = await adminClient
      .from('charges')
      .select('id, property_id, resident_id, amount_paise, resident:residents!inner(profile_id, is_active), property:properties(upi_id)')
      .eq('id', chargeId)
      .maybeSingle();

    if (chargeErr || !chargeRow) {
      return jsonResponse(404, { success: false, error: 'Bill not found.' });
    }

    const resRel = Array.isArray(chargeRow.resident) ? chargeRow.resident[0] : chargeRow.resident;
    if (!resRel || resRel.profile_id !== userData.user.id || !resRel.is_active) {
      return jsonResponse(403, { success: false, error: 'Not authorized for this bill.' });
    }

    const propRel = Array.isArray(chargeRow.property) ? chargeRow.property[0] : chargeRow.property;
    const ownerUpiId: string | null = propRel?.upi_id ?? null;

    // 1. Compute SHA-256 fingerprint of uploaded screenshot
    const bytes = base64ToUint8Array(imageBase64);
    const screenshotSha256 = await computeSha256Hex(bytes);

    // 2. Hard-block duplicate screenshot before spending an AI call
    const { data: dupImg } = await adminClient
      .from('student_payment_reports')
      .select('id, status, created_at')
      .eq('property_id', chargeRow.property_id)
      .eq('screenshot_sha256', screenshotSha256)
      .in('status', ['pending', 'approved'])
      .limit(1)
      .maybeSingle();

    if (dupImg) {
      return jsonResponse(200, {
        success: true,
        hard_blocked: true,
        block_code: 'DUPLICATE_SCREENSHOT',
        block_message:
          'This exact payment screenshot was already submitted for another bill. Please upload a new receipt.',
        screenshot_sha256: screenshotSha256,
        verification_status: 'warning',
        warnings: ['Duplicate payment screenshot detected.'],
        extracted: null,
      });
    }

    // 3. Call Gemini 2.5 Flash (Free Tier) if GEMINI_API_KEY is configured
    const geminiApiKey = Deno.env.get('GEMINI_API_KEY') ?? '';
    if (!geminiApiKey) {
      return jsonResponse(200, {
        success: true,
        hard_blocked: false,
        screenshot_sha256: screenshotSha256,
        verification_status: 'unverified',
        warnings: [],
        extracted: null,
      });
    }

    const extracted = await analyzeWithGemini(geminiApiKey, imageBase64, mimeType);
    if (!extracted) {
      return jsonResponse(200, {
        success: true,
        hard_blocked: false,
        screenshot_sha256: screenshotSha256,
        verification_status: 'unverified',
        warnings: [],
        extracted: null,
      });
    }

    // 4. Hard-block duplicate 12-digit UTR across pending/approved reports in this PG
    if (extracted.utr_number) {
      const { data: dupUtr } = await adminClient
        .from('student_payment_reports')
        .select('id, status, created_at')
        .eq('property_id', chargeRow.property_id)
        .eq('normalized_utr', extracted.utr_number)
        .in('status', ['pending', 'approved'])
        .limit(1)
        .maybeSingle();

      if (dupUtr) {
        return jsonResponse(200, {
          success: true,
          hard_blocked: true,
          block_code: 'DUPLICATE_UTR',
          block_message: `UPI Transaction ID (UTR ${extracted.utr_number}) was already used for another payment in this PG.`,
          screenshot_sha256: screenshotSha256,
          verification_status: 'warning',
          warnings: [`Duplicate UTR ${extracted.utr_number} detected.`],
          extracted,
        });
      }
    }

    // 5. Evaluate discrepancies against expected bill amount & owner UPI ID
    const evaluated = evaluateDiscrepancies({
      extracted,
      expectedAmountPaise: chargeRow.amount_paise,
      ownerUpiId,
    });

    return jsonResponse(200, {
      success: true,
      hard_blocked: false,
      screenshot_sha256: screenshotSha256,
      verification_status: evaluated.verification_status,
      warnings: evaluated.warnings,
      extracted,
    });
  } catch (err) {
    console.error('[verify-upi-proof] error:', err);
    return jsonResponse(500, {
      success: false,
      error: 'Could not verify screenshot right now.',
    });
  }
});
