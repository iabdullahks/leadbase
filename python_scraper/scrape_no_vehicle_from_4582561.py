#!/usr/bin/env python3
"""
MOTUS Scraper -- No-Vehicle Filter (from unadded_leads_from_4582561.csv)
========================================================================
Reads all DOTs from unadded_leads_from_4582561.csv, fetches each carrier
registration matrix, and saves ONLY those with ZERO owned/leased vehicles
to no_vehicle_leads_from_4582561.csv.

Two API calls per DOT:
  /api/carriers/{dot}                     -> entityId + basic info
  /api/public-registration-matrix/{id}    -> entityEquipment (vehicle counts)

No-vehicle = entityEquipment is empty OR all rows have owned==0 & termLeased==0
"""

import csv
import os
import sys
import time
import asyncio
import aiohttp

INPUT_CSV   = "unadded_leads_from_4582561.csv"
OUTPUT_CSV  = "no_vehicle_leads_from_4582561.csv"
CONCURRENCY = 120
BATCH_SIZE  = 500

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


def has_no_vehicles(matrix_data):
    """Returns True only if ALL equipmentCount values are 0 (no vehicles registered)."""
    if not matrix_data:
        # Could not fetch matrix -> cannot verify, exclude this DOT
        return False
    entity    = matrix_data.get("entity") or {}
    equipment = entity.get("entityEquipment") or []
    if not equipment:
        # No equipment rows at all -> truly no vehicles
        return True
    for eq in equipment:
        count = int(eq.get("equipmentCount") or 0)
        if count > 0:
            return False
    return True


async def fetch_json(session, semaphore, url, retries=3):
    async with semaphore:
        for attempt in range(retries):
            try:
                async with session.get(url, timeout=aiohttp.ClientTimeout(total=12)) as resp:
                    if resp.status in (400, 404):
                        return None
                    if resp.status == 200:
                        return await resp.json()
            except Exception:
                if attempt < retries - 1:
                    await asyncio.sleep(0.3 * (attempt + 1))
        return None


async def process_dot(session, semaphore, dot, row_data):
    carrier = await fetch_json(session, semaphore, f"https://motus.dot.gov/api/carriers/{dot}")
    if not carrier:
        return dot, row_data, False  # DOT doesn't exist or fetch failed
    entity_id = carrier.get("entityId")
    if not entity_id:
        return dot, row_data, False
    matrix = await fetch_json(session, semaphore, f"https://motus.dot.gov/api/public-registration-matrix/{entity_id}")
    return dot, row_data, has_no_vehicles(matrix)


async def async_main():
    if hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8")
        except Exception:
            pass

    sep = "=" * 70
    print(sep, flush=True)
    print("MOTUS SCRAPER -- No-Vehicle Filter from unadded_leads_from_4582561.csv", flush=True)
    print(f"Input CSV   : {INPUT_CSV}", flush=True)
    print(f"Output CSV  : {OUTPUT_CSV}", flush=True)
    print(f"Concurrency : {CONCURRENCY}", flush=True)
    print(sep, flush=True)

    if not os.path.exists(INPUT_CSV):
        print(f"[!] Input file not found: {INPUT_CSV}", flush=True)
        sys.exit(1)

    print(f"[*] Reading {INPUT_CSV} ...", flush=True)
    all_rows = []
    with open(INPUT_CSV, "r", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            dot_val = row.get("USDOT Number", "").strip()
            if dot_val:
                try:
                    all_rows.append((int(dot_val), row))
                except ValueError:
                    pass

    total_input = len(all_rows)
    print(f"[+] Loaded {total_input:,} DOTs from input CSV", flush=True)

    saved_dots = set()
    file_exists = os.path.exists(OUTPUT_CSV)
    if file_exists:
        with open(OUTPUT_CSV, "r", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                dot_val = row.get("USDOT Number", "").strip()
                if dot_val:
                    try:
                        saved_dots.add(int(dot_val))
                    except ValueError:
                        pass
        print(f"[+] Resume mode: {len(saved_dots):,} DOTs already in {OUTPUT_CSV}", flush=True)

    pending = [(dot, row) for dot, row in all_rows if dot not in saved_dots]
    print(f"[*] Pending to check: {len(pending):,}", flush=True)

    if not pending:
        print("[+] Nothing to do. All DOTs already processed.", flush=True)
        return

    csvfile = open(OUTPUT_CSV, "a" if file_exists else "w", newline="", encoding="utf-8")
    writer  = csv.DictWriter(csvfile, fieldnames=FIELDS, extrasaction="ignore")
    if not file_exists:
        writer.writeheader()
        csvfile.flush()

    semaphore = asyncio.Semaphore(CONCURRENCY)
    connector = aiohttp.TCPConnector(limit=CONCURRENCY + 50, ttl_dns_cache=300, ssl=False)

    found_no_veh = 0
    probed       = 0
    start_time   = time.time()

    async with aiohttp.ClientSession(headers=HEADERS, connector=connector) as session:
        for batch_start in range(0, len(pending), BATCH_SIZE):
            batch = pending[batch_start: batch_start + BATCH_SIZE]
            elapsed = time.time() - start_time
            rate    = probed / max(elapsed / 60, 0.01) if probed > 0 else 0
            batch_end = min(batch_start + BATCH_SIZE, len(pending))
            print(
                f"\n[Batch] {batch_start + 1:,}--{batch_end:,} of {len(pending):,} | "
                f"No-vehicle: {found_no_veh} | Speed: {rate:,.0f} DOTs/min | Elapsed: {elapsed:.0f}s",
                flush=True,
            )
            tasks = [process_dot(session, semaphore, dot, row) for dot, row in batch]
            for future in asyncio.as_completed(tasks):
                dot, row, no_veh = await future
                probed += 1
                if no_veh:
                    found_no_veh += 1
                    writer.writerow(row)
                    csvfile.flush()
                    name_str = (row.get("Legal Business Name") or "")[:40]
                    print(
                        f"  [NO-VEH #{found_no_veh}] DOT {dot}: {name_str:<40} | "
                        f"Phone: {(row.get('Business Telephone No.') or '')[:15]}",
                        flush=True,
                    )

    csvfile.close()
    elapsed = time.time() - start_time
    print("\n" + sep, flush=True)
    print("FINISHED", flush=True)
    print(sep, flush=True)
    print(f"  Total input DOTs   : {total_input:,}")
    print(f"  Probed this run    : {probed:,}")
    print(f"  No-vehicle leads   : {found_no_veh:,}")
    print(f"  Output CSV         : {OUTPUT_CSV}")
    print(f"  Elapsed            : {elapsed:.0f}s")
    print(sep, flush=True)


def main():
    asyncio.run(async_main())


if __name__ == "__main__":
    main()
