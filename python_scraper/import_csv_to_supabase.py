#!/usr/bin/env python3
"""
High-Speed Resumable CSV to Supabase Importer (Zero Duplicates)
============================================================================
Streams motus_full_scrape.csv and upserts carrier records into Supabase DB.
- Guarantee: 100% Zero Duplicates via Postgres ON CONFLICT (usdot_number) + in-memory batch deduplication.
- High Concurrency: 10 async parallel workers with connection pooling.
- Resumable: Checkpoints progress to import_progress.json after every batch.
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

CSV_FILE = "motus_full_scrape.csv"
PROGRESS_FILE = "import_progress.json"
BATCH_SIZE = 500           # 500 rows per upsert batch
CONCURRENCY = 10           # 10 parallel HTTP workers
URL = os.getenv("SUPABASE_URL", "").rstrip("/")
KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_ANON_KEY", "")

HEADERS = {
    "apikey": KEY,
    "Authorization": f"Bearer {KEY}",
    "Content-Type": "application/json",
    "Prefer": "resolution=merge-duplicates"
}

def load_progress():
    if os.path.exists(PROGRESS_FILE):
        try:
            with open(PROGRESS_FILE, "r") as f:
                return json.load(f)
        except Exception:
            pass
    return {"last_row_index": 0, "total_upserted": 0, "total_duplicates_filtered": 0}

def save_progress(last_row_index, total_upserted, total_duplicates_filtered):
    try:
        with open(PROGRESS_FILE, "w") as f:
            json.dump({
                "last_row_index": last_row_index,
                "total_upserted": total_upserted,
                "total_duplicates_filtered": total_duplicates_filtered,
                "updated_at": datetime.now(timezone.utc).isoformat()
            }, f, indent=2)
    except Exception:
        pass

def parse_carrier_row(row):
    usdot = (row.get("USDOT Number") or "").strip()
    if not usdot or not usdot.isdigit():
        return None

    name = (row.get("Legal Business Name") or "").strip()
    phone = (row.get("Business Telephone No.") or "").strip()
    email = (row.get("Business Email") or "").strip()
    status = (row.get("DOT Status") or "").strip() or "Active"
    oos_val = (row.get("Out of Service") or "").strip().lower()
    oos = oos_val in ("true", "1", "yes")

    create_date = (row.get("Create Date") or "").strip() or None
    update_date = (row.get("Update Date") or "").strip() or None
    date_val = create_date or update_date

    return {
        "usdot_number": usdot,
        "legal_name": name,
        "phone": phone,
        "email": email,
        "carrier_status": status,
        "out_of_service": oos,
        "added_to_motus": date_val,
        "motus_entry_date": date_val,
        "motus_last_updated": update_date or create_date,
        "profile_url": f"https://motus.dot.gov/customer/{usdot}/account",
    }

async def send_batch(session, semaphore, batch, retries=3):
    endpoint = f"{URL}/rest/v1/carriers?on_conflict=usdot_number"
    async with semaphore:
        for attempt in range(retries):
            try:
                async with session.post(endpoint, json=batch, timeout=aiohttp.ClientTimeout(total=20)) as resp:
                    if resp.status in (200, 201):
                        return len(batch)
                    text = await resp.text()
                    if attempt == retries - 1:
                        print(f"\n[!] Error upserting batch ({resp.status}): {text[:200]}", flush=True)
            except Exception as e:
                if attempt == retries - 1:
                    print(f"\n[!] Network exception: {e}", flush=True)
                await asyncio.sleep(1 + attempt)
    return 0

async def async_main():
    if hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8")
        except Exception:
            pass

    if not URL or not KEY:
        print("[!] Error: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env", flush=True)
        return

    progress = load_progress()
    start_row = progress.get("last_row_index", 0)
    total_upserted = progress.get("total_upserted", 0)
    duplicates_filtered = progress.get("total_duplicates_filtered", 0)

    sep = "=" * 75
    print(sep, flush=True)
    print("SUPABASE PRO BULK IMPORTER (ZERO DUPLICATES GUARANTEE)")
    print(f"Source CSV       : {CSV_FILE}")
    print(f"Target Database  : {URL}")
    print(f"Resume Row Index : {start_row:,}")
    print(f"Already Upserted : {total_upserted:,}")
    print(f"Batch Size       : {BATCH_SIZE} rows/request")
    print(f"Concurrency      : {CONCURRENCY} parallel workers")
    print(sep, flush=True)

    if not os.path.exists(CSV_FILE):
        print(f"[!] Error: {CSV_FILE} not found.", flush=True)
        return

    semaphore = asyncio.Semaphore(CONCURRENCY)
    connector = aiohttp.TCPConnector(limit=CONCURRENCY + 10, ttl_dns_cache=300)
    start_time = time.time()
    session_upserted = 0

    async with aiohttp.ClientSession(headers=HEADERS, connector=connector) as session:
        with open(CSV_FILE, "r", encoding="utf-8", errors="replace") as f:
            reader = csv.DictReader(f)
            
            # Fast-forward to resume row if needed
            current_idx = 0
            if start_row > 0:
                print(f"[*] Fast-forwarding to row {start_row:,}...", flush=True)
                for _ in reader:
                    current_idx += 1
                    if current_idx >= start_row:
                        break
                print(f"[+] Reached row {current_idx:,}. Commencing import...", flush=True)

            batch_dict = {}  # Deduplicate in-memory by usdot_number
            batch_tasks = []

            for row in reader:
                current_idx += 1
                record = parse_carrier_row(row)
                if not record:
                    continue

                # Deduplicate: if duplicate USDOT occurs in same batch, keep latest
                usdot = record["usdot_number"]
                if usdot in batch_dict:
                    duplicates_filtered += 1
                batch_dict[usdot] = record

                if len(batch_dict) >= BATCH_SIZE:
                    batch_list = list(batch_dict.values())
                    batch_dict = {}
                    task = asyncio.create_task(send_batch(session, semaphore, batch_list))
                    batch_tasks.append(task)

                    if len(batch_tasks) >= CONCURRENCY:
                        results = await asyncio.gather(*batch_tasks)
                        added = sum(results)
                        total_upserted += added
                        session_upserted += added
                        batch_tasks = []

                        elapsed = max(time.time() - start_time, 0.1)
                        rate = session_upserted / elapsed
                        save_progress(current_idx, total_upserted, duplicates_filtered)

                        print(
                            f"\r[Progress] Row: {current_idx:,} | "
                            f"Total Upserted: {total_upserted:,} | "
                            f"Duplicates Filtered: {duplicates_filtered:,} | "
                            f"Speed: {rate:,.0f} rows/s",
                            end="",
                            flush=True
                        )

            # Process any remaining tasks
            if batch_dict:
                batch_list = list(batch_dict.values())
                task = asyncio.create_task(send_batch(session, semaphore, batch_list))
                batch_tasks.append(task)

            if batch_tasks:
                results = await asyncio.gather(*batch_tasks)
                added = sum(results)
                total_upserted += added
                session_upserted += added

            save_progress(current_idx, total_upserted, duplicates_filtered)

    print("\n" + sep, flush=True)
    print("IMPORT COMPLETE!")
    print(f"Total Rows Scanned       : {current_idx:,}")
    print(f"Total Successfully Stored: {total_upserted:,}")
    print(f"Duplicate Keys Resolved  : {duplicates_filtered:,}")
    print(sep, flush=True)

if __name__ == "__main__":
    asyncio.run(async_main())
