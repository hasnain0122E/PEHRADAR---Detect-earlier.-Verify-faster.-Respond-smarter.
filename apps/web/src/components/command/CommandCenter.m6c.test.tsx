import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { FireStation, IncidentDetail, IncidentRoute } from "@/lib/api/types";
import { mapRoutes, RESPONSE_DISCLAIMER, responseUnits, UNIT_VIEW } from "@/lib/response";
import { fakeApi, healthyFetch, INCIDENT, INCIDENT_DETAIL, ROUTE_OK, STATION_LANDHI, STATION_ORANGI } from "@/test/fixtures";

import type { OpsMapProps } from "../map/OpsMap";
import { buildMarkers, facilityFeatures } from "../map/markers";
import { CommandCenter } from "./CommandCenter";

const POLICE: FireStation = {
  ...STATION_LANDHI,
  id: "11111111-2222-4333-8444-555555555501",
  code: "KHI-PS-009",
  name: "Landhi Police Station",
  latitude: 24.84,
  longitude: 67.19,
  facility_type: "police_station",
  category: "police",
};
const POLICE_FAR: FireStation = { ...POLICE, id: "11111111-2222-4333-8444-555555555502", name: "Malir Police Station" };
const AMBULANCE: FireStation = {
  ...STATION_LANDHI,
  id: "11111111-2222-4333-8444-555555555503",
  code: "KHI-AMB-003",
  name: "Edhi Ambulance",
  latitude: 24.837,
  longitude: 67.226,
  facility_type: "ambulance_station",
  category: "ambulance",
};
const FIRE = { ...STATION_LANDHI, category: "fire" as const };

const route = (km: number, min: number, coords: [number, number][]): IncidentRoute => ({
  ...ROUTE_OK,
  distance_km: km,
  duration_min: min,
  geometry: { type: "LineString", coordinates: coords },
});
const FAILED: IncidentRoute = {
  status: "unavailable",
  provider: "osrm",
  from_station_id: POLICE.id,
  reason: "OSRM request failed: TimeoutError",
  fallback: "straight_line",
  straight_line_km: 1.62,
  generated_at: "2026-10-18T10:00:00+00:00",
  is_estimate: true,
  note: "Road route unavailable",
};

const UNITS: NonNullable<IncidentDetail["response_units"]> = {
  fire: { unit: "fire", facility: FIRE, distance_km: 7.6, method: "straight_line_haversine", reason: "Nearest", route: route(9.05, 11, [[67.2, 24.85], [67.124, 24.833]]) },
  ambulance: { unit: "ambulance", facility: AMBULANCE, distance_km: 10.4, method: "straight_line_haversine", reason: "Nearest", route: route(12.3, 16, [[67.226, 24.837], [67.124, 24.833]]) },
  police: { unit: "police", facility: POLICE, distance_km: 1.62, method: "straight_line_haversine", reason: "Nearest", route: route(2.4, 5, [[67.19, 24.84], [67.124, 24.833]]) },
};
const MULTI: IncidentDetail = { ...INCIDENT_DETAIL, route: UNITS.fire!.route, response_units: UNITS };

function StubMap(props: OpsMapProps) {
  return (
    <div data-testid="stub-map" data-routes={JSON.stringify(props.routes ?? null)}>
      {buildMarkers(props).map((m) => (
        <button key={m.key} type="button" aria-label={m.label} data-classes={m.className} onClick={() => props.onSelect(m.select)}>
          {m.key}
        </button>
      ))}
    </div>
  );
}

function renderCenter(api = fakeApi()) {
  render(<CommandCenter api={api} apiBaseUrl="http://api.test" MapComponent={StubMap} fetchImpl={healthyFetch()} />);
  return api;
}
const details = () => within(screen.getByRole("complementary", { name: "Details" }));
const drawnRoutes = () => JSON.parse(screen.getByTestId("stub-map").dataset.routes!) as { unit: string; color: string }[] | null;

function multiApi(detail: IncidentDetail = MULTI) {
  return fakeApi({
    listStations: vi.fn().mockResolvedValue([FIRE, STATION_ORANGI, POLICE, POLICE_FAR, AMBULANCE]),
    listIncidents: vi.fn().mockResolvedValue([detail]),
    getIncident: vi.fn().mockResolvedValue(detail),
  });
}

describe("multi-agency response (M6C)", () => {
  it("uses one fixed colour per service for routes", () => {
    expect(UNIT_VIEW.fire.color).toBe("#E5484D");
    expect(UNIT_VIEW.ambulance.color).toBe("#16A36A");
    expect(UNIT_VIEW.police.color).toBe("#2563EB");
    const routes = mapRoutes(responseUnits(MULTI), { fire: true, ambulance: true, police: true });
    expect(routes.map((r) => [r.unit, r.color])).toEqual([
      ["fire", "#E5484D"],
      ["ambulance", "#16A36A"],
      ["police", "#2563EB"],
    ]);
    // Toggled-off units and units without a road route are not drawn.
    const failed = { ...MULTI, response_units: { ...UNITS, police: { ...UNITS.police!, route: FAILED } } };
    expect(mapRoutes(responseUnits(failed), { fire: true, ambulance: false, police: true }).map((r) => r.unit)).toEqual(["fire"]);
  });

  it("keeps old fire-only incidents working", () => {
    const legacy = { ...INCIDENT, route: ROUTE_OK, response_units: undefined };
    const units = responseUnits(legacy);
    expect(units.map((u) => [u.unit, u.facility.name])).toEqual([["fire", "Landhi Fire Station"]]);
    expect(mapRoutes(units, { fire: true, ambulance: true, police: true })).toHaveLength(1);
  });

  it("shows fire stations always, quiet police and ambulance only in the GL layer, and lifts suggested ones", () => {
    const input = {
      cameras: [],
      stations: [FIRE, POLICE, POLICE_FAR, AMBULANCE],
      incidents: [{ ...INCIDENT, response_units: UNITS }],
      pending: [],
      analyzingCameraId: null,
      selection: null,
    };
    expect(buildMarkers(input).filter((m) => m.key.startsWith("station:")).map((m) => m.key)).toEqual([`station:${FIRE.id}`]);
    expect(facilityFeatures(input).features.map((f) => [f.properties.name, f.properties.category])).toEqual([
      ["Landhi Police Station", "police"],
      ["Malir Police Station", "police"],
      ["Edhi Ambulance", "ambulance"],
    ]);

    const selected = { ...input, selection: { kind: "incident" as const, id: INCIDENT.id } };
    const specs = buildMarkers(selected).filter((m) => m.key.startsWith("station:"));
    const byName = (n: string) => specs.find((m) => m.label.includes(n))!;
    expect(byName("Landhi Police Station").className).toContain("cat-police");
    expect(byName("Landhi Police Station").className).toContain("is-candidate");
    expect(byName("Landhi Police Station").label).toMatch(/^Police station: .*suggested police resource/);
    expect(byName("Edhi Ambulance").className).toContain("cat-ambulance");
    expect(byName("Landhi Fire Station").label).toMatch(/suggested fire resource/);
    expect(specs.some((m) => m.label.includes("Malir Police"))).toBe(false); // unrelated: stays quiet
  });

  it("lists the three suggested resources with road distance, ETA and the disclaimer", async () => {
    renderCenter(multiApi());
    fireEvent.click(await screen.findByRole("button", { name: /^Incident: FIRE/ }, { timeout: 4000 }));
    expect(await details().findByText("Suggested response", {}, { timeout: 4000 })).toBeInTheDocument();
    for (const [unit, name, km, min] of [
      ["Fire", "Landhi Fire Station", "9.1 km", "11 min"],
      ["Ambulance", "Edhi Ambulance", "12.3 km", "16 min"],
      ["Police", "Landhi Police Station", "2.4 km", "5 min"],
    ]) {
      const row = within(details().getByRole("listitem", { name: `${unit} response` }));
      expect(row.getByText(name)).toBeInTheDocument();
      expect(row.getByText(km)).toBeInTheDocument();
      expect(row.getByText(min)).toBeInTheDocument();
    }
    expect(details().getByText(RESPONSE_DISCLAIMER)).toBeInTheDocument();
    expect(details().queryByText(/dispatched/i)).toBeNull();
  });

  it("shows a straight-line fallback for one failed route without hiding the others", async () => {
    renderCenter(multiApi({ ...MULTI, response_units: { ...UNITS, police: { ...UNITS.police!, route: FAILED } } }));
    fireEvent.click(await screen.findByRole("button", { name: /^Incident: FIRE/ }));
    const police = within(await details().findByRole("listitem", { name: "Police response" }));
    expect(police.getByText("Road route unavailable; 1.6 km straight-line")).toBeInTheDocument();
    expect(within(details().getByRole("listitem", { name: "Fire response" })).getByText("9.1 km")).toBeInTheDocument();

    fireEvent.click(details().getByRole("button", { name: "Show all routes" }));
    await waitFor(() => expect(drawnRoutes()?.map((r) => r.unit)).toEqual(["fire", "ambulance"]));
  });

  it("draws all three routes, lets the operator toggle them, and exits cleanly", async () => {
    renderCenter(multiApi());
    fireEvent.click(await screen.findByRole("button", { name: /^Incident: FIRE/ }));
    await details().findByText("Suggested response");
    expect(drawnRoutes()).toBeNull(); // not until asked

    fireEvent.click(details().getByRole("button", { name: "Show all routes" }));
    await waitFor(() =>
      expect(drawnRoutes()?.map((r) => [r.unit, r.color])).toEqual([
        ["fire", "#E5484D"],
        ["ambulance", "#16A36A"],
        ["police", "#2563EB"],
      ]),
    );
    const summary = within(screen.getByLabelText("Route summary"));
    expect(summary.getByText("Edhi Ambulance")).toBeInTheDocument();
    expect(summary.getByText("Road estimate · not a dispatch")).toBeInTheDocument();

    const toggles = within(details().getByRole("group", { name: "Routes on map" }));
    fireEvent.click(toggles.getByRole("button", { name: "Police" }));
    expect(toggles.getByRole("button", { name: "Police" })).toHaveAttribute("aria-pressed", "false");
    expect(drawnRoutes()?.map((r) => r.unit)).toEqual(["fire", "ambulance"]);

    fireEvent.click(summary.getByRole("button", { name: "Exit route view" }));
    expect(drawnRoutes()).toBeNull();
    // Opening the response view again starts with all three routes.
    fireEvent.click(details().getByRole("button", { name: "Show all routes" }));
    await waitFor(() => expect(drawnRoutes()).toHaveLength(3));
  });

  it("reset operations clears the response view", async () => {
    const api = renderCenter(multiApi());
    fireEvent.click(await screen.findByRole("button", { name: /^Incident: FIRE/ }));
    fireEvent.click(await details().findByRole("button", { name: "Show all routes" }));
    await waitFor(() => expect(drawnRoutes()).toHaveLength(3));

    fireEvent.click(within(screen.getByRole("navigation", { name: "Primary" })).getByRole("button", { name: "Settings" }));
    const settings = within(await screen.findByRole("dialog", { name: "Settings" }));
    fireEvent.click(await settings.findByRole("button", { name: "Reset operations" }));
    fireEvent.click(settings.getByRole("button", { name: "Yes, reset operations" }));
    await waitFor(() => expect(api.resetScenarios).toHaveBeenCalledWith("demo"));
    await waitFor(() => expect(drawnRoutes()).toBeNull());
    expect(screen.queryByLabelText("Route summary")).toBeNull();
  });

  it("groups the stations list by service", async () => {
    renderCenter(multiApi());
    fireEvent.click(within(screen.getByRole("navigation", { name: "Primary" })).getByRole("button", { name: /^Stations/ }));
    const list = within(await screen.findByRole("region", { name: "Stations" }));
    expect(await list.findByText("Fire stations · 2")).toBeInTheDocument();
    expect(list.getByText("Ambulance / EMS · 1")).toBeInTheDocument();
    expect(list.getByText("Police stations · 2")).toBeInTheDocument();
    fireEvent.click(list.getByRole("button", { name: "Police" }));
    expect(list.queryByText("Fire stations · 2")).toBeNull();
    expect(list.getByRole("button", { name: /Landhi Police Station/ })).toBeInTheDocument();
  });
});
