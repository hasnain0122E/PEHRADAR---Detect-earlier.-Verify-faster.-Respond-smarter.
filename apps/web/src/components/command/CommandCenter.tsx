"use client";

import { type ComponentType, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import type { OpsApi } from "@/lib/api/client";
import type { Camera, Detection, Incident, IncidentDetail, Scenario } from "@/lib/api/types";
import { buildActivity, cityStats, isLiveRun, type LocalEvent } from "@/lib/city";
import { confidencePct, isActiveIncident } from "@/lib/ops";

import { Icon } from "../icons";
import { boundsOf, type MapFocus, type MapView, OpsMap, type OpsMapProps, prefersReducedMotion } from "../map/OpsMap";
import { useApiHealth } from "../useApiHealth";
import { type FeedOverride, feedMode } from "./CameraFeed";
import { type AnalysisState, CameraPanel, isRunning } from "./CameraPanel";
import { ActivityList, DemoDialog, liveScenarioLabel, StatusStrip } from "./CityPanels";
import { DetectionReview } from "./DetectionReview";
import { etaMin, IncidentPanel, StationPanel } from "./IncidentPanel";
import { ListPanel } from "./ListPanels";
import { type NavView, NavRail } from "./NavRail";
import type { Selection } from "./selection";
import { ALL_ZONES, SettingsDialog, TopBar } from "./TopBar";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, FOCUS, ICON_BUTTON, InlineError, Skeleton } from "./ui";
import { useAlertSound } from "./useAlertSound";
import { describeError, useOpsData } from "./useOpsData";
import { useScenarios } from "./useScenarios";

interface Alert {
  id: string;
  kind: "detection" | "incident";
  title: string;
  location: string;
  detail: string | null;
  select: Selection;
}

// Only ever called from event handlers.
const timestamp = () => Date.now();
const isoNow = () => new Date().toISOString();
const noopSubscribe = () => () => {};

/** Scenario clip currently shown on a demo-stream node (after its trigger, until reset). */
function scenarioOverride(scenarios: Scenario[], cameraId: string, mediaSrc: (u: string) => string | null): FeedOverride | null {
  const s = scenarios.find((x) => x.camera_id === cameraId && x.latest_run?.triggered_at);
  const run = s?.latest_run;
  if (!s || !run || run.status === "cancelled" || run.status === "scheduled") return null;
  const src = mediaSrc(run.video_url);
  return src
    ? { src, note: `Scenario clip “${s.name}”: licensed sample footage on a simulated node. Not Karachi CCTV.` }
    : null;
}

const EVENT_WORD = { fire: "fire", smoke: "smoke", fire_smoke: "fire and smoke" } as const;

export interface CommandCenterProps {
  api: OpsApi;
  apiBaseUrl: string;
  /** Injected in tests (MapLibre needs WebGL, which jsdom lacks). */
  MapComponent?: ComponentType<OpsMapProps>;
  fetchImpl?: typeof fetch;
}

export function CommandCenter({ api, apiBaseUrl, MapComponent = OpsMap, fetchImpl }: CommandCenterProps) {
  const { state: health, recheck } = useApiHealth(apiBaseUrl, fetchImpl);
  const sound = useAlertSound();
  const [selection, setSelection] = useState<Selection | null>(null);
  const [nav, setNav] = useState<NavView>("monitor");
  const [demoOpen, setDemoOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const reducedMotion = useSyncExternalStore(noopSubscribe, prefersReducedMotion, () => false);
  const [viewChoice, setViewChoice] = useState<MapView | null>(null);
  const view = viewChoice ?? (reducedMotion ? "2d" : "3d");
  const [zone, setZone] = useState(ALL_ZONES);
  const [routeFor, setRouteFor] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisState | null>(null);
  const [detections, setDetections] = useState<Record<string, Detection>>({});
  const [confirmed, setConfirmed] = useState<IncidentDetail | null>(null);
  const [notice, setNotice] = useState<{ incidentId: string; text: string } | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [detectionError, setDetectionError] = useState<string | null>(null);
  const [localEvents, setLocalEvents] = useState<LocalEvent[]>([]);
  const [incidentDetail, setIncidentDetail] = useState<IncidentDetail | null>(null);
  const [focus, setFocus] = useState<MapFocus | null>(null);
  const selectionRef = useRef<Selection | null>(null);
  useEffect(() => {
    selectionRef.current = selection;
  });
  const logLocal = useCallback((event: Omit<LocalEvent, "at">) => {
    setLocalEvents((prev) => [{ ...event, at: isoNow() }, ...prev].slice(0, 30));
  }, []);

  // Ids already known, so only genuinely new items raise an alert. null until the first load.
  const seen = useRef<Set<string> | null>(null);
  const camerasRef = useRef<Camera[]>([]);
  const playRef = useRef(sound.play);
  useEffect(() => {
    playRef.current = sound.play;
  });

  const raise = useCallback((alert: Alert) => {
    setAlerts((prev) => [alert, ...prev.filter((a) => a.id !== alert.id)].slice(0, 3));
    playRef.current();
  }, []);
  const dismiss = useCallback((id: string) => setAlerts((prev) => prev.filter((a) => a.id !== id)), []);

  const onUpdate = useCallback(
    ({ incidents, pending }: { incidents: Incident[]; pending: Detection[] }) => {
      const ids = [...pending.map((d) => `d:${d.id}`), ...incidents.map((i) => `i:${i.id}`)];
      if (seen.current === null) {
        seen.current = new Set(ids);
        return;
      }
      const known = seen.current;
      for (const d of pending) {
        if (known.has(`d:${d.id}`)) continue;
        known.add(`d:${d.id}`);
        const camera = camerasRef.current.find((c) => c.id === d.camera_id);
        // Fly to the alert unless the operator is in the middle of another review or incident.
        const busy = selectionRef.current?.kind === "detection" || selectionRef.current?.kind === "incident";
        if (camera && !busy) setFocus({ key: d.id, lng: camera.longitude, lat: camera.latitude });
        raise({
          id: `d:${d.id}`,
          kind: "detection",
          title: `Possible ${EVENT_WORD[d.event_type]} detected`,
          location: camera?.location_label ?? "Unknown camera",
          detail: `AI confidence ${confidencePct(d.confidence)}`,
          select: { kind: "detection", id: d.id },
        });
      }
      for (const i of incidents) {
        if (known.has(`i:${i.id}`)) continue;
        known.add(`i:${i.id}`);
        raise({
          id: `i:${i.id}`,
          kind: "incident",
          title: `New ${EVENT_WORD[i.event_type]} incident`,
          location: i.camera.location_label,
          detail: null,
          select: { kind: "incident", id: i.id },
        });
      }
    },
    [raise],
  );

  const { data, refresh } = useOpsData(api, onUpdate);
  // A finished scenario run may have stored a detection: load it now, not at the next poll.
  const { scenarios, start: startScenario, reset: resetScenarioData } = useScenarios(api, () => void refresh());
  // A reset closes scenario detections and incidents: show that at once, not at the next poll.
  const resetScenarios = useCallback(async () => {
    const result = await resetScenarioData();
    await refresh();
    setAlerts([]);
    return result;
  }, [resetScenarioData, refresh]);
  useEffect(() => {
    camerasRef.current = data.cameras;
  }, [data.cameras]);

  const select = useCallback(
    (next: Selection | null) => {
      setSelection(next);
      setDetectionError(null);
      if (next?.kind !== "incident") setNotice(null);
      if (next?.kind === "detection") {
        logLocal({ key: `local:review:${next.id}:${timestamp()}`, text: "Operator opened evidence review", tone: "info", select: next });
      }
    },
    [logLocal],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !(e.target instanceof HTMLInputElement)) setSelection(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // The reviewed copy wins over a stale poll; otherwise the polled pending list is current.
  const selectedDetection = useMemo(() => {
    if (selection?.kind !== "detection") return null;
    const cached = detections[selection.id];
    if (cached && cached.review_status !== "pending") return cached;
    return data.pending.find((d) => d.id === selection.id) ?? cached ?? null;
  }, [selection, detections, data.pending]);

  // A detection that is neither pending nor cached (e.g. reviewed elsewhere) is fetched.
  const missingDetectionId =
    selection?.kind === "detection" && !selectedDetection && data.status === "ready" ? selection.id : null;
  useEffect(() => {
    if (!missingDetectionId) return;
    const controller = new AbortController();
    api
      .getDetection(missingDetectionId, controller.signal)
      .then((d) => setDetections((prev) => ({ ...prev, [d.id]: d })))
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setDetectionError(describeError(err, "Could not load the detection"));
      });
    return () => controller.abort();
  }, [api, missingDetectionId]);

  async function analyze(camera: Camera, file: File) {
    const base = { cameraId: camera.id, fileName: file.name };
    const startedAt = timestamp();
    setAnalysis({ ...base, phase: "uploading", loaded: 0, total: file.size, startedAt });
    try {
      const result = await api.analyzeFootage(camera.id, file, {
        onUploadProgress: ({ loaded, total }) =>
          setAnalysis((a) => (a?.phase === "uploading" ? { ...a, loaded, total } : a)),
        onUploaded: () => setAnalysis({ ...base, phase: "analyzing", startedAt }),
      });
      if (result.status === "detected" && result.detection_event_id) {
        const id = result.detection_event_id;
        seen.current?.add(`d:${id}`);
        let detection: Detection;
        try {
          detection = await api.getDetection(id);
        } catch (err) {
          setAnalysis({
            ...base,
            phase: "error",
            message: `A detection was stored and is waiting under Incidents › Awaiting review, but loading it failed (${describeError(err, "unknown error")}).`,
          });
          void refresh();
          return;
        }
        setDetections((prev) => ({ ...prev, [id]: detection }));
        setAnalysis(null);
        // The evidence drawer opens directly, so the alert is the sound only.
        select({ kind: "detection", id });
        playRef.current();
        void refresh();
      } else {
        setAnalysis({ ...base, phase: "negative", result });
      }
    } catch (err) {
      setAnalysis({ ...base, phase: "error", message: describeError(err, "Unexpected error") });
    }
  }

  async function confirmDetection(d: Detection) {
    const incident = await api.confirmDetection(d.id);
    seen.current?.add(`i:${incident.id}`);
    setDetections((prev) => ({ ...prev, [d.id]: { ...d, review_status: "confirmed" } }));
    dismiss(`d:${d.id}`);
    setConfirmed(incident);
    setIncidentDetail(incident);
    select({ kind: "incident", id: incident.id });
    setNotice({
      incidentId: incident.id,
      text: incident.station_selection
        ? `Incident created. ${incident.station_selection.station.name} suggested. No dispatch was sent.`
        : "Incident created. No fire station is marked available in the demo data.",
    });
    void refresh();
  }

  async function rejectDetection(d: Detection, note: string) {
    const updated = await api.rejectDetection(d.id, note ? { note } : {});
    setDetections((prev) => ({ ...prev, [d.id]: updated }));
    const code = data.cameras.find((c) => c.id === d.camera_id)?.code;
    logLocal({
      key: `local:reject:${d.id}`,
      text: `${code ? `${code}: ` : ""}Operator rejected the detection${note ? ` (“${note}”)` : ""}; no incident created`,
      tone: "muted",
      select: { kind: "detection", id: d.id },
    });
    dismiss(`d:${d.id}`);
    void refresh();
  }

  const activeIncidents = data.incidents.filter(isActiveIncident).length;
  const stats = useMemo(
    () => cityStats(data.cameras, data.stations, data.pending, data.incidents),
    [data.cameras, data.stations, data.pending, data.incidents],
  );
  const activity = useMemo(
    () =>
      buildActivity({
        cameras: data.cameras,
        incidents: data.incidents,
        pending: data.pending,
        scenarios: scenarios.items,
        local: localEvents,
      }),
    [data.cameras, data.incidents, data.pending, scenarios.items, localEvents],
  );
  const zones = useMemo(
    () => [...new Set(data.cameras.map((c) => c.district).filter((d): d is string => !!d))].sort(),
    [data.cameras],
  );
  const scenarioCameraIds = useMemo(
    () => scenarios.items.filter((s) => s.latest_run?.status === "running" && s.camera_id).map((s) => s.camera_id!),
    [scenarios.items],
  );
  const mediaSrc = (url: string) => api.mediaSrc(url);
  const feedFor = (camera: Camera) =>
    feedMode(camera, (u) => api.mediaSrc(u), scenarioOverride(scenarios.items, camera.id, mediaSrc));
  const lastActivityFor = (cameraId: string) => {
    const times = [
      ...data.pending.filter((d) => d.camera_id === cameraId).map((d) => d.detected_at),
      ...data.incidents.filter((i) => i.camera.id === cameraId).map((i) => i.updated_at ?? i.created_at ?? ""),
    ].filter(Boolean);
    return times.sort().at(-1) ?? null;
  };
  const scenarioNoteFor = (cameraId: string) => {
    const s = scenarios.items.find((x) => x.camera_id === cameraId);
    return s ? `Demo scenario “${s.name}” plays licensed sample footage on this node. Run it from Demo.` : null;
  };
  const originNoteFor = (d: Detection) => {
    const source = d.details.source;
    if (source?.kind === "scenario") {
      const s = scenarios.items.find((x) => x.id === source.scenario_id);
      return `Automated demo scenario${s ? ` “${s.name}”` : ""} (sample clip, real detector)`;
    }
    return source?.kind === "upload" ? "Operator-uploaded test clip" : "Test clip";
  };

  // Route mode: only for the selected incident, only after "Show route".
  const routeIncident =
    selection?.kind === "incident" && routeFor === selection.id && incidentDetail?.id === selection.id ? incidentDetail : null;
  const shownRoute = routeIncident?.route?.status === "ok" ? routeIncident.route : null;
  const selectedRoute = shownRoute?.geometry?.coordinates ?? null;

  const busyCamera = isRunning(analysis) ? data.cameras.find((c) => c.id === analysis?.cameraId) : undefined;

  function chooseZone(next: string) {
    setZone(next);
    const inZone = data.cameras.filter((c) => next === ALL_ZONES || c.district === next);
    const points = [...inZone, ...(next === ALL_ZONES ? data.stations : [])].map((x) => [x.longitude, x.latitude] as [number, number]);
    if (!points.length) return;
    const [lng, lat] = points[0];
    setFocus({ key: `zone:${next}:${timestamp()}`, lng, lat, bounds: boundsOf(points) });
  }

  function renderPanel() {
    if (!selection) return null;
    switch (selection.kind) {
      case "camera": {
        const camera = data.cameras.find((c) => c.id === selection.id);
        if (!camera) return <InlineError>Camera not found.</InlineError>;
        const pendingHere = data.pending.filter((d) => d.camera_id === camera.id);
        return (
          <CameraPanel
            key={camera.id}
            camera={camera}
            analysis={analysis}
            busyCameraName={busyCamera && busyCamera.id !== camera.id ? busyCamera.name : null}
            pendingCount={pendingHere.length}
            onAnalyze={(file) => void analyze(camera, file)}
            onReset={() => setAnalysis(null)}
            onOpenReview={() => pendingHere[0] && select({ kind: "detection", id: pendingHere[0].id })}
            feed={feedFor(camera)}
            lastActivity={lastActivityFor(camera.id)}
            scenarioNote={scenarioNoteFor(camera.id)}
          />
        );
      }
      case "detection": {
        if (!selectedDetection) {
          return detectionError ? (
            <InlineError>{detectionError}</InlineError>
          ) : (
            <div className="grid gap-3" aria-label="Loading">
              <Skeleton className="h-6 w-2/3" />
              <Skeleton className="aspect-video" />
            </div>
          );
        }
        const reviewCamera = data.cameras.find((c) => c.id === selectedDetection.camera_id);
        return (
          <DetectionReview
            key={selectedDetection.id}
            detection={selectedDetection}
            camera={reviewCamera}
            feed={reviewCamera ? feedFor(reviewCamera) : undefined}
            originNote={originNoteFor(selectedDetection)}
            evidenceSrc={api.evidenceSrc(selectedDetection.evidence_url)}
            onConfirm={confirmDetection}
            onReject={rejectDetection}
            onOpenIncident={(id) => select({ kind: "incident", id })}
            onBack={() => select({ kind: "camera", id: selectedDetection.camera_id })}
          />
        );
      }
      case "incident":
        return (
          <IncidentPanel
            key={selection.id}
            incidentId={selection.id}
            version={data.incidents.find((i) => i.id === selection.id)?.updated_at ?? null}
            initial={confirmed}
            api={api}
            notice={notice?.incidentId === selection.id ? notice.text : null}
            onSelectStation={(id) => select({ kind: "station", id })}
            onLoaded={setIncidentDetail}
            routeShown={routeFor === selection.id}
            onToggleRoute={() => setRouteFor((r) => (r === selection.id ? null : selection.id))}
          />
        );
      case "station": {
        const station = data.stations.find((s) => s.id === selection.id);
        return station ? <StationPanel station={station} /> : <InlineError>Station not found.</InlineError>;
      }
    }
  }

  const listOpen = nav !== "monitor";

  return (
    <div className="flex h-dvh min-h-0">
      <NavRail
        view={nav}
        onView={(v) => setNav((cur) => (cur === v && v !== "monitor" ? "monitor" : v))}
        attention={data.pending.length + activeIncidents}
        urgent={activeIncidents > 0}
        demoActive={scenarios.items.some(isLiveRun)}
        onDemo={() => setDemoOpen(true)}
        onSettings={() => setSettingsOpen(true)}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          health={health}
          onRetryHealth={recheck}
          lastSync={data.lastSync}
          zones={zones}
          zone={zone}
          onZone={chooseZone}
          view={view}
          onView={setViewChoice}
          sound={sound}
          activity={<ActivityList entries={activity.slice(0, 10)} onSelect={select} />}
          onOpenAbout={() => setSettingsOpen(true)}
        />
        <StatusStrip stats={stats} scenarioLive={liveScenarioLabel(scenarios)} />
        {data.status === "error" && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-fire-soft px-6 py-2 text-[13px] text-fire-ink">
            <span role="alert">Operational data could not be loaded: {data.error}</span>
            <button type="button" className={`${BUTTON_SECONDARY} h-8`} onClick={() => void refresh()}>
              Retry
            </button>
          </div>
        )}
        {data.status === "ready" && data.error && (
          <p className="border-b border-line bg-warn-soft px-6 py-1.5 text-[13px] text-warn-ink">
            Data may be out of date: the last refresh failed ({data.error}).
          </p>
        )}

        <main className="relative flex min-h-0 flex-1">
          <section aria-label="Karachi operations map" className="relative flex min-h-0 min-w-0 flex-1 flex-col">
            <MapComponent
              cameras={data.cameras}
              stations={data.stations}
              incidents={data.incidents}
              pending={data.pending}
              analyzingCameraId={isRunning(analysis) ? (analysis?.cameraId ?? null) : null}
              scenarioCameraIds={scenarioCameraIds}
              selection={selection}
              route={selectedRoute}
              focus={focus}
              view={view}
              onSelect={select}
            />

            {listOpen && (
              <ListPanel
                view={nav}
                loading={data.status === "loading"}
                onClose={() => setNav("monitor")}
                cameras={data.cameras}
                stations={data.stations}
                pending={data.pending}
                incidents={data.incidents}
                selection={selection}
                analyzingCameraId={isRunning(analysis) ? (analysis?.cameraId ?? null) : null}
                onSelect={select}
                activity={activity}
              />
            )}

            <Toasts
              alerts={alerts}
              onOpen={(a) => {
                select(a.select);
                dismiss(a.id);
              }}
              onDismiss={dismiss}
            />

            {shownRoute && routeIncident && (
              <div
                aria-label="Route summary"
                className={`pr-toast absolute bottom-10 z-10 grid w-60 gap-3 rounded-xl border border-line bg-surface p-4 shadow-float ${
                  listOpen ? "left-[352px] max-lg:left-4" : "left-4"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="grid gap-0.5">
                    <p className="flex items-center gap-1.5 text-xs font-medium text-info">
                      <Icon name="route" size={14} />
                      Suggested response
                    </p>
                    <p className="text-sm font-semibold">{routeIncident.station_selection?.station.name ?? "Candidate station"}</p>
                  </div>
                  <button type="button" aria-label="Exit route view" className={`${ICON_BUTTON} -mt-1 -mr-1 h-7 w-7`} onClick={() => setRouteFor(null)}>
                    <Icon name="x" size={16} />
                  </button>
                </div>
                <p className="flex items-baseline gap-4">
                  <span className="text-[22px] leading-7 font-semibold tabular-nums">{shownRoute.distance_km.toFixed(1)} km</span>
                  <span className="text-[22px] leading-7 font-semibold tabular-nums">{etaMin(shownRoute)} min</span>
                </p>
                <p className="text-xs text-fg-2">Road estimate · not a dispatch</p>
              </div>
            )}
          </section>

          {selection && (
            <aside
              aria-label="Details"
              className="pr-drawer absolute inset-y-0 right-0 z-20 flex w-full max-w-[420px] min-h-0 flex-col border-l border-line bg-surface shadow-float lg:relative lg:w-[400px] lg:shadow-none xl:w-[420px]"
            >
              <div className="flex shrink-0 justify-end px-3 pt-3">
                <button type="button" aria-label="Close details" onClick={() => setSelection(null)} className={ICON_BUTTON}>
                  <Icon name="x" size={18} />
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">{renderPanel()}</div>
            </aside>
          )}
        </main>
      </div>

      {demoOpen && (
        <DemoDialog
          state={scenarios}
          onClose={() => setDemoOpen(false)}
          onStart={startScenario}
          onReset={resetScenarios}
          onOpenCamera={(id) => select({ kind: "camera", id })}
        />
      )}
      {settingsOpen && <SettingsDialog sound={sound} onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

function Toasts({
  alerts,
  onOpen,
  onDismiss,
}: {
  alerts: Alert[];
  onOpen: (alert: Alert) => void;
  onDismiss: (id: string) => void;
}) {
  return (
    <div aria-live="assertive" aria-label="Alerts" className="pointer-events-none absolute top-4 right-4 z-30 grid w-[320px] gap-2">
      {alerts.map((a) => {
        const incident = a.kind === "incident";
        return (
          <div
            key={a.id}
            className="pr-toast pointer-events-auto grid gap-3 rounded-xl border border-line bg-surface p-4 shadow-float"
          >
            <div className="flex items-start gap-3">
              <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${incident ? "bg-fire-soft text-fire" : "bg-warn-soft text-warn-ink"}`}>
                <Icon name="flame" size={16} />
              </span>
              <div className="grid min-w-0 flex-1 gap-0.5">
                <p className="text-sm font-semibold">{a.title}</p>
                <p className="truncate text-[13px] text-fg-2">{a.location}</p>
                {a.detail && <p className="text-[13px] text-fg-2">{a.detail}</p>}
              </div>
              <button type="button" aria-label="Dismiss alert" onClick={() => onDismiss(a.id)} className={`${ICON_BUTTON} -mt-1 -mr-1 h-7 w-7`}>
                <Icon name="x" size={16} />
              </button>
            </div>
            <button type="button" onClick={() => onOpen(a)} className={`${BUTTON_PRIMARY} h-8 ${FOCUS}`}>
              {incident ? "Open incident" : "Review incident"}
            </button>
          </div>
        );
      })}
    </div>
  );
}
