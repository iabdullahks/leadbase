import urllib.request, urllib.error, json
from datetime import datetime, timedelta, timezone
from concurrent.futures import ThreadPoolExecutor, as_completed

since_str = (datetime.now(timezone.utc) - timedelta(days=7)).strftime("%Y-%m-%d")
CUTOFF_DATE = datetime.now(timezone.utc) - timedelta(days=7)

headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/125.0.0.0 Safari/537.36',
    'Accept': 'application/json',
}

def get(url):
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=5) as resp:
            return json.loads(resp.read().decode())
    except Exception:
        return None

def check_carrier(dot):
    c = get(f"https://motus.dot.gov/api/carriers/{dot}")
    if not c:
        return None
    entity_id = c.get("entityId")
    if not entity_id:
        return None
    
    m = get(f"https://motus.dot.gov/api/public-registration-matrix/{entity_id}")
    if not m:
        return None
    
    entity = m.get("entity", {})
    new_entrant_list = entity.get("entityNewEntrant") or []
    for ne in new_entrant_list:
        exit_date = ne.get("exitedDate")
        if exit_date:
            return dot, exit_date
    return None

# Search LLC candidates
res = get("https://motus.dot.gov/api/carriers/search?query=LLC&page=0&size=150")
candidates = [r.get("dotNumber") for r in res.get("data", []) if r.get("dotNumber")]

print("Checking exit dates for 150 candidates...")
exits = []
with ThreadPoolExecutor(max_workers=20) as executor:
    futures = {executor.submit(check_carrier, dot): dot for dot in candidates}
    for future in as_completed(futures):
        res = future.result()
        if res:
            dot, exit_date = res
            exits.append(exit_date)
            print(f"  USDOT {dot} Exit Date: {exit_date}")

# Let's see the range of exit dates
if exits:
    print(f"\nExit dates range from {min(exits)} to {max(exits)}")
else:
    print("\nNo exit dates found.")
