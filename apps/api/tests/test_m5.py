"""M5: monitoring network and provenance, demo media, scenario engine, suggested road route."""

import json
import shutil
from datetime import timedelta
from pathlib import Path

import pytest
import sqlalchemy as sa
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func, select

from alembic import command
from app.db import utc_now
from app.domain.incident_rules import haversine_km
from app.main import create_app
from app.models import Camera, DetectionEvent, FireStation, Incident, ScenarioRun
from app.routers.detect import ModelProvider
from app.routing import OsrmRouteProvider, Route, RoutingError, parse_osrm
from app.seed import SEED_FILE, seed, seed_id
from app.services.scenarios import ASSET_DIR, load_scenarios

from .conftest import OPERATOR_KEY, make_db_app, make_settings
from .test_detect import BrokenDetector, ScriptedDetector, clip  # noqa: F401
from .test_fire_model import REAL, REAL_PATH, needs_model
from .test_operations import AUTH, FIRE, alembic_config, confirm, detect, pending_detection

API = "/api/v1"
NETWORK = json.loads(SEED_FILE.read_text(encoding="utf-8"))
KORANGI = seed_id("KHI-CAM-03")
FIRE_SCENARIO = "korangi-industrial-fire"
NEGATIVE_SCENARIO = "lyari-sunset-glare"


class FakeRoutes:
    name = "fake-osrm"

    def __init__(self, fail: bool = False):
        self.fail, self.calls = fail, []

    def route(self, origin, destination):
        self.calls.append((origin, destination))
        if self.fail:
            raise RoutingError("OSRM request failed: TimeoutError")
        return Route(
            "fake-osrm",
            "driving",
            9.4,
            17.2,
            [[origin[1], origin[0]], [destination[1], destination[0]]],
        )


def scenario_client(tmp_path, scores=FIRE, detector=None, routes=None, **overrides) -> TestClient:
    detector = detector or ScriptedDetector(scores)
    app_kwargs = {"route_provider": routes} if routes is not None else None
    app = make_db_app(
        tmp_path, models=ModelProvider(lambda: detector), app_kwargs=app_kwargs, **overrides
    )
    engine = app.state.scenario_engine
    if engine is not None and (tmp_path / "clip.mp4").is_file():
        # Scenario clips are replaced by the small synthetic test clip: the scripted detector
        # decides the outcome, so only the frame count matters here.
        assets = tmp_path / "assets"
        assets.mkdir(exist_ok=True)
        for scenario in engine.scenarios.values():
            shutil.copy(tmp_path / "clip.mp4", assets / scenario.video_asset)
        engine.asset_dir = assets
    return TestClient(app)


def advance(client, seconds: float) -> int:
    """Moves the engine clock forward and runs one worker tick."""
    engine = client.app.state.scenario_engine
    start = utc_now() + timedelta(seconds=seconds)
    engine.clock = lambda: start
    return engine.tick()


def start(client, scenario_id=FIRE_SCENARIO, headers=AUTH):
    return client.post(f"{API}/scenarios/{scenario_id}/start", json={}, headers=headers)


def count(client, model, *where) -> int:
    with client.app.state.sessionmaker() as session:
        return session.scalar(select(func.count()).select_from(model).where(*where))


# --- migration ---


def test_m5_migration_keeps_existing_m3_rows_and_seed_fills_provenance(tmp_path):
    url = f"sqlite:///{(tmp_path / 'm3.db').as_posix()}"
    command.upgrade(alembic_config(url), "0001")
    engine = create_engine(url)
    now = utc_now().isoformat()
    with engine.begin() as conn:
        conn.execute(
            sa.text(
                "INSERT INTO camera VALUES (:id, 'KHI-CAM-03', 'Korangi', 24.833, 67.124, "
                "'Korangi Industrial Area', 'fire', 'active', 1, :now, :now)"
            ),
            {"id": KORANGI, "now": now},
        )
        conn.execute(
            sa.text(
                "INSERT INTO fire_station VALUES (:id, 'KHI-FS-03', 'Landhi Fire Station', "
                "24.84216, 67.19892, 'Landhi', 'unavailable', 0, 'osm', 'osm:node/5133191784', "
                "'ODbL-1.0', 'unverified', :now, :now)"
            ),
            {"id": seed_id("KHI-FS-03"), "now": now},
        )
    engine.dispose()

    command.upgrade(alembic_config(url), "head")

    engine = create_engine(url)
    with engine.connect() as conn:
        camera = conn.execute(sa.text("SELECT * FROM camera")).mappings().one()
        station = conn.execute(sa.text("SELECT * FROM fire_station")).mappings().one()
    assert camera["id"] == KORANGI and camera["name"] == "Korangi"
    assert camera["source_type"] == "simulated_coverage" and camera["stream_type"] == "none"
    assert station["status"] == "unavailable"
    assert station["facility_type"] == "fire_station_unclassified"
    assert station["availability_is_demo"] in (1, True)
    engine.dispose()

    app = create_app(make_settings(app_env="test", database_url=url))
    with app.state.sessionmaker() as session:
        seed(session)
        camera = session.get(Camera, KORANGI)
        assert camera.source_type == "demo_stream"
        assert camera.stream_url.startswith("/api/v1/media/pk_")  # M6B Pakistan demo footage
        assert camera.feed_meta["country"] == "Pakistan"
        # The operator's demo toggle survives the seed.
        assert session.get(FireStation, seed_id("KHI-FS-03")).status == "unavailable"
    app.state.engine.dispose()

    command.downgrade(alembic_config(url), "0001")


# --- network data and provenance ---


def test_network_file_is_karachi_only_unique_and_spaced():
    cameras = NETWORK["cameras"]
    assert 150 <= len(cameras) <= 200
    assert len({c["code"] for c in cameras}) == len(cameras)
    for c in cameras:
        assert 24.7 <= c["latitude"] <= 25.3 and 66.6 <= c["longitude"] <= 67.6
    generated = [c for c in cameras if c["code"].startswith("KHI-") and "-CAM-" not in c["code"]]
    for i, a in enumerate(generated):
        for b in generated[i + 1 :]:
            assert haversine_km(a["latitude"], a["longitude"], b["latitude"], b["longitude"]) >= 0.4


def test_every_camera_declares_provenance(tmp_path):
    client = scenario_client(tmp_path)
    items = client.get(f"{API}/cameras").json()["items"]

    by_type = {}
    for c in items:
        by_type.setdefault(c["source_type"], []).append(c)
        assert c["district"] and c["source_reference"]
        assert c["stream_type"] in ("hls", "mjpeg", "mp4_loop", "none")
    assert set(by_type) == {"simulated_coverage", "demo_stream", "verified_mapped"}
    assert "public_live" not in by_type  # no lawful public Karachi stream was integrated
    for c in by_type["simulated_coverage"]:
        assert c["is_simulated"] and c["stream_type"] == "none" and c["stream_url"] is None
        assert c["monitoring_status"] == "simulated"
    for c in by_type["demo_stream"]:
        assert c["is_simulated"] and c["stream_type"] == "mp4_loop"
        assert c["stream_url"].startswith("/api/v1/media/")
        assert c["monitoring_status"] == "monitoring"
    (mapped,) = by_type["verified_mapped"]
    assert not mapped["is_simulated"] and mapped["stream_url"] is None
    assert mapped["source_reference"].startswith("osm:node/")
    assert mapped["monitoring_status"] == "not_connected"
    # M3 camera ids are unchanged, so existing detections keep their camera.
    # M6B: most simulated nodes loop Pakistan-based demo footage; the M5 scenario nodes still do.
    assert {"KHI-CAM-02", "KHI-CAM-03", "KHI-CAM-07"} <= {c["code"] for c in by_type["demo_stream"]}
    assert next(c for c in items if c["code"] == "KHI-CAM-03")["id"] == KORANGI


def test_stations_are_real_osm_facilities_with_demo_availability(tmp_path):
    client = scenario_client(tmp_path)
    items = client.get(f"{API}/fire-stations").json()["items"]

    assert len(items) == 11
    assert len({s["source_ref"] for s in items}) == 11
    for s in items:
        assert s["is_simulated"] is False and s["availability_is_demo"] is True
        assert s["source_ref"].startswith("osm:") and s["verification_status"] == "unverified"
    types = {s["code"]: s["facility_type"] for s in items}
    assert types["KHI-FS-10"] == "airport_fire_station"
    assert types["KHI-FS-11"] == "institutional_fire_response"
    assert next(s for s in items if s["code"] == "KHI-FS-10")["operator"].startswith(
        "Civil Aviation"
    )


def test_seed_never_deletes_and_is_idempotent_for_m5_fields(tmp_path):
    app = make_db_app(tmp_path, seeded=False)
    with app.state.sessionmaker() as session:
        session.add(
            Camera(
                id="legacy-extra",
                code="KHI-OLD-01",
                name="Unlisted",
                latitude=24.9,
                longitude=67.0,
                location_label="x",
            )
        )
        session.commit()
        seed(session)
        assert set(seed(session).values()) == {0}
        assert session.get(Camera, "legacy-extra") is not None
        assert session.scalar(select(func.count()).select_from(Camera)) == 180


# --- demo media ---


def test_media_serves_only_listed_demo_assets_with_range_support(tmp_path):
    client = scenario_client(tmp_path)

    full = client.get(f"{API}/media/fire_jamestown_night.mp4")
    assert full.status_code == 200 and full.headers["content-type"] == "video/mp4"
    part = client.get(f"{API}/media/fire_jamestown_night.mp4", headers={"Range": "bytes=0-99"})
    assert part.status_code == 206 and len(part.content) == 100
    for bad in ("SOURCES.md", "..%2Fseed%2Fscenarios.json", "missing.mp4"):
        assert client.get(f"{API}/media/{bad}").status_code == 404


def test_configured_scenarios_reference_existing_assets_and_cameras():
    scenarios = load_scenarios()
    codes = {c["code"]: c for c in NETWORK["cameras"]}
    assert len(scenarios) >= 3
    assert {s.expected_behavior for s in scenarios} >= {
        "fire_detected",
        "smoke_detected",
        "no_detection",
    }
    for s in scenarios:
        assert (ASSET_DIR / s.video_asset).is_file()
        assert codes[s.camera_code]["source_type"] == "demo_stream"


# --- scenario engine ---


def test_scenarios_list_and_start_requires_operator_key(tmp_path, clip):  # noqa: F811
    client = scenario_client(tmp_path)

    body = client.get(f"{API}/scenarios").json()
    assert body["enabled"] is True
    assert {s["id"] for s in body["items"]} >= {FIRE_SCENARIO, NEGATIVE_SCENARIO}
    assert all(s["latest_run"] is None for s in body["items"])
    assert start(client, headers={}).status_code == 401
    assert client.post(f"{API}/scenarios/reset", headers={}).status_code == 401
    assert start(client, "nope").status_code == 404


def test_scenario_schedules_then_runs_detector_and_creates_pending_detection(tmp_path, clip):  # noqa: F811
    client = scenario_client(tmp_path)

    run = start(client).json()
    assert run["status"] == "scheduled" and run["detection_event_id"] is None
    assert start(client).status_code == 409  # one active run per scenario
    assert advance(client, 1) == 0  # not due yet: nothing analysed, nothing stored
    assert count(client, DetectionEvent) == 0

    assert advance(client, 46) == 1

    latest = client.get(f"{API}/scenarios").json()["items"]
    run = next(s for s in latest if s["id"] == FIRE_SCENARIO)["latest_run"]
    assert run["status"] == "detected"
    assert run["result"]["confidence"] == 0.9  # the detector's own peak, not a scripted number
    assert run["result"]["model"] == "scripted-test-detector"
    detection = client.get(f"{API}/detections/{run['detection_event_id']}").json()
    assert detection["review_status"] == "pending"
    assert detection["camera_id"] == KORANGI
    assert detection["confidence"] == 0.9
    assert detection["evidence_url"].endswith("/evidence.jpg")
    assert detection["details"]["source"]["kind"] == "scenario"
    assert detection["details"]["source"]["scenario_id"] == FIRE_SCENARIO
    # Never auto-confirmed: no incident exists until an operator confirms.
    assert count(client, Incident) == 0
    assert (
        client.get(f"{API}/detections?review_status=pending").json()["items"][0]["id"]
        == (detection["id"])
    )


def test_scenario_negative_result_stores_no_detection(tmp_path, clip):  # noqa: F811
    client = scenario_client(tmp_path, scores=[0.2] * 8)

    start(client, NEGATIVE_SCENARIO)
    advance(client, 60)

    latest = client.get(f"{API}/scenarios").json()["items"]
    run = next(s for s in latest if s["id"] == NEGATIVE_SCENARIO)["latest_run"]
    assert run["status"] == "not_detected" and run["detection_event_id"] is None
    assert run["result"]["classes"]["fire"]["confirmed"] is False
    assert count(client, DetectionEvent) == 0 and count(client, Incident) == 0


def test_scenario_detector_failure_marks_run_failed_without_data(tmp_path, clip):  # noqa: F811
    client = scenario_client(tmp_path, detector=BrokenDetector([]))

    start(client)
    advance(client, 60)

    with client.app.state.sessionmaker() as session:
        run = session.scalars(select(ScenarioRun)).one()
    assert run.status == "failed" and "RuntimeError" in run.error
    assert count(client, DetectionEvent) == 0


def test_operator_confirms_scenario_detection_like_any_other(tmp_path, clip):  # noqa: F811
    client = scenario_client(tmp_path)
    start(client)
    advance(client, 60)
    detection_id = client.get(f"{API}/detections?review_status=pending").json()["items"][0]["id"]

    incident = confirm(client, detection_id).json()

    assert incident["status"] == "station_selected"
    assert incident["camera"]["code"] == "KHI-CAM-03"
    assert incident["station_selection"]["station"]["name"] == "Manzoor Colony Fire Station"


def test_reset_cancels_runs_and_closes_only_scenario_data(tmp_path, clip):  # noqa: F811
    client = scenario_client(tmp_path)
    upload_detection = pending_detection(client, clip)  # operator upload: must survive the reset
    client.app.state.scenario_engine.detector = lambda: ScriptedDetector(FIRE)
    start(client)
    advance(client, 60)
    scenario_detection = client.get(f"{API}/detections?review_status=pending").json()["items"]
    scenario_detection = next(d for d in scenario_detection if d["id"] != upload_detection)
    incident_id = confirm(client, scenario_detection["id"]).json()["id"]
    start(client, NEGATIVE_SCENARIO)  # still scheduled at reset time

    result = client.post(f"{API}/scenarios/reset", headers=AUTH).json()

    assert result == {
        "scope": "demo",
        "runs_cancelled": 1,
        "detections_closed": 0,
        "incidents_closed": 1,
        "cameras_restored": 0,
        "stations_restored": 0,
    }
    incident = client.get(f"{API}/incidents/{incident_id}").json()
    assert incident["status"] == "resolved"
    assert incident["timeline"][-1]["actor_label"] == "Demo reset"
    assert client.get(f"{API}/detections/{upload_detection}").json()["review_status"] == "pending"
    assert advance(client, 600) == 0  # the cancelled run never fires
    assert count(client, Incident) == 1  # nothing deleted


def test_reset_rejects_pending_scenario_detections(tmp_path, clip):  # noqa: F811
    client = scenario_client(tmp_path)
    start(client)
    advance(client, 60)

    result = client.post(f"{API}/scenarios/reset", headers=AUTH).json()

    assert result["detections_closed"] == 1
    assert count(client, DetectionEvent, DetectionEvent.review_status == "rejected") == 1
    assert start(client).status_code == 200  # can run again after a reset


def test_run_cancelled_during_analysis_discards_result(tmp_path, clip):  # noqa: F811
    client = scenario_client(tmp_path)
    engine = client.app.state.scenario_engine
    original = engine.detector

    def reset_while_running():
        client.post(f"{API}/scenarios/reset", headers=AUTH)
        return original()

    engine.detector = reset_while_running
    start(client)
    advance(client, 60)

    assert count(client, DetectionEvent) == 0
    with client.app.state.sessionmaker() as session:
        assert session.scalars(select(ScenarioRun)).one().status == "cancelled"


def test_restart_marks_interrupted_runs_failed(tmp_path, clip):  # noqa: F811
    client = scenario_client(tmp_path)
    start(client)
    with client.app.state.sessionmaker() as session:
        session.scalars(select(ScenarioRun)).one().status = "running"
        session.commit()

    client.app.state.scenario_engine.recover()

    with client.app.state.sessionmaker() as session:
        assert session.scalars(select(ScenarioRun)).one().status == "failed"


def test_scenarios_are_off_in_production_unless_enabled(tmp_path):
    settings = make_settings(app_env="production", operator_api_key=OPERATOR_KEY)
    assert settings.scenarios_active is False
    assert make_settings(app_env="production", scenarios_enabled=True).scenarios_active is True
    assert make_settings(app_env="test", scenarios_enabled=False).scenarios_active is False
    client = scenario_client(tmp_path, scenarios_enabled=False)
    body = client.get(f"{API}/scenarios").json()
    assert body["enabled"] is False and body["items"] == []
    assert start(client).status_code == 404


def test_delay_override_applies_to_every_scenario(tmp_path, clip):  # noqa: F811
    client = scenario_client(tmp_path, scenario_delay_override_s=5)

    assert {s["trigger_after_seconds"] for s in client.get(f"{API}/scenarios").json()["items"]} == {
        5
    }
    start(client)
    assert advance(client, 6) == 1


@needs_model
def test_real_model_scenario_detects_fire_on_korangi(tmp_path):
    from app.detection.fire_model import FireSmokeModel

    model = FireSmokeModel(REAL_PATH, REAL.model_name, REAL.model_sha256)
    app = make_db_app(tmp_path, models=ModelProvider(lambda: model))
    client = TestClient(app)  # real demo asset, real model

    start(client)
    advance(client, 60)

    run = next(
        s for s in client.get(f"{API}/scenarios").json()["items"] if s["id"] == FIRE_SCENARIO
    )["latest_run"]
    assert run["status"] == "detected", run
    assert run["result"]["event_type"] in ("fire", "fire_smoke")
    assert run["result"]["confidence"] >= 0.45
    detection = client.get(f"{API}/detections/{run['detection_event_id']}").json()
    assert detection["model"] == REAL.model_name and detection["review_status"] == "pending"
    assert count(client, Incident) == 0


# --- suggested road route ---


def test_confirmation_stores_road_route_and_timeline_event(tmp_path, clip):  # noqa: F811
    routes = FakeRoutes()
    client = scenario_client(tmp_path, routes=routes)

    incident = confirm(client, pending_detection(client, clip)).json()

    route = incident["route"]
    assert route["status"] == "ok" and route["provider"] == "fake-osrm"
    assert (route["distance_km"], route["duration_min"]) == (9.4, 17.2)
    assert route["geometry"]["type"] == "LineString"
    assert route["is_estimate"] is True and "Not a dispatch" in route["note"]
    station = incident["station_selection"]["station"]
    # M6C: fire first, then the ambulance and police resources (one request each).
    assert len(routes.calls) == 3
    assert routes.calls[0] == (
        (station["latitude"], station["longitude"]),
        (incident["latitude"], incident["longitude"]),
    )
    assert incident["timeline"][-1]["event_type"] == "route_generated"
    assert "not a dispatch" in incident["timeline"][-1]["message"]
    listed = client.get(f"{API}/incidents").json()["items"][0]["route"]
    assert listed["distance_km"] == 9.4 and "geometry" not in listed


def test_routing_failure_falls_back_to_straight_line_and_keeps_incident(tmp_path, clip):  # noqa: F811
    client = scenario_client(tmp_path, routes=FakeRoutes(fail=True))

    response = confirm(client, pending_detection(client, clip))

    assert response.status_code == 200
    incident = response.json()
    assert incident["status"] == "station_selected"
    route = incident["route"]
    assert route["status"] == "unavailable" and route["fallback"] == "straight_line"
    assert route["straight_line_km"] == incident["station_selection"]["distance_km"]
    assert "TimeoutError" in route["reason"]
    assert incident["timeline"][-1]["event_type"] == "route_unavailable"


def test_no_route_requested_without_a_station(tmp_path, clip):  # noqa: F811
    routes = FakeRoutes()
    client = scenario_client(tmp_path, routes=routes)
    with client.app.state.sessionmaker() as session:
        for station in session.scalars(select(FireStation)):
            station.status = "unavailable"
        session.commit()

    incident = confirm(client, pending_detection(client, clip)).json()

    assert incident["route"] is None and routes.calls == []


OSRM_OK = {
    "code": "Ok",
    "routes": [
        {
            "distance": 9876.5,
            "duration": 1234.0,
            "geometry": {"type": "LineString", "coordinates": [[67.19, 24.84], [67.124, 24.833]]},
        }
    ],
}


def test_parse_osrm_response():
    route = parse_osrm(OSRM_OK)
    assert (route.distance_km, route.duration_min) == (9.88, 20.6)
    assert route.coordinates == [[67.19, 24.84], [67.124, 24.833]]
    for bad in (
        {"code": "NoRoute", "routes": []},
        {
            "code": "Ok",
            "routes": [
                {"distance": 0, "duration": 1, "geometry": OSRM_OK["routes"][0]["geometry"]}
            ],
        },
        {
            "code": "Ok",
            "routes": [{"distance": 5, "duration": 1, "geometry": {"coordinates": [[1, 2]]}}],
        },
    ):
        with pytest.raises(RoutingError):
            parse_osrm(bad)


def test_osrm_provider_builds_lng_lat_url_and_wraps_network_errors():
    provider = OsrmRouteProvider("http://127.0.0.1:9/", timeout_s=0.5)
    url = provider.url((24.84216, 67.19892), (24.833, 67.124))
    assert url == (
        "http://127.0.0.1:9/route/v1/driving/67.198920,24.842160;67.124000,24.833000"
        "?overview=full&geometries=geojson"
    )
    with pytest.raises(RoutingError, match="OSRM request failed"):
        provider.route((24.84216, 67.19892), (24.833, 67.124))


def test_upload_detection_is_tagged_as_upload(tmp_path, clip):  # noqa: F811
    client = scenario_client(tmp_path)
    body = detect(client, clip).json()
    detection = client.get(f"{API}/detections/{body['detection_event_id']}").json()
    assert detection["details"]["source"] == {"kind": "upload"}


def test_demo_assets_are_documented():
    sources = (Path(ASSET_DIR) / "SOURCES.md").read_text(encoding="utf-8")
    for asset in ASSET_DIR.glob("*.mp4"):
        assert asset.name in sources
