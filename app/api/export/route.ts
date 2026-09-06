import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { buildCarrierQuery, defaultFilterState } from '@/lib/queryBuilder';
import { FilterState } from '@/lib/types';

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

async function runExport(body: Record<string, unknown>): Promise<NextResponse> {
  const filters: FilterState = (body.filters as FilterState) || defaultFilterState();
  const format: 'csv' | 'excel' | 'json' = (body.format as 'csv' | 'excel' | 'json') || 'csv';
  const scope: 'all_matching' | 'selected' | 'current_page' =
    (body.scope as 'all_matching' | 'selected' | 'current_page') || 'all_matching';
  const selectedIds: string[] = (body.selected_ids as string[]) || [];
  const currentPageIds: string[] = (body.current_page_ids as string[]) || [];
  const requestedColumns: string[] = (body.columns as string[]) || [
    'usdot_number', 'legal_name', 'dba_name', 'phone', 'email',
    'carrier_status', 'out_of_service', 'principal_address',
    'state_incorporated', 'motus_entry_date', 'scraped_at',
  ];

  const batchNumForFilename = Number(body.batch_num) || 1;
  const filename = `leadbase_batch${batchNumForFilename}_${new Date().toISOString().slice(0, 10)}.${format === 'excel' ? 'csv' : format}`;
  const selectCols = requestedColumns.join(',');

  let allData: Record<string, unknown>[] = [];

  // ── Scope: Selected specific IDs ─────────────────────────────────────────
  if (scope === 'selected' && selectedIds.length > 0) {
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
      let q = buildCarrierQuery(supabaseAdmin, filters, selectCols, false);
      q = q.order('id', { ascending: false }).range(0, 49);
      const { data, error } = await q;
      if (error) throw error;
      allData = (data as unknown as Record<string, unknown>[]) || [];
    }
  }
  // ── Scope: All Matching (paginated batches of 1000) ───────────────────────
  else {
    const batchSize = 1000;
    const batchNum = Math.max(Number(body.batch_num) || 1, 1);
    const from = (batchNum - 1) * batchSize;
    const to = from + batchSize - 1;
    let q = buildCarrierQuery(supabaseAdmin, filters, selectCols, false);
    const { data, error } = await q.order('id', { ascending: false }).range(from, to);
    if (error) throw error;
    allData = (data as unknown as Record<string, unknown>[]) || [];
  }

  // ── Build Output ──────────────────────────────────────────────────────────
  if (format === 'json') {
    return new NextResponse(JSON.stringify(allData, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  }

  const headerRow = requestedColumns.map(c => csvEscapeValue(COLUMN_LABELS[c] || c)).join(',');
  const rows = allData.map(item => buildCsvRow(item, requestedColumns));
  const csvContent = [headerRow, ...rows].join('\n');

  return new NextResponse(csvContent, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}

// ── GET: browser-native download via window.open / direct navigation ──────
// Frontend calls: window.open('/api/export?d=BASE64_JSON')
// This avoids all fetch+blob async download issues completely.
export async function GET(req: NextRequest) {
  try {
    const d = req.nextUrl.searchParams.get('d');
    if (!d) {
      return NextResponse.json({ error: 'Missing export params (d)' }, { status: 400 });
    }
    const body = JSON.parse(Buffer.from(d, 'base64').toString('utf-8')) as Record<string, unknown>;
    return await runExport(body);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('API /api/export GET error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ── POST: kept for compatibility ──────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    return await runExport(body);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : (typeof e === 'object' && e !== null && 'message' in e) ? String((e as { message: unknown }).message) : String(e);
    console.error('API /api/export POST error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
