import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { buildCarrierQuery, defaultFilterState } from '@/lib/queryBuilder';
import { Carrier, FilterState } from '@/lib/types';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

// Human-readable column header names for CSV exports
const COLUMN_LABELS: Record<string, string> = {
  usdot_number: 'USDOT Number',
  legal_name: 'Legal Name',
  dba_name: 'DBA Name',
  mc_number: 'MC Number',
  phone: 'Phone Number',
  email: 'Email Address',
  website: 'Website',
  carrier_status: 'Carrier Status',
  out_of_service: 'Out of Service',
  principal_address: 'Principal Address',
  mailing_address: 'Mailing Address',
  city: 'City',
  state: 'State',
  zip_code: 'ZIP Code',
  state_incorporated: 'State Incorporated',
  form_of_business: 'Form of Business',
  power_units: 'Power Units',
  drivers: 'Drivers',
  total_vehicles: 'Total Vehicles',
  tractors: 'Tractors',
  trailers: 'Trailers',
  new_entrant_status: 'New Entrant Status',
  authority_status: 'Authority Status',
  motus_entry_date: 'MOTUS Entry Date',
  motus_last_updated: 'MOTUS Last Updated',
  added_to_motus: 'Added to MOTUS',
  scraped_at: 'Date Added',
  profile_url: 'MOTUS Profile URL',
};

function csvEscapeValue(val: unknown): string {
  if (val === null || val === undefined) return '""';
  if (typeof val === 'object') return `"${JSON.stringify(val).replace(/"/g, '""')}"`;
  const str = String(val).replace(/"/g, '""');
  return `"${str}"`;
}

function buildCsvRow(item: Record<string, unknown>, columns: string[]): string {
  return columns.map(col => csvEscapeValue(item[col])).join(',');
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const filters: FilterState = body.filters || defaultFilterState();
    const format: 'csv' | 'excel' | 'json' = body.format || 'csv';
    const scope: 'all_matching' | 'selected' | 'current_page' = body.scope || 'all_matching';
    const selectedIds: string[] = body.selected_ids || [];
    const currentPageIds: string[] = body.current_page_ids || [];
    const requestedColumns: string[] = body.columns || [
      'usdot_number', 'legal_name', 'dba_name', 'phone', 'email',
      'carrier_status', 'out_of_service', 'principal_address',
      'state_incorporated', 'motus_entry_date', 'scraped_at'
    ];

    const filename = `leadbase_export_${new Date().toISOString().slice(0, 10)}.${format === 'excel' ? 'csv' : format}`;
    const selectCols = requestedColumns.join(',');

    let allData: Record<string, unknown>[] = [];

    // ── Scope: Selected specific IDs ─────────────────────────────────────────
    if (scope === 'selected' && selectedIds.length > 0) {
      // Chunk large selected IDs in batches of 500
      const chunkSize = 500;
      for (let i = 0; i < selectedIds.length; i += chunkSize) {
        const chunk = selectedIds.slice(i, i + chunkSize);
        const { data, error } = await supabaseAdmin
          .from('carriers')
          .select(selectCols)
          .in('usdot_number', chunk);
        if (error) throw error;
        if (data) allData.push(...(data as unknown as Record<string, unknown>[]));
      }
    }
    // ── Scope: Current page visible rows ─────────────────────────────────────
    else if (scope === 'current_page') {
      if (currentPageIds.length > 0) {
        const { data, error } = await supabaseAdmin
          .from('carriers')
          .select(selectCols)
          .in('usdot_number', currentPageIds);
        if (error) throw error;
        allData = (data as unknown as Record<string, unknown>[]) || [];
      } else {
        // Fallback: fetch first page with filters applied (50 rows)
        let q = buildCarrierQuery(supabaseAdmin, filters, selectCols, false);
        q = q.order('id', { ascending: false }).range(0, 49);
        const { data, error } = await q;
        if (error) throw error;
        allData = (data as unknown as Record<string, unknown>[]) || [];
      }
    }
    // ── Scope: All Matching — High-speed concurrent batch fetching ───────────
    else {
      const maxRecords = Math.min(Math.max(Number(body.limit) || 1000, 1), 50000);
      const batchSize = 1000;
      const totalBatches = Math.ceil(maxRecords / batchSize);
      // Run up to 4 batches concurrently for 4x faster export speed
      const concurrency = 4;

      for (let i = 0; i < totalBatches; i += concurrency) {
        const batchIndexes: number[] = [];
        for (let j = i; j < Math.min(i + concurrency, totalBatches); j++) {
          batchIndexes.push(j);
        }

        const chunkPromises = batchIndexes.map(idx => {
          const from = idx * batchSize;
          const to = Math.min((idx + 1) * batchSize - 1, maxRecords - 1);
          let q = buildCarrierQuery(supabaseAdmin, filters, selectCols, false);
          return q.order('id', { ascending: false }).range(from, to);
        });

        const results = await Promise.all(chunkPromises);
        let finished = false;

        for (const res of results) {
          if (res.error) throw res.error;
          const data = (res.data as unknown as Record<string, unknown>[]) || [];
          allData.push(...data);
          if (data.length < batchSize) {
            finished = true;
            break;
          }
        }

        if (finished || allData.length >= maxRecords) break;
      }

      if (allData.length > maxRecords) {
        allData = allData.slice(0, maxRecords);
      }
    }

    // ── Build Output Format ──────────────────────────────────────────────────
    if (format === 'json') {
      const jsonContent = JSON.stringify(allData, null, 2);
      return new NextResponse(jsonContent, {
        headers: {
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Content-Length': String(Buffer.byteLength(jsonContent, 'utf-8')),
        },
      });
    }

    // CSV or Excel format
    const headerRow = requestedColumns.map(c => csvEscapeValue(COLUMN_LABELS[c] || c)).join(',');
    const rows = allData.map(item => buildCsvRow(item, requestedColumns));
    const csvContent = [headerRow, ...rows].join('\n');

    return new NextResponse(csvContent, {
      headers: {
        'Content-Type': format === 'excel' ? 'text/csv; charset=utf-8' : 'text/csv',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(Buffer.byteLength(csvContent, 'utf-8')),
      },
    });

  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : (typeof e === 'object' && e !== null && 'message' in e) ? String((e as { message: unknown }).message) : String(e);
    console.error('API /api/export POST error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
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
    q = q.order('scraped_at', { ascending: false }).limit(1000);

    const { data, error } = await q;
    if (error) throw error;

    const cols = ['usdot_number', 'legal_name', 'phone', 'email', 'carrier_status', 'out_of_service', 'scraped_at', 'motus_entry_date', 'profile_url'];
    const headerRow = cols.map(c => csvEscapeValue(COLUMN_LABELS[c] || c)).join(',');
    const rows = ((data as unknown as Record<string, unknown>[]) || []).map(item => buildCsvRow(item, cols));

    const csvContent = [headerRow, ...rows].join('\n');
    return new NextResponse(csvContent, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="leads_export_${new Date().toISOString().slice(0, 10)}.csv"`,
        'Content-Length': String(Buffer.byteLength(csvContent, 'utf-8')),
      },
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('API /api/export GET error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
