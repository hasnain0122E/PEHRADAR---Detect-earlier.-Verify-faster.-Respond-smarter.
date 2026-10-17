"""Plain-dict JSON shapes for the operational API (M3). Kept explicit so the UI contract is
easy to read; Schema.md documents the fields."""

from app.models import Camera, DetectionEvent, FireStation, Incident, IncidentTimelineEvent
from app.services.operations import STATION_METHOD, STATION_NOTE

API = "/api/v1"
STATION_STATUS_NOTE = "Demo availability flag; not real-time station availability."


def _ts(value):
    return value.isoformat() if value is not None else None


def camera_json(c: Camera) -> dict:
    return {
        "id": c.id,
        "code": c.code,
        "name": c.name,
        "latitude": c.latitude,
        "longitude": c.longitude,
        "location_label": c.location_label,
        "department": c.department,
        "status": c.status,
        "is_simulated": c.is_simulated,
        "created_at": _ts(c.created_at),
    }


def station_json(s: FireStation) -> dict:
    return {
        "id": s.id,
        "code": s.code,
        "name": s.name,
        "latitude": s.latitude,
        "longitude": s.longitude,
        "location_label": s.location_label,
        "status": s.status,
        "status_note": STATION_STATUS_NOTE,
        "is_simulated": s.is_simulated,
        "data_source": s.data_source,
        "source_ref": s.source_ref,
        "licence": s.licence,
        "verification_status": s.verification_status,
        "created_at": _ts(s.created_at),
    }


def evidence_url(d: DetectionEvent) -> str:
    return f"{API}/detections/{d.id}/evidence.jpg"


def detection_json(d: DetectionEvent, has_evidence: bool) -> dict:
    return {
        "id": d.id,
        "camera_id": d.camera_id,
        "event_type": d.event_type,
        "confidence": d.confidence,
        "evidence_url": evidence_url(d) if has_evidence else None,
        "evidence_timestamp_s": d.evidence_timestamp_s,
        "detected_at": _ts(d.detected_at),
        "model": d.model,
        "threshold": d.threshold,
        "review_status": d.review_status,
        "reviewed_at": _ts(d.reviewed_at),
        "reviewed_by": d.reviewed_by,
        "review_note": d.review_note,
        "details": d.details,
        "is_simulated": d.is_simulated,
        "created_at": _ts(d.created_at),
    }


def timeline_json(t: IncidentTimelineEvent) -> dict:
    return {
        "id": t.id,
        "seq": t.seq,
        "event_type": t.event_type,
        "actor": t.actor,
        "actor_label": t.actor_label,
        "message": t.message,
        "details": t.details,
        "occurred_at": _ts(t.occurred_at),
        "created_at": _ts(t.created_at),
    }


def station_selection_json(i: Incident) -> dict | None:
    if i.station is None:
        return None
    return {
        "station": station_json(i.station),
        "distance_km": i.station_distance_km,
        "method": STATION_METHOD,
        "is_driving_eta": False,
        "note": STATION_NOTE,
    }


def incident_json(i: Incident, *, detail: bool, has_evidence: bool) -> dict:
    body = {
        "id": i.id,
        "event_type": i.event_type,
        "severity": i.severity,
        "status": i.status,
        "latitude": i.latitude,
        "longitude": i.longitude,
        "camera": camera_json(i.camera),
        "detection_event_id": i.detection_event_id,
        "evidence_url": evidence_url(i.detection) if has_evidence else None,
        "assigned_station_id": i.assigned_station_id,
        "station_selection": station_selection_json(i),
        "confirmed_by": i.confirmed_by,
        "confirmed_at": _ts(i.confirmed_at),
        "resolved_at": _ts(i.resolved_at),
        "is_simulated": i.is_simulated,
        "created_at": _ts(i.created_at),
        "updated_at": _ts(i.updated_at),
    }
    if detail:
        body["detection"] = detection_json(i.detection, has_evidence)
        body["timeline"] = [timeline_json(t) for t in i.timeline]
    return body
