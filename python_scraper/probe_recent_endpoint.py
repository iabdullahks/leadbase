import urllib.request
import json
import urllib.parse

headers = {'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json'}

# Let's try various parameter styles on carriers/recent
params_to_test = [
    "",
    "days=1",
    "days=7",
    "since=2026-07-05",
    "updatedSince=2026-07-05",
    "createdSince=2026-07-05",
    "fromDate=2026-07-05",
    "date=2026-07-05T00:00:00.000Z",
    "limit=50",
    "size=50",
]

print("Probing carriers/recent...")
for p in params_to_test:
    url = f"https://motus.dot.gov/api/carriers/recent?{p}" if p else "https://motus.dot.gov/api/carriers/recent"
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=10) as r:
            data = json.loads(r.read().decode())
        print(f"  OK   {p or 'no-params':30} -> keys={list(data.keys()) if isinstance(data, dict) else type(data).__name__}")
    except Exception as e:
        print(f"  ERR  {p or 'no-params':30} -> {e}")
