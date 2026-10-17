// Pure marker model for the operations map (Design.md §7.2). Shapes differ per entity and every
// state has a glyph or outline change, so nothing relies on colour alone.

import type { Camera, Detection, FireStation, Incident } from "@/lib/api/types";
import { EVENT_LABEL, isActiveIncident, SEVERITY_VIEW, STATUS_LABEL } from "@/lib/ops";

import type { Selection } from "../command/selection";

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
  selection: Selection | null;
}

const CAMERA_SVG =
  '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>';
const SHIELD_SVG =
  '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path class="pr-shield" d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3z"/></svg>';

export function buildMarkers(input: MarkerInput): MarkerSpec[] {
  const { cameras, stations, incidents, pending, analyzingCameraId, selection } = input;
  const pendingByCamera = new Map<string, number>();
  for (const d of pending) pendingByCamera.set(d.camera_id, (pendingByCamera.get(d.camera_id) ?? 0) + 1);
  const active = incidents.filter(isActiveIncident);
  const incidentByCamera = new Map<string, Incident>();
  for (const i of active) if (!incidentByCamera.has(i.camera.id)) incidentByCamera.set(i.camera.id, i);

  const selectedIncident =
    selection?.kind === "incident" ? incidents.find((i) => i.id === selection.id) : undefined;
  const selectedCameraId =
    selection?.kind === "camera"
      ? selection.id
      : selection?.kind === "detection"
        ? pending.find((d) => d.id === selection.id)?.camera_id
        : undefined;
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
      html: `${SHIELD_SVG}${glyph}`,
      label: `Fire station: ${s.name} (${s.status === "available" ? "available, demo flag" : "unavailable, demo flag"}${s.id === candidateStationId ? "; candidate station" : ""})`,
      select: { kind: "station", id: s.id },
      z: 1,
    });
  }

  for (const c of cameras) {
    const classes = ["pr-marker", "pr-marker-camera"];
    const pendingCount = pendingByCamera.get(c.id) ?? 0;
    const incident = incidentByCamera.get(c.id);
    if (c.status !== "active") classes.push("is-inactive");
    if (pendingCount) classes.push("is-pending");
    if (incident) classes.push("has-incident");
    if (c.id === analyzingCameraId) classes.push("is-analyzing");
    if (c.id === selectedCameraId) classes.push("is-selected");
    const badge = pendingCount
      ? `<span class="pr-badge" aria-hidden="true">${pendingCount}</span>`
      : "";
    const dot = incident ? '<span class="pr-dot" aria-hidden="true"></span>' : "";
    const states = [
      pendingCount ? `${pendingCount} detection${pendingCount > 1 ? "s" : ""} awaiting review` : null,
      incident ? "active incident" : null,
      c.id === analyzingCameraId ? "analyzing footage" : null,
      c.status !== "active" ? c.status : null,
    ].filter(Boolean);
    specs.push({
      key: `camera:${c.id}`,
      lng: c.longitude,
      lat: c.latitude,
      className: classes.join(" "),
      html: `${CAMERA_SVG}${badge}${dot}<span class="pr-label">${escapeHtml(shortName(c.name))}</span>`,
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
      html: `<span class="pr-diamond" aria-hidden="true"><span>${sev.glyph}</span></span>`,
      label: `Incident: ${EVENT_LABEL[i.event_type]}, ${sev.label} severity, ${STATUS_LABEL[i.status]}, ${i.camera.location_label}`,
      select: { kind: "incident", id: i.id },
      z: 3,
    });
  }
  return specs;
}

/** "Saddar - Empress Market (simulated)" → "Saddar" for the map label. */
function shortName(name: string) {
  return name.split(" - ")[0].replace(/\s*\(simulated\)\s*$/i, "");
}

function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}
