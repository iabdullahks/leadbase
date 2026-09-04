#!/usr/bin/env python3
"""Test both requirements: (1) MOTUS day-1 coverage, (2) historical change tracking."""

import json
from datetime import datetime

from supabase_db import (
    is_enabled, upsert_carrier, get_coverage_stats, get_history_stats,
    compute_field_diffs, MOTUS_DAY_ONE,
)


def test_diff():
    old = {"business_information": {"Legal Business Name": "ACME"}, "drivers": [{"Interstate": "1"}]}
    new = {"business_information": {"Legal Business Name": "ACME LLC"}, "drivers": [{"Interstate": "2"}]}
    diffs = compute_field_diffs(old, new)
    assert len(diffs) >= 2, f"Expected >=2 diffs, got {len(diffs)}"
    print("[PASS] Field diff computation:", len(diffs), "changes detected")


def test_unchanged_history():
    """Requirement (2): unchanged re-check creates scrape_history entry."""
    record = {
        "usdot_number": "999999001",
        "added_to_motus": "2026-05-16T12:00:00+00:00",
        "carrier_status": "Active",
        "out_of_service": False,
        "scraped_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "data": {
            "usdot_number": "999999001",
            "profile_url": "https://motus.dot.gov/customer/999999001/account",
            "added_to_motus": "2026-05-16T12:00:00+00:00",
            "carrier_status": "Active",
            "out_of_service": False,
            "business_information": {"Legal Business Name": "TEST CARRIER 999999001"},
            "company_officials": [],
            "cargo_classification": [],
            "vehicles": [],
            "drivers": [],
            "new_entrant_program": {},
        },
    }
    assert upsert_carrier(record, "new"), "Initial insert failed"
    assert upsert_carrier(record, "unchanged", record["data"]), "Unchanged history log failed"
    print("[PASS] Unchanged re-check logged to scrape_history")


def test_updated_diff():
    """Requirement (2): update creates field-level change records."""
    old_data = record = {
        "usdot_number": "999999002",
        "added_to_motus": "2026-05-16T12:00:00+00:00",
        "carrier_status": "Active",
        "out_of_service": False,
        "scraped_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "data": {
            "usdot_number": "999999002",
            "profile_url": "https://motus.dot.gov/customer/999999002/account",
            "added_to_motus": "2026-05-16T12:00:00+00:00",
            "carrier_status": "Active",
            "out_of_service": False,
            "business_information": {"Legal Business Name": "BEFORE NAME"},
            "company_officials": [],
            "cargo_classification": [],
            "vehicles": [],
            "drivers": [],
            "new_entrant_program": {},
        },
    }
    assert upsert_carrier(record, "new"), "Initial insert failed"

    new_record = json.loads(json.dumps(record))
    new_record["data"]["business_information"]["Legal Business Name"] = "AFTER NAME"
    new_record["scraped_at"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    assert upsert_carrier(new_record, "updated", old_data["data"]), "Update with diff failed"
    print("[PASS] Update logged with field-level diffs")


def test_coverage():
    """Requirement (1): carriers since MOTUS day 1."""
    stats = get_coverage_stats()
    assert stats.get("total_carriers", 0) > 0, "No carriers in Supabase"
    assert stats.get("motus_day_one") == MOTUS_DAY_ONE
    print(f"[PASS] Coverage (1): {stats}")


def test_history():
    """Requirement (2): scrape_history exists."""
    stats = get_history_stats()
    assert stats.get("scrape_history_rows", 0) > 0, "No scrape_history rows"
    print(f"[PASS] History (2): {stats}")


def main():
    if not is_enabled():
        print("[FAIL] Supabase not configured")
        return 1

    print("=" * 60)
    print("Testing MOTUS Supabase: Requirements (1) + (2)")
    print("=" * 60)

    test_diff()
    test_unchanged_history()
    test_updated_diff()
    test_coverage()
    test_history()

    print("\n[+] All tests passed!")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
