import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { buildCarrierQuery, defaultFilterState, resolveEquipmentCargoIds } from '@/lib/queryBuilder';
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

const VALID_DB_COLUMNS = new Set([
  'id', 'usdot_number', 'legal_name', 'dba_name', 'profile_url',
  'added_to_motus', 'motus_entry_date', 'motus_last_updated',
  'carrier_status', 'out_of_service', 'scraped_at', 'updated_at',
  'principal_address', 'mailing_address', 'phone', 'email',
  'duns', 'form_of_business', 'state_incorporated', 'new_entrant_status',
]);

// Chunk size per Supabase request — 1000 rows keeps well within the 8s statement_timeout
// even with joins. Keyset pagination means each chunk is always a fast indexed seek,
// not a full scan through millions of rows.
const KEYSET_CHUNK_SIZE = 1000;

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

  const dbQueryCols = requestedColumns.filter(c => VALID_DB_COLUMNS.has(c));
  // Always include 'id' for keyset pagination cursor (stripped from output if not in requestedColumns)
  const needId = !dbQueryCols.includes('id');
  const selectCols = dbQueryCols.length > 0
    ? (needId ? `id,${dbQueryCols.join(',')}` : dbQueryCols.join(','))
    : '*';

  const dateStr = new Date().toISOString().slice(0, 10);
  let allData: Record<string, unknown>[] = [];

  // ── Scope: Selected specific IDs ─────────────────────────────────────────
  if (scope === 'selected' && selectedIds.length > 0) {
    const chunkSize = 500;
    const promises = [];
    for (let i = 0; i < selectedIds.length; i += chunkSize) {
      const chunk = selectedIds.slice(i, i + chunkSize).map(id => String(id).trim());
      promises.push(
        supabaseAdmin
          .from('carriers')
          .select(selectCols)
          .in('usdot_number', chunk)
      );
    }
    const results = await Promise.all(promises);
    for (const res of results) {
      if (res.error) throw res.error;
      if (res.data) allData.push(...(res.data as unknown as Record<string, unknown>[]));
    }
  }
  // ── Scope: Current page visible rows ─────────────────────────────────────
  else if (scope === 'current_page') {
    if (currentPageIds.length > 0) {
      const pageIds = currentPageIds.map(id => String(id).trim());
      const { data, error } = await supabaseAdmin
        .from('carriers')
        .select(selectCols)
        .in('usdot_number', pageIds);
      if (error) throw error;
      allData = (data as unknown as Record<string, unknown>[]) || [];
    } else {
      const equipmentCargoIds = await resolveEquipmentCargoIds(supabaseAdmin, filters);
      let q = buildCarrierQuery(supabaseAdmin, filters, selectCols, false, equipmentCargoIds);
      q = q.order('id', { ascending: false }).range(0, 49);
      const { data, error } = await q;
      if (error) throw error;
      allData = (data as unknown as Record<string, unknown>[]) || [];
    }
  }
  // ── Scope: All Matching — Keyset/Cursor Pagination ───────────────────────
  // Uses `id > lastId` instead of OFFSET to avoid the O(offset) PostgreSQL scan cost.
  // Each chunk is a fast indexed seek regardless of position in the dataset.
  // This prevents statement_timeout even for millions of records.
  else {
    const requestedLimit = Math.min(Math.max(Number(body.limit) || KEYSET_CHUNK_SIZE, 1), 25000);
    const batchNum = Math.max(Number(body.batch_num) || 1, 1);

    // For multi-batch mode (frontend-controlled batching), use cursor passed in the request
    // or calculate approximate offset as OFFSET for batch 1 only, then switch to keyset.
    // For single-batch API calls from the frontend chunker, batch_num advances and we
    // use an optional cursor_id to do keyset pagination.
    const cursorId: number | null = typeof body.cursor_id === 'number' ? body.cursor_id : null;

    const equipmentCargoIds = await resolveEquipmentCargoIds(supabaseAdmin, filters);

    // Sequential keyset chunking within this API call:
    // If batchNum=1 and no cursor → start from id=0
    // If cursor_id provided → start from cursor_id
    // If batchNum>1 and no cursor → fall back to OFFSET (legacy, single batch call only)
    let currentCursorId = cursorId;

    if (currentCursorId === null && batchNum > 1) {
      // Legacy OFFSET fallback (only for the batch mode sub-option in ExportModal)
      // This is not used by the primary "all_stream" chunker which passes cursor_id
      const baseOffset = (batchNum - 1) * requestedLimit;
      const q = buildCarrierQuery(supabaseAdmin, filters, selectCols, false, equipmentCargoIds)
        .order('id', { ascending: true })
        .range(baseOffset, baseOffset + requestedLimit - 1);
      const { data, error } = await q;
      if (error) throw error;
      allData = (data as unknown as Record<string, unknown>[]) || [];
    } else {
      // Primary path: keyset pagination — each chunk starts from after the last seen id
      // This keeps each query O(chunk_size) regardless of position in dataset.
      let remaining = requestedLimit;
      let chunkCursor = currentCursorId ?? 0;

      while (remaining > 0) {
        const thisChunk = Math.min(KEYSET_CHUNK_SIZE, remaining);
        let q = buildCarrierQuery(supabaseAdmin, filters, selectCols, false, equipmentCargoIds)
          .order('id', { ascending: true })
          .limit(thisChunk);

        // Keyset: filter to rows with id > last seen id
        if (chunkCursor > 0) {
          q = q.gt('id', chunkCursor);
        }

        const { data, error } = await q;
        if (error) throw error;
        const rows = (data as unknown as Record<string, unknown>[]) || [];

        if (rows.length === 0) break; // No more data

        allData.push(...rows);
        remaining -= rows.length;

        // Advance cursor to the last id seen
        const lastRow = rows[rows.length - 1];
        const lastId = lastRow?.id;
        if (typeof lastId === 'number' && lastId > 0) {
          chunkCursor = lastId;
        } else {
          break; // id not available, stop to avoid infinite loop
        }

        if (rows.length < thisChunk) break; // Server returned fewer rows — end of data
      }
    }
  }

  // Strip the 'id' column from output if it wasn't in the user's requested columns
  // But first capture the last id for cursor-based pagination
  let lastIdForCursor = 0;
  if (allData.length > 0) {
    const lastRow = allData[allData.length - 1];
    const lastId = typeof lastRow?.id === 'number' ? lastRow.id : Number(lastRow?.id);
    if (Number.isFinite(lastId) && lastId > 0) lastIdForCursor = lastId;
  }

  if (needId && allData.length > 0) {
    allData = allData.map(row => {
      const { id: _id, ...rest } = row as Record<string, unknown> & { id?: unknown };
      return rest;
    });
  }

  // Determine dynamic, professional filename
  let filename = `leadbase_export_${allData.length}_leads_${dateStr}.${format === 'excel' ? 'csv' : format}`;
  if (scope === 'selected') {
    if (allData.length === 1) {
      const rawName = String(allData[0]?.legal_name || 'lead').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 30);
      filename = `lead_${allData[0]?.usdot_number || 'export'}_${rawName}.${format === 'excel' ? 'csv' : format}`;
    } else {
      filename = `leadbase_selected_${allData.length}_leads_${dateStr}.${format === 'excel' ? 'csv' : format}`;
    }
  } else if (scope === 'current_page') {
    filename = `leadbase_page_${allData.length}_leads_${dateStr}.${format === 'excel' ? 'csv' : format}`;
  }

  // ── Build Output ──────────────────────────────────────────────────────────
  if (format === 'json') {
    return new NextResponse(JSON.stringify(allData, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="${filename}"`,
        // Return the last cursor id so the frontend can pass it on the next call
        'X-Next-Cursor-Id': String(lastIdForCursor),
      },
    });
  }

  const headerRow = requestedColumns.map(c => csvEscapeValue(COLUMN_LABELS[c] || c)).join(',');
  const rows = allData.map(item => buildCsvRow(item, requestedColumns));
  // Include UTF-8 BOM (\uFEFF) so Excel & Sheets open accents, quotes, and commas flawlessly
  const csvContent = '\uFEFF' + [headerRow, ...rows].join('\n');

  return new NextResponse(csvContent, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      // Return last id as cursor for the next keyset pagination chunk call
      'X-Next-Cursor-Id': String(lastIdForCursor),
    },
  });
}

// ── GET handler ───────────────────────────────────────────────────────────
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

// ── POST handler ──────────────────────────────────────────────────────────
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
