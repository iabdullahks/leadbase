import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

const PAGE_SIZE = 50;
const ALLOWED_SORTS = new Set(['usdot_number', 'legal_name', 'carrier_status', 'scraped_at', 'motus_entry_date']);
const FIELDS = 'usdot_number, legal_name, phone, email, carrier_status, out_of_service, scraped_at, motus_entry_date, profile_url';

export async function GET(req: NextRequest) {
  try {
    const sp       = req.nextUrl.searchParams;
    const page     = Math.max(parseInt(sp.get('page') ?? '1'), 1);
    const search   = sp.get('search')?.trim() ?? '';
    const status   = sp.get('status')?.trim() ?? 'all';
    const hasPhone = sp.get('has_phone') === '1';
    const hasEmail = sp.get('has_email') === '1';
    const sortRaw  = sp.get('sort') ?? 'scraped_at';
    const sort     = ALLOWED_SORTS.has(sortRaw) ? sortRaw : 'scraped_at';
    const dir      = sp.get('dir') === 'asc' ? false : true; // descending by default
    const dateFrom = sp.get('date_from')?.trim() ?? '';
    const dateTo   = sp.get('date_to')?.trim() ?? '';
    const offset   = (page - 1) * PAGE_SIZE;

    let q = supabaseAdmin.from('carriers').select(FIELDS, { count: 'exact' });

    if (status && status !== 'all') {
      q = q.eq('carrier_status', status.charAt(0).toUpperCase() + status.slice(1));
    }
    if (hasPhone) q = q.neq('phone', '');
    if (hasEmail) q = q.neq('email', '');
    if (dateFrom) q = q.gte('scraped_at', dateFrom);
    if (dateTo)   q = q.lte('scraped_at', dateTo + 'T23:59:59');
    if (search)   q = q.or(`legal_name.ilike.%${search}%,usdot_number.ilike.%${search}%,phone.ilike.%${search}%,email.ilike.%${search}%`);

    q = q.order(sort, { ascending: !dir }).range(offset, offset + PAGE_SIZE - 1);

    const { data, count, error } = await q;
    if (error) throw error;

    const total = count ?? 0;
    const pages = Math.max(Math.ceil(total / PAGE_SIZE), 1);

    return NextResponse.json({ leads: data ?? [], total, page, pages, per_page: PAGE_SIZE });
  } catch (e: unknown) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
