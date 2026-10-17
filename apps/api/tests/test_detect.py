import tempfile

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.detection.evidence import EvidenceStore
from app.detection.fire_model import Detection, FramePrediction, ModelUnavailable
from app.detection.fire_pipeline import analyze_video
from app.domain.fire_decision import DecisionRule
from app.main import create_app
from app.routers.detect import ModelProvider

from .conftest import make_settings

RULE = DecisionRule(0.45, 3, 5, 0)
BOX = (0.25, 0.25, 0.75, 0.75)


class ScriptedDetector:
    """Returns the next scripted fire score for each sampled frame (unit tests, no real model)."""

    name = "scripted-test-detector"
    labels = ["fire", "smoke"]

    def __init__(self, fire_scores: list[float]):
        self._scores = iter(fire_scores)

    def predict(self, frame_bgr, conf_threshold):
        score = next(self._scores, 0.0)
        detections = [Detection("fire", score, BOX)] if score >= conf_threshold else []
        return FramePrediction(detections, {"fire": score, "smoke": 0.0})


class BrokenDetector(ScriptedDetector):
    def predict(self, frame_bgr, conf_threshold):
        raise RuntimeError("secret internal detail")


@pytest.fixture
def clip(tmp_path):
    """4 s, 10 fps MP4 → 8 frames sampled at 2 fps. Frame brightness encodes the frame index."""
    path = tmp_path / "clip.mp4"
    writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"mp4v"), 10, (160, 120))
    for i in range(40):
        writer.write(np.full((120, 160, 3), i * 6, dtype=np.uint8))
    writer.release()
    return path


@pytest.fixture
def store(tmp_path):
    return EvidenceStore(tmp_path / "evidence", max_files=3)


# --- pipeline ---


def test_pipeline_not_detected_writes_no_evidence(clip, store):
    result = analyze_video(clip, ScriptedDetector([0.1] * 8), RULE, 2, 60, store)

    assert result.event_type is None
    assert result.frames_sampled == 8
    assert result.positive_frames == 0
    assert result.evidence_id is None
    assert not store.directory.exists() or not any(store.directory.iterdir())


def test_pipeline_selects_strongest_positive_frame_as_evidence(clip, store):
    scores = [0.1, 0.5, 0.9, 0.6, 0.2, 0.0, 0.0, 0.0]

    result = analyze_video(clip, ScriptedDetector(scores), RULE, 2, 60, store)

    assert result.event_type == "fire"
    assert result.positive_frames == 3
    assert result.evidence_offset_s == 1.0  # third sampled frame (index 2 at 2 fps)
    assert result.verdicts["fire"].peak_confidence == 0.9
    path = store.path_for(result.evidence_id)
    assert path is not None and path.read_bytes()[:2] == b"\xff\xd8"  # JPEG


def test_evidence_store_keeps_only_newest_files(store):
    frame = np.zeros((90, 160, 3), dtype=np.uint8)
    ids = [store.save(frame, [], f"caption {i}") for i in range(5)]

    assert len(list(store.directory.glob("*.jpg"))) <= 3
    assert store.path_for(ids[-1]) is not None


@pytest.mark.parametrize("bad_id", ["../../etc/passwd", "ABC", "0" * 31, "g" * 32])
def test_evidence_store_rejects_malformed_ids(store, bad_id):
    assert store.path_for(bad_id) is None


# --- endpoint ---


def client_with(detector=None, error: str | None = None, tmp_path=None, **settings) -> TestClient:
    def load():
        if error:
            raise ModelUnavailable(error)
        return detector

    settings.setdefault("evidence_dir", str(tmp_path / "evidence") if tmp_path else None)
    app = create_app(make_settings(app_env="test", **settings), models=ModelProvider(load))
    return TestClient(app)


def post_clip(client, data, name="clip.mp4"):
    return client.post("/api/v1/detect/fire", files={"file": (name, data, "video/mp4")})


@pytest.fixture
def upload_dir(tmp_path, monkeypatch):
    target = tmp_path / "uploads"
    target.mkdir()
    monkeypatch.setattr(tempfile, "tempdir", str(target))
    return target


def test_detect_returns_detected_result_and_serves_evidence(clip, tmp_path, upload_dir):
    detector = ScriptedDetector([0.1, 0.5, 0.9, 0.6, 0.2, 0.0, 0.0, 0.0])
    client = client_with(detector, tmp_path=tmp_path)

    response = post_clip(client, clip.read_bytes())

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "detected"
    assert body["event_type"] == "fire"
    assert body["confidence"] == 0.9
    assert body["best_frame_timestamp"] == 1.0
    assert body["sampled_frames"] == 8
    assert body["positive_frames"] == 3
    assert body["model"] == "scripted-test-detector"
    assert body["threshold"] == 0.45
    assert body["classes"]["smoke"]["confirmed"] is False
    assert "operator" in body["disclaimer"]
    evidence = client.get(body["evidence"]["url"])
    assert evidence.status_code == 200
    assert evidence.headers["content-type"] == "image/jpeg"
    assert list(upload_dir.iterdir()) == []  # temp upload deleted


def test_detect_returns_not_detected(clip, tmp_path):
    client = client_with(ScriptedDetector([0.2] * 8), tmp_path=tmp_path)

    body = post_clip(client, clip.read_bytes()).json()

    assert body["status"] == "not_detected"
    assert body["event_type"] is None
    assert body["confidence"] == 0.0
    assert body["evidence"] is None
    assert body["classes"]["fire"]["peak_confidence"] == 0.2


def test_detect_reports_model_unavailable_as_503(clip, tmp_path, upload_dir):
    client = client_with(error="Model file not found: /secret/path.onnx", tmp_path=tmp_path)

    response = post_clip(client, clip.read_bytes())

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "MODEL_UNAVAILABLE"
    assert "/secret/path" not in response.text
    assert list(upload_dir.iterdir()) == []


def test_detect_inference_failure_is_500_without_internal_details(clip, tmp_path):
    client = client_with(BrokenDetector([]), tmp_path=tmp_path)

    response = post_clip(client, clip.read_bytes())

    assert response.status_code == 500
    assert response.json()["error"]["code"] == "INFERENCE_FAILED"
    assert "secret internal detail" not in response.text
    assert "Traceback" not in response.text


@pytest.mark.parametrize(
    ("name", "data", "status", "code"),
    [
        ("clip.avi", b"\x00\x00\x00\x18ftypisom" + b"\x00" * 100, 415, "UNSUPPORTED_MEDIA"),
        ("fake.mp4", b"plain text, not a video", 415, "UNSUPPORTED_MEDIA"),
        ("broken.mp4", b"\x00\x00\x00\x18ftypisom" + b"\x00" * 1000, 422, "VIDEO_UNREADABLE"),
    ],
)
def test_detect_rejects_invalid_uploads(tmp_path, name, data, status, code):
    client = client_with(ScriptedDetector([]), tmp_path=tmp_path)

    response = post_clip(client, data, name)

    assert response.status_code == status
    assert response.json()["error"]["code"] == code


def test_detect_rejects_oversized_upload(tmp_path):
    client = client_with(ScriptedDetector([]), tmp_path=tmp_path, max_upload_mb=0.001)

    response = post_clip(client, b"\x00" * 200_000)

    assert response.status_code == 413


def test_detect_rejects_too_long_video(clip, tmp_path):
    client = client_with(ScriptedDetector([]), tmp_path=tmp_path, video_max_seconds=1)

    response = post_clip(client, clip.read_bytes())

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VIDEO_TOO_LONG"


def test_unknown_evidence_is_404(tmp_path):
    client = client_with(ScriptedDetector([]), tmp_path=tmp_path)

    assert client.get(f"/api/v1/detect/evidence/{'a' * 32}.jpg").status_code == 404
