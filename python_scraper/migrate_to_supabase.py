#!/usr/bin/env python3
"""
Migrate all existing carriers from database.json to Supabase.
Retries failed records. Uses single worker for stability.
"""

import json
import os
import sys
from datetime import datetime

from supabase_db import upsert_carrier, get_carrier_count, is_enabled, log_sync_run, get_coverage_stats, get_history_stats

DB_FILE = "database.json"


def main():
    if not is_enabled():
        print("[!] Supabase not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env")
        sys.exit(1)

    if not os.path.exists(DB_FILE):
        print(f"[!] {DB_FILE} not found.")
        sys.exit(1)

    with open(DB_FILE, "r") as f:
        db = json.load(f)

    total = len(db)
    print(f"[*] Migrating {total} carriers to Supabase (single worker, with retry)...", flush=True)
    print(f"[*] Current Supabase count: {get_carrier_count()}", flush=True)

    start_time = datetime.now()
    failed_records = []

    for i, record in enumerate(db):
        if upsert_carrier(record, change_type="migrated"):
            pass
        else:
            failed_records.append(record)

        if (i + 1) % 100 == 0 or (i + 1) == total:
            elapsed = (datetime.now() - start_time).total_seconds()
            rate = (i + 1) / max(elapsed, 1)
            print(f"[*] Progress: {i + 1}/{total} | Failed so far: {len(failed_records)} | Rate: {rate:.1f}/sec", flush=True)

    # Retry failed records up to 3 passes
    for retry_pass in range(1, 4):
        if not failed_records:
            break
        print(f"[*] Retry pass {retry_pass}: {len(failed_records)} failed records...", flush=True)
        still_failed = []
        for record in failed_records:
            if not upsert_carrier(record, change_type="migrated", retries=5):
                still_failed.append(record)
        failed_records = still_failed

    end_time = datetime.now()
    duration = (end_time - start_time).total_seconds()
    success = total - len(failed_records)

    log_sync_run(
        run_type="migration",
        started_at=start_time.strftime("%Y-%m-%d %H:%M:%S"),
        completed_at=end_time.strftime("%Y-%m-%d %H:%M:%S"),
        duration_seconds=duration,
        stats={"total": total, "success": success, "failed": len(failed_records)},
        status="completed" if not failed_records else "partial",
    )

    print(f"\n[+] Migration complete!", flush=True)
    print(f"[+] Success: {success} | Failed: {len(failed_records)} | Duration: {duration:.1f}s", flush=True)
    print(f"[+] Coverage (1): {get_coverage_stats()}", flush=True)
    print(f"[+] History  (2): {get_history_stats()}", flush=True)


if __name__ == "__main__":
    main()
