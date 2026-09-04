import os
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

def main():
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    client = create_client(url, key)
    
    ranges = [
        ("1,000,000 - 2,000,000", 1000000, 2000000),
        ("2,000,000 - 3,000,000", 2000000, 3000000),
        ("3,000,000 - 4,000,000", 3000000, 4000000),
        ("4,000,000 - 4,582,560", 4000000, 4582560),
    ]
    
    print("--- USDOT Count in Supabase DB by Range ---")
    for label, start, end in ranges:
        try:
            res = client.table("carriers").select("usdot_number", count="exact")\
                .gte("usdot_number", str(start))\
                .lt("usdot_number", str(end))\
                .limit(1).execute()
            print(f"  Range {label:21}: {res.count or 0} carriers in DB")
        except Exception as e:
            print(f"  Error querying range {label}: {e}")

if __name__ == "__main__":
    main()
