-- Consolidated schema migration for the bidding/cancellation feature work
-- shipped 2026-05-15. Idempotent: re-running on an already-migrated DB is
-- safe (no-op on every statement). Apply this BEFORE deploying the code
-- changes to any environment with `synchronize: false` — synchronize=true
-- environments will produce the same shape but cannot reliably handle the
-- partial unique index or the enum value addition, so prefer this script.
--
-- Wrap in a transaction so a mid-run failure rolls back cleanly. The enum
-- value addition is the one statement that some Postgres versions reject
-- inside a tx; if you hit that, split it into its own non-transactional
-- statement and re-run.

BEGIN;

-- ── transport_requests: last_activity_at (drives the 15-day inactivity sweep)
ALTER TABLE transport_requests
  ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Backfill legacy rows: treat the row's creation moment as the last
-- activity. Only touches rows the DEFAULT hasn't already populated.
UPDATE transport_requests
   SET last_activity_at = created_at
 WHERE last_activity_at > created_at
   AND last_activity_at = NOW();  -- best-effort detect of just-defaulted

CREATE INDEX IF NOT EXISTS idx_transport_requests_last_activity_at
  ON transport_requests (last_activity_at);

-- ── users: aggregate rating fields (client side; drivers keep using
-- driver_profile.avg_rating for backwards compat, but it's mirrored here).
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS avg_rating DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS total_ratings INTEGER NOT NULL DEFAULT 0;

-- ── bookings: cancellation/failure metadata
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS cancel_reason_code VARCHAR;
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS cancel_reason_text TEXT;
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS cancelled_by UUID;
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;

-- ── bookings.status: add CANCELLED to the enum. Postgres rejects this
-- inside a transaction on some versions — if so, pull this block out and
-- run it standalone, then re-run the rest of the migration.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
     WHERE t.typname = 'bookings_status_enum'
       AND e.enumlabel = 'CANCELLED'
  ) THEN
    ALTER TYPE bookings_status_enum ADD VALUE 'CANCELLED';
  END IF;
END$$;

-- ── bids: partial unique index so a driver who withdrew or was rejected
-- can submit a fresh bid on the same request, while still preventing two
-- concurrent live bids on the same (request, driver) pair.
DROP INDEX IF EXISTS "IDX_bids_request_driver";  -- legacy non-partial index, if it ever existed
CREATE UNIQUE INDEX IF NOT EXISTS idx_bids_request_driver_active
  ON bids (request_id, driver_id)
  WHERE status NOT IN ('WITHDRAWN', 'REJECTED');

COMMIT;
