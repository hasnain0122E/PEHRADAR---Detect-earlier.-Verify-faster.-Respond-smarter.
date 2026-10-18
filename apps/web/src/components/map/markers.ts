// Pure marker model for the operations map. Shapes differ per entity (disc, rounded square,
// large flame disc) and every state has a glyph, size or outline change, so nothing relies on
// colour alone.
//
// M5 scale: ~180 cameras. Quiet nodes (with or without a demo feed) go to a clustered GeoJSON
// layer (cameraFeatures). Every camera that needs attention (pending detection, active incident,
// analysis, selection) and every public live stream stays an individual HTML marker
// (buildMarkers), so an alert can never hide inside a cluster.
//
// M6B iconography: incidents are anchored pins with a fire or smoke glyph (grey with a check
// once closed, shown only with the history layer); a pending detection is an amber disc with an
// exclamation mark; a camera with a feed carries a small live dot; stations are solid rounded
// squares with a fire-station glyph (grey, dashed and crossed when unavailable).
//
// M6C: response facilities have one shape per service glyph: fire station (red), ambulance
// (green), police shield (blue); the suggested units of the selected incident are filled with
// their service colour. Fire stations are always HTML markers (11). Quiet police and ambulance
// facilities (~95) go to a GL layer (facilityFeatures) shown from district zoom, so the city
// view stays readable.

import type { Camera, Detection, FireStation, Incident } from "@/lib/api/types";
import type { ResponseUnitKind } from "@/lib/api/types";
import { EVENT_LABEL, isActiveIncident, SEVERITY_VIEW, STATUS_LABEL } from "@/lib/ops";
import { categoryOf, responseUnits, UNIT_VIEW } from "@/lib/response";

import type { Selection } from "../command/selection";
import { iconSvg } from "../icons";

export interface MarkerSpec {
  key: string;
  lng: number;
  lat: number;
  className: string;
  html: string;
  label: string;
  select: Selection;
  /** Stacking: incidents above cameras above stations. */
  z: number;
  /** Pins sit on their point (bottom); discs are centred. */
  anchor: "center" | "bottom";
}

export interface MarkerInput {
  cameras: Camera[];
  stations: FireStation[];
  incidents: Incident[];
  pending: Detection[];
  analyzingCameraId: string | null;
  /** Cameras whose demo scenario is being analysed by the detector right now. */
  scenarioCameraIds?: string[];
  selection: Selection | null;
  /** History layer: also draw resolved and rejected incidents (Settings or the layers menu). */
  showClosed?: boolean;
}

interface CameraState {
  pendingByCamera: Map<string, number>;
  incidentByCamera: Map<string, Incident>;
  selectedCameraId: string | undefined;
  analyzing: Set<string>;
}

function cameraState(input: MarkerInput): CameraState {
  const { pending, incidents, selection, analyzingCameraId, scenarioCameraIds = [] } = input;
  const pendingByCamera = new Map<string, number>();
  for (const d of pending) pendingByCamera.set(d.camera_id, (pendingByCamera.get(d.camera_id) ?? 0) + 1);
  const incidentByCamera = new Map<string, Incident>();
  for (const i of incidents.filter(isActiveIncident)) {
    if (!incidentByCamera.has(i.camera.id)) incidentByCamera.set(i.camera.id, i);
  }
  const selectedIncident =
    selection?.kind === "incident" ? incidents.find((i) => i.id === selection.id) : undefined;
  const selectedCameraId =
    selection?.kind === "camera"
      ? selection.id
      : selection?.kind === "detection"
        ? pending.find((d) => d.id === selection.id)?.camera_id
        : selectedIncident?.camera.id;
  const analyzing = new Set(scenarioCameraIds);
  if (analyzingCameraId) analyzing.add(analyzingCameraId);
  return { pendingByCamera, incidentByCamera, selectedCameraId, analyzing };
}

/** Cameras drawn as individual HTML markers (never clustered). */
export function isProminentCamera(c: Camera, state: CameraState): boolean {
  return (
    c.source_type === "public_live" ||
    state.pendingByCamera.has(c.id) ||
    state.incidentByCamera.has(c.id) ||
    state.analyzing.has(c.id) ||
    state.selectedCameraId === c.id
  );
}

export interface CameraFeatureCollection {
  type: "FeatureCollection";
  features: {
    type: "Feature";
    id: number;
    geometry: { type: "Point"; coordinates: [number, number] };
    properties: { id: string; code: string; name: string; source_type: string; inactive: boolean; feed: boolean };
  }[];
}

/** GeoJSON for the clustered layer: the quiet cameras that are not HTML markers. */
export function cameraFeatures(input: MarkerInput): CameraFeatureCollection {
  const state = cameraState(input);
  return {
    type: "FeatureCollection",
    features: input.cameras
      .filter((c) => !isProminentCamera(c, state))
      .map((c, index) => ({
        type: "Feature" as const,
        id: index,
        geometry: { type: "Point" as const, coordinates: [c.longitude, c.latitude] as [number, number] },
        properties: {
          id: c.id,
          code: c.code,
          name: c.name,
          source_type: c.source_type,
          inactive: c.status !== "active",
          feed: c.stream_url !== null,
        },
      })),
  };
}

const CAMERA_SVG = iconSvg("camera", 12);
const EXCLAIM_SVG = iconSvg("exclaim", 14);
const FACILITY_SVG = {
  fire: iconSvg("fireStation", 14),
  ambulance: iconSvg("ambulance", 14),
  police: iconSvg("police", 14),
};
const INCIDENT_SVG = { fire: iconSvg("flame", 15), smoke: iconSvg("smoke", 15), fire_smoke: iconSvg("flame", 15) };
const CLOSED_SVG = iconSvg("check", 14);

export function buildMarkers(input: MarkerInput): MarkerSpec[] {
  const { cameras, stations, incidents, selection } = input;
  const state = cameraState(input);
  const { pendingByCamera, incidentByCamera, selectedCameraId, analyzing } = state;
  const selectedIncident =
    selection?.kind === "incident" ? incidents.find((i) => i.id === selection.id) : undefined;
  const candidates = candidateUnits(input);

  const specs: MarkerSpec[] = [];

  for (const s of stations) {
    if (!isProminentFacility(s, input, candidates)) continue;
    const category = categoryOf(s);
    const unit = candidates.get(s.id);
    const classes = ["pr-marker", "pr-marker-station", `cat-${category}`, `is-${s.status}`];
    if (unit) classes.push("is-candidate");
    if (selection?.kind === "station" && selection.id === s.id) classes.push("is-selected");
    const glyph = s.status === "available" ? "" : '<span class="pr-x" aria-hidden="true">×</span>';
    specs.push({
      key: `station:${s.id}`,
      lng: s.longitude,
      lat: s.latitude,
      className: classes.join(" "),
      html: `<span class="pr-station">${FACILITY_SVG[category]}</span>${glyph}<span class="pr-label">${escapeHtml(s.name)}</span>`,
      anchor: "center",
      label: `${FACILITY_NAME[category]}: ${s.name} (${s.status === "available" ? "available, demo flag" : "unavailable, demo flag"}${unit ? `; suggested ${UNIT_VIEW[unit].label.toLowerCase()} resource` : ""})`,
      select: { kind: "station", id: s.id },
      z: unit ? 2 : 1,
    });
  }

  for (const c of cameras) {
    if (!isProminentCamera(c, state)) continue;
    const classes = ["pr-marker", "pr-marker-camera", `src-${c.source_type}`];
    const pendingCount = pendingByCamera.get(c.id) ?? 0;
    const incident = incidentByCamera.get(c.id);
    if (c.status !== "active") classes.push("is-inactive");
    if (pendingCount) classes.push("is-pending");
    if (incident) classes.push("has-incident");
    if (analyzing.has(c.id)) classes.push("is-analyzing");
    if (c.id === selectedCameraId) classes.push("is-selected");
    const feed = c.stream_url !== null && c.status === "active";
    if (feed) classes.push("has-feed");
    const badge = pendingCount > 1 ? `<span class="pr-badge" aria-hidden="true">${pendingCount}</span>` : "";
    const live = feed && !pendingCount ? '<span class="pr-live" aria-hidden="true"></span>' : "";
    const states = [
      pendingCount ? `${pendingCount} detection${pendingCount > 1 ? "s" : ""} awaiting review` : null,
      incident ? "active incident" : null,
      analyzing.has(c.id) ? "analyzing footage" : null,
      c.source_type === "demo_stream" ? "simulated demo feed" : null,
      c.source_type === "public_live" ? "public live feed" : null,
      c.status !== "active" ? c.status : null,
    ].filter(Boolean);
    specs.push({
      key: `camera:${c.id}`,
      lng: c.longitude,
      lat: c.latitude,
      className: classes.join(" "),
      html: `<span class="pr-pin">${pendingCount ? EXCLAIM_SVG : CAMERA_SVG}</span>${live}${badge}<span class="pr-label">${escapeHtml(shortName(c.name))}</span>`,
      anchor: "center",
      label: `Camera: ${c.name}${states.length ? ` (${states.join(", ")})` : ""}`,
      select: { kind: "camera", id: c.id },
      z: 2,
    });
  }

  for (const i of incidents) {
    const isSelected = selectedIncident?.id === i.id;
    // Closed incidents leave the live map unless the history layer is on or one is selected.
    if (!isActiveIncident(i) && !isSelected && !input.showClosed) continue;
    const sev = SEVERITY_VIEW[i.severity];
    const classes = ["pr-marker", "pr-marker-incident", `sev-${i.severity}`, `st-${i.status}`, `ev-${i.event_type}`];
    if (!isActiveIncident(i)) classes.push("is-closed");
    if (isSelected) classes.push("is-selected");
    specs.push({
      key: `incident:${i.id}`,
      lng: i.longitude,
      lat: i.latitude,
      className: classes.join(" "),
      html: `<span class="pr-incident" aria-hidden="true"><span class="pr-incident-glyph">${isActiveIncident(i) ? INCIDENT_SVG[i.event_type] : CLOSED_SVG}</span></span><span class="pr-label">${escapeHtml(i.camera.location_label)}</span>`,
      anchor: "bottom",
      label: `${isActiveIncident(i) ? "Incident" : "Closed incident"}: ${EVENT_LABEL[i.event_type]}, ${sev.label} severity, ${STATUS_LABEL[i.status]}, ${i.camera.location_label}`,
      select: { kind: "incident", id: i.id },
      z: isActiveIncident(i) ? 4 : 3,
    });
  }
  return specs;
}

const FACILITY_NAME: Record<ResponseUnitKind, string> = {
  fire: "Fire station",
  ambulance: "Ambulance response facility",
  police: "Police station",
};

/** Facilities suggested for the selected incident: facility id → unit. */
export function candidateUnits(input: MarkerInput): Map<string, ResponseUnitKind> {
  const { selection, incidents } = input;
  const incident = selection?.kind === "incident" ? incidents.find((i) => i.id === selection.id) : undefined;
  return new Map(incident ? responseUnits(incident).map((u) => [u.facility.id, u.unit] as const) : []);
}

function isProminentFacility(s: FireStation, input: MarkerInput, candidates: Map<string, ResponseUnitKind>) {
  return (
    categoryOf(s) === "fire" ||
    candidates.has(s.id) ||
    (input.selection?.kind === "station" && input.selection.id === s.id)
  );
}

export interface FacilityFeatureCollection {
  type: "FeatureCollection";
  features: {
    type: "Feature";
    id: number;
    geometry: { type: "Point"; coordinates: [number, number] };
    properties: { id: string; name: string; category: ResponseUnitKind; inactive: boolean };
  }[];
}

/** GeoJSON for the quiet police and ambulance facilities (not HTML markers). */
export function facilityFeatures(input: MarkerInput): FacilityFeatureCollection {
  const candidates = candidateUnits(input);
  return {
    type: "FeatureCollection",
    features: input.stations
      .filter((s) => !isProminentFacility(s, input, candidates))
      .map((s, index) => ({
        type: "Feature" as const,
        id: index,
        geometry: { type: "Point" as const, coordinates: [s.longitude, s.latitude] as [number, number] },
        properties: { id: s.id, name: s.name, category: categoryOf(s), inactive: s.status !== "available" },
      })),
  };
}

/** "Saddar - Empress Market (simulated)" → "Saddar" for the map label. */
export function shortName(name: string) {
  return name.split(" - ")[0].replace(/\s*\(simulated\)\s*$/i, "");
}

function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}
