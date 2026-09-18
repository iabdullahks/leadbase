import { FilterState, AdvancedRule } from './types';
import { SupabaseClient } from '@supabase/supabase-js';

export function defaultFilterState(): FilterState {
  return {
    carrier_statuses: [],
    authority_statuses: [],
    states: [],
    cargo_types: [],
    equipment_types: [],
    // Default date_field is 'added_to_motus' — the single source of truth for all Motus date filtering
    date_field: 'added_to_motus',
    date_preset: 'all',
    missing_fields: [],
    advanced_rules: [],
  };
}

// Maps UI equipment type labels to the actual FMCSA vehicle_type
// strings stored in the `vehicles` table.
export const EQUIPMENT_MAPPING: Record<string, string[]> = {
  // Tractor / Power Only → Truck Tractors
  'tractor': ['Truck Tractors'],
  'power only': ['Truck Tractors'],
  'truck tractor': ['Truck Tractors'],

  // Trailer → Trailers + Hazmat Cargo Tank Trailers (per user request)
  'trailer': ['Trailers', 'Hazmat Cargo Tank Trailers'],
  'trailers': ['Trailers', 'Hazmat Cargo Tank Trailers'],
  'tanker': ['Hazmat Cargo Tank Trailers'],

  // Straight Truck / Box Truck / Flatbed / Dump Truck → Straight Trucks
  'straight truck': ['Straight Trucks'],
  'box truck': ['Straight Trucks'],
  'truck': ['Straight Trucks'],
  'flatbed': ['Straight Trucks'],
  'dump truck': ['Straight Trucks'],

  // Van / Cargo Van → Van 1-8, Van 9-15, Van 16+
  'van': ['Van 1-8', 'Van 9-15', 'Van 16+'],
  'cargo van': ['Van 1-8', 'Van 9-15', 'Van 16+'],
  'van / cargo van': ['Van 1-8', 'Van 9-15', 'Van 16+'],
  'van / dry van': ['Van 1-8', 'Van 9-15', 'Van 16+'],

  // Hauling (Car/Auto) / Hauler → Non-commercial Motor Vehicles (per user request)
  'hauling': ['Non-commercial Motor Vehicles'],
  'hauler': ['Non-commercial Motor Vehicles'],
  'hauling (car/auto)': ['Non-commercial Motor Vehicles'],
};

export function getFmcsaVehicleTypes(equipmentTypes: string[]): string[] {
  const result = new Set<string>();
  for (const t of equipmentTypes) {
    const lower = t.toLowerCase().trim();
    let matched = false;
    for (const [key, fmcsaTypes] of Object.entries(EQUIPMENT_MAPPING)) {
      if (lower === key || lower.includes(key)) {
        fmcsaTypes.forEach(ft => result.add(ft));
        matched = true;
      }
    }
    if (!matched && t) {
      result.add(t);
    }
  }
  return Array.from(result);
}

// Keyword -> real MOTUS classification substring mapping, used to match
// against the actual `cargo_classifications.classification` column. This
// column stores MOTUS's full sentence-length category descriptions (not the
// short UI labels), so a naive `ilike '%<label>%'` breaks in two ways:
// (1) several UI labels never appear verbatim in the real text at all (e.g.
// "Driveaway/Towaway" vs the real "Driveaway-towaway"), so they'd always
// return zero results; (2) generic UI labels like "Other" or "Liquids/Gases"
// are substrings of unrelated long descriptions (e.g. "...and Other General
// Purpose Machinery", or the General Freight description's parenthetical
// mention of "liquids/gases"), so they'd match the wrong carriers. `exact:
// true` entries use a plain (non-wildcarded) ilike, i.e. case-insensitive
// equality, to avoid that overmatching.
function cargoKeywordPatterns(t: string): { pattern: string; exact?: boolean }[] {
  const lower = t.toLowerCase();
  if (lower === 'other') return [{ pattern: 'Other', exact: true }, { pattern: 'OTHER', exact: true }];
  if (lower.includes('general freight')) return [{ pattern: 'General Freight' }];
  if (lower.includes('household goods')) return [{ pattern: 'Household Goods' }];
  if (lower.includes('motor vehicles')) return [{ pattern: 'Motor Vehicles' }];
  if (lower.includes('driveaway') || lower.includes('towaway')) return [{ pattern: 'towaway' }];
  if (lower.includes('machinery')) return [{ pattern: 'Machinery' }];
  if (lower.includes('fresh produce')) return [{ pattern: 'Fresh Produce' }];
  if (lower.includes('liquid') || lower.includes('gas')) return [{ pattern: 'liquids and gases' }];
  if (lower.includes('chemical')) return [{ pattern: 'Chemicals' }];
  if (lower.includes('agricultural') || lower.includes('farm supplies')) return [{ pattern: 'Agriculture Operations' }];
  if (lower.includes('construction')) return [{ pattern: 'Construction' }];
  if (lower.includes('grain') || lower.includes('feed') || lower.includes('ore')) {
    return [{ pattern: 'Oilseed and Grain' }, { pattern: 'Metal Ore Mining' }];
  }
  return [{ pattern: t }];
}

// Pure, synchronous read of what the equipment/cargo filters are asking for —
// no DB calls. Shared by resolveEquipmentCargoIds() and buildCarrierQuery().
function getEquipmentCargoIntent(filters: FilterState) {
  const activeEquipmentTypes = (filters.equipment_types || []).filter(
    t => t !== 'No Equipment' && t !== 'Both' && t !== 'All' && t !== 'All / Non-Filter' && t !== 'non- filter'
  );
  const wantsNoEquipment =
    filters.equipment_mode === 'no_equipment' || (filters.equipment_types || []).includes('No Equipment');
  const wantsSpecificEquipment = !wantsNoEquipment && activeEquipmentTypes.length > 0;
  // wantsHasEquipment is ONLY true when the user picked the generic "Has Equipment" mode
  // with NO specific type selected. When specific types are chosen, buildCarrierQuery joins
  // vehicles!inner directly — adding has_equipment=true on top is redundant.
  const wantsHasEquipment =
    filters.equipment_mode === 'has_equipment' && !wantsNoEquipment && !wantsSpecificEquipment;
  const activeCargoTypes = filters.cargo_types || [];
  const wantsCargo = activeCargoTypes.length > 0;
  return { activeEquipmentTypes, wantsNoEquipment, wantsHasEquipment, wantsSpecificEquipment, activeCargoTypes, wantsCargo };
}

// Resolved equipment/cargo restriction: `include` narrows to these carrier
// ids (null = no restriction, [] = filter active but matched nothing).
export type EquipmentCargoFilter = { include: number[] | null };

// Specific equipment types are handled natively via `vehicles!inner` resource
// embedding directly in `buildCarrierQuery` to avoid transferring massive ID arrays
// that blow past PostgREST URL length limits.
// This function remains for cargo lookups or backwards compatibility.
export async function resolveEquipmentCargoIds(
  supabaseAdmin: SupabaseClient,
  filters: FilterState
): Promise<EquipmentCargoFilter> {
  const { wantsSpecificEquipment, activeCargoTypes, wantsCargo } =
    getEquipmentCargoIntent(filters);

  // Specific equipment is handled directly inside buildCarrierQuery via vehicles!inner join
  if (!wantsCargo) {
    return { include: null };
  }

  let ids: number[] | null = null;
  let rpcFailed = false;
  const intersect = (a: number[] | null, b: number[]): number[] => (a === null ? b : a.filter(id => b.includes(id)));

  if (wantsCargo) {
    const patterns: string[] = [];
    activeCargoTypes.forEach(c => {
      cargoKeywordPatterns(c).forEach(({ pattern, exact }) => {
        patterns.push(exact ? pattern : `%${pattern}%`);
      });
    });
    const { data, error } = await supabaseAdmin.rpc('distinct_cargo_carrier_ids', { patterns });
    if (error) {
      console.error('Error pre-filtering cargo (RPC failed — returning no restriction):', error);
      rpcFailed = true;
    } else {
      ids = intersect(ids, (data as number[] | null) ?? []);
    }
  }

  if (rpcFailed) return { include: null };

  return { include: wantsCargo ? (ids ?? []) : ids };
}

export function buildCarrierQuery(
  supabaseAdmin: SupabaseClient,
  filters: FilterState,
  selectFields = '*',
  includeCount = true,
  // Precomputed via resolveEquipmentCargoIds().
  equipmentCargoIds?: EquipmentCargoFilter | null
) {
  const { wantsNoEquipment, wantsHasEquipment, wantsSpecificEquipment, activeEquipmentTypes } =
    getEquipmentCargoIntent(filters);

  // When joining on vehicles, an exact count over 17.16M rows hits Postgres statement_timeout (8s).
  // Using count: 'estimated' uses Postgres query planner EXPLAIN statistics, returning in <0.25s
  // and keeping pagination working seamlessly.
  const countOption = wantsSpecificEquipment ? 'estimated' : 'exact';

  // Ensure selectFields includes vehicles!inner if filtering by specific equipment
  let effectiveSelect = selectFields;
  if (wantsSpecificEquipment && !effectiveSelect.includes('vehicles!inner')) {
    effectiveSelect = effectiveSelect === '*'
      ? '*, vehicles!inner(vehicle_type)'
      : `${effectiveSelect}, vehicles!inner(vehicle_type)`;
  }

  const q0 = includeCount
    ? supabaseAdmin.from('carriers').select(effectiveSelect, { count: countOption })
    : supabaseAdmin.from('carriers').select(effectiveSelect);
  let q = q0;

  // Specific Equipment Types filter via native PostgREST inner join:
  if (wantsSpecificEquipment) {
    const fmcsaTypes = getFmcsaVehicleTypes(activeEquipmentTypes);
    if (fmcsaTypes.length > 0) {
      q = q.in('vehicles.vehicle_type', fmcsaTypes);
    }
  }

  // Precomputed candidate IDs (used for cargo or explicit inclusion, if not specific equipment)
  if (!wantsSpecificEquipment && equipmentCargoIds?.include != null) {
    q = equipmentCargoIds.include.length === 0 ? q.eq('id', -1) : q.in('id', equipmentCargoIds.include);
  }

  // Persisted, indexed boolean (see supabase/migrations/20260909_has_equipment_flag.sql)
  // instead of an ID-list filter — see resolveEquipmentCargoIds()'s comment for why.
  if (wantsNoEquipment) q = q.eq('has_equipment', false);
  else if (wantsHasEquipment) q = q.eq('has_equipment', true);

  // Global Search — Smart indexing dispatch to prevent statement timeouts on 4.12M+ rows
  if (filters.global_search?.trim()) {
    const s = filters.global_search.trim();
    if (/^\d+$/.test(s)) {
      // Pure numeric query -> USDOT lookup (uses unique B-Tree index on usdot_number in <0.25s)
      if (s.length >= 6) {
        q = q.eq('usdot_number', s);
      } else {
        // Prefix digits (e.g. 4582)
        q = q.ilike('usdot_number', `${s}%`);
      }
    } else if (s.includes('@')) {
      // Email search
      q = q.ilike('email', `%${s}%`);
    } else {
      // Company name search (searches legal_name and dba_name without scanning massive address fields)
      q = q.or(`legal_name.ilike.%${s}%,dba_name.ilike.%${s}%`);
    }
  }

  // Identification Filters (USDOT) - supports filters.usdot, filters.dotFrom, filters.dot_number
  const anyF = filters as unknown as Record<string, unknown>;
  const rawDot = (filters.usdot || anyF.dotFrom || anyF.dot_number || anyF.usdot_from || '').toString().trim();
  if (rawDot) {
    const v = rawDot;
    if (filters.id_match_type === 'exact') {
      q = q.eq('usdot_number', v);
    } else if (filters.id_match_type === 'starts_with') {
      q = q.ilike('usdot_number', `${v}%`);
    } else if (filters.id_match_type === 'contains') {
      q = q.ilike('usdot_number', `%${v}%`);
    } else {
      // Default & 'starts_from': Numbers numerically >= v onwards to the end of the database.
      // usdot_number is stored as TEXT, so a plain .gte() compares lexicographically
      // (e.g. "96466" > "4582560" as strings) and leaks in shorter/unrelated numbers.
      // usdot_number_num is a real indexed bigint column kept in sync via trigger —
      // filtering on it gives a true numeric comparison that can use the index.
      if (/^\d+$/.test(v)) {
        q = q.gte('usdot_number_num', Number(v));
      } else {
        q = q.ilike('usdot_number', `${v}%`);
      }
    }
  }

  const rawDotTo = (filters.usdot_to || anyF.dotTo || '').toString().trim();
  if (rawDotTo && /^\d+$/.test(rawDotTo)) {
    q = q.lte('usdot_number_num', Number(rawDotTo));
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

  // BUG FIX: contact_completeness filter — correct logic for all variants
  if (filters.contact_completeness) {
    if (filters.contact_completeness === 'phone_email') {
      // Must have BOTH phone AND email
      q = q.neq('phone', '').not('phone', 'is', null).neq('email', '').not('email', 'is', null);
    } else if (filters.contact_completeness === 'any') {
      // BUG FIX: 'any' means has phone OR has email.
      // The previous 'and(phone.neq.,phone.not.is.null)' syntax is invalid in PostgREST OR strings.
      // Correct approach: use two separate chained .or() calls so we get (has_phone OR has_email).
      // We chain as: phone not empty OR email not empty.
      // PostgREST .or() supports 'neq' for not-equal-to-empty-string check.
      q = q.or('phone.neq.,email.neq.');
    } else if (filters.contact_completeness === 'none') {
      // BUG FIX: 'none' means BOTH phone AND email are missing.
      // Previous code chained two .or() calls which meant: (phone empty OR email empty)
      // AND (phone empty OR email empty) — same condition twice, NOT the correct AND of both.
      // Correct: phone is empty AND email is empty.
      // We must use two separate chained filters (AND semantics):
      q = q.or('phone.eq.,phone.is.null').or('email.eq.,email.is.null');
      // NOTE: Two chained .or() calls in Supabase-js are ANDed together at the row level,
      // meaning a row must satisfy BOTH: (phone empty OR null) AND (email empty OR null).
      // This is the correct semantics for 'none'.
    }
  }

  // Location Filters (States / Cities / Address)
  if (filters.states && filters.states.length > 0) {
    const stateList = filters.states.map(s => s.toUpperCase());
    q = q.in('state_incorporated', stateList);
  }

  if (filters.city?.trim()) {
    const c = filters.city.trim();
    // Addresses are formatted "STREET, CITY, STATE, ZIP" — the city is always
    // comma-delimited, never surrounded by bare spaces, so an exact match
    // must anchor on the commas rather than spaces.
    if (filters.city_match === 'exact') q = q.ilike('principal_address', `%, ${c},%`);
    else q = q.ilike('principal_address', `%${c}%`);
  }

  if (filters.address?.trim()) {
    q = q.ilike('principal_address', `%${filters.address.trim()}%`);
  }

  // Form of Business
  if (filters.form_of_business && filters.form_of_business.length > 0) {
    q = q.in('form_of_business', filters.form_of_business);
  }

  // Date Filters — Single source of truth is 'added_to_motus' (date lead entered Motus)
  const dateCol = 'added_to_motus';
  const now = new Date();
  // Use UTC midnight boundaries for all date calculations to avoid timezone-related
  // day boundary mismatches (e.g. user in UTC-7 seeing 'today' start at 5pm their time)
  const utcYear = now.getUTCFullYear();
  const utcMonth = now.getUTCMonth();
  const utcDate = now.getUTCDate();

  let fromIso: string | null = null;
  let toIso: string | null = null;

  if (filters.date_preset && filters.date_preset !== 'all' && filters.date_preset !== 'custom') {
    let fromDate: Date | null = null;
    let toDate: Date | null = null;

    if (filters.date_preset === 'today') {
      // [start of today UTC, start of tomorrow UTC)
      fromDate = new Date(Date.UTC(utcYear, utcMonth, utcDate, 0, 0, 0, 0));
      toDate   = new Date(Date.UTC(utcYear, utcMonth, utcDate + 1, 0, 0, 0, 0));
    } else if (filters.date_preset === 'yesterday') {
      // [start of yesterday UTC, start of today UTC)
      fromDate = new Date(Date.UTC(utcYear, utcMonth, utcDate - 1, 0, 0, 0, 0));
      toDate   = new Date(Date.UTC(utcYear, utcMonth, utcDate, 0, 0, 0, 0));
    } else if (filters.date_preset === 'last_7d') {
      // [start of 7 days ago UTC, start of tomorrow UTC)
      fromDate = new Date(Date.UTC(utcYear, utcMonth, utcDate - 6, 0, 0, 0, 0));
      toDate   = new Date(Date.UTC(utcYear, utcMonth, utcDate + 1, 0, 0, 0, 0));
    } else if (filters.date_preset === 'last_30d') {
      fromDate = new Date(Date.UTC(utcYear, utcMonth, utcDate - 29, 0, 0, 0, 0));
      toDate   = new Date(Date.UTC(utcYear, utcMonth, utcDate + 1, 0, 0, 0, 0));
    } else if (filters.date_preset === 'last_90d') {
      fromDate = new Date(Date.UTC(utcYear, utcMonth, utcDate - 89, 0, 0, 0, 0));
      toDate   = new Date(Date.UTC(utcYear, utcMonth, utcDate + 1, 0, 0, 0, 0));
    } else if (filters.date_preset === 'this_month') {
      // [first day of current UTC month, start of tomorrow UTC)
      fromDate = new Date(Date.UTC(utcYear, utcMonth, 1, 0, 0, 0, 0));
      toDate   = new Date(Date.UTC(utcYear, utcMonth, utcDate + 1, 0, 0, 0, 0));
    } else if (filters.date_preset === 'last_month') {
      // [first day of previous UTC month, first day of this UTC month)
      fromDate = new Date(Date.UTC(utcYear, utcMonth - 1, 1, 0, 0, 0, 0));
      toDate   = new Date(Date.UTC(utcYear, utcMonth, 1, 0, 0, 0, 0));
    }

    if (fromDate) fromIso = fromDate.toISOString();
    if (toDate) toIso = toDate.toISOString();
  } else if (filters.date_preset === 'custom' || ((filters.date_from || filters.date_to) && filters.date_preset !== 'all')) {
    if (filters.date_from?.trim()) {
      fromIso = filters.date_from.includes('T') ? filters.date_from : `${filters.date_from.trim()}T00:00:00.000Z`;
    }
    if (filters.date_to?.trim()) {
      if (filters.date_to.includes('T')) {
        toIso = filters.date_to;
      } else {
        // Advance by 1 full day and use .lt() so every timestamp on date_to is included
        const d = new Date(`${filters.date_to.trim()}T00:00:00.000Z`);
        if (!isNaN(d.getTime())) {
          d.setUTCDate(d.getUTCDate() + 1);
          toIso = d.toISOString();
        } else {
          toIso = `${filters.date_to.trim()}T23:59:59.999Z`;
        }
      }
    }
  }

  // Filter strictly on added_to_motus using clean [fromIso, toIso) boundaries
  if (fromIso) q = q.gte(dateCol, fromIso);
  if (toIso) q = q.lt(dateCol, toIso);

  // Data Quality Filters
  if (filters.missing_fields && filters.missing_fields.length > 0) {
    for (const f of filters.missing_fields) {
      if (f === 'phone') q = q.or('phone.eq.,phone.is.null');
      if (f === 'email') q = q.or('email.eq.,email.is.null');
      if (f === 'address') q = q.or('principal_address.eq.,principal_address.is.null');
    }
  }

  // Advanced Rules — consecutive rules linked by `logic: 'OR'` are combined
  // into a single OR group; groups themselves are ANDed together (standard
  // AND-of-ORs semantics), so e.g. [A, B(OR), C] means (A OR B) AND C.
  const activeRules = (filters.advanced_rules || []).filter(r => r.field && r.operator);
  if (activeRules.length > 0) {
    const groups: AdvancedRule[][] = [];
    for (const rule of activeRules) {
      if (rule.logic === 'OR' && groups.length > 0) {
        groups[groups.length - 1].push(rule);
      } else {
        groups.push([rule]);
      }
    }

    // Flattened clause(s) for one rule, suitable for joining inside an OR group.
    const ruleToClauses = (rule: AdvancedRule): string[] => {
      const f = rule.field;
      const val = rule.value;
      switch (rule.operator) {
        case 'contains': return [`${f}.ilike.%${val}%`];
        case 'exact': return [`${f}.eq.${val}`];
        case 'is_not_empty': return [`and(${f}.neq.,${f}.not.is.null)`];
        case 'is_empty': return [`${f}.eq.`, `${f}.is.null`];
        case 'gt': return [`${f}.gt.${Number(val)}`];
        case 'gte': return [`${f}.gte.${Number(val)}`];
        case 'lt': return [`${f}.lt.${Number(val)}`];
        case 'lte': return [`${f}.lte.${Number(val)}`];
        default: return [];
      }
    };

    for (const group of groups) {
      if (group.length === 1) {
        const rule = group[0];
        const f = rule.field;
        const val = rule.value;
        if (rule.operator === 'contains') q = q.ilike(f, `%${val}%`);
        else if (rule.operator === 'exact') q = q.eq(f, val);
        else if (rule.operator === 'is_not_empty') q = q.neq(f, '').not(f, 'is', null);
        else if (rule.operator === 'is_empty') q = q.or(`${f}.eq.,${f}.is.null`);
        else if (rule.operator === 'gt') q = q.gt(f, Number(val));
        else if (rule.operator === 'gte') q = q.gte(f, Number(val));
        else if (rule.operator === 'lt') q = q.lt(f, Number(val));
        else if (rule.operator === 'lte') q = q.lte(f, Number(val));
      } else {
        const clauses = group.flatMap(ruleToClauses);
        if (clauses.length > 0) q = q.or(clauses.join(','));
      }
    }
  }

  return q;
}
