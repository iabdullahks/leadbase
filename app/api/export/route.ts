import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { buildCarrierQuery, defaultFilterState } from '@/lib/queryBuilder';
import { Carrier, FilterState } from '@/lib/types';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const filters: FilterState = body.filters || defaultFilterState();
    const format: 'csv' | 'excel' | 'json' = body.format || 'csv';
    const scope: 'all_matching' | 'selected' | 'current_page' = body.scope || 'all_matching';
    const selectedIds: string[] = body.selected_ids || [];
    const requestedColumns: string[] = body.columns || [
      'usdot_number', 'legal_name', 'dba_name', 'phone', 'email',
      'carrier_status', 'out_of_service', 'principal_address',
      'state_incorporated', 'motus_entry_date', 'scraped_at'
    ];

    let allData: Carrier[] = [];

    if (scope === 'selected' && selectedIds.length > 0) {
      const { data, error } = await supabaseAdmin
        .from('carriers')
        .select('*')
        .in('usdot_number', selectedIds);
      if (error) throw error;
      allData = (data as unknown as Carrier[]) || [];
    } else {
      // Fetch up to 50,000 records in batches of 1,000
      let page = 0;
      const batchSize = 1000;
      const maxRecords = scope === 'current_page' ? 50 : 50000;

      while (allData.length < maxRecords) {
        let q = buildCarrierQuery(supabaseAdmin, filters);
        q = q.order('scraped_at', { ascending: false }).range(page * batchSize, (page + 1) * batchSize - 1);
        const { data, error } = await q;
        if (error) throw error;
        if (!data || data.length === 0) break;
        allData.push(...(data as unknown as Carrier[]));
        if (data.length < batchSize || scope === 'current_page') break;
        page++;
      }
    }

    const filename = `leadbase_export_${new Date().toISOString().slice(0, 10)}.${format === 'excel' ? 'csv' : format}`;

    if (format === 'json') {
      const jsonContent = JSON.stringify(allData, null, 2);
      return new NextResponse(jsonContent, {
        headers: {
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="${filename}"`
        }
      });
    }

    // Generate CSV (compatible with CSV & Excel)
    const headers = requestedColumns.join(',');
    const rows = allData.map(item => {
      const rec = item as unknown as Record<string, unknown>;
      return requestedColumns.map(col => {
        let val = rec[col];
        if (val === null || val === undefined) val = '';
        if (typeof val === 'object') val = JSON.stringify(val);
        const str = String(val).replace(/"/g, '""');
        return `"${str}"`;
      }).join(',');
    });

    const csvContent = [headers, ...rows].join('\n');

    return new NextResponse(csvContent, {
      headers: {
        'Content-Type': format === 'excel' ? 'text/csv; charset=utf-8' : 'text/csv',
        'Content-Disposition': `attachment; filename="${filename}"`
      }
    });
  } catch (e: unknown) {
    console.error('API /api/export POST error:', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

// Fallback GET export handler
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const search = sp.get('search')?.trim() ?? '';
    const status = sp.get('status')?.trim() ?? 'all';
    const hasPhone = sp.get('has_phone') === '1';
    const hasEmail = sp.get('has_email') === '1';

    const filters: FilterState = {
      ...defaultFilterState(),
      global_search: search,
      carrier_statuses: status && status !== 'all' ? [status] : [],
      has_phone: hasPhone ? true : null,
      has_email: hasEmail ? true : null,
    };

    let q = buildCarrierQuery(supabaseAdmin, filters);
    q = q.order('scraped_at', { ascending: false }).limit(10000);

    const { data, error } = await q;
    if (error) throw error;

    const cols = ['usdot_number', 'legal_name', 'phone', 'email', 'carrier_status', 'out_of_service', 'scraped_at', 'motus_entry_date', 'profile_url'];
    const headers = cols.join(',');
    const rows = ((data as unknown as Record<string, unknown>[]) || []).map(item => {
      return cols.map(col => `"${String(item[col] ?? '').replace(/"/g, '""')}"`).join(',');
    });

    const csvContent = [headers, ...rows].join('\n');
    return new NextResponse(csvContent, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="leads_export_${new Date().toISOString().slice(0, 10)}.csv"`
      }
    });
  } catch (e: unknown) {
    console.error('API /api/export GET error:', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
