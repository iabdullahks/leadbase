import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  try {
    const { data: runs, error } = await supabaseAdmin
      .from('sync_runs')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(10);

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    const latest = runs && runs.length > 0 ? runs[0] : null;
    const isSyncing = latest?.status === 'running';

    return NextResponse.json({
      ok: true,
      latest,
      isSyncing,
      runs: runs || []
    });
  } catch (err: unknown) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
