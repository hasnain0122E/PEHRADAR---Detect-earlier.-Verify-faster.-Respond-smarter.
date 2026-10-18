"""Builds seed/karachi_response_facilities.json: Karachi police and ambulance stations (M6C).

Offline, deterministic. It reads two raw Overpass API exports (OpenStreetMap, ODbL-1.0) and writes
the curated JSON the seed loads. The exports are not committed; re-create them with:

  police.json     [out:json];nwr["amenity"="police"](24.75,66.65,25.25,67.45);out center tags;
  ambulance.json  [out:json];(nwr["emergency"="ambulance_station"](24.75,66.65,25.25,67.45);
                  nwr["amenity"="ambulance_station"](24.75,66.65,25.25,67.45);
                  nwr["healthcare"="ambulance_station"](24.75,66.65,25.25,67.45););out center tags;

Run:  uv run python seed/build_response_facilities.py <dir with the two exports>

Curation rules (nothing is invented; every record is one OSM element):
- Police: a named amenity=police feature whose name says it is a police station ("Police
  Station" or "thana"). Excluded: traffic sections, anti-narcotics, special branch, crime units,
  naval and motorway (NHMP) police, offices and posts without "police station" in the name,
  unnamed or generic ("Police station") features, and Hub (Balochistan, outside Karachi).
- Ambulance: a named feature explicitly tagged as an ambulance station. Hospitals are NOT counted
  as ambulance resources (OSM rarely says whether a hospital runs ambulances).
- Duplicates: the same station mapped twice (police: same normalised name within 3 km, one name
  containing the other within 1 km, or two stations within 120 m; ambulances: the same service
  brand within 150 m) keeps the element with the lowest OSM id. Two same-named police stations
  further apart (Saeedabad, SITE) stay separate: they cannot be confirmed as duplicates.
"""

import json
import math
import re
import sys
from pathlib import Path

OUT = Path(__file__).resolve().parent / "karachi_response_facilities.json"
RETRIEVED = "2026-10-18"

POLICE_STATION = re.compile(r"police\s*station|\bthana\b|تھانہ", re.I)
POLICE_EXCLUDE = re.compile(
    r"traffic|anti\s*narcotics|special branch|naval|motorway|nhmp|s\.i\.u|\bhub\b|حب", re.I
)
AMBULANCE_BRANDS = [
    ("edhi", "Edhi Foundation"),
    ("chhipa", "Chhipa Welfare Association"),
    ("aman", "Aman Foundation (Aman Ambulance)"),
    ("jdc", "JDC Foundation"),
    ("1122", "Sindh Integrated Emergency & Health Services (SIEHS 1122)"),
    ("khidmat", "Khidmat-e-Khalq Foundation"),
    ("maqsood", "Maqsood Welfare Trust"),
]


def km(a: tuple[float, float], b: tuple[float, float]) -> float:
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    dp, dl = p2 - p1, math.radians(b[1] - a[1])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * 6371.0088 * math.asin(math.sqrt(h))


def point(element: dict) -> tuple[float, float]:
    c = element.get("center", element)
    return round(c["lat"], 5), round(c["lon"], 5)


def name_of(tags: dict) -> str | None:
    name = (tags.get("name:en") or tags.get("name") or "").strip()
    # Keep the Latin part when a name also carries Urdu script.
    latin = re.sub(r"[؀-ۿ]+", "", name).strip(" ،,-")
    return re.sub(r"\s+", " ", latin) or None


def in_karachi(lat: float, lng: float) -> bool:
    # The query box reaches Hub (Balochistan) across the Hub river in the north-west.
    return not (lat > 24.98 and lng < 66.93)


def police_key(name: str) -> str:
    key = re.sub(r"police\s*station|\bps\b|&.*$|\(.*?\)", " ", name.lower())
    return re.sub(r"[^a-z]+", "", key)


def same_police_station(key: str, pt: tuple[float, float], other: dict) -> bool:
    distance = km(pt, other["_pt"])
    if distance < 0.12 or (other["_key"] == key and distance < 3.0):
        return True
    # "Noor Jahan" and "Shahrah e Noor Jahan" a few hundred metres apart: one station.
    return (key in other["_key"] or other["_key"] in key) and distance < 1.0


def tidy_police_name(name: str) -> str:
    name = re.sub(r"\s*&\s*S\.?D\.?P\.?O.*$", "", name, flags=re.I).strip(" .")
    if re.match(r"police station\b", name, re.I):  # "Police Station Clifton" → "Clifton ..."
        rest = re.sub(r"^police station\s*", "", name, flags=re.I).strip(" ()")
        name = f"{rest} Police Station"
    name = re.sub(r"police station", "Police Station", name, flags=re.I)
    return " ".join(
        w if w.isupper() and len(w) <= 4 else w[:1].upper() + w[1:] for w in name.split()
    )


def provenance(element: dict) -> str:
    return f"osm:{element['type']}/{element['id']}"


def build_police(raw: dict) -> tuple[list[dict], dict]:
    kept: list[dict] = []
    skipped = {"not_a_station": 0, "excluded_type": 0, "outside_karachi": 0, "duplicate": 0}
    for e in sorted(raw["elements"], key=lambda e: (e["type"], e["id"])):
        tags = e.get("tags", {})
        name = name_of(tags)
        if not name or not POLICE_STATION.search(name) or not police_key(name):
            skipped["not_a_station"] += 1
            continue
        if POLICE_EXCLUDE.search(tags.get("name", "") + " " + name):
            skipped["excluded_type"] += 1
            continue
        lat, lng = point(e)
        if not in_karachi(lat, lng):
            skipped["outside_karachi"] += 1
            continue
        key = police_key(name)
        if any(same_police_station(key, (lat, lng), k) for k in kept):
            skipped["duplicate"] += 1
            continue
        kept.append(
            {
                "_key": key,
                "_pt": (lat, lng),
                "_id": e["id"],
                "name": tidy_police_name(name),
                "latitude": lat,
                "longitude": lng,
                "location_label": tags.get("addr:street") or tags.get("addr:full") or "Karachi",
                "operator": tags.get("operator") or None,
                "facility_type": "police_station",
                "source_ref": provenance(e),
            }
        )
    return kept, skipped


def brand(name: str) -> tuple[str, str | None]:
    lower = name.lower()
    for key, label in AMBULANCE_BRANDS:
        if key in lower:
            return key, label
    return lower, None


def build_ambulance(raw: dict) -> tuple[list[dict], dict]:
    kept: list[dict] = []
    skipped = {"unnamed": 0, "outside_karachi": 0, "duplicate": 0}
    for e in sorted(raw["elements"], key=lambda e: (e["type"], e["id"])):
        tags = e.get("tags", {})
        name = name_of(tags)
        if not name:
            skipped["unnamed"] += 1
            continue
        lat, lng = point(e)
        if not in_karachi(lat, lng):
            skipped["outside_karachi"] += 1
            continue
        key, operator = brand(name)
        if any(k["_key"] == key and km((lat, lng), k["_pt"]) < 0.15 for k in kept):
            skipped["duplicate"] += 1
            continue
        kept.append(
            {
                "_key": key,
                "_pt": (lat, lng),
                "_id": e["id"],
                "name": name,
                "latitude": lat,
                "longitude": lng,
                "location_label": tags.get("addr:street") or tags.get("addr:full") or "Karachi",
                "operator": tags.get("operator")
                or (f"{operator} (per OSM name)" if operator else None),
                "facility_type": "ambulance_station",
                "source_ref": provenance(e),
            }
        )
    return kept, skipped


def finalise(rows: list[dict], prefix: str) -> list[dict]:
    rows = sorted(rows, key=lambda r: (r["latitude"], r["longitude"]))
    return [
        {"code": f"{prefix}-{i:03d}", **{k: v for k, v in r.items() if not k.startswith("_")}}
        for i, r in enumerate(rows, 1)
    ]


def main(raw_dir: Path) -> None:
    police, police_skipped = build_police(
        json.loads((raw_dir / "police.json").read_text(encoding="utf-8"))
    )
    ambulance, ambulance_skipped = build_ambulance(
        json.loads((raw_dir / "ambulance.json").read_text(encoding="utf-8"))
    )
    data = {
        "_about": (
            "PehRadar M6C response facilities: Karachi police stations and ambulance stations from "
            f"OpenStreetMap (ODbL-1.0, (c) OpenStreetMap contributors), retrieved {RETRIEVED}, "
            "curated by build_response_facilities.py. Locations are mapped, NOT verified with the "
            "police or the ambulance services; availability is a demo flag. Fire stations stay in "
            "karachi_network.json."
        ),
        "curation": {"police_skipped": police_skipped, "ambulance_skipped": ambulance_skipped},
        "police_stations": finalise(police, "KHI-PS"),
        "ambulance_stations": finalise(ambulance, "KHI-AMB"),
    }
    OUT.write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"police stations: {len(police)} {police_skipped}")
    print(f"ambulance stations: {len(ambulance)} {ambulance_skipped}")


if __name__ == "__main__":
    main(Path(sys.argv[1]))
