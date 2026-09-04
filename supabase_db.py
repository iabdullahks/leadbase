"""
Supabase database layer for MOTUS DOT scraper.
Saves all carrier data with date/time from MOTUS day 1 through present.

Supports:
  (1) Full carrier coverage filtered by added_to_motus (MOTUS day 1 → now)
  (2) Historical tracking via scrape_history + carrier_field_changes
"""

import json
import os
import threading
from datetime import datetime, timezone
from typing import Optional

from dotenv import load_dotenv

load_dotenv()

# MOTUS launch — earliest registration date in the system
MOTUS_DAY_ONE = "2026-05-16T00:00:00+00:00"

_client = None
_client_lock = threading.Lock()
_thread_local = threading.local()
_enabled = None


def _get_client():
    global _client, _enabled
    if _enabled is False:
        return None
    if hasattr(_thread_local, "client") and _thread_local.client is not None:
        return _thread_local.client
    with _client_lock:
        if _enabled is False:
            return None
        if _client is None:
            url = os.getenv("SUPABASE_URL", "").strip()
            key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()
            if not url or not key:
                _enabled = False
                print("[SUPABASE] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Supabase sync disabled.")
                return None
            try:
                from supabase import create_client
                _client = create_client(url, key)
                _enabled = True
                print("[SUPABASE] Connected successfully.")
            except Exception as e:
                _enabled = False
                print(f"[SUPABASE] Failed to connect: {e}")
                return None
        _thread_local.client = _client
        return _thread_local.client


def is_enabled():
    return _get_client() is not None


def parse_datetime(value) -> Optional[str]:
    """Convert various date/time formats to ISO 8601 timestamptz string."""
    if not value:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.isoformat()
    s = str(value).strip()
    if not s:
        return None
    for fmt in (
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%dT%H:%M:%S.%f%z",
        "%Y-%m-%dT%H:%M:%S%z",
        "%Y-%m-%dT%H:%M:%S.%f",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d",
    ):
        try:
            if fmt.endswith("%z"):
                dt = datetime.strptime(s, fmt)
            else:
                dt = datetime.strptime(s.replace("+00:00", ""), fmt.replace("%z", ""))
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.isoformat()
        except ValueError:
            continue
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.isoformat()
    except ValueError:
        return None


def _safe_int(val, default=0):
    try:
        if val is None or val == "":
            return default
        return int(val)
    except (ValueError, TypeError):
        return default


def _build_carrier_row(record: dict) -> dict:
    """Build carriers table row from app record format."""
    data = record.get("data") or record
    biz = data.get("business_information") or {}
    nep = data.get("new_entrant_program") or {}

    scraped_at = parse_datetime(record.get("scraped_at")) or datetime.now(timezone.utc).isoformat()
    added_to_motus = parse_datetime(
        record.get("added_to_motus")
        or data.get("added_to_motus")
        or data.get("motus_entry_date")
    )
    motus_entry_date = parse_datetime(
        data.get("motus_entry_date")
        or record.get("motus_entry_date")
        or record.get("added_to_motus")
        or data.get("added_to_motus")
    )
    motus_last_updated = parse_datetime(
        data.get("motus_last_updated") or record.get("motus_last_updated")
    )

    return {
        "usdot_number": str(record.get("usdot_number") or data.get("usdot_number")),
        "legal_name": biz.get("Legal Business Name") or "",
        "dba_name": biz.get("Doing Business As (DBA) Name") or "",
        "profile_url": data.get("profile_url") or f"https://motus.dot.gov/customer/{record.get('usdot_number')}/account",
        "added_to_motus": added_to_motus,
        "motus_entry_date": motus_entry_date,
        "motus_last_updated": motus_last_updated,
        "carrier_status": record.get("carrier_status") or data.get("carrier_status") or "Active",
        "out_of_service": bool(record.get("out_of_service") or data.get("out_of_service") or False),
        "scraped_at": scraped_at,
        "principal_address": biz.get("Principal Place of Business") or "",
        "mailing_address": biz.get("Mailing Address") or "",
        "phone": biz.get("Business Telephone No.") or biz.get("Business Telephone No") or "",
        "email": biz.get("Business Email") or "",
        "duns": biz.get("Duns & Bradstreet") or "",
        "form_of_business": biz.get("Form of Business") or "",
        "state_incorporated": biz.get("State Incorporated") or "",
        "new_entrant_status": nep.get("Program Status") or "",
        "raw_data": data,
    }


def _insert_related(client, carrier_id: int, usdot: str, data: dict):
    """Insert officials, cargo, vehicles, drivers for a carrier."""
    usdot = str(usdot)

    officials = data.get("company_officials") or []
    if officials:
        rows = [{
            "carrier_id": carrier_id,
            "usdot_number": usdot,
            "official_name": o.get("Official Name") or "",
            "title": o.get("Title") or "",
            "phone": o.get("Telephone No") or o.get("Telephone No.") or "",
            "email": o.get("Email") or "",
        } for o in officials]
        client.table("company_officials").insert(rows).execute()

    cargo = data.get("cargo_classification") or []
    if cargo:
        rows = [{
            "carrier_id": carrier_id,
            "usdot_number": usdot,
            "classification": c,
        } for c in cargo if c]
        if rows:
            client.table("cargo_classifications").insert(rows).execute()

    vehicles = data.get("vehicles") or []
    if vehicles:
        rows = [{
            "carrier_id": carrier_id,
            "usdot_number": usdot,
            "vehicle_type": v.get("Vehicle Type") or "",
            "owned": _safe_int(v.get("Owned")),
            "term_leased": _safe_int(v.get("Term Leased")),
        } for v in vehicles]
        client.table("vehicles").insert(rows).execute()

    drivers = data.get("drivers") or []
    if drivers:
        rows = [{
            "carrier_id": carrier_id,
            "usdot_number": usdot,
            "driver_info": d.get("Driver Information") or "",
            "interstate": _safe_int(d.get("Interstate")),
            "intrastate": _safe_int(d.get("Intrastate")),
        } for d in drivers]
        client.table("drivers").insert(rows).execute()


def _delete_related(client, carrier_id: int):
    """Remove child records before re-inserting on update."""
    for table in ("company_officials", "cargo_classifications", "vehicles", "drivers"):
        client.table(table).delete().eq("carrier_id", carrier_id).execute()


def _flatten_for_diff(obj, prefix=""):
    """Flatten nested dict/list into dot-path keys for diff comparison."""
    items = {}
    if isinstance(obj, dict):
        for k, v in obj.items():
            path = f"{prefix}.{k}" if prefix else k
            items.update(_flatten_for_diff(v, path))
    elif isinstance(obj, list):
        items[prefix] = json.dumps(obj, sort_keys=True)
    else:
        items[prefix] = "" if obj is None else str(obj)
    return items


def compute_field_diffs(old_data: dict, new_data: dict) -> list:
    """Return list of {field_path, old_value, new_value} for changed fields."""
    old_flat = _flatten_for_diff(old_data or {})
    new_flat = _flatten_for_diff(new_data or {})
    all_keys = set(old_flat) | set(new_flat)
    diffs = []
    for key in sorted(all_keys):
        ov = old_flat.get(key, "")
        nv = new_flat.get(key, "")
        if ov != nv:
            diffs.append({"field_path": key, "old_value": ov, "new_value": nv})
    return diffs


def _log_history_and_diffs(client, carrier_id, row, data, change_type, old_data=None):
    """Write scrape_history row and field-level diffs when data changed."""
    hist = client.table("scrape_history").insert({
        "usdot_number": row["usdot_number"],
        "carrier_id": carrier_id,
        "scraped_at": row["scraped_at"],
        "added_to_motus": row["added_to_motus"],
        "motus_entry_date": row.get("motus_entry_date"),
        "motus_last_updated": row.get("motus_last_updated"),
        "change_type": change_type,
        "carrier_status": row["carrier_status"],
        "out_of_service": row["out_of_service"],
        "raw_data": data,
    }).execute()

    history_id = hist.data[0]["id"] if hist.data else None

    if change_type == "updated" and old_data and history_id:
        diffs = compute_field_diffs(old_data, data)
        if diffs:
            rows = [{
                "usdot_number": row["usdot_number"],
                "carrier_id": carrier_id,
                "scrape_history_id": history_id,
                "field_path": d["field_path"],
                "old_value": d["old_value"],
                "new_value": d["new_value"],
            } for d in diffs]
            # Insert in chunks of 100 to avoid payload limits
            for i in range(0, len(rows), 100):
                client.table("carrier_field_changes").insert(rows[i:i + 100]).execute()


def upsert_carrier(record: dict, change_type: str = "new", old_data: dict = None, retries: int = 3) -> bool:
    """
    Upsert carrier into Supabase and log scrape_history (+ field diffs on update).
    change_type: new | updated | unchanged | migrated | sync
    """
    import time as _time
    for attempt in range(retries):
        client = _get_client()
        if not client:
            return False
        try:
            row = _build_carrier_row(record)
            usdot = row["usdot_number"]
            data = record.get("data") or record

            existing = client.table("carriers").select("id").eq("usdot_number", usdot).execute()
            carrier_id = existing.data[0]["id"] if existing.data else None

            if change_type == "unchanged" and carrier_id:
                # (2) History only — record that we re-checked, data identical
                client.table("carriers").update({"scraped_at": row["scraped_at"]}).eq("id", carrier_id).execute()
                _log_history_and_diffs(client, carrier_id, row, data, "unchanged")
                return True

            if carrier_id:
                _delete_related(client, carrier_id)

            result = client.table("carriers").upsert(row, on_conflict="usdot_number").execute()
            carrier_id = result.data[0]["id"] if result.data else carrier_id

            if carrier_id:
                _insert_related(client, carrier_id, usdot, data)
                _log_history_and_diffs(client, carrier_id, row, data, change_type, old_data)

            return True
        except Exception as e:
            if attempt < retries - 1:
                _time.sleep(2 * (attempt + 1))
                continue
            print(f"[SUPABASE] upsert_carrier failed for {record.get('usdot_number')}: {e}")
            return False
    return False


def upsert_carriers_batch(records: list, change_type: str = "new") -> dict:
    """Batch upsert multiple carriers. Returns stats dict."""
    stats = {"success": 0, "failed": 0}
    for record in records:
        if upsert_carrier(record, change_type):
            stats["success"] += 1
        else:
            stats["failed"] += 1
    return stats


def log_sync_run(run_type: str, started_at: str, completed_at: str,
                 duration_seconds: float, stats: dict, status: str = "completed") -> Optional[int]:
    """Log a sync/bulk scrape run to sync_runs table."""
    client = _get_client()
    if not client:
        return None
    try:
        result = client.table("sync_runs").insert({
            "run_type": run_type,
            "started_at": parse_datetime(started_at),
            "completed_at": parse_datetime(completed_at),
            "duration_seconds": duration_seconds,
            "stats": stats,
            "status": status,
        }).execute()
        if result.data:
            return result.data[0]["id"]
    except Exception as e:
        print(f"[SUPABASE] log_sync_run failed: {e}")
    return None


def sync_carrier_async(record: dict, change_type: str = "new", old_data: dict = None):
    """Fire-and-forget background sync to Supabase."""
    def _run():
        upsert_carrier(record, change_type, old_data)
    threading.Thread(target=_run, daemon=True).start()


def get_coverage_stats() -> dict:
    """Return stats for requirement (1): MOTUS day 1 → now coverage."""
    client = _get_client()
    if not client:
        return {}
    try:
        total = client.table("carriers").select("id", count="exact").execute().count or 0
        since_day1 = client.table("carriers").select("id", count="exact").gte(
            "added_to_motus", MOTUS_DAY_ONE
        ).execute().count or 0
        return {
            "total_carriers": total,
            "since_motus_day_one": since_day1,
            "motus_day_one": MOTUS_DAY_ONE,
        }
    except Exception:
        return {}


def get_history_stats() -> dict:
    """Return stats for requirement (2): historical change tracking."""
    client = _get_client()
    if not client:
        return {}
    try:
        history = client.table("scrape_history").select("change_type", count="exact").execute()
        changes = client.table("carrier_field_changes").select("id", count="exact").execute()
        return {
            "scrape_history_rows": history.count or 0,
            "field_change_rows": changes.count or 0,
        }
    except Exception:
        return {}


def get_carrier_count() -> int:
    """Return total carriers in Supabase."""
    client = _get_client()
    if not client:
        return 0
    try:
        result = client.table("carriers").select("id", count="exact").execute()
        return result.count or 0
    except Exception:
        return 0


def _row_to_summary(row: dict) -> dict:
    """Convert Supabase carriers row to API summary dict."""
    return {
        "usdot_number": row["usdot_number"],
        "legal_name": row.get("legal_name") or "Unknown Carrier",
        "added_to_motus": row.get("added_to_motus") or row.get("motus_entry_date") or "",
        "motus_entry_date": row.get("motus_entry_date") or row.get("added_to_motus") or "",
        "motus_last_updated": row.get("motus_last_updated") or "",
        "carrier_status": row.get("carrier_status") or "Active",
        "out_of_service": bool(row.get("out_of_service") or False),
        "scraped_at": row.get("scraped_at") or "",
    }


def _row_to_record(row: dict) -> dict:
    """Convert Supabase carriers row to full app record format."""
    raw = row.get("raw_data") or {}
    if isinstance(raw, str):
        import json as _json
        try:
            raw = _json.loads(raw)
        except Exception:
            raw = {}
    return {
        "usdot_number": row["usdot_number"],
        "added_to_motus": row.get("added_to_motus") or row.get("motus_entry_date") or "",
        "motus_entry_date": row.get("motus_entry_date") or row.get("added_to_motus") or "",
        "motus_last_updated": row.get("motus_last_updated") or "",
        "carrier_status": row.get("carrier_status") or "Active",
        "out_of_service": bool(row.get("out_of_service") or False),
        "scraped_at": row.get("scraped_at") or "",
        "data": raw,
    }


def fetch_carrier_summaries_page(page: int = 1, per_page: int = 1000) -> tuple:
    """Fetch one page of carrier summaries from Supabase. Returns (items, total)."""
    client = _get_client()
    if not client:
        return [], 0
    cols = "usdot_number,legal_name,added_to_motus,motus_entry_date,motus_last_updated,carrier_status,out_of_service,scraped_at"
    offset = (page - 1) * per_page
    try:
        result = (
            client.table("carriers")
            .select(cols, count="exact")
            .order("usdot_number")
            .range(offset, offset + per_page - 1)
            .execute()
        )
        items = [_row_to_summary(r) for r in (result.data or [])]
        total = result.count if result.count is not None else len(items)
        return items, total
    except Exception as e:
        print(f"[SUPABASE] fetch_carrier_summaries_page failed: {e}")
        return [], 0


def fetch_carrier_summaries() -> list:
    """Fetch all carrier summaries from Supabase (paginated). Used on Vercel when no local DB."""
    all_rows = []
    page = 1
    per_page = 1000
    while True:
        items, total = fetch_carrier_summaries_page(page, per_page)
        if not items:
            break
        all_rows.extend(items)
        if len(all_rows) >= total:
            break
        page += 1
    return all_rows


def fetch_carrier_detail(usdot: str) -> Optional[dict]:
    """Fetch single carrier with full raw_data from Supabase."""
    client = _get_client()
    if not client:
        return None
    try:
        result = client.table("carriers").select("*").eq("usdot_number", str(usdot)).execute()
        if result.data:
            return _row_to_record(result.data[0])
    except Exception as e:
        print(f"[SUPABASE] fetch_carrier_detail failed for {usdot}: {e}")
    return None
