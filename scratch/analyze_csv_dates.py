import csv
import os

def main():
    csv_file = "unadded_leads_from_4582560_v3.csv"
    if not os.path.exists(csv_file):
        print("CSV file not found.")
        return
        
    months = {}
    with open(csv_file, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            create_date = row.get("Create Date")
            if create_date:
                # Format is YYYY-MM
                month_str = create_date[:7]
                months[month_str] = months.get(month_str, 0) + 1
                
    print("--- Distribution of Leads in CSV by Registration Month ---")
    for m in sorted(months.keys()):
        print(f"  {m}: {months[m]} leads")

if __name__ == "__main__":
    main()
