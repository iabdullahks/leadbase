'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { Carrier, LeadsResponse } from '@/lib/types';

const PAGE_SIZE = 50;

function fmt(n: number) { return n.toLocaleString(); }

function formatDate(iso: string) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return iso; }
}

function formatDateFull(iso: string) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  catch { return iso; }
}

function StatusPill({ status }: { status: string }) {
  const s = status?.toLowerCase() ?? '';
  const cls = s === 'active' ? 'pill-active' : s === 'inactive' ? 'pill-inactive' : s === 'pending' ? 'pill-pending' : 'pill-other';
  return <span className={`pill ${cls}`}>{status || '?'}</span>;
}

function showToast(msg: string, type = '') {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = `toast show ${type}`;
  setTimeout(() => { el.classList.remove('show'); }, 3200);
}

// ── Drawer ────────────────────────────────────────────────────────────────────
function Drawer({ lead, onClose }: { lead: Carrier | null; onClose: () => void }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const open = !!lead;

  function copyInfo() {
    if (!lead) return;
    const text = [`Company: ${lead.legal_name}`, `USDOT: ${lead.usdot_number}`, `Phone: ${lead.phone}`, `Email: ${lead.email}`, `Status: ${lead.carrier_status}`, `Profile: ${lead.profile_url}`].join('\n');
    navigator.clipboard.writeText(text).then(() => showToast('✅ Lead info copied!', 'ok'));
  }

  return (
    <>
      <div className={`overlay ${open ? 'open' : ''}`} onClick={onClose} />
      <div className={`drawer ${open ? 'open' : ''}`}>
        <div className="drawer-head">
          <div>
            <div className="drawer-title">{lead?.legal_name || '—'}</div>
            <div className="drawer-usdot">USDOT {lead?.usdot_number}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            {lead && <StatusPill status={lead.carrier_status} />}
            <button className="drawer-close" onClick={onClose}>✕</button>
          </div>
        </div>
        {lead && (
          <div className="drawer-body">
            <div className="drawer-section">
              <div className="drawer-section-title">Contact Information</div>
              <div className="drawer-grid">
                <div className="df">
                  <div className="df-label">Phone</div>
                  <div className="df-value">{lead.phone ? <a href={`tel:${lead.phone}`} style={{ color: 'var(--green)', textDecoration: 'none' }}>{lead.phone}</a> : '—'}</div>
                </div>
                <div className="df">
                  <div className="df-label">Email</div>
                  <div className="df-value" style={{ fontSize: '0.8rem' }}>{lead.email ? <a href={`mailto:${lead.email}`} style={{ color: 'var(--purple)', textDecoration: 'none' }}>{lead.email}</a> : '—'}</div>
                </div>
              </div>
            </div>
            <div className="drawer-section">
              <div className="drawer-section-title">Registration Details</div>
              <div className="drawer-grid">
                <div className="df"><div className="df-label">USDOT Number</div><div className="df-value cyan">{lead.usdot_number}</div></div>
                <div className="df"><div className="df-label">Status</div><div className="df-value"><StatusPill status={lead.carrier_status} /></div></div>
                <div className="df"><div className="df-label">Out of Service</div><div className="df-value">{lead.out_of_service ? '⚠️ Yes' : '✅ No'}</div></div>
                <div className="df"><div className="df-label">MOTUS Entry</div><div className="df-value">{formatDateFull(lead.motus_entry_date)}</div></div>
                <div className="df"><div className="df-label">Last Updated</div><div className="df-value">{formatDateFull(lead.motus_last_updated)}</div></div>
                <div className="df"><div className="df-label">Date Scraped</div><div className="df-value">{formatDateFull(lead.scraped_at)}</div></div>
              </div>
            </div>
            <div className="drawer-section">
              <div className="drawer-section-title">Quick Actions</div>
              <div className="drawer-actions">
                <a href={lead.profile_url || `https://motus.dot.gov/customer/${lead.usdot_number}/account`} target="_blank" rel="noreferrer" className="da-btn da-blue">🔗 View on MOTUS</a>
                <a href={lead.phone ? `tel:${lead.phone}` : '#'} className={`da-btn da-green ${!lead.phone ? 'da-gray' : ''}`} style={!lead.phone ? { opacity: 0.4 } : {}}>📞 Call</a>
                <a href={lead.email ? `mailto:${lead.email}` : '#'} className={`da-btn da-purple ${!lead.email ? 'da-gray' : ''}`} style={!lead.email ? { opacity: 0.4 } : {}}>✉️ Email</a>
                <button onClick={copyInfo} className="da-btn da-gray">📋 Copy Info</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// ── Main Leads Page ───────────────────────────────────────────────────────────
export default function LeadsPage() {
  const router = useRouter();
  const sp = useSearchParams();

  const [leads, setLeads]         = useState<Carrier[]>([]);
  const [total, setTotal]         = useState(0);
  const [page, setPage]           = useState(1);
  const [pages, setPages]         = useState(1);
  const [loading, setLoading]     = useState(true);
  const [selectedLead, setSelected] = useState<Carrier | null>(null);
  const [exporting, setExporting] = useState(false);

  // Filter state
  const [search,   setSearch]   = useState(sp.get('search')    ?? '');
  const [status,   setStatus]   = useState(sp.get('status')    ?? 'all');
  const [hasPhone, setHasPhone] = useState(sp.get('has_phone') === '1');
  const [hasEmail, setHasEmail] = useState(sp.get('has_email') === '1');
  const [dateFrom, setDateFrom] = useState(sp.get('date_from') ?? '');
  const [dateTo,   setDateTo]   = useState(sp.get('date_to')   ?? '');
  const [sortCol,  setSortCol]  = useState('scraped_at');
  const [sortDir,  setSortDir]  = useState<'asc'|'desc'>('desc');

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const buildParams = useCallback((pg = 1) => new URLSearchParams({
    page: String(pg), sort: sortCol, dir: sortDir,
    search, status,
    has_phone: hasPhone ? '1' : '',
    has_email: hasEmail ? '1' : '',
    date_from: dateFrom, date_to: dateTo,
  }), [search, status, hasPhone, hasEmail, dateFrom, dateTo, sortCol, sortDir]);

  const fetchLeads = useCallback(async (pg = 1) => {
    setLoading(true);
    try {
      const res  = await fetch(`/api/leads?${buildParams(pg)}`);
      const data: LeadsResponse = await res.json();
      setLeads(data.leads ?? []);
      setTotal(data.total ?? 0);
      setPage(data.page ?? pg);
      setPages(data.pages ?? 1);
    } catch (e) {
      showToast('Failed to load leads', 'err');
    } finally {
      setLoading(false);
    }
  }, [buildParams]);

  useEffect(() => { fetchLeads(1); }, []);

  // Init from URL params
  useEffect(() => {
    if (sp.get('has_phone') === '1' || sp.get('has_email') === '1' || sp.get('status')) {
      fetchLeads(1);
    }
  }, []);

  function applyFilters(pg = 1) {
    setPage(1);
    fetchLeads(pg);
  }

  function clearFilters() {
    setSearch(''); setStatus('all'); setHasPhone(false); setHasEmail(false);
    setDateFrom(''); setDateTo(''); setSortCol('scraped_at'); setSortDir('desc');
    setTimeout(() => fetchLeads(1), 0);
  }

  function handleSort(col: string) {
    const newDir = sortCol === col && sortDir === 'desc' ? 'asc' : 'desc';
    setSortCol(col); setSortDir(newDir);
    setTimeout(() => fetchLeads(1), 0);
  }

  function goPage(n: number) {
    const p = Math.max(1, Math.min(pages, n));
    setPage(p);
    fetchLeads(p);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function doExport() {
    setExporting(true);
    try {
      const res  = await fetch(`/api/export?${buildParams()}`);
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url; a.download = `leads_${new Date().toISOString().slice(0,10)}.csv`;
      a.click(); URL.revokeObjectURL(url);
      showToast(`✅ ${fmt(total)} leads exported`, 'ok');
    } catch { showToast('Export failed', 'err'); }
    finally { setExporting(false); }
  }

  // Page range for pagination
  function pageRange(cur: number, tot: number): (number | '…')[] {
    if (tot <= 7) return Array.from({ length: tot }, (_, i) => i + 1);
    const r: (number | '…')[] = [1];
    if (cur > 4) r.push('…');
    for (let i = Math.max(2, cur - 2); i <= Math.min(tot - 1, cur + 2); i++) r.push(i);
    if (cur < tot - 3) r.push('…');
    r.push(tot);
    return r;
  }

  const sortArrow = (col: string) => sortCol === col ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ' ↕';

  return (
    <>
      <div className="leads-layout">
        {/* Sidebar */}
        <aside className="filter-sidebar">
          <div className="filter-title">
            <span>🔽 Filters</span>
            <button className="btn-text-sm" onClick={clearFilters}>Clear All</button>
          </div>

          <div className="fg">
            <label className="fl">Search</label>
            <div className="search-box">
              <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
              <input
                className="inp inp-search"
                placeholder="Name, USDOT, phone, email…"
                value={search}
                onChange={e => {
                  setSearch(e.target.value);
                  if (searchTimer.current) clearTimeout(searchTimer.current);
                  searchTimer.current = setTimeout(() => applyFilters(1), 450);
                }}
                onKeyDown={e => e.key === 'Enter' && applyFilters(1)}
              />
            </div>
          </div>

          <div className="fg">
            <label className="fl">Status</label>
            <div className="radio-group">
              {['all','active','inactive','pending'].map(s => (
                <label key={s} className="radio-item">
                  <input type="radio" name="status" value={s} checked={status === s} onChange={() => { setStatus(s); setTimeout(() => applyFilters(1), 0); }} />
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </label>
              ))}
            </div>
          </div>

          <div className="fg">
            <label className="fl">Contact Info</label>
            <div className="check-group">
              <label className="check-item">
                <input type="checkbox" checked={hasPhone} onChange={e => { setHasPhone(e.target.checked); setTimeout(() => applyFilters(1), 0); }} />
                Has Phone Number
              </label>
              <label className="check-item">
                <input type="checkbox" checked={hasEmail} onChange={e => { setHasEmail(e.target.checked); setTimeout(() => applyFilters(1), 0); }} />
                Has Email Address
              </label>
            </div>
          </div>

          <div className="fg">
            <label className="fl">Date Added From</label>
            <input type="date" className="inp" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
          </div>

          <div className="fg">
            <label className="fl">Date Added To</label>
            <input type="date" className="inp" value={dateTo} onChange={e => setDateTo(e.target.value)} />
          </div>

          <div className="fg">
            <label className="fl">Sort By</label>
            <select className="inp" value={sortCol} onChange={e => setSortCol(e.target.value)}>
              <option value="scraped_at">Date Added</option>
              <option value="motus_entry_date">MOTUS Entry</option>
              <option value="legal_name">Company Name</option>
              <option value="usdot_number">USDOT Number</option>
              <option value="carrier_status">Status</option>
            </select>
            <select className="inp" style={{ marginTop: '0.4rem' }} value={sortDir} onChange={e => setSortDir(e.target.value as 'asc'|'desc')}>
              <option value="desc">Newest First</option>
              <option value="asc">Oldest First</option>
            </select>
          </div>

          <button className="btn-apply" onClick={() => applyFilters(1)}>Apply Filters</button>

          <div style={{ fontSize: '0.75rem', color: 'var(--muted)', textAlign: 'center', paddingTop: '0.5rem', borderTop: '1px solid var(--border)' }}>
            {fmt(total)} matching leads
          </div>
        </aside>

        {/* Table area */}
        <div className="table-container">
          <div className="table-toolbar">
            <span className="result-text">
              {loading ? 'Loading…' : total > 0
                ? <>Showing <strong>{fmt((page-1)*PAGE_SIZE+1)}–{fmt(Math.min(page*PAGE_SIZE,total))}</strong> of <strong>{fmt(total)}</strong> leads</>
                : 'No leads found'}
            </span>
            <div className="toolbar-actions">
              <button className="btn-icon-sm" onClick={() => fetchLeads(page)} title="Refresh">
                <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>
              </button>
              <button className="btn-export" onClick={doExport} disabled={exporting}>
                {exporting ? <><span className="spinner" style={{ width:14,height:14,borderWidth:2 }} /> Exporting…</> : <>
                  <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
                  Export CSV
                </>}
              </button>
            </div>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {[
                    { col: 'usdot_number', label: 'USDOT #' },
                    { col: 'legal_name',   label: 'Company Name' },
                    { col: null,           label: 'Phone' },
                    { col: null,           label: 'Email' },
                    { col: 'carrier_status', label: 'Status' },
                    { col: 'motus_entry_date', label: 'Entry Date' },
                    { col: 'scraped_at',   label: 'Added' },
                    { col: null,           label: '' },
                  ].map((h, i) => (
                    <th
                      key={i}
                      className={`${h.col ? 'sortable' : ''} ${h.col === sortCol ? 'sort-active' : ''}`}
                      onClick={() => h.col && handleSort(h.col)}
                    >
                      {h.label}{h.col ? sortArrow(h.col) : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={8} className="table-msg">
                    <span className="spinner" /> Loading leads…
                  </td></tr>
                ) : leads.length === 0 ? (
                  <tr><td colSpan={8} className="table-msg">
                    <div className="table-msg-icon">🔍</div>
                    No leads match your filters
                  </td></tr>
                ) : leads.map(lead => (
                  <tr key={lead.usdot_number} onClick={() => setSelected(lead)} style={{ cursor: 'pointer' }}>
                    <td className="td-usdot">{lead.usdot_number}</td>
                    <td className="td-name" title={lead.legal_name}>{lead.legal_name || '—'}</td>
                    <td className="td-contact">
                      {lead.phone
                        ? <a href={`tel:${lead.phone}`} onClick={e => e.stopPropagation()}>{lead.phone}</a>
                        : <span className="td-empty">—</span>}
                    </td>
                    <td className="td-contact" style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {lead.email
                        ? <a href={`mailto:${lead.email}`} onClick={e => e.stopPropagation()}>{lead.email}</a>
                        : <span className="td-empty">—</span>}
                    </td>
                    <td><StatusPill status={lead.carrier_status} /></td>
                    <td className="td-date">{formatDate(lead.motus_entry_date)}</td>
                    <td className="td-date">{formatDate(lead.scraped_at)}</td>
                    <td><button className="btn-view" onClick={e => { e.stopPropagation(); setSelected(lead); }}>View →</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {pages > 1 && (
            <div className="pagination">
              <button className="pg-btn" onClick={() => goPage(1)} disabled={page <= 1}>«</button>
              <button className="pg-btn" onClick={() => goPage(page - 1)} disabled={page <= 1}>‹ Prev</button>
              {pageRange(page, pages).map((n, i) =>
                n === '…'
                  ? <span key={`d${i}`} className="pg-dots">…</span>
                  : <button key={n} className={`pg-btn ${n === page ? 'active' : ''}`} onClick={() => goPage(n as number)}>{n}</button>
              )}
              <button className="pg-btn" onClick={() => goPage(page + 1)} disabled={page >= pages}>Next ›</button>
              <button className="pg-btn" onClick={() => goPage(pages)} disabled={page >= pages}>»</button>
              <div className="pg-jump">
                <span>Go to</span>
                <input className="inp-jump" type="number" min={1} max={pages} id="pg-jump-inp"
                  onKeyDown={e => { if (e.key === 'Enter') { const v = parseInt((e.target as HTMLInputElement).value); if (!isNaN(v)) goPage(v); }}} />
                <button className="btn-go" onClick={() => { const el = document.getElementById('pg-jump-inp') as HTMLInputElement; const v = parseInt(el?.value); if (!isNaN(v)) goPage(v); }}>Go</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Drawer */}
      <Drawer lead={selectedLead} onClose={() => setSelected(null)} />

      {/* Toast */}
      <div id="toast" className="toast" />
    </>
  );
}
