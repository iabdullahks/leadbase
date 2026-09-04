import csv
import os
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

def main():
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("Missing Supabase credentials.")
        return
        
    client = create_client(url, key)
    
    csv_file = "unadded_leads_from_4582560_v3.csv"
    if not os.path.exists(csv_file):
        print(f"{csv_file} does not exist.")
        return
        
    dots_in_csv = []
    with open(csv_file, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            dot = row.get("USDOT Number")
            if dot:
                dots_in_csv.append(int(dot))
                
    print(f"Total DOTs in CSV: {len(dots_in_csv)}")
    if not dots_in_csv:
        return
        
    # Check a sample of 20 DOTs from CSV in the database
    sample = dots_in_csv[:20]
    print(f"Checking a sample of {len(sample)} DOTs in Supabase...")
    
    res = client.table("carriers").select("usdot_number").in_("usdot_number", [str(d) for d in sample]).execute()
    found_dots = {int(r["usdot_number"]) for r in res.data}
    print(f"Found in DB: {found_dots}")
    print(f"Not found in DB: {set(sample) - found_dots}")
    
    # Let's count how many total are in DB
    try:
        total_in_db = client.table("carriers").select("usdot_number", count="exact").limit(1).execute().count
        print(f"Total carriers in DB: {total_in_db}")
    except Exception as e:
        print(f"Error counting DB: {e}")

if __name__ == "__main__":
    main()
