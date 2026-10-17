"use client";

import { useMemo, useState } from "react";

import type { Camera, Detection, Incident, SourceType } from "@/lib/api/types";
import { type ActivityEntry, hasFeed, SOURCE_VIEW } from "@/lib/city";
import { confidence, isActiveIncident, pktTime, SEVERITY_VIEW, sortIncidents } from "@/lib/ops";

import { ActivityFeed } from "./CityPanels";
import type { Selection } from "./selection";
import { EventChips, ProvenanceBadge, SeverityTag, StatusChip } from "./ui";

export type RailTab = "cameras" | "review" | "incidents" | "activity";

interface LeftRailProps {
  tab: RailTab;
  onTab: (tab: RailTab) => void;
  cameras: Camera[];
  pending: Detection[];
  incidents: Incident[];
  selection: Selection | null;
  analyzingCameraId: string | null;
  onSelect: (selection: Selection) => void;
  loading: boolean;
  activity?: ActivityEntry[];
}

const ROW =
  "w-full rounded-md border px-3 py-2 text-left focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus";
const rowState = (selected: boolean) =>
  selected ? "border-focus/70 bg-ink-800" : "border-ink-700 bg-ink-850 hover:border-ink-500";

export function LeftRail(props: LeftRailProps) {
  const { tab, onTab, pending, incidents, loading } = props;
  const active = incidents.filter(isActiveIncident).length;
  const tabs: { id: RailTab; label: string; count: number | null; alert?: boolean }[] = [
    { id: "cameras", label: "Cameras", count: null },
    { id: "review", label: "Review", count: pending.length, alert: pending.length > 0 },
    { id: "incidents", label: "Incidents", count: active, alert: active > 0 },
    { id: "activity", label: "Activity", count: null },
  ];

  return (
    <nav aria-label="Operations queues" className="flex h-full min-h-0 flex-col bg-ink-900">
      <div role="tablist" aria-label="Queues" className="grid grid-cols-4 border-b border-ink-700">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            onClick={() => onTab(t.id)}
            className={`flex items-center justify-center gap-1 border-b-2 px-1 py-2.5 text-[13px] font-medium focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus ${
              tab === t.id
                ? "border-focus text-ink-100"
                : "border-transparent text-ink-300 hover:text-ink-100"
            }`}
          >
            {t.label}
            {t.count !== null && (
              <span
                className={`rounded px-1.5 font-mono text-[11px] leading-4 tabular-nums ${
                  t.alert
                    ? t.id === "review"
                      ? "bg-review text-ink-950 motion-safe:animate-pulse"
                      : "bg-sev-high text-ink-950"
                    : "bg-ink-800 text-ink-300"
                }`}
              >
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id={`panel-${tab}`}
        aria-labelledby={`tab-${tab}`}
        className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-3"
      >
        {loading ? (
          <RailSkeleton />
        ) : tab === "cameras" ? (
          <CameraList {...props} />
        ) : tab === "review" ? (
          <ReviewQueue {...props} />
        ) : tab === "incidents" ? (
          <IncidentQueue {...props} />
        ) : (
          <ActivityFeed entries={props.activity ?? []} onSelect={props.onSelect} />
        )}
      </div>
    </nav>
  );
}

function RailSkeleton() {
  return (
    <ul className="grid gap-2" aria-label="Loading">
      {[0, 1, 2, 3].map((i) => (
        <li key={i} className="h-14 animate-pulse rounded-md bg-ink-850" />
      ))}
    </ul>
  );
}

function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-md border border-dashed border-ink-700 px-3 py-6 text-center">
      <p className="text-sm text-ink-100">{title}</p>
      {hint && <p className="mt-1 text-xs text-ink-300">{hint}</p>}
    </div>
  );
}

type SourceFilter = "all" | "feeds" | SourceType;
const FILTERS: { id: SourceFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "feeds", label: "Feeds" },
  { id: "simulated_coverage", label: "Simulated" },
  { id: "verified_mapped", label: "Mapped" },
];

function CameraList({ cameras, pending, incidents, selection, analyzingCameraId, onSelect }: LeftRailProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<SourceFilter>("all");
  const activeByCamera = new Set(incidents.filter(isActiveIncident).map((i) => i.camera.id));
  const pendingCameras = new Set(pending.map((d) => d.camera_id));
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rank = (c: Camera) =>
      pendingCameras.has(c.id) || activeByCamera.has(c.id) ? 0 : hasFeed(c) ? 1 : 2;
    return cameras
      .filter((c) => (filter === "all" ? true : filter === "feeds" ? hasFeed(c) : c.source_type === filter))
      .filter((c) =>
        q
          ? [c.name, c.location_label, c.code, c.district ?? ""].some((v) => v.toLowerCase().includes(q))
          : true,
      )
      .sort((a, b) => rank(a) - rank(b) || a.code.localeCompare(b.code));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameras, query, filter, pending, incidents]);

  if (!cameras.length) return <Empty title="No cameras configured." hint="Run the API seed (python -m app.seed)." />;

  return (
    <>
      <label className="sr-only" htmlFor="camera-search">
        Search cameras
      </label>
      <input
        id="camera-search"
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search camera, district or code"
        className="mb-2 w-full rounded-md border border-ink-700 bg-ink-800 px-3 py-1.5 text-sm placeholder:text-ink-500 focus-visible:outline-2 focus-visible:outline-focus"
      />
      <div role="group" aria-label="Filter cameras by source" className="mb-2 flex flex-wrap gap-1">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            aria-pressed={filter === f.id}
            onClick={() => setFilter(f.id)}
            className={`rounded-sm border px-2 py-0.5 text-xs focus-visible:outline-2 focus-visible:outline-focus ${
              filter === f.id ? "border-focus/70 bg-ink-800 text-ink-100" : "border-ink-700 text-ink-300 hover:border-ink-500"
            }`}
          >
            {f.label}
          </button>
        ))}
        <span className="ml-auto self-center font-mono text-[11px] text-ink-500 tabular-nums">
          {shown.length}/{cameras.length}
        </span>
      </div>
      <ul className="grid grid-cols-1 gap-2">
        {shown.map((c) => {
          const pendingCount = pending.filter((d) => d.camera_id === c.id).length;
          const selected = selection?.kind === "camera" && selection.id === c.id;
          return (
            <li key={c.id}>
              <button
                type="button"
                aria-pressed={selected}
                onClick={() => onSelect({ kind: "camera", id: c.id })}
                className={`${ROW} ${rowState(selected)}`}
              >
                <span className="flex items-start justify-between gap-2">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{c.name}</span>
                    <span className="block truncate text-xs text-ink-300">
                      {c.district ?? c.location_label}
                    </span>
                  </span>
                  <span className="shrink-0 font-mono text-[11px] whitespace-nowrap text-ink-500">{c.code}</span>
                </span>
                <span className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
                  <span className={c.status !== "active" ? "text-ink-500" : hasFeed(c) ? "text-ack" : "text-ink-300"}>
                    {c.status !== "active" ? `○ ${c.status}` : hasFeed(c) ? "● Feed online" : "○ No feed"}
                  </span>
                  {c.source_type === "simulated_coverage" ? (
                    <ProvenanceBadge>Simulated</ProvenanceBadge>
                  ) : (
                    <span className={`rounded-sm border px-1.5 text-[11px] leading-4 uppercase ${SOURCE_VIEW[c.source_type].tone}`}>
                      {SOURCE_VIEW[c.source_type].short}
                    </span>
                  )}
                  {analyzingCameraId === c.id && <span className="text-notified">Analyzing…</span>}
                  {pendingCount > 0 && (
                    <span className="font-medium text-review">
                      {pendingCount} to review
                    </span>
                  )}
                  {activeByCamera.has(c.id) && (
                    <span className="font-medium text-sev-high">◆ Active incident</span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
        {!shown.length && <Empty title="No camera matches the search." />}
      </ul>
    </>
  );
}

function ReviewQueue({ pending, cameras, selection, onSelect }: LeftRailProps) {
  if (!pending.length) {
    return (
      <Empty
        title="No detections awaiting review."
        hint="Start a demo scenario (top bar), or analyze a clip on a camera."
      />
    );
  }
  const cameraName = (id: string) => cameras.find((c) => c.id === id)?.name ?? "Unknown camera";
  return (
    <ul className="grid grid-cols-1 gap-2">
      {pending.map((d) => {
        const selected = selection?.kind === "detection" && selection.id === d.id;
        return (
          <li key={d.id}>
            <button
              type="button"
              aria-pressed={selected}
              onClick={() => onSelect({ kind: "detection", id: d.id })}
              className={`${ROW} border-l-[3px] border-l-review ${rowState(selected)}`}
            >
              <span className="flex items-center justify-between gap-2">
                <EventChips type={d.event_type} />
                <span className="shrink-0 font-mono text-xs whitespace-nowrap text-ink-300">{pktTime(d.detected_at)} PKT</span>
              </span>
              <span className="mt-1 block truncate text-sm">{cameraName(d.camera_id)}</span>
              <span className="mt-0.5 flex items-center gap-2 text-xs text-ink-300">
                <span>
                  Peak confidence <span className="font-mono text-ink-100">{confidence(d.confidence)}</span>
                </span>
                <span className="font-medium text-review">Awaiting review</span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function IncidentQueue({ incidents, selection, onSelect }: LeftRailProps) {
  if (!incidents.length) {
    return <Empty title="No incidents." hint="Incidents appear here after an operator confirms a detection." />;
  }
  const sorted = sortIncidents(incidents);
  const firstClosed = sorted.findIndex((i) => !isActiveIncident(i));
  return (
    <ul className="grid grid-cols-1 gap-2">
      {sorted.map((i, index) => {
        const selected = selection?.kind === "incident" && selection.id === i.id;
        const closed = !isActiveIncident(i);
        return (
          <li key={i.id}>
            {index === firstClosed && (
              <p className="mt-2 mb-1 text-xs font-medium tracking-wider text-ink-500 uppercase">
                Closed
              </p>
            )}
            <button
              type="button"
              aria-pressed={selected}
              onClick={() => onSelect({ kind: "incident", id: i.id })}
              className={`${ROW} border-l-[3px] ${closed ? "border-l-resolved opacity-70" : SEVERITY_VIEW[i.severity].border} ${rowState(selected)}`}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <EventChips type={i.event_type} />
                  <SeverityTag severity={i.severity} />
                </span>
                <StatusChip status={i.status} />
              </span>
              <span className="mt-1 block truncate text-sm">{i.camera.location_label}</span>
              <span className="mt-0.5 flex items-center justify-between gap-2 text-xs text-ink-300">
                <span className="truncate">
                  {i.station_selection
                    ? `Candidate: ${i.station_selection.station.name}`
                    : "No candidate station"}
                </span>
                <span className="shrink-0 font-mono whitespace-nowrap">{pktTime(i.confirmed_at ?? i.created_at)} PKT</span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
