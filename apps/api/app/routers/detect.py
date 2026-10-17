"""POST /detect/fire (MP4 → fire/smoke result) and GET /detect/evidence/{id}.jpg.

Decision support only: every result needs operator review. Upload guards: app.routers.uploads.
"""

import logging
import threading
from collections.abc import Callable

from fastapi import APIRouter, Request
from fastapi.responses import FileResponse, JSONResponse

from app.config import Settings
from app.detection.evidence import EvidenceStore
from app.detection.fire_model import ModelUnavailable
from app.detection.fire_pipeline import Detector, analyze_video
from app.detection.video import VideoError
from app.domain.fire_decision import DecisionRule
from app.routers.uploads import error_response, handle_mp4_upload

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


def build_router(settings: Settings, models: ModelProvider, evidence: EvidenceStore) -> APIRouter:
    router = APIRouter()
    rule = decision_rule(settings)

    def process(path: str, size: int) -> JSONResponse:
        try:
            model = models.get()
        except ModelUnavailable:
            return error_response(503, "MODEL_UNAVAILABLE", "The detection model is not available")
        try:
            result = analyze_video(
                path, model, rule, settings.video_sample_fps, settings.video_max_seconds, evidence
            )
        except VideoError:
            raise  # mapped to 422 by the upload handler
        except Exception:
            logger.exception("Fire/smoke inference failed")
            return error_response(500, "INFERENCE_FAILED", "Detection failed; see server logs")
        return JSONResponse(_result_json(result, model.name, rule, size))

    @router.post("/detect/fire")
    async def detect_fire(request: Request):
        return await handle_mp4_upload(request, settings.max_upload_mb, process)

    @router.get("/detect/evidence/{evidence_id}.jpg")
    def get_evidence(evidence_id: str):
        path = evidence.path_for(evidence_id)
        if path is None:
            return error_response(404, "NOT_FOUND", "Evidence frame not found or expired")
        return FileResponse(path, media_type="image/jpeg", headers={"Cache-Control": "private"})

    return router


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
