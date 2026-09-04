import urllib.request, json, sys

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "application/json",
    "Referer": "https://motus.dot.gov/",
    "Origin": "https://motus.dot.gov",
}

for dot in ["4582767", "4583031"]:
    print(f"\n=== DOT {dot} ===")
    req = urllib.request.Request(f"https://motus.dot.gov/api/carriers/{dot}", headers=HEADERS)
    with urllib.request.urlopen(req, timeout=15) as resp:
        carrier = json.loads(resp.read().decode())

    entity_id = carrier.get("entityId")
    print(f"  entityId: {entity_id}")
    print(f"  carrier keys: {list(carrier.keys())}")
    eq = carrier.get("entityEquipment")
    print(f"  entityEquipment on carrier: {eq}")

    if entity_id:
        req2 = urllib.request.Request(
            f"https://motus.dot.gov/api/public-registration-matrix/{entity_id}", headers=HEADERS)
        with urllib.request.urlopen(req2, timeout=15) as resp2:
            matrix = json.loads(resp2.read().decode())
        entity = matrix.get("entity") or {}
        equipment = entity.get("entityEquipment") or []
        print(f"  entityEquipment count (matrix): {len(equipment)}")
        for eq in equipment:
            print(f"    equipmentCount={eq.get('equipmentCount')} owned={eq.get('owned')} "
                  f"termLeased={eq.get('termLeased')} type={eq.get('equipmentType',{}).get('equipmentTypeDesc')} "
                  f"ownershipDesc={eq.get('ownershipType',{}).get('ownershipTypeDesc')}")
