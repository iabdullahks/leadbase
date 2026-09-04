import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { SavedView } from '@/lib/types';

export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from('saved_views')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.warn('Saved views table query notice:', error.message);
      return NextResponse.json({ views: [] });
    }

    return NextResponse.json({ views: data || [] });
  } catch (e: unknown) {
    return NextResponse.json({ views: [] });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, filter_state, description } = body;

    const newView: Partial<SavedView> = {
      name: name || 'Saved View',
      description: description || '',
      filter_state: filter_state || {},
      created_at: new Date().toISOString()
    };

    const { data, error } = await supabaseAdmin
      .from('saved_views')
      .insert(newView)
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ view: data });
  } catch (e: unknown) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const id = sp.get('id');
    if (!id) return NextResponse.json({ error: 'ID required' }, { status: 400 });

    const { error } = await supabaseAdmin
      .from('saved_views')
      .delete()
      .eq('id', id);

    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
