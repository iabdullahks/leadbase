import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  try {
    const [totalRes, activeRes, inactiveRes, phoneRes, emailRes, todayRes] = await Promise.all([
      supabaseAdmin.from('carriers').select('usdot_number', { count: 'exact', head: true }),
      supabaseAdmin.from('carriers').select('usdot_number', { count: 'exact', head: true }).eq('carrier_status', 'Active'),
      supabaseAdmin.from('carriers').select('usdot_number', { count: 'exact', head: true }).eq('carrier_status', 'Inactive'),
      supabaseAdmin.from('carriers').select('usdot_number', { count: 'exact', head: true }).neq('phone', ''),
      supabaseAdmin.from('carriers').select('usdot_number', { count: 'exact', head: true }).neq('email', ''),
      supabaseAdmin.from('carriers').select('usdot_number', { count: 'exact', head: true })
        .gte('scraped_at', new Date().toISOString().slice(0, 10)),
    ]);

    return NextResponse.json({
      total:      totalRes.count   ?? 0,
      active:     activeRes.count  ?? 0,
      inactive:   inactiveRes.count ?? 0,
      with_phone: phoneRes.count   ?? 0,
      with_email: emailRes.count   ?? 0,
      new_today:  todayRes.count   ?? 0,
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
