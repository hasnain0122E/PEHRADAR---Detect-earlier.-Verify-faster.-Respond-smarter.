import { describe, expect, it } from "vitest";

import {
  CAMERA_KORANGI,
  CAMERA_SADDAR,
  DETECTION_PENDING,
  INCIDENT,
  STATION_LANDHI,
  STATION_ORANGI,
} from "@/test/fixtures";

import { buildMarkers, type MarkerInput } from "./markers";

const base: MarkerInput = {
  cameras: [CAMERA_SADDAR, CAMERA_KORANGI],
  stations: [STATION_LANDHI, STATION_ORANGI],
  incidents: [],
  pending: [],
  analyzingCameraId: null,
  selection: null,
};
const byKey = (specs: ReturnType<typeof buildMarkers>, key: string) =>
  specs.find((s) => s.key === key)!;

describe("buildMarkers", () => {
  it("uses coordinates from the API data", () => {
    const korangi = byKey(buildMarkers(base), `camera:${CAMERA_KORANGI.id}`);
    expect([korangi.lng, korangi.lat]).toEqual([CAMERA_KORANGI.longitude, CAMERA_KORANGI.latitude]);
  });

  it("marks camera states: pending, active incident, analyzing, selected", () => {
    const specs = buildMarkers({
      ...base,
      pending: [DETECTION_PENDING],
      incidents: [INCIDENT],
      analyzingCameraId: CAMERA_KORANGI.id,
      selection: { kind: "detection", id: DETECTION_PENDING.id },
    });
    const korangi = byKey(specs, `camera:${CAMERA_KORANGI.id}`);
    expect(korangi.className.split(" ")).toEqual(
      expect.arrayContaining(["is-pending", "has-incident", "is-analyzing", "is-selected"]),
    );
    expect(korangi.html).toContain('class="pr-badge"');
    expect(korangi.label).toMatch(/1 detection awaiting review, active incident, analyzing footage/);
    expect(byKey(specs, `camera:${CAMERA_SADDAR.id}`).className).not.toContain("is-pending");
  });

  it("distinguishes station availability by shape, not colour alone", () => {
    const specs = buildMarkers(base);
    expect(byKey(specs, `station:${STATION_LANDHI.id}`).className).toContain("is-available");
    const orangi = byKey(specs, `station:${STATION_ORANGI.id}`);
    expect(orangi.className).toContain("is-unavailable");
    expect(orangi.html).toContain("×");
  });

  it("shows active incidents, hides closed ones unless selected, highlights the candidate station", () => {
    const resolved = { ...INCIDENT, id: "closed", status: "resolved" as const };
    let specs = buildMarkers({ ...base, incidents: [INCIDENT, resolved] });
    const shown = specs.filter((s) => s.select.kind === "incident").map((s) => s.select.id);
    expect(shown).toEqual([INCIDENT.id]);
    expect(byKey(specs, `incident:${INCIDENT.id}`).html).toContain("▲");

    specs = buildMarkers({
      ...base,
      incidents: [INCIDENT, resolved],
      selection: { kind: "incident", id: "closed" },
    });
    expect(byKey(specs, "incident:closed").className).toContain("is-closed");
    expect(byKey(specs, `station:${STATION_LANDHI.id}`).className).toContain("is-candidate");
  });

  it("escapes camera names placed in marker HTML", () => {
    const hostile = { ...CAMERA_SADDAR, name: '<img src=x onerror="alert(1)">' };
    const spec = byKey(buildMarkers({ ...base, cameras: [hostile] }), `camera:${hostile.id}`);
    expect(spec.html).not.toContain("<img");
  });
});
