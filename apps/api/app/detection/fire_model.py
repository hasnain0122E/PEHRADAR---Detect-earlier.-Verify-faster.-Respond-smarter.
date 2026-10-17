"""YOLOv8 fire/smoke detector on ONNX Runtime (CPU only).

Model contract (checked at load): one input [1, 3, S, S] float32 RGB in [0, 1]; one output
[1, 4 + C, N] where rows 0-3 are box cx, cy, w, h in input pixels and rows 4.. are per-class
scores (already sigmoid). Class names come from the ONNX metadata `names` written by Ultralytics.

Preprocessing: letterbox (keep aspect ratio, pad with grey 114 to S x S), BGR -> RGB, /255, CHW.
Postprocessing: per anchor take the best class; drop anchors below the confidence threshold;
class-wise NMS at IOU_THRESHOLD; map boxes back to the source frame, normalised to [0, 1].
Single-threaded session with no randomness, so the same frame always gives the same output.
"""

import ast
import hashlib
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np
import onnxruntime as ort

CPU_PROVIDER = "CPUExecutionProvider"
IOU_THRESHOLD = 0.45
PAD_VALUE = 114


class ModelUnavailable(Exception):
    """The model file is missing, fails its checksum, or does not match the contract."""


class ModelOutputError(Exception):
    """The model returned something that does not match the contract."""


@dataclass(frozen=True)
class Detection:
    label: str
    confidence: float
    box: tuple[float, float, float, float]  # x1, y1, x2, y2 normalised to the source frame


@dataclass(frozen=True)
class Letterbox:
    scale: float
    pad_x: float
    pad_y: float
    src_w: int
    src_h: int


@dataclass(frozen=True)
class FramePrediction:
    detections: list[Detection]  # above the threshold, after NMS
    max_scores: dict[str, float]  # best raw score per class, even below the threshold


def preprocess(frame_bgr: np.ndarray, size: int) -> tuple[np.ndarray, Letterbox]:
    src_h, src_w = frame_bgr.shape[:2]
    scale = min(size / src_w, size / src_h)
    new_w, new_h = round(src_w * scale), round(src_h * scale)
    resized = cv2.resize(frame_bgr, (new_w, new_h), interpolation=cv2.INTER_LINEAR)
    pad_x, pad_y = (size - new_w) / 2, (size - new_h) / 2
    top, left = round(pad_y - 0.1), round(pad_x - 0.1)
    canvas = np.full((size, size, 3), PAD_VALUE, dtype=np.uint8)
    canvas[top : top + new_h, left : left + new_w] = resized
    rgb = canvas[:, :, ::-1]
    tensor = np.ascontiguousarray(rgb.transpose(2, 0, 1), dtype=np.float32)[None] / 255.0
    return tensor, Letterbox(scale, left, top, src_w, src_h)


def postprocess(
    output: np.ndarray, letterbox: Letterbox, labels: list[str], conf_threshold: float
) -> FramePrediction:
    if (
        not isinstance(output, np.ndarray)
        or output.ndim != 3
        or output.shape[0] != 1
        or output.shape[1] != 4 + len(labels)
    ):
        shape = getattr(output, "shape", None)
        raise ModelOutputError(f"Expected output [1, {4 + len(labels)}, N], got {shape}")
    rows = output[0].T  # [N, 4 + C]
    if not np.isfinite(rows).all():
        raise ModelOutputError("Model output contains NaN or infinity")
    scores = rows[:, 4:]
    max_scores = {label: float(scores[:, i].max(initial=0.0)) for i, label in enumerate(labels)}

    class_ids = scores.argmax(axis=1)
    confidences = scores[np.arange(len(scores)), class_ids]
    keep = confidences >= conf_threshold
    if not keep.any():
        return FramePrediction([], max_scores)
    boxes = _xywh_to_xyxy(rows[keep, :4])
    class_ids, confidences = class_ids[keep], confidences[keep]

    detections = []
    for i in _nms(boxes, confidences, class_ids, IOU_THRESHOLD):
        detections.append(
            Detection(
                label=labels[class_ids[i]],
                confidence=round(float(confidences[i]), 4),
                box=_to_source(boxes[i], letterbox),
            )
        )
    detections.sort(key=lambda d: d.confidence, reverse=True)
    return FramePrediction(detections, max_scores)


class FireSmokeModel:
    def __init__(self, path: str | Path, name: str, sha256: str | None = None, threads: int = 1):
        path = Path(path)
        if not path.is_file():
            raise ModelUnavailable(f"Model file not found: {path}")
        if sha256:
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            if digest != sha256.lower():
                raise ModelUnavailable(f"Model checksum mismatch for {path.name}: {digest}")
        options = ort.SessionOptions()
        options.intra_op_num_threads = threads
        options.inter_op_num_threads = 1
        try:
            self._session = ort.InferenceSession(str(path), options, providers=[CPU_PROVIDER])
        except Exception as exc:  # onnxruntime raises several unrelated exception types
            raise ModelUnavailable(f"ONNX Runtime could not load {path.name}: {exc}") from exc

        inputs, outputs = self._session.get_inputs(), self._session.get_outputs()
        if len(inputs) != 1 or len(outputs) != 1:
            raise ModelUnavailable("Expected exactly one input and one output")
        shape = inputs[0].shape
        square = len(shape) == 4 and shape[1] == 3 and shape[2] == shape[3]
        if not square or not isinstance(shape[2], int):
            raise ModelUnavailable(f"Expected a fixed square input [1, 3, S, S], got {shape}")
        self._input_name = inputs[0].name
        self.input_size: int = shape[2]
        self.labels = _labels_from_metadata(self._session)
        self.name = name

    def predict(self, frame_bgr: np.ndarray, conf_threshold: float) -> FramePrediction:
        tensor, letterbox = preprocess(frame_bgr, self.input_size)
        (output,) = self._session.run(None, {self._input_name: tensor})
        return postprocess(output, letterbox, self.labels, conf_threshold)


def _labels_from_metadata(session: ort.InferenceSession) -> list[str]:
    raw = session.get_modelmeta().custom_metadata_map.get("names")
    try:
        names = ast.literal_eval(raw) if raw else None
    except (ValueError, SyntaxError):
        names = None
    if not isinstance(names, dict) or not names:
        raise ModelUnavailable("Model metadata has no class names")
    return [str(names[i]) for i in sorted(names)]


def _xywh_to_xyxy(xywh: np.ndarray) -> np.ndarray:
    cx, cy, w, h = xywh.T
    return np.stack([cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2], axis=1)


def _nms(boxes: np.ndarray, scores: np.ndarray, class_ids: np.ndarray, iou: float) -> list[int]:
    """Greedy class-wise NMS. Returns indices into boxes, highest score first."""
    order = np.argsort(-scores, kind="stable")
    keep: list[int] = []
    while order.size:
        best, rest = order[0], order[1:]
        keep.append(int(best))
        same_class = class_ids[rest] == class_ids[best]
        overlap = _iou(boxes[best], boxes[rest]) > iou
        order = rest[~(same_class & overlap)]
    return keep


def _iou(box: np.ndarray, others: np.ndarray) -> np.ndarray:
    x1 = np.maximum(box[0], others[:, 0])
    y1 = np.maximum(box[1], others[:, 1])
    x2 = np.minimum(box[2], others[:, 2])
    y2 = np.minimum(box[3], others[:, 3])
    inter = np.clip(x2 - x1, 0, None) * np.clip(y2 - y1, 0, None)
    area = (box[2] - box[0]) * (box[3] - box[1])
    areas = (others[:, 2] - others[:, 0]) * (others[:, 3] - others[:, 1])
    return inter / np.maximum(area + areas - inter, 1e-9)


def _to_source(box: np.ndarray, lb: Letterbox) -> tuple[float, float, float, float]:
    x1 = (box[0] - lb.pad_x) / lb.scale / lb.src_w
    y1 = (box[1] - lb.pad_y) / lb.scale / lb.src_h
    x2 = (box[2] - lb.pad_x) / lb.scale / lb.src_w
    y2 = (box[3] - lb.pad_y) / lb.scale / lb.src_h
    return tuple(round(float(np.clip(v, 0.0, 1.0)), 4) for v in (x1, y1, x2, y2))
