import urllib.request
import json
import urllib.error

headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'application/json',
    'Referer': 'https://motus.dot.gov/',
}

dots = [9999984, 9999985, 9999986, 9999990, 10000000, 10000001, 10000002, 10000005, 10000100]
for dot in dots:
    url = f'https://motus.dot.gov/api/carriers/{dot}'
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode())
            print(f"DOT {dot} exists: {data.get('entityName') or data.get('entityId')}")
    except urllib.error.HTTPError as e:
        print(f"DOT {dot} error: HTTP {e.code}")
    except Exception as e:
        print(f"DOT {dot} error: {e}")
