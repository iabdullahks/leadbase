#!/usr/bin/env python3
import json
import os
import urllib.request
import urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed

DB_FILE = "database.json"

def fetch_status(usdot):
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
        "Referer": f"https://motus.dot.gov/customer/{usdot}/account"
    }
    url = f"https://motus.dot.gov/api/carriers/{usdot}"
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=10) as response:
            carrier_data = json.loads(response.read().decode('utf-8'))
            dot_status = carrier_data.get("entityDotNumber", {}).get("dotNumberStatus", {}).get("dotNumberStatus") or "Active"
            out_of_service = carrier_data.get("outOfService") or False
            return usdot, dot_status, out_of_service
    except Exception as e:
        # Fallback to checking new entrant status text
        return usdot, None, None

def main():
    if not os.path.exists(DB_FILE):
        print("[!] database.json not found.")
        return

    with open(DB_FILE, "r") as f:
        db = json.load(f)

    # 1. Separate real vs generated
    real_items = [item for item in db if int(item["usdot_number"]) < 3000000]
    generated_items = [item for item in db if int(item["usdot_number"]) >= 3000000]

    print(f"[*] Found {len(real_items)} real carriers and {len(generated_items)} generated carriers.")

    # 2. Fetch statuses for real carriers in parallel
    real_statuses = {}
    print("[*] Querying MOTUS API for real carrier statuses...")
    usdots = [item["usdot_number"] for item in real_items]
    
    with ThreadPoolExecutor(max_workers=10) as executor:
        futures = {executor.submit(fetch_status, u): u for u in usdots}
        for future in as_completed(futures):
            usdot, dot_status, out_of_service = future.result()
            if dot_status:
                real_statuses[usdot] = (dot_status, out_of_service)
                print(f"    [+] USDOT #{usdot} Status: {dot_status} | OOS: {out_of_service}")
            else:
                # Fallback check based on local data
                item = next(x for x in real_items if x["usdot_number"] == usdot)
                nep_status = (item["data"].get("new_entrant_program", {}).get("Program Status") or "").lower()
                if "inactivation" in nep_status or "suspend" in nep_status:
                    real_statuses[usdot] = ("Inactive", True)
                else:
                    real_statuses[usdot] = ("Active", False)
                print(f"    [!] USDOT #{usdot} API timeout. Fell back to local check: {real_statuses[usdot][0]}")

    # 3. Update real items
    for item in real_items:
        usdot = item["usdot_number"]
        dot_status, out_of_service = real_statuses.get(usdot, ("Active", False))
        
        item["carrier_status"] = dot_status
        item["out_of_service"] = out_of_service
        item["data"]["carrier_status"] = dot_status
        item["data"]["out_of_service"] = out_of_service

    # 4. Update generated items (they were cloned from real templates)
    # We map template USDOTs to their updated statuses
    # Let's map by legal business name match or template source
    template_map = {item["data"]["business_information"]["Legal Business Name"].split(" #")[0]: (item["carrier_status"], item["out_of_service"]) for item in real_items}

    for item in generated_items:
        orig_name = item["data"]["business_information"]["Legal Business Name"].split(" #")[0]
        dot_status, out_of_service = template_map.get(orig_name, ("Active", False))
        
        item["carrier_status"] = dot_status
        item["out_of_service"] = out_of_service
        item["data"]["carrier_status"] = dot_status
        item["data"]["out_of_service"] = out_of_service
        
        # Make sure the name still matches the USDOT number
        item["data"]["business_information"]["Legal Business Name"] = f"{orig_name} #{item['usdot_number']}"

    # 5. Save database.json
    db.sort(key=lambda x: int(x["usdot_number"]) if x["usdot_number"].isdigit() else 99999999)
    with open(DB_FILE, "w") as f:
        json.dump(db, f, indent=2)

    print(f"[+] Status migration complete! database.json saved successfully.")

if __name__ == "__main__":
    main()
