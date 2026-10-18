// City-scale views (M5): provenance labels, the status bar counts and the activity feed.
// Everything here is derived from API data; nothing is invented or randomised.

import type {
  Camera,
  Detection,
  FacilityType,
  FireStation,
  Incident,
  MonitoringStatus,
  Scenario,
  SourceType,
} from "@/lib/api/types";
import { EVENT_LABEL, isActiveIncident, SEVERITY_VIEW } from "@/lib/ops";

export const SOURCE_VIEW: Record<SourceType, { label: string; short: string; tone: string }> = {
  public_live: { label: "Public live feed", short: "Public live", tone: "bg-ok-soft text-ok-ink" },
  demo_stream: { label: "Demo stream (simulated)", short: "Demo stream", tone: "bg-info-soft text-info" },
  verified_mapped: { label: "Mapped camera location", short: "Mapped", tone: "bg-muted text-fg" },
  simulated_coverage: { label: "Simulated coverage node", short: "Simulated", tone: "bg-muted text-fg-2" },
};

export const MONITORING_VIEW: Record<MonitoringStatus, { label: string; tone: string }> = {
  monitoring: { label: "Monitoring", tone: "text-ok-ink" },
  simulated: { label: "Simulated coverage", tone: "text-fg-2" },
  not_connected: { label: "Location only", tone: "text-fg-2" },
  offline: { label: "Offline", tone: "text-fg-3" },
  maintenance: { label: "Maintenance", tone: "text-fg-3" },
};

export const FACILITY_LABEL: Record<FacilityType, string> = {
  municipal_fire_station: "Municipal fire station",
  port_fire_station: "Port fire station",
  airport_fire_station: "Airport fire station",
  industrial_fire_station: "Industrial fire station",
  rescue_station: "Rescue station",
  institutional_fire_response: "Institutional fire response",
  fire_station_unclassified: "Fire station (type not recorded)",
};

export const hasFeed = (c: Camera) => c.stream_type !== "none" && !!c.stream_url;

export interface CityStats {
  nodes: number;
  /** Nodes whose status is active (simulated nodes included: this is node status, not a feed). */
  online: number;
  feeds: number;
  feedsOnline: number;
  simulated: number;
  mapped: number;
  pending: number;
  activeIncidents: number;
  availableStations: number;
  stations: number;
}

export function cityStats(
  cameras: Camera[],
  stations: FireStation[],
  pending: Detection[],
  incidents: Incident[],
): CityStats {
  return {
    nodes: cameras.length,
    online: cameras.filter((c) => c.status === "active").length,
    feeds: cameras.filter(hasFeed).length,
    feedsOnline: cameras.filter((c) => hasFeed(c) && c.status === "active").length,
    simulated: cameras.filter((c) => c.source_type === "simulated_coverage").length,
    mapped: cameras.filter((c) => c.source_type === "verified_mapped").length,
    pending: pending.length,
    activeIncidents: incidents.filter(isActiveIncident).length,
    availableStations: stations.filter((s) => s.status === "available").length,
    stations: stations.length,
  };
}

/** Scenario run still waiting for its trigger or being analysed. */
export const isLiveRun = (s: Scenario) =>
  s.latest_run?.status === "scheduled" || s.latest_run?.status === "running";

export type ActivityTone = "info" | "alert" | "incident" | "ok" | "muted";

export interface ActivityEntry {
  key: string;
  at: string;
  text: string;
  tone: ActivityTone;
  code?: string;
  select?: { kind: "camera" | "detection" | "incident"; id: string };
}

/** Operator actions in this console (opening a review, rejecting) that the API does not log. */
export interface LocalEvent {
  key: string;
  at: string;
  text: string;
  tone: ActivityTone;
  select?: ActivityEntry["select"];
}

const EXPECTED: Record<Scenario["expected_behavior"], string> = {
  fire_detected: "fire",
  smoke_detected: "smoke",
  no_detection: "false-alarm lookalike",
};

export function buildActivity(input: {
  cameras: Camera[];
  incidents: Incident[];
  pending: Detection[];
  scenarios: Scenario[];
  local: LocalEvent[];
  limit?: number;
}): ActivityEntry[] {
  const { cameras, incidents, pending, scenarios, local, limit = 40 } = input;
  const byId = new Map(cameras.map((c) => [c.id, c]));
  const entries: ActivityEntry[] = [];
  const push = (e: ActivityEntry | null | false) => {
    if (e && e.at && !Number.isNaN(new Date(e.at).getTime())) entries.push(e);
  };

  for (const s of scenarios) {
    const run = s.latest_run;
    if (!run) continue;
    const camera = byId.get(run.camera_id);
    const code = camera?.code ?? s.camera_code;
    const cam = { kind: "camera" as const, id: run.camera_id };
    push({
      key: `run:${run.id}:start`,
      at: run.created_at ?? run.trigger_at,
      text: `Scenario armed: ${s.name} (${EXPECTED[s.expected_behavior]} demo feed on simulated node)`,
      tone: "muted",
      code,
      select: cam,
    });
    push(
      !!run.triggered_at && {
        key: `run:${run.id}:trigger`,
        at: run.triggered_at,
        text: "Demo feed changed; real detector analysing frames",
        tone: "info",
        code,
        select: cam,
      },
    );
    const r = run.result;
    if (run.completed_at) {
      if (run.status === "detected" && r) {
        push({
          key: `run:${run.id}:done`,
          at: run.completed_at,
          text: `Temporal confirmation passed: ${r.event_type ? EVENT_LABEL[r.event_type] : "event"} ${r.confidence.toFixed(2)}, ${r.positive_frames}/${r.sampled_frames} frames`,
          tone: "alert",
          code,
          select: run.detection_event_id ? { kind: "detection", id: run.detection_event_id } : cam,
        });
      } else if (run.status === "not_detected" && r) {
        const peak = Math.max(0, ...Object.values(r.classes).map((c) => c.peak_confidence));
        push({
          key: `run:${run.id}:done`,
          at: run.completed_at,
          text: `No persistent fire or smoke; temporal rule not met (peak ${peak.toFixed(2)}). No alert raised`,
          tone: "ok",
          code,
          select: cam,
        });
      } else if (run.status === "failed") {
        push({ key: `run:${run.id}:done`, at: run.completed_at, text: `Scenario analysis failed: ${run.error ?? "unknown error"}`, tone: "muted", code, select: cam });
      } else if (run.status === "cancelled") {
        push({ key: `run:${run.id}:done`, at: run.completed_at, text: "Scenario cancelled (demo reset)", tone: "muted", code, select: cam });
      }
    }
  }

  for (const d of pending) {
    const camera = byId.get(d.camera_id);
    push({
      key: `det:${d.id}`,
      at: d.detected_at,
      text: `Possible ${EVENT_LABEL[d.event_type]} detected at ${camera?.location_label ?? "camera"}; operator review required`,
      tone: "alert",
      code: camera?.code,
      select: { kind: "detection", id: d.id },
    });
  }

  for (const i of incidents) {
    const sel = { kind: "incident" as const, id: i.id };
    const code = i.camera.code;
    push(
      !!i.confirmed_at && {
        key: `inc:${i.id}:confirmed`,
        at: i.confirmed_at,
        text: `Incident confirmed by operator: ${EVENT_LABEL[i.event_type]}, ${SEVERITY_VIEW[i.severity].label} severity, ${i.camera.location_label}`,
        tone: "incident",
        code,
        select: sel,
      },
    );
    push(
      !!(i.station_selection && i.confirmed_at) && {
        key: `inc:${i.id}:station`,
        at: i.confirmed_at!,
        text: `Candidate station selected: ${i.station_selection!.station.name} (${i.station_selection!.distance_km.toFixed(1)} km straight-line)`,
        tone: "info",
        code,
        select: sel,
      },
    );
    const route = i.route;
    push(
      !!route && {
        key: `inc:${i.id}:route`,
        at: route.generated_at,
        text:
          route.status === "ok"
            ? `Suggested road route generated: ${route.distance_km.toFixed(1)} km, about ${Math.round(route.duration_min)} min (estimate)`
            : "Road route unavailable; straight-line distance shown",
        tone: route.status === "ok" ? "info" : "muted",
        code,
        select: sel,
      },
    );
    push(
      !!i.resolved_at && {
        key: `inc:${i.id}:resolved`,
        at: i.resolved_at,
        text: `Incident closed (${i.status})`,
        tone: "muted",
        code,
        select: sel,
      },
    );
  }

  for (const e of local) push({ ...e });

  const seen = new Set<string>();
  return entries
    .filter((e) => (seen.has(e.key) ? false : (seen.add(e.key), true)))
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, limit);
}
