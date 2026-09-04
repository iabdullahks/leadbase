import urllib.request
import json
import urllib.error

headers = {'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json'}

url = "https://motus.dot.gov/api/carriers/recent"
try:
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=10) as r:
        data = json.loads(r.read().decode())
    print("Success:", data)
except urllib.error.HTTPError as e:
    body = e.read().decode('utf-8', errors='replace')
    print(f"HTTP Error {e.code}: {e.reason}")
    print("Response Body:", body)
except Exception as e:
    print("Error:", e)
