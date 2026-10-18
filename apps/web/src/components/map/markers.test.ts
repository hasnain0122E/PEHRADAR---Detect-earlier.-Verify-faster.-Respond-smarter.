import { describe, expect, it } from "vitest";

import {
  CAMERA_KORANGI,
  CAMERA_MAPPED,
  CAMERA_SADDAR,
  DETECTION_PENDING,
  INCIDENT,
  STATION_LANDHI,
  STATION_ORANGI,
} from "@/test/fixtures";

import { buildMarkers, cameraFeatures, type MarkerInput } from "./markers";

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
    const korangi = byKey(
      buildMarkers({ ...base, selection: { kind: "camera", id: CAMERA_KORANGI.id } }),
      `camera:${CAMERA_KORANGI.id}`,
    );
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
    // One pending detection: the exclamation glyph, no count badge (the badge appears from 2).
    expect(korangi.html).not.toContain('class="pr-badge"');
    expect(korangi.html).toContain('<path d="M12 6v7"/>');
    expect(korangi.label).toMatch(/1 detection awaiting review, active incident, analyzing footage/);
    // A quiet simulated node is not an HTML marker: it lives in the clustered layer.
    expect(byKey(specs, `camera:${CAMERA_SADDAR.id}`)).toBeUndefined();
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
    const marker = byKey(specs, `incident:${INCIDENT.id}`);
    expect(marker.className).toContain("sev-high");
    expect(marker.html).toContain('class="pr-incident"');

    specs = buildMarkers({
      ...base,
      incidents: [INCIDENT, resolved],
      selection: { kind: "incident", id: "closed" },
    });
    expect(byKey(specs, "incident:closed").className).toContain("is-closed");
    expect(byKey(specs, `station:${STATION_LANDHI.id}`).className).toContain("is-candidate");
  });

  it("draws closed incidents as history pins only when the history layer is on", () => {
    const resolved = { ...INCIDENT, id: "closed", status: "resolved" as const };
    const specs = buildMarkers({ ...base, incidents: [INCIDENT, resolved], showClosed: true });
    const closed = byKey(specs, "incident:closed");
    expect(closed.className).toContain("is-closed");
    expect(closed.label).toMatch(/^Closed incident/);
    expect(closed.anchor).toBe("bottom");
    expect(byKey(specs, `incident:${INCIDENT.id}`).z).toBeGreaterThan(closed.z);
  });

  it("escapes camera names placed in marker HTML", () => {
    const hostile = { ...CAMERA_SADDAR, name: '<img src=x onerror="alert(1)">' };
    const spec = byKey(
      buildMarkers({ ...base, cameras: [hostile], selection: { kind: "camera", id: hostile.id } }),
      `camera:${hostile.id}`,
    );
    expect(spec.html).not.toContain("<img");
  });
});

describe("cameraFeatures (clustered layer)", () => {
  const input: MarkerInput = { ...base, cameras: [CAMERA_SADDAR, CAMERA_KORANGI, CAMERA_MAPPED] };

  it("clusters every quiet node, including demo-feed nodes, and flags which ones have a feed", () => {
    const fc = cameraFeatures(input);
    expect(fc.features.map((f) => f.properties.code)).toEqual(["KHI-CAM-01", "KHI-CAM-03", "KHI-OSM-001"]);
    expect(fc.features[0].geometry.coordinates).toEqual([CAMERA_SADDAR.longitude, CAMERA_SADDAR.latitude]);
    expect(fc.features.map((f) => f.properties.feed)).toEqual([false, true, false]);
    expect(fc.features[2].properties.source_type).toBe("verified_mapped");
    const html = buildMarkers(input).filter((m) => m.select.kind === "camera");
    expect(html).toEqual([]);
  });

  it("marks a selected feed camera with the live dot", () => {
    const spec = byKey(
      buildMarkers({ ...input, selection: { kind: "camera", id: CAMERA_KORANGI.id } }),
      `camera:${CAMERA_KORANGI.id}`,
    );
    expect(spec.className).toContain("has-feed");
    expect(spec.html).toContain('class="pr-live"');
  });

  it("lifts a camera out of its cluster while it has an alert, an incident or the selection", () => {
    const alert = { ...DETECTION_PENDING, id: "d2", camera_id: CAMERA_SADDAR.id };
    for (const extra of [
      { pending: [alert] },
      { incidents: [{ ...INCIDENT, camera: CAMERA_SADDAR }] },
      { selection: { kind: "camera" as const, id: CAMERA_SADDAR.id } },
      { scenarioCameraIds: [CAMERA_SADDAR.id] },
    ]) {
      const next = { ...input, ...extra };
      expect(cameraFeatures(next).features.map((f) => f.properties.id)).not.toContain(CAMERA_SADDAR.id);
      expect(buildMarkers(next).some((m) => m.key === `camera:${CAMERA_SADDAR.id}`)).toBe(true);
    }
  });

  it("every camera is drawn exactly once, as a feature or as a marker", () => {
    const next = { ...input, pending: [DETECTION_PENDING] };
    const ids = [
      ...cameraFeatures(next).features.map((f) => f.properties.id),
      ...buildMarkers(next).filter((m) => m.select.kind === "camera").map((m) => m.select.id),
    ];
    expect(ids.sort()).toEqual(input.cameras.map((c) => c.id).sort());
  });
});
