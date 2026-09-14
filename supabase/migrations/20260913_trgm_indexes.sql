-- Migration: pg_trgm index on vehicles.vehicle_type for fast ILIKE pattern matching
-- Date: 2026-09-13
--
-- Why: The distinct_vehicle_carrier_ids RPC uses ILIKE patterns against
-- vehicles.vehicle_type. The existing idx_vehicles_type B-tree index can only
-- accelerate prefix matches (Pattern%) but not substring matches (%Pattern%).
-- A GIN index with pg_trgm supports ILIKE with any wildcard position in O(log n).
--
-- Run this once in Supabase SQL Editor:

-- 1. Enable pg_trgm extension (idempotent)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 2. GIN trigram index on vehicle_type
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vehicles_type_trgm
  ON vehicles USING GIN (vehicle_type gin_trgm_ops);

-- 3. Same for cargo_classifications.classification (used by distinct_cargo_carrier_ids)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cargo_classification_trgm
  ON cargo_classifications USING GIN (classification gin_trgm_ops);

-- After this migration, both %Pattern% and Pattern% ILIKE queries will use the
-- trigram index and avoid full seq scans, eliminating the statement timeout.
