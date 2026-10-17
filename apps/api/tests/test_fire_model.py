from pathlib import Path

import numpy as np
import pytest

from app.config import Settings
from app.detection.fire_model import (
    FireSmokeModel,
    Letterbox,
    ModelOutputError,
    ModelUnavailable,
    postprocess,
    preprocess,
)

LABELS = ["fire", "smoke"]
SQUARE = Letterbox(scale=1.0, pad_x=0, pad_y=0, src_w=320, src_h=320)


def raw_output(rows: list[tuple[float, float, float, float, float, float]], n: int = 10):
    """Build a [1, 6, n] YOLOv8 output; unspecified anchors score 0."""
    out = np.zeros((n, 6), dtype=np.float32)
    if rows:
        out[: len(rows)] = rows
    return out.T[None]


# --- preprocessing ---


def test_preprocess_letterboxes_wide_frame_into_square_rgb_tensor():
    frame = np.zeros((180, 320, 3), dtype=np.uint8)
    frame[:, :] = (255, 0, 0)  # pure blue in BGR

    tensor, lb = preprocess(frame, 320)

    assert tensor.shape == (1, 3, 320, 320) and tensor.dtype == np.float32
    assert lb.scale == 1.0 and lb.pad_x == 0 and lb.pad_y == 70
    assert tensor[0, 2, 160, 160] == 1.0  # blue lands in channel 2 (RGB order)
    assert tensor[0, 0, 160, 160] == 0.0
    assert tensor[0, 0, 0, 0] == pytest.approx(114 / 255)  # grey padding band
    assert 0.0 <= tensor.min() and tensor.max() <= 1.0


def test_preprocess_downscales_large_frames():
    tensor, lb = preprocess(np.zeros((720, 1280, 3), dtype=np.uint8), 320)

    assert tensor.shape == (1, 3, 320, 320)
    assert lb.scale == pytest.approx(0.25)
    assert lb.pad_y == 70


# --- postprocessing / thresholding ---


def test_postprocess_keeps_only_scores_at_or_above_threshold():
    output = raw_output([(160, 160, 64, 64, 0.80, 0.10), (50, 50, 20, 20, 0.30, 0.20)])

    result = postprocess(output, SQUARE, LABELS, conf_threshold=0.45)

    assert [d.label for d in result.detections] == ["fire"]
    assert result.detections[0].confidence == pytest.approx(0.8)
    assert result.detections[0].box == pytest.approx((0.4, 0.4, 0.6, 0.6))
    assert result.max_scores == pytest.approx({"fire": 0.8, "smoke": 0.2})


def test_postprocess_nms_merges_overlapping_boxes_of_same_class_only():
    output = raw_output(
        [
            (160, 160, 64, 64, 0.90, 0.0),
            (162, 162, 64, 64, 0.85, 0.0),  # same place, same class: suppressed
            (161, 161, 64, 64, 0.0, 0.70),  # same place, other class: kept
        ]
    )

    result = postprocess(output, SQUARE, LABELS, conf_threshold=0.45)

    assert [(d.label, d.confidence) for d in result.detections] == [
        ("fire", pytest.approx(0.9)),
        ("smoke", pytest.approx(0.7)),
    ]


def test_postprocess_maps_boxes_back_through_letterbox():
    lb = Letterbox(scale=0.25, pad_x=0, pad_y=70, src_w=1280, src_h=720)
    output = raw_output([(160, 160, 80, 90, 0.9, 0.0)])  # centre of the padded image

    (det,) = postprocess(output, lb, LABELS, 0.45).detections

    # x: (120..200)/0.25/1280 ; y: (115..205 - 70)/0.25/720
    assert det.box == pytest.approx((0.375, 0.25, 0.625, 0.75))


def test_postprocess_with_no_detections_returns_empty():
    result = postprocess(raw_output([]), SQUARE, LABELS, 0.45)

    assert result.detections == []
    assert result.max_scores == {"fire": 0.0, "smoke": 0.0}


@pytest.mark.parametrize(
    "bad",
    [
        np.zeros((1, 5, 10), dtype=np.float32),  # wrong channel count
        np.zeros((6, 10), dtype=np.float32),  # missing batch axis
        np.zeros((2, 6, 10), dtype=np.float32),  # batch of two
        "not an array",
    ],
)
def test_postprocess_rejects_unexpected_output_shape(bad):
    with pytest.raises(ModelOutputError):
        postprocess(bad, SQUARE, LABELS, 0.45)


def test_postprocess_rejects_nan_output():
    output = raw_output([(160, 160, 64, 64, float("nan"), 0.1)])

    with pytest.raises(ModelOutputError):
        postprocess(output, SQUARE, LABELS, 0.45)


# --- model loading ---


def test_missing_model_file_is_unavailable(tmp_path):
    with pytest.raises(ModelUnavailable, match="not found"):
        FireSmokeModel(tmp_path / "missing.onnx", "x")


def test_checksum_mismatch_is_unavailable(tmp_path):
    fake = tmp_path / "model.onnx"
    fake.write_bytes(b"not really a model")

    with pytest.raises(ModelUnavailable, match="checksum"):
        FireSmokeModel(fake, "x", sha256="0" * 64)


def test_corrupt_model_file_is_unavailable(tmp_path):
    fake = tmp_path / "model.onnx"
    fake.write_bytes(b"not really a model")

    with pytest.raises(ModelUnavailable, match="could not load"):
        FireSmokeModel(fake, "x")


# --- real model (integration; skipped, and reported as skipped, when the file is absent) ---

REAL = Settings(_env_file=None)
REAL_PATH = Path(__file__).resolve().parents[1] / REAL.model_path
needs_model = pytest.mark.skipif(
    not REAL_PATH.is_file(), reason="model file absent; run python -m app.detection.fetch_model"
)


@needs_model
def test_real_model_loads_with_expected_contract():
    model = FireSmokeModel(REAL_PATH, REAL.model_name, REAL.model_sha256)

    assert model.labels == ["fire", "smoke"]
    assert model.input_size == 320


@needs_model
def test_real_model_is_deterministic_and_quiet_on_a_blank_frame():
    model = FireSmokeModel(REAL_PATH, REAL.model_name, REAL.model_sha256)
    frame = np.full((480, 640, 3), 90, dtype=np.uint8)

    first = model.predict(frame, 0.45)
    second = model.predict(frame, 0.45)

    assert first == second
    assert first.detections == []
    assert set(first.max_scores) == {"fire", "smoke"}
