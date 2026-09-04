import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://gvlmqexqubzfvdegkyhm.supabase.co';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd2bG1xZXhxdWJ6ZnZkZWdreWhtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE4ODU1ODQsImV4cCI6MjA5NzQ2MTU4NH0.ZJBdTKrpavuQElVNdCk25oST8UJCyui11jpp36TJm8w';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd2bG1xZXhxdWJ6ZnZkZWdreWhtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTg4NTU4NCwiZXhwIjoyMDk3NDYxNTg0fQ.v_njVBEFkXan9YiA8Cfo89t6sO5TP3CQ-ig24Q1NfQY';

// Public client (browser-safe)
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Server-only admin client (service role — never expose to browser)
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

