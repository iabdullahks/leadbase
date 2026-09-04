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
    if (filters.id_match_type === 'exact') {
      q = q.eq('usdot_number', v);
    } else if (filters.id_match_type === 'starts_with') {
      q = q.ilike('usdot_number', `${v}%`);
    } else if (filters.id_match_type === 'contains') {
      q = q.ilike('usdot_number', `%${v}%`);
    } else {
      // Default & 'starts_from': Numbers numerically >= v onwards to the end of the database!
      // Uses exact digit-length boundary matching so shorter numbers like 96466 NEVER leak in!
      if (/^\d+$/.test(v)) {
        const L = v.length;
        const underL = '_'.repeat(L);
        const clauses = [`and(usdot_number.like.${underL},usdot_number.gte.${v})`];
        for (let len = L + 1; len <= 10; len++) {
          clauses.push(`usdot_number.like.${'_'.repeat(len)}`);
        }
        q = q.or(clauses.join(','));
      } else {
        q = q.ilike('usdot_number', `${v}%`);
      }
    }
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
    const formatted = filters.carrier_statuses.map(s => {
      const lower = s.toLowerCase();
      if (lower === 'active') return 'Active';
      if (lower === 'inactive') return 'Inactive';
      if (lower === 'pending') return 'Pending';
      if (lower.includes('service')) return 'Out of Service';
      return s;
    });

    if (formatted.includes('Out of Service')) {
      const otherStatuses = formatted.filter(s => s !== 'Out of Service');
      if (otherStatuses.length > 0) {
        q = q.or(`carrier_status.in.(${otherStatuses.join(',')}),carrier_status.eq.Out of Service,out_of_service.eq.true`);
      } else {
        q = q.or('carrier_status.eq.Out of Service,out_of_service.eq.true');
      }
    } else {
      q = q.in('carrier_status', formatted);
    }
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
      q = q.or('and(phone.neq.,phone.not.is.null),and(email.neq.,email.not.is.null)');
    } else if (filters.contact_completeness === 'none') {
      q = q.or('phone.eq.,phone.is.null').or('email.eq.,email.is.null');
    }
  }

  // Location Filters (States / Cities / Address)
  if (filters.states && filters.states.length > 0) {
    // Check both state_incorporated AND principal_address so no leads are missed!
    const stateList = filters.states.map(s => s.toUpperCase());
    const incPart = `state_incorporated.in.(${stateList.join(',')})`;
    const addrParts = stateList.map(st => `principal_address.ilike."%, ${st},%"`);
    q = q.or(`${incPart},${addrParts.join(',')}`);
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

  // Equipment & Fleet Filters
  const hasNoEquipment =
    filters.equipment_mode === 'no_equipment' ||
    (filters.equipment_types || []).includes('No Equipment');
  const isBothOrAll =
    filters.equipment_mode === 'both' ||
    filters.equipment_mode === 'all' ||
    (filters.equipment_types || []).includes('All') ||
    (filters.equipment_types || []).includes('All / Non-Filter') ||
    (filters.equipment_types || []).includes('non- filter') ||
    (!filters.equipment_mode && (!filters.equipment_types || filters.equipment_types.length === 0));

  if (!isBothOrAll) {
    if (hasNoEquipment) {
      q = q.or('form_of_business.ilike.%Broker%,legal_name.ilike.%Broker%,legal_name.ilike.%Logistics%,carrier_status.eq.Inactive,out_of_service.eq.true');
    } else if (filters.equipment_mode === 'has_equipment') {
      q = q.eq('carrier_status', 'Active').eq('out_of_service', false);
    }
  }

  if (filters.equipment_types && filters.equipment_types.length > 0) {
    const validTypes = filters.equipment_types.filter(
      t => t !== 'No Equipment' && t !== 'Both' && t !== 'All' && t !== 'All / Non-Filter' && t !== 'non- filter'
    );
    if (validTypes.length > 0) {
      const clauses: string[] = [];
      validTypes.forEach(t => {
        const lower = t.toLowerCase();
        if (lower.includes('power only') || lower.includes('poweronly')) {
          clauses.push('legal_name.ilike.%Power Only%', 'dba_name.ilike.%Power Only%', 'legal_name.ilike.%PowerOnly%', 'dba_name.ilike.%PowerOnly%');
        } else if (lower.includes('box truck') || lower.includes('boxtruck')) {
          clauses.push('legal_name.ilike.%Box Truck%', 'dba_name.ilike.%Box Truck%', 'legal_name.ilike.%Boxtruck%', 'dba_name.ilike.%Boxtruck%');
        } else if (lower.includes('cargo van') || lower.includes('sprinter')) {
          clauses.push('legal_name.ilike.%Cargo Van%', 'dba_name.ilike.%Cargo Van%', 'legal_name.ilike.%Sprinter%', 'dba_name.ilike.%Sprinter%');
        } else if (lower.includes('hauler') || lower.includes('car hauler') || lower.includes('auto hauler')) {
          clauses.push('legal_name.ilike.%Hauler%', 'dba_name.ilike.%Hauler%', 'legal_name.ilike.%Auto Haul%', 'dba_name.ilike.%Auto Haul%');
        } else if (lower.includes('hotshot') || lower.includes('hot shot')) {
          clauses.push('legal_name.ilike.%Hotshot%', 'dba_name.ilike.%Hotshot%', 'legal_name.ilike.%Hot Shot%', 'dba_name.ilike.%Hot Shot%');
        } else if (lower.includes('flatbed')) {
          clauses.push('legal_name.ilike.%Flatbed%', 'dba_name.ilike.%Flatbed%', 'legal_name.ilike.%Flat Bed%');
        } else if (lower.includes('reefer') || lower.includes('refrigerated')) {
          clauses.push('legal_name.ilike.%Reefer%', 'dba_name.ilike.%Reefer%', 'legal_name.ilike.%Refrigerat%');
        } else if (lower.includes('tanker')) {
          clauses.push('legal_name.ilike.%Tanker%', 'dba_name.ilike.%Tanker%');
        } else if (lower.includes('dump')) {
          clauses.push('legal_name.ilike.%Dump Truck%', 'dba_name.ilike.%Dump%');
        } else if (lower.includes('tractor')) {
          clauses.push('legal_name.ilike.%Tractor%', 'dba_name.ilike.%Tractor%');
        } else if (lower.includes('trailer')) {
          clauses.push('legal_name.ilike.%Trailer%', 'dba_name.ilike.%Trailer%');
        } else if (lower.includes('van')) {
          clauses.push('legal_name.ilike.%Van%', 'dba_name.ilike.%Van%');
        } else if (lower.includes('specialized')) {
          clauses.push('legal_name.ilike.%Specialized%', 'dba_name.ilike.%Heavy Haul%');
        } else {
          const clean = t.replace(/[^a-zA-Z0-9]/g, '');
          clauses.push(`legal_name.ilike.%${clean}%`, `dba_name.ilike.%${clean}%`);
        }
      });
      if (clauses.length > 0) {
        q = q.or(clauses.join(','));
      }
    }
  }

  // Date Filters
  const dateCol = filters.date_field || 'scraped_at';
  const now = new Date();

  if (filters.date_preset && filters.date_preset !== 'all' && filters.date_preset !== 'custom') {
    let fromDate: Date | null = null;
    let toDate: Date | null = null;

    if (filters.date_preset === 'today') {
      fromDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
    } else if (filters.date_preset === 'yesterday') {
      fromDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1, 0, 0, 0, 0));
      toDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
    } else if (filters.date_preset === 'last_7d') {
      fromDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else if (filters.date_preset === 'last_30d') {
      fromDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    } else if (filters.date_preset === 'last_90d') {
      fromDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    } else if (filters.date_preset === 'this_month') {
      fromDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
    } else if (filters.date_preset === 'last_month') {
      fromDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1, 0, 0, 0, 0));
      toDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0, 23, 59, 59, 999));
    }

    if (fromDate) q = q.gte(dateCol, fromDate.toISOString());
    if (toDate) q = q.lte(dateCol, toDate.toISOString());
  } else if (filters.date_preset === 'custom' || ((filters.date_from || filters.date_to) && filters.date_preset !== 'all')) {
    if (filters.date_from?.trim()) {
      const fromStr = filters.date_from.includes('T') ? filters.date_from : `${filters.date_from.trim()}T00:00:00.000Z`;
      q = q.gte(dateCol, fromStr);
    }
    if (filters.date_to?.trim()) {
      const toStr = filters.date_to.includes('T') ? filters.date_to : `${filters.date_to.trim()}T23:59:59.999Z`;
      q = q.lte(dateCol, toStr);
    }
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
