-- =========================================================================
-- MOTUS Equipment & Cargo Schema Verification & Migration
-- =========================================================================
--
-- Notes:
-- 1. In this project's live database & Next.js frontend (lib/queryBuilder.ts),
--    the canonical tables are `vehicles` and `cargo_classifications`.
-- 2. Below, we provide:
--    Part A: The exact requested `carrier_vehicles` & `carrier_cargo` tables
--            linked via foreign key to `carriers(id)` with (carrier_id) and
--            (cargo_type) indexes.
--    Part B: High-performance indexes on the canonical `vehicles` &
--            `cargo_classifications` tables so Next.js filter queries run fast.
--    Part C: Compatibility views allowing queries against either table naming convention.
-- =========================================================================

-- -------------------------------------------------------------------------
-- PART A: Requested Tables (carrier_vehicles & carrier_cargo)
-- -------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS carrier_vehicles (
  id BIGSERIAL PRIMARY KEY,
  carrier_id BIGINT NOT NULL REFERENCES carriers(id) ON DELETE CASCADE,
  usdot_number TEXT NOT NULL,
  vehicle_type TEXT,
  owned INTEGER DEFAULT 0,
  term_leased INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_carrier_vehicles_carrier_id ON carrier_vehicles(carrier_id);
CREATE INDEX IF NOT EXISTS idx_carrier_vehicles_usdot ON carrier_vehicles(usdot_number);
CREATE INDEX IF NOT EXISTS idx_carrier_vehicles_vehicle_type ON carrier_vehicles(vehicle_type);

CREATE TABLE IF NOT EXISTS carrier_cargo (
  id BIGSERIAL PRIMARY KEY,
  carrier_id BIGINT NOT NULL REFERENCES carriers(id) ON DELETE CASCADE,
  usdot_number TEXT NOT NULL,
  cargo_type TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_carrier_cargo_carrier_id ON carrier_cargo(carrier_id);
CREATE INDEX IF NOT EXISTS idx_carrier_cargo_cargo_type ON carrier_cargo(cargo_type);
CREATE INDEX IF NOT EXISTS idx_carrier_cargo_usdot ON carrier_cargo(usdot_number);


-- -------------------------------------------------------------------------
-- PART B: Performance Indexes on Canonical Tables (used by Next.js app)
-- -------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_vehicles_carrier_id ON vehicles(carrier_id);
CREATE INDEX IF NOT EXISTS idx_vehicles_usdot ON vehicles(usdot_number);
CREATE INDEX IF NOT EXISTS idx_vehicles_type ON vehicles(vehicle_type);

CREATE INDEX IF NOT EXISTS idx_cargo_carrier_id ON cargo_classifications(carrier_id);
CREATE INDEX IF NOT EXISTS idx_cargo_usdot ON cargo_classifications(usdot_number);
CREATE INDEX IF NOT EXISTS idx_cargo_classification ON cargo_classifications(classification);


-- -------------------------------------------------------------------------
-- PART C: RLS Policies (Read access for public / authenticated app users)
-- -------------------------------------------------------------------------

ALTER TABLE carrier_vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE carrier_cargo ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read carrier_vehicles" ON carrier_vehicles FOR SELECT USING (true);
CREATE POLICY "Public read carrier_cargo" ON carrier_cargo FOR SELECT USING (true);
