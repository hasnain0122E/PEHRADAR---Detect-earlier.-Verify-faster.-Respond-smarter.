"use client";

import { type ComponentType, useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { OpsApi } from "@/lib/api/client";
import type { Camera, Detection, Incident, IncidentDetail } from "@/lib/api/types";
import { EVENT_LABEL, isActiveIncident } from "@/lib/ops";

import { OpsMap, type OpsMapProps } from "../map/OpsMap";
import { useApiHealth } from "../useApiHealth";
import { type AnalysisState, CameraPanel, isRunning } from "./CameraPanel";
import { DetectionReview } from "./DetectionReview";
import { IncidentPanel, StationPanel } from "./IncidentPanel";
import { LeftRail, type RailTab } from "./LeftRail";
import type { Selection } from "./selection";
import { DemoBanner, TopBar } from "./TopBar";
import { BUTTON_SECONDARY, InlineError } from "./ui";
import { useAlertSound } from "./useAlertSound";
import { describeError, useOpsData } from "./useOpsData";

interface Alert {
  id: string;
  text: string;
  select: Selection;
}

type Pane = "queue" | "map" | "details";

// Only ever called from event handlers.
const timestamp = () => Date.now();

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
  const [railTab, setRailTab] = useState<RailTab>("cameras");
  const [pane, setPane] = useState<Pane>("map");
  const [analysis, setAnalysis] = useState<AnalysisState | null>(null);
  const [detections, setDetections] = useState<Record<string, Detection>>({});
  const [confirmed, setConfirmed] = useState<IncidentDetail | null>(null);
  const [notice, setNotice] = useState<{ incidentId: string; text: string } | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [detectionError, setDetectionError] = useState<string | null>(null);

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
        raise({
          id: `d:${d.id}`,
          text: `Possible ${EVENT_LABEL[d.event_type]} detected at ${camera?.name ?? "a camera"}. Operator review required.`,
          select: { kind: "detection", id: d.id },
        });
      }
      for (const i of incidents) {
        if (known.has(`i:${i.id}`)) continue;
        known.add(`i:${i.id}`);
        raise({
          id: `i:${i.id}`,
          text: `New confirmed ${EVENT_LABEL[i.event_type]} incident at ${i.camera.location_label}.`,
          select: { kind: "incident", id: i.id },
        });
      }
    },
    [raise],
  );

  const { data, refresh } = useOpsData(api, onUpdate);
  useEffect(() => {
    camerasRef.current = data.cameras;
  }, [data.cameras]);

  const select = useCallback((next: Selection | null) => {
    setSelection(next);
    setDetectionError(null);
    if (next) setPane("details");
    if (next?.kind !== "incident") setNotice(null);
  }, []);

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
            message: `A detection was stored and is waiting in the Review queue, but loading it failed (${describeError(err, "unknown error")}).`,
          });
          setRailTab("review");
          void refresh();
          return;
        }
        setDetections((prev) => ({ ...prev, [id]: detection }));
        setAnalysis(null);
        setRailTab("review");
        select({ kind: "detection", id });
        setAlerts((prev) => [
          {
            id: `d:${id}`,
            text: `Possible ${EVENT_LABEL[detection.event_type]} detected at ${camera.name}. Evidence is open for review.`,
            select: { kind: "detection" as const, id },
          },
          ...prev,
        ].slice(0, 3));
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
    setAlerts((prev) => prev.filter((a) => a.id !== `d:${d.id}`));
    setConfirmed(incident);
    setRailTab("incidents");
    select({ kind: "incident", id: incident.id });
    setNotice({
      incidentId: incident.id,
      text: incident.station_selection
        ? `Incident created. Candidate station: ${incident.station_selection.station.name} (${incident.station_selection.distance_km.toFixed(2)} km straight-line). No dispatch was sent.`
        : "Incident created. No fire station is marked available in the demo data.",
    });
    void refresh();
  }

  async function rejectDetection(d: Detection, note: string) {
    const updated = await api.rejectDetection(d.id, note ? { note } : {});
    setDetections((prev) => ({ ...prev, [d.id]: updated }));
    setAlerts((prev) => prev.filter((a) => a.id !== `d:${d.id}`));
    void refresh();
  }

  const activeIncidents = data.incidents.filter(isActiveIncident).length;
  const busyCamera = isRunning(analysis)
    ? data.cameras.find((c) => c.id === analysis?.cameraId)
    : undefined;

  function renderPanel() {
    if (!selection) return <Overview pending={data.pending.length} active={activeIncidents} />;
    switch (selection.kind) {
      case "camera": {
        const camera = data.cameras.find((c) => c.id === selection.id);
        if (!camera) return <InlineError>Camera not found.</InlineError>;
        return (
          <CameraPanel
            camera={camera}
            analysis={analysis}
            busyCameraName={busyCamera && busyCamera.id !== camera.id ? busyCamera.name : null}
            pendingCount={data.pending.filter((d) => d.camera_id === camera.id).length}
            onAnalyze={(file) => void analyze(camera, file)}
            onReset={() => setAnalysis(null)}
            onOpenReview={() => setRailTab("review")}
          />
        );
      }
      case "detection":
        if (!selectedDetection) {
          return detectionError ? <InlineError>{detectionError}</InlineError> : <PanelSkeleton />;
        }
        return (
          <DetectionReview
            key={selectedDetection.id}
            detection={selectedDetection}
            camera={data.cameras.find((c) => c.id === selectedDetection.camera_id)}
            evidenceSrc={api.evidenceSrc(selectedDetection.evidence_url)}
            onConfirm={confirmDetection}
            onReject={rejectDetection}
            onOpenIncident={(id) => select({ kind: "incident", id })}
            onBack={() => select({ kind: "camera", id: selectedDetection.camera_id })}
          />
        );
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
          />
        );
      case "station": {
        const station = data.stations.find((s) => s.id === selection.id);
        return station ? <StationPanel station={station} /> : <InlineError>Station not found.</InlineError>;
      }
    }
  }

  const paneClass = (p: Pane) => (pane === p ? "flex" : "hidden lg:flex");

  return (
    <div className="flex h-dvh min-h-0 flex-col">
      <DemoBanner />
      <TopBar
        health={health}
        onRetryHealth={recheck}
        lastSync={data.lastSync}
        pendingCount={data.pending.length}
        activeIncidents={activeIncidents}
        analyzing={isRunning(analysis)}
        sound={sound}
      />
      <AlertStrip
        alerts={alerts}
        onOpen={(a) => {
          setRailTab(a.select.kind === "incident" ? "incidents" : "review");
          select(a.select);
          setAlerts((prev) => prev.filter((x) => x.id !== a.id));
        }}
        onDismiss={(id) => setAlerts((prev) => prev.filter((x) => x.id !== id))}
      />
      {data.status === "error" && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-danger/40 bg-danger/10 px-4 py-2 text-sm text-danger">
          <span role="alert">Operational data could not be loaded: {data.error}</span>
          <button type="button" className={BUTTON_SECONDARY} onClick={() => void refresh()}>
            Retry
          </button>
        </div>
      )}
      {data.status === "ready" && data.error && (
        <p className="border-b border-review/40 bg-review/10 px-4 py-1 text-xs text-review">
          Data may be out of date: the last refresh failed ({data.error}).
        </p>
      )}

      <div role="tablist" aria-label="Screen area" className="grid grid-cols-3 border-b border-ink-700 bg-ink-900 lg:hidden">
        {(["queue", "map", "details"] as Pane[]).map((p) => (
          <button
            key={p}
            type="button"
            role="tab"
            aria-selected={pane === p}
            onClick={() => setPane(p)}
            className={`py-2 text-sm capitalize ${pane === p ? "border-b-2 border-focus text-ink-100" : "text-ink-300"}`}
          >
            {p === "queue" ? "Queues" : p}
          </button>
        ))}
      </div>

      <main className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)_400px] 2xl:grid-cols-[340px_minmax(0,1fr)_460px]">
        <aside className={`${paneClass("queue")} min-h-0 flex-col border-r border-ink-700`}>
          <LeftRail
            tab={railTab}
            onTab={setRailTab}
            cameras={data.cameras}
            pending={data.pending}
            incidents={data.incidents}
            selection={selection}
            analyzingCameraId={isRunning(analysis) ? (analysis?.cameraId ?? null) : null}
            onSelect={select}
            loading={data.status === "loading"}
          />
        </aside>
        <section aria-label="Karachi operations map" className={`${paneClass("map")} min-h-[320px] flex-col`}>
          <MapComponent
            cameras={data.cameras}
            stations={data.stations}
            incidents={data.incidents}
            pending={data.pending}
            analyzingCameraId={isRunning(analysis) ? (analysis?.cameraId ?? null) : null}
            selection={selection}
            onSelect={(s) => {
              setRailTab(s.kind === "incident" ? "incidents" : s.kind === "detection" ? "review" : railTab);
              select(s);
            }}
          />
        </section>
        <aside
          aria-label="Details"
          className={`${paneClass("details")} min-h-0 flex-col border-l border-ink-700 bg-ink-900`}
        >
          {selection && (
            <div className="flex justify-end border-b border-ink-700 px-2 py-1">
              <button
                type="button"
                onClick={() => setSelection(null)}
                className="rounded px-2 py-0.5 text-xs text-ink-300 hover:text-ink-100 focus-visible:outline-2 focus-visible:outline-focus"
              >
                Close ✕
              </button>
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto p-4">{renderPanel()}</div>
        </aside>
      </main>

      <footer className="flex flex-wrap items-center justify-between gap-x-4 gap-y-0.5 border-t border-ink-700 bg-ink-900 px-4 py-1 text-[11px] text-ink-500">
        <span>Decision support only · every detection needs operator confirmation · no notification or dispatch is sent</span>
        <span>Fire stations © OpenStreetMap contributors (ODbL), unverified</span>
      </footer>
    </div>
  );
}

function AlertStrip({
  alerts,
  onOpen,
  onDismiss,
}: {
  alerts: Alert[];
  onOpen: (alert: Alert) => void;
  onDismiss: (id: string) => void;
}) {
  return (
    <div aria-live="assertive" aria-label="Alerts">
      {alerts.map((a) => (
        <div
          key={a.id}
          className="pr-flash flex flex-wrap items-center justify-between gap-2 border-b border-review/50 bg-review/10 px-4 py-1.5 text-sm"
        >
          <span className="flex items-center gap-2 font-medium text-review">
            <span aria-hidden className="h-2 w-2 rotate-45 bg-review" />
            {a.text}
          </span>
          <span className="flex gap-2">
            <button
              type="button"
              onClick={() => onOpen(a)}
              className="rounded-md border border-review bg-review px-2.5 py-0.5 text-xs font-semibold text-ink-950 hover:bg-review/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              {a.select.kind === "incident" ? "Open incident" : "Review now"}
            </button>
            <button
              type="button"
              aria-label="Dismiss alert"
              onClick={() => onDismiss(a.id)}
              className="rounded px-1.5 text-xs text-ink-300 hover:text-ink-100"
            >
              ✕
            </button>
          </span>
        </div>
      ))}
    </div>
  );
}

function PanelSkeleton() {
  return (
    <div className="grid gap-3" aria-label="Loading">
      <div className="h-6 w-2/3 animate-pulse rounded bg-ink-850" />
      <div className="aspect-video animate-pulse rounded-md bg-ink-850" />
    </div>
  );
}

function Overview({ pending, active }: { pending: number; active: number }) {
  return (
    <div className="grid gap-4 text-sm">
      <div>
        <p className="text-xs font-medium tracking-wider text-ink-300 uppercase">Karachi Fire Department</p>
        <h2 className="mt-1 text-lg font-semibold">Live threat monitoring and response</h2>
      </div>
      <dl className="grid grid-cols-2 gap-2">
        <div className="rounded-md border border-ink-700 bg-ink-850 p-3">
          <dt className="text-xs text-ink-300">Awaiting review</dt>
          <dd className={`font-mono text-2xl tabular-nums ${pending ? "text-review" : ""}`}>{pending}</dd>
        </div>
        <div className="rounded-md border border-ink-700 bg-ink-850 p-3">
          <dt className="text-xs text-ink-300">Active incidents</dt>
          <dd className={`font-mono text-2xl tabular-nums ${active ? "text-sev-high" : ""}`}>{active}</dd>
        </div>
      </dl>
      <ol className="grid list-decimal gap-1.5 pl-5 text-ink-300">
        <li>Select a camera on the map or in the Cameras list.</li>
        <li>Analyze a test clip for that camera.</li>
        <li>Review the AI evidence, then confirm or reject it.</li>
        <li>Confirmed incidents show a candidate station and a timeline.</li>
      </ol>
      <p className="border-l-2 border-sim pl-3 text-xs text-ink-300">
        Cameras are simulated and footage is test data. The AI is decision support; an operator
        confirms every incident. Station availability is demonstration data, and the candidate
        station is chosen by straight-line distance only.
      </p>
    </div>
  );
}
