"use client";

import { useEffect, useState } from "react";

import type { OpsApi } from "@/lib/api/client";
import type { FireStation, IncidentDetail, IncidentRoute, TimelineEvent } from "@/lib/api/types";
import { FACILITY_LABEL } from "@/lib/city";
import { confidence, EVENT_LABEL, pktDateTime, pktTime, timelineView } from "@/lib/ops";

import { describeError } from "./useOpsData";
import {
  BUTTON_SECONDARY,
  EventChips,
  EvidenceImage,
  Facts,
  InlineError,
  Mono,
  ProvenanceBadge,
  SectionTitle,
  SeverityTag,
  StatusChip,
} from "./ui";

export const CANDIDATE_DISCLAIMER =
  "Candidate station based on geographic proximity. Not a dispatch confirmation.";
export const ROUTE_DISCLAIMER = "Route is an estimate. Not a dispatch confirmation.";

interface IncidentPanelProps {
  incidentId: string;
  /** Changes when the polled list shows a newer version, which triggers a reload. */
  version: string | null;
  initial: IncidentDetail | null;
  api: OpsApi;
  notice: string | null;
  onSelectStation: (id: string) => void;
  /** Reports the loaded detail (the map draws its route geometry). */
  onLoaded?: (detail: IncidentDetail) => void;
}

export function IncidentPanel({ incidentId, version, initial, api, notice, onSelectStation, onLoaded }: IncidentPanelProps) {
  const [loaded, setLoaded] = useState<IncidentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const incident = loaded?.id === incidentId ? loaded : initial?.id === incidentId ? initial : null;

  useEffect(() => {
    const controller = new AbortController();
    api
      .getIncident(incidentId, controller.signal)
      .then((detail) => {
        setLoaded(detail);
        setError(null);
        onLoaded?.(detail);
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setError(describeError(err, "Could not load the incident"));
      });
    return () => controller.abort();
    // onLoaded is a notification only; re-fetching when it changes identity is not wanted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, incidentId, version, attempt]);

  if (!incident) {
    return error ? (
      <div className="grid gap-3">
        <InlineError>{error}</InlineError>
        <button type="button" className={BUTTON_SECONDARY} onClick={() => setAttempt((n) => n + 1)}>
          Retry
        </button>
      </div>
    ) : (
      <div className="grid gap-3" aria-label="Loading incident">
        <div className="h-6 w-2/3 animate-pulse rounded bg-ink-850" />
        <div className="aspect-video animate-pulse rounded-md bg-ink-850" />
        <div className="h-24 animate-pulse rounded bg-ink-850" />
      </div>
    );
  }

  const selection = incident.station_selection;
  return (
    <div className="grid gap-4">
      {notice && (
        <p role="status" className="rounded-md border border-ack/50 bg-ack/10 px-3 py-2 text-sm text-ack">
          ✓ {notice}
        </p>
      )}
      <header>
        <p className="text-xs font-medium tracking-wider text-ink-300 uppercase">Incident</p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <EventChips type={incident.event_type} />
          <SeverityTag severity={incident.severity} />
          <StatusChip status={incident.status} />
          {incident.is_simulated && <ProvenanceBadge>Simulated</ProvenanceBadge>}
        </div>
        <h2 className="mt-2 text-lg font-semibold">{incident.camera.location_label}</h2>
        <p className="text-sm text-ink-300">{incident.camera.name}</p>
      </header>

      {error && <InlineError>Showing the last loaded version: {error}</InlineError>}

      <EvidenceImage
        key={incident.evidence_url ?? "none"}
        src={api.evidenceSrc(incident.evidence_url)}
        alt={`Evidence frame for the ${EVENT_LABEL[incident.event_type].toLowerCase()} incident at ${incident.camera.location_label}`}
      />

      <Facts
        rows={[
          ["Detection confidence", <Mono key="c">{confidence(incident.detection.confidence)}</Mono>],
          ["Confirmed", `${pktDateTime(incident.confirmed_at)}${incident.confirmed_by ? ` by ${incident.confirmed_by}` : ""}`],
          [
            "Coordinates",
            <Mono key="x">
              {incident.latitude.toFixed(4)}, {incident.longitude.toFixed(4)}
            </Mono>,
          ],
          ["Severity rule", "Set by the API from event type and confidence"],
        ]}
      />

      <section aria-labelledby="station-title" className="grid gap-2 rounded-md border border-ink-700 bg-ink-850 p-3">
        <SectionTitle>
          <span id="station-title">Candidate fire station</span>
        </SectionTitle>
        {selection ? (
          <>
            <StationSummary
              station={selection.station}
              distanceKm={selection.distance_km}
              onSelect={() => onSelectStation(selection.station.id)}
            />
            <RouteSummary route={incident.route} />
          </>
        ) : (
          <p className="text-sm text-review">
            No fire station is marked available in the demo data, so no candidate was selected.
          </p>
        )}
        <p className="border-l-2 border-notified pl-3 text-sm">{CANDIDATE_DISCLAIMER}</p>
      </section>

      <Timeline events={incident.timeline} />
    </div>
  );
}

function RouteSummary({ route }: { route: IncidentRoute | null }) {
  if (!route) {
    return <p className="text-xs text-ink-300">No suggested road route recorded for this incident.</p>;
  }
  if (route.status !== "ok") {
    return (
      <div className="grid gap-1 border-t border-ink-700 pt-2">
        <p className="text-xs font-medium tracking-wider text-ink-300 uppercase">Suggested response route</p>
        <p className="text-sm text-review">Road route unavailable; straight-line distance shown.</p>
        <p className="text-xs text-ink-300">{route.reason}</p>
      </div>
    );
  }
  return (
    <div className="grid gap-2 border-t border-ink-700 pt-2">
      <p className="flex items-center gap-2 text-xs font-medium tracking-wider text-notified uppercase">
        <span aria-hidden className="legend-route" /> Suggested response route
      </p>
      <dl className="grid grid-cols-2 gap-2">
        <div className="rounded-sm border border-ink-700 bg-ink-900 px-2.5 py-1.5">
          <dt className="text-[11px] text-ink-300">Road distance</dt>
          <dd className="font-mono text-lg font-semibold tabular-nums">{route.distance_km.toFixed(1)} km</dd>
        </div>
        <div className="rounded-sm border border-ink-700 bg-ink-900 px-2.5 py-1.5">
          <dt className="text-[11px] text-ink-300">Estimated travel</dt>
          <dd className="font-mono text-lg font-semibold tabular-nums">{Math.max(1, Math.round(route.duration_min))} min</dd>
        </div>
      </dl>
      <p className="text-[11px] text-ink-500">
        {route.provider.toUpperCase()} {route.profile} estimate on OpenStreetMap roads, generated{" "}
        {pktTime(route.generated_at)} PKT. Free-flow travel time: no traffic, signals or
        emergency-vehicle rules.
      </p>
      <p className="border-l-2 border-notified pl-3 text-sm">{ROUTE_DISCLAIMER}</p>
    </div>
  );
}

function StationSummary({
  station,
  distanceKm,
  onSelect,
}: {
  station: FireStation;
  distanceKm: number;
  onSelect: () => void;
}) {
  return (
    <div className="grid gap-1">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={onSelect}
          className="text-left text-sm font-medium underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-focus"
        >
          {station.name}
        </button>
        <ProvenanceBadge>
          {station.data_source.toUpperCase()} · {station.verification_status}
        </ProvenanceBadge>
      </div>
      <p className="text-xs text-ink-300">{FACILITY_LABEL[station.facility_type]}</p>
      <p className="text-sm">
        <Mono>{distanceKm.toFixed(2)} km</Mono>{" "}
        <span className="text-ink-300">straight-line distance (not a driving route or ETA)</span>
      </p>
      <p className="text-xs text-ink-300">{station.status_note}</p>
    </div>
  );
}

function elapsed(from: string, to: string): string | null {
  const ms = new Date(to).getTime() - new Date(from).getTime();
  if (!Number.isFinite(ms) || ms < 1000) return null;
  const s = Math.round(ms / 1000);
  if (s < 60) return `+${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `+${m}m ${s % 60}s`;
  return `+${Math.floor(m / 60)}h ${m % 60}m`;
}

export function Timeline({ events }: { events: TimelineEvent[] }) {
  const ordered = [...events].sort((a, b) => a.seq - b.seq);
  return (
    <section aria-labelledby="timeline-title" className="grid gap-2">
      <SectionTitle>
        <span id="timeline-title">Timeline</span>
      </SectionTitle>
      <ol className="grid gap-1">
        {ordered.map((event, index) => {
          const view = timelineView(event);
          const gap = index > 0 ? elapsed(ordered[index - 1].occurred_at, event.occurred_at) : null;
          return (
            <li key={event.id}>
              {gap && <span className="ml-3 font-mono text-[11px] text-ink-500">{gap}</span>}
              <div className={`border-l-2 py-1 pl-3 ${view.tone.split(" ")[0]}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className={`text-sm font-medium ${view.tone.split(" ")[1]}`}>
                    {view.label}
                    {event.event_type === "detection_created" && (
                      <span className="ml-1 text-xs font-normal text-ink-500">(detected)</span>
                    )}
                  </span>
                  <span className="font-mono text-xs text-ink-300">{pktTime(event.occurred_at)} PKT</span>
                </div>
                <p className="text-xs text-ink-300">
                  <span className="text-ink-500">
                    {event.actor === "system" ? "⚙ System" : `● ${event.actor_label ?? "Operator"}`} ·{" "}
                  </span>
                  {event.message}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export function StationPanel({ station }: { station: FireStation }) {
  const osm = station.source_ref?.match(/^osm:(node|way|relation)\/(\d+)$/);
  return (
    <div className="grid gap-4">
      <header>
        <p className="text-xs font-medium tracking-wider text-ink-300 uppercase">Fire station</p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold">{station.name}</h2>
          <ProvenanceBadge>
            {station.data_source.toUpperCase()} · {station.verification_status}
          </ProvenanceBadge>
        </div>
        <p className="text-sm text-ink-300">{station.location_label}</p>
      </header>
      <Facts
        rows={[
          [
            "Status (demo)",
            <span key="s" className={station.status === "available" ? "text-ack" : "text-ink-300"}>
              {station.status === "available" ? "● Available" : "× Unavailable"}
            </span>,
          ],
          ["Code", <Mono key="c">{station.code}</Mono>],
          ["Facility type", `${FACILITY_LABEL[station.facility_type]} (inferred from OSM name/operator)`],
          ["Operator", station.operator ?? "Not recorded in the source"],
          [
            "Coordinates",
            <Mono key="x">
              {station.latitude.toFixed(4)}, {station.longitude.toFixed(4)}
            </Mono>,
          ],
          [
            "Source",
            osm ? (
              <a
                key="o"
                className="underline underline-offset-2"
                href={`https://www.openstreetmap.org/${osm[1]}/${osm[2]}`}
                target="_blank"
                rel="noreferrer"
              >
                OpenStreetMap {osm[1]}/{osm[2]}
              </a>
            ) : (
              (station.source_ref ?? station.data_source)
            ),
          ],
          ["Licence", station.licence ?? "—"],
        ]}
      />
      <p className="border-l-2 border-sim pl-3 text-sm text-ink-300">
        {station.status_note} The location comes from OpenStreetMap and has not been verified with
        the fire department.
      </p>
    </div>
  );
}
