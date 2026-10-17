"""Builds seed/karachi_network.json: the M5 Karachi monitoring network and fire-response dataset.

Offline, deterministic generator. It reads raw Overpass API exports (OpenStreetMap, ODbL-1.0)
and writes the JSON the seed loads. The exports are not committed; re-create them with:

  roads.json     [out:json];way["highway"~"^(motorway|trunk|primary|secondary)$"]
                 (24.78,66.90,25.08,67.30);out tags geom;
  stations.json  [out:json];(nwr["amenity"="fire_station"](24.75,66.65,25.25,67.45);
                 nwr["emergency"="fire_station"](24.75,66.65,25.25,67.45););out center tags;
  surv.json      [out:json];(nwr["man_made"="surveillance"](24.75,66.65,25.25,67.45););
                 out center tags;

Run:  uv run python seed/build_karachi_network.py <dir with the three exports>

Placement rule for simulated coverage nodes: every node sits on a vertex of a mapped major road
(motorway/trunk/primary/secondary) inside its zone, chosen by farthest-point sampling from the
vertex nearest the zone anchor, with a minimum spacing between all nodes. Nothing is random, and
nothing lands on water or parks because road vertices are never there. These nodes are where
PehRadar could monitor once authorised CCTV is integrated; they are not real cameras.
"""

import json
import math
import re
import sys
from pathlib import Path

OUT = Path(__file__).resolve().parent / "karachi_network.json"
RETRIEVED = "2026-10-17"
MIN_SPACING_KM = 0.45

# Zone code, display name, anchor (lat, lng), radius km, node count, optional road-name filter.
ZONES = [
    ("SAD", "Saddar", (24.8607, 67.0280), 1.3, 10, None),
    ("IIC", "I.I. Chundrigar business district", (24.8490, 67.0060), 1.0, 6, None),
    ("CLF", "Clifton", (24.8170, 67.0300), 1.8, 9, None),
    ("DHA", "DHA", (24.8050, 67.0650), 2.5, 11, None),
    ("KOR", "Korangi", (24.8300, 67.1300), 2.6, 12, None),
    ("LND", "Landhi", (24.8450, 67.1950), 2.2, 9, None),
    ("SHF", "Shah Faisal", (24.8770, 67.1580), 1.6, 6, None),
    ("MLR", "Malir", (24.8950, 67.2000), 2.5, 9, None),
    ("GUI", "Gulshan-e-Iqbal", (24.9200, 67.0950), 2.0, 11, None),
    ("GUJ", "Gulistan-e-Jauhar", (24.9150, 67.1350), 1.8, 7, None),
    ("NNZ", "North Nazimabad", (24.9400, 67.0400), 1.6, 7, None),
    ("NAZ", "Nazimabad", (24.9150, 67.0300), 1.3, 5, None),
    ("NKR", "New Karachi", (24.9900, 67.0650), 2.2, 8, None),
    ("SIT", "SITE", (24.9000, 66.9950), 1.8, 10, None),
    ("ORG", "Orangi", (24.9500, 66.9950), 2.2, 8, None),
    ("LYR", "Lyari", (24.8650, 66.9950), 1.3, 7, None),
    ("KMR", "Keamari", (24.8250, 66.9750), 1.8, 6, None),
    ("FBA", "Federal B Area", (24.9300, 67.0750), 1.6, 8, None),
    ("PEC", "PECHS", (24.8650, 67.0650), 1.3, 6, None),
    ("TRQ", "Tariq Road corridor", (24.8700, 67.0600), 2.5, 4, r"tariq road"),
    ("UNR", "University Road corridor", (24.9200, 67.1050), 6.0, 6, r"university road"),
    ("SEF", "Shahrah-e-Faisal corridor", (24.8800, 67.1000), 9.0, 10, r"shah?rah.?e.?faisal"),
    ("AIR", "Airport corridor", (24.8990, 67.1650), 1.8, 5, None),
]

# The eight M3 cameras keep their codes and UUIDs (production detections reference them).
# Three become demo-stream nodes for the scenario engine.
LEGACY = {
    "KHI-CAM-01": ("SAD", "simulated_coverage"),
    "KHI-CAM-02": ("CLF", "demo_stream"),
    "KHI-CAM-03": ("KOR", "demo_stream"),
    "KHI-CAM-04": ("SIT", "simulated_coverage"),
    "KHI-CAM-05": ("GUI", "simulated_coverage"),
    "KHI-CAM-06": ("NNZ", "simulated_coverage"),
    "KHI-CAM-07": ("LYR", "demo_stream"),
    "KHI-CAM-08": ("GUJ", "simulated_coverage"),
}
LEGACY_CAMERAS = [
    ("KHI-CAM-01", "Saddar - Empress Market", 24.8605, 67.0303, "Saddar, near Empress Market"),
    ("KHI-CAM-02", "Clifton - Boat Basin", 24.8215, 67.0335, "Clifton Block 5, Boat Basin"),
    ("KHI-CAM-03", "Korangi Industrial Area", 24.8330, 67.1240, "Korangi Industrial Area"),
    ("KHI-CAM-04", "SITE Industrial Area", 24.9050, 67.0030, "SITE Area"),
    ("KHI-CAM-05", "Gulshan-e-Iqbal", 24.9200, 67.0960, "Gulshan-e-Iqbal Block 13"),
    ("KHI-CAM-06", "North Nazimabad - Hyderi", 24.9330, 67.0360, "North Nazimabad, Hyderi Market"),
    ("KHI-CAM-07", "Lyari", 24.8640, 67.0000, "Lyari"),
    ("KHI-CAM-08", "Gulistan-e-Jauhar", 24.9130, 67.1330, "Gulistan-e-Jauhar"),
]
DEMO_IDLE_ASSET = "street_sunset_traffic.mp4"

# Fire-response facilities: OSM elements reviewed by hand. Excluded from the raw export:
# businesses mis-tagged as fire stations (a trading company, a CNG pump), a second Gulshan-e-Iqbal
# node ~50 m from the first, and an unnamed way duplicating Manzoor Colony.
# facility_type is inferred from the OSM name/operator, not verified with the operator.
STATIONS = [
    ("KHI-FS-01", "way/724176537", "Saddar Fire Station", "Saddar", None, "municipal_fire_station"),
    (
        "KHI-FS-02",
        "node/4762522310",
        "Gulshan-e-Iqbal Fire Station",
        "University Road, Gulshan-e-Iqbal",
        None,
        "municipal_fire_station",
    ),
    (
        "KHI-FS-03",
        "node/5133191784",
        "Landhi Fire Station",
        "Landhi",
        None,
        "municipal_fire_station",
    ),
    (
        "KHI-FS-04",
        "node/5087779613",
        "Orangi Fire Station",
        "Orangi Town",
        "City District Government Karachi (per OSM name)",
        "municipal_fire_station",
    ),
    (
        "KHI-FS-05",
        "node/12184399097",
        "Nazimabad Fire Station",
        "Nazimabad No. 4",
        None,
        "municipal_fire_station",
    ),
    (
        "KHI-FS-06",
        "node/4767920535",
        "Shah Faisal Town Fire Station",
        "Shahrah-e-Faisal, Shah Faisal Town",
        None,
        "municipal_fire_station",
    ),
    (
        "KHI-FS-07",
        "node/5144995473",
        "Manzoor Colony Fire Station",
        "Shaheed-e-Millat Expressway, Manzoor Colony",
        None,
        "municipal_fire_station",
    ),
    (
        "KHI-FS-08",
        "node/12183980455",
        "Sohrab Goth Fire Station",
        "Ancholi Block 20, Gulberg Town",
        None,
        "municipal_fire_station",
    ),
    (
        "KHI-FS-09",
        "way/1175223031",
        "Karsaz Fire Station",
        "Karsaz, Shahrah-e-Faisal",
        None,
        "fire_station_unclassified",
    ),
    (
        "KHI-FS-10",
        "way/1185602804",
        "CAA Fire Station",
        "Jinnah International Airport",
        "Civil Aviation Authority (per OSM operator)",
        "airport_fire_station",
    ),
    (
        "KHI-FS-11",
        "way/1210135610",
        "AKU Fire Station",
        "Aga Khan University, Stadium Road",
        "Aga Khan University (per OSM operator)",
        "institutional_fire_response",
    ),
]
# Plain surveillance points only: CCTV shops/companies tagged man_made=surveillance are excluded.
SURVEILLANCE_EXCLUDE_NAMED = True


def km(a: tuple[float, float], b: tuple[float, float]) -> float:
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    dp, dl = p2 - p1, math.radians(b[1] - a[1])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * 6371.0088 * math.asin(math.sqrt(h))


def road_vertices(roads: dict) -> list[tuple[float, float, str]]:
    seen, out = set(), []
    for way in roads["elements"]:
        tags = way.get("tags", {})
        name = tags.get("name:en") or tags.get("name")
        if not name or not re.search(r"[A-Za-z]", name):
            continue
        for p in way.get("geometry", []):
            key = (round(p["lat"], 5), round(p["lon"], 5))
            if key not in seen:
                seen.add(key)
                out.append((key[0], key[1], name))
    out.sort()
    return out


def sample_zone(vertices, anchor, radius, count, name_filter, taken):
    pool = [
        v
        for v in vertices
        if km(anchor, v[:2]) <= radius
        and (name_filter is None or re.search(name_filter, v[2], re.I))
        and all(km(v[:2], t) >= MIN_SPACING_KM for t in taken)
    ]
    if not pool:
        return []
    chosen = [min(pool, key=lambda v: (km(anchor, v[:2]), v))]
    while len(chosen) < count:
        best, best_d = None, 0.0
        for v in pool:
            d = min(km(v[:2], c[:2]) for c in chosen + [(t[0], t[1], "") for t in taken])
            if d >= MIN_SPACING_KM and d > best_d:
                best, best_d = v, d
        if best is None:
            break
        chosen.append(best)
    return chosen


def main(src: Path) -> None:
    roads = json.loads((src / "roads.json").read_text(encoding="utf-8"))
    stations_raw = json.loads((src / "stations.json").read_text(encoding="utf-8"))
    surv_raw = json.loads((src / "surv.json").read_text(encoding="utf-8"))
    vertices = road_vertices(roads)
    osm = {f"{e['type']}/{e['id']}": e for e in stations_raw["elements"]}
    zones = {z[0]: z for z in ZONES}

    cameras = []
    taken: list[tuple[float, float]] = []
    for code, name, lat, lng, label in LEGACY_CAMERAS:
        zone, source_type = LEGACY[code]
        demo = source_type == "demo_stream"
        cameras.append(
            {
                "code": code,
                "name": name,
                "latitude": lat,
                "longitude": lng,
                "location_label": label,
                "district": zones[zone][1],
                "camera_type": "fixed_cctv",
                "source_type": source_type,
                "source_reference": (
                    "PehRadar demo stream: licensed sample footage looped as a simulated feed"
                    if demo
                    else "PehRadar simulated coverage point (M3 demo camera)"
                ),
                "stream_type": "mp4_loop" if demo else "none",
                "feed_asset": DEMO_IDLE_ASSET if demo else None,
            }
        )
        taken.append((lat, lng))

    for element in surv_raw["elements"]:
        tags = element.get("tags", {})
        if SURVEILLANCE_EXCLUDE_NAMED and (tags.get("name") or tags.get("website")):
            continue
        c = element.get("center", element)
        lat, lng = round(c["lat"], 5), round(c["lon"], 5)
        nearest = min(ZONES, key=lambda z: km(z[2], (lat, lng)))
        ref = f"osm:{element['type']}/{element['id']}"
        mapped = sum(1 for x in cameras if x["source_type"] == "verified_mapped")
        cameras.append(
            {
                "code": f"KHI-OSM-{mapped + 1:03d}",
                "name": f"Mapped surveillance point near {nearest[1]}",
                "latitude": lat,
                "longitude": lng,
                "location_label": f"{nearest[1]} (OSM-mapped camera location)",
                "district": nearest[1],
                "camera_type": tags.get("camera:type", "unknown"),
                "source_type": "verified_mapped",
                "source_reference": f"{ref} (man_made=surveillance), OpenStreetMap ODbL-1.0, "
                f"retrieved {RETRIEVED}. Location only: no feed access.",
                "stream_type": "none",
                "feed_asset": None,
            }
        )
        taken.append((lat, lng))

    for code, zname, anchor, radius, count, name_filter in ZONES:
        already = sum(1 for c in cameras if c["district"] == zname)
        picks = sample_zone(vertices, anchor, radius, max(count - already, 0), name_filter, taken)
        for i, (lat, lng, road) in enumerate(picks, start=1):
            cameras.append(
                {
                    "code": f"KHI-{code}-{i:03d}",
                    "name": f"{zname} - {road}",
                    "latitude": lat,
                    "longitude": lng,
                    "location_label": f"{road}, {zname}",
                    "district": zname,
                    "camera_type": "fixed_cctv",
                    "source_type": "simulated_coverage",
                    "source_reference": "PehRadar simulated coverage node on an OSM-mapped road "
                    f"(placement only, ODbL-1.0, retrieved {RETRIEVED})",
                    "stream_type": "none",
                    "feed_asset": None,
                }
            )
            taken.append((lat, lng))

    stations = []
    for code, ref, name, label, operator, facility_type in STATIONS:
        e = osm[ref]
        c = e.get("center", e)
        stations.append(
            {
                "code": code,
                "name": name,
                "latitude": round(c["lat"], 5),
                "longitude": round(c["lon"], 5),
                "location_label": label,
                "operator": operator,
                "facility_type": facility_type,
                "source_ref": f"osm:{ref}",
            }
        )

    out = {
        "_about": (
            "PehRadar M5 Karachi network. NO official or Sindh Safe City CCTV is integrated. "
            "simulated_coverage: deterministic points on OSM-mapped major roads, not cameras. "
            "demo_stream: simulated nodes that loop licensed sample footage. verified_mapped: a "
            "camera location mapped in OpenStreetMap, location only. Fire-response facilities are "
            f"OSM elements (ODbL-1.0, (c) OpenStreetMap contributors) retrieved {RETRIEVED}, "
            "UNVERIFIED; their availability is a demo flag. Generated by build_karachi_network.py."
        ),
        "cameras": cameras,
        "fire_stations": stations,
    }
    OUT.write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    by_type: dict[str, int] = {}
    for c in cameras:
        by_type[c["source_type"]] = by_type.get(c["source_type"], 0) + 1
    print(f"{len(cameras)} cameras {by_type}; {len(stations)} stations -> {OUT}")
    for z in ZONES:
        n = sum(1 for c in cameras if c["district"] == z[1])
        if n < z[4]:
            print(f"  zone {z[1]}: {n}/{z[4]}")


if __name__ == "__main__":
    main(Path(sys.argv[1]))
