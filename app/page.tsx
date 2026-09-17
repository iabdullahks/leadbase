import { supabaseAdmin } from '@/lib/supabase';
import type { Stats } from '@/lib/types';
import Link from 'next/link';
import {
  DatabaseIcon,
  TruckIcon,
  PhoneIcon,
  MailIcon,
  ClockIcon,
  SearchIcon,
  ChevronRightIcon,
  SparklesIcon,
  ArrowUpIcon
} from './components/Icons';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

async function getStats(): Promise<Stats> {
  try {
    const now = new Date();
    // Exact UTC day boundaries — prevents timezone drift from skewing the count
    const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
    const tomorrowStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0));

    const [totalRes, activeRes, phoneRes, emailRes, todayRes] = await Promise.all([
      supabaseAdmin.from('carriers').select('usdot_number', { count: 'exact', head: true }),
      supabaseAdmin.from('carriers').select('usdot_number', { count: 'exact', head: true }).eq('carrier_status', 'Active'),
      supabaseAdmin.from('carriers').select('usdot_number', { count: 'exact', head: true })
        .neq('phone', '').not('phone', 'is', null),
      supabaseAdmin.from('carriers').select('usdot_number', { count: 'exact', head: true })
        .neq('email', '').not('email', 'is', null),
      // Single source of truth for Motus date metrics: Added on Motus
      supabaseAdmin.from('carriers').select('usdot_number', { count: 'exact', head: true })
        .gte('added_to_motus', todayStart.toISOString())
        .lt('added_to_motus', tomorrowStart.toISOString()),
    ]);

    const todayCount = todayRes.count ?? 0;

    return {
      total:      totalRes.count   ?? 0,
      active:     activeRes.count  ?? 0,
      inactive:   0,
      with_phone: phoneRes.count   ?? 0,
      with_email: emailRes.count   ?? 0,
      new_today:  todayCount,
    };
  } catch (err) {
    console.error('getStats error:', err);
    return { total: 0, active: 0, inactive: 0, with_phone: 0, with_email: 0, new_today: 0 };
  }
}

async function getRecentLeads() {
  try {
    const { data, error } = await supabaseAdmin
      .from('carriers')
      .select('usdot_number, legal_name, carrier_status, added_to_motus')
      .order('added_to_motus', { ascending: false })
      .limit(10);
    if (error) {
      console.error('getRecentLeads error:', error);
      return [];
    }
    return data ?? [];
  } catch (err) {
    console.error('getRecentLeads error:', err);
    return [];
  }
}

function formatDate(iso: string) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return iso;
  }
}

function fmt(n: number) {
  return n.toLocaleString();
}

function StatusBadge({ status }: { status: string | null }) {
  const s = (status || '').toLowerCase();
  const cls = s === 'active' ? 'pill-active' : s === 'inactive' ? 'pill-inactive' : s === 'pending' ? 'pill-pending' : 'pill-other';
  return (
    <span className={`pill ${cls}`}>
      <span className="pill-dot" />
      {status || 'Unknown'}
    </span>
  );
}

export default async function DashboardPage() {
  const [stats, recent] = await Promise.all([getStats(), getRecentLeads()]);

  const activePct = stats.total > 0 ? ((stats.active / stats.total) * 100).toFixed(1) : '0';
  const phonePct = stats.total > 0 ? ((stats.with_phone / stats.total) * 100).toFixed(1) : '0';
  const emailPct = stats.total > 0 ? ((stats.with_email / stats.total) * 100).toFixed(1) : '0';

  return (
    <div className="dashboard-page">
      {/* Page Header */}
      <div className="page-header fade-up">
        <div className="page-context-badge">
          <DatabaseIcon size={12} />
          <span>Carrier Intelligence Platform • FMCSA & MOTUS</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
          <div>
            <h1 className="page-title">System Overview</h1>
            <p className="page-subtitle">
              <span>Real-time USDOT registry and daily Motus scraper index —</span>
              <span className="subtitle-stat">{fmt(stats.total)} carriers tracked</span>
            </p>
          </div>
          <Link
            href="/leads"
            className="crm-tb-btn-export"
            style={{ textDecoration: 'none', gap: '0.4rem' }}
          >
            <span>Explore Leads</span>
            <ChevronRightIcon size={14} />
          </Link>
        </div>
      </div>

      {/* Metric Cards */}
      <div className="stats-grid">
        <div className="stat-card fade-up">
          <div className="stat-card-head">
            <span className="stat-label">Total Leads</span>
            <div className="stat-icon-wrap si-blue">
              <DatabaseIcon size={16} />
            </div>
          </div>
          <div>
            <div className="stat-value">{fmt(stats.total)}</div>
            <div className="stat-subtext">
              <span>Indexed in database</span>
            </div>
          </div>
        </div>

        <div className="stat-card fade-up" style={{ animationDelay: '0.04s' }}>
          <div className="stat-card-head">
            <span className="stat-label">Active Carriers</span>
            <div className="stat-icon-wrap si-green">
              <TruckIcon size={16} />
            </div>
          </div>
          <div>
            <div className="stat-value">{fmt(stats.active)}</div>
            <div className="stat-subtext">
              <strong>{activePct}%</strong> of total registry
            </div>
          </div>
        </div>

        <div className="stat-card fade-up" style={{ animationDelay: '0.08s' }}>
          <div className="stat-card-head">
            <span className="stat-label">With Phone</span>
            <div className="stat-icon-wrap si-cyan">
              <PhoneIcon size={16} />
            </div>
          </div>
          <div>
            <div className="stat-value">{fmt(stats.with_phone)}</div>
            <div className="stat-subtext">
              <strong>{phonePct}%</strong> contact rate
            </div>
          </div>
        </div>

        <div className="stat-card fade-up" style={{ animationDelay: '0.12s' }}>
          <div className="stat-card-head">
            <span className="stat-label">With Email</span>
            <div className="stat-icon-wrap si-purple">
              <MailIcon size={16} />
            </div>
          </div>
          <div>
            <div className="stat-value">{fmt(stats.with_email)}</div>
            <div className="stat-subtext">
              <strong>{emailPct}%</strong> email coverage
            </div>
          </div>
        </div>

        <div className="stat-card fade-up" style={{ animationDelay: '0.16s' }}>
          <div className="stat-card-head">
            <span className="stat-label">Added Today</span>
            <div className="stat-icon-wrap si-orange">
              <SparklesIcon size={16} />
            </div>
          </div>
          <div>
            <div className="stat-value">{fmt(stats.new_today)}</div>
            <div className="stat-subtext">
              <span>Added on Motus today</span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Grid: Recent Leads & Quick Actions */}
      <div className="dashboard-grid fade-up" style={{ animationDelay: '0.2s' }}>
        {/* Recent Leads */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">
              <ClockIcon size={15} style={{ color: 'var(--cyan)' }} />
              <span>Recent Leads</span>
            </span>
            <Link href="/leads" className="card-link">
              <span>View all leads</span>
              <ChevronRightIcon size={14} />
            </Link>
          </div>
          <div className="card-body">
            <div className="recent-leads-list">
              {recent.length === 0 ? (
                <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '0.85rem' }}>
                  No recent leads found.
                </div>
              ) : (
                recent.map(lead => (
                  <Link
                    key={lead.usdot_number}
                    href={`/leads/${lead.usdot_number}`}
                    className="recent-lead-row"
                  >
                    <span className="rl-usdot">#{lead.usdot_number}</span>
                    <span className="rl-name" title={lead.legal_name || ''}>
                      {lead.legal_name || 'Unnamed Carrier'}
                    </span>
                    <StatusBadge status={lead.carrier_status} />
                    <span className="rl-date">{formatDate(lead.added_to_motus)}</span>
                    <span className="rl-arrow">
                      <ChevronRightIcon size={14} />
                    </span>
                  </Link>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">
              <SparklesIcon size={15} style={{ color: 'var(--cyan)' }} />
              <span>Quick Actions</span>
            </span>
          </div>
          <div className="card-body">
            <div className="quick-actions">
              <Link href="/leads" className="qa-card">
                <div className="qa-icon-wrap si-blue">
                  <SearchIcon size={16} />
                </div>
                <div className="qa-content">
                  <span className="qa-label">Browse All Leads</span>
                  <span className="qa-desc">Search, filter and inspect {fmt(stats.total)} carriers</span>
                </div>
                <ChevronRightIcon size={15} className="qa-arrow" />
              </Link>

              <Link href="/leads?has_phone=1&status=active" className="qa-card">
                <div className="qa-icon-wrap si-green">
                  <PhoneIcon size={16} />
                </div>
                <div className="qa-content">
                  <span className="qa-label">Active With Phone</span>
                  <span className="qa-desc">{fmt(stats.with_phone)} outreach-ready carriers</span>
                </div>
                <ChevronRightIcon size={15} className="qa-arrow" />
              </Link>

              <Link href="/leads?has_email=1&has_phone=1&status=active" className="qa-card">
                <div className="qa-icon-wrap si-purple">
                  <MailIcon size={16} />
                </div>
                <div className="qa-content">
                  <span className="qa-label">Full Contact Leads</span>
                  <span className="qa-desc">Active carriers with phone &amp; email</span>
                </div>
                <ChevronRightIcon size={15} className="qa-arrow" />
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Database Coverage Telemetry */}
      <div className="card fade-up" style={{ animationDelay: '0.24s' }}>
        <div className="card-header">
          <span className="card-title">
            <DatabaseIcon size={15} style={{ color: 'var(--cyan)' }} />
            <span>Database Intelligence &amp; Data Completeness</span>
          </span>
          <span style={{ fontSize: '0.74rem', color: 'var(--text-tertiary)' }}>
            Updated in real-time
          </span>
        </div>
        <div className="card-body">
          <div className="coverage-list">
            {[
              {
                label: 'Active Operating Authority',
                value: stats.active,
                total: stats.total,
                color: 'linear-gradient(90deg, #059669, #10b981)',
                icon: <TruckIcon size={14} style={{ color: '#34d399' }} />
              },
              {
                label: 'Direct Phone Numbers Available',
                value: stats.with_phone,
                total: stats.total,
                color: 'linear-gradient(90deg, #0891b2, #06b6d4)',
                icon: <PhoneIcon size={14} style={{ color: '#22d3ee' }} />
              },
              {
                label: 'Direct Email Addresses Available',
                value: stats.with_email,
                total: stats.total,
                color: 'linear-gradient(90deg, #7c3aed, #a855f7)',
                icon: <MailIcon size={14} style={{ color: '#c084fc' }} />
              },
            ].map(item => {
              const pct = stats.total > 0 ? ((item.value / stats.total) * 100).toFixed(1) : '0';
              return (
                <div key={item.label} className="coverage-item">
                  <div className="coverage-meta">
                    <span className="coverage-label">
                      {item.icon}
                      <span>{item.label}</span>
                    </span>
                    <span className="coverage-stats">
                      {fmt(item.value)}
                      <span className="coverage-pct">({pct}%)</span>
                    </span>
                  </div>
                  <div className="coverage-track">
                    <div
                      className="coverage-bar"
                      style={{
                        width: `${pct}%`,
                        background: item.color,
                        boxShadow: '0 0 10px rgba(6, 182, 212, 0.2)'
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
