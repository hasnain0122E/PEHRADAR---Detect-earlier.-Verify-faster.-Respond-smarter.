"""Final hotfix: scenario footage is served to the camera viewer, safely."""

import pytest

from app.routers.scenarios import allowed_media
from app.services.scenarios import ASSET_DIR

from .test_m5 import scenario_client

API = "/api/v1"


def scenario(client, scenario_id):
    items = client.get(f"{API}/scenarios").json()["items"]
    return next(s for s in items if s["id"] == scenario_id)


@pytest.mark.parametrize(
    ("scenario_id", "asset", "start"),
    [
        ("korangi-industrial-fire", "fire_jamestown_night.mp4", 12),
        ("korangi-follow-up-detection", "fire_jamestown_night.mp4", 12),
        ("site-warehouse-night-fire", "fire_jamestown_night_2.mp4", 18),
        ("clifton-structure-smoke", "smoke_structure_1964.mp4", 9),
        ("lyari-sunset-glare", "street_sunset_traffic.mp4", 20),
        ("shahrah-e-faisal-night-headlights", "pk_peshawar_night_road.mp4", 0),
        ("ii-chundrigar-lobby-lighting", "pk_faisalabad_hotel_lobby.mp4", 0),
    ],
)
def test_scenario_exposes_the_same_clip_the_detector_analyses(tmp_path, scenario_id, asset, start):
    s = scenario(scenario_client(tmp_path), scenario_id)
    assert s["video_asset"] == asset
    assert s["video_url"] == f"/api/v1/media/{asset}"
    assert s["feed_start_s"] == start
    assert s["footage"]["description"].startswith("Pre-recorded")
    assert s["footage"]["recorded_in"] and s["footage"]["source"]
    assert "Karachi" in s["footage"]["recorded_in"]  # says it is NOT Karachi


def test_valid_demo_asset_streams_with_range_support(tmp_path):
    client = scenario_client(tmp_path)
    full = client.get(f"{API}/media/smoke_structure_1964.mp4")
    assert full.status_code == 200 and full.headers["content-type"] == "video/mp4"
    part = client.get(f"{API}/media/smoke_structure_1964.mp4", headers={"Range": "bytes=100-199"})
    assert part.status_code == 206 and len(part.content) == 100
    assert part.headers["content-range"].startswith("bytes 100-199/")


@pytest.mark.parametrize(
    "name",
    [
        "unknown.mp4",
        "SOURCES.md",
        "..%2Fseed%2Fscenarios.json",
        "..%2F..%2Fapp%2Fconfig.py",
        "%2Fetc%2Fpasswd",
        "..%5C..%5Cpehradar-dev.db",
        "fire_jamestown_night.mp4%00.txt",
    ],
)
def test_unknown_assets_and_traversal_are_rejected(tmp_path, name):
    assert scenario_client(tmp_path).get(f"{API}/media/{name}").status_code == 404


def test_media_allow_list_is_exactly_the_referenced_clips():
    allowed = allowed_media()
    assert {
        "fire_jamestown_night.mp4",
        "smoke_structure_1964.mp4",
        "pk_lahore_traffic.mp4",
    } <= allowed
    assert all((ASSET_DIR / name).is_file() for name in allowed)
    assert all("/" not in n and "\\" not in n and ".." not in n for n in allowed)
