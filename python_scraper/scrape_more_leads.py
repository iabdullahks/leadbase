#!/usr/bin/env python3
"""
MOTUS Lead Expansion Master Script
============================================================================
Sequentially runs the chronological scraper for multiple keywords (INC, LTD, LOGISTICS, EXPRESS)
to collect more leads, then merges and deduplicates them with existing LLC leads
to produce a combined master file of the most recent leads.

Usage:
  python -u scrape_more_leads.py
"""

import os
import csv
import sys
import subprocess

# ── Config ────────────────────────────────────────────────────────────────────
KEYWORDS = ["INC", "LTD", "HAULER", "HAULERS", "DELIVERY", "COURIER", "SHIPPER", "SHIPPERS"]
TARGET_TOTAL_LEADS = 6500  # Target number of unique combined leads
COMBINED_CSV = "combined_recent_leads.csv"
LLC_CSV = "recent_leads_4000.csv"

def run_scraper(query, limit, filename):
    print("\n" + "=" * 65)
    print(f"RUNNING SCRAPER FOR: '{query}' (Saving to {filename})")
    print("=" * 65)
    try:
        # Run scrape_recent_leads.py as a subprocess
        cmd = [sys.executable, "scrape_recent_leads.py", query, str(limit), filename]
        subprocess.run(cmd, check=True)
        print(f"[+] Completed scrape for '{query}' successfully.")
    except Exception as e:
        print(f"[-] Scraper failed for query '{query}': {e}")

def read_csv_leads(filename):
    leads = []
    if not os.path.exists(filename):
        return leads
    try:
        with open(filename, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                leads.append(row)
    except Exception as e:
        print(f"Error reading {filename}: {e}")
    return leads

def main():
    print("=" * 65)
    print("MOTUS MULTI-TERM LEAD EXPANSION PROJECT")
    print("=" * 65)
    
    # 1. Scrape other terms to get more leads
    for kw in KEYWORDS:
        outfile = f"recent_leads_{kw.lower()}.csv"
        if os.path.exists(outfile) and os.path.getsize(outfile) > 100:
            print(f"\n[Info] Output file {outfile} already exists. Skipping scrape for '{kw}'.")
            continue
        # We target up to 800 leads per query to ensure we hit our combined target quickly
        run_scraper(kw, 800, outfile)

    # 2. Collect and combine all leads
    print("\n" + "=" * 65)
    print("COMBINING AND DEDUPLICATING LEADS")
    print("=" * 65)
    
    all_leads = []
    
    # Read the original LLC leads we already scraped
    if os.path.exists(LLC_CSV):
        llc_leads = read_csv_leads(LLC_CSV)
        print(f"Read {len(llc_leads):,} LLC leads from {LLC_CSV}")
        all_leads.extend(llc_leads)
    
    # Read the new keyword leads
    for kw in KEYWORDS:
        file = f"recent_leads_{kw.lower()}.csv"
        kw_leads = read_csv_leads(file)
        print(f"Read {len(kw_leads):,} leads from {file}")
        all_leads.extend(kw_leads)

    # Deduplicate leads by USDOT Number
    unique_leads = {}
    for lead in all_leads:
        usdot = lead.get("USDOT Number")
        if usdot:
            unique_leads[usdot] = lead

    print(f"\nTotal collected raw records:  {len(all_leads):,}")
    print(f"Total unique records:         {len(unique_leads):,}")

    # Sort descending by USDOT number (most recent first)
    sorted_leads = []
    for usdot, lead in unique_leads.items():
        try:
            int_dot = int(usdot)
            sorted_leads.append((int_dot, lead))
        except ValueError:
            continue

    sorted_leads.sort(key=lambda x: x[0], reverse=True)
    final_leads = [x[1] for x in sorted_leads]

    # Slice to target total
    final_leads = final_leads[:TARGET_TOTAL_LEADS]
    print(f"Slicing to top {len(final_leads):,} chronologically recent leads.")

    # Write the combined file
    FIELDS = [
        "USDOT Number", "Legal Business Name", "Business Telephone No.",
        "Business Email", "Program Status", "Program Exit Date", "Update Date", "Create Date"
    ]
    with open(COMBINED_CSV, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDS, extrasaction='ignore')
        writer.writeheader()
        writer.writerows(final_leads)

    print(f"\n[+] Master combined file saved to: {COMBINED_CSV} ({len(final_leads):,} leads)")
    print("=" * 65)


if __name__ == "__main__":
    main()
