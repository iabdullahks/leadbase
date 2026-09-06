#!/usr/bin/env python3
"""
MOTUS Full Database Scraper (All DOTs)
============================================================================
Scrapes all carrier registration records from MOTUS (motus.dot.gov) and
upserts them directly into the Supabase database.

Features:
- Full range scan: USDOT 1 to 10,200,000
- Deduplication: Pre-loads all existing USDOTs from Supabase DB to skip already captured carriers
- State Checkpointing: Saves progress to motus_scraper_state.json every chunk so it can resume anytime
- High Concurrency: 400 async HTTP connections with connection reuse & keep-alive
- Micro-batch DB Upserts: Inserts in batches of 50 to maximize database throughput
- Local Backup CSV: Concurrently streams all new records to motus_full_scrape.csv
"""

import os
import sys
import csv
import json
import time
import asyncio
import aiohttp
from datetime import datetime, timezone
from dotenv import load_dotenv

load_dotenv()

# ── Configuration ─────────────────────────────────────────────────────────────
DEFAULT_START_DOT = 1
DEFAULT_END_DOT   = 10_200_000
CHUNK_SIZE        = 5_000         # Scan in blocks of 5,000 DOTs
CONCURRENCY       = 400           # 400 async HTTP connections
DB_BATCH_SIZE     = 50            # Upsert in batches of 50
ENABLE_DB_SYNC    = False         # Supabase is full: stream new leads directly to CSV only
OUTPUT_CSV        = "motus_full_scrape.csv"
STATE_FILE        = "motus_scraper_state.json"

MOTUS_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept":     "application/json",
    "Referer":    "https://motus.dot.gov/",
    "Origin":     "https://motus.dot.gov",
}

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
            name = (n.get("entityName") or "").strip()
            if name:
                return name
    return (carrier.get("entityName") or "").strip()

def get_dba_name(carrier):
    for n in (carrier.get("entityNames") or []):
        if n.get("nameType") == "DBA":
            return (n.get("entityName") or "").strip()
    return ""

def get_principal_address(carrier):
    locs = carrier.get("locations") or []
    for loc in locs:
        line1 = (loc.get("addressLine1") or "").strip()
        city = (loc.get("city") or "").strip()
        state = (loc.get("state") or "").strip()
        zip_code = (loc.get("zipCode") or "").strip()
        parts = [p for p in [line1, city, state, zip_code] if p]
        if parts:
            return ", ".join(parts)
    return ""

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
    
    ced = carrier.get("carrierEntityDetail") or {}
    business_type = (ced.get("businessType") or {}).get("businessTypeName", "") if isinstance(ced.get("businessType"), dict) else ""
    dun_no = str(ced.get("dunBradstreetNo") or "") if ced.get("dunBradstreetNo") not in (0, "0", None) else ""
    state_incorp = ced.get("stateOfIncorp") or ""
    
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
        "dba_name":           get_dba_name(carrier),
        "principal_address":  get_principal_address(carrier),
        "mailing_address":    "",
        "duns":               dun_no,
        "form_of_business":   business_type,
        "state_incorporated": state_incorp,
        "new_entrant_status": "",
        "raw_data":           carrier
    }

# ── State Persistence ─────────────────────────────────────────────────────────
def load_state():
    if os.path.exists(STATE_FILE):
        try:
            with open(STATE_FILE, "r") as f:
                return json.load(f)
        except Exception:
            pass
    return None

def save_state(current_dot, total_scanned, total_found):
    try:
        with open(STATE_FILE, "w") as f:
            json.dump({
                "current_dot":   current_dot,
                "total_scanned": total_scanned,
                "total_found":   total_found,
                "updated_at":    datetime.now(timezone.utc).isoformat()
            }, f, indent=2)
    except Exception as e:
        print(f"[!] Warning: Could not save state ({e})", flush=True)

# ── Existing DOTs Loader ──────────────────────────────────────────────────────
def get_existing_dots(client):
    print("[*] Fetching all existing USDOTs from Supabase database to skip existing...", flush=True)
    existing_dots = set()
    if not client:
        return existing_dots

    page = 0
    page_size = 1000
    while True:
        try:
            res = client.table("carriers").select("usdot_number").range(page * page_size, (page + 1) * page_size - 1).execute()
            if not res.data:
                break
            for r in res.data:
                u = r.get("usdot_number")
                if u and u.isdigit():
                    existing_dots.add(int(u))
            page += 1
            if len(res.data) < page_size:
                break
            if len(existing_dots) % 20000 == 0:
                print(f"  --> Loaded {len(existing_dots):,} existing USDOTs from DB...", flush=True)
        except Exception as e:
            print(f"[!] Warning loading DB page {page}: {e}. Retrying in 2s...", flush=True)
            time.sleep(2)

    print(f"[+] Total existing records in database: {len(existing_dots):,}", flush=True)
    return existing_dots

# ── Async Carrier Fetcher ─────────────────────────────────────────────────────
async def fetch_carrier(session, semaphore, dot, retries=2):
    url = f"https://motus.dot.gov/api/carriers/{dot}"
    async with semaphore:
        for attempt in range(retries):
            try:
                async with session.get(url, timeout=aiohttp.ClientTimeout(total=6)) as resp:
                    if resp.status in (400, 404):
                        return dot, None
                    if resp.status == 200:
                        data = await resp.json()
                        return dot, data
            except Exception:
                if attempt < retries - 1:
                    await asyncio.sleep(0.15)
        return dot, None

# ── Database Batch Upserter ───────────────────────────────────────────────────
def upsert_db_batch(client, batch):
    if not client or not batch:
        return
    try:
        client.table("carriers").upsert(batch, on_conflict="usdot_number").execute()
    except Exception as e:
        print(f"  [DB ERR] Batch upsert of {len(batch)} leads failed: {e}", flush=True)

# ── Main Runner ───────────────────────────────────────────────────────────────
async def async_main():
    if hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8")
        except Exception:
            pass

    # Optional CLI start_dot override
    start_dot = DEFAULT_START_DOT
    end_dot = DEFAULT_END_DOT
    state = load_state()
    
    if len(sys.argv) > 1 and sys.argv[1].isdigit():
        start_dot = int(sys.argv[1])
    elif state and state.get("current_dot"):
        start_dot = state["current_dot"]
        print(f"[*] Resuming from saved state checkpoint: USDOT {start_dot:,}", flush=True)

    if len(sys.argv) > 2 and sys.argv[2].isdigit():
        end_dot = int(sys.argv[2])

    sep = "=" * 75
    print(sep, flush=True)
    print("MOTUS FULL DATABASE SCRAPER (CSV STREAMING)")
    print(f"Range       : USDOT {start_dot:,} to {end_dot:,}")
    print(f"Concurrency : {CONCURRENCY} connections")
    print(f"DB Sync     : {'Enabled' if ENABLE_DB_SYNC else 'Disabled (Supabase is full, saving to CSV only)'}")
    print(f"Output CSV  : {OUTPUT_CSV}")
    print(sep, flush=True)

    client = None
    existing_dots = set()
    if ENABLE_DB_SYNC:
        url = os.getenv("SUPABASE_URL")
        key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_ANON_KEY")
        if url and key:
            try:
                from supabase import create_client
                client = create_client(url, key)
                print("[+] Connected to Supabase DB successfully.", flush=True)
            except Exception as e:
                print(f"[!] Warning: Could not connect to Supabase ({e})", flush=True)
        existing_dots = get_existing_dots(client)
    else:
        print("[*] Bypassing Supabase connection — streaming all new leads directly to CSV.", flush=True)

    # Setup CSV output
    csv_fields = [
        "USDOT Number", "Legal Business Name", "Business Telephone No.",
        "Business Email", "DOT Status", "Out of Service", "Update Date", "Create Date"
    ]
    file_exists = os.path.exists(OUTPUT_CSV)
    csv_file = open(OUTPUT_CSV, "a" if file_exists else "w", newline="", encoding="utf-8")
    writer = csv.DictWriter(csv_file, fieldnames=csv_fields, extrasaction="ignore")
    if not file_exists:
        writer.writeheader()
        csv_file.flush()

    chunk_start = start_dot
    total_found = state.get("total_found", 0) if state else 0
    total_probed = state.get("total_scanned", 0) if state else 0
    db_batch = []
    start_time = time.time()

    semaphore = asyncio.Semaphore(CONCURRENCY)
    connector = aiohttp.TCPConnector(limit=CONCURRENCY + 50, ttl_dns_cache=300)

    print(f"[*] Commencing full scrape from USDOT {chunk_start:,}...\n", flush=True)

    async with aiohttp.ClientSession(headers=MOTUS_HEADERS, connector=connector) as session:
        while chunk_start <= end_dot:
            chunk_end = min(chunk_start + CHUNK_SIZE - 1, end_dot)
            dots_to_probe = [dot for dot in range(chunk_start, chunk_end + 1) if dot not in existing_dots]

            if not dots_to_probe:
                chunk_start = chunk_end + 1
                save_state(chunk_start, total_probed, total_found)
                continue

            elapsed = time.time() - start_time
            rate = total_probed / max(elapsed / 60, 0.01) if total_probed > 0 else 0
            print(
                f"[Chunk] USDOT {chunk_start:,} - {chunk_end:,} | "
                f"Probing {len(dots_to_probe):,} unadded | "
                f"New leads: {total_found:,} | Speed: {rate:,.0f} DOTs/min",
                flush=True
            )

            tasks = [fetch_carrier(session, semaphore, dot) for dot in dots_to_probe]
            for future in asyncio.as_completed(tasks):
                dot, carrier = await future
                total_probed += 1

                if carrier:
                    if dot in existing_dots:
                        continue
                    existing_dots.add(dot)
                    total_found += 1

                    row = build_row(dot, carrier)
                    writer.writerow(row)
                    csv_file.flush()

                    if ENABLE_DB_SYNC:
                        db_row = build_supabase_row(dot, carrier)
                        db_batch.append(db_row)
                        if len(db_batch) >= DB_BATCH_SIZE:
                            upsert_db_batch(client, db_batch)
                            db_batch = []

                    name_str = row["Legal Business Name"][:35]
                    phone_str = row["Business Telephone No."][:14]
                    print(f"  [+] #{total_found:,} DOT {dot}: {name_str:<35} | {phone_str}", flush=True)

                if total_probed % 5000 == 0:
                    curr_rate = total_probed / max((time.time() - start_time) / 60, 0.01)
                    print(f"  --> Progress: {total_probed:,} checked | {total_found:,} added | {curr_rate:,.0f} DOTs/min", flush=True)

            # Flush any remaining in DB batch for this chunk
            if ENABLE_DB_SYNC and db_batch:
                upsert_db_batch(client, db_batch)
                db_batch = []

            chunk_start = chunk_end + 1
            save_state(chunk_start, total_probed, total_found)

    csv_file.close()
    print("\n" + sep, flush=True)
    print("FINISHED MOTUS FULL SCRAPE", flush=True)
    print(f"Total Probed : {total_probed:,}")
    print(f"New Captured : {total_found:,}")
    print(sep, flush=True)

def main():
    asyncio.run(async_main())

if __name__ == "__main__":
    main()
