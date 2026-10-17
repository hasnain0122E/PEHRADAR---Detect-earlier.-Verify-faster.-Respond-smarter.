"""Shared detection path for uploads (POST /detect/fire) and the M5 scenario engine.

Both run the real detector on a clip and, when a camera is given and the temporal rule confirms
fire or smoke, store a pending DetectionEvent. Neither ever creates an incident.
"""

from pathlib import Path

from sqlalchemy.orm import Session

from app.detection.evidence import EvidenceStore
from app.detection.fire_pipeline import Detector, FireAnalysis, analyze_video
from app.domain.fire_decision import DecisionRule
from app.models import Camera
from app.routers.serializers import camera_json, evidence_url
from app.services import operations

DISCLAIMER = "Decision support only. A human operator must review this result."


def detect_clip(
    session: Session,
    camera: Camera | None,
    path: str | Path,
    size: int,
    model: Detector,
    rule: DecisionRule,
    sample_fps: float,
    max_seconds: float,
    evidence: EvidenceStore,
) -> dict:
    """Runs the detector and returns the /detect/fire response body. Raises VideoError for
    unreadable clips and propagates detector failures to the caller."""
    body, result = analyze(path, size, model, rule, sample_fps, max_seconds, evidence)
    body["camera"] = camera_json(camera) if camera else None
    body["detection_event_id"] = None
    if camera is not None and body["status"] == "detected":
        record_pending(session, camera, body, result, model.name, rule, evidence)
    return body


def analyze(
    path: str | Path,
    size: int,
    model: Detector,
    rule: DecisionRule,
    sample_fps: float,
    max_seconds: float,
    evidence: EvidenceStore,
) -> tuple[dict, FireAnalysis]:
    result = analyze_video(path, model, rule, sample_fps, max_seconds, evidence)
    return result_json(result, model.name, rule, size), result


def record_pending(
    session: Session,
    camera: Camera,
    body: dict,
    result: FireAnalysis,
    model_name: str,
    rule: DecisionRule,
    evidence: EvidenceStore,
    source: dict | None = None,
) -> str:
    """Stores a confirmed result as a pending DetectionEvent (operator review required) and
    updates `body` with its id. Returns the detection id."""
    details = detection_details(body)
    details["source"] = source or {"kind": "upload"}
    detection = operations.record_detection(
        session,
        camera,
        event_type=result.event_type,
        confidence=body["confidence"],
        model=model_name,
        threshold=rule.conf_threshold,
        evidence_timestamp_s=result.evidence_offset_s,
        evidence_jpeg=evidence_bytes(evidence, result.evidence_id),
        details=details,
    )
    body["camera"] = camera_json(camera)
    body["detection_event_id"] = detection.id
    body["review_status"] = detection.review_status
    if body["evidence"] is not None and detection.evidence_jpeg:
        body["evidence"]["url"] = evidence_url(detection)
    return detection.id


def evidence_bytes(evidence: EvidenceStore, evidence_id: str | None) -> bytes | None:
    path = evidence.path_for(evidence_id) if evidence_id else None
    return path.read_bytes() if path else None


def detection_details(body: dict) -> dict:
    keys = ("classes", "sampled_frames", "positive_frames", "processing_seconds", "rule", "video")
    details = {k: body[k] for k in keys}
    details["boxes"] = body["evidence"]["boxes"] if body["evidence"] else []
    return details


def result_json(result, model_name: str, rule: DecisionRule, size: int) -> dict:
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
