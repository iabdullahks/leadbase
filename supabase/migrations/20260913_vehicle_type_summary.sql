-- Migration: replace distinct_vehicle_carrier_ids RPC with a faster version
-- that avoids the statement timeout on large vehicles tables.
-- Date: 2026-09-13
--
-- Why: The original RPC does array_agg(DISTINCT carrier_id) over potentially
-- millions of rows matching a pattern, which takes too long.
--
-- Fix: Pre-computed vehicle_type summary table.
-- Since vehicles.vehicle_type has only ~23 distinct values, we maintain a small
-- summary table `vehicle_type_summary(vehicle_type, carrier_ids[])` that is
-- refreshed periodically. Lookups are then O(1) per type.
--
-- Paste the ENTIRE contents of this file into the Supabase SQL Editor and run.

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 1: Summary table
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vehicle_type_summary (
  vehicle_type   TEXT PRIMARY KEY,
  carrier_ids    INT[] NOT NULL DEFAULT '{}',
  carrier_count  INT NOT NULL DEFAULT 0,
  refreshed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 2: Refresh procedure (run once now, re-run after any new backfill)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE PROCEDURE refresh_vehicle_type_summary()
LANGUAGE plpgsql AS $$
BEGIN
  TRUNCATE vehicle_type_summary;
  INSERT INTO vehicle_type_summary (vehicle_type, carrier_ids, carrier_count, refreshed_at)
  SELECT
    vehicle_type,
    array_agg(DISTINCT carrier_id::int ORDER BY carrier_id::int) AS carrier_ids,
    COUNT(DISTINCT carrier_id)::int                              AS carrier_count,
    NOW()
  FROM vehicles
  WHERE vehicle_type IS NOT NULL
    AND vehicle_type <> '__VERIFY_TEST__'
  GROUP BY vehicle_type;
  COMMIT;
  RAISE NOTICE 'vehicle_type_summary refreshed with % vehicle types.',
    (SELECT COUNT(*) FROM vehicle_type_summary);
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 3: Drop old function (required — cannot change return type in place)
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS distinct_vehicle_carrier_ids(text[]);

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 4: New fast RPC — O(1) lookup against the 23-row summary table
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION distinct_vehicle_carrier_ids(patterns text[] DEFAULT NULL)
RETURNS int[]
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN patterns IS NULL THEN
      -- Return all carrier IDs that have any vehicle
      COALESCE(
        (SELECT array_agg(DISTINCT cid ORDER BY cid)
         FROM   vehicle_type_summary vts,
                LATERAL unnest(vts.carrier_ids) AS cid),
        ARRAY[]::int[]
      )
    ELSE
      -- Return carrier IDs whose vehicle_type matches any of the patterns
      COALESCE(
        (SELECT array_agg(DISTINCT cid ORDER BY cid)
         FROM   vehicle_type_summary vts,
                LATERAL unnest(vts.carrier_ids) AS cid
         WHERE  EXISTS (
                  SELECT 1 FROM unnest(patterns) AS p
                  WHERE  vts.vehicle_type ILIKE p
                )),
        ARRAY[]::int[]
      )
  END;
$$;

GRANT EXECUTE ON FUNCTION distinct_vehicle_carrier_ids(text[])
  TO anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 5: Populate the table
-- ─────────────────────────────────────────────────────────────────────────────
-- DO NOT run CALL refresh_vehicle_type_summary() here — the SQL Editor times
-- out after ~8s and this procedure takes 1-3 minutes.
--
-- Instead, run this after the DDL above succeeds:
--   python scratch/populate_vehicle_type_summary.py
--
-- That script calls the procedure via the Supabase client with no timeout limit.
-- Re-run it after any future backfill to keep the summary current.
