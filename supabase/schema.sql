-- MOTUS DOT Scraper - Full Database Schema
-- Tracks all carrier data from MOTUS day 1 through present with date/time

-- ============================================================
-- 1. CARRIERS (main table)
-- ============================================================
CREATE TABLE IF NOT EXISTS carriers (
  id BIGSERIAL PRIMARY KEY,
  usdot_number TEXT UNIQUE NOT NULL,
  legal_name TEXT,
  dba_name TEXT,
  profile_url TEXT,
  added_to_motus TIMESTAMPTZ,
  motus_entry_date TIMESTAMPTZ,
  motus_last_updated TIMESTAMPTZ,
  carrier_status TEXT DEFAULT 'Active',
  out_of_service BOOLEAN DEFAULT FALSE,
  scraped_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  principal_address TEXT,
  mailing_address TEXT,
  phone TEXT,
  email TEXT,
  duns TEXT,
  form_of_business TEXT,
  state_incorporated TEXT,
  new_entrant_status TEXT,
  raw_data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_carriers_usdot ON carriers(usdot_number);
CREATE INDEX IF NOT EXISTS idx_carriers_added_to_motus ON carriers(added_to_motus);
CREATE INDEX IF NOT EXISTS idx_carriers_scraped_at ON carriers(scraped_at);
CREATE INDEX IF NOT EXISTS idx_carriers_status ON carriers(carrier_status);
CREATE INDEX IF NOT EXISTS idx_carriers_legal_name ON carriers(legal_name);

-- ============================================================
-- 2. COMPANY OFFICIALS
-- ============================================================
CREATE TABLE IF NOT EXISTS company_officials (
  id BIGSERIAL PRIMARY KEY,
  carrier_id BIGINT NOT NULL REFERENCES carriers(id) ON DELETE CASCADE,
  usdot_number TEXT NOT NULL,
  official_name TEXT,
  title TEXT,
  phone TEXT,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_officials_carrier_id ON company_officials(carrier_id);
CREATE INDEX IF NOT EXISTS idx_officials_usdot ON company_officials(usdot_number);

-- ============================================================
-- 3. CARGO CLASSIFICATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS cargo_classifications (
  id BIGSERIAL PRIMARY KEY,
  carrier_id BIGINT NOT NULL REFERENCES carriers(id) ON DELETE CASCADE,
  usdot_number TEXT NOT NULL,
  classification TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cargo_carrier_id ON cargo_classifications(carrier_id);
CREATE INDEX IF NOT EXISTS idx_cargo_usdot ON cargo_classifications(usdot_number);

-- ============================================================
-- 4. VEHICLES
-- ============================================================
CREATE TABLE IF NOT EXISTS vehicles (
  id BIGSERIAL PRIMARY KEY,
  carrier_id BIGINT NOT NULL REFERENCES carriers(id) ON DELETE CASCADE,
  usdot_number TEXT NOT NULL,
  vehicle_type TEXT,
  owned INTEGER DEFAULT 0,
  term_leased INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vehicles_carrier_id ON vehicles(carrier_id);
CREATE INDEX IF NOT EXISTS idx_vehicles_usdot ON vehicles(usdot_number);

-- ============================================================
-- 5. DRIVERS
-- ============================================================
CREATE TABLE IF NOT EXISTS drivers (
  id BIGSERIAL PRIMARY KEY,
  carrier_id BIGINT NOT NULL REFERENCES carriers(id) ON DELETE CASCADE,
  usdot_number TEXT NOT NULL,
  driver_info TEXT,
  interstate INTEGER DEFAULT 0,
  intrastate INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_drivers_carrier_id ON drivers(carrier_id);
CREATE INDEX IF NOT EXISTS idx_drivers_usdot ON drivers(usdot_number);

-- ============================================================
-- 6. SCRAPE HISTORY (every scrape event with date/time)
-- ============================================================
CREATE TABLE IF NOT EXISTS scrape_history (
  id BIGSERIAL PRIMARY KEY,
  usdot_number TEXT NOT NULL,
  carrier_id BIGINT REFERENCES carriers(id) ON DELETE SET NULL,
  scraped_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  added_to_motus TIMESTAMPTZ,
  motus_entry_date TIMESTAMPTZ,
  motus_last_updated TIMESTAMPTZ,
  change_type TEXT NOT NULL DEFAULT 'new',
  carrier_status TEXT,
  out_of_service BOOLEAN DEFAULT FALSE,
  raw_data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_scrape_history_usdot ON scrape_history(usdot_number);
CREATE INDEX IF NOT EXISTS idx_scrape_history_scraped_at ON scrape_history(scraped_at);
CREATE INDEX IF NOT EXISTS idx_scrape_history_change_type ON scrape_history(change_type);

-- ============================================================
-- 7. SYNC RUNS (bulk scrape / auto-sync logs)
-- ============================================================
CREATE TABLE IF NOT EXISTS sync_runs (
  id BIGSERIAL PRIMARY KEY,
  run_type TEXT NOT NULL DEFAULT 'auto',
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  duration_seconds NUMERIC,
  stats JSONB DEFAULT '{}'::jsonb,
  status TEXT DEFAULT 'running'
);

CREATE INDEX IF NOT EXISTS idx_sync_runs_started_at ON sync_runs(started_at);

-- ============================================================
-- 8. CARRIER FIELD CHANGES (requirement 2: diff tracking)
-- ============================================================
CREATE TABLE IF NOT EXISTS carrier_field_changes (
  id BIGSERIAL PRIMARY KEY,
  usdot_number TEXT NOT NULL,
  carrier_id BIGINT REFERENCES carriers(id) ON DELETE SET NULL,
  scrape_history_id BIGINT REFERENCES scrape_history(id) ON DELETE SET NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  field_path TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT
);

CREATE INDEX IF NOT EXISTS idx_field_changes_usdot ON carrier_field_changes(usdot_number);
CREATE INDEX IF NOT EXISTS idx_field_changes_changed_at ON carrier_field_changes(changed_at);

-- ============================================================
-- 9. AUTO-UPDATE updated_at TRIGGER
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS carriers_updated_at ON carriers;
CREATE TRIGGER carriers_updated_at
  BEFORE UPDATE ON carriers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 9. ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE carriers ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_officials ENABLE ROW LEVEL SECURITY;
ALTER TABLE cargo_classifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE drivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE scrape_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE carrier_field_changes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read carriers" ON carriers FOR SELECT USING (true);
CREATE POLICY "Public read officials" ON company_officials FOR SELECT USING (true);
CREATE POLICY "Public read cargo" ON cargo_classifications FOR SELECT USING (true);
CREATE POLICY "Public read vehicles" ON vehicles FOR SELECT USING (true);
CREATE POLICY "Public read drivers" ON drivers FOR SELECT USING (true);
CREATE POLICY "Public read scrape_history" ON scrape_history FOR SELECT USING (true);
CREATE POLICY "Public read sync_runs" ON sync_runs FOR SELECT USING (true);
CREATE POLICY "Public read field_changes" ON carrier_field_changes FOR SELECT USING (true);
