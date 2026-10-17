import io
from contextlib import redirect_stdout
from pathlib import Path

import pytest
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import create_engine, func, inspect, select

from alembic import command
from app.db import Base
from app.domain.incident_rules import (
    can_transition,
    haversine_km,
    nearest_available_station,
    severity_for,
)
from app.models import DetectionEvent, FireStation, Incident
from app.routers.detect import ModelProvider
from app.seed import seed, seed_id

from .conftest import OPERATOR_KEY, make_db_app, make_settings
from .test_detect import ScriptedDetector, clip  # noqa: F401  (clip is a fixture)

API_DIR = Path(__file__).resolve().parents[1]
AUTH = {"X-Operator-Key": OPERATOR_KEY}
CAM_SADDAR = seed_id("KHI-CAM-01")
STATION_SADDAR = seed_id("KHI-FS-01")
STATION_ORANGI = seed_id("KHI-FS-04")
FIRE = [0.1, 0.5, 0.9, 0.6, 0.2, 0.0, 0.0, 0.0]  # confirmed fire, peak 0.9 at 1.0 s


# --- helpers ---


def make_client(tmp_path, scores=None, **overrides) -> TestClient:
    detector = ScriptedDetector(scores if scores is not None else FIRE)
    models = ModelProvider(lambda: detector)
    return TestClient(make_db_app(tmp_path, models=models, **overrides))


def detect(client, clip_path, camera_id=CAM_SADDAR, headers=AUTH):
    files = {"file": ("clip.mp4", clip_path.read_bytes(), "video/mp4")}
    data = {"camera_id": camera_id} if camera_id else {}
    return client.post("/api/v1/detect/fire", files=files, data=data, headers=headers)


def pending_detection(client, clip_path) -> str:
    body = detect(client, clip_path).json()
    assert body["review_status"] == "pending"
    return body["detection_event_id"]


def confirm(client, detection_id, **body):
    return client.post(f"/api/v1/detections/{detection_id}/confirm", json=body, headers=AUTH)


def count(client, model) -> int:
    with client.app.state.sessionmaker() as session:
        return session.scalar(select(func.count()).select_from(model))


def set_status(client, incident_id, status, headers=AUTH):
    return client.patch(
        f"/api/v1/incidents/{incident_id}/status",
        json={"status": status, "operator": "Operator A"},
        headers=headers,
    )


# --- migrations and configuration ---


def alembic_config(url: str) -> Config:
    cfg = Config(str(API_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(API_DIR / "alembic"))
    cfg.set_main_option("sqlalchemy.url", url)
    return cfg


def test_migration_creates_schema_matching_models(tmp_path):
    url = f"sqlite:///{(tmp_path / 'migrated.db').as_posix()}"
    command.upgrade(alembic_config(url), "head")

    engine = create_engine(url)
    tables = set(inspect(engine).get_table_names())
    assert {"camera", "fire_station", "detection_event", "incident"} <= tables
    assert "incident_timeline_event" in tables
    with engine.connect() as conn:
        diff = compare_metadata(MigrationContext.configure(conn), Base.metadata)
    assert diff == []  # models and migrations agree
    engine.dispose()

    command.downgrade(alembic_config(url), "base")
    engine = create_engine(url)
    assert set(inspect(engine).get_table_names()) == {"alembic_version"}
    engine.dispose()


def test_migration_compiles_for_postgresql():
    out = io.StringIO()
    with redirect_stdout(out):
        command.upgrade(alembic_config("postgresql+psycopg://u:p@localhost/db"), "head", sql=True)
    sql = out.getvalue()
    assert "CREATE TABLE incident (" in sql
    assert "TIMESTAMP WITH TIME ZONE" in sql
    assert "BYTEA" in sql


def test_production_requires_a_postgresql_database_url():
    with pytest.raises(ValidationError, match="DATABASE_URL is required"):
        make_settings(app_env="production", database_url=None)
    with pytest.raises(ValidationError, match="PostgreSQL"):
        make_settings(app_env="production", database_url="sqlite:///./x.db")


def test_neon_style_url_uses_psycopg_driver():
    settings = make_settings(
        app_env="production", database_url="postgresql://u:p@ep-x.neon.tech/db?sslmode=require"
    )
    assert settings.sqlalchemy_url == "postgresql+psycopg://u:p@ep-x.neon.tech/db?sslmode=require"


# --- seed ---


def test_seed_is_idempotent_and_keeps_status_toggles(tmp_path):
    app = make_db_app(tmp_path, seeded=False)
    with app.state.sessionmaker() as session:
        assert seed(session) == {"cameras": 179, "fire_stations": 11}
        session.get(FireStation, STATION_SADDAR).status = "unavailable"
        session.commit()
        assert seed(session) == {"cameras": 0, "fire_stations": 0}
        assert session.get(FireStation, STATION_SADDAR).status == "unavailable"
        assert session.scalar(select(func.count()).select_from(FireStation)) == 11


# --- cameras and stations ---


def test_cameras_endpoint_lists_simulated_karachi_cameras(tmp_path):
    client = make_client(tmp_path)

    items = client.get("/api/v1/cameras").json()["items"]

    assert len(items) == 179
    assert all(c["department"] == "fire" for c in items)
    # Everything except the OSM-mapped camera location is a simulated node.
    assert sum(not c["is_simulated"] for c in items) == 1
    assert all(24.7 <= c["latitude"] <= 25.3 and 66.6 <= c["longitude"] <= 67.6 for c in items)
    assert client.get("/api/v1/cameras?department=police").json()["items"] == []
    assert client.get(f"/api/v1/cameras/{CAM_SADDAR}").json()["code"] == "KHI-CAM-01"
    assert client.get("/api/v1/cameras/nope").status_code == 404


def test_stations_endpoint_marks_availability_as_demo_only(tmp_path):
    client = make_client(tmp_path)

    items = client.get("/api/v1/fire-stations").json()["items"]

    assert len(items) == 11
    assert all(s["verification_status"] == "unverified" for s in items)
    assert all(s["source_ref"].startswith("osm:") and s["licence"] == "ODbL-1.0" for s in items)
    assert all("not real-time" in s["status_note"] for s in items)
    assert client.get(f"/api/v1/fire-stations/{STATION_SADDAR}").json()["name"].startswith("Saddar")
    assert client.get("/api/v1/fire-stations/nope").status_code == 404


# --- detection → review ---


def test_detection_with_camera_creates_pending_event_but_no_incident(tmp_path, clip):  # noqa: F811
    client = make_client(tmp_path)

    body = detect(client, clip).json()

    assert body["status"] == "detected"
    assert body["review_status"] == "pending"
    assert body["camera"]["id"] == CAM_SADDAR
    assert (
        body["evidence"]["url"] == f"/api/v1/detections/{body['detection_event_id']}/evidence.jpg"
    )
    evidence = client.get(body["evidence"]["url"])
    assert evidence.status_code == 200 and evidence.content[:2] == b"\xff\xd8"
    assert count(client, DetectionEvent) == 1
    assert count(client, Incident) == 0


def test_not_detected_creates_no_detection_or_incident(tmp_path, clip):  # noqa: F811
    client = make_client(tmp_path, scores=[0.1] * 8)

    body = detect(client, clip).json()

    assert body["status"] == "not_detected"
    assert body["detection_event_id"] is None
    assert body["camera"]["code"] == "KHI-CAM-01"
    assert count(client, DetectionEvent) == 0
    assert count(client, Incident) == 0


def test_detection_without_camera_keeps_m2_behaviour(tmp_path, clip):  # noqa: F811
    client = make_client(tmp_path)

    body = detect(client, clip, camera_id=None, headers={}).json()

    assert body["status"] == "detected"
    assert body["detection_event_id"] is None
    assert count(client, DetectionEvent) == 0


def test_detection_rejects_unknown_camera_and_missing_operator_key(tmp_path, clip):  # noqa: F811
    client = make_client(tmp_path)

    assert detect(client, clip, camera_id="no-such-camera").status_code == 404
    assert detect(client, clip, headers={}).status_code == 401
    assert count(client, DetectionEvent) == 0


def test_confirmation_creates_incident_with_nearest_station_and_timeline(tmp_path, clip):  # noqa: F811
    client = make_client(tmp_path)
    detection_id = pending_detection(client, clip)

    response = confirm(client, detection_id, operator="Operator A", note="flames visible")

    assert response.status_code == 200
    incident = response.json()
    assert incident["status"] == "station_selected"
    assert incident["severity"] == "high"  # fire at 0.9
    assert incident["event_type"] == "fire"
    assert (incident["latitude"], incident["longitude"]) == (24.8605, 67.0303)
    selection = incident["station_selection"]
    assert selection["station"]["id"] == STATION_SADDAR
    assert selection["method"] == "straight_line_haversine"
    assert selection["is_driving_eta"] is False
    assert 0 < selection["distance_km"] < 1
    assert incident["detection"]["review_status"] == "confirmed"
    assert incident["evidence_url"].endswith("/evidence.jpg")
    assert [(t["seq"], t["event_type"]) for t in incident["timeline"]] == [
        (1, "detection_created"),
        (2, "operator_confirmed"),
        (3, "station_selected"),
        (4, "route_unavailable"),  # tests run with routing disabled: straight-line fallback
    ]
    assert incident["timeline"][1]["actor_label"] == "Operator A"


def test_repeated_review_is_rejected_and_creates_no_second_incident(tmp_path, clip):  # noqa: F811
    client = make_client(tmp_path)
    detection_id = pending_detection(client, clip)
    incident_id = confirm(client, detection_id).json()["id"]

    again = confirm(client, detection_id)
    reject = client.post(f"/api/v1/detections/{detection_id}/reject", headers=AUTH)

    assert again.status_code == 409
    assert again.json()["error"]["code"] == "DETECTION_ALREADY_REVIEWED"
    assert again.json()["error"]["details"]["incident_id"] == incident_id
    assert reject.status_code == 409
    assert count(client, Incident) == 1


def test_rejection_creates_no_incident(tmp_path, clip):  # noqa: F811
    client = make_client(tmp_path)
    detection_id = pending_detection(client, clip)

    response = client.post(
        f"/api/v1/detections/{detection_id}/reject",
        json={"operator": "Operator A", "note": "street lights"},
        headers=AUTH,
    )

    assert response.status_code == 200
    assert response.json()["review_status"] == "rejected"
    assert response.json()["review_note"] == "street lights"
    assert count(client, Incident) == 0
    assert confirm(client, detection_id).status_code == 409


def test_review_requires_operator_key(tmp_path, clip):  # noqa: F811
    client = make_client(tmp_path)
    detection_id = pending_detection(client, clip)

    response = client.post(f"/api/v1/detections/{detection_id}/confirm", headers={})

    assert response.status_code == 401
    assert count(client, Incident) == 0


def test_production_without_operator_key_refuses_writes(tmp_path):
    settings = make_settings(app_env="production")
    from app.main import create_app

    client = TestClient(create_app(settings))

    response = client.post("/api/v1/detections/x/confirm")

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "OPERATOR_KEY_NOT_CONFIGURED"


# --- station selection ---


def test_unavailable_nearest_station_is_skipped(tmp_path, clip):  # noqa: F811
    client = make_client(tmp_path)
    with client.app.state.sessionmaker() as session:
        session.get(FireStation, STATION_SADDAR).status = "unavailable"
        session.commit()
    detection_id = pending_detection(client, clip)

    selection = confirm(client, detection_id).json()["station_selection"]

    assert selection["station"]["id"] != STATION_SADDAR
    assert selection["distance_km"] > 1


def test_no_available_station_leaves_incident_confirmed(tmp_path, clip):  # noqa: F811
    client = make_client(tmp_path)
    with client.app.state.sessionmaker() as session:
        for station in session.scalars(select(FireStation)):
            station.status = "unavailable"
        session.commit()
    detection_id = pending_detection(client, clip)

    incident = confirm(client, detection_id).json()

    assert incident["status"] == "confirmed"
    assert incident["station_selection"] is None
    assert incident["timeline"][-1]["event_type"] == "no_station_available"


class _Station:
    def __init__(self, id, lat, lng, status="available"):
        self.id, self.latitude, self.longitude, self.status = id, lat, lng, status


def test_nearest_available_station_uses_haversine_and_ignores_unavailable():
    stations = [
        _Station("near-but-unavailable", 24.861, 67.031, "unavailable"),
        _Station("far", 24.95, 67.20),
        _Station("mid", 24.90, 67.05),
    ]

    choice = nearest_available_station(24.8605, 67.0303, stations)

    assert choice.station.id == "mid"
    assert choice.distance_km == pytest.approx(haversine_km(24.8605, 67.0303, 24.90, 67.05))
    assert nearest_available_station(24.86, 67.03, [stations[0]]) is None


def test_haversine_known_distance():
    # One degree of latitude is about 111.2 km.
    assert haversine_km(24.0, 67.0, 25.0, 67.0) == pytest.approx(111.19, abs=0.05)


@pytest.mark.parametrize(
    ("event_type", "confidence", "expected"),
    [
        ("fire_smoke", 0.5, "high"),
        ("fire", 0.70, "high"),
        ("fire", 0.69, "medium"),
        ("smoke", 0.80, "medium"),
        ("smoke", 0.50, "low"),
    ],
)
def test_severity_rule(event_type, confidence, expected):
    assert severity_for(event_type, confidence) == expected


# --- incident status ---


def test_valid_status_transitions_append_timeline_in_order(tmp_path, clip):  # noqa: F811
    client = make_client(tmp_path)
    incident_id = confirm(client, pending_detection(client, clip)).json()["id"]

    for target in ("notified", "acknowledged", "resolved"):
        response = set_status(client, incident_id, target)
        assert response.status_code == 200, response.text
        assert response.json()["status"] == target

    incident = client.get(f"/api/v1/incidents/{incident_id}").json()
    assert incident["resolved_at"] is not None
    events = [(t["seq"], t["event_type"]) for t in incident["timeline"]]
    assert events == [
        (1, "detection_created"),
        (2, "operator_confirmed"),
        (3, "station_selected"),
        (4, "route_unavailable"),
        (5, "status_changed"),
        (6, "status_changed"),
        (7, "resolved"),
    ]
    assert "PehRadar sent no notification" in incident["timeline"][4]["message"]


@pytest.mark.parametrize(
    ("path", "target"),
    [
        ([], "acknowledged"),  # station_selected cannot skip to acknowledged
        (["resolved"], "notified"),  # resolved is terminal
        (["rejected"], "resolved"),  # rejected is terminal
    ],
)
def test_invalid_status_transition_is_409(tmp_path, clip, path, target):  # noqa: F811
    client = make_client(tmp_path)
    incident_id = confirm(client, pending_detection(client, clip)).json()["id"]
    for step in path:
        assert set_status(client, incident_id, step).status_code == 200

    response = set_status(client, incident_id, target)

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "INVALID_STATE_TRANSITION"


def test_system_only_statuses_cannot_be_patched(tmp_path, clip):  # noqa: F811
    client = make_client(tmp_path)
    incident_id = confirm(client, pending_detection(client, clip)).json()["id"]

    response = set_status(client, incident_id, "station_selected")

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_status_change_requires_operator_key(tmp_path, clip):  # noqa: F811
    client = make_client(tmp_path)
    incident_id = confirm(client, pending_detection(client, clip)).json()["id"]

    assert set_status(client, incident_id, "notified", headers={}).status_code == 401


def test_state_machine_table():
    assert can_transition("confirmed", "station_selected")
    assert can_transition("acknowledged", "resolved")
    assert not can_transition("acknowledged", "rejected")
    assert not can_transition("resolved", "confirmed")


def test_incident_list_filters(tmp_path, clip):  # noqa: F811
    client = make_client(tmp_path, scores=FIRE * 2)  # two clips of 8 sampled frames
    first = confirm(client, pending_detection(client, clip)).json()["id"]
    second = confirm(client, pending_detection(client, clip)).json()["id"]
    set_status(client, second, "notified")

    all_items = client.get("/api/v1/incidents").json()["items"]
    notified = client.get("/api/v1/incidents?status=notified").json()["items"]
    smoke = client.get("/api/v1/incidents?event_type=smoke").json()["items"]

    assert {i["id"] for i in all_items} == {first, second}
    assert [i["id"] for i in notified] == [second]
    assert smoke == []
    assert "timeline" not in all_items[0]  # list is a summary
