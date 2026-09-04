#!/usr/bin/env python3
"""
Probe MOTUS API — dump full carrier + matrix JSON for a broker
to find where MC number / operating authority status lives.

Usage: python probe_mc_fields.py [dot_number]
Default DOT: 2219436 (AF BROKERS INC — from our broker leads)
"""
import sys
import json
import urllib.request
import urllib.error

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "application/json",
    "Referer": "https://motus.dot.gov/search",
    "Origin": "https://motus.dot.gov",
}

def api_get(url, timeout=15):
    try:
        req = urllib.request.Request(url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode()), None
    except urllib.error.HTTPError as e:
        return None, f"HTTP {e.code}"
    except Exception as ex:
        return None, str(ex)[:120]

def flatten_keys(d, prefix=""):
    """Recursively list all key paths that contain 'mc', 'auth', 'operating', 'permit'."""
    results = []
    if isinstance(d, dict):
        for k, v in d.items():
            full_key = f"{prefix}.{k}" if prefix else k
            kl = k.lower()
            if any(x in kl for x in ["mc", "auth", "operating", "permit", "license", "motor", "number", "status"]):
                results.append((full_key, str(v)[:150]))
            results.extend(flatten_keys(v, full_key))
    elif isinstance(d, list):
        for i, item in enumerate(d[:3]):  # first 3 items
            results.extend(flatten_keys(item, f"{prefix}[{i}]"))
    return results

dot = sys.argv[1] if len(sys.argv) > 1 else "2219436"
print(f"Probing USDOT: {dot}\n")

# ── Step 1: carrier detail ────────────────────────────────────────────────────
print("=== /api/carriers/{dot} ===")
carrier, err = api_get(f"https://motus.dot.gov/api/carriers/{dot}")
if err:
    print(f"  ERROR: {err}")
    sys.exit(1)

# Save full response
with open(f"probe_carrier_{dot}.json", "w", encoding="utf-8") as f:
    json.dump(carrier, f, indent=2)
print(f"  Saved to probe_carrier_{dot}.json")

entity_id = carrier.get("entityId")
print(f"  entityId: {entity_id}")
print(f"  Top-level keys: {list(carrier.keys())}")

print("\n  -- MC/Auth-related keys in carrier --")
for path, val in flatten_keys(carrier):
    print(f"    {path} = {val}")

# ── Step 2: public-registration-matrix ───────────────────────────────────────
if entity_id:
    print(f"\n=== /api/public-registration-matrix/{entity_id} ===")
    matrix, err2 = api_get(f"https://motus.dot.gov/api/public-registration-matrix/{entity_id}")
    if err2:
        print(f"  ERROR: {err2}")
    else:
        with open(f"probe_matrix_{dot}.json", "w", encoding="utf-8") as f:
            json.dump(matrix, f, indent=2)
        print(f"  Saved to probe_matrix_{dot}.json")

        entity = matrix.get("entity", {})
        print(f"  entity top-level keys: {list(entity.keys())}")

        print("\n  -- MC/Auth-related keys in matrix --")
        for path, val in flatten_keys(matrix):
            print(f"    {path} = {val}")

# ── Step 3: Try FMCSA / authority-specific endpoint ──────────────────────────
print(f"\n=== Trying /api/operating-authority/{dot} ===")
auth, err3 = api_get(f"https://motus.dot.gov/api/operating-authority/{dot}")
if err3:
    print(f"  ERROR: {err3}")
else:
    with open(f"probe_auth_{dot}.json", "w", encoding="utf-8") as f:
        json.dump(auth, f, indent=2)
    print(f"  Saved to probe_auth_{dot}.json")
    print(f"  Keys: {list(auth.keys()) if isinstance(auth, dict) else type(auth).__name__}")

print("\n=== Trying /api/carriers/{dot}/authority ===")
auth2, err4 = api_get(f"https://motus.dot.gov/api/carriers/{dot}/authority")
if err4:
    print(f"  ERROR: {err4}")
else:
    with open(f"probe_carrier_auth_{dot}.json", "w", encoding="utf-8") as f:
        json.dump(auth2, f, indent=2)
    print(f"  Saved to probe_carrier_auth_{dot}.json")
    print(f"  Keys: {list(auth2.keys()) if isinstance(auth2, dict) else type(auth2).__name__}")

print("\nDone. Check the probe_*.json files for MC status field locations.")
