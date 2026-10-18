"""Assigns Pakistan-based demo footage (seed/feed_library.json) to simulated Karachi nodes (M6B).

Deterministic and idempotent: it rewrites seed/karachi_network.json in place.

  uv run python seed/assign_feeds.py

Rule: every simulated node in a zone listed in feed_library.json becomes a `demo_stream` node.
Its clip is picked round-robin from the zone's context list (cameras ordered by code), and its loop
start offset comes from a CRC of its code, so neighbouring nodes that share a clip do not look
identical. Mapped OSM locations are never given a feed. The footage is labelled as demo footage
recorded elsewhere in Pakistan; nothing here claims Karachi CCTV access.
"""

import json
import zlib
from pathlib import Path

HERE = Path(__file__).resolve().parent
NETWORK = HERE / "karachi_network.json"
LIBRARY = HERE / "feed_library.json"
ASSETS = HERE.parent / "demo_assets"
FEEDABLE = ("simulated_coverage", "demo_stream")


def feed_meta(asset: dict, code: str) -> dict:
    duration = float(asset["duration_s"])
    # Half-second steps inside the clip, never the last half second.
    steps = max(1, int(duration * 2) - 1)
    offset = (zlib.crc32(code.encode()) % steps) / 2
    return {
        "asset": asset["asset"],
        "title": asset["title"],
        "country": "Pakistan",
        "city": asset["city"],
        "context": asset["context"],
        "source_type": "pakistan_demo_footage",
        "is_demo_feed": True,
        "start_offset_s": offset,
        "source_url": asset["source_url"],
        "licence": asset["licence"],
        "licence_note": (
            f"{asset['licence']}, {asset['attribution']}: {asset['source_title']}, segment "
            f"{asset['segment']}. Demo footage recorded in {asset['city']}, not at this location; "
            "not CCTV, not live."
        ),
        "attribution": asset["attribution"],
    }


def assign(network: dict, library: dict) -> int:
    assets = {a["asset"]: a for a in library["assets"]}
    for name in assets:
        if not (ASSETS / name).is_file():
            raise SystemExit(f"missing demo asset {name}")
    by_zone: dict[str, list[dict]] = {}
    for camera in network["cameras"]:
        if camera["source_type"] in FEEDABLE and camera.get("district") in library["zones"]:
            by_zone.setdefault(camera["district"], []).append(camera)
    assigned = 0
    for zone, cameras in by_zone.items():
        choices = library["zones"][zone]
        for i, camera in enumerate(sorted(cameras, key=lambda c: c["code"])):
            asset = assets[choices[i % len(choices)]]
            camera["source_type"] = "demo_stream"
            camera["stream_type"] = "mp4_loop"
            camera["feed_asset"] = asset["asset"]
            camera["feed"] = feed_meta(asset, camera["code"])
            camera["source_reference"] = (
                f"PehRadar demo stream: Pakistan-based demo footage ({asset['city']}) looped as a "
                "simulated feed on a simulated node. Not recorded here; not CCTV."
            )
            assigned += 1
    return assigned


def main() -> None:
    network = json.loads(NETWORK.read_text(encoding="utf-8"))
    library = json.loads(LIBRARY.read_text(encoding="utf-8"))
    assigned = assign(network, library)
    NETWORK.write_text(json.dumps(network, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Assigned demo feeds to {assigned} nodes")


if __name__ == "__main__":
    main()
