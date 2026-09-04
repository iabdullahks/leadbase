#!/usr/bin/env python3
"""
MOTUS Above-4582560 Capped Scraper
============================================================================
Directly probes every USDOT number from 4582561 upward by hitting the
carrier detail endpoint for each one in parallel. Stops automatically
once MAX_LEADS carriers have been found (default: 3500).

Uses a rolling chunk approach: scans DOTs in batches of CHUNK_SIZE,
stops when we hit MAX_LEADS.

Usage:
  python -u scrape_above_4582560_capped.py

Output:
  carriers_above_4582560.csv
"""

import csv
import sys
import json
import time
import urllib.request
import urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed

# ── Config ────────────────────────────────────────────────────────────────────
START_DOT   = 4582561      # First USDOT to probe (inclusive)
MAX_LEADS   = 3500         # Stop once this many leads are collected (3-4k range)
CHUNK_SIZE  = 2000         # Number of DOTs to probe per batch
MAX_WORKERS = 60           # Parallel threads
OUTPUT_CSV  = "carriers_above_4582560.csv"

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
                return None   # DOT does not exist
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
    print("MOTUS ABOVE-4582560 CAPPED SCRAPER", flush=True)
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

    found       = 0       # Total leads written to CSV
    probed      = 0       # Total DOTs probed
    chunk_start = START_DOT

    with open(OUTPUT_CSV, "w", newline="", encoding="utf-8") as csvfile:
        writer = csv.DictWriter(csvfile, fieldnames=FIELDS, extrasaction="ignore")
        writer.writeheader()
        csvfile.flush()

        while found < MAX_LEADS:
            chunk_end = chunk_start + CHUNK_SIZE - 1
            dots = list(range(chunk_start, chunk_end + 1))
            print(
                "\n[Chunk] Probing USDOT {:,} to {:,} ({:,} DOTs) | Leads so far: {:,}".format(
                    chunk_start, chunk_end, len(dots), found
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
                        phone_str = row["Business Telephone No."][:14]
                        print(
                            "  [{:>4}] USDOT {}: {:<38} | Phone: {}".format(
                                found, dot, name_str, phone_str
                            ),
                            flush=True,
                        )

                        # Check cap
                        if found >= MAX_LEADS:
                            print(
                                "\n[DONE] Reached {:,} leads cap. Cancelling remaining futures.".format(MAX_LEADS),
                                flush=True,
                            )
                            for f in list(futures.keys()):
                                f.cancel()
                            stop_flag = True
                            break

                    if probed % 500 == 0:
                        print(
                            "  Probed {:,} total | Leads: {:,}".format(probed, found),
                            flush=True,
                        )

            print(
                "  Chunk finished. New leads: {:,} | Total: {:,} | Probed: {:,}".format(
                    chunk_found, found, probed
                ),
                flush=True,
            )

            if stop_flag or found >= MAX_LEADS:
                break

            chunk_start = chunk_end + 1

    print("\n" + sep, flush=True)
    print("FINAL SUMMARY", flush=True)
    print(sep, flush=True)
    print("  USDOT Start  : {:,}".format(START_DOT))
    print("  Total Probed : {:,}".format(probed))
    print("  Leads Saved  : {:,}".format(found))
    print("  Output File  : {}".format(OUTPUT_CSV))
    print(sep, flush=True)


if __name__ == "__main__":
    main()
