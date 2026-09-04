export interface Carrier {
  usdot_number: string;
  legal_name: string;
  phone: string;
  email: string;
  carrier_status: string;
  out_of_service: boolean;
  scraped_at: string;
  motus_entry_date: string;
  motus_last_updated: string;
  profile_url: string;
  dba_name?: string;
  principal_address?: string;
  mailing_address?: string;
  form_of_business?: string;
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

export interface LeadsQuery {
  page?: number;
  search?: string;
  status?: string;
  has_phone?: string;
  has_email?: string;
  sort?: string;
  dir?: string;
  date_from?: string;
  date_to?: string;
}
