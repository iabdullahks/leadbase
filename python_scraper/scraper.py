#!/usr/bin/env python3
"""
MOTUS DOT Public Carrier Scraper
Scrapes detailed carrier profile registration data from https://motus.dot.gov/
"""

import sys
import json
import argparse
import urllib.request
from bs4 import BeautifulSoup
from scrapling.fetchers import DynamicFetcher

def format_address(loc):
    if not loc:
        return ""
    addr = loc.get("addressLine1") or ""
    line2 = loc.get("addressLine2")
    if line2:
        addr += f", {line2}"
    city = loc.get("city") or ""
    state = loc.get("state") or ""
    zip_code = loc.get("zipCode") or ""
    return f"{addr}, {city}, {state} {zip_code}".strip().replace("  ", " ")

def scrape_via_api(usdot):
    """
    Attempts to fetch details directly from the public REST API endpoints at lightning speed.
    """
    print(f"[*] Querying MOTUS API for USDOT #{usdot}...")
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
        "Referer": f"https://motus.dot.gov/customer/{usdot}/account"
    }
    
    # 1. Lookup basic details to get entityId
    carrier_url = f"https://motus.dot.gov/api/carriers/{usdot}"
    import urllib.error
    try:
        req = urllib.request.Request(carrier_url, headers=headers)
        with urllib.request.urlopen(req, timeout=10) as response:
            carrier_data = json.loads(response.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        print(f"[!] API carrier lookup failed with HTTP error {e.code}: {e.reason}")
        if e.code in (400, 404):
            return {"not_found": True}
        return None
    except Exception as e:
        print(f"[!] API carrier lookup failed: {e}")
        return None
        
    entity_id = carrier_data.get("entityId")
    if not entity_id:
        print("[!] No entity ID found in API response.")
        return None
        
    # 2. Query public-registration-matrix for deep details
    matrix_url = f"https://motus.dot.gov/api/public-registration-matrix/{entity_id}"
    try:
        req = urllib.request.Request(matrix_url, headers=headers)
        with urllib.request.urlopen(req, timeout=10) as response:
            matrix_data = json.loads(response.read().decode('utf-8'))
    except Exception as e:
        print(f"[!] API registration matrix lookup failed: {e}")
        return None
        
    entity = matrix_data.get("entity", {})
    detail = entity.get("carrierEntityDetail", {}) or {}
    answer = entity.get("carrierEntityAnswer", {}) or {}
    
    # Extract MOTUS entry date/time (when carrier was first entered in MOTUS)
    motus_entry_date = (
        entity.get("createDate")
        or carrier_data.get("createDate")
        or ""
    )
    motus_last_updated = (
        entity.get("updateDate")
        or carrier_data.get("updateDate")
        or ""
    )
    added_to_motus = motus_entry_date  # kept for backward compatibility
    
    # Extract names
    names = entity.get("entityNames", [])
    legal_name = ""
    dba_name = ""
    for n in names:
        if n.get("nameType") == "Legal":
            legal_name = n.get("entityName")
        elif n.get("nameType") == "DBA":
            dba_name = n.get("entityName")
            
    if not legal_name:
        legal_name = entity.get("entityName") or carrier_data.get("entityName") or ""
        
    # Extract locations
    locations = entity.get("locations", [])
    ppob_addr = ""
    mailing_addr = ""
    for loc in locations:
        # eef9bd53-0da3-4b96-b462-8e2711a009ef is PPOB
        if loc.get("addressTypeId") == "eef9bd53-0da3-4b96-b462-8e2711a009ef":
            ppob_addr = format_address(loc)
        # 34878d0c-cf18-46ce-a23e-60bfcaf558db is Mailing
        elif loc.get("addressTypeId") == "34878d0c-cf18-46ce-a23e-60bfcaf558db":
            mailing_addr = format_address(loc)
            
    # Fallbacks for locations if type-specific IDs aren't found
    if not ppob_addr and locations:
        ppob_addr = format_address(locations[0])
    if not mailing_addr and locations:
        mailing_addr = format_address(locations[-1])
        
    # Extract phone / email
    phones = entity.get("phoneNumbers", [])
    emails = entity.get("emailAddresses", [])
    phone = phones[0].get("phoneNumber") if phones else ""
    email = emails[0].get("emailAddress") if emails else ""
    
    # Extract Form of Business details
    business_type = detail.get("businessType", {}) or {}
    form_of_business = business_type.get("businessTypeName") or ""
    
    # Duns & Bradstreet
    duns = str(detail.get("dunBradstreetNo") or "")
    if duns == "0":
        duns = "000000000"
        
    data = {
        "usdot_number": usdot,
        "profile_url": f"https://motus.dot.gov/customer/{usdot}/account",
        "added_to_motus": added_to_motus,
        "motus_entry_date": motus_entry_date,
        "motus_last_updated": motus_last_updated,
        "carrier_status": carrier_data.get("entityDotNumber", {}).get("dotNumberStatus", {}).get("dotNumberStatus") or "Active",
        "out_of_service": carrier_data.get("outOfService") or False,
        "business_information": {
            "Legal Business Name": legal_name,
            "Doing Business As (DBA) Name": dba_name,
            "Principal Place of Business": ppob_addr,
            "Mailing Address": mailing_addr,
            "Business Telephone No.": phone,
            "Duns & Bradstreet": duns,
            "Form of Business": form_of_business,
            "State Incorporated": detail.get("stateOfIncorp") or "",
            "Business Email": email
        }
    }
    
    # Extract Officials
    officials = []
    for off in entity.get("entityOfficers", []):
        first = (off.get("firstName") or "").strip()
        last = (off.get("lastName") or "").strip()
        name = f"{first} {last}".replace("  ", " ").strip()
        officials.append({
            "Official Name": name,
            "Title": off.get("title") or "",
            "Telephone No": off.get("phoneNumber") or "",
            "Email": off.get("email") or ""
        })
    data["company_officials"] = officials
    
    # Extract New Entrant Status
    nep_status = "NEVER IN NEW ENTRANT PROGRAM"
    new_entrants = entity.get("entityNewEntrant", [])
    if new_entrants:
        ne_status_obj = new_entrants[0].get("entityNewEntrantStatus", {}) or {}
        nep_status = ne_status_obj.get("entityNewEntrantStatusName") or nep_status
    data["new_entrant_program"] = {
        "NEW ENTRANT PROGRAM DETAILS": "",
        "Program Status": nep_status
    }
    
    # Extract Cargo Classifications
    cargo = []
    for c in entity.get("entityCargoClassification", []):
        desc_obj = c.get("cargoClassification", {}) or {}
        desc = desc_obj.get("cargoClassificationDescription") or ""
        if desc == "Please Describe" and c.get("otherDescription"):
            desc = c.get("otherDescription")
        if desc:
            cargo.append(desc)
    data["cargo_classification"] = cargo
    
    # Extract Vehicles
    vehicles = []
    for eq in entity.get("entityEquipment", []):
        eq_type = eq.get("equipmentType", {}) or {}
        vehicles.append({
            "Vehicle Type": eq_type.get("equipmentTypeDesc") or "",
            "Owned": str(eq.get("owned") or "0"),
            "Term Leased": str(eq.get("termLeased") or "0")
        })
    data["vehicles"] = vehicles
    
    # Extract Drivers
    drivers = [
        {
            "Driver Information": "Within 100-Mile Radius",
            "Interstate": str(answer.get("driversWithin100Inter") or "0"),
            "Intrastate": str(answer.get("driversWithin100Intra") or "0")
        },
        {
            "Driver Information": "Beyond 100-Mile Radius",
            "Interstate": str(answer.get("driversBeyond100Inter") or "0"),
            "Intrastate": str(answer.get("driversBeyond100Intra") or "0")
        },
        {
            "Driver Information": f"Total CDL drivers: {answer.get('totalCdl') or '0'}",
            "Interstate": "",
            "Intrastate": ""
        }
    ]
    data["drivers"] = drivers
    
    print("[*] Successfully extracted details via API.")
    return data

def expand_accordions(page):
    """
    Finds and expands all collapsed accordions so their lazy-loaded DOM elements
    are rendered and available for scraping.
    """
    print("[*] Finding accordion panels...")
    # Find all accordion summaries
    summaries = page.locator('.MuiAccordionSummary-root').all()
    expanded_count = 0
    
    for summary in summaries:
        aria_expanded = summary.get_attribute('aria-expanded')
        try:
            header_text = summary.inner_text().strip().replace('\n', ' ')
        except Exception:
            header_text = "Unknown Panel"
            
        if aria_expanded == 'false':
            print(f"[*] Expanding: '{header_text}'")
            summary.click()
            # Wait briefly for transition animation and DOM rendering
            page.wait_for_timeout(600)
            expanded_count += 1
            
    if expanded_count > 0:
        print(f"[*] Expanded {expanded_count} panels.")
        page.wait_for_timeout(1000)

def parse_profile_html(html_content):
    """
    Parses the expanded HTML structure using BeautifulSoup and extracts all section details.
    """
    soup = BeautifulSoup(html_content, 'lxml')
    data = {}
    
    # Extract Added Date/Time from text
    added_to_motus = ""
    # We can search in scripts or just leave it empty if using browser fallback
    
    # -- 1. Extract Business Information --
    labels = [
        "Legal Business Name", "Doing Business As (DBA) Name", 
        "Principal Place of Business", "Mailing Address", 
        "Business Telephone No.", "Duns & Bradstreet", 
        "Form of Business", "State Incorporated", "Business Email"
    ]
    business_info = {}
    for label in labels:
        lbl_el = soup.find(string=lambda t: t and label in t)
        if lbl_el:
            lbl_parent = lbl_el.parent
            parent1 = lbl_parent.parent
            parent2 = parent1.parent
            children = [c for c in parent2.children if c.name]
            if len(children) >= 2:
                business_info[label] = children[1].get_text().strip()
            else:
                business_info[label] = ""
        else:
            business_info[label] = ""
    data["business_information"] = business_info

    # -- Helper to find accordion detail container --
    def get_accordion_details(section_title):
        h6 = soup.find('h6', string=lambda t: t and section_title.lower() in t.lower())
        if h6:
            container = h6.parent
            while container and not (container.name == 'div' and container.get('class') and any('MuiAccordion-root' in c for c in container.get('class'))):
                container = container.parent
            if container:
                return container.find(class_=lambda c: c and 'MuiAccordionDetails-root' in c)
        return None

    # -- Helper to parse DataGrid structure --
    def parse_datagrid(details_container):
        if not details_container:
            return []
        grid = details_container.find(class_=lambda c: c and 'MuiDataGrid-main' in c)
        if not grid:
            return []
            
        # Extract column header names mapped to their data-field keys
        header_map = {}
        headers = grid.find_all(class_=lambda c: c and 'MuiDataGrid-columnHeader' in c)
        for h in headers:
            field = h.get('data-field')
            title = h.get_text().strip()
            if field and field != 'None':
                header_map[field] = title
                
        # Parse rows and map cells using data-field
        rows_data = []
        rows = grid.find_all(class_=lambda c: c and 'MuiDataGrid-row' in c)
        for row in rows:
            cells = row.find_all(class_=lambda c: c and 'MuiDataGrid-cell' in c)
            row_dict = {}
            for cell in cells:
                field = cell.get('data-field')
                if field and field != 'None' and field in header_map:
                    row_dict[header_map[field]] = cell.get_text().strip()
            if row_dict:
                rows_data.append(row_dict)
        return rows_data

    # -- 2. Parse Company Officials --
    officials_details = get_accordion_details("Company Officials")
    data["company_officials"] = parse_datagrid(officials_details)

    # -- 3. Parse New Entrant Program --
    nep_details = get_accordion_details("NEW ENTRANT PROGRAM")
    nep_info = {}
    if nep_details:
        p_elements = nep_details.find_all('p')
        for p in p_elements:
            p_class = p.get('class')
            if p_class and any('frs-text-bold' in c for c in p_class):
                label_text = p.get_text().strip()
                parent2 = p.parent.parent
                children = [c for c in parent2.children if c.name]
                if len(children) >= 2:
                    nep_info[label_text] = children[1].get_text().strip()
    data["new_entrant_program"] = nep_info

    # -- 4. Parse Cargo Classification --
    cargo_details = get_accordion_details("CARGO CLASSIFICATION")
    cargo_items = []
    if cargo_details:
        lis = cargo_details.find_all('li')
        cargo_items = [li.get_text().strip() for li in lis if li.get_text().strip()]
    data["cargo_classification"] = cargo_items

    # -- 5. Parse Vehicles --
    vehicles_details = get_accordion_details("VEHICLES")
    data["vehicles"] = parse_datagrid(vehicles_details)

    # -- 6. Parse Drivers --
    drivers_details = get_accordion_details("DRIVER(S)")
    data["drivers"] = parse_datagrid(drivers_details)

    return data

def scrape_via_browser(usdot):
    """
    Fallback browser-based scraping using Scrapling DynamicFetcher.
    """
    target_url = f"https://motus.dot.gov/customer/{usdot}/account"
    print(f"[*] Falling back to Playwright browser scraper: {target_url}")
    
    extracted_data = {}
    
    def page_handler(page):
        try:
            page.wait_for_selector('text="BUSINESS INFORMATION"', timeout=15000)
        except Exception:
            print(f"[!] Error: Profile for USDOT #{usdot} failed to load in browser.")
            return
            
        expand_accordions(page)
        
        print("[*] Parsing page content...")
        html_content = page.content()
        nonlocal extracted_data
        extracted_data = parse_profile_html(html_content)
        extracted_data["usdot_number"] = usdot
        extracted_data["profile_url"] = page.url
        extracted_data["added_to_motus"] = "" 
        
        # Parse Status from browser page DOM
        from bs4 import BeautifulSoup
        soup = BeautifulSoup(html_content, 'lxml')
        status_text = "Active"
        for label_text in ["Status", "Operating Status"]:
            lbl = soup.find(string=lambda t: t and label_text in t)
            if lbl:
                parent = lbl.parent
                val = parent.find_next_sibling() or (parent.parent and parent.parent.find_next_sibling())
                if val:
                    status_text = val.get_text().strip()
                    break
        extracted_data["carrier_status"] = status_text
        extracted_data["out_of_service"] = "inactive" in status_text.lower() or "out of service" in status_text.lower() # Left blank in browser scrape, or extracted if found

    DynamicFetcher.fetch(
        target_url,
        headless=True,
        network_idle=True,
        timeout=30000,
        page_action=page_handler
    )
    return extracted_data

def scrape_carrier(usdot, output_file=None):
    # Try lightning-fast REST API first
    data = scrape_via_api(usdot)
    
    if data and data.get("not_found"):
        print(f"[!] Carrier USDOT #{usdot} not found in MOTUS.")
        if output_file:
            with open(output_file, 'w') as f:
                json.dump(data, f)
        return
        
    # Browser fallback if API failed or returned incomplete details
    if not data:
        print("[!] REST API failed. Trying browser fallback...")
        data = scrape_via_browser(usdot)
        
    if not data or data.get("not_found"):
        print("[!] Error: No data could be scraped for carrier.")
        sys.exit(1)
        
    json_output = json.dumps(data, indent=2)
    
    if output_file:
        with open(output_file, 'w') as f:
            f.write(json_output)
        print(f"[+] Successfully saved carrier data to: {output_file}")
    else:
        print("\n--- Scraped Carrier Details ---")
        print(json_output)

def main():
    parser = argparse.ArgumentParser(description="Lightning-fast MOTUS DOT registry scraper")
    parser.add_argument("usdot", help="The USDOT number of the carrier to scrape")
    parser.add_argument("-o", "--output", help="Path to save the output JSON file")
    args = parser.parse_args()
    
    scrape_carrier(args.usdot, args.output)

if __name__ == "__main__":
    main()
