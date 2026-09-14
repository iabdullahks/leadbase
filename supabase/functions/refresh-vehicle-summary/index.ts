// supabase/functions/refresh-vehicle-summary/index.ts
//
// Edge Function that populates vehicle_type_summary by running the
// do_refresh_vehicle_type_summary() Postgres function via a direct
// database connection (bypasses PostgREST statement_timeout entirely).
//
// Deploy: npx supabase functions deploy refresh-vehicle-summary
// Call:   curl -X POST https://<project>.supabase.co/functions/v1/refresh-vehicle-summary \
//           -H "Authorization: Bearer <service_role_key>"

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async (req: Request) => {
  // Only allow POST
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  console.log('Starting vehicle_type_summary refresh...');
  const t0 = Date.now();

  // Call the server-side function — runs in the DB with no client timeout
  const { error } = await supabase.rpc('do_refresh_vehicle_type_summary');

  if (error) {
    console.error('Refresh failed:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`Refresh completed in ${elapsed}s`);

  // Return the resulting summary for verification
  const { data: summary } = await supabase
    .from('vehicle_type_summary')
    .select('vehicle_type, carrier_count, refreshed_at')
    .order('carrier_count', { ascending: false });

  return new Response(
    JSON.stringify({ ok: true, elapsed_seconds: elapsed, summary }),
    { headers: { 'Content-Type': 'application/json' } }
  );
});
