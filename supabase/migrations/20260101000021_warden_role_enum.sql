-- ==============================================================================
-- PGwala: Warden role (enum value only)
-- ALTER TYPE ... ADD VALUE must be committed before the value can be referenced,
-- so everything that uses 'warden' lives in the next migration (…022).
-- ==============================================================================

ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'warden';
