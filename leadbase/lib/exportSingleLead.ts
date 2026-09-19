import { Carrier } from './types';

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
  motus_entry_date: 'MOTUS Entry Date',
  motus_last_updated: 'MOTUS Last Updated',
  scraped_at: 'Date Added',
  profile_url: 'MOTUS Profile URL',
};

function csvEscape(val: unknown): string {
  if (val === null || val === undefined) return '""';
  if (typeof val === 'object') return `"${JSON.stringify(val).replace(/"/g, '""')}"`;
  const str = String(val).replace(/"/g, '""');
  return `"${str}"`;
}

/**
 * Instantly generates and triggers a client-side CSV download for a single carrier record.
 * Takes 0ms, zero server latency, zero network dependency.
 */
export function downloadSingleLeadCsv(carrier: Carrier | (Record<string, unknown> & { usdot_number: string })) {
  const columns = Object.keys(COLUMN_LABELS);
  const headerRow = columns.map(c => csvEscape(COLUMN_LABELS[c] || c)).join(',');
  const rowData = columns.map(c => csvEscape((carrier as Record<string, unknown>)[c])).join(',');

  // UTF-8 BOM (\uFEFF) ensures Excel & Google Sheets open special chars & commas cleanly
  const csvContent = '\uFEFF' + [headerRow, rowData].join('\n');

  const rawName = String(carrier.legal_name || 'lead').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 30);
  const fileName = `lead_${carrier.usdot_number}_${rawName}.csv`;

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const blobUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.style.display = 'none';
  link.href = blobUrl;
  link.setAttribute('download', fileName);
  document.body.appendChild(link);
  link.click();

  setTimeout(() => {
    document.body.removeChild(link);
    URL.revokeObjectURL(blobUrl);
  }, 2000);
}
