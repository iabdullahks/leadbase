import { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET(req: NextRequest) {
  const sp       = req.nextUrl.searchParams;
  const search   = sp.get('search')?.trim() ?? '';
  const status   = sp.get('status')?.trim() ?? 'all';
  const hasPhone = sp.get('has_phone') === '1';
  const hasEmail = sp.get('has_email') === '1';
  const dateFrom = sp.get('date_from')?.trim() ?? '';
  const dateTo   = sp.get('date_to')?.trim() ?? '';

  const fields = 'usdot_number, legal_name, phone, email, carrier_status, out_of_service, scraped_at, motus_entry_date, profile_url';

  try {
    let allData: Record<string, unknown>[] = [];
    let page = 0;
    const batchSize = 1000;

    while (true) {
      let q = supabaseAdmin.from('carriers').select(fields);
      if (status && status !== 'all') q = q.eq('carrier_status', status.charAt(0).toUpperCase() + status.slice(1));
      if (hasPhone) q = q.neq('phone', '');
      if (hasEmail) q = q.neq('email', '');
      if (dateFrom) q = q.gte('scraped_at', dateFrom);
      if (dateTo)   q = q.lte('scraped_at', dateTo + 'T23:59:59');
      if (search)   q = q.or(`legal_name.ilike.%${search}%,usdot_number.ilike.%${search}%,phone.ilike.%${search}%,email.ilike.%${search}%`);
      q = q.order('scraped_at', { ascending: false }).range(page * batchSize, (page + 1) * batchSize - 1);

      const { data, error } = await q;
      if (error || !data || data.length === 0) break;
      allData = allData.concat(data);
      if (data.length < batchSize) break;
      page++;
    }

    const headers = ['USDOT Number', 'Legal Business Name', 'Phone', 'Email', 'Status', 'Out of Service', 'MOTUS Entry Date', 'Date Scraped', 'Profile URL'];
    const rows = allData.map(r => [
      r.usdot_number, r.legal_name, r.phone, r.email,
      r.carrier_status, r.out_of_service, r.motus_entry_date,
      r.scraped_at, r.profile_url,
    ].map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','));

    const csv = [headers.join(','), ...rows].join('\r\n');
    const date = new Date().toISOString().slice(0, 10);

    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="leadbase_export_${date}.csv"`,
      },
    });
  } catch (e: unknown) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
}
