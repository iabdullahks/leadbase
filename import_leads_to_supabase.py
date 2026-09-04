#!/usr/bin/env python3
"""
Import all scraped CSV leads into Supabase carriers table.
============================================================================
Reads all 4 batch CSV files and upserts each record directly into Supabase.
Uses the service role key. Skips duplicates via ON CONFLICT on usdot_number.

CSV columns:
  USDOT Number, Legal Business Name, Business Telephone No., Business Email,
  DOT Status, Out of Service, Update Date, Create Date

Usage:
  python -u import_leads_to_supabase.py
"""

import csv
import os
import sys
import time
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor, as_completed

from dotenv import load_dotenv
load_dotenv()

# ── Config ────────────────────────────────────────────────────────────────────
CSV_FILES = [
    "carriers_above_4582560.csv",
    "leads_10k_from_5252763.csv",
    "leads_10k_from_7121547.csv",
    "leads_10k_from_8961478.csv",
]
MAX_WORKERS   = 10    # Parallel upsert threads (keep low to avoid rate limits)
BATCH_SIZE    = 100   # Rows per Supabase upsert call

# ── Supabase client ───────────────────────────────────────────────────────────
def get_client():
    url = os.getenv("SUPABASE_URL", "").strip()
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    if not url or not key:
        print("[!] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env")
        sys.exit(1)
    from supabase import create_client
    client = create_client(url, key)
    print("[OK] Connected to Supabase: {}".format(url), flush=True)
    return client

# ── Helpers ───────────────────────────────────────────────────────────────────
def parse_bool(val):
    if isinstance(val, bool):
        return val
    return str(val).strip().lower() in ("true", "1", "yes")

def parse_dt(val):
    """Return ISO string with tz, or None."""
    if not val or not str(val).strip():
        return None
    s = str(val).strip()
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.isoformat()
    except Exception:
        return None

def csv_row_to_db(row):
    """Map flat CSV row → carriers table dict."""
    usdot = str(row.get("USDOT Number") or "").strip()
    if not usdot:
        return None

    create_date = parse_dt(row.get("Create Date") or row.get("Update Date"))
    update_date = parse_dt(row.get("Update Date") or row.get("Create Date"))
    now_iso     = datetime.now(timezone.utc).isoformat()

    return {
        "usdot_number":       usdot,
        "legal_name":         (row.get("Legal Business Name") or "").strip(),
        "phone":              (row.get("Business Telephone No.") or "").strip(),
        "email":              (row.get("Business Email") or "").strip(),
        "carrier_status":     (row.get("DOT Status") or "Active").strip(),
        "out_of_service":     parse_bool(row.get("Out of Service") or False),
        "added_to_motus":     create_date,
        "motus_entry_date":   create_date,
        "motus_last_updated": update_date,
        "scraped_at":         now_iso,
        "profile_url":        "https://motus.dot.gov/customer/{}/account".format(usdot),
        # Optional fields left as empty/null
        "dba_name":           "",
        "principal_address":  "",
        "mailing_address":    "",
        "duns":               "",
        "form_of_business":   "",
        "state_incorporated": "",
        "new_entrant_status": "",
        "raw_data":           {
            "source": "csv_import",
            "usdot_number": usdot,
            "business_information": {
                "Legal Business Name":    (row.get("Legal Business Name") or "").strip(),
                "Business Telephone No.": (row.get("Business Telephone No.") or "").strip(),
                "Business Email":         (row.get("Business Email") or "").strip(),
            }
        },
    }

# ── Load all CSV files ────────────────────────────────────────────────────────
def load_all_records():
    records = {}  # keyed by usdot_number to deduplicate
    for csv_file in CSV_FILES:
        if not os.path.exists(csv_file):
            print("[!] File not found, skipping: {}".format(csv_file), flush=True)
            continue
        count = 0
        with open(csv_file, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                rec = csv_row_to_db(row)
                if rec and rec["usdot_number"] not in records:
                    records[rec["usdot_number"]] = rec
                    count += 1
        print("[+] Loaded {:,} records from {}".format(count, csv_file), flush=True)
    return list(records.values())

# ── Batch upsert ──────────────────────────────────────────────────────────────
def upsert_batch(client, batch, batch_num):
    """Upsert a batch of rows. Returns (success_count, failed_count)."""
    for attempt in range(3):
        try:
            client.table("carriers").upsert(
                batch,
                on_conflict="usdot_number"
            ).execute()
            return len(batch), 0
        except Exception as e:
            if attempt < 2:
                time.sleep(2 * (attempt + 1))
            else:
                print("  [ERR] Batch {} failed: {}".format(batch_num, str(e)[:120]), flush=True)
                return 0, len(batch)
    return 0, len(batch)

# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    if hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8")
        except Exception:
            pass

    sep = "=" * 65
    print(sep, flush=True)
    print("SUPABASE CSV IMPORTER - All Scraped Leads", flush=True)
    print(sep, flush=True)

    client = get_client()

    # Current DB count
    try:
        existing = client.table("carriers").select("usdot_number", count="exact").execute()
        print("[*] Current carriers in DB: {:,}".format(existing.count or 0), flush=True)
    except Exception as e:
        print("[!] Could not fetch count: {}".format(e), flush=True)

    # Load all records
    print("\n[1] Loading CSV files...", flush=True)
    records = load_all_records()
    print("[*] Total unique records to import: {:,}".format(len(records)), flush=True)

    if not records:
        print("[!] No records found. Exiting.")
        return

    # Split into batches
    batches = [records[i:i + BATCH_SIZE] for i in range(0, len(records), BATCH_SIZE)]
    print("\n[2] Upserting {:,} records in {:,} batches of {} (workers={})...".format(
        len(records), len(batches), BATCH_SIZE, MAX_WORKERS
    ), flush=True)

    start_time  = time.time()
    total_ok    = 0
    total_fail  = 0
    done_batches = 0

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {
            executor.submit(upsert_batch, client, batch, i): i
            for i, batch in enumerate(batches)
        }
        for future in as_completed(futures):
            ok, fail = future.result()
            total_ok   += ok
            total_fail += fail
            done_batches += 1

            if done_batches % 10 == 0 or done_batches == len(batches):
                elapsed = time.time() - start_time
                rate    = total_ok / max(elapsed, 1)
                pct     = done_batches / len(batches) * 100
                print("  Progress: {}/{} batches ({:.1f}%) | Inserted: {:,} | Failed: {:,} | Rate: {:.0f}/s".format(
                    done_batches, len(batches), pct, total_ok, total_fail, rate
                ), flush=True)

    elapsed = time.time() - start_time

    # Final count
    try:
        final = client.table("carriers").select("usdot_number", count="exact").execute()
        final_count = final.count or 0
    except Exception:
        final_count = "N/A"

    print("\n" + sep, flush=True)
    print("FINAL SUMMARY", flush=True)
    print(sep, flush=True)
    print("  Records processed : {:,}".format(len(records)))
    print("  Successfully upserted: {:,}".format(total_ok))
    print("  Failed            : {:,}".format(total_fail))
    print("  Total time        : {:.1f}s ({:.1f} min)".format(elapsed, elapsed / 60))
    print("  Final DB count    : {}".format(final_count))
    print(sep, flush=True)


if __name__ == "__main__":
    main()
