import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { ExportHistoryItem } from '@/lib/types';

export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from('export_history')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      console.warn('Export history table query notice:', error.message);
      return NextResponse.json({ history: [] });
    }

    return NextResponse.json({ history: data || [] });
  } catch (e: unknown) {
    return NextResponse.json({ history: [] });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const item: Partial<ExportHistoryItem> = {
      file_name: body.file_name || `export_${Date.now()}.csv`,
      format: body.format || 'csv',
      record_count: Number(body.record_count || 0),
      filter_summary: body.filter_summary || 'All records',
      filter_state: body.filter_state || {},
      status: 'completed',
      created_at: new Date().toISOString()
    };

    const { data, error } = await supabaseAdmin
      .from('export_history')
      .insert(item)
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ item: data });
  } catch (e: unknown) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
