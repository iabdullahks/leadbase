import csv
import os

def main():
    file_v3 = "unadded_leads_from_4582560_v3.csv"
    file_new = "unadded_leads_from_4582560_new.csv"
    
    if not os.path.exists(file_v3):
        print(f"Error: {file_v3} does not exist.")
        return
    if not os.path.exists(file_new):
        print(f"Error: {file_new} does not exist.")
        return
        
    leads = {}
    
    # Read v3 leads
    with open(file_v3, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            dot = row.get("USDOT Number")
            if dot:
                leads[int(dot)] = row
                
    v3_count = len(leads)
    print(f"Loaded {v3_count} leads from {file_v3}")
    
    # Read new leads
    new_added = 0
    duplicates = 0
    with open(file_new, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            dot = row.get("USDOT Number")
            if dot:
                dot_int = int(dot)
                if dot_int not in leads:
                    leads[dot_int] = row
                    new_added += 1
                else:
                    duplicates += 1
                    
    print(f"Loaded from {file_new}: {new_added} new leads added, {duplicates} duplicates ignored.")
    print(f"Total merged leads: {len(leads)}")
    
    # Sort keys (USDOT Numbers) ascending
    sorted_dots = sorted(leads.keys())
    
    # Write back to v3 file
    fields = [
        "USDOT Number", "Legal Business Name", "Business Telephone No.",
        "Business Email", "DOT Status", "Out of Service", "Update Date", "Create Date"
    ]
    
    with open(file_v3, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        for dot in sorted_dots:
            writer.writerow(leads[dot])
            
    print(f"Successfully wrote {len(leads)} merged and sorted leads to {file_v3}")

if __name__ == "__main__":
    main()
