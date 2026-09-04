import csv
import os

def main():
    file_v5 = "unadded_leads_from_4582560_v5.csv"
    if not os.path.exists(file_v5):
        print(f"Error: {file_v5} does not exist.")
        return
        
    leads = {}
    with open(file_v5, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            dot = row.get("USDOT Number")
            if dot:
                leads[int(dot)] = row
                
    print(f"Loaded {len(leads)} leads from {file_v5} for sorting.")
    
    # Sort keys
    sorted_dots = sorted(leads.keys())
    
    fields = [
        "USDOT Number", "Legal Business Name", "Business Telephone No.",
        "Business Email", "DOT Status", "Out of Service", "Update Date", "Create Date"
    ]
    
    with open(file_v5, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        for dot in sorted_dots:
            writer.writerow(leads[dot])
            
    print(f"Successfully sorted and saved {len(leads)} leads to {file_v5}")

if __name__ == "__main__":
    main()
