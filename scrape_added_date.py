#!/usr/bin/env python3
"""
MOTUS LLC Added Date Scraper
============================================================================
Paginates through all LLC carriers in MOTUS in parallel and extracts every
single carrier added (created) on a specific target date, with NO filters
applied (no trucking keywords, status, phone, or status qualifications).

Usage:
  python -u scrape_added_date.py [YYYY-MM-DD]
"""

import os
import csv
import sys
import json
import time
import urllib.request
import urllib.error
import urllib.parse
from datetime import datetime, timedelta, timezone
from concurrent.futures import ThreadPoolExecutor, as_completed
from dotenv import load_dotenv

load_dotenv()

# ── Config ────────────────────────────────────────────────────────────────────
SEARCH_QUERY     = "LLC"           # The base query to scan LLC carriers
LIMIT            = 50              # API page size
MAX_PAGE_WORKERS = 25              # Parallel page fetchers (Phase 1)
MAX_WORKERS      = 80              # Parallel detail fetchers (Phase 2)

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept":     "application/json",
    "Referer":    "https://motus.dot.gov/search",
    "Origin":     "https://motus.dot.gov",
}

# ── HTTP Helper ───────────────────────────────────────────────────────────────
def api_get(url, timeout=15):
    try:
        req = urllib.request.Request(url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        return {"_error": e.code}
    except Exception as ex:
        return {"_error": str(ex)[:80]}

# ── Date Helpers ──────────────────────────────────────────────────────────────
def parse_iso(s):
    if not s:
        return None
    try:
        s = s.replace("Z", "+00:00")
        if "." in s and ("+" in s or s.endswith("00:00")):
            base = s.split(".")[0]
            tz   = "+" + s.split("+")[1] if "+" in s else "+00:00"
            s    = base + tz
        return datetime.fromisoformat(s)
    except Exception:
        return None

# ── MOTUS API Calls ───────────────────────────────────────────────────────────
def fetch_page(skip):
    url = (
        f"https://motus.dot.gov/api/carriers/search"
        f"?query={urllib.parse.quote(SEARCH_QUERY)}"
        f"&skip={skip}&limit={LIMIT}"
    )
    r = api_get(url)
    if "_error" in r:
        return [], 0
    return r.get("data", []), r.get("total", 0)

def fetch_carrier_detail(dot_number):
    return api_get(f"https://motus.dot.gov/api/carriers/{dot_number}")

def fetch_matrix(entity_id):
    r = api_get(f"https://motus.dot.gov/api/public-registration-matrix/{entity_id}")
    return r.get("entity", {}) if "_error" not in r else {}

# ── Field Getters ─────────────────────────────────────────────────────────────
def get_dot_status(carrier):
    dn = carrier.get("entityDotNumber") or {}
    st = dn.get("dotNumberStatus") or {}
    return (st.get("dotNumberStatus") or st.get("status") or "").strip()

def get_phone(carrier):
    for p in (carrier.get("phoneNumbers") or []):
        ph = (p.get("phoneNumber") or "").strip()
        if ph:
            return ph
    return ""

def get_email(carrier):
    for e in (carrier.get("emailAddresses") or []):
        em = (e.get("emailAddress") or "").strip()
        if em:
            return em
    return ""

def get_legal_name(carrier):
    for n in (carrier.get("entityNames") or []):
        if n.get("nameType") == "Legal":
            return (n.get("entityName") or "").strip()
    return (carrier.get("entityName") or "").strip()

def get_dot_number(carrier):
    dot = carrier.get("entityDotNumber") or {}
    return str(dot.get("dotNumber") or carrier.get("entityId") or "")

def extract_exit_info(matrix):
    for ne in (matrix.get("entityNewEntrant") or []):
        ed = ne.get("exitedDate")
        if ed:
            st_obj = ne.get("entityNewEntrantStatus") or {}
            ps = (st_obj.get("entityNewEntrantStatusName") or "").strip()
            return ed, ps
    return "", ""

def build_lead(carrier, exit_date, program_status):
    return {
        "USDOT Number":             get_dot_number(carrier),
        "Legal Business Name":      get_legal_name(carrier),
        "Business Telephone No.":   get_phone(carrier),
        "Business Email":           get_email(carrier),
        "Program Status":           program_status or "",
        "Program Exit Date":        exit_date or "",
        "Update Date":              carrier.get("updateDate") or carrier.get("createDate") or "",
        "Create Date":              carrier.get("createDate") or ""
    }

# ── Candidate Processor ───────────────────────────────────────────────────────
def process_candidate(cand, target_date):
    dot = cand["dot"]
    try:
        carrier = fetch_carrier_detail(dot)
        if not carrier or "_error" in carrier:
            return {"dot": dot, "status": "error", "reason": "API error"}

        # Date filter: createDate must be target_date
        created_str = carrier.get("createDate") or ""
        created_dt = parse_iso(created_str)
        
        is_target_day = False
        if created_dt and created_dt.date() == target_date:
            is_target_day = True
            
        if not is_target_day:
            return {"dot": dot, "status": "skip", "reason": f"Not created on target date: {created_str}"}

        # Fetch matrix to get exit info if present
        entity_id = carrier.get("entityId")
        exit_date, program_status = "", ""
        if entity_id:
            matrix = fetch_matrix(entity_id)
            if matrix:
                exit_date, program_status = extract_exit_info(matrix)

        lead = build_lead(carrier, exit_date, program_status)
        return {"dot": dot, "status": "match", "lead": lead, "carrier": carrier}

    except Exception as e:
        return {"dot": dot, "status": "error", "reason": str(e)[:80]}

# ── Supabase Save ─────────────────────────────────────────────────────────────
def save_to_supabase(lead, carrier_detail):
    try:
        from supabase_db import upsert_carrier, is_enabled
        if not is_enabled():
            return False
        record = {
            "usdot_number":   lead["USDOT Number"],
            "added_to_motus": carrier_detail.get("createDate"),
            "carrier_status": get_dot_status(carrier_detail) or "Active",
            "out_of_service": carrier_detail.get("outOfService") or False,
            "scraped_at":     datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "data": {
                "usdot_number":       lead["USDOT Number"],
                "profile_url":        f"https://motus.dot.gov/customer/{lead['USDOT Number']}/account",
                "added_to_motus":     carrier_detail.get("createDate"),
                "motus_last_updated": carrier_detail.get("updateDate"),
                "carrier_status":     get_dot_status(carrier_detail) or "Active",
                "out_of_service":     carrier_detail.get("outOfService") or False,
                "business_information": {
                    "Legal Business Name":    lead["Legal Business Name"],
                    "Business Telephone No.": lead["Business Telephone No."],
                    "Business Email":         lead["Business Email"],
                },
                "company_officials":    [],
                "cargo_classification": [],
                "vehicles":             [],
                "drivers":              [],
                "new_entrant_program": {
                    "Program Status":    lead.get("Program Status", ""),
                    "Program Exit Date": lead["Program Exit Date"],
                },
            }
        }
        return upsert_carrier(record, change_type="new")
    except Exception as ex:
        print(f"  [supabase error] {ex}", flush=True)
        return False

# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    import sys
    if hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding='utf-8')
        except Exception:
            pass

    if len(sys.argv) >= 2:
        date_str = sys.argv[1]
    else:
        # Default to yesterday
        date_str = (datetime.now(timezone.utc) - timedelta(days=1)).strftime("%Y-%m-%d")
        
    try:
        target_date = datetime.strptime(date_str, "%Y-%m-%d").date()
    except ValueError:
        print(f"Error: Date '{date_str}' must be in YYYY-MM-DD format.")
        sys.exit(1)

    output_csv = f"added_carriers_{target_date.strftime('%Y_%m_%d')}.csv"

    print("=" * 65, flush=True)
    print(f"MOTUS LLC Added Carrier Date Scraper (NO FILTERS)", flush=True)
    print(f"Target date (UTC): {target_date}", flush=True)
    print(f"Output File:       {output_csv}", flush=True)
    print(f"Pagination size: {LIMIT} | Page Workers: {MAX_PAGE_WORKERS} | Detail Workers: {MAX_WORKERS}", flush=True)
    print("=" * 65, flush=True)

    # ── Phase 1: Collect candidates ───────────────────────────────────────
    print(f"\n[Phase 1] Fetching first page to check record count...", flush=True)
    first_page, total_records = fetch_page(0)
    if total_records == 0:
        print("[-] No records found or search failed.", flush=True)
        sys.exit(1)

    print(f"  Total LLCs in MOTUS: {total_records:,}", flush=True)
    total_pages = (total_records + LIMIT - 1) // LIMIT
    print(f"  Total pages to fetch: {total_pages:,}", flush=True)

    seen_dots = set()
    candidates = []

    # Process first page
    for rec in first_page:
        dot = str(rec.get("dotNumber") or "").strip()
        if dot:
            seen_dots.add(dot)
            candidates.append({
                "dot":       dot,
                "entity_id": rec.get("entityId", ""),
                "name":      rec.get("entityName", ""),
            })

    # Prepare remaining page skips
    skips = [skip for skip in range(LIMIT, total_records, LIMIT)]
    
    print(f"  Fetching remaining {len(skips)} pages in parallel using {MAX_PAGE_WORKERS} threads...", flush=True)
    pages_done = 1

    with ThreadPoolExecutor(max_workers=MAX_PAGE_WORKERS) as executor:
        futures = {executor.submit(fetch_page, skip): skip for skip in skips}
        for future in as_completed(futures):
            skip = futures[future]
            results, _ = future.result()
            
            pages_done += 1
            if pages_done % 100 == 0 or pages_done == total_pages:
                print(f"    Progress: {pages_done}/{total_pages} pages fetched... Candidates: {len(candidates):,}", flush=True)

            for rec in results:
                dot = str(rec.get("dotNumber") or "").strip()
                if not dot or dot in seen_dots:
                    continue
                seen_dots.add(dot)
                candidates.append({
                    "dot":       dot,
                    "entity_id": rec.get("entityId", ""),
                    "name":      rec.get("entityName", ""),
                })

    print(f"\nTotal candidates collected: {len(candidates):,}", flush=True)

    # ── Phase 2: Parallel check ────────────────────────────────────────────
    print(f"\n[Phase 2] Checking all candidates details in parallel using {MAX_WORKERS} threads...", flush=True)
    matches = []
    stats = {"total": 0, "matches": 0, "skip": 0, "error": 0, "saved": 0}

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {executor.submit(process_candidate, c, target_date): c for c in candidates}
        for future in as_completed(futures):
            stats["total"] += 1
            cand = futures[future]
            res  = future.result()

            pct = stats["total"] / len(candidates) * 100
            
            if stats["total"] % 500 == 0 or stats["total"] == len(candidates):
                print(f"    Checked {stats['total']}/{len(candidates):,} ({pct:4.1f}%) carriers...", flush=True)

            if res["status"] == "match":
                stats["matches"] += 1
                lead    = res["lead"]
                carrier = res["carrier"]
                matches.append(lead)
                print(f"  [{stats['total']}/{len(candidates):,}] [MATCH] {lead['Legal Business Name'][:30]:30s} "
                      f"| Phone: {lead['Business Telephone No.']} "
                      f"| Created: {lead['Create Date'][:16]}", flush=True)
                if save_to_supabase(lead, carrier):
                    stats["saved"] += 1
            elif res["status"] == "error":
                stats["error"] += 1
            else:
                stats["skip"] += 1

    # ── Save CSV ───────────────────────────────────────────────────────────
    FIELDS = [
        "USDOT Number", "Legal Business Name", "Business Telephone No.",
        "Business Email", "Program Status", "Program Exit Date", "Update Date", "Create Date"
    ]
    with open(output_csv, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(matches)
    print(f"\n[+] Saved {len(matches)} carriers to {output_csv}", flush=True)

    print("\n" + "=" * 65, flush=True)
    print("FINAL SUMMARY", flush=True)
    print("=" * 65, flush=True)
    print(f"  Target Date:      {target_date}", flush=True)
    print(f"  Extracted:        {stats['matches']}", flush=True)
    print(f"  Saved to DB:      {stats['saved']}", flush=True)
    print(f"  Skipped:          {stats['skip']:,}", flush=True)
    print(f"  Errors:           {stats['error']:,}", flush=True)


if __name__ == "__main__":
    main()
