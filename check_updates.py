import urllib.request
import json
import urllib.parse
from datetime import datetime, timedelta, timezone

headers = {'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json'}

# Let's pull the first 100 carriers from the 'TRUCKING' query and check their update dates
url = "https://motus.dot.gov/api/carriers/search?query=TRUCKING&skip=0&limit=100"
req = urllib.request.Request(url, headers=headers)
try:
    with urllib.request.urlopen(req, timeout=15) as r:
        data = json.loads(r.read().decode())
    carriers = data.get("data", [])
    print(f"Total TRUCKING carriers: {data.get('total')}")
    
    # Check how many have recent update dates (last 7 days)
    recent_count = 0
    cutoff = datetime.now(timezone.utc) - timedelta(days=7)
    for c in carriers:
        update_str = c.get("updateDate") or c.get("createDate")
        if update_str:
            try:
                # simple parsing of '2026-07-06T18:24:14.000Z'
                date_part = update_str.split("T")[0]
                dt = datetime.strptime(date_part, "%Y-%m-%d").replace(tzinfo=timezone.utc)
                if dt >= cutoff:
                    recent_count += 1
            except Exception:
                pass
    print(f"Out of top 100 TRUCKING carriers, {recent_count} were created/updated in the last 7 days.")
except Exception as e:
    print(f"Error: {e}")
