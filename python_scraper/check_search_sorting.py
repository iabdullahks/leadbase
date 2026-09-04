import urllib.request
import json
import urllib.parse

headers = {'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json'}

# Fetch first and last pages of search to see sorting
skips = [0, 1000, 5000, 10000, 20000, 50000, 68000]

for skip in skips:
    url = f"https://motus.dot.gov/api/carriers/search?query=LLC&skip={skip}&limit=5"
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=10) as r:
            data = json.loads(r.read().decode())
        carriers = data.get("data", [])
        if carriers:
            print(f"skip={skip:5} -> first USDOT: {carriers[0].get('dotNumber')} | first Name: {carriers[0].get('entityName')}")
    except Exception as e:
        print(f"skip={skip:5} -> Error: {e}")
