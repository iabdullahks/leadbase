#!/usr/bin/env python3
"""
MOTUS Broker Expansion Script
============================================================================
Runs the broker scraper (Active DOT + Active MC + No Phone) across multiple
specific broker keywords to discover more leads, then combines and deduplicates them.
Saves progress incrementally after each keyword loop.

Keywords: BROKERAGE, BROKERS, FREIGHT BROKER, LOGISTICS BROKER, DISPATCH, LOGISTICS, FREIGHT, SHIPPING

Usage:
  python -u scrape_more_brokers.py
"""

import os
import csv
import sys
import subprocess

KEYWORDS = [
    "BROKERAGE", 
    "BROKERS", 
    "FREIGHT BROKER", 
    "LOGISTICS BROKER", 
    "DISPATCH", 
    "LOGISTICS", 
    "FREIGHT", 
    "SHIPPING"
]
COMBINED_CSV = "broker_no_phone_leads.csv"

def run_scraper(query, limit, filename):
    print("\n" + "=" * 70)
    print(f"RUNNING BROKER SCRAPER FOR: '{query}'")
    print("=" * 70)
    try:
        # Run scrape_broker_no_phone.py as a subprocess
        cmd = [sys.executable, "scrape_broker_no_phone.py", query, str(limit), filename]
        subprocess.run(cmd, check=True)
        print(f"[+] Completed broker scrape for '{query}'.")
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

def write_combined_leads(leads):
    # Sort descending by USDOT Number (most recent first)
    try:
        leads.sort(key=lambda x: int(x.get("USDOT Number", 0)), reverse=True)
    except Exception:
        pass

    FIELDS = [
        "USDOT Number", "MC Number", "MC Status",
        "Legal Business Name", "DBA Name",
        "Business Telephone No.", "Business Email", "Address",
        "DOT Status", "Out of Service", "Update Date", "Create Date", "Profile URL",
    ]

    with open(COMBINED_CSV, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDS, extrasaction='ignore')
        writer.writeheader()
        writer.writerows(leads)
    print(f"[*] Updated master leads file: {COMBINED_CSV} ({len(leads):,} total unique leads)", flush=True)

def main():
    if hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8")
        except Exception:
            pass

    print("=" * 70)
    print("MOTUS BROKER EXPANSION WORKFLOW")
    print("=" * 70)

    # Load existing leads if any
    unique_leads = {}
    if os.path.exists(COMBINED_CSV):
        existing_leads = read_csv_leads(COMBINED_CSV)
        print(f"[*] Loaded {len(existing_leads):,} existing broker leads from {COMBINED_CSV}")
        for lead in existing_leads:
            usdot = lead.get("USDOT Number")
            if usdot:
                unique_leads[usdot] = lead

    # Run scraper for each keyword
    for kw in KEYWORDS:
        temp_file = f"temp_broker_{kw.lower().replace(' ', '_')}.csv"
        # Run and target up to 500 leads per query
        run_scraper(kw, 500, temp_file)
        
        # Read new candidates
        new_leads = read_csv_leads(temp_file)
        print(f"[+] Found {len(new_leads):,} candidates for '{kw}'")
        
        # Add to unique dict
        new_added = 0
        for lead in new_leads:
            usdot = lead.get("USDOT Number")
            if usdot and usdot not in unique_leads:
                unique_leads[usdot] = lead
                new_added += 1

        print(f"[+] Added {new_added:,} new unique leads from '{kw}'")

        # Save incrementally
        write_combined_leads(list(unique_leads.values()))

        # Clean up temp file
        if os.path.exists(temp_file):
            try:
                os.remove(temp_file)
            except Exception:
                pass

    print("\n" + "=" * 70)
    print("EXPANSION COMPLETE")
    print("=" * 70)
    print(f"  Total Unique Broker Leads Saved: {len(unique_leads):,}")
    print(f"  Output File:                     {COMBINED_CSV}")
    print("=" * 70, flush=True)

if __name__ == "__main__":
    main()
