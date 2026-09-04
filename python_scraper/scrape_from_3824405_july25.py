#!/usr/bin/env python3
"""
MOTUS Scraper - Scrape from USDOT 3824405 (July 25, 2026 to Present Leads)
============================================================================
Checks USDOT numbers from 3,824,405 to 10,200,000.
Loads existing USDOTs from Supabase DB & local CSVs first to skip them.
Captures ONLY leads added on Motus between July 25th, 2026 and NOW.
Skips all leads added prior to July 25th, 2026.
Saves results to unadded_leads_from_3824405_july25.csv and upserts to Supabase.
"""

import csv
import os
import sys
import json
import time
import glob
import asyncio
import aiohttp
from datetime import datetime, timezone
from dotenv import load_dotenv

load_dotenv()

# ── Config ────────────────────────────────────────────────────────────────────
START_DOT    = 3824405
END_DOT      = 10200000
CHUNK_SIZE   = 10000        # Check in batches of 10,000
CONCURRENCY  = 400          # 400 async HTTP connections
OUTPUT_CSV   = "unadded_leads_from_3824405_july25.csv"
MIN_DATE_STR = "2026-07-25" # Added on Motus on or after July 25, 2026

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept":     "application/json",
    "Referer":    "https://motus.dot.gov/",
    "Origin":     "https://motus.dot.gov",
}

# ── Date Filter Helper ────────────────────────────────────────────────────────
def is_added_between_july25_and_now(carrier):
    create_date_str = carrier.get("createDate") or carrier.get("updateDate") or ""
    if not create_date_str:
        return False
    if len(create_date_str) >= 10:
        date_part = create_date_str[:10]
        return date_part >= MIN_DATE_STR
    return False

# ── Field Extractors ──────────────────────────────────────────────────────────
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

def get_dot_status(carrier):
    dn = carrier.get("entityDotNumber") or {}
    st = dn.get("dotNumberStatus") or {}
    return (st.get("dotNumberStatus") or st.get("status") or "").strip()

def get_dot_number(carrier):
    dot_obj = carrier.get("entityDotNumber") or {}
    return str(dot_obj.get("dotNumber") or carrier.get("entityId") or "")

def build_row(dot, carrier):
    return {
        "USDOT Number":           get_dot_number(carrier) or str(dot),
        "Legal Business Name":    get_legal_name(carrier),
        "Business Telephone No.": get_phone(carrier),
        "Business Email":         get_email(carrier),
        "DOT Status":             get_dot_status(carrier),
        "Out of Service":         str(carrier.get("outOfService", "")),
        "Update Date":            carrier.get("updateDate") or carrier.get("createDate") or "",
        "Create Date":            carrier.get("createDate") or "",
    }

def build_supabase_row(dot, carrier):
    create_date = carrier.get("createDate") or carrier.get("updateDate")
    update_date = carrier.get("updateDate") or carrier.get("createDate")
    now_iso = datetime.now(timezone.utc).isoformat()
    usdot = get_dot_number(carrier) or str(dot)
    return {
        "usdot_number":       usdot,
        "legal_name":         get_legal_name(carrier),
        "phone":              get_phone(carrier),
        "email":              get_email(carrier),
        "carrier_status":     get_dot_status(carrier) or "Active",
        "out_of_service":     bool(carrier.get("outOfService") or False),
        "added_to_motus":     create_date,
        "motus_entry_date":   create_date,
        "motus_last_updated": update_date,
        "scraped_at":         now_iso,
        "profile_url":        f"https://motus.dot.gov/customer/{usdot}/account",
        "dba_name":           "",
        "principal_address":  "",
        "mailing_address":    "",
        "duns":               "",
        "form_of_business":   "",
        "state_incorporated": "",
        "new_entrant_status": "",
        "raw_data":           carrier
    }

# ── Supabase & CSV Loader ─────────────────────────────────────────────────────
def get_existing_dots(client):
    print("[*] Fetching existing USDOTs from local CSVs & Supabase DB...", flush=True)
    existing_dots = set()

    # 1. Load from all CSV files in current directory
    for csv_path in glob.glob("*.csv"):
        try:
            with open(csv_path, "r", encoding="utf-8", errors="ignore") as f:
                reader = csv.reader(f)
                header = next(reader, None)
                if not header:
                    continue
                for row in reader:
                    if row and row[0].isdigit():
                        existing_dots.add(int(row[0]))
        except Exception:
            pass
    print(f"  Loaded {len(existing_dots):,} USDOTs from local CSV files.", flush=True)

    # 2. Load from Supabase DB with retries
    if client:
        page = 0
        page_size = 1000
        consecutive_errors = 0
        while consecutive_errors < 3:
            try:
                res = client.table("carriers").select("usdot_number").order("usdot_number").range(page * page_size, (page + 1) * page_size - 1).execute()
                if not res.data:
                    break
                for row in res.data:
                    val = row.get("usdot_number")
                    if val:
                        try:
                            existing_dots.add(int(val))
                        except ValueError:
                            pass
                page += 1
                consecutive_errors = 0
                if len(existing_dots) % 5000 == 0 or len(res.data) < page_size:
                    print(f"  Loaded {len(existing_dots):,} total USDOTs...", flush=True)
            except Exception as e:
                consecutive_errors += 1
                print(f"[!] Supabase DB load attempt {consecutive_errors}/3 failed ({e})...", flush=True)
                time.sleep(1)

    return existing_dots

# ── Async HTTP Worker ─────────────────────────────────────────────────────────
async def fetch_carrier_async(session, semaphore, dot, retries=3):
    url = f"https://motus.dot.gov/api/carriers/{dot}"
    async with semaphore:
        for attempt in range(retries):
            try:
                async with session.get(url, timeout=aiohttp.ClientTimeout(total=8)) as resp:
                    if resp.status in (400, 404):
                        return dot, None
                    if resp.status == 200:
                        data = await resp.json()
                        return dot, data
            except Exception:
                if attempt < retries - 1:
                    await asyncio.sleep(0.2 * (attempt + 1))
        return dot, None

# ── Main Async Runner ─────────────────────────────────────────────────────────
async def async_main():
    if hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8")
        except Exception:
            pass

    sep = "=" * 70
    print(sep, flush=True)
    print("MOTUS SCRAPER - LEADS ADDED JULY 25, 2026 TO NOW", flush=True)
    print(f"Start DOT      : {START_DOT:,}", flush=True)
    print(f"End DOT        : {END_DOT:,}", flush=True)
    print(f"Concurrency    : {CONCURRENCY} (Async TCP Connection Reuse)", flush=True)
    print(f"Added Cutoff   : >= {MIN_DATE_STR} (July 25, 2026)", flush=True)
    print(f"Output File    : {OUTPUT_CSV}", flush=True)
    print(sep, flush=True)

    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    client = None
    if url and key:
        try:
            from supabase import create_client
            client = create_client(url, key)
        except Exception as e:
            print(f"[!] Warning: Could not connect to Supabase DB ({e}). Running with local CSV deduplication.", flush=True)

    existing_dots = get_existing_dots(client)
    print(f"[+] Total skipped (already in DB/CSVs): {len(existing_dots):,}", flush=True)

    # Load existing DOTs from OUTPUT_CSV if it exists to avoid duplicate entries
    file_dots = 0
    if os.path.exists(OUTPUT_CSV):
        try:
            with open(OUTPUT_CSV, "r", encoding="utf-8") as f:
                reader = csv.DictReader(f)
                for row in reader:
                    dot_val = row.get("USDOT Number")
                    if dot_val:
                        try:
                            dot_int = int(dot_val)
                            if dot_int not in existing_dots:
                                existing_dots.add(dot_int)
                                file_dots += 1
                        except ValueError:
                            pass
            print(f"[+] Loaded {file_dots:,} unique DOTs from {OUTPUT_CSV} to skip", flush=True)
        except Exception as e:
            print(f"[!] Error reading {OUTPUT_CSV}: {e}", flush=True)

    FIELDS = [
        "USDOT Number", "Legal Business Name", "Business Telephone No.",
        "Business Email", "DOT Status", "Out of Service", "Update Date", "Create Date"
    ]

    file_exists = os.path.exists(OUTPUT_CSV)
    csvfile = open(OUTPUT_CSV, "a" if file_exists else "w", newline="", encoding="utf-8")
    writer = csv.DictWriter(csvfile, fieldnames=FIELDS, extrasaction="ignore")
    if not file_exists:
        writer.writeheader()
        csvfile.flush()

    chunk_start = START_DOT
    found_new = 0
    skipped_older = 0
    probed_count = 0
    start_time = time.time()

    semaphore = asyncio.Semaphore(CONCURRENCY)
    connector = aiohttp.TCPConnector(limit=CONCURRENCY + 50, ttl_dns_cache=300)

    async with aiohttp.ClientSession(headers=HEADERS, connector=connector) as session:
        while chunk_start <= END_DOT:
            chunk_end = min(chunk_start + CHUNK_SIZE - 1, END_DOT)
            dots_to_probe = [dot for dot in range(chunk_start, chunk_end + 1) if dot not in existing_dots]

            if not dots_to_probe:
                chunk_start = chunk_end + 1
                continue

            elapsed = time.time() - start_time
            rate = probed_count / max(elapsed / 60, 0.01) if probed_count > 0 else 0
            print(
                f"\n[Chunk] USDOT {chunk_start:,} to {chunk_end:,} | "
                f"Probing {len(dots_to_probe):,} unchecked | "
                f"Captured (>= July 25): {found_new} | Skipped Older: {skipped_older} | "
                f"Speed: {rate:,.0f} DOTs/min | Elapsed: {elapsed:.0f}s",
                flush=True,
            )

            tasks = [fetch_carrier_async(session, semaphore, dot) for dot in dots_to_probe]
            for future in asyncio.as_completed(tasks):
                dot, carrier = await future
                probed_count += 1

                if carrier:
                    existing_dots.add(dot)
                    if is_added_between_july25_and_now(carrier):
                        found_new += 1
                        row = build_row(dot, carrier)
                        writer.writerow(row)
                        csvfile.flush()

                        name_str = row["Legal Business Name"][:38]
                        create_dt = row["Create Date"][:10]
                        print(f"  [CAP #{found_new}] USDOT {dot}: {name_str:<38} | Added: {create_dt} | Phone: {row['Business Telephone No.'][:15]}", flush=True)

                        if client:
                            try:
                                db_row = build_supabase_row(dot, carrier)
                                client.table("carriers").upsert(db_row, on_conflict="usdot_number").execute()
                            except Exception as ex:
                                print(f"  [DB ERR] Failed to upsert USDOT {dot}: {ex}", flush=True)
                    else:
                        skipped_older += 1

                if probed_count % 5000 == 0:
                    curr_rate = probed_count / max((time.time() - start_time) / 60, 0.01)
                    print(f"  --> Probed {probed_count:,} DOTs | Captured: {found_new} | Skipped Older: {skipped_older} | Speed: {curr_rate:,.0f} DOTs/min", flush=True)

            chunk_start = chunk_end + 1

    csvfile.close()

    print("\n" + sep, flush=True)
    print("FINISHED SCRAPING (JULY 25, 2026 TO PRESENT LEADS)", flush=True)
    print(sep, flush=True)
    print(f"  Total Probed:    {probed_count:,}")
    print(f"  Captured Leads:  {found_new:,}")
    print(f"  Skipped Older:   {skipped_older:,}")
    print(f"  Output CSV:      {OUTPUT_CSV}")
    print(sep, flush=True)

def main():
    asyncio.run(async_main())

if __name__ == "__main__":
    main()
