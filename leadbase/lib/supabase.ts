import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// Public client (browser-safe)
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Server-only admin client (service role — never expose to browser)
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

