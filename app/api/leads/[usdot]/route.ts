import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET(req: NextRequest, { params }: { params: Promise<{ usdot: string }> }) {
  try {
    const { usdot } = await params;
    const { data, error } = await supabaseAdmin
      .from('carriers')
      .select('*')
      .eq('usdot_number', usdot)
      .single();
    if (error) throw error;
    return NextResponse.json(data ?? {});
  } catch (e: unknown) {
    return NextResponse.json({ error: String(e) }, { status: 404 });
  }
}
