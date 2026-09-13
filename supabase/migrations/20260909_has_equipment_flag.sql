-- Migration: persisted has_equipment flag on carriers
-- Date: 2026-09-09
--
-- Why: the "No Equipment"/"Has Equipment" filter was computing a distinct
-- list of carrier_ids from `vehicles` (via the distinct_vehicle_carrier_ids
-- RPC) and then inlining that whole list into a PostgREST URL filter
-- (`.not('id','in','(...)')` / `.in('id', ids)`). That works at small scale,
-- but now that the equipment backfill has populated ~900K+ distinct
-- carrier_ids, inlining that many integers into a URL blows past request
-- size limits and the query throws (confirmed: live 500 error on both
-- "No Equipment" and "Has Equipment" once the backfill passed ~900K carriers).
--
-- Fix: persist equipment status directly on `carriers` as an indexed
-- boolean, kept in sync via trigger, so filtering is a plain `WHERE
-- has_equipment = true/false` — O(1) per query, no ID list ever transmitted,
-- and it can never blow up regardless of how large `vehicles` grows.
--
-- Safe to run: `ADD COLUMN ... DEFAULT false` on a boolean column is a
-- metadata-only operation in Postgres 11+ (no full-table rewrite), unlike
-- the earlier `GENERATED ALWAYS AS (...) STORED` column that caused a
-- full-disk PANIC on this same table. The actual backfill of existing
-- rows is batched via a PROCEDURE with a COMMIT per batch, same pattern
-- used for the usdot_number_num backfill.

ALTER TABLE carriers ADD COLUMN IF NOT EXISTS has_equipment boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_carriers_has_equipment ON carriers(has_equipment);

CREATE OR REPLACE PROCEDURE backfill_has_equipment(batch_size int DEFAULT 50000)
LANGUAGE plpgsql AS $$
DECLARE
  rows_updated int;
BEGIN
  LOOP
    WITH batch AS (
      SELECT c.id
      FROM carriers c
      WHERE c.has_equipment = false
        AND EXISTS (SELECT 1 FROM vehicles v WHERE v.carrier_id = c.id)
      LIMIT batch_size
    )
    UPDATE carriers SET has_equipment = true
    WHERE id IN (SELECT id FROM batch);
    GET DIAGNOSTICS rows_updated = ROW_COUNT;
    COMMIT;
    EXIT WHEN rows_updated = 0;
  END LOOP;
END;
$$;

-- Keeps has_equipment in sync as backfill_equipment.py continues inserting
-- new vehicle rows after this migration runs.
CREATE OR REPLACE FUNCTION sync_carrier_has_equipment()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE carriers SET has_equipment = true WHERE id = NEW.carrier_id AND has_equipment = false;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_carrier_has_equipment ON vehicles;
CREATE TRIGGER trg_sync_carrier_has_equipment
AFTER INSERT ON vehicles
FOR EACH ROW EXECUTE FUNCTION sync_carrier_has_equipment();

-- After running the above, execute this once to backfill existing rows:
-- CALL backfill_has_equipment();
