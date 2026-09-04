import urllib.request
import json
import concurrent.futures

headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept":     "application/json",
    "Referer":    "https://motus.dot.gov/",
    "Origin":     "https://motus.dot.gov",
}

def check_dot(dot):
    url = f"https://motus.dot.gov/api/carriers/{dot}"
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode())
            return dot, True, data.get("entityName")
    except Exception:
        return dot, False, None

def main():
    # We will probe DOTs at intervals of 10,000 starting from 10,000,000 up to 10,500,000
    dots_to_check = [10000000 + i * 5000 for i in range(100)]
    print(f"Probing {len(dots_to_check)} DOTs from 10,000,000 to {dots_to_check[-1]:,}...")
    
    found = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=30) as executor:
        futures = {executor.submit(check_dot, dot): dot for dot in dots_to_check}
        for future in concurrent.futures.as_completed(futures):
            dot, exists, name = future.result()
            if exists:
                found.append((dot, name))
                print(f"  [FOUND] USDOT {dot}: {name}")
                
    if found:
        found.sort()
        print(f"Highest found at interval: {found[-1][0]}")
    else:
        print("No DOTs found at checked intervals above 10,000,000.")
        # Let's check if 10000001 or close ones exist
        print("Checking first few DOTs above 10,000,000...")
        for dot in range(10000000, 10000050):
            d, exists, name = check_dot(dot)
            if exists:
                print(f"  [FOUND] USDOT {d}: {name}")

if __name__ == "__main__":
    main()
