-- ==============================================================================
-- Migration 32: Multi-Owner SaaS Plans, AI Scan Quotas & Storage Auto-Cleanup
-- File: supabase/migrations/20260101000032_multi_owner_saas_quotas.sql
--
-- Adds:
--   1. public.owner_plans (free vs pro tier limits + monthly AI scan counter)
--   2. public.ai_scan_logs (per-bill hourly anti-spam tracking)
--   3. public.consume_owner_ai_scan_quota(p_owner_id, p_charge_id) RPC
--   4. public.owner_invite_codes (admin-controlled new PG owner onboarding)
--   5. public.get_storage_cleanup_candidates(...) RPC (90d proofs / 60d complaints)
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. Table: public.owner_plans
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.owner_plans (
    owner_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
    plan_tier TEXT NOT NULL DEFAULT 'free' CHECK (plan_tier IN ('free', 'pro')),
    max_properties INTEGER NOT NULL DEFAULT 1 CHECK (max_properties >= 1),
    max_active_residents INTEGER NOT NULL DEFAULT 35 CHECK (max_active_residents >= 1),
    monthly_ai_scan_limit INTEGER NOT NULL DEFAULT 30 CHECK (monthly_ai_scan_limit >= 0),
    ai_scans_used_month INTEGER NOT NULL DEFAULT 0 CHECK (ai_scans_used_month >= 0),
    ai_scans_month_key TEXT NOT NULL DEFAULT to_char(CURRENT_DATE, 'YYYY-MM'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.owner_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS owner_plans_self_select ON public.owner_plans;
CREATE POLICY owner_plans_self_select
    ON public.owner_plans
    FOR SELECT
    TO authenticated
    USING (owner_id = (SELECT auth.uid()) AND public.is_owner());

REVOKE ALL ON TABLE public.owner_plans FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.owner_plans FROM authenticated;
GRANT SELECT ON TABLE public.owner_plans TO authenticated;

-- Backfill existing owners with default Free plan
INSERT INTO public.owner_plans (owner_id)
SELECT p.id
FROM public.profiles p
WHERE p.role = 'owner'
ON CONFLICT (owner_id) DO NOTHING;

-- Automatically provision a Free plan row whenever a new owner profile is created
CREATE OR REPLACE FUNCTION public.ensure_owner_plan_row()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NEW.role = 'owner' THEN
        INSERT INTO public.owner_plans (owner_id)
        VALUES (NEW.id)
        ON CONFLICT (owner_id) DO NOTHING;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_ensure_owner_plan_row ON public.profiles;
CREATE TRIGGER trigger_ensure_owner_plan_row
    AFTER INSERT OR UPDATE OF role ON public.profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.ensure_owner_plan_row();

-- ------------------------------------------------------------------------------
-- 2. Table: public.ai_scan_logs (Anti-spam: max 3 AI scans per charge per hour)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_scan_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    charge_id UUID NOT NULL REFERENCES public.charges(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_scan_logs_charge_recent
    ON public.ai_scan_logs (charge_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_scan_logs_owner_recent
    ON public.ai_scan_logs (owner_id, created_at DESC);

ALTER TABLE public.ai_scan_logs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ai_scan_logs FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------------------------
-- 3. RPC: consume_owner_ai_scan_quota (Service-role invoked by verify-upi-proof)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.consume_owner_ai_scan_quota(
    p_owner_id UUID,
    p_charge_id UUID,
    p_max_per_charge_per_hour INTEGER DEFAULT 3
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_plan RECORD;
    v_current_month TEXT := pg_catalog.to_char(CURRENT_DATE, 'YYYY-MM');
    v_hourly_count INTEGER := 0;
BEGIN
    -- Ensure owner has a plan row
    INSERT INTO public.owner_plans (owner_id)
    VALUES (p_owner_id)
    ON CONFLICT (owner_id) DO NOTHING;

    SELECT *
    INTO v_plan
    FROM public.owner_plans
    WHERE owner_id = p_owner_id
    FOR UPDATE;

    -- Reset monthly counter automatically when calendar month rolls over
    IF v_plan.ai_scans_month_key IS DISTINCT FROM v_current_month THEN
        UPDATE public.owner_plans
        SET ai_scans_used_month = 0,
            ai_scans_month_key = v_current_month,
            updated_at = pg_catalog.now()
        WHERE owner_id = p_owner_id
        RETURNING * INTO v_plan;
    END IF;

    -- Per-bill anti-spam cap (e.g. max 3 AI scans per charge in last 60 minutes)
    SELECT COUNT(*)::INTEGER
    INTO v_hourly_count
    FROM public.ai_scan_logs
    WHERE charge_id = p_charge_id
      AND created_at >= (pg_catalog.now() - INTERVAL '1 hour');

    IF v_hourly_count >= GREATEST(1, COALESCE(p_max_per_charge_per_hour, 3)) THEN
        RETURN pg_catalog.jsonb_build_object(
            'allowed', false,
            'reason', 'HOURLY_BILL_LIMIT',
            'plan_tier', v_plan.plan_tier,
            'used', v_plan.ai_scans_used_month,
            'limit', v_plan.monthly_ai_scan_limit
        );
    END IF;

    -- Owner monthly quota check
    IF v_plan.ai_scans_used_month >= v_plan.monthly_ai_scan_limit THEN
        RETURN pg_catalog.jsonb_build_object(
            'allowed', false,
            'reason', 'MONTHLY_QUOTA_EXCEEDED',
            'plan_tier', v_plan.plan_tier,
            'used', v_plan.ai_scans_used_month,
            'limit', v_plan.monthly_ai_scan_limit
        );
    END IF;

    -- Consume 1 scan
    UPDATE public.owner_plans
    SET ai_scans_used_month = ai_scans_used_month + 1,
        updated_at = pg_catalog.now()
    WHERE owner_id = p_owner_id
    RETURNING * INTO v_plan;

    INSERT INTO public.ai_scan_logs (owner_id, charge_id)
    VALUES (p_owner_id, p_charge_id);

    RETURN pg_catalog.jsonb_build_object(
        'allowed', true,
        'reason', NULL,
        'plan_tier', v_plan.plan_tier,
        'used', v_plan.ai_scans_used_month,
        'limit', v_plan.monthly_ai_scan_limit
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.consume_owner_ai_scan_quota(UUID, UUID, INTEGER) FROM PUBLIC, anon, authenticated;
ALTER FUNCTION public.consume_owner_ai_scan_quota(UUID, UUID, INTEGER) OWNER TO postgres;

-- ------------------------------------------------------------------------------
-- 4. Table: public.owner_invite_codes (Controlled New PG Owner Onboarding)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.owner_invite_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL UNIQUE,
    default_plan_tier TEXT NOT NULL DEFAULT 'free' CHECK (default_plan_tier IN ('free', 'pro')),
    max_uses INTEGER NOT NULL DEFAULT 1 CHECK (max_uses >= 1),
    uses_count INTEGER NOT NULL DEFAULT 0 CHECK (uses_count >= 0),
    is_active BOOLEAN NOT NULL DEFAULT true,
    expires_at TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.owner_invite_codes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.owner_invite_codes FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------------------------
-- 5. RPC: get_storage_cleanup_candidates (90d approved proofs / 60d complaints)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_storage_cleanup_candidates(
    p_proof_retention_days INTEGER DEFAULT 90,
    p_complaint_retention_days INTEGER DEFAULT 60,
    p_batch_limit INTEGER DEFAULT 100
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_limit INTEGER := LEAST(GREATEST(COALESCE(p_batch_limit, 100), 1), 500);
    v_proof_cutoff TIMESTAMPTZ := pg_catalog.now() - (GREATEST(COALESCE(p_proof_retention_days, 90), 7) || ' days')::INTERVAL;
    v_complaint_cutoff TIMESTAMPTZ := pg_catalog.now() - (GREATEST(COALESCE(p_complaint_retention_days, 60), 7) || ' days')::INTERVAL;
    v_proofs JSONB;
    v_complaints JSONB;
BEGIN
    SELECT COALESCE(pg_catalog.jsonb_agg(row_obj), '[]'::jsonb)
    INTO v_proofs
    FROM (
        SELECT pg_catalog.jsonb_build_object(
            'id', spr.id,
            'path', spr.screenshot_url
        ) AS row_obj
        FROM public.student_payment_reports spr
        WHERE spr.status = 'approved'
          AND spr.screenshot_url IS NOT NULL
          AND pg_catalog.btrim(spr.screenshot_url) <> ''
          AND COALESCE(spr.reviewed_at, spr.updated_at, spr.created_at) < v_proof_cutoff
        ORDER BY spr.created_at ASC
        LIMIT v_limit
    ) sub;

    SELECT COALESCE(pg_catalog.jsonb_agg(row_obj), '[]'::jsonb)
    INTO v_complaints
    FROM (
        SELECT pg_catalog.jsonb_build_object(
            'id', c.id,
            'path', c.photo_url
        ) AS row_obj
        FROM public.complaints c
        WHERE c.status::TEXT IN ('resolved', 'closed')
          AND c.photo_url IS NOT NULL
          AND pg_catalog.btrim(c.photo_url) <> ''
          AND COALESCE(c.updated_at, c.created_at) < v_complaint_cutoff
        ORDER BY c.created_at ASC
        LIMIT v_limit
    ) sub;

    RETURN pg_catalog.jsonb_build_object(
        'proofs', v_proofs,
        'complaints', v_complaints
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_storage_cleanup_candidates(INTEGER, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
ALTER FUNCTION public.get_storage_cleanup_candidates(INTEGER, INTEGER, INTEGER) OWNER TO postgres;

COMMIT;
