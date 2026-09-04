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
        
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    client = create_client(url, key)
    
    # Read a sample of carriers created on 2026-08-06 from CSV
    sample_csv = []
    with open(csv_file, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            create_date = row.get("Create Date")
            if create_date and create_date.startswith("2026-08-06"):
                sample_csv.append(row)
                if len(sample_csv) >= 5:
                    break
                    
    print("--- Sample August 6 Carriers from CSV ---")
    for row in sample_csv:
        dot = row["USDOT Number"]
        print(f"USDOT {dot}: Create Date={row['Create Date']}, Update Date={row['Update Date']}")
        
        # Query DB
        res = client.table("carriers").select("added_to_motus", "motus_entry_date", "motus_last_updated").eq("usdot_number", dot).execute()
        if res.data:
            db_row = res.data[0]
            print(f"  DB: added_to_motus={db_row.get('added_to_motus')}, entry={db_row.get('motus_entry_date')}, last_updated={db_row.get('motus_last_updated')}")
        else:
            print("  DB: NOT FOUND")

if __name__ == "__main__":
    main()
