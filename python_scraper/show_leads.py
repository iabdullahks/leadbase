import csv, sys

rows = list(csv.DictReader(open("leads_output.csv", encoding="utf-8")))
print(f"Total qualified leads: {len(rows)}")
print()
for r in rows:
    line = "  USDOT {} | {} | {} | {}| Exit: {}".format(
        r["USDOT Number"],
        r["Legal Business Name"][:35],
        r["Business Telephone No."],
        r["Business Email"][:30],
        r["Program Exit Date"][:10]
    )
    sys.stdout.buffer.write((line + "\n").encode("utf-8", errors="replace"))
