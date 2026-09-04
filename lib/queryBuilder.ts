import { FilterState } from './types';
import { SupabaseClient } from '@supabase/supabase-js';

export function defaultFilterState(): FilterState {
  return {
    carrier_statuses: [],
    authority_statuses: [],
    states: [],
    cargo_types: [],
    equipment_types: [],
    date_field: 'scraped_at',
    date_preset: 'all',
    missing_fields: [],
    advanced_rules: [],
  };
}

export function buildCarrierQuery(
  supabaseAdmin: SupabaseClient,
  filters: FilterState,
  selectFields = '*'
) {
  let q = supabaseAdmin.from('carriers').select(selectFields, { count: 'exact' });

  // Global Search
  if (filters.global_search?.trim()) {
    const s = filters.global_search.trim();
    q = q.or(`legal_name.ilike.%${s}%,dba_name.ilike.%${s}%,usdot_number.ilike.%${s}%,phone.ilike.%${s}%,email.ilike.%${s}%,principal_address.ilike.%${s}%`);
  }

  // Identification Filters
  if (filters.usdot?.trim()) {
    const v = filters.usdot.trim();
    if (filters.id_match_type === 'exact') q = q.eq('usdot_number', v);
    else if (filters.id_match_type === 'starts_with') q = q.ilike('usdot_number', `${v}%`);
    else q = q.ilike('usdot_number', `%${v}%`);
  }

  if (filters.company_name?.trim()) {
    const v = filters.company_name.trim();
    if (filters.id_match_type === 'exact') q = q.eq('legal_name', v);
    else if (filters.id_match_type === 'starts_with') q = q.ilike('legal_name', `${v}%`);
    else q = q.ilike('legal_name', `%${v}%`);
  }

  if (filters.legal_name?.trim()) {
    q = q.ilike('legal_name', `%${filters.legal_name.trim()}%`);
  }
  if (filters.dba_name?.trim()) {
    q = q.ilike('dba_name', `%${filters.dba_name.trim()}%`);
  }

  // Status Filters
  if (filters.carrier_statuses && filters.carrier_statuses.length > 0) {
    // Standardize capitalization (Active, Inactive, Pending, Out of Service)
    const formatted = filters.carrier_statuses.map(s => {
      if (s.toLowerCase() === 'active') return 'Active';
      if (s.toLowerCase() === 'inactive') return 'Inactive';
      if (s.toLowerCase() === 'pending') return 'Pending';
      return s;
    });
    q = q.in('carrier_status', formatted);
  }

  // Contact Info Filters
  if (filters.has_phone === true) {
    q = q.neq('phone', '').not('phone', 'is', null);
  } else if (filters.has_phone === false) {
    q = q.or('phone.eq.,phone.is.null');
  }

  if (filters.has_email === true) {
    q = q.neq('email', '').not('email', 'is', null);
  } else if (filters.has_email === false) {
    q = q.or('email.eq.,email.is.null');
  }

  if (filters.contact_completeness) {
    if (filters.contact_completeness === 'phone_email') {
      q = q.neq('phone', '').not('phone', 'is', null).neq('email', '').not('email', 'is', null);
    } else if (filters.contact_completeness === 'any') {
      q = q.or('phone.neq.,email.neq.');
    } else if (filters.contact_completeness === 'none') {
      q = q.or('phone.eq.,phone.is.null').or('email.eq.,email.is.null');
    }
  }

  // Location Filters (States / Cities / Address)
  if (filters.states && filters.states.length > 0) {
    // Match state in state_incorporated OR extracted state code from principal_address
    const stateList = filters.states.map(s => s.toUpperCase());
    q = q.in('state_incorporated', stateList);
  }

  if (filters.city?.trim()) {
    const c = filters.city.trim();
    if (filters.city_match === 'exact') q = q.ilike('principal_address', `% ${c} %`);
    else q = q.ilike('principal_address', `%${c}%`);
  }

  if (filters.address?.trim()) {
    q = q.ilike('principal_address', `%${filters.address.trim()}%`);
  }

  // Form of Business
  if (filters.form_of_business && filters.form_of_business.length > 0) {
    q = q.in('form_of_business', filters.form_of_business);
  }

  // Date Filters
  const dateCol = filters.date_field || 'scraped_at';
  const now = new Date();

  if (filters.date_preset && filters.date_preset !== 'all' && filters.date_preset !== 'custom') {
    let fromDate: Date | null = null;
    let toDate: Date | null = null;

    if (filters.date_preset === 'today') {
      fromDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else if (filters.date_preset === 'yesterday') {
      fromDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
      toDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else if (filters.date_preset === 'last_7d') {
      fromDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else if (filters.date_preset === 'last_30d') {
      fromDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    } else if (filters.date_preset === 'last_90d') {
      fromDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    } else if (filters.date_preset === 'this_month') {
      fromDate = new Date(now.getFullYear(), now.getMonth(), 1);
    } else if (filters.date_preset === 'last_month') {
      fromDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      toDate = new Date(now.getFullYear(), now.getMonth(), 0);
    }

    if (fromDate) q = q.gte(dateCol, fromDate.toISOString());
    if (toDate) q = q.lte(dateCol, toDate.toISOString());
  } else if (filters.date_preset === 'custom' || filters.date_from || filters.date_to) {
    if (filters.date_from) q = q.gte(dateCol, filters.date_from);
    if (filters.date_to) q = q.lte(dateCol, filters.date_to + 'T23:59:59');
  }

  // Data Quality Filters
  if (filters.missing_fields && filters.missing_fields.length > 0) {
    for (const f of filters.missing_fields) {
      if (f === 'phone') q = q.or('phone.eq.,phone.is.null');
      if (f === 'email') q = q.or('email.eq.,email.is.null');
      if (f === 'address') q = q.or('principal_address.eq.,principal_address.is.null');
    }
  }

  // Advanced Rules
  if (filters.advanced_rules && filters.advanced_rules.length > 0) {
    for (const rule of filters.advanced_rules) {
      if (!rule.field || !rule.operator) continue;
      const f = rule.field;
      const op = rule.operator;
      const val = rule.value;

      if (op === 'contains') q = q.ilike(f, `%${val}%`);
      else if (op === 'exact') q = q.eq(f, val);
      else if (op === 'is_not_empty') q = q.neq(f, '').not(f, 'is', null);
      else if (op === 'is_empty') q = q.or(`${f}.eq.,${f}.is.null`);
      else if (op === 'gt') q = q.gt(f, Number(val));
      else if (op === 'gte') q = q.gte(f, Number(val));
      else if (op === 'lt') q = q.lt(f, Number(val));
      else if (op === 'lte') q = q.lte(f, Number(val));
    }
  }

  return q;
}
