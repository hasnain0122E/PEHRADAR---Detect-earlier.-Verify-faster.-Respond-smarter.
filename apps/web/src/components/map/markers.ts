// Pure marker model for the operations map. Shapes differ per entity (disc, rounded square,
// large flame disc) and every state has a glyph, size or outline change, so nothing relies on
// colour alone.
//
// M5 scale: ~180 cameras. Quiet simulated-coverage nodes go to a clustered GeoJSON layer
// (cameraFeatures). Every camera that needs attention (pending detection, active incident,
// analysis, selection) and every node with a feed stays an individual HTML marker
// (buildMarkers), so an alert can never hide inside a cluster.

import type { Camera, Detection, FireStation, Incident } from "@/lib/api/types";
import { EVENT_LABEL, isActiveIncident, SEVERITY_VIEW, STATUS_LABEL } from "@/lib/ops";

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
    c.source_type === "demo_stream" ||
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
    properties: { id: string; code: string; name: string; source_type: string; inactive: boolean };
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
        },
      })),
  };
}

const CAMERA_SVG = iconSvg("camera", 12);
const STATION_SVG = iconSvg("station", 13);
const FLAME_SVG = iconSvg("flame", 16);

export function buildMarkers(input: MarkerInput): MarkerSpec[] {
  const { cameras, stations, incidents, selection } = input;
  const state = cameraState(input);
  const { pendingByCamera, incidentByCamera, selectedCameraId, analyzing } = state;
  const selectedIncident =
    selection?.kind === "incident" ? incidents.find((i) => i.id === selection.id) : undefined;
  const candidateStationId = selectedIncident?.assigned_station_id ?? null;

  const specs: MarkerSpec[] = [];

  for (const s of stations) {
    const classes = ["pr-marker", "pr-marker-station", `is-${s.status}`];
    if (s.id === candidateStationId) classes.push("is-candidate");
    if (selection?.kind === "station" && selection.id === s.id) classes.push("is-selected");
    const glyph = s.status === "available" ? "" : '<span class="pr-x" aria-hidden="true">×</span>';
    specs.push({
      key: `station:${s.id}`,
      lng: s.longitude,
      lat: s.latitude,
      className: classes.join(" "),
      html: `<span class="pr-station">${STATION_SVG}</span>${glyph}<span class="pr-label">${escapeHtml(s.name)}</span>`,
      label: `Fire station: ${s.name} (${s.status === "available" ? "available, demo flag" : "unavailable, demo flag"}${s.id === candidateStationId ? "; candidate station" : ""})`,
      select: { kind: "station", id: s.id },
      z: 1,
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
    const badge = pendingCount
      ? `<span class="pr-badge" aria-hidden="true">${pendingCount}</span>`
      : "";
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
      html: `<span class="pr-pin">${CAMERA_SVG}</span>${badge}<span class="pr-label">${escapeHtml(shortName(c.name))}</span>`,
      label: `Camera: ${c.name}${states.length ? ` (${states.join(", ")})` : ""}`,
      select: { kind: "camera", id: c.id },
      z: 2,
    });
  }

  for (const i of incidents) {
    const isSelected = selectedIncident?.id === i.id;
    // Closed incidents leave the map unless the operator is looking at one.
    if (!isActiveIncident(i) && !isSelected) continue;
    const sev = SEVERITY_VIEW[i.severity];
    const classes = ["pr-marker", "pr-marker-incident", `sev-${i.severity}`, `st-${i.status}`];
    if (!isActiveIncident(i)) classes.push("is-closed");
    if (isSelected) classes.push("is-selected");
    specs.push({
      key: `incident:${i.id}`,
      lng: i.longitude,
      lat: i.latitude,
      className: classes.join(" "),
      html: `<span class="pr-incident" aria-hidden="true">${FLAME_SVG}</span><span class="pr-label">${escapeHtml(i.camera.location_label)}</span>`,
      label: `Incident: ${EVENT_LABEL[i.event_type]}, ${sev.label} severity, ${STATUS_LABEL[i.status]}, ${i.camera.location_label}`,
      select: { kind: "incident", id: i.id },
      z: 3,
    });
  }
  return specs;
}

/** "Saddar - Empress Market (simulated)" → "Saddar" for the map label. */
export function shortName(name: string) {
  return name.split(" - ")[0].replace(/\s*\(simulated\)\s*$/i, "");
}

function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}
