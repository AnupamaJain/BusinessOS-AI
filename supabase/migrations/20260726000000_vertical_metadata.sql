-- ============================================================================
-- BusinessOS AI - Vertical Metadata Migration
-- Adds a generic `metadata jsonb` column to `packages` and `bookings` so the
-- same tables can represent additional business verticals (e.g. intercity cabs,
-- home services) without schema changes. Columns inherit existing table RLS.
-- ============================================================================

ALTER TABLE public.packages ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}';
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_packages_metadata ON public.packages USING gin (metadata);
CREATE INDEX IF NOT EXISTS idx_bookings_metadata ON public.bookings USING gin (metadata);
