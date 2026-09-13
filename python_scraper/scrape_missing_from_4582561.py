#!/usr/bin/env python3
"""
MOTUS Scraper - Missing-From-DB Range Scraper (USDOT 4,582,560 to 10,000,000)
============================================================================
Scrapes USDOT numbers starting from 4,582,560 up to 10,000,000 and captures
every carrier that exists on MOTUS but is NOT already present in the
Supabase `carriers` table. Writes matches in real-time to a new CSV distinct
from the earlier date-filtered scrape, and tracks progress in its own state
file so it can resume independently.
"""

import os
import sys
import csv
import json
import time
import argparse
import asyncio
import aiohttp
from datetime import datetime, timezone
from dotenv import load_dotenv

load_dotenv()

# ── Default Config ────────────────────────────────────────────────────────────
DEFAULT_START_DOT   = 4582560
DEFAULT_END_DOT     = 10000000
DEFAULT_CHUNK_SIZE  = 10000        # Check in batches of 10,000
DEFAULT_CONCURRENCY = 400          # Concurrent async HTTP requests
DEFAULT_OUTPUT_CSV  = "leads_missing_from_4582560.csv"
DEFAULT_STATE_FILE  = "scrape_missing_from_4582560_state.json"
DB_PAGE_SIZE        = 1000         # This Supabase project's PostgREST row cap

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept":     "application/json",
    "Referer":    "https://motus.dot.gov/",
    "Origin":     "https://motus.dot.gov",
}

FIELDS = [
    "USDOT Number", "Legal Business Name", "Business Telephone No.",
    "Business Email", "DOT Status", "Out of Service", "Update Date", "Create Date"
]

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

# ── DB Reference Set ──────────────────────────────────────────────────────────
def load_existing_dots_from_db(start_dot, end_dot):
    """
    Pulls every usdot_number_num already in `carriers` within [start_dot, end_dot]
    into a Python set, paginating in DB_PAGE_SIZE chunks (this project's
    PostgREST caps every response at 1000 rows regardless of .range() size).
    """
    from supabase import create_client
    url = os.getenv("SUPABASE_URL", "").strip()
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    if not url or not key:
        raise ValueError("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variable.")
    sb = create_client(url, key)

    existing = set()
    offset = 0
    while True:
        res = (
            sb.table("carriers")
            .select("usdot_number_num")
            .gte("usdot_number_num", start_dot)
            .lte("usdot_number_num", end_dot)
            .order("usdot_number_num")
            .range(offset, offset + DB_PAGE_SIZE - 1)
            .execute()
        )
        rows = res.data or []
        if not rows:
            break
        for r in rows:
            v = r.get("usdot_number_num")
            if v is not None:
                existing.add(int(v))
        if len(rows) < DB_PAGE_SIZE:
            break
        offset += DB_PAGE_SIZE
    return existing

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
async def async_main(args):
    if hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8")
        except Exception:
            pass

    start_dot   = args.start_dot
    end_dot     = args.end_dot
    chunk_size  = args.chunk_size
    concurrency = args.concurrency
    output_csv  = args.output
    state_file  = args.state_file

    sep = "=" * 75
    print(sep, flush=True)
    print("MOTUS SCRAPER - MISSING-FROM-DB SCAN", flush=True)
    print(f"Target Range: USDOT {start_dot:,} -> {end_dot:,}", flush=True)
    print(f"Concurrency : {concurrency}", flush=True)
    print(f"Output CSV  : {output_csv}", flush=True)
    print(f"State File  : {state_file}", flush=True)
    print(sep, flush=True)

    # 1. Load the reference set of DOTs already in Supabase for this range
    print("[*] Loading existing USDOT numbers from Supabase carriers table...", flush=True)
    db_existing_dots = load_existing_dots_from_db(start_dot, end_dot)
    print(f"[+] Loaded {len(db_existing_dots):,} existing carriers already in DB for this range", flush=True)

    # 2. Load already captured DOTs from this script's own output CSV (resume-safety)
    saved_dots = set()
    if os.path.exists(output_csv):
        try:
            with open(output_csv, "r", encoding="utf-8", errors="ignore") as f:
                reader = csv.DictReader(f)
                for row in reader:
                    dot_val = row.get("USDOT Number")
                    if dot_val and dot_val.isdigit():
                        saved_dots.add(int(dot_val))
            print(f"[+] Loaded {len(saved_dots):,} already-captured leads from {output_csv}", flush=True)
        except Exception as e:
            print(f"[!] Notice reading existing {output_csv}: {e}", flush=True)

    # 3. Check state file for resume
    chunk_start = start_dot
    total_previously_probed = 0
    if not args.fresh and os.path.exists(state_file):
        try:
            with open(state_file, "r", encoding="utf-8") as sf:
                state_data = json.load(sf)
                if "current_dot" in state_data and state_data["current_dot"] > start_dot:
                    chunk_start = state_data["current_dot"]
                    total_previously_probed = state_data.get("total_probed", 0)
                    print(f"[+] Resuming from state file at USDOT: {chunk_start:,}", flush=True)
        except Exception as e:
            print(f"[!] Notice reading state file {state_file}: {e}", flush=True)

    file_exists = os.path.exists(output_csv)
    csvfile = open(output_csv, "a" if file_exists else "w", newline="", encoding="utf-8")
    writer = csv.DictWriter(csvfile, fieldnames=FIELDS, extrasaction="ignore")
    if not file_exists:
        writer.writeheader()
        csvfile.flush()

    found_new = 0
    probed_count = 0
    start_time = time.time()

    semaphore = asyncio.Semaphore(concurrency)
    connector = aiohttp.TCPConnector(limit=concurrency + 50, ttl_dns_cache=300, ssl=False)

    print(f"[*] Beginning async scan from USDOT {chunk_start:,} up to {end_dot:,}...\n", flush=True)

    async with aiohttp.ClientSession(headers=HEADERS, connector=connector) as session:
        while chunk_start <= end_dot:
            chunk_end = min(chunk_start + chunk_size - 1, end_dot)
            dots_to_probe = list(range(chunk_start, chunk_end + 1))

            elapsed = time.time() - start_time
            rate = probed_count / max(elapsed / 60, 0.01) if probed_count > 0 else 0
            print(
                f"\n[Chunk] USDOT {chunk_start:,} to {chunk_end:,} | "
                f"Probing {len(dots_to_probe):,} | "
                f"Missing leads found: {found_new} (Total in CSV: {len(saved_dots):,}) | "
                f"Speed: {rate:,.0f} DOTs/min | Elapsed: {elapsed:.0f}s",
                flush=True,
            )

            tasks = [fetch_carrier_async(session, semaphore, dot) for dot in dots_to_probe]
            for future in asyncio.as_completed(tasks):
                dot, carrier = await future
                probed_count += 1

                if carrier and dot not in db_existing_dots and dot not in saved_dots:
                    saved_dots.add(dot)
                    found_new += 1
                    row = build_row(dot, carrier)
                    writer.writerow(row)
                    csvfile.flush()

                    name_str = row["Legal Business Name"][:38]
                    c_date = row["Create Date"][:10]
                    print(f"  [MISSING #{found_new}] USDOT {dot} ({c_date}): {name_str:<38} | Phone: {row['Business Telephone No.'][:15]}", flush=True)

                if probed_count % 5000 == 0:
                    curr_rate = probed_count / max((time.time() - start_time) / 60, 0.01)
                    print(f"  --> Probed {probed_count:,} DOTs in this session | Speed: {curr_rate:,.0f} DOTs/min", flush=True)

            # Save state after completing chunk
            try:
                state_data = {
                    "current_dot": chunk_end + 1,
                    "total_probed": total_previously_probed + probed_count,
                    "session_probed": probed_count,
                    "total_missing_leads": len(saved_dots),
                    "new_leads_this_session": found_new,
                    "start_dot": start_dot,
                    "end_dot": end_dot,
                    "updated_at": datetime.now(timezone.utc).isoformat()
                }
                with open(state_file, "w", encoding="utf-8") as sf:
                    json.dump(state_data, sf, indent=2)
            except Exception as e:
                print(f"[!] Warning updating state file: {e}", flush=True)

            chunk_start = chunk_end + 1

    csvfile.close()

    print("\n" + sep, flush=True)
    print("FINISHED SCRAPING TARGET RANGE", flush=True)
    print(sep, flush=True)
    print(f"  Total Probed (Session): {probed_count:,}")
    print(f"  New Missing Leads Found: {found_new:,}")
    print(f"  Total Leads in CSV     : {len(saved_dots):,}")
    print(f"  Output CSV             : {output_csv}")
    print(sep, flush=True)

def parse_arguments():
    parser = argparse.ArgumentParser(description="Scrape MOTUS carriers by USDOT range, capturing only those missing from Supabase")
    parser.add_argument("--start-dot", type=int, default=DEFAULT_START_DOT, help="Starting USDOT number (default: 4582560)")
    parser.add_argument("--end-dot", type=int, default=DEFAULT_END_DOT, help="Ending USDOT number (default: 10000000)")
    parser.add_argument("--chunk-size", type=int, default=DEFAULT_CHUNK_SIZE, help="Chunk size for batching (default: 10000)")
    parser.add_argument("--concurrency", type=int, default=DEFAULT_CONCURRENCY, help="Concurrent HTTP requests (default: 400)")
    parser.add_argument("--output", type=str, default=DEFAULT_OUTPUT_CSV, help="Output CSV path (default: leads_missing_from_4582560.csv)")
    parser.add_argument("--state-file", type=str, default=DEFAULT_STATE_FILE, help="State checkpoint file (default: scrape_missing_from_4582560_state.json)")
    parser.add_argument("--fresh", action="store_true", help="Start from start-dot ignoring state file")
    return parser.parse_args()

def main():
    args = parse_arguments()
    asyncio.run(async_main(args))

if __name__ == "__main__":
    main()
