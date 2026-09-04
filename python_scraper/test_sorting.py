import urllib.request
import json
import urllib.parse

headers = {'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json'}
sort_fields = ['updateDate', 'createDate', 'modifiedDate', 'exitDate']

for field in sort_fields:
    url = f"https://motus.dot.gov/api/carriers/search?query=LLC&sortBy={field}&sortOrder=desc&skip=0&limit=5"
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=10) as r:
            data = json.loads(r.read().decode())
        first_carrier = data.get("data", [])[0] if data.get("data") else {}
        print(f"sortBy={field:12} -> total={data.get('total')} first_name={first_carrier.get('entityName')} createDate={first_carrier.get('createDate')} updateDate={first_carrier.get('updateDate')}")
    except Exception as e:
        print(f"sortBy={field:12} -> Error: {e}")
