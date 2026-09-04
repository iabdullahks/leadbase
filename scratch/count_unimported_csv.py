import csv
import os
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

def main():
    csv_file = "unadded_leads_from_4582560_v3.csv"
    if not os.path.exists(csv_file):
        print("CSV file not found.")
        return
        
    dots = []
    with open(csv_file, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            dot = row.get("USDOT Number")
            if dot:
                dots.append(dot)
                
    print(f"Total leads in CSV: {len(dots)}")
    if not dots:
        return
        
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    client = create_client(url, key)
    
    # Check in batches of 1000
    found_count = 0
    batch_size = 1000
    for i in range(0, len(dots), batch_size):
        batch = dots[i:i+batch_size]
        res = client.table("carriers").select("usdot_number").in_("usdot_number", batch).execute()
        found_count += len(res.data)
        
    not_found = len(dots) - found_count
    print(f"Leads already in Supabase: {found_count}")
    print(f"Leads NOT yet in Supabase: {not_found}")

if __name__ == "__main__":
    main()
