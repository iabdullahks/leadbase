"""
Probe MOTUS API for date-based filtering endpoints.
Tests various date parameter names and alternative endpoints.
"""
import urllib.request
import json
import time

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    "Accept": "application/json",
    "Referer": "https://motus.dot.gov/",
}

def get(url, timeout=20):
    try:
        req = urllib.request.Request(url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=timeout) as r:
            data = json.loads(r.read().decode())
            return data, None
    except Exception as e:
        return None, str(e)[:80]

TARGET_DATE = "2026-06-01"

tests = [
    # Date params on search endpoint
    f"https://motus.dot.gov/api/carriers/search?query=LLC&exitedAfter={TARGET_DATE}",
    f"https://motus.dot.gov/api/carriers/search?query=LLC&exitDate={TARGET_DATE}",
    f"https://motus.dot.gov/api/carriers/search?query=LLC&programExitDate={TARGET_DATE}",
    f"https://motus.dot.gov/api/carriers/search?query=LLC&modifiedAfter={TARGET_DATE}",
    f"https://motus.dot.gov/api/carriers/search?query=LLC&updateDate={TARGET_DATE}",
    f"https://motus.dot.gov/api/carriers/search?query=LLC&since={TARGET_DATE}",
    f"https://motus.dot.gov/api/carriers/search?query=LLC&fromDate={TARGET_DATE}",
    # Alternative endpoints that might support date filtering
    f"https://motus.dot.gov/api/new-entrant/search?exitDate={TARGET_DATE}",
    f"https://motus.dot.gov/api/new-entrant?exitedAfter={TARGET_DATE}",
    f"https://motus.dot.gov/api/registrations/recent?date={TARGET_DATE}",
    f"https://motus.dot.gov/api/carriers/recent?date={TARGET_DATE}",
    f"https://motus.dot.gov/api/carriers/recent?since={TARGET_DATE}",
    f"https://motus.dot.gov/api/carriers/changes?date={TARGET_DATE}",
    f"https://motus.dot.gov/api/program-exits?since={TARGET_DATE}",
    f"https://motus.dot.gov/api/new-entrant-exits?date={TARGET_DATE}",
    # Check if search has a sort/filter by date
    f"https://motus.dot.gov/api/carriers/search?query=LLC&sortBy=exitDate&sortOrder=desc",
    f"https://motus.dot.gov/api/carriers/search?query=LLC&filter=exitDate&value={TARGET_DATE}",
]

print(f"Probing {len(tests)} date-based API variations...\n")
for url in tests:
    data, err = get(url)
    time.sleep(0.5)
    short_url = url.replace("https://motus.dot.gov/api/", "").replace(TARGET_DATE, "DATE")
    if err:
        print(f"  ERROR   {short_url[:70]}")
        print(f"          -> {err}")
    else:
        total = data.get("total") if isinstance(data, dict) else None
        count = len(data.get("data", [])) if isinstance(data, dict) else (len(data) if isinstance(data, list) else 0)
        keys = list(data.keys())[:6] if isinstance(data, dict) else type(data).__name__
        print(f"  OK      {short_url[:70]}")
        print(f"          -> total={total} data_count={count} keys={keys}")
    print()
