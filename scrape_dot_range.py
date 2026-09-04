#!/usr/bin/env python3
"""
MOTUS Direct DOT Range Scraper
============================================================================
Directly probes every USDOT number from START_DOT upward by hitting the
carrier detail endpoint for each one. NO search query involved, NO filters.
Captures every carrier that exists above the threshold.

Usage:
  python -u scrape_dot_range.py [START_DOT] [END_DOT] [OUTPUT_CSV]

Examples:
  python -u scrape_dot_range.py 4582561 4700000 carriers_above_4582560.csv
"""

import csv
import sys
import json
import urllib.request
import urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed

# ── Config ────────────────────────────────────────────────────────────────────
START_DOT   = 4582561    # First USDOT to check (inclusive)
END_DOT     = 4700000    # Last USDOT to check (inclusive)
OUTPUT_CSV  = "carriers_above_4582560.csv"
MAX_WORKERS = 50         # Parallel threads

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept":     "application/json",
    "Referer":    "https://motus.dot.gov/",
}

# ── HTTP Helper ───────────────────────────────────────────────────────────────
def fetch_carrier(dot):
    url = f"https://motus.dot.gov/api/carriers/{dot}"
    try:
        req = urllib.request.Request(url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        if e.code == 400:
            return None   # Does not exist
        return None
    except Exception:
        return None

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
    dot = carrier.get("entityDotNumber") or {}
    return str(dot.get("dotNumber") or carrier.get("entityId") or "")

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

# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    global START_DOT, END_DOT, OUTPUT_CSV

    if len(sys.argv) >= 2:
        try:
            START_DOT = int(sys.argv[1])
        except ValueError:
            pass
    if len(sys.argv) >= 3:
        try:
            END_DOT = int(sys.argv[2])
        except ValueError:
            pass
    if len(sys.argv) >= 4:
        OUTPUT_CSV = sys.argv[3]

    if hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding='utf-8')
        except Exception:
            pass

    total_range = END_DOT - START_DOT + 1
    print("=" * 65, flush=True)
    print("MOTUS DIRECT DOT-RANGE SCRAPER (NO FILTERS)", flush=True)
    print(f"Scanning USDOT {START_DOT:,} to {END_DOT:,} ({total_range:,} DOTs)", flush=True)
    print(f"Threads: {MAX_WORKERS} | Output: {OUTPUT_CSV}", flush=True)
    print("=" * 65, flush=True)

    dots = list(range(START_DOT, END_DOT + 1))
    rows = []
    done = 0
    found = 0

    FIELDS = [
        "USDOT Number", "Legal Business Name", "Business Telephone No.",
        "Business Email", "DOT Status", "Out of Service", "Update Date", "Create Date"
    ]

    # Open CSV for streaming writes
    with open(OUTPUT_CSV, "w", newline="", encoding="utf-8") as csvfile:
        writer = csv.DictWriter(csvfile, fieldnames=FIELDS, extrasaction='ignore')
        writer.writeheader()

        with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
            futures = {executor.submit(fetch_carrier, dot): dot for dot in dots}
            for future in as_completed(futures):
                dot = futures[future]
                done += 1
                carrier = future.result()

                if carrier:
                    found += 1
                    row = build_row(dot, carrier)
                    writer.writerow(row)
                    csvfile.flush()
                    print(f"  [{found}] USDOT {dot}: {row['Legal Business Name'][:40]} | Phone: {row['Business Telephone No.']}", flush=True)

                if done % 1000 == 0 or done == total_range:
                    pct = done / total_range * 100
                    print(f"  Progress: {done:,}/{total_range:,} ({pct:.1f}%) | Found: {found:,}", flush=True)

    print(f"\n[+] Done. Saved {found:,} carriers to {OUTPUT_CSV}", flush=True)
    print(f"    Range: USDOT {START_DOT:,} – {END_DOT:,}", flush=True)


if __name__ == "__main__":
    main()
