#!/usr/bin/env python3
"""
scrape_all_missing.py
=====================
Scrapes ALL carriers added to MOTUS from MOTUS_DAY_ONE through yesterday,
skipping carriers already in Supabase (upsert handles dedup automatically).

Strategy:
  - Iterates every calendar date from 2026-05-16 to yesterday (UTC)
  - For each date, calls scrape_added_date logic inline (no subprocess)
  - Upserts each match directly to Supabase (duplicates auto-skipped)
  - Saves a per-day CSV in ./scrape_outputs/
  - Logs progress to scrape_all_missing.log

Run:
  python -u scrape_all_missing.py            # Full catch-up
  python -u scrape_all_missing.py 2026-08-01 # From a specific start date
"""

import os
import sys
import csv
import json
import time
import logging
import urllib.request
import urllib.error
import urllib.parse
from datetime import datetime, timedelta, timezone, date
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from dotenv import load_dotenv
load_dotenv("../.env")

# ── Config ────────────────────────────────────────────────────────────────────
MOTUS_DAY_ONE    = date(2026, 5, 16)
SEARCH_QUERY     = "LLC"
LIMIT            = 50
MAX_PAGE_WORKERS = 20    # Parallel page fetchers
MAX_WORKERS      = 60    # Parallel detail fetchers per date
OUTPUT_DIR       = Path("scrape_outputs")
LOG_FILE         = "scrape_all_missing.log"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept":     "application/json",
    "Referer":    "https://motus.dot.gov/search",
    "Origin":     "https://motus.dot.gov",
}

# ── Logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(LOG_FILE, encoding="utf-8"),
    ],
)
log = logging.getLogger(__name__)

# ── HTTP Helper ───────────────────────────────────────────────────────────────
def api_get(url, timeout=15, retries=3):
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return json.loads(resp.read().decode())
        except urllib.error.HTTPError as e:
            if e.code == 429:
                time.sleep(2 * (attempt + 1))
            else:
                return {"_error": e.code}
        except Exception as ex:
            if attempt < retries - 1:
                time.sleep(1)
            else:
                return {"_error": str(ex)[:80]}
    return {"_error": "max_retries"}

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

# ── MOTUS API ─────────────────────────────────────────────────────────────────
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

# ── Field extractors ──────────────────────────────────────────────────────────
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

# ── Process one candidate ─────────────────────────────────────────────────────
def process_candidate(cand, target_date):
    dot = cand["dot"]
    try:
        carrier = fetch_carrier_detail(dot)
        if not carrier or "_error" in carrier:
            return {"dot": dot, "status": "error"}

        created_str = carrier.get("createDate") or ""
        created_dt = parse_iso(created_str)
        if not created_dt or created_dt.date() != target_date:
            return {"dot": dot, "status": "skip"}

        entity_id = carrier.get("entityId")
        exit_date, program_status = "", ""
        if entity_id:
            matrix = fetch_matrix(entity_id)
            if matrix:
                exit_date, program_status = extract_exit_info(matrix)

        lead = {
            "USDOT Number":           get_dot_number(carrier),
            "Legal Business Name":    get_legal_name(carrier),
            "Business Telephone No.": get_phone(carrier),
            "Business Email":         get_email(carrier),
            "Program Status":         program_status,
            "Program Exit Date":      exit_date,
            "Update Date":            carrier.get("updateDate") or carrier.get("createDate") or "",
            "Create Date":            carrier.get("createDate") or "",
        }
        return {"dot": dot, "status": "match", "lead": lead, "carrier": carrier}
    except Exception as e:
        return {"dot": dot, "status": "error", "reason": str(e)[:80]}

# ── Supabase upsert ───────────────────────────────────────────────────────────
def save_to_supabase(lead, carrier_detail):
    try:
        from supabase_db import upsert_carrier, is_enabled
        if not is_enabled():
            return False
        record = {
            "usdot_number":   lead["USDOT Number"],
            "legal_name":     lead["Legal Business Name"],
            "phone":          lead["Business Telephone No."],
            "email":          lead["Business Email"],
            "carrier_status": get_dot_status(carrier_detail) or "Active",
            "motus_entry_date": carrier_detail.get("createDate"),
            "scraped_at":     datetime.now(timezone.utc).isoformat(),
            "data": {
                "usdot_number":         lead["USDOT Number"],
                "profile_url":          f"https://motus.dot.gov/customer/{lead['USDOT Number']}/account",
                "added_to_motus":       carrier_detail.get("createDate"),
                "motus_last_updated":   carrier_detail.get("updateDate"),
                "carrier_status":       get_dot_status(carrier_detail) or "Active",
                "out_of_service":       carrier_detail.get("outOfService") or False,
                "business_information": {
                    "Legal Business Name":    lead["Legal Business Name"],
                    "Business Telephone No.": lead["Business Telephone No."],
                    "Business Email":         lead["Business Email"],
                },
                "new_entrant_program": {
                    "Program Status":    lead.get("Program Status", ""),
                    "Program Exit Date": lead["Program Exit Date"],
                },
                "company_officials":    [],
                "cargo_classification": [],
                "vehicles":             [],
                "drivers":              [],
            }
        }
        return upsert_carrier(record, change_type="new")
    except Exception as ex:
        log.warning(f"  [supabase error] {ex}")
        return False

# ── Scrape one date ───────────────────────────────────────────────────────────
def scrape_date(target_date):
    log.info(f"{'='*60}")
    log.info(f"DATE: {target_date}")

    # Fetch first page to get total
    first_page, total_records = fetch_page(0)
    if total_records == 0:
        log.warning(f"  No records found for date check, skipping.")
        return 0, 0

    log.info(f"  Total LLCs in MOTUS: {total_records:,} — fetching all pages...")

    seen_dots = set()
    candidates = []

    for rec in first_page:
        dot = str(rec.get("dotNumber") or "").strip()
        if dot:
            seen_dots.add(dot)
            candidates.append({"dot": dot, "entity_id": rec.get("entityId", ""), "name": rec.get("entityName", "")})

    skips = list(range(LIMIT, total_records, LIMIT))
    with ThreadPoolExecutor(max_workers=MAX_PAGE_WORKERS) as executor:
        futures = {executor.submit(fetch_page, skip): skip for skip in skips}
        for future in as_completed(futures):
            results, _ = future.result()
            for rec in results:
                dot = str(rec.get("dotNumber") or "").strip()
                if dot and dot not in seen_dots:
                    seen_dots.add(dot)
                    candidates.append({"dot": dot, "entity_id": rec.get("entityId", ""), "name": rec.get("entityName", "")})

    log.info(f"  Candidates collected: {len(candidates):,} — now checking details...")

    matches = []
    saved = 0
    checked = 0

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {executor.submit(process_candidate, c, target_date): c for c in candidates}
        for future in as_completed(futures):
            checked += 1
            res = future.result()
            if res["status"] == "match":
                lead = res["lead"]
                carrier = res["carrier"]
                matches.append(lead)
                log.info(f"  [MATCH] {lead['Legal Business Name'][:35]:35s} | DOT:{lead['USDOT Number']} | Phone:{lead['Business Telephone No.']}")
                if save_to_supabase(lead, carrier):
                    saved += 1
            if checked % 2000 == 0:
                log.info(f"    ...checked {checked:,}/{len(candidates):,} ({checked/len(candidates)*100:.1f}%), {len(matches)} matches so far")

    # Save CSV
    if matches:
        OUTPUT_DIR.mkdir(exist_ok=True)
        csv_path = OUTPUT_DIR / f"added_{target_date.strftime('%Y_%m_%d')}.csv"
        FIELDS = ["USDOT Number", "Legal Business Name", "Business Telephone No.", "Business Email",
                  "Program Status", "Program Exit Date", "Update Date", "Create Date"]
        with open(csv_path, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=FIELDS)
            writer.writeheader()
            writer.writerows(matches)
        log.info(f"  CSV saved: {csv_path}")

    log.info(f"  DONE {target_date}: {len(matches)} matches, {saved} saved to Supabase")
    return len(matches), saved

# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    if hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8")
        except Exception:
            pass

    # Determine start date
    if len(sys.argv) >= 2:
        start_date = datetime.strptime(sys.argv[1], "%Y-%m-%d").date()
    else:
        start_date = MOTUS_DAY_ONE

    yesterday = (datetime.now(timezone.utc) - timedelta(days=1)).date()

    log.info("=" * 60)
    log.info("MOTUS Full Catch-Up Scraper")
    log.info(f"Date range: {start_date} → {yesterday}")
    log.info(f"Page workers: {MAX_PAGE_WORKERS} | Detail workers: {MAX_WORKERS}")
    log.info("=" * 60)

    total_days    = (yesterday - start_date).days + 1
    total_matches = 0
    total_saved   = 0

    current_date = start_date
    day_num = 0

    while current_date <= yesterday:
        day_num += 1
        log.info(f"\n[Day {day_num}/{total_days}] Processing {current_date} ...")

        try:
            matches, saved = scrape_date(current_date)
            total_matches += matches
            total_saved   += saved
        except KeyboardInterrupt:
            log.info("\n[!] Interrupted by user.")
            break
        except Exception as e:
            log.error(f"  ERROR on {current_date}: {e}")

        current_date += timedelta(days=1)
        # Small pause between dates to be respectful to the API
        time.sleep(0.5)

    log.info("\n" + "=" * 60)
    log.info("FINAL SUMMARY")
    log.info("=" * 60)
    log.info(f"  Dates processed: {day_num}")
    log.info(f"  Total matches:   {total_matches:,}")
    log.info(f"  Saved to DB:     {total_saved:,}")

if __name__ == "__main__":
    main()
