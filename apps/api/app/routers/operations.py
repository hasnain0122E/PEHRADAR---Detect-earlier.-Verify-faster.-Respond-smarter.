"""Operational API (M3): cameras, fire stations, detection review, incidents.

Reads are public (demo data, simulated cameras). Writes need X-Operator-Key (routers.security).
M5: confirmation also stores a suggested road route (app.routing) with a straight-line fallback.
"""

from typing import Literal

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.config import Settings
from app.db import DbSession
from app.models import Camera, DetectionEvent, FireStation, Incident
from app.routers.security import operator_error
from app.routers.serializers import camera_json, detection_json, incident_json, station_json
from app.routers.uploads import error_response
from app.routing import RouteProvider
from app.services import operations
from app.services.operations import OperationError


class ReviewBody(BaseModel):
    operator: str | None = Field(default=None, max_length=80)
    note: str | None = Field(default=None, max_length=1000)


class CameraStatusBody(BaseModel):
    status: Literal["active", "offline", "maintenance"]
    # Neither set: every node. Otherwise the listed camera ids, or every node in `district`.
    camera_ids: list[str] | None = Field(default=None, max_length=500)
    district: str | None = Field(default=None, max_length=60)


class StationStatusBody(BaseModel):
    status: Literal["available", "unavailable"]


class StatusBody(BaseModel):
    status: Literal["notified", "acknowledged", "resolved", "rejected"]
    operator: str | None = Field(default=None, max_length=80)
    note: str | None = Field(default=None, max_length=1000)


def _has_evidence(session: Session, detection_ids: list[str]) -> set[str]:
    if not detection_ids:
        return set()
    rows = session.scalars(
        select(DetectionEvent.id).where(
            DetectionEvent.id.in_(detection_ids), DetectionEvent.evidence_jpeg.is_not(None)
        )
    )
    return set(rows)


def _incident_detail(session: Session, incident_id: str) -> Incident | None:
    return session.scalar(
        select(Incident)
        .where(Incident.id == incident_id)
        .options(
            selectinload(Incident.camera),
            selectinload(Incident.detection),
            selectinload(Incident.station),
            selectinload(Incident.timeline),
        )
        .execution_options(populate_existing=True)
    )


def _incident_response(session: Session, incident_id: str) -> dict:
    incident = _incident_detail(session, incident_id)
    with_evidence = _has_evidence(session, [incident.detection_event_id])
    return incident_json(
        incident, detail=True, has_evidence=incident.detection_event_id in with_evidence
    )


def build_router(settings: Settings, route_provider: RouteProvider | None = None) -> APIRouter:
    router = APIRouter()

    # --- cameras and stations ---

    @router.get("/cameras")
    def list_cameras(session: DbSession, department: str | None = None):
        query = select(Camera).order_by(Camera.code)
        if department:
            query = query.where(Camera.department == department)
        return {"items": [camera_json(c) for c in session.scalars(query)]}

    @router.get("/cameras/{camera_id}")
    def get_camera(session: DbSession, camera_id: str):
        camera = session.get(Camera, camera_id)
        if camera is None:
            return error_response(404, "NOT_FOUND", "Camera not found")
        return camera_json(camera)

    @router.post("/cameras/status")
    def simulate_camera_status(session: DbSession, body: CameraStatusBody, request: Request):
        """Demo network simulation (M6B): take nodes offline or bring them back online."""
        if denied := operator_error(request, settings):
            return denied
        ids = body.camera_ids
        if body.district is not None:
            ids = list(session.scalars(select(Camera.id).where(Camera.district == body.district)))
        changed = operations.set_camera_status(session, ids, body.status)
        return {"status": body.status, "cameras_changed": changed}

    @router.post("/fire-stations/{station_id}/status")
    def set_station_status(
        session: DbSession, station_id: str, body: StationStatusBody, request: Request
    ):
        """Demo availability flag only; it changes which station is suggested."""
        if denied := operator_error(request, settings):
            return denied
        try:
            station = operations.set_station_status(session, station_id, body.status)
        except OperationError as exc:
            return error_response(exc.status, exc.code, exc.message)
        return station_json(station)

    @router.get("/fire-stations")
    def list_stations(session: DbSession):
        stations = session.scalars(select(FireStation).order_by(FireStation.code))
        return {"items": [station_json(s) for s in stations]}

    @router.get("/fire-stations/{station_id}")
    def get_station(session: DbSession, station_id: str):
        station = session.get(FireStation, station_id)
        if station is None:
            return error_response(404, "NOT_FOUND", "Fire station not found")
        return station_json(station)

    # --- detections ---

    @router.get("/detections")
    def list_detections(session: DbSession, review_status: str | None = None):
        query = select(DetectionEvent).order_by(DetectionEvent.created_at.desc()).limit(100)
        if review_status:
            query = query.where(DetectionEvent.review_status == review_status)
        detections = session.scalars(query).all()
        with_evidence = _has_evidence(session, [d.id for d in detections])
        return {"items": [detection_json(d, d.id in with_evidence) for d in detections]}

    @router.get("/detections/{detection_id}")
    def get_detection(session: DbSession, detection_id: str):
        detection = session.get(DetectionEvent, detection_id)
        if detection is None:
            return error_response(404, "NOT_FOUND", "Detection not found")
        return detection_json(detection, bool(_has_evidence(session, [detection.id])))

    @router.get("/detections/{detection_id}/evidence.jpg")
    def get_detection_evidence(session: DbSession, detection_id: str):
        jpeg = session.scalar(
            select(DetectionEvent.evidence_jpeg).where(DetectionEvent.id == detection_id)
        )
        if not jpeg:
            return error_response(404, "NOT_FOUND", "Evidence not found")
        return Response(jpeg, media_type="image/jpeg", headers={"Cache-Control": "private"})

    @router.post("/detections/{detection_id}/confirm")
    def confirm(
        session: DbSession,
        detection_id: str,
        request: Request,
        body: ReviewBody | None = None,
    ):
        if denied := operator_error(request, settings):
            return denied
        body = body or ReviewBody()
        try:
            incident, merged = operations.confirm_detection(
                session, detection_id, body.operator, body.note, settings.incident_merge_window_min
            )
        except OperationError as exc:
            return error_response(exc.status, exc.code, exc.message, **exc.details)
        if merged:
            # Joined an open incident, which already has its station and route.
            return _incident_response(session, incident.id)
        try:
            # After the incident is committed: a routing problem can never undo the confirmation.
            operations.attach_route(session, incident.id, route_provider)
        except OperationError:
            session.rollback()
        return _incident_response(session, incident.id)

    @router.post("/detections/{detection_id}/reject")
    def reject(
        session: DbSession,
        detection_id: str,
        request: Request,
        body: ReviewBody | None = None,
    ):
        if denied := operator_error(request, settings):
            return denied
        body = body or ReviewBody()
        try:
            detection = operations.reject_detection(session, detection_id, body.operator, body.note)
        except OperationError as exc:
            return error_response(exc.status, exc.code, exc.message, **exc.details)
        return detection_json(detection, bool(_has_evidence(session, [detection.id])))

    # --- incidents ---

    @router.get("/incidents")
    def list_incidents(
        session: DbSession,
        status: str | None = None,
        event_type: str | None = None,
    ):
        query = (
            select(Incident)
            .order_by(Incident.created_at.desc())
            .limit(100)
            .options(selectinload(Incident.camera), selectinload(Incident.station))
        )
        if status:
            query = query.where(Incident.status == status)
        if event_type:
            query = query.where(Incident.event_type == event_type)
        incidents = session.scalars(query).all()
        with_evidence = _has_evidence(session, [i.detection_event_id for i in incidents])
        return {
            "items": [
                incident_json(i, detail=False, has_evidence=i.detection_event_id in with_evidence)
                for i in incidents
            ]
        }

    @router.get("/incidents/{incident_id}")
    def get_incident(session: DbSession, incident_id: str):
        if _incident_detail(session, incident_id) is None:
            return error_response(404, "NOT_FOUND", "Incident not found")
        return _incident_response(session, incident_id)

    @router.patch("/incidents/{incident_id}/status")
    def update_status(
        session: DbSession,
        incident_id: str,
        body: StatusBody,
        request: Request,
    ):
        if denied := operator_error(request, settings):
            return denied
        try:
            operations.change_incident_status(
                session, incident_id, body.status, body.operator, body.note
            )
        except OperationError as exc:
            return error_response(exc.status, exc.code, exc.message, **exc.details)
        return _incident_response(session, incident_id)

    return router
