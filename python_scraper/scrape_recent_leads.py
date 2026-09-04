#!/usr/bin/env python3
"""
MOTUS LLC 4000 Recent Leads Scraper
============================================================================
Paginates through all LLC carriers in MOTUS in parallel, sorts them by USDOT
number descending (most recent first), pre-filters by trucking keywords, and
queries details in parallel to extract the 4,000 most recent qualified leads.

Filters applied to qualify a lead:
1. Trucking industry keyword in name/DBA
2. Status = Active + Out of Service = No
3. Valid non-blank Business Telephone No.

Usage:
  python -u scrape_recent_leads.py
"""

import os
import csv
import sys
import json
import time
import urllib.request
import urllib.error
import urllib.parse
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor, as_completed
from dotenv import load_dotenv

load_dotenv()

# ── Config ────────────────────────────────────────────────────────────────────
SEARCH_QUERY     = "LLC"           # The base query to scan LLC carriers
LIMIT            = 50              # API page size
OUTPUT_CSV       = "recent_leads_4000.csv"
MAX_PAGE_WORKERS = 6               # Parallel page fetchers (Phase 1) - reduced to avoid rate limits
MAX_WORKERS      = 35              # Parallel detail fetchers (Phase 2)
TARGET_LEADS     = 4000            # Number of leads to return

TRUCKING_KEYWORDS = [
    "TRUCK", "TRANSPORT", "LOGISTICS", "EXPRESS", "HAUL", "FREIGHT",
    "CARRIER", "DELIVERY", "LINE", "SHIPPING", "CARGO", "AUTO", "TOW", "TRANS"
]

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

# ── MOTUS API Calls ───────────────────────────────────────────────────────────
def fetch_page(skip, retries=3):
    url = (
        f"https://motus.dot.gov/api/carriers/search"
        f"?query={urllib.parse.quote(SEARCH_QUERY)}"
        f"&skip={skip}&limit={LIMIT}"
    )
    for attempt in range(retries):
        r = api_get(url)
        if "_error" not in r:
            return r.get("data", []), r.get("total", 0)
        # Sleep on failure before retrying
        time.sleep(1.5 * (attempt + 1))
    return [], 0

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

# ── Industry Name Helper ──────────────────────────────────────────────────────
def is_trucking_name(entity_name, dba_name):
    name = (entity_name or "").upper()
    dba = (dba_name or "").upper()
    for kw in TRUCKING_KEYWORDS:
        if kw in name or kw in dba:
            return True
    return False

# ── Candidate Processor ───────────────────────────────────────────────────────
def process_candidate(cand):
    dot = cand["dot"]
    try:
        carrier = fetch_carrier_detail(dot)
        if not carrier or "_error" in carrier:
            return {"dot": dot, "status": "error", "reason": "API error"}

        # 1. Status filter: Active + Out of service = No
        status = get_dot_status(carrier)
        if status.lower() != "active":
            return {"dot": dot, "status": "skip", "reason": f"Not Active ({status})"}
        if carrier.get("outOfService") is True:
            return {"dot": dot, "status": "skip", "reason": "Out of Service"}

        # 2. Contact validation: Phone is required
        phone = get_phone(carrier)
        if not phone:
            return {"dot": dot, "status": "skip", "reason": "Missing phone"}

        # Fetch matrix is disabled to optimize speed and reduce server requests
        exit_date, program_status = "", ""

        lead = build_lead(carrier, exit_date, program_status)
        return {"dot": dot, "status": "lead", "lead": lead, "carrier": carrier}

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
            "carrier_status": "Active",
            "out_of_service": False,
            "scraped_at":     datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "data": {
                "usdot_number":       lead["USDOT Number"],
                "profile_url":        f"https://motus.dot.gov/customer/{lead['USDOT Number']}/account",
                "added_to_motus":     carrier_detail.get("createDate"),
                "motus_last_updated": carrier_detail.get("updateDate"),
                "carrier_status":     "Active",
                "out_of_service":     False,
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
    global SEARCH_QUERY, TARGET_LEADS, OUTPUT_CSV
    
    if len(sys.argv) >= 2:
        SEARCH_QUERY = sys.argv[1]
    if len(sys.argv) >= 3:
        try:
            TARGET_LEADS = int(sys.argv[2])
        except ValueError:
            pass
    if len(sys.argv) >= 4:
        OUTPUT_CSV = sys.argv[3]
    else:
        if len(sys.argv) >= 2:
            OUTPUT_CSV = f"recent_leads_{SEARCH_QUERY.lower()}.csv"

    if hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding='utf-8')
        except Exception:
            pass

    print("=" * 65, flush=True)
    print(f"MOTUS Most Recent Leads Scraper (Query: '{SEARCH_QUERY}')", flush=True)
    print(f"Target Leads: {TARGET_LEADS} | Output File: {OUTPUT_CSV}", flush=True)
    print(f"Pagination size: {LIMIT} | Page Workers: {MAX_PAGE_WORKERS} | Detail Workers: {MAX_WORKERS}", flush=True)
    print("=" * 65, flush=True)

    # ── Phase 1: Collect candidates (Parallel + Pre-filtered by Name) ─────
    print(f"\n[Phase 1] Fetching first page to check record count...", flush=True)
    first_page, total_records = fetch_page(0)
    if total_records == 0:
        print("[-] No records found or search failed.", flush=True)
        sys.exit(1)

    print(f"  Total carriers matching '{SEARCH_QUERY}' in MOTUS: {total_records:,}", flush=True)
    total_pages = (total_records + LIMIT - 1) // LIMIT

    # Cap page collection to 300 pages (~15,000 candidates) for large searches to prevent timeouts
    MAX_PAGES_TO_FETCH = 300
    if total_pages > MAX_PAGES_TO_FETCH:
        print(f"  [Info] Capping page collection at {MAX_PAGES_TO_FETCH} pages for query '{SEARCH_QUERY}' to optimize speed.", flush=True)
        total_pages = MAX_PAGES_TO_FETCH
        total_records = total_pages * LIMIT

    seen_dots = set()
    candidates = []

    # Process first page
    for rec in first_page:
        dot = str(rec.get("dotNumber") or "").strip()
        if dot:
            entity_name = rec.get("entityName", "")
            dba_name = rec.get("dbaName", "")
            if is_trucking_name(entity_name, dba_name):
                seen_dots.add(dot)
                candidates.append({
                    "dot":       dot,
                    "entity_id": rec.get("entityId", ""),
                    "name":      entity_name,
                })

    # Prepare remaining page skips
    skips = [skip for skip in range(LIMIT, total_records, LIMIT)]
    
    print(f"  Fetching remaining {len(skips)} pages in parallel...", flush=True)
    pages_done = 1

    with ThreadPoolExecutor(max_workers=MAX_PAGE_WORKERS) as executor:
        futures = {executor.submit(fetch_page, skip): skip for skip in skips}
        for future in as_completed(futures):
            skip = futures[future]
            results, _ = future.result()
            
            pages_done += 1
            if pages_done % 100 == 0 or pages_done == total_pages:
                print(f"    Progress: {pages_done}/{total_pages} pages fetched... Pre-filtered candidates: {len(candidates):,}", flush=True)

            for rec in results:
                dot = str(rec.get("dotNumber") or "").strip()
                if not dot or dot in seen_dots:
                    continue
                entity_name = rec.get("entityName", "")
                dba_name = rec.get("dbaName", "")
                if is_trucking_name(entity_name, dba_name):
                    seen_dots.add(dot)
                    candidates.append({
                        "dot":       dot,
                        "entity_id": rec.get("entityId", ""),
                        "name":      entity_name,
                    })

    # ── Sort Candidates by USDOT Descending (Most Recent First) ───────────
    print(f"\nSorting {len(candidates):,} candidates chronologically (descending USDOT)...", flush=True)
    # Filter out candidates with invalid/non-numeric USDOTs
    valid_candidates = []
    for c in candidates:
        try:
            int_dot = int(c["dot"])
            valid_candidates.append((int_dot, c))
        except ValueError:
            continue
            
    valid_candidates.sort(key=lambda x: x[0], reverse=True)
    candidates = [x[1] for x in valid_candidates]

    print(f"Sorted. Most recent candidate: USDOT {candidates[0]['dot']} | {candidates[0]['name']}", flush=True)

    # ── Phase 2: Parallel check (stopping when we have enough leads) ──────
    print(f"\n[Phase 2] Checking details in parallel using {MAX_WORKERS} threads...", flush=True)
    leads = []
    stats = {"total": 0, "leads": 0, "skip": 0, "error": 0, "saved": 0}

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        # Submit all candidates
        futures = {executor.submit(process_candidate, c): c for c in candidates}
        for future in as_completed(futures):
            stats["total"] += 1
            cand = futures[future]
            res  = future.result()

            pct = stats["total"] / len(candidates) * 100
            
            if stats["total"] % 500 == 0 or stats["total"] == len(candidates):
                print(f"    Checked {stats['total']}/{len(candidates):,} ({pct:4.1f}%) carriers... Leads: {stats['leads']}", flush=True)

            if res["status"] == "lead":
                stats["leads"] += 1
                lead    = res["lead"]
                carrier = res["carrier"]
                leads.append(lead)
                
                print(f"  [{stats['leads']}] [LEAD] USDOT {lead['USDOT Number']}: {lead['Legal Business Name'][:30]:30s} | Phone: {lead['Business Telephone No.']}", flush=True)
                
                # Database sync disabled to maximize local CSV compilation speed
                # if save_to_supabase(lead, carrier):
                #     stats["saved"] += 1
                pass
                    
                # Check if we have hit the target
                if stats["leads"] >= TARGET_LEADS:
                    print(f"\n[!] Target of {TARGET_LEADS} leads achieved! Stopping scraper.", flush=True)
                    # Cancel remaining futures
                    for f in futures:
                        f.cancel()
                    break
                    
            elif res["status"] == "error":
                stats["error"] += 1
            else:
                stats["skip"] += 1

    # Sort leads descending by USDOT number
    leads.sort(key=lambda x: int(x["USDOT Number"]), reverse=True)
    
    # Slice to target count
    leads = leads[:TARGET_LEADS]

    # ── Save CSV ───────────────────────────────────────────────────────────
    FIELDS = [
        "USDOT Number", "Legal Business Name", "Business Telephone No.",
        "Business Email", "Program Status", "Program Exit Date", "Update Date", "Create Date"
    ]
    with open(OUTPUT_CSV, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDS, extrasaction='ignore')
        writer.writeheader()
        writer.writerows(leads)
    print(f"\n[+] Saved {len(leads)} leads to {OUTPUT_CSV}", flush=True)

    print("\n" + "=" * 65, flush=True)
    print("FINAL SUMMARY", flush=True)
    print("=" * 65, flush=True)
    print(f"  Total Checked:    {stats['total']}")
    print(f"  Leads Extracted:  {len(leads)}")
    print(f"  Saved to DB:      {stats['saved']}")
    print(f"  Skipped:          {stats['skip']:,}")
    print(f"  Errors:           {stats['error']:,}")


if __name__ == "__main__":
    main()
