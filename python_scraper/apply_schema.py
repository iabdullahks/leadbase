#!/usr/bin/env python3
"""
Apply schema.sql to Supabase via the Management API.
Run this once to create all tables.
"""

import os
import sys
import httpx
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL", "").strip()
# Try both new and old key names
SECRET_KEY = (
    os.getenv("SUPABASE_SECRET_KEY", "").strip()
    or os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()
)

PROJECT_REF = SUPABASE_URL.replace("https://", "").replace(".supabase.co", "") if SUPABASE_URL else ""

SCHEMA_FILE = "supabase/schema.sql"


def apply_schema():
    if not SUPABASE_URL or not SECRET_KEY:
        print("[!] Missing SUPABASE_URL or SUPABASE_SECRET_KEY in .env")
        sys.exit(1)

    if not os.path.exists(SCHEMA_FILE):
        print(f"[!] {SCHEMA_FILE} not found.")
        sys.exit(1)

    with open(SCHEMA_FILE, "r") as f:
        sql = f.read()

    print(f"[*] Applying schema to project: {PROJECT_REF}")
    print(f"[*] SQL length: {len(sql)} characters")

    # Split on semicolons and run each statement individually
    statements = [s.strip() for s in sql.split(";") if s.strip() and not s.strip().startswith("--")]

    from supabase import create_client
    client = create_client(SUPABASE_URL, SECRET_KEY)

    success = 0
    errors = []

    for stmt in statements:
        if not stmt:
            continue
        try:
            result = client.rpc("exec_sql", {"sql": stmt + ";"}).execute()
            success += 1
        except Exception as e:
            err_msg = str(e)
            # Ignore "already exists" errors
            if "already exists" in err_msg or "duplicate" in err_msg.lower():
                print(f"  [skip] Already exists — {stmt[:60]}...")
                success += 1
            else:
                print(f"  [warn] {err_msg[:100]}")
                errors.append((stmt[:60], err_msg[:100]))

    print(f"\n[+] Done! {success} statements applied, {len(errors)} errors.")
    if errors:
        print("\n[!] Errors:")
        for stmt, err in errors:
            print(f"  - {stmt}: {err}")
    else:
        print("[+] All tables created successfully!")


if __name__ == "__main__":
    apply_schema()
