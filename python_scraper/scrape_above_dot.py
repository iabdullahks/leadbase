#!/usr/bin/env python3
"""
MOTUS Above-DOT Multi-Query Scraper
============================================================================
Collects ALL carriers in MOTUS with USDOT > MIN_DOT by running multiple
single-letter search queries (A-Z) to cover the full database, then
saves every matching carrier. NO qualification filters applied.

Usage:
  python -u scrape_above_dot.py [MIN_DOT] [OUTPUT_CSV]

Examples:
  python -u scrape_above_dot.py 4582560 carriers_above_4582560.csv
"""

import csv
import sys
import json
import time
import urllib.request
import urllib.error
import urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed

# ── Config ────────────────────────────────────────────────────────────────────
MIN_DOT          = 4582560
OUTPUT_CSV       = "carriers_above_4582560.csv"
LIMIT            = 50
MAX_PAGE_WORKERS = 8    # Threads for page fetching per query
MAX_DETAIL_WORKERS = 40 # Threads for detail fetching

# Run all single letters + common words to cover full MOTUS database
SEARCH_QUERIES = list("ABCDEFGHIJKLMNOPQRSTUVWXYZ") + [
    "LLC", "INC", "CORP", "CO", "GROUP", "SERVICES", "TRANSPORT",
    "TRUCKING", "HAULING", "LOGISTICS", "EXPRESS", "FREIGHT"
]

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept":     "application/json",
    "Referer":    "https://motus.dot.gov/search",
    "Origin":     "https://motus.dot.gov",
}

# ── HTTP Helper ───────────────────────────────────────────────────────────────
def api_get(url, timeout=15):
    try:
        req = urllib.request.Request(url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError:
        return {"_error": True}
    except Exception:
        return {"_error": True}

def fetch_page(query, skip, retries=3):
    url = (
        f"https://motus.dot.gov/api/carriers/search"
        f"?query={urllib.parse.quote(query)}"
        f"&skip={skip}&limit={LIMIT}"
    )
    for attempt in range(retries):
        r = api_get(url)
        if "_error" not in r:
            return r.get("data", []), r.get("total", 0)
        time.sleep(1.5 * (attempt + 1))
    return [], 0

def fetch_carrier_detail(dot):
    r = api_get(f"https://motus.dot.gov/api/carriers/{dot}")
    return r if "_error" not in r else None

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

def build_row(carrier):
    return {
        "USDOT Number":           get_dot_number(carrier),
        "Legal Business Name":    get_legal_name(carrier),
        "Business Telephone No.": get_phone(carrier),
        "Business Email":         get_email(carrier),
        "DOT Status":             get_dot_status(carrier),
        "Out of Service":         str(carrier.get("outOfService", "")),
        "Update Date":            carrier.get("updateDate") or carrier.get("createDate") or "",
        "Create Date":            carrier.get("createDate") or "",
    }

# ── Phase 1: Collect all candidates above MIN_DOT from all queries ────────────
def collect_candidates(min_dot):
    seen_dots = set()
    candidates = []
    total_queries = len(SEARCH_QUERIES)

    for qi, query in enumerate(SEARCH_QUERIES):
        print(f"\n[Query {qi+1}/{total_queries}] '{query}' ...", flush=True)
        first_page, total = fetch_page(query, 0)
        if total == 0:
            print(f"  No results or timeout.", flush=True)
            continue

        total_pages = (total + LIMIT - 1) // LIMIT
        found_in_query = 0

        # Extract from first page
        for rec in first_page:
            dot = str(rec.get("dotNumber") or "").strip()
            try:
                dot_int = int(dot)
            except ValueError:
                continue
            if dot not in seen_dots and dot_int > min_dot:
                seen_dots.add(dot)
                candidates.append({"dot": dot, "dot_int": dot_int, "name": rec.get("entityName", "")})
                found_in_query += 1

        # Fetch remaining pages
        skips = list(range(LIMIT, total, LIMIT))
        with ThreadPoolExecutor(max_workers=MAX_PAGE_WORKERS) as executor:
            futures = {executor.submit(fetch_page, query, skip): skip for skip in skips}
            for future in as_completed(futures):
                results, _ = future.result()
                for rec in results:
                    dot = str(rec.get("dotNumber") or "").strip()
                    try:
                        dot_int = int(dot)
                    except ValueError:
                        continue
                    if dot not in seen_dots and dot_int > min_dot:
                        seen_dots.add(dot)
                        candidates.append({"dot": dot, "dot_int": dot_int, "name": rec.get("entityName", "")})
                        found_in_query += 1

        print(f"  Found {found_in_query} candidates above USDOT {min_dot:,} (total unique so far: {len(candidates):,})", flush=True)

    return candidates

# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    global MIN_DOT, OUTPUT_CSV

    if len(sys.argv) >= 2:
        try:
            MIN_DOT = int(sys.argv[1])
        except ValueError:
            pass
    if len(sys.argv) >= 3:
        OUTPUT_CSV = sys.argv[2]

    if hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding='utf-8')
        except Exception:
            pass

    print("=" * 65, flush=True)
    print("MOTUS ABOVE-DOT MULTI-QUERY SCRAPER (NO FILTERS)", flush=True)
    print(f"Collecting ALL carriers with USDOT > {MIN_DOT:,}", flush=True)
    print(f"Output: {OUTPUT_CSV}", flush=True)
    print("=" * 65, flush=True)

    # Phase 1: Collect candidates
    print(f"\n[Phase 1] Scanning MOTUS via {len(SEARCH_QUERIES)} queries...", flush=True)
    candidates = collect_candidates(MIN_DOT)
    candidates.sort(key=lambda x: x["dot_int"], reverse=True)

    print(f"\n{'='*65}", flush=True)
    print(f"Total unique carriers above USDOT {MIN_DOT:,}: {len(candidates):,}", flush=True)
    if candidates:
        print(f"  Highest USDOT: {candidates[0]['dot']} | {candidates[0]['name']}", flush=True)
        print(f"  Lowest  USDOT: {candidates[-1]['dot']} | {candidates[-1]['name']}", flush=True)

    # Phase 2: Fetch full details
    print(f"\n[Phase 2] Fetching full details for {len(candidates):,} carriers ({MAX_DETAIL_WORKERS} threads)...", flush=True)

    FIELDS = [
        "USDOT Number", "Legal Business Name", "Business Telephone No.",
        "Business Email", "DOT Status", "Out of Service", "Update Date", "Create Date"
    ]

    rows = []
    done = 0

    with open(OUTPUT_CSV, "w", newline="", encoding="utf-8") as csvfile:
        writer = csv.DictWriter(csvfile, fieldnames=FIELDS, extrasaction='ignore')
        writer.writeheader()

        with ThreadPoolExecutor(max_workers=MAX_DETAIL_WORKERS) as executor:
            futures_map = {executor.submit(fetch_carrier_detail, c["dot"]): c for c in candidates}
            for future in as_completed(futures_map):
                cand = futures_map[future]
                done += 1
                carrier = future.result()

                if carrier:
                    row = build_row(carrier)
                    writer.writerow(row)
                    csvfile.flush()
                    rows.append(row)
                    print(f"  [{len(rows)}] USDOT {cand['dot']}: {row['Legal Business Name'][:35]} | Phone: {row['Business Telephone No.']}", flush=True)

                if done % 200 == 0 or done == len(candidates):
                    pct = done / len(candidates) * 100
                    print(f"    Done: {done:,}/{len(candidates):,} ({pct:.1f}%) | Saved: {len(rows):,}", flush=True)

    print(f"\n[+] Complete! Saved {len(rows):,} carriers to {OUTPUT_CSV}", flush=True)
    print("=" * 65, flush=True)
    print("FINAL SUMMARY", flush=True)
    print("=" * 65, flush=True)
    print(f"  USDOT Threshold:  > {MIN_DOT:,}")
    print(f"  Candidates Found: {len(candidates):,}")
    print(f"  Records Saved:    {len(rows):,}")


if __name__ == "__main__":
    main()
