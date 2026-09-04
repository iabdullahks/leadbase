import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { buildCarrierQuery, defaultFilterState } from '@/lib/queryBuilder';
import { FilterState } from '@/lib/types';

const PAGE_SIZE = 50;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const filters: FilterState = body.filters || defaultFilterState();
    const page = Math.max(Number(body.page || 1), 1);
    const limit = Math.min(Math.max(Number(body.limit || PAGE_SIZE), 1), 500);
    const sort = body.sort || 'scraped_at';
    const dir = body.dir === 'asc';

    const offset = (page - 1) * limit;

    let q = buildCarrierQuery(supabaseAdmin, filters);
    q = q.order(sort, { ascending: dir }).range(offset, offset + limit - 1);

    const { data, count, error } = await q;
    if (error) throw error;

    const total = count ?? 0;
    const pages = Math.max(Math.ceil(total / limit), 1);

    return NextResponse.json({ leads: data ?? [], total, page, pages, per_page: limit });
  } catch (e: unknown) {
    console.error('API /api/leads POST error:', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const page = Math.max(parseInt(sp.get('page') ?? '1'), 1);
    const limit = Math.min(Math.max(parseInt(sp.get('limit') ?? String(PAGE_SIZE)), 1), 500);
    const search = sp.get('search')?.trim() ?? '';
    const status = sp.get('status')?.trim() ?? 'all';
    const hasPhone = sp.get('has_phone') === '1';
    const hasEmail = sp.get('has_email') === '1';
    const sort = sp.get('sort') ?? 'scraped_at';
    const dir = sp.get('dir') === 'asc';
    const dateFrom = sp.get('date_from')?.trim() ?? '';
    const dateTo = sp.get('date_to')?.trim() ?? '';
    const state = sp.get('state')?.trim() ?? '';

    const filters: FilterState = {
      ...defaultFilterState(),
      global_search: search,
      carrier_statuses: status && status !== 'all' ? [status] : [],
      has_phone: hasPhone ? true : null,
      has_email: hasEmail ? true : null,
      states: state ? [state] : [],
      date_from: dateFrom,
      date_to: dateTo,
      date_preset: dateFrom || dateTo ? 'custom' : 'all',
    };

    const offset = (page - 1) * limit;
    let q = buildCarrierQuery(supabaseAdmin, filters);
    q = q.order(sort, { ascending: dir }).range(offset, offset + limit - 1);

    const { data, count, error } = await q;
    if (error) throw error;

    const total = count ?? 0;
    const pages = Math.max(Math.ceil(total / limit), 1);

    return NextResponse.json({ leads: data ?? [], total, page, pages, per_page: limit });
  } catch (e: unknown) {
    console.error('API /api/leads GET error:', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
