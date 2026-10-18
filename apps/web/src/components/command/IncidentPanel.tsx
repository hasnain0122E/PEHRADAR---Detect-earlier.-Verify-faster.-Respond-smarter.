"use client";

import { useEffect, useState } from "react";

import type { OpsApi } from "@/lib/api/client";
import type { FireStation, IncidentDetail, ResponseUnit, ResponseUnitKind, TimelineEvent } from "@/lib/api/types";
import { FACILITY_LABEL } from "@/lib/city";
import { confidencePct, EVENT_LABEL, pktDateTime, pktTime, SEVERITY_VIEW, timelineView } from "@/lib/ops";
import { categoryOf, RESPONSE_DISCLAIMER, RESPONSE_UNITS, responseUnits, routeOk, UNIT_VIEW } from "@/lib/response";

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
  /** M6C: which suggested routes are drawn while the response view is open. */
  visibleUnits?: Record<ResponseUnitKind, boolean>;
  onToggleUnit?: (unit: ResponseUnitKind) => void;
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

      <SuggestedResponse
        incident={incident}
        onSelectStation={onSelectStation}
        shown={props.routeShown}
        onToggle={props.onToggleRoute}
        visible={props.visibleUnits}
        onToggleUnit={props.onToggleUnit}
      />

      <Timeline events={incident.timeline} />
    </div>
  );
}

const MISSING: Record<ResponseUnitKind, string> = {
  fire: "No fire station is marked available in the demo data.",
  ambulance: "No ambulance facility is marked available in the demo data.",
  police: "No police station is marked available in the demo data.",
};

/** M6C: the three suggested response resources, each with its road estimate and route colour. */
function SuggestedResponse({
  incident,
  onSelectStation,
  shown,
  onToggle,
  visible,
  onToggleUnit,
}: {
  incident: IncidentDetail;
  onSelectStation: (id: string) => void;
  shown: boolean;
  onToggle: () => void;
  visible?: Record<ResponseUnitKind, boolean>;
  onToggleUnit?: (unit: ResponseUnitKind) => void;
}) {
  const units = responseUnits(incident);
  const byUnit = new Map(units.map((u) => [u.unit, u]));
  // Incidents from before M6C only ever had a fire candidate: show that row alone.
  const rows = incident.response_units ? RESPONSE_UNITS : (["fire"] as ResponseUnitKind[]);
  const routed = units.filter((u) => routeOk(u.route));
  const generated = routed[0]?.route;
  return (
    <section aria-labelledby="response-title" className="grid gap-3">
      <SectionTitle>
        <span id="response-title">Suggested response</span>
      </SectionTitle>
      <div className="grid gap-4 rounded-lg border border-line p-4">
        <ul className="grid gap-3">
          {rows.map((unit) => (
            <UnitRow key={unit} unit={unit} entry={byUnit.get(unit)} onSelect={onSelectStation} />
          ))}
        </ul>
        {routed.length > 0 && (
          <div className="grid gap-3">
            <button type="button" aria-pressed={shown} className={shown ? BUTTON_SECONDARY : BUTTON_PRIMARY} onClick={onToggle}>
              <Icon name="route" size={16} />
              {shown ? "Hide routes" : routed.length > 1 ? "Show all routes" : "Show route"}
            </button>
            {shown && visible && onToggleUnit && routed.length > 1 && (
              <div role="group" aria-label="Routes on map" className="flex flex-wrap gap-2">
                {routed.map((u) => (
                  <button
                    key={u.unit}
                    type="button"
                    aria-pressed={visible[u.unit]}
                    onClick={() => onToggleUnit(u.unit)}
                    className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[13px] font-medium transition-colors ${FOCUS} ${
                      visible[u.unit] ? "border-line bg-surface text-fg" : "border-dashed border-line-strong text-fg-3"
                    }`}
                  >
                    <span
                      aria-hidden
                      className="grid h-4 w-4 place-items-center rounded text-white"
                      style={{ background: visible[u.unit] ? UNIT_VIEW[u.unit].color : "var(--color-fg-3)" }}
                    >
                      {visible[u.unit] && <Icon name="check" size={12} />}
                    </span>
                    {UNIT_VIEW[u.unit].label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <Note>{RESPONSE_DISCLAIMER}</Note>
        {generated && routeOk(generated) && (
          <p className="text-xs text-fg-3">
            {generated.provider.toUpperCase()} {generated.profile} estimates on OpenStreetMap roads, {pktTime(generated.generated_at)} PKT.
            Free-flow: no traffic, signals or emergency-vehicle rules. Facility availability is a demo flag.
          </p>
        )}
      </div>
    </section>
  );
}

function UnitRow({
  unit,
  entry,
  onSelect,
}: {
  unit: ResponseUnitKind;
  entry: ResponseUnit | undefined;
  onSelect: (id: string) => void;
}) {
  const view = UNIT_VIEW[unit];
  const route = entry?.route ?? null;
  return (
    <li aria-label={`${view.label} response`} className="grid grid-cols-[32px_1fr_auto] items-center gap-3">
      <span
        aria-hidden
        className="grid h-8 w-8 place-items-center rounded-lg text-white"
        style={{ background: entry ? view.color : "var(--color-fg-3)" }}
      >
        <Icon name={view.icon} size={16} />
      </span>
      <div className="grid min-w-0 gap-0.5">
        <span className="text-xs font-medium" style={{ color: view.color }}>
          {view.label}
        </span>
        {entry ? (
          <button
            type="button"
            onClick={() => onSelect(entry.facility.id)}
            className={`truncate text-left text-[14px] font-semibold underline-offset-2 hover:underline ${FOCUS}`}
            title={entry.facility.name}
          >
            {entry.facility.name}
          </button>
        ) : (
          <span className="text-[13px] text-fg-2">{MISSING[unit]}</span>
        )}
        {entry && !routeOk(route) && (
          <span className="text-xs text-warn-ink">
            Road route unavailable; {entry.distance_km.toFixed(1)} km straight-line
          </span>
        )}
      </div>
      {entry && routeOk(route) && (
        <span className="text-right tabular-nums">
          <span className="block text-[15px] font-semibold">{route.distance_km.toFixed(1)} km</span>
          <span className="block text-xs text-fg-2">{etaMin(route)} min</span>
        </span>
      )}
    </li>
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

const CATEGORY_TAG: Record<"fire" | "ambulance" | "police", string> = {
  fire: "Fire response",
  ambulance: "Ambulance / EMS",
  police: "Police",
};

export function StationPanel({
  station,
  onSetStatus,
}: {
  station: FireStation;
  /** M6B demo toggle: availability changes which station new incidents suggest. */
  onSetStatus?: (status: "available" | "unavailable") => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
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
          <span className="text-[13px] text-fg-2">
            {station.category && station.category !== "fire" ? CATEGORY_TAG[categoryOf(station)] : FACILITY_LABEL[station.facility_type]}
          </span>
          {onSetStatus && (
            <button
              type="button"
              disabled={busy}
              title="Demo availability flag: changes which station new incidents suggest"
              onClick={async () => {
                setBusy(true);
                try {
                  await onSetStatus(available ? "unavailable" : "available");
                } finally {
                  setBusy(false);
                }
              }}
              className={`ml-auto inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-fg-2 hover:bg-muted hover:text-fg disabled:opacity-40 ${FOCUS}`}
            >
              <Icon name="power" size={14} />
              {busy ? "Updating…" : available ? "Mark unavailable" : "Mark available"}
            </button>
          )}
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
