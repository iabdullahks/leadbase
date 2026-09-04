/* ============================================================
   LeadBase Dashboard — dashboard.js
   Full control: search, filter, sort, paginate, detail drawer,
   CSV export, keyboard shortcuts, toast notifications.
============================================================ */

'use strict';

// ── State ──────────────────────────────────────────────────────────────────────
const state = {
  page: 1,
  pages: 1,
  total: 0,
  sort: 'scraped_at',
  dir: 'desc',
  search: '',
  status: 'all',
  hasPhone: false,
  hasEmail: false,
  dateFrom: '',
  dateTo: '',
  loading: false,
  currentLead: null,
};

// ── DOM Refs ───────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const $q = sel => document.querySelector(sel);
const $qa = sel => document.querySelectorAll(sel);

// Stats
const sTotal  = $('s-total');
const sActive = $('s-active');
const sPhone  = $('s-phone');
const sEmail  = $('s-email');
const sNew    = $('s-new');

// Filter panel
const inpSearch   = $('inp-search');
const chkPhone    = $('chk-phone');
const chkEmail    = $('chk-email');
const inpDateFrom = $('inp-date-from');
const inpDateTo   = $('inp-date-to');
const selSort     = $('sel-sort');
const selDir      = $('sel-dir');
const btnApply    = $('btn-apply');
const btnClearAll = $('btn-clear-filters');
const filterCount = $('filter-count');

// Table
const tbody       = $('leads-tbody');
const resultLabel = $('result-label');

// Pagination
const btnFirst   = $('btn-first');
const btnPrev    = $('btn-prev');
const btnNext    = $('btn-next');
const btnLast    = $('btn-last');
const pageNums   = $('page-numbers');
const inpJump    = $('inp-jump');
const btnJump    = $('btn-jump');

// Drawer
const drawerOverlay = $('drawer-overlay');
const detailDrawer  = $('detail-drawer');
const btnDrawerClose= $('btn-drawer-close');

// Toolbar
const btnRefresh  = $('btn-refresh');
const btnExport   = $('btn-export');

// Toast
const toastEl = $('toast');

// ── Init ───────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadStats();
  loadLeads();
  bindEvents();
});

// ── Stats ──────────────────────────────────────────────────────────────────────
async function loadStats() {
  try {
    const res  = await fetch('/api/stats');
    const data = await res.json();
    animateNum(sTotal,  data.total       || 0);
    animateNum(sActive, data.active      || 0);
    animateNum(sPhone,  data.with_phone  || 0);
    animateNum(sEmail,  data.with_email  || 0);
    animateNum(sNew,    data.new_today   || 0);
  } catch (e) {
    console.error('Stats failed', e);
  }
}

function animateNum(el, target) {
  const start = 0;
  const duration = 900;
  const startTime = performance.now();
  const update = t => {
    const progress = Math.min((t - startTime) / duration, 1);
    const ease = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.round(start + (target - start) * ease).toLocaleString();
    if (progress < 1) requestAnimationFrame(update);
  };
  requestAnimationFrame(update);
}

// ── Load Leads ─────────────────────────────────────────────────────────────────
async function loadLeads() {
  if (state.loading) return;
  state.loading = true;
  tbody.innerHTML = `<tr><td colspan="8" class="table-loading"><div class="spinner-ring"></div> Loading leads…</td></tr>`;
  resultLabel.innerHTML = 'Loading…';

  const params = new URLSearchParams({
    page:      state.page,
    sort:      state.sort,
    dir:       state.dir,
    search:    state.search,
    status:    state.status,
    has_phone: state.hasPhone ? '1' : '',
    has_email: state.hasEmail ? '1' : '',
    date_from: state.dateFrom,
    date_to:   state.dateTo,
  });

  try {
    const res  = await fetch(`/api/leads?${params}`);
    const data = await res.json();

    if (data.error) throw new Error(data.error);

    state.total = data.total;
    state.pages = data.pages;
    state.page  = data.page;

    renderTable(data.leads);
    renderPagination();
    updateLabels(data);
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="8" class="table-empty"><div class="table-empty-icon">⚠️</div>Error loading leads: ${e.message}</td></tr>`;
    showToast('Failed to load leads: ' + e.message, 'error');
  } finally {
    state.loading = false;
  }
}

// ── Render Table ───────────────────────────────────────────────────────────────
function renderTable(leads) {
  if (!leads || leads.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="table-empty">
      <div class="table-empty-icon">🔍</div>
      No leads match your current filters.<br><small style="color:var(--muted);margin-top:0.5rem;display:block">Try adjusting your search or filter criteria.</small>
    </td></tr>`;
    return;
  }

  tbody.innerHTML = leads.map((lead, i) => {
    const statusPill = getStatusPill(lead.carrier_status);
    const phone = lead.phone
      ? `<a href="tel:${lead.phone}" onclick="event.stopPropagation()">${escHtml(lead.phone)}</a>`
      : `<span class="td-empty">—</span>`;
    const email = lead.email
      ? `<a href="mailto:${lead.email}" onclick="event.stopPropagation()">${escHtml(lead.email)}</a>`
      : `<span class="td-empty">—</span>`;
    const entryDate = formatDate(lead.motus_entry_date);
    const scrapedDate = formatDate(lead.scraped_at);

    return `<tr data-usdot="${escHtml(lead.usdot_number)}" style="animation-delay:${i * 0.02}s" onclick="openDrawer('${escHtml(lead.usdot_number)}')">
      <td class="td-usdot">${escHtml(lead.usdot_number)}</td>
      <td class="td-name" title="${escHtml(lead.legal_name || '')}">${escHtml(lead.legal_name || '—')}</td>
      <td class="td-phone">${phone}</td>
      <td class="td-email">${email}</td>
      <td>${statusPill}</td>
      <td class="td-date">${entryDate}</td>
      <td class="td-date">${scrapedDate}</td>
      <td><button class="btn-view" onclick="event.stopPropagation();openDrawer('${escHtml(lead.usdot_number)}')">View →</button></td>
    </tr>`;
  }).join('');
}

function getStatusPill(status) {
  const s = (status || '').toLowerCase();
  if (s === 'active')   return `<span class="pill pill-active">Active</span>`;
  if (s === 'inactive') return `<span class="pill pill-inactive">Inactive</span>`;
  if (s === 'pending')  return `<span class="pill pill-pending">Pending</span>`;
  return `<span class="pill pill-other">${escHtml(status || 'Unknown')}</span>`;
}

// ── Drawer ─────────────────────────────────────────────────────────────────────
async function openDrawer(usdot) {
  drawerOverlay.classList.add('open');
  detailDrawer.classList.add('open');
  document.body.style.overflow = 'hidden';

  // Reset
  $('drawer-name').textContent = 'Loading…';
  $('drawer-usdot').textContent = `USDOT ${usdot}`;
  $('drawer-status').textContent = '—';
  $('drawer-status').className = 'status-pill';

  try {
    const res  = await fetch(`/api/leads/${usdot}`);
    const lead = await res.json();
    state.currentLead = lead;

    $('drawer-name').textContent    = lead.legal_name || '—';
    $('drawer-usdot').textContent   = `USDOT ${lead.usdot_number}`;

    const statusEl = $('drawer-status');
    statusEl.textContent  = lead.carrier_status || '—';
    statusEl.className    = 'status-pill ' + getStatusClass(lead.carrier_status);

    $('dr-phone').textContent   = lead.phone   || '—';
    $('dr-email').textContent   = lead.email   || '—';
    $('dr-usdot').textContent   = lead.usdot_number || '—';
    $('dr-status').textContent  = lead.carrier_status || '—';
    $('dr-oos').textContent     = lead.out_of_service ? '⚠️ Yes' : '✅ No';
    $('dr-entry').textContent   = formatDateFull(lead.motus_entry_date);
    $('dr-updated').textContent = formatDateFull(lead.motus_last_updated);
    $('dr-scraped').textContent = formatDateFull(lead.scraped_at);

    // Action links
    $('dr-link-motus').href  = lead.profile_url || `https://motus.dot.gov/customer/${usdot}/account`;
    $('dr-link-phone').href  = lead.phone ? `tel:${lead.phone}` : '#';
    $('dr-link-email').href  = lead.email ? `mailto:${lead.email}` : '#';

    if (!lead.phone)  $('dr-link-phone').style.opacity = '0.4';
    else              $('dr-link-phone').style.opacity = '1';
    if (!lead.email)  $('dr-link-email').style.opacity = '0.4';
    else              $('dr-link-email').style.opacity = '1';

  } catch (e) {
    $('drawer-name').textContent = 'Error loading details';
    showToast('Failed to load lead details', 'error');
  }
}

function getStatusClass(status) {
  const s = (status || '').toLowerCase();
  if (s === 'active')   return 'pill-active';
  if (s === 'inactive') return 'pill-inactive';
  if (s === 'pending')  return 'pill-pending';
  return 'pill-other';
}

function closeDrawer() {
  drawerOverlay.classList.remove('open');
  detailDrawer.classList.remove('open');
  document.body.style.overflow = '';
  state.currentLead = null;
}

window.copyLeadInfo = function() {
  if (!state.currentLead) return;
  const l = state.currentLead;
  const text = [
    `Company: ${l.legal_name || ''}`,
    `USDOT: ${l.usdot_number || ''}`,
    `Phone: ${l.phone || ''}`,
    `Email: ${l.email || ''}`,
    `Status: ${l.carrier_status || ''}`,
    `Profile: ${l.profile_url || ''}`,
  ].join('\n');
  navigator.clipboard.writeText(text).then(() => showToast('Lead info copied!', 'success'));
};

// ── Pagination ─────────────────────────────────────────────────────────────────
function renderPagination() {
  const { page, pages } = state;

  btnFirst.disabled = page <= 1;
  btnPrev.disabled  = page <= 1;
  btnNext.disabled  = page >= pages;
  btnLast.disabled  = page >= pages;

  // Page number buttons
  const nums = getPageRange(page, pages);
  pageNums.innerHTML = nums.map(n => {
    if (n === '…') return `<button class="btn-pg-num dots" disabled>…</button>`;
    return `<button class="btn-pg-num ${n === page ? 'current' : ''}" onclick="goPage(${n})">${n}</button>`;
  }).join('');

  inpJump.max = pages;
  inpJump.placeholder = `1–${pages}`;
}

function getPageRange(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = [];
  pages.push(1);
  if (current > 4) pages.push('…');
  const start = Math.max(2, current - 2);
  const end   = Math.min(total - 1, current + 2);
  for (let i = start; i <= end; i++) pages.push(i);
  if (current < total - 3) pages.push('…');
  pages.push(total);
  return pages;
}

function goPage(n) {
  n = parseInt(n);
  if (isNaN(n)) return;
  n = Math.max(1, Math.min(state.pages, n));
  state.page = n;
  loadLeads();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function updateLabels(data) {
  const start = (data.page - 1) * data.per_page + 1;
  const end   = Math.min(data.page * data.per_page, data.total);
  resultLabel.innerHTML = data.total > 0
    ? `Showing <strong>${start.toLocaleString()}–${end.toLocaleString()}</strong> of <strong>${data.total.toLocaleString()}</strong> leads`
    : 'No leads found';
  filterCount.textContent = `${data.total.toLocaleString()} matching leads`;
}

// ── Sort ───────────────────────────────────────────────────────────────────────
$qa('.th-sort').forEach(th => {
  th.addEventListener('click', () => {
    const col = th.dataset.sort;
    if (state.sort === col) {
      state.dir = state.dir === 'asc' ? 'desc' : 'asc';
    } else {
      state.sort = col;
      state.dir  = 'desc';
    }
    selSort.value = state.sort;
    selDir.value  = state.dir;
    updateSortHeaders();
    state.page = 1;
    loadLeads();
  });
});

function updateSortHeaders() {
  $qa('.th-sort').forEach(th => {
    const arrow = th.querySelector('.sort-arrow');
    if (th.dataset.sort === state.sort) {
      th.classList.add('active');
      arrow.textContent = state.dir === 'asc' ? '↑' : '↓';
    } else {
      th.classList.remove('active');
      arrow.textContent = '↕';
    }
  });
}

// ── Apply Filters ──────────────────────────────────────────────────────────────
function applyFilters() {
  state.search   = inpSearch.value.trim();
  state.status   = $q('input[name="status"]:checked')?.value || 'all';
  state.hasPhone = chkPhone.checked;
  state.hasEmail = chkEmail.checked;
  state.dateFrom = inpDateFrom.value;
  state.dateTo   = inpDateTo.value;
  state.sort     = selSort.value;
  state.dir      = selDir.value;
  state.page     = 1;
  updateSortHeaders();
  loadLeads();
}

function clearFilters() {
  inpSearch.value = '';
  $qa('input[name="status"]')[0].checked = true;
  chkPhone.checked = false;
  chkEmail.checked = false;
  inpDateFrom.value = '';
  inpDateTo.value   = '';
  selSort.value = 'scraped_at';
  selDir.value  = 'desc';
  state.search   = '';
  state.status   = 'all';
  state.hasPhone = false;
  state.hasEmail = false;
  state.dateFrom = '';
  state.dateTo   = '';
  state.sort     = 'scraped_at';
  state.dir      = 'desc';
  state.page     = 1;
  updateSortHeaders();
  loadLeads();
}

// ── Export CSV ─────────────────────────────────────────────────────────────────
async function exportCSV() {
  btnExport.disabled = true;
  btnExport.innerHTML = `<div class="spinner-ring" style="width:14px;height:14px;border-width:2px;margin-right:6px;display:inline-block"></div> Exporting…`;

  const params = new URLSearchParams({
    search:    state.search,
    status:    state.status,
    has_phone: state.hasPhone ? '1' : '',
    has_email: state.hasEmail ? '1' : '',
    date_from: state.dateFrom,
    date_to:   state.dateTo,
  });

  try {
    const res  = await fetch(`/api/export?${params}`);
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    const ts   = new Date().toISOString().slice(0, 10);
    a.href     = url;
    a.download = `leads_${ts}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`✅ Export downloaded (${state.total.toLocaleString()} leads)`, 'success');
  } catch (e) {
    showToast('Export failed: ' + e.message, 'error');
  } finally {
    btnExport.disabled = false;
    btnExport.innerHTML = `<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg> Export CSV`;
  }
}

// ── Toast ──────────────────────────────────────────────────────────────────────
let toastTimer;
function showToast(msg, type = '') {
  toastEl.textContent = msg;
  toastEl.className   = `toast show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 3500);
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function formatDate(iso) {
  if (!iso) return '<span class="td-empty">—</span>';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return iso; }
}

function formatDateFull(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}

function escHtml(str) {
  const d = document.createElement('div');
  d.appendChild(document.createTextNode(str || ''));
  return d.innerHTML;
}

// ── Bind Events ────────────────────────────────────────────────────────────────
function bindEvents() {
  btnApply.addEventListener('click', applyFilters);
  btnClearAll.addEventListener('click', clearFilters);
  btnRefresh.addEventListener('click', () => { loadStats(); loadLeads(); });
  btnExport.addEventListener('click', exportCSV);

  // Search on Enter
  inpSearch.addEventListener('keydown', e => { if (e.key === 'Enter') applyFilters(); });
  $('btn-clear-search').addEventListener('click', () => { inpSearch.value = ''; applyFilters(); });

  // Pagination
  btnFirst.addEventListener('click', () => goPage(1));
  btnPrev.addEventListener('click',  () => goPage(state.page - 1));
  btnNext.addEventListener('click',  () => goPage(state.page + 1));
  btnLast.addEventListener('click',  () => goPage(state.pages));
  btnJump.addEventListener('click',  () => goPage(inpJump.value));
  inpJump.addEventListener('keydown', e => { if (e.key === 'Enter') goPage(inpJump.value); });

  // Drawer close
  btnDrawerClose.addEventListener('click', closeDrawer);
  drawerOverlay.addEventListener('click', closeDrawer);

  // Keyboard shortcuts
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeDrawer();
    if (e.key === '/' && document.activeElement !== inpSearch) {
      e.preventDefault();
      inpSearch.focus();
    }
    if (e.key === 'ArrowRight' && !e.target.matches('input,select')) goPage(state.page + 1);
    if (e.key === 'ArrowLeft'  && !e.target.matches('input,select')) goPage(state.page - 1);
  });

  // Live search debounce
  let searchTimer;
  inpSearch.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(applyFilters, 450);
  });

  // Status radio — live filter
  $qa('input[name="status"]').forEach(r => r.addEventListener('change', applyFilters));
  chkPhone.addEventListener('change', applyFilters);
  chkEmail.addEventListener('change', applyFilters);
}

// expose for HTML inline
window.openDrawer = openDrawer;
