// M6C multi-agency response: one vocabulary for the incident panel, the map and the tests.
// Suggestions only: nearest facility by straight-line distance plus a road-route estimate.

import type {
  FacilityCategory,
  FireStation,
  Incident,
  IncidentRoute,
  ResponseUnit,
  ResponseUnitKind,
} from "@/lib/api/types";

export const RESPONSE_UNITS: ResponseUnitKind[] = ["fire", "ambulance", "police"];

/** Route colours are fixed per service so the three suggested routes never look alike. */
export const UNIT_VIEW: Record<
  ResponseUnitKind,
  { label: string; facility: string; color: string; icon: "fireStation" | "ambulance" | "police"; tone: string }
> = {
  fire: { label: "Fire", facility: "Fire station", color: "#E5484D", icon: "fireStation", tone: "text-fire-ink" },
  ambulance: {
    label: "Ambulance",
    facility: "Ambulance response facility",
    color: "#16A36A",
    icon: "ambulance",
    tone: "text-ok-ink",
  },
  police: { label: "Police", facility: "Police station", color: "#2563EB", icon: "police", tone: "text-info" },
};

export const RESPONSE_DISCLAIMER =
  "Suggested response resources based on mapped proximity and routing estimates. This does not confirm real-world availability or dispatch.";

export const categoryOf = (f: FireStation): FacilityCategory => f.category ?? "fire";

/**
 * The incident's suggested units in display order. Incidents confirmed before M6C (or from an
 * older API) only have the fire candidate, rebuilt from station_selection and route.
 */
export function responseUnits(incident: Incident): ResponseUnit[] {
  const units = incident.response_units;
  if (units) return RESPONSE_UNITS.map((u) => units[u]).filter((u): u is ResponseUnit => !!u);
  const sel = incident.station_selection;
  return sel
    ? [{ unit: "fire", facility: sel.station, distance_km: sel.distance_km, method: sel.method, reason: null, route: incident.route }]
    : [];
}

export interface MapRoute {
  unit: ResponseUnitKind;
  color: string;
  coordinates: [number, number][];
}

/** Road routes to draw, for the units the operator has switched on. */
export function mapRoutes(units: ResponseUnit[], visible: Record<ResponseUnitKind, boolean>): MapRoute[] {
  return units.flatMap((u) => {
    const route = u.route;
    const coordinates = route?.status === "ok" ? route.geometry?.coordinates : undefined;
    return visible[u.unit] && coordinates?.length ? [{ unit: u.unit, color: UNIT_VIEW[u.unit].color, coordinates }] : [];
  });
}

export const routeOk = (route: IncidentRoute | null): route is Extract<IncidentRoute, { status: "ok" }> =>
  route?.status === "ok";

export const ALL_UNITS_VISIBLE: Record<ResponseUnitKind, boolean> = { fire: true, ambulance: true, police: true };
