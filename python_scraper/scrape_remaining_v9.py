#!/usr/bin/env python3
"""
MOTUS Scraper - High Speed Async Gap Scraper (v9)
============================================================================
Checks USDOT numbers starting from 4,582,560.
Strictly captures ONLY carriers that are NOT previously added into Supabase.
Upserts newly discovered carriers into Supabase 'carriers' table.
Appends each new lead in real time to unadded_leads_from_4582560_v9.csv.
"""

import csv
import os
import sys
import glob
import json
import time
import asyncio
import aiohttp
from datetime import datetime, timezone
from dotenv import load_dotenv

load_dotenv()

# ── Config ────────────────────────────────────────────────────────────────────
START_DOT   = 4582560
END_DOT     = 10200000
CHUNK_SIZE  = 5000         # Scan in chunks of 5,000 DOTs
CONCURRENCY = 300          # 300 concurrent async HTTP connections (reused TCP pool)
OUTPUT_CSV  = "unadded_leads_from_4582560_v9.csv"
STATE_FILE  = "motus_scraper_state_v9.json"

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

# ── Load Known DOTs from local CSVs ──────────────────────────────────────────
def load_known_dots():
    known = set()
    patterns = [
        "unadded_leads_from_4582560*.csv",
        "carriers_above_4582560*.csv",
        "new_leads_scraped.csv",
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
            except Exception as e:
                print(f"[!] Error reading {filepath}: {e}", flush=True)
    return known

# ── Supabase In-DB Check ──────────────────────────────────────────────────────
def check_dots_in_supabase(client, dots_list):
    """
    Given a list of integer dots, queries Supabase using in_ filter to check which ones exist.
    Returns a set of integer dots that are ALREADY in the database.
    """
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
        except Exception as e:
            print(f"[!] Supabase check error on chunk {i}: {e}", flush=True)
    return in_db

# ── Async HTTP Worker ─────────────────────────────────────────────────────────
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

# ── Main Async Runner ─────────────────────────────────────────────────────────
async def async_main():
    if hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8")
        except Exception:
            pass

    sep = "=" * 70
    print(sep, flush=True)
    print("MOTUS HIGH-SPEED ASYNC GAP SCRAPER v9 (UNADDED TO SUPABASE ONLY)", flush=True)
    print(f"Start USDOT : {START_DOT:,}", flush=True)
    print(f"End USDOT   : {END_DOT:,}", flush=True)
    print(f"Concurrency : {CONCURRENCY} (Async TCP Connection Reuse)", flush=True)
    print(f"Output File : {OUTPUT_CSV}", flush=True)
    print(sep, flush=True)

    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_ANON_KEY")
    client = None
    if url and key:
        try:
            from supabase import create_client
            client = create_client(url, key)
            print("[+] Successfully connected to Supabase client", flush=True)
        except Exception as e:
            print(f"[!] Warning: Could not connect to Supabase DB ({e}).", flush=True)

    # 1. Load known dots from local files
    known_dots = load_known_dots()
    print(f"[+] Loaded {len(known_dots):,} previously known USDOTs (>= 4,582,560) to skip probing", flush=True)

    # 2. Check if resuming from state file
    resume_dot = START_DOT
    if os.path.exists(STATE_FILE):
        try:
            with open(STATE_FILE, "r", encoding="utf-8") as sf:
                state_data = json.load(sf)
                if "current_dot" in state_data and state_data["current_dot"] > START_DOT:
                    resume_dot = state_data["current_dot"]
                    print(f"[+] Resuming from state file at USDOT: {resume_dot:,}", flush=True)
        except Exception as e:
            print(f"[!] Warning reading {STATE_FILE}: {e}", flush=True)

    # 3. Prepare CSV writer
    file_exists = os.path.exists(OUTPUT_CSV)
    csvfile = open(OUTPUT_CSV, "a" if file_exists else "w", newline="", encoding="utf-8")
    writer = csv.DictWriter(csvfile, fieldnames=FIELDS, extrasaction="ignore")
    if not file_exists:
        writer.writeheader()
        csvfile.flush()
    print(f"[+] Output CSV ready: {OUTPUT_CSV}", flush=True)

    chunk_start = resume_dot
    found_new = 0
    probed_count = 0
    start_time = time.time()

    semaphore = asyncio.Semaphore(CONCURRENCY)
    connector = aiohttp.TCPConnector(limit=CONCURRENCY + 50, ttl_dns_cache=300)

    print(f"[*] Beginning scan from USDOT {chunk_start:,} up to {END_DOT:,}...\n", flush=True)

    async with aiohttp.ClientSession(headers=HEADERS, connector=connector) as session:
        while chunk_start <= END_DOT:
            chunk_end = min(chunk_start + CHUNK_SIZE - 1, END_DOT)
            dots_to_probe = [dot for dot in range(chunk_start, chunk_end + 1) if dot not in known_dots]

            if not dots_to_probe:
                chunk_start = chunk_end + 1
                continue

            elapsed = time.time() - start_time
            rate = probed_count / max(elapsed / 60, 0.01) if probed_count > 0 else 0
            print(
                f"\n[Chunk] USDOT {chunk_start:,} to {chunk_end:,} | "
                f"Probing {len(dots_to_probe):,} unprobed | "
                f"New leads added: {found_new} | Speed: {rate:,.0f} DOTs/min | Elapsed: {elapsed:.0f}s",
                flush=True,
            )

            # Probe chunk asynchronously
            tasks = [fetch_carrier_async(session, semaphore, dot) for dot in dots_to_probe]
            carriers_found_in_chunk = []

            for future in asyncio.as_completed(tasks):
                dot, carrier = await future
                probed_count += 1

                if carrier:
                    carriers_found_in_chunk.append((dot, carrier))

                if probed_count % 5000 == 0:
                    curr_rate = probed_count / max((time.time() - start_time) / 60, 0.01)
                    print(f"  --> Probed {probed_count:,} DOTs | Found in chunk: {len(carriers_found_in_chunk)} | Speed: {curr_rate:,.0f} DOTs/min", flush=True)

            # Check found carriers against Supabase to strictly ensure they are NOT previously added
            if carriers_found_in_chunk:
                dots_found = [dot for dot, _ in carriers_found_in_chunk]
                existing_in_supabase = check_dots_in_supabase(client, dots_found)

                for dot, carrier in carriers_found_in_chunk:
                    if dot in existing_in_supabase:
                        known_dots.add(dot)
                        continue

                    # This carrier is NOT in Supabase! Add to DB and CSV
                    found_new += 1
                    row = build_row(dot, carrier)
                    writer.writerow(row)
                    csvfile.flush()

                    name_str = row["Legal Business Name"][:35]
                    phone_str = row["Business Telephone No."][:15]
                    email_str = row["Business Email"][:25]
                    print(f"  [+ NEW UNADDED LEAD #{found_new}] USDOT {dot}: {name_str:<35} | Phone: {phone_str:<15} | Email: {email_str}", flush=True)

                    known_dots.add(dot)

                    # Upsert to Supabase
                    if client:
                        try:
                            db_row = build_supabase_row(dot, carrier)
                            client.table("carriers").upsert(db_row, on_conflict="usdot_number").execute()
                        except Exception as ex:
                            print(f"    [DB ERR] Failed to upsert USDOT {dot}: {ex}", flush=True)

            # Update state file
            try:
                with open(STATE_FILE, "w", encoding="utf-8") as sf:
                    json.dump({
                        "current_dot": chunk_end + 1,
                        "total_probed": probed_count,
                        "total_new_added": found_new,
                        "updated_at": datetime.now(timezone.utc).isoformat()
                    }, sf, indent=2)
            except Exception:
                pass

            chunk_start = chunk_end + 1

    csvfile.close()

    print("\n" + sep, flush=True)
    print("FINISHED GAP SCAN v9", flush=True)
    print(sep, flush=True)
    print(f"  Total Probed : {probed_count:,}")
    print(f"  New Leads    : {found_new:,}")
    print(f"  Output CSV   : {OUTPUT_CSV}")
    print(sep, flush=True)

def main():
    asyncio.run(async_main())

if __name__ == "__main__":
    main()
