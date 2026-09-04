#!/usr/bin/env python3
"""
MOTUS LLC Fresh-Exit Scraper — Full Database Scan via skip/limit Pagination
============================================================================
Uses skip/limit pagination to iterate through ALL 68k+ LLC carriers in MOTUS.
For each carrier, checks the registration matrix for a recent Program Exit Date.

Filters applied:
1. Carrier Status = Active + Out of Service = No
2. Program Exit Date present (any exit status accepted)
3. Program Exit Date within last DAYS_BACK days
4. Valid non-blank Business Telephone No.

Output:
  leads_output.csv     — Qualified leads (exit within 30 days)
  potential_leads.csv  — Active carriers with any exit date (sorted newest first)
"""

import os
import csv
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
START_DATE       = "2026-07-03"    # Check new exits since last scrape
SEARCH_QUERY     = "LLC"           # Covers all 68k LLC carriers in MOTUS
LIMIT            = 50              # Records per page (API hard max)
RATE_LIMIT_DELAY = 0.15            # Seconds between paginated search requests
OUTPUT_CSV       = "leads_output.csv"
POTENTIAL_CSV    = "potential_leads.csv"
MAX_WORKERS      = 25              # Parallel detail fetchers
MAX_PAGES        = None            # None = scan all 68k carriers

CUTOFF_DATE = datetime.fromisoformat(START_DATE).replace(tzinfo=timezone.utc)
since_str   = START_DATE

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

# ── Date helpers ──────────────────────────────────────────────────────────────
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

def is_recent(date_str):
    dt = parse_iso(date_str)
    if not dt:
        return False
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt >= CUTOFF_DATE

def days_since(date_str):
    dt = parse_iso(date_str)
    if not dt:
        return 0
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - dt).days

# ── MOTUS API Calls ───────────────────────────────────────────────────────────
def fetch_page(skip):
    """Fetch one page of LLC carriers using skip/limit pagination."""
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

# ── Filter & Lead Logic ───────────────────────────────────────────────────────
def get_dot_status(carrier):
    dn = carrier.get("entityDotNumber") or {}
    st = dn.get("dotNumberStatus") or {}
    return (st.get("dotNumberStatus") or st.get("status") or "").strip()

def extract_exit_info(matrix):
    """Return (exit_date, program_status) from registration matrix, or (None, None)."""
    for ne in (matrix.get("entityNewEntrant") or []):
        ed = ne.get("exitedDate")
        if ed:
            st_obj = ne.get("entityNewEntrantStatus") or {}
            ps = (st_obj.get("entityNewEntrantStatusName") or "").strip()
            return ed, ps
    return None, None

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

def build_lead(carrier, exit_date, program_status):
    return {
        "USDOT Number":             get_dot_number(carrier),
        "Legal Business Name":      get_legal_name(carrier),
        "Business Telephone No.":   get_phone(carrier),
        "Business Email":           get_email(carrier),
        "Program Status":           program_status or "",
        "Program Exit Date":        exit_date,
    }

def build_potential(carrier, exit_date, program_status, filter_reason):
    return {
        "USDOT Number":             get_dot_number(carrier),
        "Legal Business Name":      get_legal_name(carrier),
        "Business Telephone No.":   get_phone(carrier),
        "Business Email":           get_email(carrier),
        "Program Status":           program_status or "",
        "Program Exit Date":        exit_date,
        "Days Since Exit":          str(days_since(exit_date)),
        "Filter Reason":            filter_reason,
    }

# ── Candidate Processor ───────────────────────────────────────────────────────
def process_candidate(cand):
    dot = cand["dot"]
    try:
        carrier = fetch_carrier_detail(dot)
        if not carrier or "_error" in carrier:
            return {"dot": dot, "status": "error", "reason": "API error"}

        entity_id = carrier.get("entityId")
        if not entity_id:
            return {"dot": dot, "status": "error", "reason": "no entityId"}

        # Filter 1: Active + OOS = No
        status = get_dot_status(carrier)
        if status.lower() != "active":
            return {"dot": dot, "status": "skip", "reason": f"Not Active ({status})"}
        if carrier.get("outOfService") is True:
            return {"dot": dot, "status": "skip", "reason": "Out of Service"}

        matrix = fetch_matrix(entity_id)
        if not matrix:
            return {"dot": dot, "status": "error", "reason": "no matrix"}

        # Filter 2: Must have an exit date
        exit_date, program_status = extract_exit_info(matrix)
        if not exit_date:
            return {"dot": dot, "status": "skip", "reason": "No exit date"}

        # Filter 3: Exit date within last DAYS_BACK days
        if not is_recent(exit_date):
            # Collect as potential lead if Active + has exit date
            if get_phone(carrier):
                pl = build_potential(carrier, exit_date, program_status,
                                     f"Exit Date {exit_date[:10]} outside {DAYS_BACK}-day window")
                return {"dot": dot, "status": "potential", "potential_lead": pl}
            return {"dot": dot, "status": "skip",
                    "reason": f"Exit {exit_date[:10]} outside window (no phone)"}

        # Filter 4: Must have phone
        phone = get_phone(carrier)
        if not phone:
            pl = build_potential(carrier, exit_date, program_status, "Missing phone (recent exit)")
            return {"dot": dot, "status": "potential", "potential_lead": pl}

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
    print("=" * 65)
    print(f"MOTUS LLC Full-Database Date Scraper")
    print(f"Query: '{SEARCH_QUERY}' | Date window: {since_str} → today")
    print(f"Pagination: skip/limit={LIMIT} | Parallel workers: {MAX_WORKERS}")
    print("=" * 65)

    # ── Phase 1: Collect all LLC candidates via skip/limit ─────────────────
    print(f"\n[Phase 1] Paginating through all LLC carriers...")
    seen_dots = set()
    candidates = []
    skip = 0
    total_records = None

    while True:
        results, total = fetch_page(skip)
        if total_records is None and total:
            total_records = total
            total_pages = (total + LIMIT - 1) // LIMIT
            print(f"  Total LLC carriers in MOTUS: {total:,} | Pages to scan: {total_pages:,}")

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
        if MAX_PAGES and current_page >= MAX_PAGES:
            print(f"  [!] MAX_PAGES={MAX_PAGES} limit reached.")
            break

        time.sleep(RATE_LIMIT_DELAY)

    print(f"\nTotal unique candidates collected: {len(candidates):,}")

    # ── Phase 2: Parallel detail fetch + filter ────────────────────────────
    print(f"\n[Phase 2] Checking {len(candidates):,} carriers in parallel "
          f"({MAX_WORKERS} workers)...")

    leads          = []
    potential_leads = []
    stats = {"total": 0, "leads": 0, "potential": 0, "saved": 0,
             "skip": 0, "error": 0}

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {executor.submit(process_candidate, c): c for c in candidates}
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
                      f"| {lead['Program Status'][:18]:18s} "
                      f"| Exit: {lead['Program Exit Date'][:10]} "
                      f"| {lead['Business Telephone No.']}")
                if save_to_supabase(lead, carrier):
                    stats["saved"] += 1

            elif res["status"] == "potential":
                stats["potential"] += 1
                pl = res["potential_lead"]
                potential_leads.append(pl)
                print(f"  {tag} 🔶 {pl['Legal Business Name'][:30]:30s} "
                      f"| Exit: {pl['Program Exit Date'][:10]} "
                      f"({pl['Days Since Exit']}d ago)")

            elif res["status"] == "error":
                stats["error"] += 1
            else:
                stats["skip"] += 1

    # ── Save leads_output.csv ──────────────────────────────────────────────
    LEAD_FIELDS = [
        "USDOT Number", "Legal Business Name", "Business Telephone No.",
        "Business Email", "Program Status", "Program Exit Date",
    ]
    with open(OUTPUT_CSV, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=LEAD_FIELDS)
        writer.writeheader()
        writer.writerows(leads)
    print(f"\n[+] Saved {len(leads)} QUALIFIED leads  -> {OUTPUT_CSV}")

    # ── Save potential_leads.csv ───────────────────────────────────────────
    POT_FIELDS = [
        "USDOT Number", "Legal Business Name", "Business Telephone No.",
        "Business Email", "Program Status", "Program Exit Date",
        "Days Since Exit", "Filter Reason",
    ]
    potential_leads.sort(key=lambda x: x.get("Program Exit Date", ""), reverse=True)
    with open(POTENTIAL_CSV, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=POT_FIELDS)
        writer.writeheader()
        writer.writerows(potential_leads)
    print(f"[+] Saved {len(potential_leads)} POTENTIAL leads -> {POTENTIAL_CSV}")

    # ── Summary ────────────────────────────────────────────────────────────
    print("\n" + "=" * 65)
    print("FINAL SUMMARY")
    print("=" * 65)
    print(f"  LLC carriers in MOTUS:    {total_records or len(candidates):,}")
    print(f"  Candidates checked:       {stats['total']:,}")
    print(f"  ✅ Qualified leads:        {stats['leads']} -> {OUTPUT_CSV}")
    print(f"  🔶 Potential leads:        {stats['potential']} -> {POTENTIAL_CSV}")
    print(f"  Saved to Supabase:        {stats['saved']}")
    print(f"  Skipped (no exit/inactive): {stats['skip']:,}")
    print(f"  Errors:                   {stats['error']:,}")
    print()
    print("  Output files:")
    print(f"    Qualified:  {OUTPUT_CSV}")
    print(f"    Potential:  {POTENTIAL_CSV}")


if __name__ == "__main__":
    main()
