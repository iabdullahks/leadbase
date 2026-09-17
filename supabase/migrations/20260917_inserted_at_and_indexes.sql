-- Migration: Add inserted_at column to track when a carrier was first added to our DB
-- This column is set once on INSERT and never updated (unlike scraped_at which reflects import batches)
-- Also add needed performance indexes for common filters

-- 1. Add inserted_at column with default NOW(), not updated by triggers
ALTER TABLE carriers 
  ADD COLUMN IF NOT EXISTS inserted_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- 2. Backfill inserted_at from scraped_at for all existing rows
--    (scraped_at is the best approximation of when they were first inserted)
UPDATE carriers SET inserted_at = scraped_at WHERE inserted_at IS NULL OR inserted_at > scraped_at;

-- 3. Index for "Added Today" fast count queries  
CREATE INDEX IF NOT EXISTS idx_carriers_inserted_at ON carriers(inserted_at);

-- 4. Partial index on phone for non-empty phone counts (major performance win)
CREATE INDEX IF NOT EXISTS idx_carriers_phone_nonempty ON carriers(phone) 
  WHERE phone IS NOT NULL AND phone != '';

-- 5. Partial index on email for non-empty email counts
CREATE INDEX IF NOT EXISTS idx_carriers_email_nonempty ON carriers(email) 
  WHERE email IS NOT NULL AND email != '';

-- 6. Composite index for status + inserted_at (common combined filter)
CREATE INDEX IF NOT EXISTS idx_carriers_status_inserted ON carriers(carrier_status, inserted_at);

-- 7. Index on usdot_number_num for numeric range queries (if it exists)
CREATE INDEX IF NOT EXISTS idx_carriers_usdot_num ON carriers(usdot_number_num) WHERE usdot_number_num IS NOT NULL;
