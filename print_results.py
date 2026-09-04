import csv

print("=== QUALIFIED LEADS (leads_output.csv) ===")
rows = list(csv.DictReader(open("leads_output.csv", encoding="utf-8")))
for r in rows:
    dot = r["USDOT Number"]
    name = r["Legal Business Name"]
    phone = r["Business Telephone No."]
    email = r["Business Email"]
    exit_date = r["Program Exit Date"][:10]
    print("  USDOT", dot, "|", name, "|", phone, "|", email, "| Exit:", exit_date)

print()
print("=== POTENTIAL LEADS TOP 15 (potential_leads.csv) ===")
rows2 = list(csv.DictReader(open("potential_leads.csv", encoding="utf-8")))
print("Total potential leads:", len(rows2))
print()
for r in rows2[:15]:
    dot = r["USDOT Number"]
    name = r["Legal Business Name"]
    phone = r["Business Telephone No."]
    exit_date = r["Program Exit Date"][:10]
    days = r["Days Since Exit"]
    print("  USDOT", dot, "|", name, "|", phone, "| Exit:", exit_date, "("+days+"d ago)")
