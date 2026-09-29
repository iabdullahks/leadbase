#!/usr/bin/env python3
"""
LeadBase 12-Hour Automated Continuous Gap Scraper
============================================================================
Runs continuously every 12 hours:
1. Pre-loads all existing carriers from Supabase (>= 4,582,560) to skip known records.
2. Scans MOTUS asynchronously for all newly registered / gap USDOTs.
3. Automatically upserts newly discovered carriers directly into Supabase in real time.
4. Appends matches to unadded_leads_from_4582560_v10.csv.
5. Logs each execution and stats to the `sync_runs` table in Supabase.
6. Waits 12 hours and repeats automatically.
"""

import os
import sys
import csv
import glob
import json
import time
import argparse
import asyncio
import aiohttp
from datetime import datetime, timezone, timedelta
from dotenv import load_dotenv

import warnings
warnings.filterwarnings("ignore", category=DeprecationWarning)

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

# ── Environment & Paths ───────────────────────────────────────────────────────
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
WORKSPACE_ROOT = os.path.dirname(SCRIPT_DIR)

load_dotenv(os.path.join(WORKSPACE_ROOT, ".env"))
load_dotenv(os.path.join(SCRIPT_DIR, ".env"))
load_dotenv()

# ── Config ────────────────────────────────────────────────────────────────────
DEFAULT_START_DOT   = 4582560
DEFAULT_END_DOT     = 10000000
CHUNK_SIZE          = 5000         # Scan in batches of 5,000 DOTs
CONCURRENCY         = 300          # 300 concurrent async HTTP connections
INTERVAL_HOURS      = 12           # Run every 12 hours
OUTPUT_CSV          = os.path.join(WORKSPACE_ROOT, "unadded_leads_from_4582560_v10.csv")
STATE_FILE          = os.path.join(WORKSPACE_ROOT, "motus_scraper_state_v10.json")

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

def parse_dt(v):
    if not v or not str(v).strip():
        return None
    s = str(v).strip()
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.isoformat()
    except Exception:
        return None

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
    create_date_raw = carrier.get("createDate") or carrier.get("updateDate")
    update_date_raw = carrier.get("updateDate") or carrier.get("createDate")
    create_date = parse_dt(create_date_raw)
    update_date = parse_dt(update_date_raw)
    now_iso = datetime.now(timezone.utc).isoformat()
    usdot = get_dot_number(carrier) or str(dot)
    
    ced = carrier.get("carrierEntityDetail") or {}
    business_type = (ced.get("businessType") or {}).get("businessTypeName", "") if isinstance(ced.get("businessType"), dict) else ""
    dun_no = str(ced.get("dunBradstreetNo") or "") if ced.get("dunBradstreetNo") not in (0, "0", None) else ""
    state_incorp = ced.get("stateOfIncorp") or ""
    
    row = {
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
    if usdot.isdigit():
        row["usdot_number_num"] = int(usdot)
    return row

def safe_int(val, default=0):
    if val is None or val == "":
        return default
    try:
        return int(val)
    except (ValueError, TypeError):
        return default

async def fetch_equipment_and_cargo_async(session, semaphore, entity_id, dot, carrier_id, retries=2):
    if not entity_id:
        return [], []
    url = f"https://motus.dot.gov/api/public-registration-matrix/{entity_id}"
    vehicles = []
    cargo = []
    async with semaphore:
        for attempt in range(retries):
            try:
                async with session.get(url, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                    if resp.status == 200:
                        matrix_data = await resp.json()
                        entity = matrix_data.get("entity", {}) or {}
                        for eq in entity.get("entityEquipment", []):
                            eq_type = eq.get("equipmentType", {}) or {}
                            v_type = eq_type.get("equipmentTypeDesc") or ""
                            if v_type:
                                vehicles.append({
                                    "carrier_id": carrier_id,
                                    "usdot_number": str(dot),
                                    "vehicle_type": v_type,
                                    "owned": safe_int(eq.get("owned")),
                                    "term_leased": safe_int(eq.get("termLeased")),
                                })
                        for c in entity.get("entityCargoClassification", []):
                            desc_obj = c.get("cargoClassification", {}) or {}
                            c_type = desc_obj.get("cargoClassificationDescription") or ""
                            if c_type == "Please Describe" and c.get("otherDescription"):
                                c_type = c.get("otherDescription")
                            if c_type:
                                cargo.append({
                                    "carrier_id": carrier_id,
                                    "usdot_number": str(dot),
                                    "classification": c_type,
                                    "cargo_type": c_type,
                                })
                        break
            except Exception:
                if attempt < retries - 1:
                    await asyncio.sleep(0.3)
    return vehicles, cargo

# ── Load Known DOTs ───────────────────────────────────────────────────────────
def load_known_dots_from_csv():
    known = set()
    patterns = [
        os.path.join(WORKSPACE_ROOT, "unadded_leads_from_4582560*.csv"),
        os.path.join(WORKSPACE_ROOT, "carriers_above_4582560*.csv"),
        os.path.join(WORKSPACE_ROOT, "leads_missing_from_4582560*.csv"),
        os.path.join(WORKSPACE_ROOT, "new_leads_scraped.csv"),
        OUTPUT_CSV
    ]
    for pattern in patterns:
        for filepath in glob.glob(pattern):
            if not os.path.exists(filepath):
                continue
            try:
                with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
                    reader = csv.DictReader(f)
                    for row in reader:
                        v = row.get("USDOT Number") or row.get("usdot_number")
                        if v and v.isdigit():
                            known.add(int(v))
            except Exception:
                pass
    return known

def load_existing_dots_from_db(client, start_dot, end_dot):
    if not client:
        return set()
    existing = set()
    page_size = 1000
    offset = 0
    t0 = time.time()
    try:
        while True:
            res = (
                client.table("carriers")
                .select("usdot_number_num")
                .gte("usdot_number_num", start_dot)
                .lte("usdot_number_num", end_dot)
                .order("usdot_number_num")
                .range(offset, offset + page_size - 1)
                .execute()
            )
            rows = res.data or []
            if not rows:
                break
            for r in rows:
                v = r.get("usdot_number_num")
                if v is not None:
                    existing.add(int(v))
            if len(rows) < page_size:
                break
            offset += page_size
        print(f"[DB] Loaded {len(existing):,} existing carriers from Supabase in {time.time() - t0:.1f}s", flush=True)
    except Exception as e:
        print(f"[WARN] Error loading Supabase DOTs: {e}", flush=True)
    return existing

def check_dots_in_supabase(client, dots_list):
    if not client or not dots_list:
        return set()
    in_db = set()
    batch_size = 300
    for i in range(0, len(dots_list), batch_size):
        chunk = [str(d) for d in dots_list[i:i + batch_size]]
        try:
            res = client.table("carriers").select("usdot_number").in_("usdot_number", chunk).execute()
            if res.data:
                for row in res.data:
                    num = row.get("usdot_number")
                    if num and num.isdigit():
                        in_db.add(int(num))
        except Exception:
            pass
    return in_db

# ── HTTP Worker ───────────────────────────────────────────────────────────────
async def fetch_carrier_async(session, semaphore, dot, retries=3):
    url = f"https://motus.dot.gov/api/carriers/{dot}"
    async with semaphore:
        for attempt in range(retries):
            try:
                async with session.get(url, timeout=aiohttp.ClientTimeout(total=9)) as resp:
                    if resp.status in (400, 404):
                        return dot, None
                    if resp.status == 200:
                        data = await resp.json()
                        return dot, data
            except Exception:
                if attempt < retries - 1:
                    await asyncio.sleep(0.2 * (attempt + 1))
        return dot, None

# ── Single Scrape Cycle ───────────────────────────────────────────────────────
async def run_single_scrape(client, start_dot, end_dot, concurrency, output_csv, state_file):
    sep = "=" * 72
    run_start_time = datetime.now(timezone.utc)
    print("\n" + sep, flush=True)
    print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] STARTING 12-HOUR GAP SCRAPE CYCLE", flush=True)
    print(f"Target Range: USDOT {start_dot:,} -> {end_dot:,}", flush=True)
    print(sep, flush=True)

    # 1. Log run start to Supabase sync_runs
    run_id = None
    if client:
        try:
            res = client.table("sync_runs").insert({
                "run_type": "12h_schedule",
                "started_at": run_start_time.isoformat(),
                "status": "running",
                "stats": {
                    "start_dot": start_dot,
                    "end_dot": end_dot,
                    "concurrency": concurrency
                }
            }).execute()
            if res.data:
                run_id = res.data[0].get("id")
        except Exception as e:
            print(f"[WARN] Could not log to sync_runs: {e}", flush=True)

    # 2. Pre-load known DOTs
    known_dots = load_known_dots_from_csv()
    if client:
        db_dots = load_existing_dots_from_db(client, start_dot, end_dot)
        known_dots.update(db_dots)
    print(f"[+] Total known USDOTs skipped: {len(known_dots):,}", flush=True)

    # 3. Prepare CSV writer
    file_exists = os.path.exists(output_csv)
    csvfile = open(output_csv, "a" if file_exists else "w", newline="", encoding="utf-8")
    writer = csv.DictWriter(csvfile, fieldnames=FIELDS, extrasaction="ignore")
    if not file_exists:
        writer.writeheader()
        csvfile.flush()

    found_new = 0
    probed_count = 0
    chunk_start = start_dot
    start_time = time.time()

    semaphore = asyncio.Semaphore(concurrency)
    connector = aiohttp.TCPConnector(limit=concurrency + 50, ttl_dns_cache=300, ssl=False)

    async with aiohttp.ClientSession(headers=HEADERS, connector=connector) as session:
        while chunk_start <= end_dot:
            chunk_end = min(chunk_start + CHUNK_SIZE - 1, end_dot)
            dots_to_probe = [dot for dot in range(chunk_start, chunk_end + 1) if dot not in known_dots]

            if not dots_to_probe:
                chunk_start = chunk_end + 1
                continue

            elapsed = time.time() - start_time
            rate = probed_count / max(elapsed / 60, 0.01) if probed_count > 0 else 0
            print(
                f"[Chunk] {chunk_start:,}–{chunk_end:,} | "
                f"Probing {len(dots_to_probe):,} unadded | "
                f"New leads: {found_new} | Speed: {rate:,.0f} DOTs/min",
                flush=True
            )

            tasks = [fetch_carrier_async(session, semaphore, dot) for dot in dots_to_probe]
            carriers_found = []

            for future in asyncio.as_completed(tasks):
                dot, carrier = await future
                probed_count += 1
                if carrier:
                    carriers_found.append((dot, carrier))

            if carriers_found:
                dots_found = [dot for dot, _ in carriers_found]
                existing_in_supabase = check_dots_in_supabase(client, dots_found)

                for dot, carrier in carriers_found:
                    if dot in existing_in_supabase:
                        known_dots.add(dot)
                        continue

                    found_new += 1
                    row = build_row(dot, carrier)
                    writer.writerow(row)
                    csvfile.flush()

                    name_str = row["Legal Business Name"][:35]
                    phone_str = row["Business Telephone No."][:15]
                    email_str = row["Business Email"][:25]
                    print(f"  [+ NEW LEAD #{found_new}] USDOT {dot}: {name_str:<35} | {phone_str:<15} | {email_str}", flush=True)

                    known_dots.add(dot)

                    # Upsert to Supabase
                    if client:
                        try:
                            db_row = build_supabase_row(dot, carrier)
                            res = client.table("carriers").upsert(db_row, on_conflict="usdot_number").execute()
                            
                            # Extract carrier ID and fetch equipment & cargo in real-time
                            carrier_id = None
                            if res.data:
                                carrier_id = res.data[0].get("id")
                            
                            entity_id = carrier.get("entityId")
                            if entity_id:
                                v_list, c_list = await fetch_equipment_and_cargo_async(session, semaphore, entity_id, dot, carrier_id)
                                if v_list:
                                    v_canon = [{
                                        "carrier_id": v["carrier_id"],
                                        "usdot_number": v["usdot_number"],
                                        "vehicle_type": v["vehicle_type"],
                                        "owned": v["owned"],
                                        "term_leased": v["term_leased"]
                                    } for v in v_list]
                                    try:
                                        client.table("vehicles").insert(v_canon).execute()
                                    except Exception:
                                        pass
                                    try:
                                        client.table("carrier_vehicles").insert(v_canon).execute()
                                    except Exception:
                                        pass
                                if c_list:
                                    c_canon = [{
                                        "carrier_id": c["carrier_id"],
                                        "usdot_number": c["usdot_number"],
                                        "classification": c["classification"]
                                    } for c in c_list]
                                    try:
                                        client.table("cargo_classifications").insert(c_canon).execute()
                                    except Exception:
                                        pass
                                    try:
                                        c_cust = [{
                                            "carrier_id": c["carrier_id"],
                                            "usdot_number": c["usdot_number"],
                                            "cargo_type": c["cargo_type"]
                                        } for c in c_list]
                                        client.table("carrier_cargo").insert(c_cust).execute()
                                    except Exception:
                                        pass
                                if v_list or c_list:
                                    print(f"    [+ EQUIPMENT] USDOT {dot}: +{len(v_list)} vehicles, +{len(c_list)} cargo items added", flush=True)
                        except Exception as ex:
                            print(f"    [DB ERR] USDOT {dot}: {ex}", flush=True)

            chunk_start = chunk_end + 1

    csvfile.close()
    duration = time.time() - start_time

    # 4. Update sync_runs log in Supabase
    run_end_time = datetime.now(timezone.utc)
    if client and run_id:
        try:
            client.table("sync_runs").update({
                "status": "completed",
                "completed_at": run_end_time.isoformat(),
                "duration_seconds": round(duration, 1),
                "stats": {
                    "start_dot": start_dot,
                    "end_dot": end_dot,
                    "dots_probed": probed_count,
                    "new_leads": found_new,
                    "rate_dots_per_min": round(probed_count / max(duration / 60, 0.01))
                }
            }).eq("id", run_id).execute()
        except Exception:
            pass

    # 5. Update state file
    try:
        with open(state_file, "w", encoding="utf-8") as sf:
            json.dump({
                "last_cycle_completed_at": run_end_time.isoformat(),
                "new_leads_captured": found_new,
                "dots_probed": probed_count,
                "duration_seconds": round(duration, 1)
            }, sf, indent=2)
    except Exception:
        pass

    print(sep, flush=True)
    print(f"CYCLE COMPLETE: {found_new:,} new leads captured and added to Supabase in {duration/60:.1f} mins.", flush=True)
    print(sep + "\n", flush=True)
    return found_new

# ── Main 12-Hour Infinite Runner ──────────────────────────────────────────────
async def main_scheduler():
    parser = argparse.ArgumentParser(description="LeadBase 12-Hour Automated Continuous Scraper")
    parser.add_argument("--interval", type=int, default=INTERVAL_HOURS, help=f"Hours between cycles (default: {INTERVAL_HOURS})")
    parser.add_argument("--start-dot", type=int, default=DEFAULT_START_DOT, help=f"Starting USDOT (default: {DEFAULT_START_DOT})")
    parser.add_argument("--end-dot", type=int, default=DEFAULT_END_DOT, help=f"Ending USDOT (default: {DEFAULT_END_DOT})")
    parser.add_argument("--concurrency", type=int, default=CONCURRENCY, help=f"Async HTTP concurrency (default: {CONCURRENCY})")
    parser.add_argument("--once", action="store_true", help="Run a single scrape cycle and exit immediately (ideal for cron / GitHub Actions)")
    args = parser.parse_args()

    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_ANON_KEY")
    client = None
    if url and key:
        try:
            from supabase import create_client
            client = create_client(url, key)
            print("[+] Connected to Supabase client successfully", flush=True)
        except Exception as e:
            print(f"[!] Warning: Could not connect to Supabase ({e})", flush=True)

    print("=" * 72, flush=True)
    print("LEADBASE AUTOMATED 12-HOUR SCRAPER SERVICE INITIALIZED", flush=True)
    print(f"Interval    : Every {args.interval} hours ({args.interval * 3600:,} seconds)")
    print(f"Target Range: USDOT {args.start_dot:,} to {args.end_dot:,}")
    print(f"Concurrency : {args.concurrency}")
    print(f"Output File : {OUTPUT_CSV}")
    print("=" * 72, flush=True)

    cycle_count = 0
    while True:
        cycle_count += 1
        print(f"\n>>> Running Cycle #{cycle_count} at {datetime.now().strftime('%Y-%m-%d %H:%M:%S')} <<<", flush=True)

        try:
            await run_single_scrape(
                client=client,
                start_dot=args.start_dot,
                end_dot=args.end_dot,
                concurrency=args.concurrency,
                output_csv=OUTPUT_CSV,
                state_file=STATE_FILE
            )
        except Exception as e:
            print(f"[ERROR] Cycle #{cycle_count} encountered an error: {e}", flush=True)

        if args.once:
            print("[*] Single-cycle execution (--once) complete. Exiting.", flush=True)
            break

        next_run_time = datetime.now() + timedelta(hours=args.interval)
        print(f"[*] Sleeping for {args.interval} hours... Next cycle starts at {next_run_time.strftime('%Y-%m-%d %H:%M:%S')}", flush=True)
        await asyncio.sleep(args.interval * 3600)

if __name__ == "__main__":
    try:
        asyncio.run(main_scheduler())
    except KeyboardInterrupt:
        print("\n[!] 12-Hour Scraper stopped by user. Exiting cleanly.", flush=True)
