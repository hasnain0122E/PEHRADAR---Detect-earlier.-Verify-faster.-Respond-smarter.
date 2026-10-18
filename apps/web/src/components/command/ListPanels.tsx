"use client";

import { type ReactNode, useMemo, useState } from "react";

import type { Camera, Detection, FacilityCategory, FireStation, Incident, SourceType } from "@/lib/api/types";
import { type ActivityEntry, hasFeed } from "@/lib/city";
import { confidencePct, isActiveIncident, pktTime, sortIncidents, STATUS_LABEL } from "@/lib/ops";
import { categoryOf, responseUnits } from "@/lib/response";

import { Icon } from "../icons";
import { ActivityList } from "./CityPanels";
import type { NavView } from "./NavRail";
import type { Selection } from "./selection";
import { EventLabel, FOCUS, ICON_BUTTON, SectionTitle, Skeleton } from "./ui";

interface ListProps {
  cameras: Camera[];
  stations: FireStation[];
  pending: Detection[];
  incidents: Incident[];
  selection: Selection | null;
  analyzingCameraId: string | null;
  onSelect: (selection: Selection) => void;
  activity: ActivityEntry[];
}

const TITLE: Record<Exclude<NavView, "monitor">, string> = {
  overview: "Overview",
  incidents: "Incidents",
  cameras: "Cameras",
  stations: "Stations",
};

/** Floating list panel over the map, opened from the navigation and closed back to Monitor. */
export function ListPanel({
  view,
  loading,
  onClose,
  ...props
}: ListProps & { view: Exclude<NavView, "monitor">; loading: boolean; onClose: () => void }) {
  return (
    <section
      aria-label={TITLE[view]}
      className="pr-drawer absolute top-4 bottom-4 left-4 z-10 flex w-[320px] max-w-[calc(100%-2rem)] flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-float"
    >
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <h2 className="text-base font-semibold">{TITLE[view]}</h2>
        <button type="button" aria-label={`Close ${TITLE[view].toLowerCase()}`} className={ICON_BUTTON} onClick={onClose}>
          <Icon name="x" size={18} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-2 pb-3">
        {loading ? (
          <div className="grid gap-2 px-2" aria-label="Loading">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : view === "overview" ? (
          <OverviewList {...props} />
        ) : view === "incidents" ? (
          <IncidentList {...props} />
        ) : view === "cameras" ? (
          <CameraList {...props} />
        ) : (
          <StationList {...props} />
        )}
      </div>
    </section>
  );
}

function Row({
  selected,
  onClick,
  title,
  subtitle,
  meta,
  lead,
}: {
  selected: boolean;
  onClick: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  meta?: ReactNode;
  lead?: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors ${FOCUS} ${
        selected ? "bg-info-soft" : "hover:bg-muted"
      }`}
    >
      {lead}
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="truncate text-sm font-medium">{title}</span>
        {subtitle && <span className="truncate text-[13px] text-fg-2">{subtitle}</span>}
      </span>
      {meta && <span className="shrink-0 text-xs text-fg-2">{meta}</span>}
    </button>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-1 pt-3">
      <div className="px-2 pb-1">
        <SectionTitle>{title}</SectionTitle>
      </div>
      <ul className="grid">{children}</ul>
    </section>
  );
}

function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="grid justify-items-center gap-1 px-4 py-8 text-center">
      <p className="text-sm text-fg">{title}</p>
      {hint && <p className="text-[13px] text-fg-2">{hint}</p>}
    </div>
  );
}

const dot = (tone: string) => <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${tone}`} />;

function PendingRows({ pending, cameras, selection, onSelect }: ListProps) {
  const cameraName = (id: string) => cameras.find((c) => c.id === id)?.name ?? "Unknown camera";
  return pending.map((d) => (
    <li key={d.id}>
      <Row
        selected={selection?.kind === "detection" && selection.id === d.id}
        onClick={() => onSelect({ kind: "detection", id: d.id })}
        lead={dot("bg-warn")}
        title={cameraName(d.camera_id)}
        subtitle={
          <span className="flex items-center gap-2">
            <EventLabel type={d.event_type} className="text-[13px] text-fg" /> · {confidencePct(d.confidence)} · awaiting review
          </span>
        }
        meta={pktTime(d.detected_at).slice(0, 5)}
      />
    </li>
  ));
}

/** "Suggested: Landhi Fire Station +2" (the fire candidate first, then ambulance and police). */
function suggested(incident: Incident) {
  const units = responseUnits(incident);
  if (!units.length) return "No response facility available";
  return `Suggested: ${units[0].facility.name}${units.length > 1 ? ` +${units.length - 1}` : ""}`;
}

function IncidentRows({ incidents, selection, onSelect }: { incidents: Incident[] } & Pick<ListProps, "selection" | "onSelect">) {
  return incidents.map((i) => (
    <li key={i.id}>
      <Row
        selected={selection?.kind === "incident" && selection.id === i.id}
        onClick={() => onSelect({ kind: "incident", id: i.id })}
        lead={dot(isActiveIncident(i) ? "bg-fire" : "bg-fg-3")}
        title={i.camera.location_label}
        subtitle={`${STATUS_LABEL[i.status]} · ${suggested(i)}`}
        meta={pktTime(i.confirmed_at ?? i.created_at).slice(0, 5)}
      />
    </li>
  ));
}

function OverviewList(props: ListProps) {
  const active = sortIncidents(props.incidents.filter(isActiveIncident));
  const quiet = !props.pending.length && !active.length;
  return (
    <>
      {quiet ? (
        <Empty title="All quiet." hint="No detections awaiting review and no active incidents." />
      ) : (
        <Group title="Needs attention">
          <PendingRows {...props} />
          <IncidentRows incidents={active} selection={props.selection} onSelect={props.onSelect} />
        </Group>
      )}
      <section className="grid gap-1 pt-3">
        <div className="px-2 pb-1">
          <SectionTitle>Recent activity</SectionTitle>
        </div>
        <ActivityList entries={props.activity.slice(0, 6)} onSelect={props.onSelect} />
      </section>
    </>
  );
}

function IncidentList(props: ListProps) {
  const sorted = sortIncidents(props.incidents);
  const active = sorted.filter(isActiveIncident);
  const closed = sorted.filter((i) => !isActiveIncident(i));
  if (!props.pending.length && !sorted.length) {
    return <Empty title="No incidents." hint="Confirmed detections appear here." />;
  }
  return (
    <>
      {props.pending.length > 0 && (
        <Group title="Awaiting review">
          <PendingRows {...props} />
        </Group>
      )}
      {active.length > 0 && (
        <Group title="Active">
          <IncidentRows incidents={active} selection={props.selection} onSelect={props.onSelect} />
        </Group>
      )}
      {closed.length > 0 && (
        <Group title="Closed">
          <IncidentRows incidents={closed} selection={props.selection} onSelect={props.onSelect} />
        </Group>
      )}
    </>
  );
}

type SourceFilter = "all" | "feeds" | SourceType;
const FILTERS: { id: SourceFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "feeds", label: "With feed" },
  { id: "simulated_coverage", label: "Simulated" },
  { id: "verified_mapped", label: "Mapped" },
];

function CameraList({ cameras, pending, incidents, selection, analyzingCameraId, onSelect }: ListProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<SourceFilter>("all");
  const activeByCamera = useMemo(() => new Set(incidents.filter(isActiveIncident).map((i) => i.camera.id)), [incidents]);
  const pendingCameras = useMemo(() => new Set(pending.map((d) => d.camera_id)), [pending]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rank = (c: Camera) =>
      pendingCameras.has(c.id) || activeByCamera.has(c.id) ? 0 : hasFeed(c) ? 1 : 2;
    return cameras
      .filter((c) => (filter === "all" ? true : filter === "feeds" ? hasFeed(c) : c.source_type === filter))
      .filter((c) =>
        q ? [c.name, c.location_label, c.code, c.district ?? ""].some((v) => v.toLowerCase().includes(q)) : true,
      )
      .sort((a, b) => rank(a) - rank(b) || a.code.localeCompare(b.code));
  }, [cameras, query, filter, pendingCameras, activeByCamera]);

  if (!cameras.length) return <Empty title="No cameras configured." hint="Run the API seed (python -m app.seed)." />;

  return (
    <>
      <div className="grid gap-2 px-2 pb-1">
        <label className="relative">
          <span className="sr-only">Search cameras</span>
          <Icon name="search" size={16} className="pointer-events-none absolute top-2.5 left-3 text-fg-3" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search camera, district or code"
            className={`h-9 w-full rounded-lg border border-line bg-surface pr-3 pl-9 text-sm placeholder:text-fg-3 ${FOCUS}`}
          />
        </label>
        <div role="group" aria-label="Filter cameras by source" className="flex flex-wrap items-center gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
              className={`h-7 rounded-md px-2.5 text-[13px] font-medium ${FOCUS} ${
                filter === f.id ? "bg-navy text-white" : "text-fg-2 hover:bg-muted"
              }`}
            >
              {f.label}
            </button>
          ))}
          <span className="ml-auto text-xs text-fg-3 tabular-nums">{shown.length}</span>
        </div>
      </div>
      <ul className="grid pt-1">
        {shown.map((c) => {
          const state = pendingCameras.has(c.id)
            ? { dot: "bg-warn", meta: "Review" }
            : activeByCamera.has(c.id)
              ? { dot: "bg-fire", meta: "Incident" }
              : analyzingCameraId === c.id
                ? { dot: "bg-info", meta: "Analyzing…" }
                : c.status !== "active"
                  ? { dot: "bg-fg-3", meta: c.status }
                  : hasFeed(c)
                    ? { dot: "bg-ok", meta: "Feed" }
                    : { dot: "bg-line-strong", meta: null };
          return (
            <li key={c.id}>
              <Row
                selected={selection?.kind === "camera" && selection.id === c.id}
                onClick={() => onSelect({ kind: "camera", id: c.id })}
                lead={dot(state.dot)}
                title={c.name}
                subtitle={c.district ?? c.location_label}
                meta={state.meta}
              />
            </li>
          );
        })}
        {!shown.length && <Empty title="No camera matches the search." />}
      </ul>
    </>
  );
}

type FacilityFilter = "all" | FacilityCategory;
const FACILITY_FILTERS: { id: FacilityFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "fire", label: "Fire" },
  { id: "ambulance", label: "Ambulance" },
  { id: "police", label: "Police" },
];
const CATEGORY_DOT: Record<FacilityCategory, string> = { fire: "bg-fire", ambulance: "bg-ok", police: "bg-info" };
const CATEGORY_GROUP: Record<FacilityCategory, string> = {
  fire: "Fire stations",
  ambulance: "Ambulance / EMS",
  police: "Police stations",
};

/** M6C: fire, ambulance and police facilities, grouped by service. */
function StationList({ stations, selection, onSelect }: ListProps) {
  const [filter, setFilter] = useState<FacilityFilter>("all");
  if (!stations.length) return <Empty title="No stations loaded." />;
  const categories = (["fire", "ambulance", "police"] as const).filter((c) => filter === "all" || filter === c);
  return (
    <>
      <div role="group" aria-label="Filter facilities by service" className="flex flex-wrap items-center gap-1 px-2 pb-1">
        {FACILITY_FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            aria-pressed={filter === f.id}
            onClick={() => setFilter(f.id)}
            className={`h-7 rounded-md px-2.5 text-[13px] font-medium ${FOCUS} ${
              filter === f.id ? "bg-navy text-white" : "text-fg-2 hover:bg-muted"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>
      {categories.map((category) => {
        const rows = stations
          .filter((s) => categoryOf(s) === category)
          .sort((a, b) => Number(b.status === "available") - Number(a.status === "available") || a.name.localeCompare(b.name));
        if (!rows.length) return null;
        return (
          <Group key={category} title={`${CATEGORY_GROUP[category]} · ${rows.length}`}>
            {rows.map((s) => (
              <li key={s.id}>
                <Row
                  selected={selection?.kind === "station" && selection.id === s.id}
                  onClick={() => onSelect({ kind: "station", id: s.id })}
                  lead={dot(s.status === "available" ? CATEGORY_DOT[category] : "bg-fg-3")}
                  title={s.name}
                  subtitle={s.location_label}
                  meta={s.status === "available" ? "Available" : "Unavailable"}
                />
              </li>
            ))}
          </Group>
        );
      })}
    </>
  );
}
