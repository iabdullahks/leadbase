-- Migration: Advanced Filtering, Saved Views & Export History
-- Date: 2026-09-04

-- 1. SAVED VIEWS TABLE
CREATE TABLE IF NOT EXISTS saved_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  filter_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_default BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. EXPORT HISTORY TABLE
CREATE TABLE IF NOT EXISTS export_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name TEXT NOT NULL,
  format TEXT NOT NULL DEFAULT 'csv',
  record_count INTEGER NOT NULL DEFAULT 0,
  filter_summary TEXT,
  filter_state JSONB DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'completed',
  file_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. INDEXES FOR FAST FILTERING ON CARRIERS
CREATE INDEX IF NOT EXISTS idx_carriers_state_incorporated ON carriers(state_incorporated);
CREATE INDEX IF NOT EXISTS idx_carriers_form_of_business ON carriers(form_of_business);
CREATE INDEX IF NOT EXISTS idx_carriers_phone ON carriers(phone) WHERE phone IS NOT NULL AND phone != '';
CREATE INDEX IF NOT EXISTS idx_carriers_email ON carriers(email) WHERE email IS NOT NULL AND email != '';
CREATE INDEX IF NOT EXISTS idx_carriers_entry_date ON carriers(motus_entry_date);

-- 4. RLS POLICIES
ALTER TABLE saved_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE export_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read saved_views" ON saved_views FOR SELECT USING (true);
CREATE POLICY "Public insert saved_views" ON saved_views FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update saved_views" ON saved_views FOR UPDATE USING (true);
CREATE POLICY "Public delete saved_views" ON saved_views FOR DELETE USING (true);

CREATE POLICY "Public read export_history" ON export_history FOR SELECT USING (true);
CREATE POLICY "Public insert export_history" ON export_history FOR INSERT WITH CHECK (true);
