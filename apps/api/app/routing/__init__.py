"""Road routing for the suggested response route (M5).

The candidate station is still chosen by straight-line (Haversine) proximity
(app.domain.incident_rules). A RouteProvider then asks for a road route from that station to the
incident. The result is an estimate for the operator, never a dispatch or a guaranteed ETA.

Providers:
- OsrmRouteProvider: an OSRM HTTP server, by default the public OSRM demo server
  (router.project-osrm.org, OpenStreetMap data). Its usage policy allows light, non-commercial
  use only (about 1 request per second, no SLA), which fits a hackathon demo: PehRadar sends one
  request per confirmed incident and stores the result on the incident.
- None (ROUTING_PROVIDER=none): routing disabled; incidents keep the straight-line fallback.
"""

import json
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Protocol

from app.domain.incident_rules import haversine_km


class RoutingError(Exception):
    pass


@dataclass(frozen=True)
class Route:
    provider: str
    profile: str
    distance_km: float
    duration_min: float
    coordinates: list[list[float]]  # GeoJSON order: [lng, lat]


class RouteProvider(Protocol):
    name: str

    def route(self, origin: tuple[float, float], destination: tuple[float, float]) -> Route:
        """origin/destination are (lat, lng). Raises RoutingError on any failure."""
        ...


class OsrmRouteProvider:
    name = "osrm"

    def __init__(self, base_url: str, timeout_s: float, user_agent: str = "PehRadar/0.1"):
        self.base_url = base_url.rstrip("/")
        self.timeout_s = timeout_s
        self.user_agent = user_agent

    def url(self, origin: tuple[float, float], destination: tuple[float, float]) -> str:
        coords = f"{origin[1]:.6f},{origin[0]:.6f};{destination[1]:.6f},{destination[0]:.6f}"
        query = urllib.parse.urlencode({"overview": "full", "geometries": "geojson"})
        return f"{self.base_url}/route/v1/driving/{coords}?{query}"

    def route(self, origin: tuple[float, float], destination: tuple[float, float]) -> Route:
        request = urllib.request.Request(
            self.url(origin, destination), headers={"User-Agent": self.user_agent}
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout_s) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except Exception as exc:  # network, timeout, HTTP error, invalid JSON
            raise RoutingError(f"OSRM request failed: {type(exc).__name__}") from exc
        return parse_osrm(payload)


def parse_osrm(payload: dict) -> Route:
    if payload.get("code") != "Ok" or not payload.get("routes"):
        raise RoutingError(f"OSRM returned no route ({payload.get('code', 'no code')})")
    best = payload["routes"][0]
    coordinates = (best.get("geometry") or {}).get("coordinates") or []
    distance, duration = best.get("distance"), best.get("duration")
    if len(coordinates) < 2 or not isinstance(distance, int | float) or distance <= 0:
        raise RoutingError("OSRM route has no usable geometry")
    if not isinstance(duration, int | float) or duration < 0:
        raise RoutingError("OSRM route has no usable duration")
    return Route(
        provider="osrm",
        profile="driving",
        distance_km=round(distance / 1000, 2),
        duration_min=round(duration / 60, 1),
        coordinates=[[round(c[0], 6), round(c[1], 6)] for c in coordinates],
    )


def straight_line_km(origin: tuple[float, float], destination: tuple[float, float]) -> float:
    return round(haversine_km(origin[0], origin[1], destination[0], destination[1]), 2)
