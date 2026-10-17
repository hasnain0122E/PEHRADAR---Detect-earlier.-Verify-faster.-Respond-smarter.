"""POST /detect/fire (MP4 → fire/smoke result) and GET /detect/evidence/{id}.jpg.

Decision support only: every result needs operator review. Upload guards: app.routers.uploads.
"""

import logging
import threading
from collections.abc import Callable

from fastapi import APIRouter, Request
from fastapi.responses import FileResponse, JSONResponse
from sqlalchemy.orm import Session, sessionmaker

from app.config import Settings
from app.detection.evidence import EvidenceStore
from app.detection.fire_model import ModelUnavailable
from app.detection.fire_pipeline import Detector
from app.detection.video import VideoError
from app.domain.fire_decision import DecisionRule
from app.models import Camera
from app.routers.security import operator_error
from app.routers.uploads import error_response, handle_mp4_upload
from app.services import fire_detection
from app.services.fire_detection import DISCLAIMER  # noqa: F401  (re-exported)

logger = logging.getLogger("uvicorn.error")


class ModelProvider:
    """Loads the detector once, on first use, and caches the result (or the failure)."""

    def __init__(self, loader: Callable[[], Detector]):
        self._loader = loader
        self._lock = threading.Lock()
        self._model: Detector | None = None
        self._error: str | None = None

    def get(self) -> Detector:
        with self._lock:
            if self._model is None and self._error is None:
                try:
                    self._model = self._loader()
                    logger.info("Fire/smoke model loaded: %s", self._model.name)
                except ModelUnavailable as exc:
                    self._error = str(exc)
                    logger.error("Fire/smoke model unavailable: %s", exc)
            if self._model is None:
                raise ModelUnavailable(self._error or "Model not loaded")
            return self._model


def decision_rule(settings: Settings) -> DecisionRule:
    return DecisionRule(
        conf_threshold=settings.detect_conf_threshold,
        min_positive_frames=settings.detect_min_positive_frames,
        window_frames=settings.detect_window_frames,
        single_frame_confidence=settings.detect_single_frame_confidence,
    )


def build_router(
    settings: Settings,
    models: ModelProvider,
    evidence: EvidenceStore,
    sessions: sessionmaker[Session],
) -> APIRouter:
    router = APIRouter()
    rule = decision_rule(settings)

    def process(request: Request, path: str, size: int, fields: dict[str, str]) -> JSONResponse:
        camera_id = (fields.get("camera_id") or "").strip() or None
        with sessions() as session:
            camera = None
            if camera_id:
                # Linking a detection to a camera writes to the database: operator-only.
                if denied := operator_error(request, settings):
                    return denied
                camera = session.get(Camera, camera_id)
                if camera is None:
                    return error_response(404, "CAMERA_NOT_FOUND", "Camera not found")
            try:
                model = models.get()
            except ModelUnavailable:
                return error_response(
                    503, "MODEL_UNAVAILABLE", "The detection model is not available"
                )
            try:
                body = fire_detection.detect_clip(
                    session,
                    camera,
                    path,
                    size,
                    model,
                    rule,
                    settings.video_sample_fps,
                    settings.video_max_seconds,
                    evidence,
                )
            except VideoError:
                raise  # mapped to 422 by the upload handler
            except Exception:
                logger.exception("Fire/smoke inference failed")
                return error_response(500, "INFERENCE_FAILED", "Detection failed; see server logs")
            return JSONResponse(body)

    @router.post("/detect/fire")
    async def detect_fire(request: Request):
        return await handle_mp4_upload(
            request,
            settings.max_upload_mb,
            lambda path, size, fields: process(request, path, size, fields),
        )

    @router.get("/detect/evidence/{evidence_id}.jpg")
    def get_evidence(evidence_id: str):
        path = evidence.path_for(evidence_id)
        if path is None:
            return error_response(404, "NOT_FOUND", "Evidence frame not found or expired")
        return FileResponse(path, media_type="image/jpeg", headers={"Cache-Control": "private"})

    return router
