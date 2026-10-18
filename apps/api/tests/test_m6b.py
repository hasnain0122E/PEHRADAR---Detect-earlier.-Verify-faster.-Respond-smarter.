"""M6B: incident merge rule, scenario delays and alert dedupe, resets, network simulation,
Pakistan-based demo-feed provenance, and the extra scenarios."""

import json
from datetime import timedelta
from pathlib import Path

import pytest
import sqlalchemy as sa
from sqlalchemy import create_engine, select

from alembic import command
from app.db import utc_now
from app.models import Camera, DetectionEvent, Incident, ScenarioRun
from app.seed import SEED_FILE, seed_id
from app.services import operations
from app.services.scenarios import ASSET_DIR, load_scenarios

from .conftest import make_settings
from .test_detect import clip  # noqa: F401
from .test_m5 import FIRE_SCENARIO, KORANGI, advance, count, scenario_client, start
from .test_operations import (
    AUTH,
    CAM_SADDAR,
    FIRE,
    alembic_config,
    confirm,
    detect,
    make_client,
    pending_detection,
    set_status,
)

API = "/api/v1"
LIBRARY = json.loads((Path(SEED_FILE).parent / "feed_library.json").read_text(encoding="utf-8"))
NETWORK = json.loads(Path(SEED_FILE).read_text(encoding="utf-8"))


def shift_detection(client, detection_id: str, minutes: float) -> None:
    with client.app.state.sessionmaker() as session:
        d = session.get(DetectionEvent, detection_id)
        d.detected_at = d.detected_at - timedelta(minutes=minutes)
        session.commit()


# --- merge rule ---


def test_confirmed_detection_from_same_camera_joins_the_open_incident(tmp_path, clip):  # noqa: F811
    client = make_client(tmp_path, scores=FIRE * 6)
    first = confirm(client, pending_detection(client, clip)).json()
    second_id = pending_detection(client, clip)

    merged = confirm(client, second_id, operator="Operator B").json()

    assert merged["id"] == first["id"]  # no new incident
    assert merged["detection_event_id"] == first["detection_event_id"]
    assert count_incidents(client) == 1
    event = merged["timeline"][-1]
    assert event["event_type"] == "detection_merged"
    assert event["message"].startswith("Additional detection received from same camera")
    assert event["details"]["detection_event_id"] == second_id
    assert event["actor_label"] == "Operator B"
    assert client.get(f"{API}/detections/{second_id}").json()["review_status"] == "confirmed"
    # Confirming the merged detection again is refused like any reviewed detection.
    assert confirm(client, second_id).status_code == 409


def test_no_merge_outside_the_window_or_after_the_incident_closed(tmp_path, clip):  # noqa: F811
    client = make_client(tmp_path, scores=FIRE * 6, incident_merge_window_min=10)
    first = confirm(client, pending_detection(client, clip)).json()

    late = pending_detection(client, clip)
    shift_detection(client, first["detection_event_id"], 30)  # first detection 30 min ago
    assert confirm(client, late).json()["id"] != first["id"]
    assert count_incidents(client) == 2

    for incident in client.get(f"{API}/incidents").json()["items"]:
        set_status(client, incident["id"], "resolved")
    after_close = confirm(client, pending_detection(client, clip)).json()
    assert count_incidents(client) == 3 and after_close["status"] != "resolved"


def test_merge_requires_same_camera_and_can_be_disabled(tmp_path, clip):  # noqa: F811
    client = make_client(tmp_path, scores=FIRE * 6)
    confirm(client, pending_detection(client, clip))
    other_camera = detect(client, clip, camera_id=seed_id("KHI-CAM-05")).json()
    assert confirm(client, other_camera["detection_event_id"]).status_code == 200
    assert count_incidents(client) == 2

    (tmp_path / "off").mkdir()
    off = make_client(tmp_path / "off", scores=FIRE * 6, incident_merge_window_min=0)
    confirm(off, pending_detection(off, clip))
    confirm(off, pending_detection(off, clip))
    assert count_incidents(off) == 2


def test_merge_window_counts_from_the_latest_merged_detection(tmp_path, clip):  # noqa: F811
    client = make_client(tmp_path, scores=FIRE * 6, incident_merge_window_min=20)
    first = confirm(client, pending_detection(client, clip)).json()
    shift_detection(client, first["detection_event_id"], 15)
    second = pending_detection(client, clip)
    assert confirm(client, second).json()["id"] == first["id"]
    # 25 min after the first, but only 0 min after the merged one: still the same incident.
    shift_detection(client, first["detection_event_id"], 10)
    assert confirm(client, pending_detection(client, clip)).json()["id"] == first["id"]


def stored_detection(client, event_type: str, camera_id: str = CAM_SADDAR) -> str:
    """A pending detection of a given event type (the scripted detector only reports fire)."""
    with client.app.state.sessionmaker() as session:
        camera = session.get(Camera, camera_id)
        detection = operations.record_detection(
            session,
            camera,
            event_type=event_type,
            confidence=0.8,
            model="scripted-test-detector",
            threshold=0.45,
            evidence_timestamp_s=1.0,
            evidence_jpeg=None,
            details={"source": {"kind": "upload"}},
        )
        return detection.id


@pytest.mark.parametrize(
    ("first", "second"),
    [("fire", "fire"), ("fire", "fire_smoke"), ("smoke", "fire_smoke")],
)
def test_fire_response_family_merges_into_the_open_incident(tmp_path, first, second):
    client = make_client(tmp_path)
    incident = confirm(client, stored_detection(client, first)).json()
    second_id = stored_detection(client, second)

    merged = confirm(client, second_id).json()

    assert merged["id"] == incident["id"]
    assert merged["event_type"] == first  # the original incident type is kept
    assert merged["severity"] == incident["severity"]
    event = merged["timeline"][-1]
    assert event["event_type"] == "detection_merged"
    assert event["message"].startswith("Additional detection received from same camera")
    assert event["details"]["detection_event_id"] == second_id
    assert count_incidents(client) == 1


def test_family_detection_after_the_merge_window_creates_a_new_incident(tmp_path):
    client = make_client(tmp_path, incident_merge_window_min=10)
    incident = confirm(client, stored_detection(client, "smoke")).json()
    shift_detection(client, incident["detection_event_id"], 30)

    later = confirm(client, stored_detection(client, "fire_smoke")).json()

    assert later["id"] != incident["id"]
    assert later["event_type"] == "fire_smoke"
    assert count_incidents(client) == 2


def count_incidents(client) -> int:
    with client.app.state.sessionmaker() as session:
        return len(session.scalars(select(Incident.id)).all())


# --- scenarios: delay, dedupe, variations ---


def test_operator_delay_applies_to_one_run_and_is_capped(tmp_path, clip):  # noqa: F811
    client = scenario_client(tmp_path, scenario_max_delay_s=60)

    run = client.post(f"{API}/scenarios/{FIRE_SCENARIO}/start", json={"delay_s": 5}, headers=AUTH)
    trigger = run.json()["trigger_at"]
    created = run.json()["created_at"]
    assert (
        utc_now().fromisoformat(trigger) - utc_now().fromisoformat(created)
    ).total_seconds() == 5
    assert advance(client, 4) == 0 and advance(client, 6) == 1

    capped = client.post(
        f"{API}/scenarios/clifton-structure-smoke/start", json={"delay_s": 9999}, headers=AUTH
    ).json()
    delay = utc_now().fromisoformat(capped["trigger_at"]) - utc_now().fromisoformat(
        capped["created_at"]
    )
    assert delay.total_seconds() == 60
    assert client.get(f"{API}/scenarios").json()["max_delay_s"] == 60


def test_default_scenario_delays_are_short_for_demos():
    for scenario in load_scenarios():
        assert 5 <= scenario.trigger_after_seconds <= 12, scenario.id


def test_repeat_scenario_on_same_camera_attaches_to_the_pending_alert(tmp_path, clip):  # noqa: F811
    client = scenario_client(tmp_path, scores=FIRE * 6)
    start(client)
    advance(client, 20)
    first = client.get(f"{API}/detections?review_status=pending").json()["items"]
    assert len(first) == 1

    start(client, "korangi-follow-up-detection")
    advance(client, 40)

    pending = client.get(f"{API}/detections?review_status=pending").json()["items"]
    assert [d["id"] for d in pending] == [first[0]["id"]]  # one alert, not two
    with client.app.state.sessionmaker() as session:
        run = session.scalar(
            select(ScenarioRun).where(ScenarioRun.scenario_id == "korangi-follow-up-detection")
        )
        assert run.status == "detected"
        assert run.detection_event_id == first[0]["id"]
        assert run.result["merged_into_pending"] == first[0]["id"]


def test_follow_up_scenario_after_confirmation_merges_into_the_incident(tmp_path, clip):  # noqa: F811
    client = scenario_client(tmp_path, scores=FIRE * 6)
    start(client)
    advance(client, 20)
    detection = client.get(f"{API}/detections?review_status=pending").json()["items"][0]
    incident = confirm(client, detection["id"]).json()

    start(client, "korangi-follow-up-detection")
    advance(client, 40)
    follow_up = client.get(f"{API}/detections?review_status=pending").json()["items"][0]
    assert follow_up["id"] != detection["id"]  # a new alert: the first one was reviewed

    merged = confirm(client, follow_up["id"]).json()
    assert merged["id"] == incident["id"]
    assert merged["timeline"][-1]["event_type"] == "detection_merged"
    assert count(client, Incident) == 1


def test_scenario_set_covers_fire_smoke_lookalikes_interior_and_roadway():
    scenarios = load_scenarios()
    assert len(scenarios) >= 6
    assert {s.category for s in scenarios} >= {
        "fire",
        "smoke",
        "false_alarm",
        "interior",
        "roadway",
    }
    codes = {c["code"]: c for c in NETWORK["cameras"]}
    for s in scenarios:
        assert (ASSET_DIR / s.video_asset).is_file()
        assert codes[s.camera_code]["source_type"] == "demo_stream"


# --- resets ---


def test_demo_reset_keeps_history_and_full_reset_clears_it(tmp_path, clip):  # noqa: F811
    client = scenario_client(tmp_path, scores=FIRE * 6)
    start(client)
    advance(client, 20)
    detection = client.get(f"{API}/detections?review_status=pending").json()["items"][0]
    confirm(client, detection["id"])
    client.post(f"{API}/cameras/status", json={"status": "offline"}, headers=AUTH)

    demo = client.post(f"{API}/scenarios/reset", json={"scope": "demo"}, headers=AUTH).json()
    assert demo["scope"] == "demo" and demo["incidents_closed"] == 1
    assert count(client, Incident) == 1  # history kept, closed
    assert client.get(f"{API}/incidents").json()["items"][0]["status"] == "resolved"

    full = client.post(f"{API}/scenarios/reset", json={"scope": "full"}, headers=AUTH).json()
    assert full["scope"] == "full"
    assert full["incidents_deleted"] == 1 and full["detections_deleted"] == 1
    assert full["scenario_runs_deleted"] == 1 and full["cameras_restored"] == 179
    for model in (Incident, DetectionEvent, ScenarioRun):
        assert count(client, model) == 0
    # Seeded base data stays: every node, station and demo feed.
    cameras = client.get(f"{API}/cameras").json()["items"]
    assert len(cameras) == 179 and all(c["status"] == "active" for c in cameras)
    assert len(client.get(f"{API}/fire-stations").json()["items"]) == 11
    assert client.get(f"{API}/cameras/{KORANGI}").json()["feed"]["country"] == "Pakistan"
    assert start(client).status_code == 200  # scenarios run again after a full reset


def test_full_reset_requires_operator_key(tmp_path):
    client = scenario_client(tmp_path)
    assert client.post(f"{API}/scenarios/reset", json={"scope": "full"}).status_code == 401
    assert (
        client.post(f"{API}/scenarios/reset", json={"scope": "all"}, headers=AUTH).status_code
        == 422
    )


# --- network simulation ---


def test_nodes_go_offline_and_online_by_district_or_list(tmp_path):
    client = scenario_client(tmp_path)
    assert client.post(f"{API}/cameras/status", json={"status": "offline"}).status_code == 401

    body = client.post(
        f"{API}/cameras/status", json={"status": "offline", "district": "Korangi"}, headers=AUTH
    ).json()
    assert body == {"status": "offline", "cameras_changed": 12}
    korangi = client.get(f"{API}/cameras/{KORANGI}").json()
    assert korangi["status"] == "offline" and korangi["monitoring_status"] == "offline"
    assert client.get(f"{API}/cameras/{CAM_SADDAR}").json()["status"] == "active"

    client.post(
        f"{API}/cameras/status", json={"status": "active", "camera_ids": [KORANGI]}, headers=AUTH
    )
    assert client.get(f"{API}/cameras/{KORANGI}").json()["status"] == "active"
    bad = client.post(f"{API}/cameras/status", json={"status": "broken"}, headers=AUTH)
    assert bad.status_code == 422


def test_station_availability_toggle_changes_the_suggestion(tmp_path, clip):  # noqa: F811
    client = make_client(tmp_path, scores=FIRE * 6)
    first = confirm(client, pending_detection(client, clip)).json()
    station_id = first["station_selection"]["station"]["id"]
    for incident in client.get(f"{API}/incidents").json()["items"]:
        set_status(client, incident["id"], "resolved")

    toggled = client.post(
        f"{API}/fire-stations/{station_id}/status", json={"status": "unavailable"}, headers=AUTH
    )
    assert toggled.status_code == 200 and toggled.json()["status"] == "unavailable"
    second = confirm(client, pending_detection(client, clip)).json()
    assert second["station_selection"]["station"]["id"] != station_id
    missing = client.post(
        f"{API}/fire-stations/{seed_id('KHI-FS-99')}/status",
        json={"status": "available"},
        headers=AUTH,
    )
    assert missing.status_code == 404


# --- Pakistan-based demo feeds ---


def test_every_demo_feed_carries_pakistan_provenance_and_licence(tmp_path):
    client = scenario_client(tmp_path)
    cameras = client.get(f"{API}/cameras").json()["items"]
    feeds = [c for c in cameras if c["source_type"] == "demo_stream"]
    assert len(feeds) >= 120  # most selectable nodes show a feed
    offsets = set()
    for c in feeds:
        feed = c["feed"]
        assert feed["country"] == "Pakistan" and feed["is_demo_feed"] is True
        assert feed["source_type"] == "pakistan_demo_footage"
        assert feed["licence"] and feed["source_url"].startswith("https://")
        assert "not CCTV" in feed["licence_note"] and "not at this location" in feed["licence_note"]
        assert c["stream_url"] == f"/api/v1/media/{feed['asset']}"
        assert (ASSET_DIR / feed["asset"]).is_file()
        offsets.add((feed["asset"], feed["start_offset_s"]))
    assert len(offsets) > len(LIBRARY["assets"])  # shared clips start at different points
    others = [c for c in cameras if c["source_type"] != "demo_stream"]
    assert others and all(c["feed"] is None and c["stream_url"] is None for c in others)


def test_feed_library_covers_the_priority_zones_and_is_documented():
    zones = set(LIBRARY["zones"])
    for zone in (
        "Korangi",
        "Clifton",
        "Saddar",
        "Gulshan-e-Iqbal",
        "Lyari",
        "DHA",
        "Shahrah-e-Faisal corridor",
        "SITE",
        "Malir",
        "North Nazimabad",
    ):
        assert zone in zones
    assert 12 <= len(LIBRARY["assets"]) <= 20
    sources = (ASSET_DIR / "SOURCES.md").read_text(encoding="utf-8")
    for asset in LIBRARY["assets"]:
        assert asset["asset"] in sources and asset["licence"] and asset["attribution"]


# --- migration ---


def test_m6b_migration_adds_feed_meta_and_merge_event(tmp_path):
    url = f"sqlite:///{(tmp_path / 'm6b.db').as_posix()}"
    command.upgrade(alembic_config(url), "head")
    engine = create_engine(url)
    with engine.connect() as conn:
        columns = {c["name"] for c in sa.inspect(conn).get_columns("camera")}
    assert "feed_meta" in columns
    engine.dispose()
    command.downgrade(alembic_config(url), "0002")
    engine = create_engine(url)
    with engine.connect() as conn:
        assert "feed_meta" not in {c["name"] for c in sa.inspect(conn).get_columns("camera")}
    engine.dispose()
    assert make_settings().incident_merge_window_min == 30


def test_scenario_refuses_an_offline_node(tmp_path):
    client = scenario_client(tmp_path)
    client.post(
        f"{API}/cameras/status", json={"status": "offline", "camera_ids": [KORANGI]}, headers=AUTH
    )
    refused = start(client)
    assert refused.status_code == 409
    assert refused.json()["error"]["code"] == "SCENARIO_CAMERA_OFFLINE"
