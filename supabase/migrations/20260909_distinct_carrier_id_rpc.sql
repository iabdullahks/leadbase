-- Migration: distinct-carrier-id RPCs for equipment/cargo filtering
-- Date: 2026-09-09
--
-- Why: lib/queryBuilder.ts's resolveEquipmentCargoIds() computes candidate
-- carrier ids by SELECTing raw rows from `vehicles`/`cargo_classifications`
-- and de-duplicating carrier_id client-side. This silently breaks once those
-- tables exceed this project's PostgREST row cap (confirmed hard-capped at
-- 1000 rows per response, even when an explicit larger .range() is
-- requested) — with the equipment/cargo backfill now inserting millions of
-- rows, every equipment_types/cargo_types/has_equipment/no_equipment filter
-- has been silently operating on only the first ~1000 rows (~134 carriers)
-- ever inserted, regardless of how much real data exists.
--
-- Fix: move the DISTINCT aggregation into Postgres and return it as a single
-- row containing one array column. PostgREST's row cap limits the number of
-- ROWS in a response, not the size of a single array value within one row,
-- so this sidesteps the cap entirely while still being cheap (backed by the
-- existing idx_vehicles_carrier_id / idx_cargo_carrier_id indexes).

CREATE OR REPLACE FUNCTION distinct_vehicle_carrier_ids(patterns text[] DEFAULT NULL)
RETURNS int[]
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(array_agg(DISTINCT carrier_id), ARRAY[]::int[])
  FROM vehicles
  WHERE patterns IS NULL
     OR EXISTS (SELECT 1 FROM unnest(patterns) AS p WHERE vehicle_type ILIKE p);
$$;

CREATE OR REPLACE FUNCTION distinct_cargo_carrier_ids(patterns text[])
RETURNS int[]
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(array_agg(DISTINCT carrier_id), ARRAY[]::int[])
  FROM cargo_classifications
  WHERE EXISTS (SELECT 1 FROM unnest(patterns) AS p WHERE classification ILIKE p);
$$;

GRANT EXECUTE ON FUNCTION distinct_vehicle_carrier_ids(text[]) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION distinct_cargo_carrier_ids(text[]) TO anon, authenticated, service_role;
