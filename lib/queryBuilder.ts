import { FilterState, AdvancedRule } from './types';
import { SupabaseClient } from '@supabase/supabase-js';

export function defaultFilterState(): FilterState {
  return {
    carrier_statuses: [],
    authority_statuses: [],
    states: [],
    cargo_types: [],
    equipment_types: [],
    date_field: 'motus_create_or_update',
    date_preset: 'all',
    missing_fields: [],
    advanced_rules: [],
  };
}

// Keyword -> real MOTUS equipmentTypeDesc substring mapping, used to match
// against the actual `vehicles.vehicle_type` column (populated once the
// carrier's registration-matrix data has been backfilled).
function equipmentKeywordPatterns(t: string): string[] {
  const lower = t.toLowerCase();
  if (lower.includes('power only') || lower.includes('poweronly')) return ['Power Only', 'PowerOnly'];
  if (lower.includes('box truck') || lower.includes('boxtruck')) return ['Box Truck', 'Boxtruck'];
  if (lower.includes('cargo van') || lower.includes('sprinter')) return ['Cargo Van', 'Sprinter'];
  if (lower.includes('hauler') || lower.includes('car hauler') || lower.includes('auto hauler')) return ['Hauler', 'Auto Haul'];
  if (lower.includes('hotshot') || lower.includes('hot shot')) return ['Hotshot', 'Hot Shot'];
  if (lower.includes('flatbed')) return ['Flatbed', 'Flat Bed'];
  if (lower.includes('reefer') || lower.includes('refrigerated')) return ['Reefer', 'Refrigerat'];
  if (lower.includes('tanker')) return ['Tanker'];
  if (lower.includes('dump')) return ['Dump Truck', 'Dump'];
  if (lower.includes('tractor')) return ['Tractor'];
  if (lower.includes('trailer')) return ['Trailer'];
  if (lower.includes('van')) return ['Van'];
  if (lower.includes('specialized')) return ['Specialized', 'Heavy Haul'];
  return [t.replace(/[^a-zA-Z0-9 ]/g, '')];
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
  const wantsHasEquipment = filters.equipment_mode === 'has_equipment' && !wantsNoEquipment;
  const wantsSpecificEquipment = !wantsNoEquipment && activeEquipmentTypes.length > 0;
  const activeCargoTypes = filters.cargo_types || [];
  const wantsCargo = activeCargoTypes.length > 0;
  return { activeEquipmentTypes, wantsNoEquipment, wantsHasEquipment, wantsSpecificEquipment, activeCargoTypes, wantsCargo };
}

// Resolved equipment/cargo restriction: `include` narrows to these carrier
// ids (null = no restriction, [] = filter active but matched nothing);
// `exclude` removes these carrier ids (used for "No Equipment", i.e. NOT
// EXISTS emulation — see note below on why this can't be a joined filter).
export type EquipmentCargoFilter = { include: number[] | null; exclude: number[] | null };

// Resolves candidate carrier IDs for equipment_types/cargo_types/has_equipment/
// no_equipment filters via a cheap lookup against the small `vehicles`/
// `cargo_classifications` tables, instead of joining against the full 4.1M-row
// `carriers` table (which timed out — Postgres has to evaluate the join
// condition per carrier row even when the joined table is empty). Callers
// MUST await this before calling the (synchronous) buildCarrierQuery and pass
// the result through, since PostgrestFilterBuilder is itself "thenable" — an
// async function that `return`s one gets its result auto-unwrapped by JS at
// runtime, which would silently break every caller's .order()/.range() chaining.
//
// "No Equipment" needs its own lookup rather than a `vehicles!left(id)` embed
// + `.is('vehicles.id', null)` filter (the previous approach): PostgREST only
// applies embedded-resource filters to the nested array itself unless the
// embed is `!inner` — without `!inner` the parent carrier row is returned
// regardless of whether any embedded row matched, so that filter silently
// matched 100% of carriers. Building an explicit exclude-list of carrier ids
// that DO have a vehicle row (mirroring the include-list pattern above) and
// applying it via `.not('id', 'in', ...)` actually excludes at the parent level.
export async function resolveEquipmentCargoIds(
  supabaseAdmin: SupabaseClient,
  filters: FilterState
): Promise<EquipmentCargoFilter> {
  const { activeEquipmentTypes, wantsNoEquipment, wantsHasEquipment, wantsSpecificEquipment, activeCargoTypes, wantsCargo } =
    getEquipmentCargoIntent(filters);
  if (!wantsNoEquipment && !wantsSpecificEquipment && !wantsHasEquipment && !wantsCargo) {
    return { include: null, exclude: null };
  }

  let ids: number[] | null = null;
  let exclude: number[] | null = null;
  const intersect = (a: number[] | null, b: number[]): number[] => (a === null ? b : a.filter(id => b.includes(id)));

  if (wantsNoEquipment) {
    const { data, error } = await supabaseAdmin.from('vehicles').select('carrier_id');
    if (error) console.error('Error pre-filtering vehicles (no-equipment):', error);
    exclude = Array.from(new Set((data || []).map((r: { carrier_id: number }) => r.carrier_id)));
  } else if (wantsSpecificEquipment || wantsHasEquipment) {
    let vQuery = supabaseAdmin.from('vehicles').select('carrier_id');
    if (wantsSpecificEquipment) {
      const clauses: string[] = [];
      activeEquipmentTypes.forEach(t => {
        equipmentKeywordPatterns(t).forEach(p => clauses.push(`vehicle_type.ilike.%${p}%`));
      });
      if (clauses.length > 0) vQuery = vQuery.or(clauses.join(','));
    }
    const { data, error } = await vQuery;
    if (error) console.error('Error pre-filtering vehicles:', error);
    ids = intersect(ids, Array.from(new Set((data || []).map((r: { carrier_id: number }) => r.carrier_id))));
  }

  if (wantsCargo) {
    let cQuery = supabaseAdmin.from('cargo_classifications').select('carrier_id');
    const clauses: string[] = [];
    activeCargoTypes.forEach(c => {
      cargoKeywordPatterns(c).forEach(({ pattern, exact }) => {
        clauses.push(exact ? `classification.ilike.${pattern}` : `classification.ilike.%${pattern}%`);
      });
    });
    if (clauses.length > 0) cQuery = cQuery.or(clauses.join(','));
    const { data, error } = await cQuery;
    if (error) console.error('Error pre-filtering cargo:', error);
    ids = intersect(ids, Array.from(new Set((data || []).map((r: { carrier_id: number }) => r.carrier_id))));
  }

  const wantsInclude = wantsSpecificEquipment || wantsHasEquipment || wantsCargo;
  return { include: wantsInclude ? (ids ?? []) : ids, exclude };
}

export function buildCarrierQuery(
  supabaseAdmin: SupabaseClient,
  filters: FilterState,
  selectFields = '*',
  includeCount = true,
  // Precomputed via resolveEquipmentCargoIds().
  equipmentCargoIds?: EquipmentCargoFilter | null
) {
  const q0 = includeCount
    ? supabaseAdmin.from('carriers').select(selectFields, { count: 'exact' })
    : supabaseAdmin.from('carriers').select(selectFields);
  let q = q0;

  if (equipmentCargoIds?.include != null) {
    q = equipmentCargoIds.include.length === 0 ? q.eq('id', -1) : q.in('id', equipmentCargoIds.include);
  }
  if (equipmentCargoIds?.exclude && equipmentCargoIds.exclude.length > 0) {
    q = q.not('id', 'in', `(${equipmentCargoIds.exclude.join(',')})`);
  }

  // Global Search
  if (filters.global_search?.trim()) {
    const s = filters.global_search.trim();
    q = q.or(`legal_name.ilike.%${s}%,dba_name.ilike.%${s}%,usdot_number.ilike.%${s}%,phone.ilike.%${s}%,email.ilike.%${s}%,principal_address.ilike.%${s}%`);
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

  // Date Filters
  const dateCol = filters.date_field || 'scraped_at';
  const now = new Date();

  let fromIso: string | null = null;
  let toIso: string | null = null;

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

    if (fromDate) fromIso = fromDate.toISOString();
    if (toDate) toIso = toDate.toISOString();
  } else if (filters.date_preset === 'custom' || ((filters.date_from || filters.date_to) && filters.date_preset !== 'all')) {
    if (filters.date_from?.trim()) {
      fromIso = filters.date_from.includes('T') ? filters.date_from : `${filters.date_from.trim()}T00:00:00.000Z`;
    }
    if (filters.date_to?.trim()) {
      toIso = filters.date_to.includes('T') ? filters.date_to : `${filters.date_to.trim()}T23:59:59.999Z`;
    }
  }

  if (filters.date_field === 'motus_create_or_update') {
    if (fromIso && toIso) {
      q = q.or(`and(motus_entry_date.gte.${fromIso},motus_entry_date.lte.${toIso}),and(motus_last_updated.gte.${fromIso},motus_last_updated.lte.${toIso})`);
    } else if (fromIso) {
      q = q.or(`motus_entry_date.gte.${fromIso},motus_last_updated.gte.${fromIso}`);
    } else if (toIso) {
      q = q.or(`motus_entry_date.lte.${toIso},motus_last_updated.lte.${toIso}`);
    }
  } else {
    if (fromIso) q = q.gte(dateCol, fromIso);
    if (toIso) q = q.lte(dateCol, toIso);
  }

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
