"""M6C: multi-agency response (fire, ambulance, police facilities, selection, routes, payload)."""

import json

import sqlalchemy as sa
from sqlalchemy import create_engine, func, select

from alembic import command
from app.db import utc_now
from app.domain.incident_rules import haversine_km
from app.models import FireStation
from app.routing import Route, RoutingError
from app.seed import FACILITY_FILE, seed, seed_id

from .conftest import make_db_app
from .test_detect import clip  # noqa: F401
from .test_m5 import scenario_client
from .test_operations import AUTH, CAM_SADDAR, FIRE, alembic_config, confirm, pending_detection

API = "/api/v1"
FACILITIES = json.loads(FACILITY_FILE.read_text(encoding="utf-8"))
SADDAR = (24.8605, 67.0303)  # KHI-CAM-01, the camera every upload test uses


class Routes:
    """Fake road router: fails for the origins listed in `fail_from`, routes everything else."""

    name = "fake-osrm"

    def __init__(self, fail_from=(), crash=False):
        self.fail_from, self.crash, self.calls = set(fail_from), crash, []

    def route(self, origin, destination):
        self.calls.append(origin)
        if origin in self.fail_from:
            if self.crash:
                raise ValueError("unexpected provider bug")
            raise RoutingError("OSRM request failed: TimeoutError")
        return Route("fake-osrm", "driving", 5.0, 9.0, [[origin[1], origin[0]], [67.0, 24.9]])


def nearest(category, client, exclude=()):
    items = client.get(f"{API}/response-facilities", params={"category": category}).json()["items"]
    candidates = [f for f in items if f["status"] == "available" and f["id"] not in exclude]
    return min(candidates, key=lambda f: haversine_km(*SADDAR, f["latitude"], f["longitude"]))


# --- data ---


def test_facility_dataset_is_karachi_osm_unique_and_typed():
    police, ambulance = FACILITIES["police_stations"], FACILITIES["ambulance_stations"]
    assert len(police) == 76 and len(ambulance) == 19
    for rows, facility_type, prefix in (
        (police, "police_station", "KHI-PS-"),
        (ambulance, "ambulance_station", "KHI-AMB-"),
    ):
        assert len({r["code"] for r in rows}) == len(rows)
        assert len({r["source_ref"] for r in rows}) == len(rows)
        for r in rows:
            assert r["code"].startswith(prefix) and r["facility_type"] == facility_type
            assert r["source_ref"].startswith(("osm:node/", "osm:way/", "osm:relation/"))
            assert 24.70 <= r["latitude"] <= 25.30 and 66.60 <= r["longitude"] <= 67.60
            assert r["name"]
    assert all("Police Station" in r["name"] for r in police)
    assert not any("traffic" in r["name"].lower() for r in police)


def test_police_and_ambulance_seed_is_idempotent_and_keeps_demo_flags(tmp_path):
    app = make_db_app(tmp_path, seeded=False)
    with app.state.sessionmaker() as session:
        created = seed(session)
        assert (created["police_stations"], created["ambulance_stations"]) == (76, 19)
        police_id, ambulance_id = seed_id("KHI-PS-001"), seed_id("KHI-AMB-001")
        session.get(FireStation, police_id).status = "unavailable"
        session.get(FireStation, ambulance_id).status = "unavailable"
        session.commit()

        assert set(seed(session).values()) == {0}  # nothing new the second time
        counts = dict(
            session.execute(
                select(FireStation.category, func.count()).group_by(FireStation.category)
            ).all()
        )
        assert counts == {"fire": 11, "police": 76, "ambulance": 19}
        assert session.get(FireStation, police_id).status == "unavailable"
        assert session.get(FireStation, ambulance_id).status == "unavailable"
        police = session.get(FireStation, police_id)
        assert police.data_source == "osm" and police.verification_status == "unverified"
        assert police.availability_is_demo is True and police.licence == "ODbL-1.0"


def test_fire_station_list_stays_fire_only_and_facility_list_has_all(tmp_path):
    client = scenario_client(tmp_path)
    fire = client.get(f"{API}/fire-stations").json()["items"]
    assert len(fire) == 11 and {f["category"] for f in fire} == {"fire"}
    every = client.get(f"{API}/response-facilities").json()["items"]
    assert {c: sum(f["category"] == c for f in every) for c in ("fire", "police", "ambulance")} == {
        "fire": 11,
        "police": 76,
        "ambulance": 19,
    }
    police = client.get(f"{API}/response-facilities?category=police").json()["items"]
    assert len(police) == 76 and police[0]["facility_type"] == "police_station"
    assert client.get(f"{API}/response-facilities?category=army").status_code == 422


# --- selection ---


def test_confirmation_selects_the_nearest_fire_ambulance_and_police(tmp_path, clip):  # noqa: F811
    client = scenario_client(tmp_path, routes=Routes())
    incident = confirm(client, pending_detection(client, clip)).json()

    units = incident["response_units"]
    assert set(units) == {"fire", "ambulance", "police"}
    for unit in ("fire", "ambulance", "police"):
        expected = nearest(unit, client)
        assert units[unit]["unit"] == unit
        assert units[unit]["facility"]["id"] == expected["id"]
        assert units[unit]["facility"]["category"] == unit
        straight = haversine_km(*SADDAR, expected["latitude"], expected["longitude"])
        assert abs(units[unit]["distance_km"] - round(straight, 2)) < 0.01
        assert units[unit]["method"] == "straight_line_haversine"
        assert "Nearest" in units[unit]["reason"]
        assert units[unit]["route"]["status"] == "ok"
    # Fire-only clients still read the same fields.
    assert incident["station_selection"]["station"]["id"] == units["fire"]["facility"]["id"]
    assert incident["route"]["distance_km"] == units["fire"]["route"]["distance_km"]
    assert incident["status"] == "station_selected"


def test_unavailable_facilities_are_ignored(tmp_path, clip):  # noqa: F811
    client = scenario_client(tmp_path)
    first_police, first_ambulance = nearest("police", client), nearest("ambulance", client)
    for facility in (first_police, first_ambulance):
        r = client.post(
            f"{API}/fire-stations/{facility['id']}/status",
            json={"status": "unavailable"},
            headers=AUTH,
        )
        assert r.status_code == 200 and r.json()["category"] in ("police", "ambulance")

    units = confirm(client, pending_detection(client, clip)).json()["response_units"]
    assert (
        units["police"]["facility"]["id"] == nearest("police", client)["id"] != first_police["id"]
    )
    assert units["ambulance"]["facility"]["id"] != first_ambulance["id"]


def test_no_available_police_leaves_the_other_units(tmp_path, clip):  # noqa: F811
    client = scenario_client(tmp_path)
    with client.app.state.sessionmaker() as session:
        for f in session.scalars(select(FireStation).where(FireStation.category == "police")):
            f.status = "unavailable"
        session.commit()
    incident = confirm(client, pending_detection(client, clip)).json()
    units = incident["response_units"]
    assert units["police"] is None and units["fire"] and units["ambulance"]
    missing = [t for t in incident["timeline"] if t["event_type"] == "no_resource_available"]
    assert [t["details"]["unit"] for t in missing] == ["police"]


# --- routing ---


def test_one_route_failure_keeps_the_other_routes(tmp_path, clip):  # noqa: F811
    for sub in ("probe", "False", "True"):
        (tmp_path / sub).mkdir()
    probe = scenario_client(tmp_path / "probe")
    ambulance = nearest("ambulance", probe)
    origin = (ambulance["latitude"], ambulance["longitude"])
    for crash in (False, True):
        routes = Routes(fail_from=[origin], crash=crash)
        client = scenario_client(tmp_path / str(crash), routes=routes)
        incident = confirm(client, pending_detection(client, clip)).json()
        units = incident["response_units"]
        assert len(routes.calls) == 3
        assert units["fire"]["route"]["status"] == "ok"
        assert units["police"]["route"]["status"] == "ok"
        fallback = units["ambulance"]["route"]
        assert fallback["status"] == "unavailable" and fallback["fallback"] == "straight_line"
        assert fallback["straight_line_km"] == units["ambulance"]["distance_km"]
        assert units["fire"]["route"]["geometry"]["type"] == "LineString"


def test_routes_and_selections_are_in_the_timeline_once(tmp_path, clip):  # noqa: F811
    client = scenario_client(tmp_path, routes=Routes())
    incident = confirm(client, pending_detection(client, clip)).json()
    events = [(t["event_type"], t["details"].get("unit")) for t in incident["timeline"]]
    assert events == [
        ("detection_created", None),
        ("operator_confirmed", None),
        ("station_selected", None),
        ("resource_selected", "ambulance"),
        ("resource_selected", "police"),
        ("route_generated", "fire"),
        ("route_generated", "ambulance"),
        ("route_generated", "police"),
    ]
    messages = [t["message"] for t in incident["timeline"]]
    assert messages[3].startswith("Ambulance resource:") and "not a dispatch" in messages[3]
    assert messages[6].startswith("Ambulance route from") and messages[7].startswith("Police route")
    # Reading the incident again adds nothing (no duplicate events).
    again = client.get(f"{API}/incidents/{incident['id']}").json()
    assert len(again["timeline"]) == len(incident["timeline"])


def test_incident_list_carries_units_without_route_geometry(tmp_path, clip):  # noqa: F811
    client = scenario_client(tmp_path, routes=Routes())
    confirm(client, pending_detection(client, clip))
    listed = client.get(f"{API}/incidents").json()["items"][0]["response_units"]
    for unit in ("fire", "ambulance", "police"):
        assert listed[unit]["facility"]["category"] == unit
        assert listed[unit]["route"]["distance_km"] == 5.0
        assert "geometry" not in listed[unit]["route"]


def test_merged_detection_keeps_the_original_response_units(tmp_path, clip):  # noqa: F811
    routes = Routes()
    client = scenario_client(tmp_path, routes=routes, scores=FIRE * 2)
    first = confirm(client, pending_detection(client, clip)).json()
    assert len(routes.calls) == 3

    merged = confirm(client, pending_detection(client, clip)).json()

    # Same incident, same three units, and no new selection or routing request.
    assert merged["id"] == first["id"]
    assert merged["response_units"] == first["response_units"]
    assert len(routes.calls) == 3
    assert merged["timeline"][-1]["event_type"] == "detection_merged"


# --- reset ---


def test_resets_restore_demo_availability_and_keep_seeded_facilities(tmp_path, clip):  # noqa: F811
    client = scenario_client(tmp_path)
    police = nearest("police", client)
    client.post(
        f"{API}/fire-stations/{police['id']}/status", json={"status": "unavailable"}, headers=AUTH
    )
    client.post(
        f"{API}/cameras/status",
        json={"status": "offline", "camera_ids": [CAM_SADDAR]},
        headers=AUTH,
    )

    demo = client.post(f"{API}/scenarios/reset", json={"scope": "demo"}, headers=AUTH).json()
    assert demo["stations_restored"] == 1 and demo["cameras_restored"] == 1
    assert nearest("police", client)["id"] == police["id"]

    client.post(
        f"{API}/fire-stations/{police['id']}/status", json={"status": "unavailable"}, headers=AUTH
    )
    full = client.post(f"{API}/scenarios/reset", json={"scope": "full"}, headers=AUTH).json()
    assert full["stations_restored"] == 1
    assert len(client.get(f"{API}/response-facilities").json()["items"]) == 106


# --- migration ---


def test_m6c_migration_keeps_fire_stations_and_incidents(tmp_path):
    url = f"sqlite:///{(tmp_path / 'm6c.db').as_posix()}"
    command.upgrade(alembic_config(url), "0003")
    engine = create_engine(url)
    now = utc_now().isoformat()
    with engine.begin() as conn:
        conn.execute(
            sa.text(
                "INSERT INTO fire_station (id, code, name, latitude, longitude, location_label, "
                "status, is_simulated, data_source, verification_status, facility_type, "
                "availability_is_demo, created_at, updated_at) VALUES (:id, 'KHI-FS-01', "
                "'Saddar Fire Station', 24.86, 67.03, 'Saddar', 'unavailable', 0, 'osm', "
                "'unverified', 'municipal_fire_station', 1, :now, :now)"
            ),
            {"id": seed_id("KHI-FS-01"), "now": now},
        )
    engine.dispose()

    command.upgrade(alembic_config(url), "head")
    engine = create_engine(url)
    with engine.connect() as conn:
        row = conn.execute(sa.text("SELECT category, status FROM fire_station")).one()
        assert tuple(row) == ("fire", "unavailable")
        columns = {c["name"] for c in sa.inspect(conn).get_columns("incident")}
        assert "response_units" in columns
        conn.execute(
            sa.text(
                "INSERT INTO fire_station (id, code, name, latitude, longitude, location_label, "
                "status, is_simulated, data_source, verification_status, facility_type, "
                "category, availability_is_demo, created_at, updated_at) VALUES ('p1', "
                "'KHI-PS-001', 'Clifton Police Station', 24.82, 67.03, 'Karachi', 'available', "
                "0, 'osm', 'unverified', 'police_station', 'police', 1, :now, :now)"
            ),
            {"now": now},
        )
        conn.commit()
    engine.dispose()

    command.downgrade(alembic_config(url), "0003")
    engine = create_engine(url)
    with engine.connect() as conn:
        codes = [r[0] for r in conn.execute(sa.text("SELECT code FROM fire_station"))]
        assert codes == ["KHI-FS-01"]  # the fire station survives; police rows go
    engine.dispose()
