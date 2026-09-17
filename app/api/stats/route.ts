import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  try {
    const now = new Date();
    // Use UTC day boundaries for consistent "today" counting
    const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
    const tomorrowStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0));

    const [totalRes, activeRes, phoneRes, emailRes, todayRes] = await Promise.all([
      // Total carriers
      supabaseAdmin
        .from('carriers')
        .select('usdot_number', { count: 'exact', head: true }),

      // Active carriers
      supabaseAdmin
        .from('carriers')
        .select('usdot_number', { count: 'exact', head: true })
        .eq('carrier_status', 'Active'),

      // Carriers with a non-empty phone number
      supabaseAdmin
        .from('carriers')
        .select('usdot_number', { count: 'exact', head: true })
        .neq('phone', '')
        .not('phone', 'is', null),

      // Carriers with a non-empty email address
      supabaseAdmin
        .from('carriers')
        .select('usdot_number', { count: 'exact', head: true })
        .neq('email', '')
        .not('email', 'is', null),

      // "Added Today": carriers where added_to_motus is today.
      // Single source of truth: added_to_motus in range [start-of-today, start-of-tomorrow UTC).
      supabaseAdmin
        .from('carriers')
        .select('usdot_number', { count: 'exact', head: true })
        .gte('added_to_motus', todayStart.toISOString())
        .lt('added_to_motus', tomorrowStart.toISOString()),
    ]);

    const todayCount = todayRes.count ?? 0;

    return NextResponse.json({
      total:      totalRes.count   ?? 0,
      active:     activeRes.count  ?? 0,
      with_phone: phoneRes.count   ?? 0,
      with_email: emailRes.count   ?? 0,
      new_today:  todayCount,
    });
  } catch (e: unknown) {
    console.error('GET /api/stats error:', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
