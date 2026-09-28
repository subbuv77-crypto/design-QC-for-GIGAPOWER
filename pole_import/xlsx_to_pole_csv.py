"""Convert a PNM JU pole export (.xlsx) into the IQGeo pole.csv import layout.

Usage: python xlsx_to_pole_csv.py <poles.xlsx> <out.csv> <design_id>
"""
import csv
import re
import struct
import sys

import openpyxl

HEADER = ("id,owner,owner_pole_number,name,lat_lon,pole_loading_analysis_cmp,labor_costs,location,"
          "myw_orientation_location,yr_placed,frc,proj_id,addr_house_number_prefix,addr_house_number,"
          "addr_house_number_suffix,addr_street_direction,addr_street_name,addr_street_throughfare,"
          "addr_street_name_suffix,addr_city,addr_state,addr_postal_code,addr_postal_code_plus_4,"
          "addr_county,addr_country,addr_full,addr_unit,glid,build_status,delta_created,in_service_date,"
          "sn_asset_id,ground,created_at,updated_at,create_user,update_user,sort_children,design_id,"
          "include_comsof").split(",")

STREET_TYPES = {"RD", "AVE", "CT", "DR", "BLVD", "LN", "PL", "ST", "WAY", "CIR", "TRL", "LOOP", "PKWY", "HWY"}
DIRECTIONS = {"N", "S", "E", "W", "NE", "NW", "SE", "SW"}


def ewkb_point(lon, lat):
    """EWKB hex (little endian, SRID 4326) as IQGeo's location column expects."""
    return (struct.pack("<BII", 1, 0x20000001, 4326) + struct.pack("<dd", round(lon, 7), round(lat, 7))).hex().upper()


def parse_street(addr):
    """'2718 RIO GRANDE BLVD NW A' -> dict of address parts; returns {} for unusable values."""
    tokens = (addr or "").upper().split()
    if not tokens or addr.strip().upper() == "N/A":
        return {}
    parts = {"number": "", "direction": "", "name": "", "type": "", "unit": ""}
    # stray leading letter before the house number (e.g. 'O 2015 CANDELARIA RD NW')
    if len(tokens) > 1 and re.fullmatch(r"[A-Z]", tokens[0]) and tokens[1].isdigit():
        tokens = tokens[1:]
    if tokens[0].isdigit():
        parts["number"] = tokens.pop(0)
    # unit letter after the post-direction (e.g. '... BLVD NW A')
    if len(tokens) >= 2 and re.fullmatch(r"[A-Z0-9]", tokens[-1]) and tokens[-2] in DIRECTIONS:
        parts["unit"] = tokens.pop()
    if tokens and tokens[-1] in DIRECTIONS:
        parts["direction"] = tokens.pop()
    if len(tokens) > 1 and tokens[-1] in STREET_TYPES:
        parts["type"] = tokens.pop()
    parts["name"] = " ".join(tokens)
    return parts


def parse_city_line(line):
    """'ALBUQUERQUE NM 87104' / 'ALBUQUERQUE 87104' -> (city, state, zip)."""
    m = re.fullmatch(r"\s*(.*?)\s*(?:\b([A-Z]{2})\s+)?(\d{5})(?:-(\d{4}))?\s*", (line or "").upper())
    if not m:
        return (line or "").strip().upper(), "NM", "", ""
    return m.group(1), m.group(2) or "NM", m.group(3), m.group(4) or ""


def convert(xlsx_path, out_path, design_id):
    ws = openpyxl.load_workbook(xlsx_path, read_only=True).active
    rows = ws.iter_rows(values_only=True)
    cols = {name: i for i, name in enumerate(next(rows))}
    out = []
    for r in rows:
        get = lambda k: r[cols[k]]
        if not get("FacilityID"):
            continue
        lon, lat = map(float, re.findall(r"-?\d+\.?\d*", get("wkt_geom"))[:2])
        street = parse_street(get("SITUSADD"))
        city, state, zipc, plus4 = parse_city_line(get("SITUSADD2"))
        name = " ".join(p for p in (street.get("number"), street.get("name"), street.get("type"),
                                    street.get("direction"), street.get("unit")) if p)
        rec = dict.fromkeys(HEADER, "")
        rec.update({
            "owner": get("Owner") or "PNM",
            "owner_pole_number": get("FacilityID"),
            "name": name or get("FacilityID"),
            "lat_lon": f"{lat}/{lon}",
            "pole_loading_analysis_cmp": "TRUE" if get("SPIDA_COMPLETE") == 1 else "FALSE",
            "location": ewkb_point(lon, lat),
            "addr_house_number": street.get("number", ""),
            "addr_street_direction": street.get("direction", ""),
            "addr_street_name": street.get("name", ""),
            "addr_street_throughfare": street.get("type", ""),
            "addr_unit": street.get("unit", ""),
            "addr_city": city,
            "addr_state": state,
            "addr_postal_code": zipc,
            "addr_postal_code_plus_4": plus4,
            "addr_county": "BERNALILLO",
            "addr_country": "USA",
            "addr_full": " ".join(p for p in (name, city, state, zipc) if p),
            "build_status": "Planned",
            "delta_created": f"design/{design_id}",
            "ground": "no",
            "design_id": design_id,
            "include_comsof": "TRUE",
        })
        out.append(rec)
    with open(out_path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=HEADER, lineterminator="\n")
        w.writeheader()
        w.writerows(out)
    return len(out)


if __name__ == "__main__":
    print(convert(sys.argv[1], sys.argv[2], sys.argv[3]), "poles written")
