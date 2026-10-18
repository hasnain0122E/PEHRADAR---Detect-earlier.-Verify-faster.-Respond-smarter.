"""Operational workflow: detection → operator review → incident → station → status updates.

Each public function runs inside the caller's session and commits once. Rows being reviewed or
updated are locked (SELECT ... FOR UPDATE on PostgreSQL); the UNIQUE constraints on
incident.detection_event_id and (incident_id, seq) are the last line of defence against races.
"""

from datetime import datetime, timedelta

from sqlalchemy import delete, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db import utc_now
from app.domain.incident_rules import (
    CAMERA_STATUSES,
    OPERATOR_TARGETS,
    STATION_STATUSES,
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


MERGE_MESSAGE = "Additional detection received from same camera"


def confirm_detection(
    session: Session,
    detection_id: str,
    operator: str | None,
    note: str | None,
    merge_window_min: float = 0,
) -> tuple[Incident, bool]:
    """Confirms a pending detection. Returns (incident, merged).

    Merge rule (M6B): when an active incident exists for the same camera, both belong to the
    fire-response family (fire, smoke, fire_smoke), and the new detection is within
    `merge_window_min` of that incident's latest detection, no new incident is created; the
    detection joins the existing incident with a timeline event. The incident keeps its original
    event type, severity, station and route."""
    detection = _pending_detection(session, detection_id)
    camera = detection.camera
    now = utc_now()
    detection.review_status, detection.reviewed_at = "confirmed", now
    detection.reviewed_by, detection.review_note = operator, note

    target = _merge_target(session, detection, merge_window_min)
    if target is not None:
        _log(
            target,
            "detection_merged",
            "operator",
            f"{MERGE_MESSAGE} (confidence {detection.confidence:.2f}). "
            "Confirmed by the operator; no new incident created",
            {
                "detection_event_id": detection.id,
                "confidence": detection.confidence,
                "detected_at": detection.detected_at.isoformat(),
                "note": note,
            },
            actor_label=operator,
        )
        _commit(session, "DETECTION_ALREADY_REVIEWED", "This detection was already reviewed")
        return target, True

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
    _select_units(session, incident)
    _commit(session, "DETECTION_ALREADY_REVIEWED", "This detection was already reviewed")
    return incident, False


def latest_detection_at(incident: Incident) -> datetime:
    """The incident's own detection time or the newest detection merged into it."""
    times = [incident.detection.detected_at]
    for event in incident.timeline:
        if event.event_type == "detection_merged" and event.details.get("detected_at"):
            times.append(datetime.fromisoformat(event.details["detected_at"]))
    return max(times)


# Detections that describe the same fire on one camera: smoke, flames, or both.
FIRE_RESPONSE_FAMILY = frozenset({"fire", "smoke", "fire_smoke"})


def _merge_target(
    session: Session, detection: DetectionEvent, window_min: float
) -> Incident | None:
    if window_min <= 0 or detection.event_type not in FIRE_RESPONSE_FAMILY:
        return None
    candidates = session.scalars(
        select(Incident)
        .where(
            Incident.camera_id == detection.camera_id,
            Incident.event_type.in_(tuple(FIRE_RESPONSE_FAMILY)),
            Incident.status.not_in(tuple(TERMINAL)),
        )
        .order_by(Incident.created_at.desc())
    ).all()
    window = timedelta(minutes=window_min)
    for incident in candidates:
        if abs(detection.detected_at - latest_detection_at(incident)) <= window:
            return incident
    return None


def pending_duplicate(
    session: Session, camera_id: str, event_type: str, window_min: float, now: datetime
) -> DetectionEvent | None:
    """A pending detection on the same camera with the same event type inside the merge window.
    The scenario engine attaches to it instead of raising a second alert for the same event."""
    if window_min <= 0:
        return None
    return session.scalar(
        select(DetectionEvent)
        .where(
            DetectionEvent.camera_id == camera_id,
            DetectionEvent.event_type == event_type,
            DetectionEvent.review_status == "pending",
            DetectionEvent.detected_at >= now - timedelta(minutes=window_min),
        )
        .order_by(DetectionEvent.detected_at.desc())
        .limit(1)
    )


def set_camera_status(session: Session, camera_ids: list[str] | None, status: str) -> int:
    """Demo network simulation: marks nodes active, offline or maintenance (None = every node)."""
    if status not in CAMERA_STATUSES:
        raise OperationError(422, "VALIDATION_ERROR", f"Unknown camera status {status}")
    query = update(Camera).values(status=status, updated_at=utc_now())
    if camera_ids is not None:
        query = query.where(Camera.id.in_(camera_ids))
    changed = session.execute(query).rowcount
    session.commit()
    return changed


def set_station_status(session: Session, station_id: str, status: str) -> FireStation:
    """Demo availability toggle; never a claim about real-world availability."""
    if status not in STATION_STATUSES:
        raise OperationError(422, "VALIDATION_ERROR", f"Unknown station status {status}")
    station = session.get(FireStation, station_id)
    if station is None:
        raise OperationError(404, "NOT_FOUND", "Fire station not found")
    station.status = status
    session.commit()
    return station


def attach_route(session: Session, incident_id: str, provider: RouteProvider | None) -> None:
    """Suggested road routes from every selected response facility to the incident (M5: fire;
    M6C: also ambulance and police), stored on the incident.

    Runs after the confirmation has committed, so a routing failure can never undo or block the
    incident. Each unit is routed on its own: a failure falls back to that unit's straight-line
    distance, records why, and never affects the other units. Requests are sequential (the
    public OSRM server allows about one request per second)."""
    incident = session.get(Incident, incident_id)
    if incident is None:
        return
    if incident.station is not None and incident.route is None:
        incident.route = _road_route(provider, incident.station, incident)
        _log_route(incident, "fire", incident.station, incident.route)
    units = dict(incident.response_units or {})
    for unit in ("ambulance", "police"):
        entry = units.get(unit)
        if not entry or entry.get("route") is not None:
            continue
        facility = session.get(FireStation, entry["facility_id"])
        if facility is None:
            continue
        route = _road_route(provider, facility, incident)
        units[unit] = {**entry, "route": route}
        _log_route(incident, unit, facility, route)
    incident.response_units = units or None
    _commit(session, "CONCURRENT_UPDATE", "The incident was changed concurrently")


def _road_route(provider: RouteProvider | None, facility: FireStation, incident: Incident) -> dict:
    origin = (facility.latitude, facility.longitude)
    destination = (incident.latitude, incident.longitude)
    now = utc_now()
    straight = straight_line_km(origin, destination)
    if provider is None:
        reason = "Routing is disabled on this server"
    else:
        try:
            route = provider.route(origin, destination)
        except RoutingError as exc:
            reason = str(exc)
        except Exception as exc:  # never let one unit's route break the others
            reason = f"Routing failed: {type(exc).__name__}"
        else:
            return {
                "status": "ok",
                "provider": route.provider,
                "profile": route.profile,
                "from_station_id": facility.id,
                "distance_km": route.distance_km,
                "duration_min": route.duration_min,
                "straight_line_km": straight,
                "geometry": {"type": "LineString", "coordinates": route.coordinates},
                "generated_at": now.isoformat(),
                "is_estimate": True,
                "note": ROUTE_NOTE,
            }
    return {
        "status": "unavailable",
        "provider": provider.name if provider else None,
        "from_station_id": facility.id,
        "reason": reason,
        "fallback": "straight_line",
        "straight_line_km": straight,
        "generated_at": now.isoformat(),
        "is_estimate": True,
        "note": FALLBACK_NOTE,
    }


UNIT_NAME = {"fire": "Fire", "ambulance": "Ambulance", "police": "Police"}


def _log_route(incident: Incident, unit: str, facility: FireStation, route: dict) -> None:
    # Fire keeps its M5 wording; ambulance and police name their unit.
    lead = "Suggested response route" if unit == "fire" else f"{UNIT_NAME[unit]} route"
    if route["status"] == "ok":
        _log(
            incident,
            "route_generated",
            "system",
            f"{lead} from {facility.name}: {route['distance_km']} km by road, about "
            f"{route['duration_min']:.0f} min ({route['provider']} estimate; not a dispatch)",
            {
                "unit": unit,
                "provider": route["provider"],
                "distance_km": route["distance_km"],
                "duration_min": route["duration_min"],
            },
        )
    else:
        prefix = "Road route" if unit == "fire" else f"{UNIT_NAME[unit]} road route"
        _log(
            incident,
            "route_unavailable",
            "system",
            f"{prefix} unavailable ({route['reason']}); straight-line distance "
            f"{route['straight_line_km']} km shown instead",
            {
                "unit": unit,
                "reason": route["reason"],
                "straight_line_km": route["straight_line_km"],
            },
        )


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
    stations = session.scalars(select(FireStation).where(FireStation.category == "fire")).all()
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


UNIT_FACILITY = {"ambulance": "ambulance response facility", "police": "police station"}


def _select_units(session: Session, incident: Incident) -> None:
    """M6C: the nearest available ambulance and police facilities, chosen exactly like the fire
    station (straight-line distance, demo availability flag). Never a dispatch."""
    units: dict[str, dict] = {}
    for unit in ("ambulance", "police"):
        facilities = session.scalars(select(FireStation).where(FireStation.category == unit))
        choice = nearest_available_station(incident.latitude, incident.longitude, facilities)
        if choice is None:
            _log(
                incident,
                "no_resource_available",
                "system",
                f"No {UNIT_FACILITY[unit]} is marked available; none suggested",
                {"unit": unit, "method": STATION_METHOD},
            )
            continue
        facility: FireStation = choice.station  # type: ignore[assignment]
        distance = round(choice.distance_km, 2)
        units[unit] = {
            "facility_id": facility.id,
            "distance_km": distance,
            "method": STATION_METHOD,
            "reason": f"Nearest {UNIT_FACILITY[unit]} marked available (straight-line distance)",
            "route": None,
        }
        _log(
            incident,
            "resource_selected",
            "system",
            f"{UNIT_NAME[unit]} resource: {facility.name}, {distance} km straight-line "
            "(availability not verified; not a dispatch)",
            {"unit": unit, "station_id": facility.id, "distance_km": distance},
        )
    incident.response_units = units or None


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
    normal review or timeline record, and upload-created data is never touched. Closed
    incidents stay in history; the live map shows only active ones. Demo status changes (nodes
    taken offline, facilities marked unavailable) are restored."""
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
    # M6C: demo status changes (simulated outages, facility availability) are undone too.
    cameras = session.execute(
        update(Camera).where(Camera.status != "active").values(status="active")
    ).rowcount
    facilities = session.execute(
        update(FireStation).where(FireStation.status != "available").values(status="available")
    ).rowcount
    _commit(session, "CONCURRENT_UPDATE", "Demo data changed concurrently; retry the reset")
    return {
        "runs_cancelled": len(runs),
        "detections_closed": len(pending),
        "incidents_closed": len(incidents),
        "cameras_restored": cameras,
        "stations_restored": facilities,
    }


def full_reset(session: Session) -> dict[str, int]:
    """Full demo clear (the UI asks for explicit confirmation): deletes every detection,
    incident, timeline event and scenario run, puts every node back online and every station
    back to available. Seeded cameras, stations and demo feeds are kept."""
    counts = {
        "timeline_events_deleted": session.execute(delete(IncidentTimelineEvent)).rowcount,
        "incidents_deleted": session.execute(delete(Incident)).rowcount,
        "scenario_runs_deleted": session.execute(delete(ScenarioRun)).rowcount,
        "detections_deleted": session.execute(delete(DetectionEvent)).rowcount,
    }
    counts["cameras_restored"] = session.execute(
        update(Camera).where(Camera.status != "active").values(status="active")
    ).rowcount
    counts["stations_restored"] = session.execute(
        update(FireStation).where(FireStation.status != "available").values(status="available")
    ).rowcount
    _commit(session, "CONCURRENT_UPDATE", "Demo data changed concurrently; retry the reset")
    return counts
