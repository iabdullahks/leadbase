#!/usr/bin/env python3
"""
MOTUS Equipment & Cargo Classification Backfill Script
=====================================================
Fetches carriers from Supabase in configurable batches (500 - 1,000), queries the
MOTUS public API for vehicle matrix and cargo classifications using polite async
concurrency & rate limiting, bulk-inserts records into Supabase, and persists
resumable progress to `sync_log.json`.

Usage:
  python python_scraper/backfill_equipment.py [OPTIONS]

Options:
  --batch-size INTEGER     Number of carriers to process per batch (default: 500)
  --concurrency INTEGER    Max simultaneous MOTUS HTTP requests (default: 8)
  --delay FLOAT            Polite delay in seconds between request dispatches (default: 0.15)
  --start-id INTEGER       Override starting carrier_id cursor (default: resume from sync_log.json)
  --max-batches INTEGER    Max number of batches to run before stopping (default: unlimited)
  --dry-run                Fetch and parse without inserting into Supabase or updating sync_log
  --target-tables [canonical|custom|both]
                           Target schema tables (default: 'both' if carrier_* tables exist, else 'canonical')
"""

import os
import sys
import json
import time
import signal
import asyncio
import logging
import argparse
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple, Any

import aiohttp
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Force UTF-8 on Windows console to prevent charmap encoding errors
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger("backfill_equipment")

# Paths
WORKSPACE_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SYNC_LOG_PATH = os.path.join(WORKSPACE_ROOT, "sync_log.json")

# MOTUS API Constants
MOTUS_BASE_URL = "https://motus.dot.gov/api"
DEFAULT_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Referer": "https://motus.dot.gov/",
    "Origin": "https://motus.dot.gov",
}

# State management flag for clean shutdown
SHUTDOWN_REQUESTED = False

def handle_sigint(signum, frame):
    global SHUTDOWN_REQUESTED
    logger.warning("Shutdown signal received! Finishing current batch and saving state...")
    SHUTDOWN_REQUESTED = True

signal.signal(signal.SIGINT, handle_sigint)
signal.signal(signal.SIGTERM, handle_sigint)


def load_sync_state() -> dict:
    """Load resumable state from sync_log.json."""
    if not os.path.exists(SYNC_LOG_PATH):
        return {}
    try:
        with open(SYNC_LOG_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data.get("backfill_equipment", {})
    except Exception as e:
        logger.warning(f"Could not read sync_log.json: {e}")
        return {}


def save_sync_state(last_carrier_id: int, last_dot_number: str, stats: dict):
    """
    Save the cursor and running stats atomically to sync_log.json
    preserving existing root keys (like 'runs').
    """
    existing_data = {}
    if os.path.exists(SYNC_LOG_PATH):
        try:
            with open(SYNC_LOG_PATH, "r", encoding="utf-8") as f:
                existing_data = json.load(f)
        except Exception:
            existing_data = {}

    existing_backfill = existing_data.get("backfill_equipment", {})
    total_processed = existing_backfill.get("total_carriers_processed", 0) + stats.get("carriers_processed", 0)
    total_vehicles = existing_backfill.get("total_vehicles_inserted", 0) + stats.get("vehicles_count", 0)
    total_cargo = existing_backfill.get("total_cargo_inserted", 0) + stats.get("cargo_count", 0)

    existing_data["backfill_equipment"] = {
        "last_carrier_id": last_carrier_id,
        "last_dot_number": str(last_dot_number),
        "total_carriers_processed": total_processed,
        "total_vehicles_inserted": total_vehicles,
        "total_cargo_inserted": total_cargo,
        "last_batch_stats": stats,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "status": "in_progress" if not SHUTDOWN_REQUESTED else "stopped"
    }

    temp_path = f"{SYNC_LOG_PATH}.tmp"
    with open(temp_path, "w", encoding="utf-8") as f:
        json.dump(existing_data, f, indent=2)
    os.replace(temp_path, SYNC_LOG_PATH)
    logger.info(f"[SAVED] Resumable state updated: last_carrier_id={last_carrier_id}, last_dot={last_dot_number}")


def get_supabase_client():
    """Initialize Supabase client."""
    from supabase import create_client
    url = os.getenv("SUPABASE_URL", "").strip()
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    if not url or not key:
        raise ValueError("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variable.")
    return create_client(url, key)


def safe_int(val, default=0) -> int:
    """Safe integer parser for MOTUS equipment counts."""
    if val is None or val == "":
        return default
    try:
        return int(val)
    except (ValueError, TypeError):
        return default


async def fetch_motus_carrier_equipment(
    session: aiohttp.ClientSession,
    semaphore: asyncio.Semaphore,
    dot_number: str,
    carrier_id: int,
    rate_delay: float = 0.15,
    max_retries: int = 3
) -> Tuple[int, str, List[dict], List[dict]]:
    """
    Asynchronously queries MOTUS API for a single carrier:
      1. GET /api/carriers/{dot_number} -> extracts entityId
      2. GET /api/public-registration-matrix/{entityId} -> extracts vehicles and cargo
    Returns: (carrier_id, dot_number, vehicles_list, cargo_list)
    """
    vehicles: List[dict] = []
    cargo: List[dict] = []
    clean_dot = str(dot_number).strip()

    if not clean_dot or clean_dot == "None":
        return carrier_id, clean_dot, vehicles, cargo

    carrier_url = f"{MOTUS_BASE_URL}/carriers/{clean_dot}"
    entity_id = None

    async with semaphore:
        # Polite spacing
        if rate_delay > 0:
            await asyncio.sleep(rate_delay)

        # Step 1: Carrier Lookup
        for attempt in range(max_retries):
            try:
                async with session.get(carrier_url, headers=DEFAULT_HEADERS, timeout=aiohttp.ClientTimeout(total=12)) as resp:
                    if resp.status == 200:
                        carrier_data = await resp.json()
                        entity_id = carrier_data.get("entityId")
                        break
                    elif resp.status in (400, 404):
                        # Carrier not registered / active in MOTUS
                        return carrier_id, clean_dot, vehicles, cargo
                    elif resp.status == 429:
                        wait_sec = (attempt + 1) * 2
                        logger.warning(f"Rate limited (429) on DOT {clean_dot}. Backing off {wait_sec}s...")
                        await asyncio.sleep(wait_sec)
                    else:
                        logger.debug(f"Carrier lookup HTTP {resp.status} for DOT {clean_dot}")
                        break
            except (aiohttp.ClientError, asyncio.TimeoutError) as err:
                if attempt == max_retries - 1:
                    logger.debug(f"Network error looking up DOT {clean_dot}: {err}")
                await asyncio.sleep(1)

        if not entity_id:
            return carrier_id, clean_dot, vehicles, cargo

        # Step 2: Public Registration Matrix Lookup
        matrix_url = f"{MOTUS_BASE_URL}/public-registration-matrix/{entity_id}"
        for attempt in range(max_retries):
            try:
                async with session.get(matrix_url, headers=DEFAULT_HEADERS, timeout=aiohttp.ClientTimeout(total=12)) as resp:
                    if resp.status == 200:
                        matrix_data = await resp.json()
                        entity = matrix_data.get("entity", {}) or {}

                        # Parse Vehicles / Equipment
                        for eq in entity.get("entityEquipment", []):
                            eq_type = eq.get("equipmentType", {}) or {}
                            v_type = eq_type.get("equipmentTypeDesc") or ""
                            if v_type:
                                vehicles.append({
                                    "carrier_id": carrier_id,
                                    "usdot_number": clean_dot,
                                    "vehicle_type": v_type,
                                    "owned": safe_int(eq.get("owned")),
                                    "term_leased": safe_int(eq.get("termLeased")),
                                })

                        # Parse Cargo Classifications
                        for c in entity.get("entityCargoClassification", []):
                            desc_obj = c.get("cargoClassification", {}) or {}
                            c_type = desc_obj.get("cargoClassificationDescription") or ""
                            if c_type == "Please Describe" and c.get("otherDescription"):
                                c_type = c.get("otherDescription")
                            if c_type:
                                cargo.append({
                                    "carrier_id": carrier_id,
                                    "usdot_number": clean_dot,
                                    "classification": c_type,
                                    "cargo_type": c_type,  # Supports both table schemas
                                })
                        break
                    elif resp.status == 429:
                        wait_sec = (attempt + 1) * 2
                        logger.warning(f"Rate limited (429) on Matrix {entity_id}. Backing off {wait_sec}s...")
                        await asyncio.sleep(wait_sec)
                    else:
                        break
            except (aiohttp.ClientError, asyncio.TimeoutError) as err:
                if attempt == max_retries - 1:
                    logger.debug(f"Network error looking up Matrix {entity_id}: {err}")
                await asyncio.sleep(1)

    return carrier_id, clean_dot, vehicles, cargo


def bulk_insert_records(supabase, table_name: str, records: List[dict], chunk_size: int = 500):
    """Inserts records in chunks to prevent payload size limits."""
    if not records:
        return 0
    total_inserted = 0
    for i in range(0, len(records), chunk_size):
        chunk = records[i : i + chunk_size]
        try:
            supabase.table(table_name).insert(chunk).execute()
            total_inserted += len(chunk)
        except Exception as e:
            logger.error(f"Error inserting {len(chunk)} rows into '{table_name}': {e}")
    return total_inserted


async def process_batch(
    carriers: List[dict],
    concurrency: int,
    delay: float,
    supabase,
    dry_run: bool = False,
    target_tables: str = "canonical"
) -> Tuple[int, int]:
    """
    Process a batch of carriers concurrently via aiohttp,
    then bulk-insert extracted equipment and cargo rows.
    """
    semaphore = asyncio.Semaphore(concurrency)
    connector = aiohttp.TCPConnector(limit=concurrency * 2, ttl_dns_cache=300)

    async with aiohttp.ClientSession(connector=connector) as session:
        tasks = [
            fetch_motus_carrier_equipment(
                session=session,
                semaphore=semaphore,
                dot_number=c["usdot_number"],
                carrier_id=c["id"],
                rate_delay=delay
            )
            for c in carriers
        ]
        results = await asyncio.gather(*tasks)

    # Flatten extracted rows
    batch_vehicles = []
    batch_cargo = []
    for _, _, v_list, c_list in results:
        batch_vehicles.extend(v_list)
        batch_cargo.extend(c_list)

    if dry_run:
        logger.info(f"[DRY-RUN] Extracted {len(batch_vehicles)} vehicles, {len(batch_cargo)} cargo classifications from {len(carriers)} carriers.")
        return len(batch_vehicles), len(batch_cargo)

    # Insert into database according to target tables
    inserted_v = 0
    inserted_c = 0

    # 1. Canonical tables used by Next.js app ('vehicles', 'cargo_classifications')
    if target_tables in ("canonical", "both"):
        # Format for canonical tables
        v_canonical = [{
            "carrier_id": v["carrier_id"],
            "usdot_number": v["usdot_number"],
            "vehicle_type": v["vehicle_type"],
            "owned": v["owned"],
            "term_leased": v["term_leased"]
        } for v in batch_vehicles]

        c_canonical = [{
            "carrier_id": c["carrier_id"],
            "usdot_number": c["usdot_number"],
            "classification": c["classification"]
        } for c in batch_cargo]

        if v_canonical:
            inserted_v = bulk_insert_records(supabase, "vehicles", v_canonical)
        if c_canonical:
            inserted_c = bulk_insert_records(supabase, "cargo_classifications", c_canonical)

    # 2. Custom tables ('carrier_vehicles', 'carrier_cargo') if configured
    if target_tables in ("custom", "both"):
        v_custom = [{
            "carrier_id": v["carrier_id"],
            "usdot_number": v["usdot_number"],
            "vehicle_type": v["vehicle_type"],
            "owned": v["owned"],
            "term_leased": v["term_leased"]
        } for v in batch_vehicles]

        c_custom = [{
            "carrier_id": c["carrier_id"],
            "usdot_number": c["usdot_number"],
            "cargo_type": c["cargo_type"]
        } for c in batch_cargo]

        if v_custom:
            bulk_insert_records(supabase, "carrier_vehicles", v_custom)
        if c_custom:
            bulk_insert_records(supabase, "carrier_cargo", c_custom)

    return inserted_v, inserted_c


def check_table_exists(supabase, table_name: str) -> bool:
    """Check if a table exists in Supabase."""
    try:
        supabase.table(table_name).select("id").limit(1).execute()
        return True
    except Exception:
        return False


def fetch_unprocessed_batch(supabase, last_carrier_id: int, batch_size: int) -> List[dict]:
    """
    Efficient cursor-based carrier fetching.
    Fetches the next chunk of carriers with id > last_carrier_id ordered by id ASC.
    """
    res = (
        supabase.table("carriers")
        .select("id, usdot_number")
        .gt("id", last_carrier_id)
        .order("id", desc=False)
        .limit(batch_size)
        .execute()
    )
    return res.data or []


async def main_async(args):
    global SHUTDOWN_REQUESTED

    logger.info("=" * 60)
    logger.info("🚀 MOTUS Equipment & Cargo Backfill Initializing")
    logger.info("=" * 60)

    supabase = get_supabase_client()

    # Determine target tables
    target_tables = args.target_tables
    if target_tables == "auto":
        has_custom = check_table_exists(supabase, "carrier_vehicles")
        target_tables = "both" if has_custom else "canonical"

    logger.info(f"Target Tables Configuration: '{target_tables}'")
    logger.info(f"Concurrency: {args.concurrency} workers | Delay: {args.delay}s | Batch Size: {args.batch_size}")

    # Determine starting carrier cursor
    last_carrier_id = 0
    last_dot_number = ""
    saved_state = load_sync_state()

    if args.start_id is not None:
        last_carrier_id = args.start_id
        logger.info(f"Starting from CLI override --start-id={last_carrier_id}")
    elif saved_state and "last_carrier_id" in saved_state:
        last_carrier_id = saved_state["last_carrier_id"]
        last_dot_number = saved_state.get("last_dot_number", "")
        logger.info(f"Resuming from sync_log.json: carrier_id={last_carrier_id} (USDOT {last_dot_number})")
    else:
        logger.info("No prior cursor found in sync_log.json; starting from beginning (carrier_id=0)")

    batches_processed = 0
    total_vehicles_inserted = 0
    total_cargo_inserted = 0
    total_carriers_processed = 0

    start_time = time.time()

    while not SHUTDOWN_REQUESTED:
        if args.max_batches and batches_processed >= args.max_batches:
            logger.info(f"Reached max requested batches ({args.max_batches}). Stopping.")
            break

        logger.info(f"📥 Fetching batch of up to {args.batch_size} carriers after ID {last_carrier_id}...")
        batch_carriers = fetch_unprocessed_batch(supabase, last_carrier_id, args.batch_size)

        if not batch_carriers:
            logger.info("[COMPLETE] No more carriers found beyond cursor. Backfill complete!")
            break

        first_id = batch_carriers[0]["id"]
        batch_last_id = batch_carriers[-1]["id"]
        batch_last_dot = batch_carriers[-1]["usdot_number"]

        logger.info(
            f"[BATCH #{batches_processed + 1}] Processing {len(batch_carriers)} carriers "
            f"(IDs: {first_id} -> {batch_last_id}, DOTs: {batch_carriers[0]['usdot_number']} -> {batch_last_dot})"
        )

        batch_start = time.time()
        v_count, c_count = await process_batch(
            carriers=batch_carriers,
            concurrency=args.concurrency,
            delay=args.delay,
            supabase=supabase,
            dry_run=args.dry_run,
            target_tables=target_tables
        )
        batch_duration = time.time() - batch_start

        total_vehicles_inserted += v_count
        total_cargo_inserted += c_count
        total_carriers_processed += len(batch_carriers)
        batches_processed += 1
        last_carrier_id = batch_last_id
        last_dot_number = batch_last_dot

        logger.info(
            f"[DONE] Batch #{batches_processed} completed in {batch_duration:.1f}s: "
            f"+{v_count} vehicles, +{c_count} cargo classifications"
        )

        if not args.dry_run:
            stats = {
                "batch_number": batches_processed,
                "carriers_processed": len(batch_carriers),
                "vehicles_count": v_count,
                "cargo_count": c_count,
                "batch_duration_seconds": round(batch_duration, 2)
            }
            save_sync_state(last_carrier_id, last_dot_number, stats)

    elapsed = time.time() - start_time
    logger.info("=" * 60)
    logger.info(
        f"[SESSION FINISHED] Completed in {elapsed:.1f}s. "
        f"Total Carriers: {total_carriers_processed} | Total Vehicles: {total_vehicles_inserted} | Total Cargo: {total_cargo_inserted}"
    )
    logger.info("=" * 60)


def main():
    parser = argparse.ArgumentParser(description="Backfill MOTUS vehicle matrix and cargo classifications into Supabase.")
    parser.add_argument("--batch-size", type=int, default=500, help="Carriers to fetch per batch (default: 500)")
    parser.add_argument("--concurrency", type=int, default=8, help="Max simultaneous async HTTP requests (default: 8)")
    parser.add_argument("--delay", type=float, default=0.15, help="Polite delay between request dispatches in seconds (default: 0.15)")
    parser.add_argument("--start-id", type=int, default=None, help="Carrier ID to start after (default: resumes from sync_log.json)")
    parser.add_argument("--max-batches", type=int, default=None, help="Stop after N batches (default: run until complete)")
    parser.add_argument("--dry-run", action="store_true", help="Parse and log without inserting to DB or updating sync_log.json")
    parser.add_argument(
        "--target-tables",
        choices=["auto", "canonical", "custom", "both"],
        default="auto",
        help="Target schema tables: 'canonical' (vehicles & cargo_classifications), 'custom' (carrier_vehicles & carrier_cargo), or 'both'"
    )

    args = parser.parse_args()

    # Default asyncio runner handles Windows loop on modern Python
    asyncio.run(main_async(args))


if __name__ == "__main__":
    main()
