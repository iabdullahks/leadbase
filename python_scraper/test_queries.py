import urllib.request
import json
import urllib.parse

headers = {'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json'}
queries = ['', '*', 'INC', 'CORP', 'TRUCKING', 'TRANSPORT']

for q in queries:
    url = f"https://motus.dot.gov/api/carriers/search?query={urllib.parse.quote(q)}&skip=0&limit=5"
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=10) as r:
            data = json.loads(r.read().decode())
        total = data.get("total")
        count = len(data.get("data", []))
        print(f"query={q!r:12} -> total={total} count={count}")
    except Exception as e:
        print(f"query={q!r:12} -> Error: {e}")
