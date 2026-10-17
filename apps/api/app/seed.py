"""Idempotent Karachi demo seed (cameras + fire stations).

Run:  uv run python -m app.seed   (after `alembic upgrade head`)

IDs are UUIDv5 from the record code, so every environment gets the same IDs. Re-running inserts
missing records and refreshes descriptive fields, but never touches `status`, so an operator's
demo toggles survive restarts. No incidents or detections are ever seeded.
"""

import json
import uuid
from pathlib import Path

from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import make_engine, make_sessionmaker
from app.models import Camera, FireStation

SEED_FILE = Path(__file__).resolve().parents[1] / "seed" / "karachi_demo.json"
NAMESPACE = uuid.UUID("6f1d3c52-6a8e-4c43-9a43-2d8f3f5b8c11")  # fixed: PehRadar seed namespace


def seed_id(code: str) -> str:
    return str(uuid.uuid5(NAMESPACE, code))


def seed(session: Session, data: dict | None = None) -> dict[str, int]:
    data = data or json.loads(SEED_FILE.read_text(encoding="utf-8"))
    created = {"cameras": 0, "fire_stations": 0}
    for row in data["cameras"]:
        camera = session.get(Camera, seed_id(row["code"]))
        if camera is None:
            camera = Camera(id=seed_id(row["code"]), status="active")
            session.add(camera)
            created["cameras"] += 1
        camera.code, camera.name = row["code"], row["name"]
        camera.latitude, camera.longitude = row["latitude"], row["longitude"]
        camera.location_label = row["location_label"]
        camera.department, camera.is_simulated = "fire", True
    for row in data["fire_stations"]:
        station = session.get(FireStation, seed_id(row["code"]))
        if station is None:
            station = FireStation(id=seed_id(row["code"]), status="available")
            session.add(station)
            created["fire_stations"] += 1
        station.code, station.name = row["code"], row["name"]
        station.latitude, station.longitude = row["latitude"], row["longitude"]
        station.location_label = row["location_label"]
        station.is_simulated = False  # real OSM-mapped location; availability is still a demo flag
        station.data_source, station.source_ref = "osm", row["source_ref"]
        station.licence, station.verification_status = "ODbL-1.0", "unverified"
    session.commit()
    return created


def main() -> None:
    settings = get_settings()
    engine = make_engine(settings.sqlalchemy_url)
    with make_sessionmaker(engine)() as session:
        created = seed(session)
    engine.dispose()
    print(
        f"Seed complete: created {created['cameras']} cameras, {created['fire_stations']} stations"
    )


if __name__ == "__main__":
    main()
