import urllib.request, json

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "application/json",
    "Referer": "https://motus.dot.gov/",
    "Origin": "https://motus.dot.gov",
}

for dot in ["4582767", "4583031", "4582841"]:
    print(f"\n=== DOT {dot} ===")
    carrier_url = f"https://motus.dot.gov/api/carriers/{dot}"
    req = urllib.request.Request(carrier_url, headers=HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            carrier = json.loads(resp.read().decode())
    except Exception as e:
        print(f"  carrier fetch error: {e}")
        continue

    entity_id = carrier.get("entityId")
    print(f"  entityId: {entity_id}")
    print(f"  carrier keys: {list(carrier.keys())}")
    
    # check if carrier itself has equipment
    eq_direct = carrier.get("entityEquipment")
    print(f"  entityEquipment (direct on carrier): {eq_direct}")

    if entity_id:
        matrix_url = f"https://motus.dot.gov/api/public-registration-matrix/{entity_id}"
        req2 = urllib.request.Request(matrix_url, headers=HEADERS)
        try:
            with urllib.request.urlopen(req2, timeout=15) as resp2:
                matrix = json.loads(resp2.read().decode())
            print(f"  matrix top keys: {list(matrix.keys())}")
            entity = matrix.get("entity") or {}
            print(f"  entity keys: {list(entity.keys())}")
            eq = entity.get("entityEquipment")
            print(f"  entityEquipment from matrix: {eq}")
        except Exception as e:
            print(f"  matrix error: {e}")
