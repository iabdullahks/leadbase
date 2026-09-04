-- Run this SQL in your Supabase dashboard > SQL Editor

-- Table to track scraper runs
CREATE TABLE IF NOT EXISTS scraper_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at  TIMESTAMPTZ,
  status        TEXT NOT NULL DEFAULT 'running',   -- running | completed | failed | cancelled
  triggered_by  TEXT NOT NULL DEFAULT 'schedule',  -- schedule | manual
  start_dot     BIGINT,
  end_dot       BIGINT,
  dots_scanned  BIGINT DEFAULT 0,
  new_leads     INTEGER DEFAULT 0,
  error_message TEXT,
  notes         TEXT
);

-- Index for listing recent runs fast
CREATE INDEX IF NOT EXISTS idx_scraper_runs_started ON scraper_runs (started_at DESC);

-- Add run_id tracking to carriers (optional - links each lead to the run that found it)
ALTER TABLE carriers ADD COLUMN IF NOT EXISTS scraper_run_id UUID REFERENCES scraper_runs(id);
CREATE INDEX IF NOT EXISTS idx_carriers_run_id ON carriers (scraper_run_id);
