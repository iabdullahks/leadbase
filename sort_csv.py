import csv

input_file = "unadded_leads_from_4582561.csv"

with open(input_file, "r", encoding="utf-8") as f:
    reader = csv.reader(f)
    header = next(reader)
    rows = list(reader)

# Sort rows by integer value of the first column (USDOT Number)
# Filter out any empty rows
rows = [row for row in rows if row and row[0].isdigit()]
rows.sort(key=lambda r: int(r[0]))

print(f"Total sorted rows: {len(rows):,}")

with open(input_file, "w", newline="", encoding="utf-8") as f:
    writer = csv.writer(f)
    writer.writerow(header)
    writer.writerows(rows)

print("[+] Successfully sorted", input_file, "by USDOT Number!")
