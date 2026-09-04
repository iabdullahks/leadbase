import urllib.request
import json
import urllib.error

headers = {'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json'}

urls = [
    "https://motus.dot.gov/api/carriers/changes",
    "https://motus.dot.gov/api/carriers/recent",
    "https://motus.dot.gov/api/carriers/updates",
    "https://motus.dot.gov/api/registrations/recent",
]

for url in urls:
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=10) as r:
            data = json.loads(r.read().decode())
        print(f"Success {url}: {data}")
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8', errors='replace')
        print(f"HTTP Error {e.code} for {url}: {e.reason}")
        print("Response Body:", body[:200])
    except Exception as e:
        print(f"Error for {url}: {e}")
