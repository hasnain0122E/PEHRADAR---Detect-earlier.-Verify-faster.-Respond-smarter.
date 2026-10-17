import os
import tempfile

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.detection.video import VideoError, VideoTooLong, process_video
from app.main import create_app

from .conftest import make_settings

FPS = 10
SECONDS = 3


@pytest.fixture
def clip(tmp_path):
    """3 s, 320x240, 10 fps MP4 generated in-test (no committed video assets)."""
    path = tmp_path / "clip.mp4"
    writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"mp4v"), FPS, (320, 240))
    assert writer.isOpened()
    for i in range(FPS * SECONDS):
        frame = np.zeros((240, 320, 3), dtype=np.uint8)
        frame[:, (i * 10) % 320 :] = (0, 128, 255)
        writer.write(frame)
    writer.release()
    return path


def test_reads_metadata_and_samples_at_requested_rate(clip):
    report = process_video(clip, sample_fps=2)

    assert (report.metadata.width, report.metadata.height) == (320, 240)
    assert report.metadata.fps == pytest.approx(FPS)
    assert report.metadata.frame_count == FPS * SECONDS
    assert report.metadata.duration_s == pytest.approx(SECONDS)
    assert report.frames_decoded == FPS * SECONDS
    assert report.frames_sampled == SECONDS * 2  # every 5th frame
    assert report.decode_threads == 1


def test_capture_is_released_so_the_file_can_be_deleted(clip):
    process_video(clip, sample_fps=2)

    os.remove(clip)  # fails on Windows if the VideoCapture still holds the file
    assert not clip.exists()


def test_rejects_video_longer_than_limit(clip):
    with pytest.raises(VideoTooLong):
        process_video(clip, sample_fps=2, max_seconds=1)


def test_rejects_unreadable_file(tmp_path):
    bad = tmp_path / "bad.mp4"
    bad.write_bytes(b"\x00\x00\x00\x18ftypisom" + b"\x00" * 1000)

    with pytest.raises(VideoError):
        process_video(bad, sample_fps=2)


# --- POST /api/v1/video/test ---


@pytest.fixture
def upload_dir(tmp_path, monkeypatch):
    target = tmp_path / "uploads"
    target.mkdir()
    monkeypatch.setattr(tempfile, "tempdir", str(target))
    return target


def video_client(**overrides) -> TestClient:
    settings = make_settings(app_env="test", video_test_enabled=True, **overrides)
    return TestClient(create_app(settings))


def post_file(client, name, data, content_type="video/mp4"):
    return client.post("/api/v1/video/test", files={"file": (name, data, content_type)})


def test_endpoint_is_not_mounted_by_default(clip):
    client = TestClient(create_app(make_settings(app_env="test")))

    assert post_file(client, "clip.mp4", clip.read_bytes()).status_code == 404


def test_upload_returns_metrics_and_deletes_temp_file(clip, upload_dir):
    response = post_file(video_client(), "clip.mp4", clip.read_bytes())

    assert response.status_code == 200
    body = response.json()
    assert body["metadata"]["width"] == 320
    assert body["frames_sampled"] == SECONDS * 2
    assert body["size_bytes"] == clip.stat().st_size
    assert body["processing_s"] >= 0
    assert "rss_before_mb" in body and "peak_rss_mb" in body
    assert list(upload_dir.iterdir()) == []


def test_rejects_non_mp4_extension(clip):
    response = post_file(video_client(), "clip.avi", clip.read_bytes())

    assert response.status_code == 415
    assert response.json()["error"]["code"] == "UNSUPPORTED_MEDIA"


def test_rejects_mp4_name_without_mp4_signature(upload_dir):
    response = post_file(video_client(), "fake.mp4", b"not a video at all" * 10)

    assert response.status_code == 415
    assert list(upload_dir.iterdir()) == []


def test_rejects_upload_over_limit_before_processing(clip):
    response = post_file(video_client(video_test_max_mb=0.001), "clip.mp4", b"\x00" * 200_000)

    assert response.status_code == 413
    assert response.json()["error"]["code"] == "UPLOAD_TOO_LARGE"


def test_rejects_unreadable_mp4(upload_dir):
    data = b"\x00\x00\x00\x18ftypisom" + b"\x00" * 1000

    response = post_file(video_client(), "broken.mp4", data)

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VIDEO_UNREADABLE"
    assert list(upload_dir.iterdir()) == []


def test_rejects_too_long_video(clip):
    response = post_file(video_client(video_max_seconds=1), "clip.mp4", clip.read_bytes())

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VIDEO_TOO_LONG"


def test_missing_file_field_is_a_validation_error():
    response = video_client().post("/api/v1/video/test", files={"other": ("x.txt", b"x")})

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"
