import csv
import os
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

def count_in_csv():
    csv_file = "unadded_leads_from_4582560_v3.csv"
    if not os.path.exists(csv_file):
        print("CSV file not found.")
        return {}
        
    counts = {"2026-08-04": 0, "2026-08-05": 0, "2026-08-06": 0}
    with open(csv_file, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            create_date = row.get("Create Date")
            if create_date:
                date_str = create_date.split("T")[0]
                if date_str in counts:
                    counts[date_str] += 1
    return counts

def count_in_db():
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("Missing Supabase credentials.")
        return {}
        
    client = create_client(url, key)
    db_counts = {}
    
    dates = [
        ("2026-08-04", "2026-08-04T00:00:00+00:00", "2026-08-05T00:00:00+00:00"),
        ("2026-08-05", "2026-08-05T00:00:00+00:00", "2026-08-06T00:00:00+00:00"),
        ("2026-08-06", "2026-08-06T00:00:00+00:00", "2026-08-07T00:00:00+00:00"),
    ]
    
    for label, start_ts, end_ts in dates:
        try:
            res = client.table("carriers").select("usdot_number", count="exact")\
                .gte("added_to_motus", start_ts)\
                .lt("added_to_motus", end_ts)\
                .limit(1).execute()
            db_counts[label] = res.count or 0
        except Exception as e:
            print(f"Error querying {label}: {e}")
            db_counts[label] = 0
            
    return db_counts

def main():
    print("--- Counting in CSV ---")
    csv_counts = count_in_csv()
    for d, c in csv_counts.items():
        print(f"  {d}: {c} carriers")
        
    print("\n--- Counting in Database (Total Scraped) ---")
    db_counts = count_in_db()
    for d, c in db_counts.items():
        print(f"  {d}: {c} carriers")

if __name__ == "__main__":
    main()
