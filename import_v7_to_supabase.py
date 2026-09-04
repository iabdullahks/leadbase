#!/usr/bin/env python3
import csv, os, sys, time
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor, as_completed
from dotenv import load_dotenv
load_dotenv()

CSV_FILE    = "unadded_leads_from_4582560_v7.csv"
MAX_WORKERS = 10
BATCH_SIZE  = 100

def get_client():
    url = os.getenv("SUPABASE_URL","").strip()
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY","").strip()
    if not url or not key:
        print("[!] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env"); sys.exit(1)
    from supabase import create_client
    c = create_client(url, key)
    print(f"[OK] Connected to Supabase: {url}", flush=True)
    return c

def parse_bool(v):
    return str(v).strip().lower() in ("true","1","yes")

def parse_dt(v):
    if not v or not str(v).strip(): return None
    s = str(v).strip()
    try:
        dt = datetime.fromisoformat(s.replace("Z","+00:00"))
        if dt.tzinfo is None: dt = dt.replace(tzinfo=timezone.utc)
        return dt.isoformat()
    except: return None

def csv_row_to_db(row):
    usdot = str(row.get("USDOT Number") or "").strip()
    if not usdot or not usdot.isdigit(): return None
    cd = parse_dt(row.get("Create Date") or row.get("Update Date"))
    ud = parse_dt(row.get("Update Date") or row.get("Create Date"))
    return {
        "usdot_number": usdot,
        "legal_name": (row.get("Legal Business Name") or "").strip(),
        "phone": (row.get("Business Telephone No.") or "").strip(),
        "email": (row.get("Business Email") or "").strip(),
        "carrier_status": (row.get("DOT Status") or "Active").strip(),
        "out_of_service": parse_bool(row.get("Out of Service") or False),
        "added_to_motus": cd, "motus_entry_date": cd, "motus_last_updated": ud,
        "scraped_at": datetime.now(timezone.utc).isoformat(),
        "profile_url": f"https://motus.dot.gov/customer/{usdot}/account",
        "dba_name":"","principal_address":"","mailing_address":"","duns":"",
        "form_of_business":"","state_incorporated":"","new_entrant_status":"",
        "raw_data":{"source":"v7_csv_import","usdot_number":usdot}
    }

def load_records():
    if not os.path.exists(CSV_FILE): print(f"[!] Not found: {CSV_FILE}"); sys.exit(1)
    recs = {}
    with open(CSV_FILE,"r",encoding="utf-8",errors="ignore") as f:
        for row in csv.DictReader(f):
            r = csv_row_to_db(row)
            if r: recs[r["usdot_number"]] = r
    print(f"[+] Loaded {len(recs):,} unique records from {CSV_FILE}", flush=True)
    return list(recs.values())

def upsert_batch(client, batch, bn):
    for attempt in range(3):
        try:
            client.table("carriers").upsert(batch, on_conflict="usdot_number").execute()
            return len(batch), 0
        except Exception as e:
            if attempt < 2: time.sleep(2*(attempt+1))
            else: print(f"  [ERR] Batch {bn}: {str(e)[:120]}", flush=True); return 0, len(batch)
    return 0, len(batch)

def main():
    sep = "="*65
    print(sep); print("SUPABASE IMPORTER - unadded_leads_from_4582560_v7.csv"); print(sep)
    client = get_client()
    try:
        ex = client.table("carriers").select("usdot_number",count="exact").execute()
        print(f"[*] Current carriers in DB: {ex.count or 0:,}", flush=True)
    except Exception as e: print(f"[!] Count error: {e}", flush=True)
    records = load_records()
    if not records: print("[!] No records. Exiting."); return
    batches = [records[i:i+BATCH_SIZE] for i in range(0,len(records),BATCH_SIZE)]
    print(f"\n[2] Upserting {len(records):,} records in {len(batches):,} batches (workers={MAX_WORKERS})...", flush=True)
    t0=time.time(); ok=0; fail=0; done=0
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as ex:
        futs={ex.submit(upsert_batch,client,b,i):i for i,b in enumerate(batches)}
        for f in as_completed(futs):
            o,fl=f.result(); ok+=o; fail+=fl; done+=1
            if done%10==0 or done==len(batches):
                el=time.time()-t0; rate=ok/max(el,1); pct=done/len(batches)*100
                print(f"  {done}/{len(batches)} batches ({pct:.1f}%) | Upserted:{ok:,} | Failed:{fail:,} | {rate:.0f}/s", flush=True)
    el=time.time()-t0
    try: fc=f"{client.table('carriers').select('usdot_number',count='exact').execute().count or 0:,}"
    except: fc="N/A"
    print(f"\n{sep}\nFINAL SUMMARY\n{sep}")
    print(f"  CSV Records  : {len(records):,}")
    print(f"  Upserted     : {ok:,}")
    print(f"  Failed       : {fail:,}")
    print(f"  Time         : {el:.1f}s ({el/60:.1f} min)")
    print(f"  Final DB cnt : {fc}")
    print(sep)

if __name__=="__main__": main()
