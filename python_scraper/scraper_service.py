#!/usr/bin/env python3
"""
LeadBase Scraper Service
========================
Flask API that wraps the MOTUS scraper with:
  - APScheduler: auto-runs every 12 hours
  - REST API: start / stop / status / run history
  - Supabase: logs every run in scraper_runs table
  - CORS: so Next.js can call it from port 3000

Run this alongside the Next.js app:
    python scraper_service.py

API Endpoints:
    GET  /status        -> current state + next scheduled run
    POST /start         -> manually trigger a scrape
    POST /stop          -> cancel running scrape
    GET  /runs          -> list past runs (paginated)
    GET  /runs/<id>     -> single run detail
    GET  /health        -> health check
"""

import os
import sys
import csv
import glob
import time
import threading
import uuid
import asyncio
import aiohttp
from datetime import datetime, timezone, timedelta
from typing import Optional

from flask import Flask, jsonify, request
from flask_cors import CORS
from apscheduler.schedulers.background import BackgroundScheduler
from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv()

# ── App Setup ──────────────────────────────────────────────────────────────────
app = Flask(__name__)
CORS(app, origins=["http://localhost:3000", "http://127.0.0.1:3000", "*"])

supabase: Client = create_client(
    os.environ["SUPABASE_URL"],
    os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ["SUPABASE_ANON_KEY"],
)

# ── Scraper Config ─────────────────────────────────────────────────────────────
SCRAPER_DIR   = os.path.dirname(os.path.abspath(__file__))
OUTPUT_CSV    = os.path.join(SCRAPER_DIR, "unadded_leads_from_4582560_v8.csv")
CONCURRENCY   = 400
CHUNK_SIZE    = 10_000
DEFAULT_START = 4_582_560
DEFAULT_END   = 10_200_000

MOTUS_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept":     "application/json",
    "Referer":    "https://motus.dot.gov/",
    "Origin":     "https://motus.dot.gov",
}

# ── Global Scraper State ───────────────────────────────────────────────────────
_state = {
    "status":       "idle",        # idle | running | stopping
    "run_id":       None,
    "started_at":   None,
    "triggered_by": None,
    "dots_scanned": 0,
    "new_leads":    0,
    "current_dot":  0,
    "start_dot":    0,
    "end_dot":      0,
    "error":        None,
    "log":          [],            # last 100 log lines
}
_lock       = threading.Lock()
_stop_event = threading.Event()

# ── Scraper Field Helpers ──────────────────────────────────────────────────────
def _phone(c):
    for p in (c.get("phoneNumbers") or []):
        ph = (p.get("phoneNumber") or "").strip()
        if ph: return ph
    return ""

def _email(c):
    for e in (c.get("emailAddresses") or []):
        em = (e.get("emailAddress") or "").strip()
        if em: return em
    return ""

def _name(c):
    for n in (c.get("entityNames") or []):
        if n.get("nameType") == "Legal":
            return (n.get("entityName") or "").strip()
    return (c.get("entityName") or "").strip()

def _status(c):
    dn = c.get("entityDotNumber") or {}
    st = dn.get("dotNumberStatus") or {}
    return (st.get("dotNumberStatus") or st.get("status") or "Active").strip()

def _dot_num(dot, c):
    obj = c.get("entityDotNumber") or {}
    return str(obj.get("dotNumber") or c.get("entityId") or dot)

def _supabase_row(dot, carrier, run_id=None):
    cd = carrier.get("createDate") or carrier.get("updateDate")
    ud = carrier.get("updateDate") or carrier.get("createDate")
    usdot = _dot_num(dot, carrier)
    row = {
        "usdot_number":       usdot,
        "legal_name":         _name(carrier),
        "phone":              _phone(carrier),
        "email":              _email(carrier),
        "carrier_status":     _status(carrier),
        "out_of_service":     bool(carrier.get("outOfService")),
        "motus_entry_date":   cd,
        "motus_last_updated": ud,
        "scraped_at":         datetime.now(timezone.utc).isoformat(),
        "profile_url":        f"https://motus.dot.gov/customer/{usdot}/account",
        "dba_name":           "",
        "principal_address":  "",
        "raw_data":           carrier,
    }
    if run_id:
        row["scraper_run_id"] = run_id
    return row

# ── Logging ────────────────────────────────────────────────────────────────────
def _log(msg: str):
    ts  = datetime.now().strftime("%H:%M:%S")
    line = f"[{ts}] {msg}"
    print(line, flush=True)
    with _lock:
        _state["log"].append(line)
        if len(_state["log"]) > 200:
            _state["log"] = _state["log"][-200:]

# ── Supabase Run Tracking ──────────────────────────────────────────────────────
def _create_run(run_id: str, triggered_by: str, start_dot: int, end_dot: int):
    try:
        supabase.table("scraper_runs").insert({
            "id":           run_id,
            "started_at":   datetime.now(timezone.utc).isoformat(),
            "status":       "running",
            "triggered_by": triggered_by,
            "start_dot":    start_dot,
            "end_dot":      end_dot,
        }).execute()
    except Exception as e:
        _log(f"[WARN] Could not create run record: {e}")

def _update_run(run_id: str, **kwargs):
    try:
        supabase.table("scraper_runs").update(kwargs).eq("id", run_id).execute()
    except Exception as e:
        _log(f"[WARN] Could not update run record: {e}")

# ── Async Scraper Core ─────────────────────────────────────────────────────────
async def _fetch(session, sem, dot, retries=3):
    url = f"https://motus.dot.gov/api/carriers/{dot}"
    async with sem:
        for attempt in range(retries):
            try:
                async with session.get(url, timeout=aiohttp.ClientTimeout(total=8)) as r:
                    if r.status in (400, 404): return dot, None
                    if r.status == 200:        return dot, await r.json()
            except Exception:
                if attempt < retries - 1:
                    await asyncio.sleep(0.2 * (attempt + 1))
    return dot, None

async def _async_scrape(run_id: str, start_dot: int, end_dot: int):
    """Core async scraper — updates _state live and returns (dots_scanned, new_leads)."""

    # Load existing DOTs to skip
    existing = set()
    for csv_path in glob.glob(os.path.join(SCRAPER_DIR, "*.csv")):
        try:
            with open(csv_path, "r", encoding="utf-8", errors="ignore") as f:
                reader = csv.reader(f)
                next(reader, None)
                for row in reader:
                    if row and row[0].isdigit():
                        existing.add(int(row[0]))
        except Exception:
            pass

    _log(f"Loaded {len(existing):,} existing DOTs from local CSVs")

    # Load from Supabase
    page, page_size = 0, 1000
    while True:
        try:
            res = supabase.table("carriers").select("usdot_number") \
                .order("usdot_number").range(page * page_size, (page + 1) * page_size - 1).execute()
            if not res.data: break
            for row in res.data:
                v = row.get("usdot_number")
                if v:
                    try: existing.add(int(v))
                    except ValueError: pass
            page += 1
            if len(res.data) < page_size: break
        except Exception as e:
            _log(f"[WARN] DB load error: {e}")
            break

    _log(f"Total existing DOTs to skip: {len(existing):,}")

    # Prepare CSV output
    fields_csv = ["USDOT Number", "Legal Business Name", "Business Telephone No.",
                  "Business Email", "DOT Status", "Out of Service", "Update Date", "Create Date"]
    file_exists = os.path.exists(OUTPUT_CSV)
    csvfile = open(OUTPUT_CSV, "a" if file_exists else "w", newline="", encoding="utf-8")
    writer  = csv.DictWriter(csvfile, fieldnames=fields_csv, extrasaction="ignore")
    if not file_exists:
        writer.writeheader(); csvfile.flush()

    dots_scanned = 0
    new_leads    = 0
    chunk_start  = start_dot
    start_time   = time.time()

    sem       = asyncio.Semaphore(CONCURRENCY)
    connector = aiohttp.TCPConnector(limit=CONCURRENCY + 50, ttl_dns_cache=300)

    async with aiohttp.ClientSession(headers=MOTUS_HEADERS, connector=connector) as session:
        while chunk_start <= end_dot:
            if _stop_event.is_set():
                _log("Stop signal received — halting scraper")
                break

            chunk_end    = min(chunk_start + CHUNK_SIZE - 1, end_dot)
            dots_to_probe = [d for d in range(chunk_start, chunk_end + 1) if d not in existing]

            with _lock:
                _state["current_dot"] = chunk_start

            if not dots_to_probe:
                chunk_start = chunk_end + 1
                continue

            elapsed = time.time() - start_time
            rate    = dots_scanned / max(elapsed / 60, 0.01)
            _log(f"Chunk {chunk_start:,}–{chunk_end:,} | probing {len(dots_to_probe):,} | "
                 f"new: {new_leads} | {rate:,.0f} DOTs/min")

            tasks = [_fetch(session, sem, d) for d in dots_to_probe]
            for future in asyncio.as_completed(tasks):
                if _stop_event.is_set(): break
                dot, carrier = await future
                dots_scanned += 1

                if carrier:
                    new_leads += 1
                    row = {
                        "USDOT Number":           _dot_num(dot, carrier),
                        "Legal Business Name":    _name(carrier),
                        "Business Telephone No.": _phone(carrier),
                        "Business Email":         _email(carrier),
                        "DOT Status":             _status(carrier),
                        "Out of Service":         str(carrier.get("outOfService", "")),
                        "Update Date":            carrier.get("updateDate") or "",
                        "Create Date":            carrier.get("createDate") or "",
                    }
                    writer.writerow(row); csvfile.flush()
                    existing.add(dot)

                    try:
                        db_row = _supabase_row(dot, carrier, run_id)
                        supabase.table("carriers").upsert(db_row, on_conflict="usdot_number").execute()
                    except Exception as ex:
                        _log(f"  [DB ERR] USDOT {dot}: {ex}")

                    with _lock:
                        _state["new_leads"]    = new_leads
                        _state["dots_scanned"] = dots_scanned

                if dots_scanned % 5000 == 0 and dots_scanned > 0:
                    rate2 = dots_scanned / max((time.time() - start_time) / 60, 0.01)
                    _log(f"  --> {dots_scanned:,} probed | {rate2:,.0f} DOTs/min")
                    _update_run(run_id, dots_scanned=dots_scanned, new_leads=new_leads)

            chunk_start = chunk_end + 1

    csvfile.close()
    _log(f"Done! Scanned {dots_scanned:,} DOTs | Found {new_leads} new leads")
    return dots_scanned, new_leads

# ── Scraper Thread ─────────────────────────────────────────────────────────────
def _run_scraper_thread(run_id: str, triggered_by: str, start_dot: int, end_dot: int):
    with _lock:
        _state.update({
            "status":       "running",
            "run_id":       run_id,
            "started_at":   datetime.now(timezone.utc).isoformat(),
            "triggered_by": triggered_by,
            "dots_scanned": 0,
            "new_leads":    0,
            "current_dot":  start_dot,
            "start_dot":    start_dot,
            "end_dot":      end_dot,
            "error":        None,
            "log":          [],
        })
    _stop_event.clear()

    _log(f"=== Scraper starting (run_id={run_id}, triggered_by={triggered_by}) ===")
    _log(f"Range: DOT {start_dot:,} → {end_dot:,}")

    _create_run(run_id, triggered_by, start_dot, end_dot)

    try:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        dots_scanned, new_leads = loop.run_until_complete(
            _async_scrape(run_id, start_dot, end_dot)
        )
        loop.close()

        status = "cancelled" if _stop_event.is_set() else "completed"
        _update_run(run_id,
            status=status,
            completed_at=datetime.now(timezone.utc).isoformat(),
            dots_scanned=dots_scanned,
            new_leads=new_leads,
        )
        _log(f"=== Run {status.upper()} ===")
    except Exception as e:
        err = str(e)
        _log(f"=== Run FAILED: {err} ===")
        _update_run(run_id,
            status="failed",
            completed_at=datetime.now(timezone.utc).isoformat(),
            error_message=err,
        )
        with _lock:
            _state["error"] = err
    finally:
        with _lock:
            _state["status"] = "idle"
            _state["run_id"] = None

# ── Scheduled Job ──────────────────────────────────────────────────────────────
def scheduled_scrape():
    with _lock:
        if _state["status"] == "running":
            _log("[SCHEDULER] Previous run still running — skipping scheduled run")
            return
    run_id = str(uuid.uuid4())
    thread = threading.Thread(
        target=_run_scraper_thread,
        args=(run_id, "schedule", DEFAULT_START, DEFAULT_END),
        daemon=True,
    )
    thread.start()

# ── Scheduler ─────────────────────────────────────────────────────────────────
scheduler = BackgroundScheduler(timezone="UTC")
scheduler.add_job(scheduled_scrape, "interval", hours=12, id="auto_scrape",
                  next_run_time=datetime.now(timezone.utc) + timedelta(hours=12))
scheduler.start()

# ── API Routes ─────────────────────────────────────────────────────────────────

@app.route("/health")
def health():
    return jsonify({"ok": True, "service": "leadbase-scraper"})

@app.route("/status")
def status():
    with _lock:
        s = dict(_state)

    job = scheduler.get_job("auto_scrape")
    next_run = job.next_run_time.isoformat() if job and job.next_run_time else None

    return jsonify({
        "status":       s["status"],
        "run_id":       s["run_id"],
        "started_at":   s["started_at"],
        "triggered_by": s["triggered_by"],
        "dots_scanned": s["dots_scanned"],
        "new_leads":    s["new_leads"],
        "current_dot":  s["current_dot"],
        "start_dot":    s["start_dot"],
        "end_dot":      s["end_dot"],
        "error":        s["error"],
        "next_scheduled": next_run,
        "log_tail":     s["log"][-30:],
    })

@app.route("/start", methods=["POST"])
def start_scrape():
    with _lock:
        if _state["status"] == "running":
            return jsonify({"error": "Scraper is already running", "run_id": _state["run_id"]}), 409

    body      = request.get_json(silent=True) or {}
    start_dot = int(body.get("start_dot", DEFAULT_START))
    end_dot   = int(body.get("end_dot",   DEFAULT_END))
    run_id    = str(uuid.uuid4())

    thread = threading.Thread(
        target=_run_scraper_thread,
        args=(run_id, "manual", start_dot, end_dot),
        daemon=True,
    )
    thread.start()

    return jsonify({"ok": True, "run_id": run_id, "message": "Scraper started"}), 202

@app.route("/stop", methods=["POST"])
def stop_scrape():
    with _lock:
        if _state["status"] != "running":
            return jsonify({"error": "Scraper is not running"}), 400
    _stop_event.set()
    return jsonify({"ok": True, "message": "Stop signal sent"})

@app.route("/runs")
def list_runs():
    try:
        limit  = min(int(request.args.get("limit", 20)), 100)
        offset = int(request.args.get("offset", 0))
        res = supabase.table("scraper_runs") \
            .select("id, started_at, completed_at, status, triggered_by, new_leads, dots_scanned, start_dot, end_dot") \
            .order("started_at", desc=True) \
            .range(offset, offset + limit - 1) \
            .execute()
        return jsonify({"runs": res.data or []})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/runs/<run_id>")
def get_run(run_id):
    try:
        res = supabase.table("scraper_runs").select("*").eq("id", run_id).single().execute()
        return jsonify(res.data or {})
    except Exception as e:
        return jsonify({"error": str(e)}), 404

@app.route("/runs/<run_id>/leads")
def run_leads(run_id):
    """Get leads discovered in a specific run."""
    try:
        limit  = min(int(request.args.get("limit", 50)), 200)
        offset = int(request.args.get("offset", 0))
        res = supabase.table("carriers") \
            .select("usdot_number, legal_name, phone, email, carrier_status, scraped_at") \
            .eq("scraper_run_id", run_id) \
            .order("scraped_at", desc=True) \
            .range(offset, offset + limit - 1) \
            .execute()
        return jsonify({"leads": res.data or []})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    print("=" * 60)
    print("LeadBase Scraper Service")
    print("Port  : 5001")
    print(f"Schedule: every 12 hours (next: {scheduler.get_job('auto_scrape').next_run_time})")
    print("=" * 60)
    app.run(host="0.0.0.0", port=5001, debug=False, use_reloader=False)
