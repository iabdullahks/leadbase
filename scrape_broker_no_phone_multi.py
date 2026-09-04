#!/usr/bin/env python3
"""
MOTUS Broker Leads Scraper (Multi-Query) — Active DOT + Active MC + No Phone Number
====================================================================================
Searches multiple broker-related terms (e.g. BROKER, LOGISTICS, FREIGHT, DISPATCH, FORWARDING)
to build a large pool of unique candidate USDOTs, then filters for:
  1. DOT Status = Active + Out of Service = No
  2. Have an MC (Operating Authority) with status = Active
  3. Have NO phone number on file

Target: 100 leads.
Output: broker_no_phone_leads.csv (written incrementally)
"""

import os
import csv
import sys
import json
import time
import urllib.request
import urllib.error
import urllib.parse
import threading
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor, as_completed
from dotenv import load_dotenv

load_dotenv()

# ── Config ────────────────────────────────────────────────────────────────────
SEARCH_QUERIES   = ["BROKERS", "LOGISTIC", "SHIPPERS", "SHIPPER", "EXPRESS", "LINE", "COURIERS", "DELIVERIES", "LOGISTICAL", "BROKERAGE SERVICE", "FREIGHT SYSTEM"]
LIMIT            = 50                          # API page size
OUTPUT_CSV       = "broker_no_phone_leads.csv"
MAX_PAGE_WORKERS = 15                          # Parallel page fetchers (increased to speed up gathering)
MAX_WORKERS      = 15                          # Parallel detail fetchers to prevent rate limits/timeouts
TARGET_LEADS     = 100                         # How many leads to collect
MAX_PAGES_CAP    = 400                         # Max pages to fetch per query to avoid timeouts




HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept":     "application/json",
    "Referer":    "https://motus.dot.gov/search",
    "Origin":     "https://motus.dot.gov",
}

FIELDS = [
    "USDOT Number", "MC Number", "MC Status",
    "Legal Business Name", "DBA Name",
    "Business Telephone No.", "Business Email", "Address",
    "DOT Status", "Out of Service", "Update Date", "Create Date", "Profile URL",
]

# Threading lock for thread-safe incremental CSV writing
csv_lock = threading.Lock()

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
def fetch_page(query, skip, retries=3):
    url = (
        f"https://motus.dot.gov/api/carriers/search"
        f"?query={urllib.parse.quote(query)}"
        f"&skip={skip}&limit={LIMIT}"
    )
    for attempt in range(retries):
        r = api_get(url)
        if "_error" not in r:
            return r.get("data", []), r.get("total", 0)
        time.sleep(1.5 * (attempt + 1))
    return [], 0

def fetch_carrier_detail(dot_number):
    return api_get(f"https://motus.dot.gov/api/carriers/{dot_number}")

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

def get_dba_name(carrier):
    for n in (carrier.get("entityNames") or []):
        if n.get("nameType") == "DBA":
            return (n.get("entityName") or "").strip()
    return ""

def get_dot_number(carrier):
    dot = carrier.get("entityDotNumber") or {}
    return str(dot.get("dotNumber") or carrier.get("entityId") or "")

def get_address(carrier):
    addr = carrier.get("locations") or carrier.get("addresses") or []
    for a in addr:
        parts = [
            a.get("addressLine1") or a.get("address1") or "",
            a.get("addressLine2") or "",
            a.get("city") or "",
            a.get("state") or "",
            a.get("zipCode") or a.get("zip") or "",
        ]
        line = ", ".join(p for p in parts if p)
        if line:
            return line
    return ""

def get_mc_info(carrier):
    """
    Scans entityRegistrations for any Broker Operating Authority (MC number).
    Returns (mc_number, mc_status) for the FIRST Active broker authority found.
    If none are Active, returns (mc_number_of_any, status_of_any) or ("", "").

    MC Status values observed: 'Active', 'Inactive', 'Revoked', 'Suspended'
    Active MC = operatingAuthorityStatusName == 'Active'
    """
    best_mc = ""
    best_status = ""
    for reg in (carrier.get("entityRegistrations") or []):
        for oa_entry in (reg.get("entityRegistrationOperatingAuthorities") or []):
            oa = oa_entry.get("entityOperatingAuthority") or {}
            mc_number = (oa.get("docketNumber") or "").strip()
            status_obj = oa.get("operatingAuthorityStatus") or {}
            mc_status = (status_obj.get("operatingAuthorityStatusName") or "").strip()
            
            # Check operating authority type to make sure it is a Broker
            type_obj = oa.get("operatingAuthorityType") or {}
            mc_type = (type_obj.get("operatingAuthorityType") or "").strip()
            is_broker = "broker" in mc_type.lower()
            
            if mc_number and is_broker:
                if mc_status.lower() == "active":
                    return mc_number, mc_status   # found active broker — return immediately
                if not best_mc:                   # keep first non-active as fallback
                    best_mc, best_status = mc_number, mc_status
    return best_mc, best_status

# ── Candidate Processor ───────────────────────────────────────────────────────
def process_candidate(cand):
    dot = cand["dot"]
    try:
        carrier = fetch_carrier_detail(dot)
        if not carrier or "_error" in carrier:
            return {"dot": dot, "status": "error", "reason": "API error"}

        # 1. DOT Status check: must be Active and not Out of Service
        status = get_dot_status(carrier)
        if status.lower() != "active":
            return {"dot": dot, "status": "skip", "reason": f"DOT Not Active ({status})"}
        if carrier.get("outOfService") is True:
            return {"dot": dot, "status": "skip", "reason": "Out of Service"}

        # 2. MC Status check: must have at least one Active MC / Operating Authority
        mc_number, mc_status = get_mc_info(carrier)
        if not mc_number:
            return {"dot": dot, "status": "skip", "reason": "No MC number on file"}
        if mc_status.lower() != "active":
            return {"dot": dot, "status": "skip", "reason": f"MC not Active ({mc_status}) — {mc_number}"}

        # 3. Phone check: must have NO phone number (key filter for this script)
        phone = get_phone(carrier)
        if phone:
            return {"dot": dot, "status": "skip", "reason": "Has phone (not our target)"}

        # 4. Build lead record
        legal_name = get_legal_name(carrier)
        dba_name   = get_dba_name(carrier)
        email      = get_email(carrier)
        address    = get_address(carrier)

        lead = {
            "USDOT Number":           dot,
            "MC Number":              mc_number,
            "MC Status":              mc_status,
            "Legal Business Name":    legal_name,
            "DBA Name":               dba_name,
            "Business Telephone No.": "",       # blank — no phone on file
            "Business Email":         email,
            "Address":                address,
            "DOT Status":             "Active",
            "Out of Service":         "False",
            "Update Date":            carrier.get("updateDate") or carrier.get("createDate") or "",
            "Create Date":            carrier.get("createDate") or "",
            "Profile URL":            f"https://motus.dot.gov/customer/{dot}/account",
        }
        return {"dot": dot, "status": "lead", "lead": lead}

    except Exception as e:
        return {"dot": dot, "status": "error", "reason": str(e)[:80]}

def append_lead_to_csv(lead):
    """Appends a single lead to the CSV file in a thread-safe manner."""
    with csv_lock:
        with open(OUTPUT_CSV, "a", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=FIELDS, extrasaction="ignore")
            writer.writerow(lead)

# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    global SEARCH_QUERIES, TARGET_LEADS, OUTPUT_CSV

    if len(sys.argv) >= 2:
        try:
            TARGET_LEADS = int(sys.argv[1])
        except ValueError:
            if "," in sys.argv[1]:
                SEARCH_QUERIES = [q.strip() for q in sys.argv[1].split(",")]
            else:
                SEARCH_QUERIES = [sys.argv[1]]
    if len(sys.argv) >= 3:
        try:
            TARGET_LEADS = int(sys.argv[2])
        except ValueError:
            pass
    if len(sys.argv) >= 4:
        OUTPUT_CSV = sys.argv[3]

    if hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8")
        except Exception:
            pass

    print("=" * 70, flush=True)
    print("MOTUS Multi-Query Broker Leads Scraper — DOT/MC Active, No Phone", flush=True)
    print(f"Queries: {SEARCH_QUERIES} | Target: {TARGET_LEADS} leads | Output: {OUTPUT_CSV}", flush=True)
    print(f"Page size: {LIMIT} | Page workers: {MAX_PAGE_WORKERS} | Detail workers: {MAX_WORKERS}", flush=True)
    print("Filters: DOT Active + Not OOS + MC Status = Active + No Phone Number", flush=True)
    print("=" * 70, flush=True)

    seen_dots  = set()
    candidates = []
    existing_leads = []

    # Read existing leads if CSV exists
    if os.path.exists(OUTPUT_CSV):
        try:
            with open(OUTPUT_CSV, "r", encoding="utf-8") as f:
                reader = csv.DictReader(f)
                for row in reader:
                    dot = str(row.get("USDOT Number") or "").strip()
                    if dot:
                        seen_dots.add(dot)
                        existing_leads.append(row)
            print(f"[*] Loaded {len(existing_leads)} existing leads from '{OUTPUT_CSV}'", flush=True)
        except Exception as ex:
            print(f"[!] Warning: Could not read existing leads: {ex}", flush=True)

    # ── Phase 1: Collect candidates for all queries ─────────────────────────
    for q in SEARCH_QUERIES:
        print(f"\n[Phase 1] Fetching candidates for query '{q}'...", flush=True)
        first_page, total_records = fetch_page(q, 0)
        if total_records == 0:
            print(f"  [-] No records found for '{q}'. Skipping.", flush=True)
            continue

        print(f"  Total matching '{q}': {total_records:,}", flush=True)
        total_pages = (total_records + LIMIT - 1) // LIMIT

        if total_pages > MAX_PAGES_CAP:
            print(f"  [Info] Capping at {MAX_PAGES_CAP} pages to optimize speed.", flush=True)
            total_pages = MAX_PAGES_CAP
            total_records = total_pages * LIMIT

        # Add first page candidates
        q_added = 0
        for rec in first_page:
            dot = str(rec.get("dotNumber") or "").strip()
            if dot and dot not in seen_dots:
                seen_dots.add(dot)
                candidates.append({
                    "dot":       dot,
                    "entity_id": rec.get("entityId", ""),
                    "name":      rec.get("entityName", ""),
                })
                q_added += 1

        # Fetch remaining pages for this query
        skips = list(range(LIMIT, total_records, LIMIT))
        if skips:
            print(f"  Fetching remaining {len(skips)} pages in parallel...", flush=True)
            pages_done = 1

            with ThreadPoolExecutor(max_workers=MAX_PAGE_WORKERS) as executor:
                futures = {executor.submit(fetch_page, q, skip): skip for skip in skips}
                for future in as_completed(futures):
                    results, _ = future.result()
                    pages_done += 1

                    if pages_done % 50 == 0 or pages_done == total_pages:
                        print(f"    Query '{q}' progress: {pages_done}/{total_pages} pages | Unique candidates: {len(candidates):,}", flush=True)

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
                        q_added += 1
        print(f"  [+] Added {q_added} unique candidates from query '{q}'", flush=True)

    # Sort by USDOT descending (most recent registrations first)
    print(f"\nSorting {len(candidates):,} total candidates by USDOT (newest first)...", flush=True)
    valid = []
    for c in candidates:
        try:
            valid.append((int(c["dot"]), c))
        except ValueError:
            continue
    valid.sort(key=lambda x: x[0], reverse=True)
    candidates = [x[1] for x in valid]

    if candidates:
        print(f"Newest candidate: USDOT {candidates[0]['dot']} — {candidates[0]['name']}", flush=True)

    # ── Phase 2: Fetch details and filter ────────────────────────────────
    print(f"\n[Phase 2] Checking {len(candidates):,} candidates with {MAX_WORKERS} threads...", flush=True)
    print(f"  Filters: DOT Active + Not OOS + MC Status=Active + No Phone Number\n", flush=True)

    # If the file does not exist, or has no header/leads, initialize it
    if len(existing_leads) == 0:
        with open(OUTPUT_CSV, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=FIELDS, extrasaction="ignore")
            writer.writeheader()

    leads      = list(existing_leads)
    stats      = {"total": 0, "leads": len(existing_leads), "skip": 0, "error": 0}
    target_hit = False

    if len(leads) >= TARGET_LEADS:
        print(f"[!] Target of {TARGET_LEADS} leads already reached from loaded file. Stopping.", flush=True)
        return

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {executor.submit(process_candidate, c): c for c in candidates}
        for future in as_completed(futures):
            if target_hit:
                future.cancel()
                continue

            stats["total"] += 1
            res = future.result()

            if stats["total"] % 100 == 0 or stats["total"] == len(candidates):
                pct = stats["total"] / len(candidates) * 100
                print(
                    f"    Checked {stats['total']:,}/{len(candidates):,} ({pct:.1f}%) | "
                    f"Leads: {stats['leads']} | Skipped: {stats['skip']} | Errors: {stats['error']}",
                    flush=True,
                )

            if res["status"] == "lead":
                stats["leads"] += 1
                leads.append(res["lead"])
                lead = res["lead"]
                print(
                    f"  [{stats['leads']:4d}] [LEAD] USDOT {lead['USDOT Number']} | "
                    f"{lead['MC Number']:12s} | "
                    f"{lead['Legal Business Name'][:30]:30s} | "
                    f"Email: {lead['Business Email'] or '(none)'}",
                    flush=True,
                )
                
                # Write to CSV in real-time
                append_lead_to_csv(lead)

                if stats["leads"] >= TARGET_LEADS:
                    print(f"\n[!] Target of {TARGET_LEADS} leads reached! Stopping.", flush=True)
                    target_hit = True

            elif res["status"] == "error":
                stats["error"] += 1
            else:
                stats["skip"] += 1

    print(f"\n[+] Saved {len(leads)} broker leads (Active MC, no phone) to '{OUTPUT_CSV}'", flush=True)
    print("\n" + "=" * 70, flush=True)
    print("FINAL SUMMARY", flush=True)
    print("=" * 70, flush=True)
    print(f"  Total Candidates Checked:     {stats['total']:,}")
    print(f"  Leads (Active DOT+MC, no ph): {len(leads):,}")
    print(f"  Skipped (no MC/phone/status): {stats['skip']:,}")
    print(f"  Errors:                       {stats['error']:,}")
    print(f"  Output File:                  {OUTPUT_CSV}")
    print("=" * 70, flush=True)


if __name__ == "__main__":
    main()
