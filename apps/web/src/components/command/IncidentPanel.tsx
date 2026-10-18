"use client";

import { useEffect, useState } from "react";

import type { OpsApi } from "@/lib/api/client";
import type { FireStation, IncidentDetail, IncidentRoute, TimelineEvent } from "@/lib/api/types";
import { FACILITY_LABEL } from "@/lib/city";
import { confidencePct, EVENT_LABEL, pktDateTime, pktTime, SEVERITY_VIEW, timelineView } from "@/lib/ops";

import { Icon } from "../icons";
import { describeError } from "./useOpsData";
import {
  BUTTON_PRIMARY,
  BUTTON_SECONDARY,
  Disclosure,
  EvidenceImage,
  Facts,
  FOCUS,
  InlineError,
  Mono,
  Note,
  ProvenanceBadge,
  SectionTitle,
  Skeleton,
  StatusChip,
  Tag,
} from "./ui";

export const CANDIDATE_DISCLAIMER =
  "Candidate station based on geographic proximity. Not a dispatch confirmation.";
export const ROUTE_DISCLAIMER = "Suggested response route. Estimate only — not a dispatch confirmation.";

export const etaMin = (route: { duration_min: number }) => Math.max(1, Math.round(route.duration_min));

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
  routeShown: boolean;
  onToggleRoute: () => void;
}

const INCIDENT_TITLE: Record<IncidentDetail["event_type"], string> = {
  fire: "Fire incident",
  smoke: "Smoke incident",
  fire_smoke: "Fire incident",
};

export function IncidentPanel(props: IncidentPanelProps) {
  const { incidentId, version, initial, api, notice, onSelectStation, onLoaded } = props;
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
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="aspect-video" />
        <Skeleton className="h-24" />
      </div>
    );
  }

  const selection = incident.station_selection;
  const sev = SEVERITY_VIEW[incident.severity];
  return (
    <div className="grid gap-6">
      {notice && (
        <p role="status" className="flex items-start gap-2 rounded-lg bg-ok-soft px-3 py-2.5 text-[13px] text-ok-ink">
          <Icon name="check" size={16} className="mt-0.5" />
          {notice}
        </p>
      )}

      <header className="grid gap-2">
        <div className="flex items-center justify-between gap-3">
          <p
            aria-label={EVENT_LABEL[incident.event_type]}
            className="flex items-center gap-1.5 text-[13px] font-semibold tracking-wide text-fire-ink uppercase"
          >
            <Icon name="flame" size={16} />
            {INCIDENT_TITLE[incident.event_type]}
          </p>
          <span className={`text-[13px] font-semibold tracking-wide ${sev.text}`}>{sev.label}</span>
        </div>
        <h2 className="text-lg leading-6 font-semibold">{incident.camera.location_label}</h2>
        <p className="flex flex-wrap items-center gap-2 text-[13px] text-fg-2">
          <Mono>
            {incident.latitude.toFixed(4)}, {incident.longitude.toFixed(4)}
          </Mono>
          <StatusChip status={incident.status} />
          {incident.is_simulated && <ProvenanceBadge>Simulated</ProvenanceBadge>}
        </p>
      </header>

      {error && <InlineError>Showing the last loaded version: {error}</InlineError>}

      <div className="grid grid-cols-[9rem_1fr] items-start gap-4">
        <EvidenceImage
          compact
          key={incident.evidence_url ?? "none"}
          src={api.evidenceSrc(incident.evidence_url)}
          alt={`Evidence frame for the ${EVENT_LABEL[incident.event_type].toLowerCase()} incident at ${incident.camera.location_label}`}
        />
        <dl className="grid gap-2 text-[13px]">
          <div>
            <dt className="text-xs text-fg-2">AI confidence</dt>
            <dd className="font-semibold tabular-nums">{confidencePct(incident.detection.confidence)}</dd>
          </div>
          <div>
            <dt className="text-xs text-fg-2">Confirmed</dt>
            <dd>{pktDateTime(incident.confirmed_at)}</dd>
          </div>
          <div>
            <dt className="text-xs text-fg-2">Camera</dt>
            <dd className="truncate">{incident.camera.name}</dd>
          </div>
        </dl>
      </div>

      <section aria-labelledby="station-title" className="grid gap-3">
        <SectionTitle>
          <span id="station-title">Response facility</span>
        </SectionTitle>
        {selection ? (
          <div className="grid gap-4 rounded-lg border border-line p-4">
            <StationSummary
              station={selection.station}
              distanceKm={selection.distance_km}
              onSelect={() => onSelectStation(selection.station.id)}
            />
            <RouteSummary route={incident.route} shown={props.routeShown} onToggle={props.onToggleRoute} />
          </div>
        ) : (
          <p className="rounded-lg bg-warn-soft px-3 py-2.5 text-[13px] text-warn-ink">
            No fire station is marked available in the demo data, so no candidate was selected.
          </p>
        )}
      </section>

      <Timeline events={incident.timeline} />
    </div>
  );
}

function RouteSummary({ route, shown, onToggle }: { route: IncidentRoute | null; shown: boolean; onToggle: () => void }) {
  if (!route) {
    return <Note>{CANDIDATE_DISCLAIMER}</Note>;
  }
  if (route.status !== "ok") {
    return (
      <div className="grid gap-2">
        <p className="text-[13px] text-warn-ink">Road route unavailable; straight-line distance shown.</p>
        <Note>{CANDIDATE_DISCLAIMER}</Note>
      </div>
    );
  }
  return (
    <div className="grid gap-3">
      <dl className="grid grid-cols-2 gap-3">
        <div className="grid gap-0.5">
          <dt className="text-xs text-fg-2">Road distance</dt>
          <dd className="text-[22px] leading-7 font-semibold tabular-nums">{route.distance_km.toFixed(1)} km</dd>
        </div>
        <div className="grid gap-0.5">
          <dt className="text-xs text-fg-2">Estimated travel</dt>
          <dd className="text-[22px] leading-7 font-semibold tabular-nums">{etaMin(route)} min</dd>
        </div>
      </dl>
      <button type="button" aria-pressed={shown} className={shown ? BUTTON_SECONDARY : BUTTON_PRIMARY} onClick={onToggle}>
        <Icon name="route" size={16} />
        {shown ? "Hide route" : "Show route"}
      </button>
      <Note>{ROUTE_DISCLAIMER}</Note>
      <p className="text-xs text-fg-3">
        {route.provider.toUpperCase()} {route.profile} estimate on OpenStreetMap roads, {pktTime(route.generated_at)} PKT.
        Free-flow: no traffic, signals or emergency-vehicle rules.
      </p>
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
    <div className="flex items-start justify-between gap-3">
      <div className="grid gap-0.5">
        <button
          type="button"
          onClick={onSelect}
          className={`text-left text-[15px] font-semibold underline-offset-2 hover:underline ${FOCUS}`}
        >
          {station.name}
        </button>
        <p className="text-[13px] text-fg-2">
          <span className="tabular-nums">{distanceKm.toFixed(2)} km</span> straight-line distance (not a driving route or ETA)
        </p>
      </div>
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-ok-soft text-ok-ink">
        <Icon name="station" size={16} />
      </span>
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

/** Vertical sequence of the states that actually occurred (from the API timeline). */
export function Timeline({ events }: { events: TimelineEvent[] }) {
  const ordered = [...events].sort((a, b) => a.seq - b.seq);
  return (
    <section aria-labelledby="timeline-title" className="grid gap-3">
      <SectionTitle>
        <span id="timeline-title">Timeline</span>
      </SectionTitle>
      <ol className="grid">
        {ordered.map((event, index) => {
          const view = timelineView(event);
          const gap = index > 0 ? elapsed(ordered[index - 1].occurred_at, event.occurred_at) : null;
          const last = index === ordered.length - 1;
          return (
            <li key={event.id} className="grid grid-cols-[16px_1fr] gap-3">
              <span className="relative flex justify-center">
                <span aria-hidden className={`relative z-10 mt-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-surface ${view.tone}`} />
                {!last && <span aria-hidden className="absolute top-3 bottom-0 w-px bg-line" />}
              </span>
              <div className={last ? "" : "pb-4"}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-medium">{view.label}</span>
                  <span className="shrink-0 text-xs text-fg-2 tabular-nums">
                    {gap && <span className="mr-2 text-fg-3">{gap}</span>}
                    {pktTime(event.occurred_at)}
                  </span>
                </div>
                <p className="line-clamp-2 text-[13px] text-fg-2" title={event.message}>
                  {event.message}
                  <span className="text-fg-3"> · {event.actor === "system" ? "System" : (event.actor_label ?? "Operator")}</span>
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
  const available = station.status === "available";
  return (
    <div className="grid gap-6">
      <header className="grid gap-2">
        <h2 className="text-lg leading-6 font-semibold">{station.name}</h2>
        <p className="flex items-center gap-1.5 text-sm text-fg-2">
          <Icon name="pin" size={16} className="text-fg-3" />
          {station.location_label}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Tag tone={available ? "bg-ok-soft text-ok-ink" : "bg-muted text-fg-2"}>
            {available ? "Available" : "Unavailable"}
          </Tag>
          <span className="text-[13px] text-fg-2">{FACILITY_LABEL[station.facility_type]}</span>
        </div>
      </header>
      <Facts
        rows={[
          [
            "Coordinates",
            <Mono key="x">
              {station.latitude.toFixed(4)}, {station.longitude.toFixed(4)}
            </Mono>,
          ],
          ["Operator", station.operator ?? "Not recorded"],
          ["Code", <Mono key="c">{station.code}</Mono>],
        ]}
      />
      <Note>{station.status_note}</Note>
      <Disclosure summary="Data source">
        <Facts
          rows={[
            [
              "Source",
              osm ? (
                <a
                  key="o"
                  className="text-info underline-offset-2 hover:underline"
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
            ["Verification", `${station.data_source.toUpperCase()} · ${station.verification_status}`],
            ["Licence", station.licence ?? "—"],
            ["Facility type", "Inferred from OSM name/operator"],
          ]}
        />
        <p className="text-xs text-fg-3">
          The location comes from OpenStreetMap and has not been verified with the fire department.
        </p>
      </Disclosure>
    </div>
  );
}
