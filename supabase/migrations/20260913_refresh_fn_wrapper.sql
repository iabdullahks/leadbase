-- Paste this into Supabase SQL Editor and click "Run".
-- Computes the EXACT distinct carrier counts for the 5 equipment types
-- without timing out (no array_agg).

CREATE OR REPLACE FUNCTION do_refresh_vehicle_type_summary()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout = '300s'
AS $$
BEGIN
  INSERT INTO vehicle_type_summary (vehicle_type, carrier_ids, carrier_count, refreshed_at)
  SELECT
    vehicle_type,
    '{}'::int[] AS carrier_ids,
    COUNT(DISTINCT carrier_id)::int AS carrier_count,
    NOW()
  FROM vehicles
  WHERE vehicle_type IN (
    'Truck Tractors',
    'Trailers',
    'Hazmat Cargo Tank Trailers',
    'Straight Trucks',
    'Van 1-8',
    'Van 9-15',
    'Van 16+',
    'Non-commercial Motor Vehicles'
  )
  GROUP BY vehicle_type
  ON CONFLICT (vehicle_type) DO UPDATE
  SET carrier_count = EXCLUDED.carrier_count,
      refreshed_at = EXCLUDED.refreshed_at;
END;
$$;

GRANT EXECUTE ON FUNCTION do_refresh_vehicle_type_summary()
  TO service_role, anon, authenticated;

-- Execute now to populate the counts:
SELECT do_refresh_vehicle_type_summary();

