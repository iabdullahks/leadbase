import { supabaseAdmin } from '@/lib/supabase';
import type { Carrier } from '@/lib/types';
import Link from 'next/link';
import ExportLeadButton from './ExportLeadButton';
import { notFound } from 'next/navigation';
import {
  ChevronLeftIcon,
  PhoneIcon,
  MailIcon,
  ExternalLinkIcon,
  BuildingIcon,
  CalendarIcon,
  DatabaseIcon,
  CheckCircleIcon,
  AlertCircleIcon
} from '@/app/components/Icons';

function formatDate(iso: string) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return iso;
  }
}

function StatusPill({ status }: { status: string }) {
  const s = (status ?? '').toLowerCase();
  const cls = s === 'active' ? 'pill-active' : s === 'inactive' ? 'pill-inactive' : s === 'pending' ? 'pill-pending' : 'pill-other';
  return (
    <span className={`pill ${cls}`}>
      <span className="pill-dot" />
      {status || 'Unknown'}
    </span>
  );
}

export default async function LeadDetailPage({ params }: { params: Promise<{ usdot: string }> }) {
  const { usdot } = await params;

  let lead = null;
  try {
    const { data, error } = await supabaseAdmin
      .from('carriers')
      .select('*')
      .eq('usdot_number', usdot)
      .single();
    if (!error && data) lead = data;
  } catch (e) {
    console.error('Lead detail fetch error:', e);
  }

  if (!lead) notFound();

  const c = lead as Carrier & Record<string, unknown>;

  return (
    <div className="detail-page">
      <Link href="/leads" className="btn-back">
        <ChevronLeftIcon size={14} />
        <span>Back to Leads Explorer</span>
      </Link>

      {/* Header */}
      <div className="detail-header-card fade-up">
        <div>
          <h1 className="detail-title">{c.legal_name || 'Unnamed Carrier'}</h1>
          <div className="detail-badges">
            <span className="badge-usdot">USDOT #{c.usdot_number}</span>
            <StatusPill status={c.carrier_status} />
            {c.out_of_service && (
              <span className="pill pill-inactive">
                <span className="pill-dot" />
                Out of Service
              </span>
            )}
          </div>
        </div>

        <div className="detail-actions">
          <ExportLeadButton carrier={c} />
          <a
            href={c.profile_url as string || `https://motus.dot.gov/customer/${c.usdot_number}/account`}
            target="_blank"
            rel="noreferrer"
            className="da-btn da-blue"
            style={{ textDecoration: 'none' }}
          >
            <ExternalLinkIcon size={14} />
            <span>View on MOTUS</span>
          </a>
          {c.phone && (
            <a href={`tel:${c.phone}`} className="da-btn da-green" style={{ textDecoration: 'none' }}>
              <PhoneIcon size={14} />
              <span>{c.phone as string}</span>
            </a>
          )}
          {c.email && (
            <a href={`mailto:${c.email}`} className="da-btn da-purple" style={{ textDecoration: 'none' }}>
              <MailIcon size={14} />
              <span>Email Carrier</span>
            </a>
          )}
        </div>
      </div>

      {/* Detail grid */}
      <div className="detail-grid fade-up" style={{ animationDelay: '0.08s' }}>
        {/* Contact */}
        <div className="info-card">
          <div className="info-card-title">
            <PhoneIcon size={15} style={{ color: 'var(--green-bright)' }} />
            <span>Contact Information</span>
          </div>
          <div className="info-rows">
            <div className="info-row">
              <span className="ir-label">Phone</span>
              <span className="ir-value">
                {c.phone ? (
                  <a href={`tel:${c.phone}`} style={{ color: '#34d399', textDecoration: 'none', fontWeight: 600 }}>
                    {c.phone as string}
                  </a>
                ) : (
                  <span style={{ color: 'var(--text-tertiary)' }}>—</span>
                )}
              </span>
            </div>
            <div className="info-row">
              <span className="ir-label">Email</span>
              <span className="ir-value">
                {c.email ? (
                  <a href={`mailto:${c.email}`} style={{ color: '#c084fc', textDecoration: 'none' }}>
                    {c.email as string}
                  </a>
                ) : (
                  <span style={{ color: 'var(--text-tertiary)' }}>—</span>
                )}
              </span>
            </div>
            {c.principal_address && (
              <div className="info-row">
                <span className="ir-label">Address</span>
                <span className="ir-value" style={{ fontSize: '0.8rem' }}>{c.principal_address as string}</span>
              </div>
            )}
          </div>
        </div>

        {/* Registration */}
        <div className="info-card">
          <div className="info-card-title">
            <BuildingIcon size={15} style={{ color: 'var(--cyan)' }} />
            <span>Authority &amp; Classification</span>
          </div>
          <div className="info-rows">
            <div className="info-row">
              <span className="ir-label">Status</span>
              <span className="ir-value"><StatusPill status={c.carrier_status} /></span>
            </div>
            <div className="info-row">
              <span className="ir-label">Out of Service</span>
              <span className="ir-value" style={{ color: c.out_of_service ? 'var(--red)' : '#34d399', fontWeight: 600 }}>
                {c.out_of_service ? 'Yes' : 'No'}
              </span>
            </div>
            {c.form_of_business && (
              <div className="info-row">
                <span className="ir-label">Business Type</span>
                <span className="ir-value">{c.form_of_business as string}</span>
              </div>
            )}
            {c.dba_name && (
              <div className="info-row">
                <span className="ir-label">DBA Name</span>
                <span className="ir-value">{c.dba_name as string}</span>
              </div>
            )}
          </div>
        </div>

        {/* Timestamps */}
        <div className="info-card">
          <div className="info-card-title">
            <CalendarIcon size={15} style={{ color: '#60a5fa' }} />
            <span>Discovery &amp; Scrape Timeline</span>
          </div>
          <div className="info-rows">
            <div className="info-row">
              <span className="ir-label">Added on Motus</span>
              <span className="ir-value" style={{ fontSize: '0.8rem' }}>{formatDate(c.added_to_motus || c.motus_entry_date)}</span>
            </div>
            <div className="info-row">
              <span className="ir-label">MOTUS Entry Date</span>
              <span className="ir-value" style={{ fontSize: '0.8rem' }}>{formatDate(c.motus_entry_date)}</span>
            </div>
            <div className="info-row">
              <span className="ir-label">Last Updated</span>
              <span className="ir-value" style={{ fontSize: '0.8rem' }}>{formatDate(c.motus_last_updated)}</span>
            </div>
            <div className="info-row">
              <span className="ir-label">Date Scraped</span>
              <span className="ir-value" style={{ fontSize: '0.8rem' }}>{formatDate(c.scraped_at)}</span>
            </div>
          </div>
        </div>

        {/* Raw data preview */}
        {c.raw_data && (
          <div className="info-card">
            <div className="info-card-title">
              <DatabaseIcon size={15} style={{ color: '#fbbf24' }} />
              <span>Raw Scraped Payload</span>
            </div>
            <div className="info-rows">
              {Object.entries(c.raw_data as Record<string, unknown>).slice(0, 8).map(([k, v]) => (
                <div key={k} className="info-row">
                  <span className="ir-label mono" style={{ fontSize: '0.7rem' }}>{k}</span>
                  <span className="ir-value" style={{ fontSize: '0.76rem', color: 'var(--text-secondary)' }}>{String(v ?? '—')}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
