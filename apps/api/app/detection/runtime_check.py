"""CV runtime self-check for the M1c feasibility spike.

Proves OpenCV and ONNX Runtime import and actually execute on this host (CPU only).
No model weights are involved: the ONNX check runs a tiny in-memory graph (y = x + x).

Run directly:  uv run python -m app.detection.runtime_check
On the host:   set CV_RUNTIME_CHECK=true to log one summary line at startup (off by default).
"""

import json
from dataclasses import asdict, dataclass

import cv2
import numpy as np
import onnxruntime as ort

from app.detection import memory

CPU_PROVIDER = "CPUExecutionProvider"


@dataclass(frozen=True)
class RuntimeReport:
    opencv_version: str
    numpy_version: str
    onnxruntime_version: str
    available_providers: list[str]
    session_providers: list[str]
    rss_mb: float | None
    peak_rss_mb: float | None


class RuntimeCheckError(RuntimeError):
    pass


def check_cv_runtime() -> RuntimeReport:
    _check_opencv()
    available = ort.get_available_providers()
    if CPU_PROVIDER not in available:
        raise RuntimeCheckError(f"{CPU_PROVIDER} missing; available: {available}")
    session_providers = _check_onnx_inference()
    rss, peak = memory.rss_mb(), memory.peak_rss_mb()
    return RuntimeReport(
        opencv_version=cv2.__version__,
        numpy_version=np.__version__,
        onnxruntime_version=ort.__version__,
        available_providers=available,
        session_providers=session_providers,
        rss_mb=rss,
        peak_rss_mb=peak,
    )


def _check_opencv() -> None:
    # Synthetic 640x360 BGR frame: the same operations the pipeline will need.
    frame = np.zeros((360, 640, 3), dtype=np.uint8)
    frame[100:200, 200:300] = (0, 128, 255)  # orange block
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    if hsv.shape != frame.shape:
        raise RuntimeCheckError("cv2.cvtColor returned an unexpected shape")
    small = cv2.resize(frame, (320, 180), interpolation=cv2.INTER_AREA)
    ok, jpeg = cv2.imencode(".jpg", small, [cv2.IMWRITE_JPEG_QUALITY, 80])
    if not ok:
        raise RuntimeCheckError("cv2.imencode failed to produce a JPEG")
    decoded = cv2.imdecode(jpeg, cv2.IMREAD_COLOR)
    if decoded is None or decoded.shape != small.shape:
        raise RuntimeCheckError("cv2.imdecode round trip failed")


def _check_onnx_inference() -> list[str]:
    session = ort.InferenceSession(_add_model_bytes(), providers=[CPU_PROVIDER])
    x = np.array([[1.0, 2.0, 3.0]], dtype=np.float32)
    (y,) = session.run(None, {"x": x})
    if not np.array_equal(y, x + x):
        raise RuntimeCheckError(f"ONNX inference returned {y!r}, expected {x + x!r}")
    return session.get_providers()


# --- Minimal ONNX model, hand-encoded so the `onnx` package is not a dependency. ---
# ModelProto{ir_version=8, opset 17, graph: Add(x, x) -> y, x/y float[1,3]}.


def _varint(n: int) -> bytes:
    out = bytearray()
    while True:
        byte = n & 0x7F
        n >>= 7
        out.append(byte | (0x80 if n else 0))
        if not n:
            return bytes(out)


def _int_field(num: int, value: int) -> bytes:
    return _varint(num << 3) + _varint(value)


def _bytes_field(num: int, payload: bytes | str) -> bytes:
    data = payload.encode() if isinstance(payload, str) else payload
    return _varint((num << 3) | 2) + _varint(len(data)) + data


def _float_tensor_value(name: str, dims: list[int]) -> bytes:
    shape = b"".join(_bytes_field(1, _int_field(1, d)) for d in dims)  # Dimension.dim_value
    tensor_type = _int_field(1, 1) + _bytes_field(2, shape)  # elem_type FLOAT, shape
    return _bytes_field(1, name) + _bytes_field(2, _bytes_field(1, tensor_type))


def _add_model_bytes() -> bytes:
    node = _bytes_field(1, "x") + _bytes_field(1, "x") + _bytes_field(2, "y")
    node += _bytes_field(4, "Add")
    graph = _bytes_field(1, node) + _bytes_field(2, "runtime_check")
    graph += _bytes_field(11, _float_tensor_value("x", [1, 3]))
    graph += _bytes_field(12, _float_tensor_value("y", [1, 3]))
    opset = _bytes_field(1, "") + _int_field(2, 17)
    return _int_field(1, 8) + _bytes_field(7, graph) + _bytes_field(8, opset)


def main() -> None:
    print(json.dumps(asdict(check_cv_runtime()), indent=2))


if __name__ == "__main__":
    main()
