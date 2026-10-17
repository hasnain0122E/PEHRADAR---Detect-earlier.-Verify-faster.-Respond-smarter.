// Display rules for the command center: labels, ordering and copy (Design.md §8, §11, §16).

import type {
  ClassVerdict,
  EventType,
  Incident,
  IncidentStatus,
  Severity,
  TimelineEvent,
} from "@/lib/api/types";

/** Client-side cap: the Vercel proxy accepts ≤ 4.5 MB bodies (lib/server/operatorProxy.ts). */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
/** Matches the API's VIDEO_MAX_SECONDS. */
export const MAX_VIDEO_SECONDS = 60;
export const POLL_MS = 10_000;

export const EVENT_LABEL: Record<EventType, string> = {
  fire: "FIRE",
  smoke: "SMOKE",
  fire_smoke: "FIRE + SMOKE",
};

export const SEVERITY_VIEW: Record<Severity, { glyph: string; label: string; text: string; border: string; bg: string }> = {
  high: { glyph: "▲", label: "HIGH", text: "text-sev-high", border: "border-l-sev-high", bg: "bg-sev-high" },
  medium: { glyph: "◆", label: "MEDIUM", text: "text-sev-medium", border: "border-l-sev-medium", bg: "bg-sev-medium" },
  low: { glyph: "●", label: "LOW", text: "text-sev-low", border: "border-l-sev-low", bg: "bg-sev-low" },
};

export const STATUS_LABEL: Record<IncidentStatus, string> = {
  detected: "Detected",
  confirmed: "Confirmed",
  station_selected: "Station selected",
  notified: "Notified",
  acknowledged: "Acknowledged",
  resolved: "Resolved",
  rejected: "Rejected",
};

export const STATUS_TONE: Record<IncidentStatus, string> = {
  detected: "border-review/60 text-review",
  confirmed: "border-sev-high/60 text-sev-high",
  station_selected: "border-sev-high/60 text-sev-high",
  notified: "border-notified/60 text-notified",
  acknowledged: "border-ack/60 text-ack",
  resolved: "border-resolved text-ink-300",
  rejected: "border-resolved text-ink-300",
};

const CLOSED: IncidentStatus[] = ["resolved", "rejected"];
export const isActiveIncident = (incident: Incident) => !CLOSED.includes(incident.status);

const SEVERITY_RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

/** Unresolved first, then severity, then newest. */
export function sortIncidents(incidents: Incident[]): Incident[] {
  return [...incidents].sort((a, b) => {
    const active = Number(isActiveIncident(b)) - Number(isActiveIncident(a));
    if (active) return active;
    const severity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (severity) return severity;
    return (b.created_at ?? "").localeCompare(a.created_at ?? "");
  });
}

export interface TimelineView {
  label: string;
  /** Tailwind classes for the 2 px left rule and the label colour. */
  tone: string;
}

export function timelineView(event: TimelineEvent): TimelineView {
  switch (event.event_type) {
    case "detection_created":
      return { label: "Detected", tone: "border-l-review text-review" };
    case "operator_confirmed":
      return { label: "Confirmed", tone: "border-l-sev-high text-sev-high" };
    case "station_selected":
      return { label: "Station selected", tone: "border-l-notified text-notified" };
    case "no_station_available":
      return { label: "No station available", tone: "border-l-danger text-danger" };
    case "status_changed": {
      const to = event.details?.to;
      if (to === "notified") return { label: "Notified", tone: "border-l-notified text-notified" };
      if (to === "acknowledged") return { label: "Acknowledged", tone: "border-l-ack text-ack" };
      return { label: "Status changed", tone: "border-l-ink-500 text-ink-100" };
    }
    case "resolved":
      return { label: "Resolved", tone: "border-l-resolved text-ink-300" };
    case "rejected":
      return { label: "Rejected", tone: "border-l-resolved text-ink-300" };
  }
}

const PKT_TIME = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Karachi",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});
const PKT_DATE_TIME = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Karachi",
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function pktTime(iso: string | null | Date): string {
  if (!iso) return "—";
  const date = iso instanceof Date ? iso : new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : PKT_TIME.format(date);
}

export function pktDateTime(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : `${PKT_DATE_TIME.format(date)} PKT`;
}

/** Video offset as mm:ss.s */
export function videoOffset(seconds: number | null | undefined): string {
  if (seconds == null) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${String(m).padStart(2, "0")}:${s.toFixed(1).padStart(4, "0")}`;
}

export const confidence = (value: number) => value.toFixed(2);

/** Highest per-class score seen, even when no class was confirmed. */
export function peakConfidence(classes: Record<string, ClassVerdict>): number | null {
  const values = Object.values(classes).map((c) => c.peak_confidence);
  return values.length ? Math.max(...values) : null;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Client-side checks before upload. Content is validated again by the API. */
export function validateClip(file: File): string | null {
  if (!file.name.toLowerCase().endsWith(".mp4")) return "Choose an .mp4 file.";
  if (file.type && file.type !== "video/mp4") return "The file is not an MP4 video.";
  if (file.size === 0) return "The file is empty.";
  if (file.size > MAX_UPLOAD_BYTES) {
    return `The file is ${formatBytes(file.size)}. The demo limit is ${formatBytes(MAX_UPLOAD_BYTES)}; trim or re-encode it (≤ 30 s, 480p).`;
  }
  return null;
}
