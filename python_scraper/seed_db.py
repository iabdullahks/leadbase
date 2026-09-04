#!/usr/bin/env python3
import json
import os
from datetime import datetime

DB_FILE = "database.json"

def main():
    if not os.path.exists(DB_FILE):
        print(f"[!] {DB_FILE} not found. Can't seed without initial templates.")
        return

    with open(DB_FILE, "r") as f:
        db = json.load(f)

    current_count = len(db)
    target_count = 15000

    if current_count >= target_count:
        print(f"[*] Database already has {current_count} entries. No seeding needed.")
        return

    print(f"[*] Seeding database. Current count: {current_count}. Target: {target_count}.")
    
    # Store existing USDOT numbers to avoid collisions
    existing_usdots = {item["usdot_number"] for item in db}
    
    # We will round-robin clone the existing entries to maintain realistic structures
    templates = [item for item in db if "data" in item and item["data"]]
    if not templates:
        print("[!] No valid templates with 'data' field found in database.json.")
        return

    needed = target_count - current_count
    seeded_count = 0
    next_usdot = 3000000  # Start generating USDOT numbers from 3000000
    
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    while seeded_count < needed:
        usdot_str = str(next_usdot)
        next_usdot += 1
        
        # Skip if USDOT number already exists
        if usdot_str in existing_usdots:
            continue
            
        # Get template
        template = templates[seeded_count % len(templates)]
        
        # Clone and mutate
        cloned_data = json.loads(json.dumps(template["data"]))
        cloned_data["usdot_number"] = usdot_str
        cloned_data["profile_url"] = f"https://motus.dot.gov/customer/{usdot_str}/account"
        
        # Update Legal Business Name to show it's seeded/unique
        biz_info = cloned_data.get("business_information", {})
        original_name = biz_info.get("Legal Business Name") or "Unknown Carrier"
        # Strip any existing # suffix if present
        if " #" in original_name:
            original_name = original_name.split(" #")[0]
        biz_info["Legal Business Name"] = f"{original_name} #{usdot_str}"
        
        new_record = {
            "usdot_number": usdot_str,
            "added_to_motus": template.get("added_to_motus") or "",
            "scraped_at": now_str,
            "data": cloned_data
        }
        
        db.append(new_record)
        seeded_count += 1

    # Sort database by USDOT number ascending
    db.sort(key=lambda x: int(x["usdot_number"]) if x["usdot_number"].isdigit() else 99999999)

    with open(DB_FILE, "w") as f:
        json.dump(db, f, indent=2)

    print(f"[+] Seeding complete! Database now has {len(db)} entries.")

if __name__ == "__main__":
    main()
