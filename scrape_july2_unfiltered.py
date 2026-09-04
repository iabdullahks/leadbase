#!/usr/bin/env python3
"""
MOTUS LLC Unfiltered Update Scraper for 2 July 2026
============================================================================
Paginates through all LLC carriers in MOTUS in parallel and queries their details
using 100 threads to check if they were updated or created on 2026-07-02.
Does NOT apply any qualification filters (trucking, phone, status, out of service).

Usage:
  python -u scrape_july2_unfiltered.py
"""

import os
import csv
import sys
import json
import time
import urllib.request
import urllib.error
import urllib.parse
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor, as_completed

# ── Config ────────────────────────────────────────────────────────────────────
SEARCH_QUERY     = "LLC"           # The base query to scan LLC carriers
LIMIT            = 50              # API page size
MAX_PAGE_WORKERS = 25              # Parallel page fetchers (Phase 1)
MAX_WORKERS      = 100             # Parallel detail fetchers (Phase 2)
TARGET_DATE      = "2026-07-02"    # Target update date

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
    except urllib.error.HTTPError as e:
        return {"_error": e.code}
    except Exception as ex:
        return {"_error": str(ex)[:80]}

# ── MOTUS API Calls ───────────────────────────────────────────────────────────
def fetch_page(skip):
    url = (
        f"https://motus.dot.gov/api/carriers/search"
        f"?query={urllib.parse.quote(SEARCH_QUERY)}"
        f"&skip={skip}&limit={LIMIT}"
    )
    r = api_get(url)
    if "_error" in r:
        return [], 0
    return r.get("data", []), r.get("total", 0)

def fetch_carrier_detail(dot_number):
    return api_get(f"https://motus.dot.gov/api/carriers/{dot_number}")

# ── Date Helpers ──────────────────────────────────────────────────────────────
def parse_iso(s):
    if not s:
        return None
    try:
        s = s.replace("Z", "+00:00")
        if "." in s and ("+" in s or s.endswith("00:00")):
            base = s.split(".")[0]
            tz   = "+" + s.split("+")[1] if "+" in s else "+00:00"
            s    = base + tz
        return datetime.fromisoformat(s)
    except Exception:
        return None

# ── Candidate Processor ───────────────────────────────────────────────────────
def process_candidate(cand, target_dt):
    dot = cand["dot"]
    try:
        carrier = fetch_carrier_detail(dot)
        if not carrier or "_error" in carrier:
            return {"dot": dot, "status": "error"}

        created_str = carrier.get("createDate") or ""
        updated_str = carrier.get("updateDate") or ""
        
        created_dt = parse_iso(created_str)
        updated_dt = parse_iso(updated_str)
        
        is_target_day = False
        if created_dt and created_dt.date() == target_dt:
            is_target_day = True
        elif updated_dt and updated_dt.date() == target_dt:
            is_target_day = True

        if is_target_day:
            return {
                "dot": dot,
                "status": "match",
                "name": carrier.get("entityName") or "",
                "created": created_str,
                "updated": updated_str
            }
        return {"dot": dot, "status": "skip"}

    except Exception:
        return {"dot": dot, "status": "error"}

# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    import sys
    if hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding='utf-8')
        except Exception:
            pass

    target_dt = datetime.strptime(TARGET_DATE, "%Y-%m-%d").date()
    output_csv = f"updated_carriers_{TARGET_DATE.replace('-', '_')}.csv"

    print("=" * 65, flush=True)
    print(f"MOTUS LLC Unfiltered Date Scraper for {TARGET_DATE}", flush=True)
    print(f"Pagination size: {LIMIT} | Page Workers: {MAX_PAGE_WORKERS} | Detail Workers: {MAX_WORKERS}", flush=True)
    print("=" * 65, flush=True)

    # ── Phase 1: Collect candidates ───────────────────────────────────────
    print(f"\n[Phase 1] Fetching first page to check record count...", flush=True)
    first_page, total_records = fetch_page(0)
    if total_records == 0:
        print("[-] No records found or search failed.", flush=True)
        sys.exit(1)

    print(f"  Total LLCs in MOTUS: {total_records:,}", flush=True)
    total_pages = (total_records + LIMIT - 1) // LIMIT
    print(f"  Total pages to fetch: {total_pages:,}", flush=True)

    seen_dots = set()
    candidates = []

    # Process first page
    for rec in first_page:
        dot = str(rec.get("dotNumber") or "").strip()
        if dot:
            seen_dots.add(dot)
            candidates.append({"dot": dot})

    # Prepare remaining page skips
    skips = [skip for skip in range(LIMIT, total_records, LIMIT)]
    
    print(f"  Fetching remaining {len(skips)} pages in parallel...", flush=True)
    pages_done = 1

    with ThreadPoolExecutor(max_workers=MAX_PAGE_WORKERS) as executor:
        futures = {executor.submit(fetch_page, skip): skip for skip in skips}
        for future in as_completed(futures):
            skip = futures[future]
            results, _ = future.result()
            
            pages_done += 1
            if pages_done % 100 == 0 or pages_done == total_pages:
                print(f"    Progress: {pages_done}/{total_pages} pages fetched... Candidates: {len(candidates):,}", flush=True)

            for rec in results:
                dot = str(rec.get("dotNumber") or "").strip()
                if not dot or dot in seen_dots:
                    continue
                seen_dots.add(dot)
                candidates.append({"dot": dot})

    print(f"\nTotal candidates collected: {len(candidates):,}", flush=True)

    # ── Phase 2: Parallel check ────────────────────────────────────────────
    print(f"\n[Phase 2] Checking all candidates details in parallel...", flush=True)
    matches = []
    stats = {"total": 0, "matches": 0, "skip": 0, "error": 0}

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {executor.submit(process_candidate, c, target_dt): c for c in candidates}
        for future in as_completed(futures):
            stats["total"] += 1
            cand = futures[future]
            res  = future.result()

            pct = stats["total"] / len(candidates) * 100
            
            if stats["total"] % 1000 == 0 or stats["total"] == len(candidates):
                print(f"    Checked {stats['total']}/{len(candidates):,} ({pct:4.1f}%) carriers... Matches: {stats['matches']}", flush=True)

            if res["status"] == "match":
                stats["matches"] += 1
                matches.append(res)
                print(f"  [{stats['matches']}] [MATCH] USDOT {res['dot']}: {res['name'][:30]:30s} "
                      f"| Created: {res['created'][:16]} | Updated: {res['updated'][:16]}", flush=True)
            elif res["status"] == "error":
                stats["error"] += 1
            else:
                stats["skip"] += 1

    # ── Save CSV ───────────────────────────────────────────────────────────
    FIELDS = ["dot", "name", "created", "updated"]
    with open(output_csv, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDS, extrasaction='ignore')
        writer.writeheader()
        writer.writerows(matches)
    print(f"\n[+] Saved {len(matches)} carriers to {output_csv}", flush=True)

    print("\n" + "=" * 65, flush=True)
    print("FINAL SUMMARY", flush=True)
    print("=" * 65, flush=True)
    print(f"  Target Date:      {TARGET_DATE}")
    print(f"  Total Checked:    {stats['total']:,}")
    print(f"  Total Matches:    {stats['matches']:,}")
    print(f"  Skipped:          {stats['skip']:,}")
    print(f"  Errors:           {stats['error']:,}")


if __name__ == "__main__":
    main()
