-- ============================================================================
-- Migration 35: Phase 2 — Inline Bed Reservations for Visual Room & Bed Map
-- ============================================================================
-- Allows PG owners to reserve a free bed for an upcoming resident (Name, Phone,
-- Expected Join Date, optional Token Advance ₹) and later convert it 1-tap into
-- an active resident or cancel the reservation.

BEGIN;

CREATE TABLE IF NOT EXISTS public.bed_reservations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
    room_number TEXT NOT NULL,
    bed_label TEXT NOT NULL,
    prospect_name TEXT NOT NULL,
    phone_number TEXT NOT NULL,
    expected_join_date DATE NOT NULL,
    token_advance_paise INTEGER NOT NULL DEFAULT 0 CHECK (token_advance_paise >= 0),
    status TEXT NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'converted', 'cancelled')),
    converted_resident_id UUID REFERENCES public.residents(id) ON DELETE SET NULL,
    created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enforce at most one active reservation per bed slot per property
CREATE UNIQUE INDEX IF NOT EXISTS uq_idx_bed_reservations_active_slot
    ON public.bed_reservations (property_id, lower(room_number), lower(bed_label))
    WHERE status = 'reserved';

-- Fast lookup of active reservations for a property
CREATE INDEX IF NOT EXISTS idx_bed_reservations_prop_status
    ON public.bed_reservations (property_id, status, expected_join_date ASC);

ALTER TABLE public.bed_reservations ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.bed_reservations TO authenticated;

DROP POLICY IF EXISTS "owners_select_bed_reservations" ON public.bed_reservations;
CREATE POLICY "owners_select_bed_reservations"
    ON public.bed_reservations
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM public.properties p
            WHERE p.id = bed_reservations.property_id
              AND p.owner_id = (SELECT auth.uid())
              AND public.is_owner()
        )
    );

DROP POLICY IF EXISTS "owners_insert_bed_reservations" ON public.bed_reservations;
CREATE POLICY "owners_insert_bed_reservations"
    ON public.bed_reservations
    FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1
            FROM public.properties p
            WHERE p.id = bed_reservations.property_id
              AND p.owner_id = (SELECT auth.uid())
              AND public.is_owner()
        )
    );

DROP POLICY IF EXISTS "owners_update_bed_reservations" ON public.bed_reservations;
CREATE POLICY "owners_update_bed_reservations"
    ON public.bed_reservations
    FOR UPDATE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM public.properties p
            WHERE p.id = bed_reservations.property_id
              AND p.owner_id = (SELECT auth.uid())
              AND public.is_owner()
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1
            FROM public.properties p
            WHERE p.id = bed_reservations.property_id
              AND p.owner_id = (SELECT auth.uid())
              AND public.is_owner()
        )
    );

DROP POLICY IF EXISTS "owners_delete_bed_reservations" ON public.bed_reservations;
CREATE POLICY "owners_delete_bed_reservations"
    ON public.bed_reservations
    FOR DELETE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM public.properties p
            WHERE p.id = bed_reservations.property_id
              AND p.owner_id = (SELECT auth.uid())
              AND public.is_owner()
        )
    );

COMMIT;
