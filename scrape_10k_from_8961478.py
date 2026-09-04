#!/usr/bin/env python3
"""
MOTUS Capped Scraper - 10k leads starting from USDOT 8961478
============================================================================
Continues from where the previous run stopped (USDOT 8961477).
Stops automatically once MAX_LEADS carriers have been found.

Usage:
  python -u scrape_10k_from_8961478.py

Output:
  leads_10k_from_8961478.csv
"""

import csv
import sys
import json
import time
import urllib.request
import urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed

# ── Config ────────────────────────────────────────────────────────────────────
START_DOT   = 8961478      # Resume right after previous run stopped
MAX_LEADS   = 10000        # Stop once this many leads are collected
CHUNK_SIZE  = 3000         # Number of DOTs to probe per batch
MAX_WORKERS = 80           # Parallel threads
OUTPUT_CSV  = "leads_10k_from_8961478.csv"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept":     "application/json",
    "Referer":    "https://motus.dot.gov/",
    "Origin":     "https://motus.dot.gov",
}

# ── HTTP Helper ───────────────────────────────────────────────────────────────
def fetch_carrier(dot, retries=3):
    url = "https://motus.dot.gov/api/carriers/{}".format(dot)
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=12) as resp:
                return json.loads(resp.read().decode())
        except urllib.error.HTTPError as e:
            if e.code in (400, 404):
                return None
            if attempt < retries - 1:
                time.sleep(1.0 * (attempt + 1))
        except Exception:
            if attempt < retries - 1:
                time.sleep(0.5)
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

# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    if hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8")
        except Exception:
            pass

    sep = "=" * 70
    print(sep, flush=True)
    print("MOTUS 10K CAPPED SCRAPER - Resume from USDOT 8,961,478", flush=True)
    print("Start USDOT : {:,}".format(START_DOT), flush=True)
    print("Stop at     : {:,} leads collected".format(MAX_LEADS), flush=True)
    print("Chunk size  : {:,} DOTs per batch".format(CHUNK_SIZE), flush=True)
    print("Threads     : {}".format(MAX_WORKERS), flush=True)
    print("Output      : {}".format(OUTPUT_CSV), flush=True)
    print(sep, flush=True)

    FIELDS = [
        "USDOT Number", "Legal Business Name", "Business Telephone No.",
        "Business Email", "DOT Status", "Out of Service", "Update Date", "Create Date"
    ]

    found       = 0
    probed      = 0
    chunk_start = START_DOT
    start_time  = time.time()

    with open(OUTPUT_CSV, "w", newline="", encoding="utf-8") as csvfile:
        writer = csv.DictWriter(csvfile, fieldnames=FIELDS, extrasaction="ignore")
        writer.writeheader()
        csvfile.flush()

        while found < MAX_LEADS:
            chunk_end = chunk_start + CHUNK_SIZE - 1
            dots = list(range(chunk_start, chunk_end + 1))
            elapsed = time.time() - start_time
            print(
                "\n[Chunk] Probing USDOT {:,} to {:,} ({:,} DOTs) | Leads: {:,}/{:,} | Elapsed: {:.0f}s".format(
                    chunk_start, chunk_end, len(dots), found, MAX_LEADS, elapsed
                ),
                flush=True,
            )
            chunk_found = 0
            stop_flag   = False

            with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
                futures = {executor.submit(fetch_carrier, dot): dot for dot in dots}
                for future in as_completed(futures):
                    dot     = futures[future]
                    probed += 1
                    carrier = future.result()

                    if carrier:
                        found      += 1
                        chunk_found += 1
                        row = build_row(dot, carrier)
                        writer.writerow(row)
                        csvfile.flush()

                        name_str  = row["Legal Business Name"][:38]
                        phone_str = row["Business Telephone No."][:15]
                        print(
                            "  [{:>5}] USDOT {}: {:<38} | Phone: {}".format(
                                found, dot, name_str, phone_str
                            ),
                            flush=True,
                        )

                        if found >= MAX_LEADS:
                            elapsed = time.time() - start_time
                            print(
                                "\n[DONE] Reached {:,} leads cap after {:.0f}s. Cancelling remaining futures.".format(
                                    MAX_LEADS, elapsed
                                ),
                                flush=True,
                            )
                            for f in list(futures.keys()):
                                f.cancel()
                            stop_flag = True
                            break

                    if probed % 1000 == 0:
                        rate = found / max((time.time() - start_time) / 60, 0.01)
                        print(
                            "  Probed {:,} total | Leads: {:,} | Rate: {:.1f} leads/min".format(
                                probed, found, rate
                            ),
                            flush=True,
                        )

            print(
                "  Chunk done. New leads: {:,} | Total: {:,} | Probed: {:,}".format(
                    chunk_found, found, probed
                ),
                flush=True,
            )

            if stop_flag or found >= MAX_LEADS:
                break

            chunk_start = chunk_end + 1

    elapsed = time.time() - start_time
    print("\n" + sep, flush=True)
    print("FINAL SUMMARY", flush=True)
    print(sep, flush=True)
    print("  Start USDOT  : {:,}".format(START_DOT))
    print("  Last Probed  : ~{:,}".format(START_DOT + probed))
    print("  Total Probed : {:,}".format(probed))
    print("  Leads Saved  : {:,}".format(found))
    print("  Total Time   : {:.0f}s ({:.1f} min)".format(elapsed, elapsed / 60))
    print("  Output File  : {}".format(OUTPUT_CSV))
    print(sep, flush=True)


if __name__ == "__main__":
    main()
