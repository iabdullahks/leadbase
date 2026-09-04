import glob
import os
import csv

def main():
    v8_file = "unadded_leads_from_4582560_v8.csv"
    if not os.path.exists(v8_file):
        print(f"Error: {v8_file} does not exist.")
        return

    # 1. Load DOTs from v8
    v8_dots = set()
    with open(v8_file, "r", encoding="utf-8", errors="ignore") as fp:
        reader = csv.DictReader(fp)
        for row in reader:
            d = row.get("USDOT Number")
            if d and d.isdigit():
                v8_dots.add(int(d))

    print(f"Total unique USDOTs in v8: {len(v8_dots):,}")

    # 2. Check overlap against every other CSV
    all_other_dots = set()
    overlap_by_file = {}
    csv_files = [f for f in sorted(glob.glob("*.csv")) if f != v8_file]

    for f in csv_files:
        file_dots = set()
        with open(f, "r", encoding="utf-8", errors="ignore") as fp:
            reader = csv.reader(fp)
            header = next(reader, None)
            dot_idx = 0
            if header:
                for idx, col in enumerate(header):
                    if "dot" in col.lower():
                        dot_idx = idx
                        break
            for r in reader:
                if r and len(r) > dot_idx and r[dot_idx].strip().isdigit():
                    file_dots.add(int(r[dot_idx].strip()))

        all_other_dots.update(file_dots)
        overlap = v8_dots.intersection(file_dots)
        if overlap:
            overlap_by_file[f] = len(overlap)

    print(f"Total unique USDOTs across all other {len(csv_files)} CSV files: {len(all_other_dots):,}")
    total_overlap = v8_dots.intersection(all_other_dots)
    exclusive = v8_dots - all_other_dots
    print(f"Total v8 leads overlapping with ANY other CSV: {len(total_overlap):,} ({len(total_overlap)/len(v8_dots)*100:.2f}%)")
    print(f"Total v8 leads 100% EXCLUSIVE to v8 (never seen in any other CSV): {len(exclusive):,} ({len(exclusive)/len(v8_dots)*100:.2f}%)")

    print("\nOverlap breakdown by file:")
    if overlap_by_file:
        for f, count in sorted(overlap_by_file.items(), key=lambda x: x[1], reverse=True):
            print(f"  {f:40} : {count:5,} overlapping leads")
    else:
        print("  None! Zero overlap with any other CSV file.")

if __name__ == "__main__":
    main()
