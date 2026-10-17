"""Evidence JPEGs: one annotated frame per detection result, kept in a bounded temp directory.

Names are server-generated UUID hex (never client input) and lookups only accept that format.
Only the newest `max_files` are kept. The directory is ephemeral on Render; the DB replaces it
in M3.
"""

import re
import tempfile
import uuid
from pathlib import Path

import cv2
import numpy as np

from app.detection.fire_model import Detection

EVIDENCE_ID = re.compile(r"^[0-9a-f]{32}$")
MAX_LONG_SIDE = 960
JPEG_QUALITY = 80
WATERMARK = "SIMULATED - PehRadar demo - operator review required"
COLOURS = {"fire": (0, 69, 255), "smoke": (200, 200, 200)}  # BGR
DEFAULT_COLOUR = (0, 255, 255)


class EvidenceStore:
    def __init__(self, directory: str | Path | None = None, max_files: int = 20):
        self.directory = Path(directory or Path(tempfile.gettempdir()) / "pehradar-evidence")
        self.max_files = max_files

    def save(self, frame_bgr: np.ndarray, detections: list[Detection], caption: str) -> str:
        self.directory.mkdir(parents=True, exist_ok=True)
        image = annotate(frame_bgr, detections, caption)
        ok, jpeg = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY])
        if not ok:
            raise RuntimeError("Could not encode evidence JPEG")
        evidence_id = uuid.uuid4().hex
        (self.directory / f"{evidence_id}.jpg").write_bytes(jpeg.tobytes())
        self._prune()
        return evidence_id

    def path_for(self, evidence_id: str) -> Path | None:
        if not EVIDENCE_ID.fullmatch(evidence_id):
            return None
        path = self.directory / f"{evidence_id}.jpg"
        return path if path.is_file() else None

    def _prune(self) -> None:
        files = sorted(self.directory.glob("*.jpg"), key=lambda p: p.stat().st_mtime, reverse=True)
        for old in files[self.max_files :]:
            old.unlink(missing_ok=True)


def annotate(frame_bgr: np.ndarray, detections: list[Detection], caption: str) -> np.ndarray:
    height, width = frame_bgr.shape[:2]
    scale = min(1.0, MAX_LONG_SIDE / max(height, width))
    image = cv2.resize(frame_bgr, (round(width * scale), round(height * scale)), cv2.INTER_AREA)
    h, w = image.shape[:2]
    for det in detections:
        colour = COLOURS.get(det.label, DEFAULT_COLOUR)
        bx1, by1, bx2, by2 = det.box
        x1, y1, x2, y2 = round(bx1 * w), round(by1 * h), round(bx2 * w), round(by2 * h)
        cv2.rectangle(image, (x1, y1), (x2, y2), colour, 2)
        cv2.putText(
            image,
            f"{det.label} {det.confidence:.2f}",
            (x1 + 2, max(y1 - 6, 14)),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.5,
            colour,
            1,
            cv2.LINE_AA,
        )
    banner = np.zeros((40, w, 3), dtype=np.uint8)
    for row, text in enumerate((WATERMARK, caption)):
        cv2.putText(
            banner,
            text[:110],
            (6, 15 + row * 17),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.42,
            (255, 255, 255),
            1,
            cv2.LINE_AA,
        )
    return np.vstack([banner, image])
