"""Incident vocabulary, state machine, severity rule and station proximity. Pure, no I/O.

Incident state machine (M3). Incidents are created only when an operator confirms a detection,
so they start at `confirmed`; `detected` is reserved for the pre-review stage, which is held by
DetectionEvent.review_status = pending.

    confirmed ──(station chosen)──▶ station_selected ──▶ notified ──▶ acknowledged ──▶ resolved
        │                                │                   │              │
        └──────────── resolved / rejected (false alarm) ─────┴──────────────┘

`notified` and `acknowledged` are operator-recorded in M3: PehRadar sends no notification yet.
`resolved` and `rejected` are terminal.
"""

import math
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Protocol

CAMERA_STATUSES = ("active", "offline", "maintenance")
# M5 provenance. public_live: a lawful public stream; verified_mapped: a camera location mapped in
# a public dataset (no feed); simulated_coverage: a PehRadar placeholder, not a camera;
# demo_stream: a simulated node looping licensed sample footage.
CAMERA_SOURCE_TYPES = ("public_live", "verified_mapped", "simulated_coverage", "demo_stream")
STREAM_TYPES = ("hls", "mjpeg", "mp4_loop", "none")
STATION_STATUSES = ("available", "unavailable")
FACILITY_TYPES = (
    "municipal_fire_station",
    "port_fire_station",
    "airport_fire_station",
    "industrial_fire_station",
    "rescue_station",
    "institutional_fire_response",
    "fire_station_unclassified",
)
SCENARIO_RUN_STATUSES = ("scheduled", "running", "detected", "not_detected", "failed", "cancelled")
DETECTION_EVENT_TYPES = ("fire", "smoke", "fire_smoke")
REVIEW_STATUSES = ("pending", "confirmed", "rejected")
SEVERITIES = ("low", "medium", "high")
INCIDENT_STATUSES = (
    "detected",
    "confirmed",
    "station_selected",
    "notified",
    "acknowledged",
    "resolved",
    "rejected",
)
TIMELINE_EVENT_TYPES = (
    "detection_created",
    "operator_confirmed",
    "station_selected",
    "no_station_available",
    "route_generated",
    "route_unavailable",
    "status_changed",
    "resolved",
    "rejected",
)
TIMELINE_ACTORS = ("system", "operator")

TERMINAL = frozenset({"resolved", "rejected"})
TRANSITIONS: dict[str, frozenset[str]] = {
    "detected": frozenset({"confirmed", "rejected"}),
    "confirmed": frozenset({"station_selected", "resolved", "rejected"}),
    "station_selected": frozenset({"notified", "resolved", "rejected"}),
    "notified": frozenset({"acknowledged", "resolved", "rejected"}),
    "acknowledged": frozenset({"resolved"}),
    "resolved": frozenset(),
    "rejected": frozenset(),
}
# Targets an operator may set through PATCH /incidents/{id}/status. `confirmed` comes from
# detection review and `station_selected` from station selection, never from a manual PATCH.
OPERATOR_TARGETS = frozenset({"notified", "acknowledged", "resolved", "rejected"})


def can_transition(current: str, target: str) -> bool:
    return target in TRANSITIONS.get(current, frozenset())


def severity_for(event_type: str, confidence: float) -> str:
    """Deterministic M3 rule: fire and smoke together is high; fire is high at confidence 0.70
    or above, otherwise medium; smoke alone is medium at 0.80 or above, otherwise low."""
    if event_type == "fire_smoke":
        return "high"
    if event_type == "fire":
        return "high" if confidence >= 0.70 else "medium"
    return "medium" if confidence >= 0.80 else "low"


EARTH_RADIUS_KM = 6371.0088


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(math.sqrt(a))


class StationLike(Protocol):
    id: str
    latitude: float
    longitude: float
    status: str


@dataclass(frozen=True)
class StationChoice:
    station: StationLike
    distance_km: float


def nearest_available_station(
    lat: float, lng: float, stations: Iterable[StationLike]
) -> StationChoice | None:
    """Nearest station with status `available` by straight-line (great-circle) distance.
    Ties break on station id so the choice is deterministic. Not a driving distance or ETA."""
    best: StationChoice | None = None
    for station in stations:
        if station.status != "available":
            continue
        distance = haversine_km(lat, lng, station.latitude, station.longitude)
        if (
            best is None
            or distance < best.distance_km
            or (distance == best.distance_km and station.id < best.station.id)
        ):
            best = StationChoice(station, distance)
    return best
