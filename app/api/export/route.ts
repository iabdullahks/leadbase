import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { buildCarrierQuery, defaultFilterState } from '@/lib/queryBuilder';
import { Carrier, FilterState } from '@/lib/types';

// Extend serverless function timeout for large exports (Vercel Pro allows up to 60s)
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
    // current_page_ids: when scope is 'current_page', the client sends the visible row IDs
    const currentPageIds: string[] = body.current_page_ids || [];
    const requestedColumns: string[] = body.columns || [
      'usdot_number', 'legal_name', 'dba_name', 'phone', 'email',
      'carrier_status', 'out_of_service', 'principal_address',
      'state_incorporated', 'motus_entry_date', 'scraped_at'
    ];

    const filename = `leadbase_export_${new Date().toISOString().slice(0, 10)}.${format === 'excel' ? 'csv' : format}`;
    const selectCols = requestedColumns.join(',');

    // ── Scope: Selected specific IDs ─────────────────────────────────────────
    if (scope === 'selected' && selectedIds.length > 0) {
      const { data, error } = await supabaseAdmin
        .from('carriers')
        .select(selectCols)
        .in('usdot_number', selectedIds);
      if (error) throw error;
      const allData = (data as unknown as Carrier[]) || [];

      if (format === 'json') {
        return new NextResponse(JSON.stringify(allData, null, 2), {
          headers: {
            'Content-Type': 'application/json',
            'Content-Disposition': `attachment; filename="${filename}"`,
          },
        });
      }

      const headerRow = requestedColumns.map(c => csvEscapeValue(COLUMN_LABELS[c] || c)).join(',');
      const rows = allData.map(item => buildCsvRow(item as unknown as Record<string, unknown>, requestedColumns));
      const csvContent = [headerRow, ...rows].join('\n');
      return new NextResponse(csvContent, {
        headers: {
          'Content-Type': format === 'excel' ? 'text/csv; charset=utf-8' : 'text/csv',
          'Content-Disposition': `attachment; filename="${filename}"`,
        },
      });
    }

    // ── Scope: Current page (use the IDs of the currently visible rows) ──────
    if (scope === 'current_page') {
      // If the client provided current page IDs, fetch those specifically.
      // This ensures the export exactly matches what the user sees on screen.
      if (currentPageIds.length > 0) {
        const { data, error } = await supabaseAdmin
          .from('carriers')
          .select(selectCols)
          .in('usdot_number', currentPageIds);
        if (error) throw error;
        const pageData = (data as unknown as Carrier[]) || [];

        if (format === 'json') {
          return new NextResponse(JSON.stringify(pageData, null, 2), {
            headers: {
              'Content-Type': 'application/json',
              'Content-Disposition': `attachment; filename="${filename}"`,
            },
          });
        }

        const headerRow = requestedColumns.map(c => csvEscapeValue(COLUMN_LABELS[c] || c)).join(',');
        const rows = pageData.map(item => buildCsvRow(item as unknown as Record<string, unknown>, requestedColumns));
        const csvContent = [headerRow, ...rows].join('\n');
        return new NextResponse(csvContent, {
          headers: {
            'Content-Type': format === 'excel' ? 'text/csv; charset=utf-8' : 'text/csv',
            'Content-Disposition': `attachment; filename="${filename}"`,
          },
        });
      }

      // Fallback: fetch first page with filters applied (50 rows)
      let q = buildCarrierQuery(supabaseAdmin, filters, selectCols, false);
      q = q.order('id', { ascending: false }).range(0, 49);
      const { data, error } = await q;
      if (error) throw error;
      const pageData = (data as unknown as Carrier[]) || [];

      if (format === 'json') {
        return new NextResponse(JSON.stringify(pageData, null, 2), {
          headers: {
            'Content-Type': 'application/json',
            'Content-Disposition': `attachment; filename="${filename}"`,
          },
        });
      }

      const headerRow = requestedColumns.map(c => csvEscapeValue(COLUMN_LABELS[c] || c)).join(',');
      const rows = pageData.map(item => buildCsvRow(item as unknown as Record<string, unknown>, requestedColumns));
      const csvContent = [headerRow, ...rows].join('\n');
      return new NextResponse(csvContent, {
        headers: {
          'Content-Type': format === 'excel' ? 'text/csv; charset=utf-8' : 'text/csv',
          'Content-Disposition': `attachment; filename="${filename}"`,
        },
      });
    }

    // ── Scope: All Matching — Streaming paginated export ──────────────────────
    // For large exports we stream the response so we avoid:
    // 1. Loading all records into memory at once (OOM risk)
    // 2. Long response times that trigger timeouts before the first byte is sent
    // 3. Browser freezing waiting for a huge buffered response blob

    const maxRecords = Math.min(Number(body.limit) || 10000, 50000);
    const batchSize = 1000;

    if (format === 'json') {
      // For JSON we still need to collect all data since JSON arrays need a wrapper
      // but we cap it and stream chunks
      const allData: Carrier[] = [];
      let page = 0;
      while (allData.length < maxRecords) {
        let q = buildCarrierQuery(supabaseAdmin, filters, selectCols, false);
        q = q.order('id', { ascending: false }).range(page * batchSize, (page + 1) * batchSize - 1);
        const { data, error } = await q;
        if (error) throw error;
        if (!data || data.length === 0) break;
        allData.push(...(data as unknown as Carrier[]));
        if (data.length < batchSize) break;
        page++;
      }
      const trimmed = allData.slice(0, maxRecords);
      return new NextResponse(JSON.stringify(trimmed, null, 2), {
        headers: {
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="${filename}"`,
        },
      });
    }

    // CSV / Excel: stream using ReadableStream — writes header then rows batch by batch
    const headerRow = requestedColumns.map(c => csvEscapeValue(COLUMN_LABELS[c] || c)).join(',') + '\n';

    let page = 0;
    let fetched = 0;
    let isDone = false;

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        // Write header first
        controller.enqueue(encoder.encode(headerRow));

        while (fetched < maxRecords && !isDone) {
          try {
            let q = buildCarrierQuery(supabaseAdmin, filters, selectCols, false);
            q = q.order('id', { ascending: false }).range(page * batchSize, Math.min((page + 1) * batchSize - 1, maxRecords - 1));
            const { data, error } = await q;

            if (error) {
              controller.error(error);
              return;
            }
            if (!data || data.length === 0) {
              isDone = true;
              break;
            }

            const rows = (data as unknown as Record<string, unknown>[]).map(item => buildCsvRow(item, requestedColumns));
            // Write in chunks to avoid huge single enqueues
            controller.enqueue(encoder.encode(rows.join('\n') + '\n'));

            fetched += data.length;
            if (data.length < batchSize) {
              isDone = true;
            }
            page++;
          } catch (err) {
            controller.error(err);
            return;
          }
        }

        controller.close();
      },
    });

    return new NextResponse(stream, {
      headers: {
        'Content-Type': format === 'excel' ? 'text/csv; charset=utf-8' : 'text/csv',
        'Content-Disposition': `attachment; filename="${filename}"`,
        // Instruct browser not to buffer — helps with large downloads
        'Transfer-Encoding': 'chunked',
        'X-Content-Type-Options': 'nosniff',
      },
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
    const headerRow = cols.map(c => csvEscapeValue(COLUMN_LABELS[c] || c)).join(',');
    const rows = ((data as unknown as Record<string, unknown>[]) || []).map(item => buildCsvRow(item, cols));

    const csvContent = [headerRow, ...rows].join('\n');
    return new NextResponse(csvContent, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="leads_export_${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  } catch (e: unknown) {
    console.error('API /api/export GET error:', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
