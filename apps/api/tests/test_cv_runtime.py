import logging

import cv2
import numpy as np
import onnxruntime as ort
import pytest
from fastapi.testclient import TestClient

from app.detection import runtime_check
from app.detection.runtime_check import CPU_PROVIDER, RuntimeCheckError, check_cv_runtime
from app.main import create_app

from .conftest import make_settings

GPU_PROVIDERS = {"CUDAExecutionProvider", "TensorrtExecutionProvider", "ROCMExecutionProvider"}


def test_opencv_imports_with_pinned_version():
    assert cv2.__version__.startswith("4.14.")


def test_numpy_operations_work():
    frame = np.full((4, 4, 3), 10, dtype=np.uint8)

    assert int(frame.sum()) == 4 * 4 * 3 * 10
    assert cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY).shape == (4, 4)


def test_onnxruntime_exposes_cpu_provider():
    assert ort.__version__.startswith("1.30.")
    assert CPU_PROVIDER in ort.get_available_providers()


def test_runtime_check_runs_inference_on_cpu_only():
    report = check_cv_runtime()

    assert report.opencv_version == cv2.__version__
    assert report.onnxruntime_version == ort.__version__
    assert report.session_providers == [CPU_PROVIDER]
    assert not GPU_PROVIDERS & set(report.session_providers)


def test_runtime_check_fails_loudly_without_cpu_provider(monkeypatch):
    monkeypatch.setattr(runtime_check.ort, "get_available_providers", lambda: [])

    with pytest.raises(RuntimeCheckError, match=CPU_PROVIDER):
        check_cv_runtime()


def test_startup_check_is_off_by_default():
    assert make_settings().cv_runtime_check is False


def test_startup_check_logs_versions_when_enabled(caplog):
    app = create_app(make_settings(app_env="test", cv_runtime_check=True))

    with caplog.at_level(logging.INFO, logger="uvicorn.error"), TestClient(app) as client:
        assert client.get("/api/v1/health").status_code == 200

    assert f"CV runtime check OK: opencv={cv2.__version__}" in caplog.text
    assert CPU_PROVIDER in caplog.text
