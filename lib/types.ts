export interface Carrier {
  id?: number;
  usdot_number: string;
  legal_name: string;
  dba_name?: string;
  mc_number?: string;
  phone: string;
  email: string;
  website?: string;
  carrier_status: string;
  authority_status?: string;
  out_of_service: boolean;
  scraped_at: string;
  motus_entry_date: string;
  motus_last_updated: string;
  added_to_motus?: string;
  profile_url: string;
  principal_address?: string;
  mailing_address?: string;
  city?: string;
  state?: string;
  zip_code?: string;
  state_incorporated?: string;
  form_of_business?: string;
  new_entrant_status?: string;
  power_units?: number;
  drivers?: number;
  total_vehicles?: number;
  tractors?: number;
  trailers?: number;
  cargo_classifications?: string[];
  vehicle_types?: string[];
  scraper_run_id?: string;
  raw_data?: Record<string, unknown>;
}

export interface Stats {
  total: number;
  active: number;
  inactive: number;
  with_phone: number;
  with_email: number;
  new_today: number;
}

export interface LeadsResponse {
  leads: Carrier[];
  total: number;
  page: number;
  pages: number;
  per_page: number;
}

export type NumericOperator = '=' | '>' | '<' | '>=' | '<=' | 'between';
export type TextMatchOperator = 'contains' | 'exact' | 'starts_with';

export interface AdvancedRule {
  id: string;
  field: string;
  operator: string;
  value: string;
  valueSecondary?: string;
  logic?: 'AND' | 'OR';
}

export interface FilterState {
  // Identification
  usdot?: string;
  mc_number?: string;
  legal_name?: string;
  dba_name?: string;
  company_name?: string;
  id_match_type?: TextMatchOperator;

  // Status
  carrier_statuses: string[]; // Active, Inactive, Pending, Out of Service, Unknown
  authority_statuses: string[];

  // Contact Info
  has_phone?: boolean | null;
  has_email?: boolean | null;
  has_website?: boolean | null;
  contact_completeness?: 'all' | 'phone_email' | 'phone_email_website' | 'any' | 'none' | '';

  // Location
  states: string[]; // TX, FL, CA, etc.
  city?: string;
  city_match?: TextMatchOperator;
  zip?: string;
  zip_mode?: 'exact' | 'range' | 'starts_with';
  zip_min?: string;
  zip_max?: string;
  address?: string;

  // Carrier / Operations
  form_of_business?: string[];
  new_entrant_status?: string;

  // Fleet & Size (Numeric Ranges)
  power_units_op?: NumericOperator;
  power_units_val?: number;
  power_units_max?: number;

  drivers_op?: NumericOperator;
  drivers_val?: number;
  drivers_max?: number;

  vehicles_op?: NumericOperator;
  vehicles_val?: number;
  vehicles_max?: number;

  // Cargo & Equipment
  cargo_types: string[];
  equipment_types: string[];

  // Date Filters
  date_field?: 'scraped_at' | 'motus_entry_date' | 'added_to_motus' | 'motus_last_updated';
  date_preset?: 'all' | 'today' | 'yesterday' | 'last_7d' | 'last_30d' | 'last_90d' | 'this_month' | 'last_month' | 'custom';
  date_from?: string;
  date_to?: string;

  // Data Quality
  profile_completeness?: 'complete' | 'incomplete' | '';
  missing_fields: string[];

  // Source & Discovery
  scraper_run_id?: string;

  // Advanced Rules Builder
  advanced_rules: AdvancedRule[];

  // Search Bar
  global_search?: string;
}

export interface SavedView {
  id: string;
  name: string;
  description?: string;
  filter_state: FilterState;
  is_default?: boolean;
  created_at: string;
}

export interface ExportOptions {
  format: 'csv' | 'excel' | 'json';
  scope: 'all_matching' | 'selected' | 'current_page';
  selected_ids?: string[];
  columns: string[];
}

export interface ExportHistoryItem {
  id: string;
  file_name: string;
  format: string;
  record_count: number;
  filter_summary: string;
  filter_state?: FilterState;
  status: 'completed' | 'failed' | 'processing';
  file_url?: string;
  created_at: string;
}
