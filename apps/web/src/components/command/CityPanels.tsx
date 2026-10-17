"use client";

import { useEffect, useState } from "react";

import type { Scenario } from "@/lib/api/types";
import { type ActivityEntry, type CityStats, isLiveRun } from "@/lib/city";
import { pktTime } from "@/lib/ops";

import { BUTTON_SECONDARY, InlineError } from "./ui";
import type { ScenarioState } from "./useScenarios";
import { describeError } from "./useOpsData";

/** City status bar (M5): every number is counted from the API data on screen. */
export function CityStatusBar({ stats, scenarioLive }: { stats: CityStats; scenarioLive: string | null }) {
  const cells: { label: string; value: string; tone?: string; title: string }[] = [
    { label: "Monitoring nodes", value: String(stats.nodes), title: `${stats.simulated} simulated coverage, ${stats.mapped} mapped location(s), ${stats.feeds} with a feed` },
    { label: "Public / demo feeds", value: String(stats.feeds), title: "Nodes with a playable stream (demo streams are simulated)" },
    { label: "Feeds online", value: String(stats.feedsOnline), tone: stats.feedsOnline ? "text-ack" : undefined, title: "Feed nodes whose status is active" },
    { label: "Pending alerts", value: String(stats.pending), tone: stats.pending ? "text-review" : undefined, title: "Detections awaiting operator review" },
    { label: "Active incidents", value: String(stats.activeIncidents), tone: stats.activeIncidents ? "text-sev-high" : undefined, title: "Confirmed and not yet closed" },
    { label: "Available facilities", value: `${stats.availableStations}/${stats.stations}`, title: "Fire-response facilities marked available. Demo flag, not real availability" },
  ];
  return (
    <div
      aria-label="City status"
      className="flex flex-wrap items-stretch border-b border-ink-700 bg-ink-950/80 text-xs"
    >
      <dl className="flex min-w-0 flex-1 flex-wrap">
        {cells.map((c) => (
          <div key={c.label} className="pr-stat flex items-baseline gap-2 px-4 py-1.5" title={c.title}>
            <dt className="text-[10px] font-medium tracking-[0.12em] text-ink-500 uppercase">{c.label}</dt>
            <dd className={`font-mono text-sm font-semibold tabular-nums ${c.tone ?? "text-ink-100"}`}>{c.value}</dd>
          </div>
        ))}
      </dl>
      <p className="flex items-center px-4 py-1.5 text-[11px] text-ink-500">
        {scenarioLive ? (
          <span className="font-medium text-notified">{scenarioLive}</span>
        ) : (
          "Simulated network · no official CCTV connected"
        )}
      </p>
    </div>
  );
}

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

const RUN_VIEW = {
  scheduled: { text: "Armed", tone: "text-notified" },
  running: { text: "Analysing (real detector)", tone: "text-notified" },
  detected: { text: "Detection raised", tone: "text-review" },
  not_detected: { text: "No detection", tone: "text-ack" },
  failed: { text: "Failed", tone: "text-danger" },
  cancelled: { text: "Cancelled", tone: "text-ink-500" },
} as const;

/** "T−32 s" until the trigger, using the server clock. */
export function countdown(s: Scenario, now: number, offsetMs: number): string | null {
  const run = s.latest_run;
  if (run?.status !== "scheduled") return null;
  const left = Math.ceil((new Date(run.trigger_at).getTime() - (now + offsetMs)) / 1000);
  return left > 0 ? `T−${left} s` : "triggering…";
}

export function liveScenarioLabel(state: ScenarioState): string | null {
  const live = state.items.find(isLiveRun);
  if (!live) return null;
  return `Demo scenario: ${live.name} · ${live.latest_run?.status === "scheduled" ? "armed" : "analysing feed"}`;
}

export function ScenarioControls({
  state,
  onStart,
  onReset,
  onOpenCamera,
}: {
  state: ScenarioState;
  onStart: (id: string) => Promise<unknown>;
  onReset: () => Promise<unknown>;
  onOpenCamera: (cameraId: string) => void;
}) {
  const anyLive = state.items.some(isLiveRun);
  const now = useNow(anyLive);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [armedReset, setArmedReset] = useState(false);

  async function perform(key: string, action: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(describeError(err, "The demo action failed"));
    } finally {
      setBusy(null);
      setArmedReset(false);
    }
  }

  if (state.status === "loading") return <p className="text-xs text-ink-500">Loading scenarios…</p>;
  if (!state.enabled) {
    return (
      <p className="text-xs text-ink-500">
        Demo scenarios are disabled on this API (SCENARIOS_ENABLED). Manual clip upload still works.
      </p>
    );
  }

  return (
    <div className="grid gap-2">
      <ul className="grid gap-1.5">
        {state.items.map((s) => {
          const run = s.latest_run;
          const live = isLiveRun(s);
          const view = run ? RUN_VIEW[run.status] : null;
          const left = countdown(s, now, state.offsetMs);
          return (
            <li key={s.id} className="grid gap-1 rounded-sm border border-ink-700 bg-ink-850 px-2.5 py-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{s.name}</p>
                  <button
                    type="button"
                    className="font-mono text-[11px] text-ink-500 hover:text-ink-100"
                    onClick={() => s.camera_id && onOpenCamera(s.camera_id)}
                  >
                    {s.camera_code} · triggers after {s.trigger_after_seconds} s
                  </button>
                </div>
                <button
                  type="button"
                  className={`${BUTTON_SECONDARY} shrink-0 px-2 py-0.5 text-xs`}
                  disabled={live || busy !== null || !s.camera_id}
                  onClick={() => void perform(s.id, () => onStart(s.id))}
                >
                  {busy === s.id ? "Starting…" : live ? "Running" : "Start"}
                </button>
              </div>
              {view && (
                <p className={`text-xs ${view.tone}`}>
                  {view.text}
                  {left && <span className="ml-1 font-mono tabular-nums">{left}</span>}
                  {run?.result && run.status !== "scheduled" && (
                    <span className="ml-1 font-mono text-ink-300">
                      · peak {Math.max(0, ...Object.values(run.result.classes).map((c) => c.peak_confidence)).toFixed(2)}
                    </span>
                  )}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      {error && <InlineError>{error}</InlineError>}
      {armedReset ? (
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className={`${BUTTON_SECONDARY} text-xs`} onClick={() => setArmedReset(false)}>
            Cancel
          </button>
          <button
            type="button"
            className={`${BUTTON_SECONDARY} border-danger/70 text-xs text-danger`}
            disabled={busy !== null}
            onClick={() => void perform("reset", onReset)}
          >
            {busy === "reset" ? "Resetting…" : "Yes, reset demo"}
          </button>
        </div>
      ) : (
        <button type="button" className={`${BUTTON_SECONDARY} text-xs`} onClick={() => setArmedReset(true)}>
          Reset demo
        </button>
      )}
      <p className="text-[11px] text-ink-500">
        {state.disclaimer ??
          "Licensed sample footage on simulated nodes, analysed by the real detector."}{" "}
        Detections still need operator review; reset closes scenario data without deleting it.
      </p>
    </div>
  );
}

const TONE: Record<ActivityEntry["tone"], string> = {
  info: "bg-notified",
  alert: "bg-review",
  incident: "bg-sev-high",
  ok: "bg-ack",
  muted: "bg-ink-500",
};

export function ActivityFeed({
  entries,
  onSelect,
}: {
  entries: ActivityEntry[];
  onSelect: (select: NonNullable<ActivityEntry["select"]>) => void;
}) {
  if (!entries.length) {
    return (
      <p className="rounded-sm border border-dashed border-ink-700 px-3 py-4 text-center text-xs text-ink-500">
        No activity yet. Start a demo scenario or analyze a clip.
      </p>
    );
  }
  return (
    <ol aria-label="Activity feed" className="grid">
      {entries.map((e) => (
        <li key={e.key}>
          <button
            type="button"
            disabled={!e.select}
            onClick={() => e.select && onSelect(e.select)}
            className="grid w-full grid-cols-[3.6rem_0.5rem_1fr] items-start gap-2 border-b border-ink-800 px-1 py-1.5 text-left text-xs hover:bg-ink-850 focus-visible:outline-2 focus-visible:outline-focus disabled:hover:bg-transparent"
          >
            <span className="font-mono text-ink-500 tabular-nums">{pktTime(e.at)}</span>
            <span aria-hidden className={`mt-1.5 h-1.5 w-1.5 rounded-full ${TONE[e.tone]}`} />
            <span className="min-w-0 text-ink-300">
              {e.code && <span className="mr-1.5 font-mono text-ink-100">{e.code}</span>}
              {e.text}
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}

/** Top-bar entry point for the demo scenarios (popover). */
export function DemoMenu({
  state,
  label,
  onStart,
  onReset,
  onOpenCamera,
}: {
  state: ScenarioState;
  label: string | null;
  onStart: (id: string) => Promise<unknown>;
  onReset: () => Promise<unknown>;
  onOpenCamera: (cameraId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  if (state.status === "ready" && !state.enabled) return null;
  return (
    <div className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="demo-scenarios"
        onClick={() => setOpen((v) => !v)}
        className={`rounded-md border px-2 py-0.5 text-xs font-medium focus-visible:outline-2 focus-visible:outline-focus ${
          label ? "border-notified/70 text-notified" : "border-ink-700 bg-ink-800 hover:border-ink-500"
        }`}
      >
        {label ? "● Demo running" : "▶ Demo scenarios"}
      </button>
      {open && (
        <div
          id="demo-scenarios"
          role="dialog"
          aria-label="Demo scenarios"
          className="absolute top-full right-0 z-30 mt-2 w-[22rem] rounded-md border border-ink-700 bg-ink-900 p-3 shadow-2xl shadow-black/60"
        >
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-medium tracking-wider text-ink-300 uppercase">Demo mode · scenarios</p>
            <button type="button" aria-label="Close demo scenarios" className="px-1 text-xs text-ink-300 hover:text-ink-100" onClick={() => setOpen(false)}>
              ✕
            </button>
          </div>
          <ScenarioControls
            state={state}
            onStart={onStart}
            onReset={onReset}
            onOpenCamera={(id) => {
              setOpen(false);
              onOpenCamera(id);
            }}
          />
        </div>
      )}
    </div>
  );
}
