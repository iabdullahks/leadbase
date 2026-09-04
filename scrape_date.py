#!/usr/bin/env python3
"""
MOTUS LLC Trucking Date Scraper
============================================================================
Paginates through all LLC carriers in MOTUS to find those updated/created on
a specific target date who belong to the trucking industry.

Filters applied:
1. Updated or Created date is exactly the target date (UTC)
2. Legal Name or DBA contains trucking industry keywords
3. Carrier Status = Active + Out of Service = No
4. Valid non-blank Business Telephone No.

Usage:
  python scrape_date.py 2026-06-06
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
RATE_LIMIT_DELAY = 0.15            # Delay between search requests
OUTPUT_CSV       = "leads_output_2026_06_06.csv"
MAX_WORKERS      = 25              # Parallel detail fetchers
MAX_PAGES        = None            # None = scan all pages

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
        "Update Date":              carrier.get("updateDate") or carrier.get("createDate") or ""
    }

# ── Candidate Processor ───────────────────────────────────────────────────────
def process_candidate(cand, target_date):
    dot = cand["dot"]
    try:
        carrier = fetch_carrier_detail(dot)
        if not carrier or "_error" in carrier:
            return {"dot": dot, "status": "error", "reason": "API error"}

        # 1. Date filter: updateDate or createDate must be target_date
        created_str = carrier.get("createDate") or ""
        updated_str = carrier.get("updateDate") or ""
        
        created_dt = parse_iso(created_str)
        updated_dt = parse_iso(updated_str)
        
        is_target_day = False
        if created_dt and created_dt.date() == target_date:
            is_target_day = True
        if updated_dt and updated_dt.date() == target_date:
            is_target_day = True
            
        if not is_target_day:
            return {"dot": dot, "status": "skip", "reason": "Not updated on target date"}

        # 2. Industry filter: Name contains trucking keywords
        legal_name = get_legal_name(carrier).upper()
        dba_name = (carrier.get("dbaName") or "").upper()
        
        is_trucking = False
        for kw in TRUCKING_KEYWORDS:
            if kw in legal_name or kw in dba_name:
                is_trucking = True
                break
                
        if not is_trucking:
            return {"dot": dot, "status": "skip", "reason": "Not trucking industry"}

        # 3. Status filter: Active + Out of service = No
        status = get_dot_status(carrier)
        if status.lower() != "active":
            return {"dot": dot, "status": "skip", "reason": f"Not Active ({status})"}
        if carrier.get("outOfService") is True:
            return {"dot": dot, "status": "skip", "reason": "Out of Service"}

        # 4. Contact validation: Phone is required
        phone = get_phone(carrier)
        if not phone:
            return {"dot": dot, "status": "skip", "reason": "Missing phone"}

        # Fetch matrix only for matches to minimize API calls
        entity_id = carrier.get("entityId")
        exit_date, program_status = "", ""
        if entity_id:
            matrix = fetch_matrix(entity_id)
            if matrix:
                exit_date, program_status = extract_exit_info(matrix)

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
        print(f"  [supabase error] {ex}")
        return False

# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    if len(sys.argv) < 2:
        print("Usage: python scrape_date.py <YYYY-MM-DD> [max_pages]")
        sys.exit(1)
        
    date_str = sys.argv[1]
    try:
        target_date = datetime.strptime(date_str, "%Y-%m-%d").date()
    except ValueError:
        print("Error: Date must be in YYYY-MM-DD format.")
        sys.exit(1)
        
    max_pages = None
    if len(sys.argv) >= 3:
        try:
            max_pages = int(sys.argv[2])
        except ValueError:
            print("Error: max_pages must be an integer.")
            sys.exit(1)

    print("=" * 65)
    print(f"MOTUS LLC Trucking Date Scraper")
    print(f"Target update date (UTC): {target_date}")
    print(f"Pagination size: {LIMIT} | Workers: {MAX_WORKERS}")
    if max_pages:
        print(f"Limit execution to: {max_pages} pages")
    print("=" * 65)

    # ── Phase 1: Collect candidates ────────────────────────────────────────
    print(f"\n[Phase 1] Collecting LLC candidates...")
    seen_dots = set()
    candidates = []
    skip = 0
    total_records = None

    while True:
        results, total = fetch_page(skip)
        if total_records is None and total:
            total_records = total
            total_pages = (total + LIMIT - 1) // LIMIT
            print(f"  Total LLCs: {total:,} | Pages to scan: {total_pages:,}")

        if not results:
            break

        new_count = 0
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
            new_count += 1

        current_page = skip // LIMIT + 1
        print(f"  Page {current_page:4d}/{total_pages} | skip={skip:6d} | "
              f"+{new_count:3d} new | pool={len(candidates):,}", flush=True)

        skip += LIMIT
        if skip >= (total_records or 0):
            break
        if max_pages and current_page >= max_pages:
            print(f"  [!] Limit reached: max_pages={max_pages}")
            break

        time.sleep(RATE_LIMIT_DELAY)

    print(f"\nTotal unique candidates collected: {len(candidates):,}")

    # ── Phase 2: Parallel check ────────────────────────────────────────────
    print(f"\n[Phase 2] Checking details in parallel...")
    leads = []
    stats = {"total": 0, "leads": 0, "skip": 0, "error": 0, "saved": 0}

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {executor.submit(process_candidate, c, target_date): c for c in candidates}
        for future in as_completed(futures):
            stats["total"] += 1
            cand = futures[future]
            res  = future.result()

            pct = stats["total"] / len(candidates) * 100
            tag = f"[{stats['total']:5d}/{len(candidates):,} {pct:4.1f}%]"

            if res["status"] == "lead":
                stats["leads"] += 1
                lead    = res["lead"]
                carrier = res["carrier"]
                leads.append(lead)
                print(f"  {tag} ✅ {lead['Legal Business Name'][:30]:30s} "
                      f"| Phone: {lead['Business Telephone No.']} "
                      f"| Updated: {lead['Update Date'][:16]}")
                if save_to_supabase(lead, carrier):
                    stats["saved"] += 1
            elif res["status"] == "error":
                stats["error"] += 1
            else:
                stats["skip"] += 1

    # ── Save CSV ───────────────────────────────────────────────────────────
    FIELDS = [
        "USDOT Number", "Legal Business Name", "Business Telephone No.",
        "Business Email", "Program Status", "Program Exit Date", "Update Date"
    ]
    with open(OUTPUT_CSV, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(leads)
    print(f"\n[+] Saved {len(leads)} leads to {OUTPUT_CSV}")

    print("\n" + "=" * 65)
    print("FINAL SUMMARY")
    print("=" * 65)
    print(f"  Target Date:      {target_date}")
    print(f"  Qualified leads:  {stats['leads']}")
    print(f"  Saved to DB:      {stats['saved']}")
    print(f"  Skipped:          {stats['skip']:,}")
    print(f"  Errors:           {stats['error']:,}")


if __name__ == "__main__":
    main()
