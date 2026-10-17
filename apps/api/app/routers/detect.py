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
from app.detection.fire_pipeline import Detector, analyze_video
from app.detection.video import VideoError
from app.domain.fire_decision import DecisionRule
from app.models import Camera
from app.routers.security import operator_error
from app.routers.serializers import camera_json, evidence_url
from app.routers.uploads import error_response, handle_mp4_upload
from app.services import operations

logger = logging.getLogger("uvicorn.error")
DISCLAIMER = "Decision support only. A human operator must review this result."


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
                result = analyze_video(
                    path,
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
            body = _result_json(result, model.name, rule, size)
            body["camera"] = camera_json(camera) if camera else None
            body["detection_event_id"] = None
            if camera is not None and body["status"] == "detected":
                # Pending operator review: never an incident until a human confirms it.
                detection = operations.record_detection(
                    session,
                    camera,
                    event_type=result.event_type,
                    confidence=body["confidence"],
                    model=model.name,
                    threshold=rule.conf_threshold,
                    evidence_timestamp_s=result.evidence_offset_s,
                    evidence_jpeg=_evidence_bytes(evidence, result.evidence_id),
                    details=_detection_details(body),
                )
                body["detection_event_id"] = detection.id
                body["review_status"] = detection.review_status
                if body["evidence"] is not None and detection.evidence_jpeg:
                    body["evidence"]["url"] = evidence_url(detection)
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


def _evidence_bytes(evidence: EvidenceStore, evidence_id: str | None) -> bytes | None:
    path = evidence.path_for(evidence_id) if evidence_id else None
    return path.read_bytes() if path else None


def _detection_details(body: dict) -> dict:
    keys = ("classes", "sampled_frames", "positive_frames", "processing_seconds", "rule", "video")
    details = {k: body[k] for k in keys}
    details["boxes"] = body["evidence"]["boxes"] if body["evidence"] else []
    return details


def _result_json(result, model_name: str, rule: DecisionRule, size: int) -> dict:
    confirmed = [v for v in result.verdicts.values() if v.confirmed]
    confidence = max((v.peak_confidence for v in confirmed), default=0.0)
    return {
        "status": "detected" if confirmed else "not_detected",
        "event_type": result.event_type,
        "confidence": confidence,
        "best_frame_timestamp": result.evidence_offset_s,
        "sampled_frames": result.frames_sampled,
        "positive_frames": result.positive_frames,
        "processing_seconds": result.processing_s,
        "model": model_name,
        "threshold": rule.conf_threshold,
        "rule": rule.describe(),
        "classes": {
            label: {
                "confirmed": v.confirmed,
                "reason": v.reason,
                "positive_frames": v.positive_frames,
                "peak_confidence": v.peak_confidence,
                "peak_timestamp": v.peak_offset_s,
            }
            for label, v in result.verdicts.items()
        },
        "evidence": None
        if result.evidence_id is None
        else {
            "url": f"/api/v1/detect/evidence/{result.evidence_id}.jpg",
            "timestamp": result.evidence_offset_s,
            "boxes": [
                {"label": d.label, "confidence": d.confidence, "box": d.box}
                for d in result.evidence_detections
            ],
        },
        "video": {
            "size_bytes": size,
            "width": result.metadata.width,
            "height": result.metadata.height,
            "fps": result.metadata.fps,
            "duration_s": result.metadata.duration_s,
            "frames_decoded": result.frames_decoded,
        },
        "inference_ms_per_frame": result.inference_ms_per_frame,
        "peak_rss_mb": result.peak_rss_mb,
        "disclaimer": DISCLAIMER,
    }
