"""Operational workflow: detection → operator review → incident → station → status updates.

Each public function runs inside the caller's session and commits once. Rows being reviewed or
updated are locked (SELECT ... FOR UPDATE on PostgreSQL); the UNIQUE constraints on
incident.detection_event_id and (incident_id, seq) are the last line of defence against races.
"""

from datetime import datetime

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db import utc_now
from app.domain.incident_rules import (
    OPERATOR_TARGETS,
    TERMINAL,
    can_transition,
    nearest_available_station,
    severity_for,
)
from app.models import (
    Camera,
    DetectionEvent,
    FireStation,
    Incident,
    IncidentTimelineEvent,
    ScenarioRun,
)
from app.routing import RouteProvider, RoutingError, straight_line_km

STATION_METHOD = "straight_line_haversine"
STATION_NOTE = (
    "Geographic proximity only: straight-line distance, not a driving route or ETA. "
    "Station availability is a demo flag and does not mean the station can respond."
)


ROUTE_NOTE = (
    "Suggested response route. Road distance and travel time are estimates from OpenStreetMap "
    "routing. Not a dispatch confirmation."
)
FALLBACK_NOTE = (
    "Road route unavailable; showing straight-line distance only. Not a dispatch confirmation."
)


class OperationError(Exception):
    def __init__(self, status: int, code: str, message: str, **details):
        super().__init__(message)
        self.status, self.code, self.message, self.details = status, code, message, details


def record_detection(
    session: Session,
    camera: Camera,
    *,
    event_type: str,
    confidence: float,
    model: str,
    threshold: float,
    evidence_timestamp_s: float | None,
    evidence_jpeg: bytes | None,
    details: dict,
    detected_at: datetime | None = None,
) -> DetectionEvent:
    detection = DetectionEvent(
        camera_id=camera.id,
        event_type=event_type,
        confidence=confidence,
        model=model,
        threshold=threshold,
        evidence_timestamp_s=evidence_timestamp_s,
        evidence_jpeg=evidence_jpeg,
        details=details,
        detected_at=detected_at or utc_now(),
        review_status="pending",
        is_simulated=camera.is_simulated,
    )
    session.add(detection)
    session.commit()
    return detection


def confirm_detection(
    session: Session, detection_id: str, operator: str | None, note: str | None
) -> Incident:
    detection = _pending_detection(session, detection_id)
    camera = detection.camera
    now = utc_now()
    detection.review_status, detection.reviewed_at = "confirmed", now
    detection.reviewed_by, detection.review_note = operator, note

    incident = Incident(
        camera_id=camera.id,
        detection_event_id=detection.id,
        event_type=detection.event_type,
        severity=severity_for(detection.event_type, detection.confidence),
        status="confirmed",
        latitude=camera.latitude,
        longitude=camera.longitude,
        confirmed_by=operator,
        confirmed_at=now,
        is_simulated=detection.is_simulated,
    )
    session.add(incident)
    _log(
        incident,
        "detection_created",
        "system",
        f"{detection.event_type} detected on {camera.code} by {detection.model} "
        f"(confidence {detection.confidence:.2f})",
        {"detection_event_id": detection.id, "confidence": detection.confidence},
        occurred_at=detection.detected_at,
    )
    _log(
        incident,
        "operator_confirmed",
        "operator",
        f"Operator confirmed the detection; incident created with severity {incident.severity}",
        {"severity": incident.severity, "note": note},
        actor_label=operator,
    )
    _select_station(session, incident)
    _commit(session, "DETECTION_ALREADY_REVIEWED", "This detection was already reviewed")
    return incident


def attach_route(session: Session, incident_id: str, provider: RouteProvider | None) -> None:
    """Suggested road route from the candidate station to the incident, stored on the incident.

    Runs after the confirmation has committed, so a routing failure can never undo or block the
    incident: it falls back to the straight-line distance and records why."""
    incident = session.get(Incident, incident_id)
    if incident is None or incident.station is None:
        return
    station = incident.station
    origin, destination = (
        (station.latitude, station.longitude),
        (incident.latitude, incident.longitude),
    )
    now = utc_now()
    straight = straight_line_km(origin, destination)
    if provider is None:
        reason = "Routing is disabled on this server"
    else:
        try:
            route = provider.route(origin, destination)
        except RoutingError as exc:
            reason = str(exc)
        else:
            incident.route = {
                "status": "ok",
                "provider": route.provider,
                "profile": route.profile,
                "from_station_id": station.id,
                "distance_km": route.distance_km,
                "duration_min": route.duration_min,
                "straight_line_km": straight,
                "geometry": {"type": "LineString", "coordinates": route.coordinates},
                "generated_at": now.isoformat(),
                "is_estimate": True,
                "note": ROUTE_NOTE,
            }
            _log(
                incident,
                "route_generated",
                "system",
                f"Suggested response route from {station.name}: {route.distance_km} km by road, "
                f"about {route.duration_min:.0f} min ({route.provider} estimate; not a dispatch)",
                {
                    "provider": route.provider,
                    "distance_km": route.distance_km,
                    "duration_min": route.duration_min,
                },
            )
            _commit(session, "CONCURRENT_UPDATE", "The incident was changed concurrently")
            return
    incident.route = {
        "status": "unavailable",
        "provider": provider.name if provider else None,
        "from_station_id": station.id,
        "reason": reason,
        "fallback": "straight_line",
        "straight_line_km": straight,
        "generated_at": now.isoformat(),
        "is_estimate": True,
        "note": FALLBACK_NOTE,
    }
    _log(
        incident,
        "route_unavailable",
        "system",
        f"Road route unavailable ({reason}); straight-line distance {straight} km shown instead",
        {"reason": reason, "straight_line_km": straight},
    )
    _commit(session, "CONCURRENT_UPDATE", "The incident was changed concurrently")


def reject_detection(
    session: Session, detection_id: str, operator: str | None, note: str | None
) -> DetectionEvent:
    detection = _pending_detection(session, detection_id)
    detection.review_status, detection.reviewed_at = "rejected", utc_now()
    detection.reviewed_by, detection.review_note = operator, note
    # No incident and therefore no timeline: the review record stays on the detection row.
    _commit(session, "DETECTION_ALREADY_REVIEWED", "This detection was already reviewed")
    return detection


def change_incident_status(
    session: Session, incident_id: str, target: str, operator: str | None, note: str | None
) -> Incident:
    incident = session.get(Incident, incident_id, with_for_update=True)
    if incident is None:
        raise OperationError(404, "NOT_FOUND", "Incident not found")
    current = incident.status
    if target not in OPERATOR_TARGETS or not can_transition(current, target):
        raise OperationError(
            409,
            "INVALID_STATE_TRANSITION",
            f"Cannot change incident status from {current} to {target}",
            current=current,
            target=target,
        )
    incident.status = target
    if target == "resolved":
        incident.resolved_at = utc_now()
    message = f"Status changed from {current} to {target}"
    if target in ("notified", "acknowledged"):
        message += " (recorded by the operator; PehRadar sent no notification)"
    event_type = target if target in TERMINAL else "status_changed"
    _log(
        incident,
        event_type,
        "operator",
        message,
        {"from": current, "to": target, "note": note},
        actor_label=operator,
    )
    _commit(session, "CONCURRENT_UPDATE", "The incident was changed concurrently; retry")
    return incident


def _pending_detection(session: Session, detection_id: str) -> DetectionEvent:
    detection = session.get(DetectionEvent, detection_id, with_for_update=True)
    if detection is None:
        raise OperationError(404, "NOT_FOUND", "Detection not found")
    if detection.review_status != "pending":
        incident_id = session.scalar(
            select(Incident.id).where(Incident.detection_event_id == detection.id)
        )
        raise OperationError(
            409,
            "DETECTION_ALREADY_REVIEWED",
            f"Detection was already {detection.review_status}",
            review_status=detection.review_status,
            incident_id=incident_id,
        )
    return detection


def _select_station(session: Session, incident: Incident) -> None:
    stations = session.scalars(select(FireStation)).all()
    choice = nearest_available_station(incident.latitude, incident.longitude, stations)
    if choice is None:
        _log(
            incident,
            "no_station_available",
            "system",
            "No fire station is marked available; no candidate selected",
            {"method": STATION_METHOD},
        )
        return
    station: FireStation = choice.station  # type: ignore[assignment]
    distance = round(choice.distance_km, 2)
    incident.assigned_station_id, incident.station_distance_km = station.id, distance
    incident.status = "station_selected"
    _log(
        incident,
        "station_selected",
        "system",
        f"Candidate station: {station.name}, {distance} km straight-line "
        "(not a driving ETA; availability not verified)",
        {
            "station_id": station.id,
            "distance_km": distance,
            "method": STATION_METHOD,
            "is_driving_eta": False,
        },
    )


def _log(
    incident: Incident,
    event_type: str,
    actor: str,
    message: str,
    details: dict,
    *,
    actor_label: str | None = None,
    occurred_at: datetime | None = None,
) -> None:
    now = utc_now()
    incident.timeline.append(
        IncidentTimelineEvent(
            seq=len(incident.timeline) + 1,
            event_type=event_type,
            actor=actor,
            actor_label=actor_label,
            message=message,
            details={k: v for k, v in details.items() if v is not None},
            occurred_at=occurred_at or now,
            created_at=now,
        )
    )


def _commit(session: Session, code: str, message: str) -> None:
    try:
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        raise OperationError(409, code, message) from exc


RESET_LABEL = "Demo reset"


def reset_scenario_data(session: Session) -> dict[str, int]:
    """Demo reset: cancels unfinished scenario runs, rejects pending scenario detections and closes
    open incidents that came from scenario detections. Nothing is deleted, every change is a
    normal review or timeline record, and upload-created data is never touched."""
    now = utc_now()
    runs = session.scalars(
        select(ScenarioRun).where(ScenarioRun.status.in_(("scheduled", "running")))
    ).all()
    for run in runs:
        run.status, run.completed_at, run.error = "cancelled", now, "Cancelled by demo reset"
    scenario_detections = select(ScenarioRun.detection_event_id).where(
        ScenarioRun.detection_event_id.is_not(None)
    )
    pending = session.scalars(
        select(DetectionEvent).where(
            DetectionEvent.id.in_(scenario_detections), DetectionEvent.review_status == "pending"
        )
    ).all()
    for detection in pending:
        detection.review_status, detection.reviewed_at = "rejected", now
        detection.reviewed_by = RESET_LABEL
        detection.review_note = "Closed by demo reset (scenario data)"
    incidents = session.scalars(
        select(Incident).where(
            Incident.detection_event_id.in_(scenario_detections),
            Incident.status.not_in(tuple(TERMINAL)),
        )
    ).all()
    for incident in incidents:
        previous = incident.status
        incident.status, incident.resolved_at = "resolved", now
        _log(
            incident,
            "resolved",
            "system",
            "Closed by demo reset: scenario-generated incident, not a real event",
            {"from": previous, "to": "resolved", "reason": "demo_reset"},
            actor_label=RESET_LABEL,
        )
    _commit(session, "CONCURRENT_UPDATE", "Demo data changed concurrently; retry the reset")
    return {
        "runs_cancelled": len(runs),
        "detections_closed": len(pending),
        "incidents_closed": len(incidents),
    }
