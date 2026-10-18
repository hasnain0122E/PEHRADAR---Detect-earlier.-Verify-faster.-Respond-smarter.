"use client";

import { useEffect, useState } from "react";

import type { Scenario } from "@/lib/api/types";
import { type ActivityEntry, type CityStats, isLiveRun } from "@/lib/city";
import { pktTime } from "@/lib/ops";

import { Icon } from "../icons";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, FOCUS, InlineError, Modal, Tag } from "./ui";
import type { ScenarioState } from "./useScenarios";
import { describeError } from "./useOpsData";

/** One compact status strip. Every number is counted from the API data on screen. */
export function StatusStrip({ stats, scenarioLive }: { stats: CityStats; scenarioLive: string | null }) {
  const cells: { label: string; value: string; tone?: string; title: string }[] = [
    { label: "Monitoring nodes", value: String(stats.nodes), title: `${stats.simulated} simulated coverage, ${stats.mapped} mapped location(s), ${stats.feeds} with a feed` },
    { label: "Online", value: String(stats.online), title: "Nodes whose status is active. Simulated nodes have no real camera behind them." },
    { label: "Response facilities", value: `${stats.availableStations}/${stats.stations}`, title: "Fire-response facilities marked available. Demo flag, not real availability" },
    { label: "Pending alerts", value: String(stats.pending), tone: stats.pending ? "text-warn-ink" : undefined, title: "Detections awaiting operator review" },
    { label: "Active incidents", value: String(stats.activeIncidents), tone: stats.activeIncidents ? "text-fire-ink" : undefined, title: "Confirmed and not yet closed" },
  ];
  return (
    <div aria-label="City status" className="flex h-11 shrink-0 items-center gap-8 overflow-x-auto border-b border-line bg-surface px-6">
      <dl className="flex items-center gap-8">
        {cells.map((c) => (
          <div key={c.label} className="flex items-baseline gap-2 whitespace-nowrap" title={c.title}>
            <dt className="order-2 text-[13px] text-fg-2">{c.label}</dt>
            <dd className={`order-1 text-base font-semibold tabular-nums ${c.tone ?? "text-fg"}`}>{c.value}</dd>
          </div>
        ))}
      </dl>
      {scenarioLive && (
        <p className="ml-auto flex items-center gap-2 text-[13px] font-medium whitespace-nowrap text-info">
          <span aria-hidden className="h-2 w-2 animate-pulse rounded-full bg-info" />
          {scenarioLive}
        </p>
      )}
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
  scheduled: { text: "Armed", tone: "text-info" },
  running: { text: "Analysing feed", tone: "text-info" },
  detected: { text: "Detection raised", tone: "text-warn-ink" },
  not_detected: { text: "No detection", tone: "text-ok-ink" },
  failed: { text: "Failed", tone: "text-fire-ink" },
  cancelled: { text: "Cancelled", tone: "text-fg-3" },
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
  return `${live.name} · ${live.latest_run?.status === "scheduled" ? "armed" : "analysing feed"}`;
}

const CATEGORY: Record<NonNullable<Scenario["category"]>, { label: string; tone: string }> = {
  fire: { label: "Fire", tone: "bg-fire-soft text-fire-ink" },
  smoke: { label: "Smoke", tone: "bg-warn-soft text-warn-ink" },
  false_alarm: { label: "False alarm", tone: "bg-muted text-fg-2" },
  interior: { label: "Interior", tone: "bg-info-soft text-info" },
  roadway: { label: "Roadway", tone: "bg-info-soft text-info" },
};

export function ScenarioControls({
  state,
  onStart,
  onReset,
  onOpenCamera,
  delayS,
}: {
  /** Delay the next run will use (Settings), shown instead of the configured default. */
  delayS?: number;
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

  if (state.status === "loading") return <p className="text-[13px] text-fg-2">Loading scenarios…</p>;
  if (!state.enabled) {
    return (
      <p className="text-[13px] text-fg-2">
        Demo scenarios are disabled on this API (SCENARIOS_ENABLED). Manual clip upload still works.
      </p>
    );
  }

  return (
    <div className="grid gap-5">
      <ul className="grid divide-y divide-line rounded-lg border border-line">
        {state.items.map((s) => {
          const run = s.latest_run;
          const live = isLiveRun(s);
          const view = run ? RUN_VIEW[run.status] : null;
          const left = countdown(s, now, state.offsetMs);
          return (
            <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="grid min-w-0 gap-0.5">
                <p className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-sm font-medium">{s.name}</span>
                  {s.category && <Tag tone={CATEGORY[s.category].tone}>{CATEGORY[s.category].label}</Tag>}
                </p>
                <p className="flex flex-wrap items-center gap-x-2 text-[13px] text-fg-2">
                  <button
                    type="button"
                    className={`rounded hover:text-fg hover:underline ${FOCUS}`}
                    onClick={() => s.camera_id && onOpenCamera(s.camera_id)}
                  >
                    {s.camera_code}
                  </button>
                  {view ? (
                    <span className={view.tone}>
                      · {view.text}
                      {left && <span className="ml-1 tabular-nums">{left}</span>}
                    </span>
                  ) : (
                    <span>· runs {delayS ?? s.trigger_after_seconds} s after start</span>
                  )}
                </p>
              </div>
              <button
                type="button"
                className={`${live ? BUTTON_SECONDARY : BUTTON_PRIMARY} h-8 shrink-0 px-3`}
                disabled={live || busy !== null || !s.camera_id}
                onClick={() => void perform(s.id, () => onStart(s.id))}
              >
                {busy === s.id ? "Starting…" : live ? "Running" : "Run"}
              </button>
            </li>
          );
        })}
      </ul>
      {error && <InlineError>{error}</InlineError>}
      <p className="text-xs text-fg-3">
        {state.disclaimer ?? "Licensed sample footage on simulated nodes, analysed by the real detector."} Detections
        still need operator review.
      </p>
      <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
        {armedReset ? (
          <>
            <p className="text-[13px] text-fg-2">Close demo alerts and incidents?</p>
            <div className="flex gap-2">
              <button type="button" className={`${BUTTON_SECONDARY} h-8`} onClick={() => setArmedReset(false)}>
                Cancel
              </button>
              <button
                type="button"
                className={`${BUTTON_SECONDARY} h-8 text-fire-ink`}
                disabled={busy !== null}
                onClick={() => void perform("reset", onReset)}
              >
                {busy === "reset" ? "Resetting…" : "Yes, reset operations"}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-[13px] text-fg-2">Clears the live map; history is kept. Full reset is in Settings.</p>
            <button type="button" className={`${BUTTON_SECONDARY} h-8`} onClick={() => setArmedReset(true)}>
              <Icon name="reset" size={14} />
              Reset operations
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/** Demo scenarios live in one modal, not on the dashboard. */
export function DemoDialog({
  state,
  onClose,
  onStart,
  onReset,
  onOpenCamera,
  delayS,
}: {
  delayS?: number;
  state: ScenarioState;
  onClose: () => void;
  onStart: (id: string) => Promise<unknown>;
  onReset: () => Promise<unknown>;
  onOpenCamera: (cameraId: string) => void;
}) {
  return (
    <Modal title="Demo scenarios" onClose={onClose} width="max-w-[560px]">
      <ScenarioControls
        state={state}
        delayS={delayS}
        onStart={async (id) => {
          await onStart(id);
          onClose(); // the scenario runs autonomously; the map shows what happens
        }}
        onReset={onReset}
        onOpenCamera={(id) => {
          onClose();
          onOpenCamera(id);
        }}
      />
    </Modal>
  );
}

const TONE: Record<ActivityEntry["tone"], string> = {
  info: "bg-info",
  alert: "bg-warn",
  incident: "bg-fire",
  ok: "bg-ok",
  muted: "bg-fg-3",
};

export function ActivityList({
  entries,
  onSelect,
}: {
  entries: ActivityEntry[];
  onSelect: (select: NonNullable<ActivityEntry["select"]>) => void;
}) {
  if (!entries.length) {
    return <p className="px-2 py-6 text-center text-[13px] text-fg-2">No activity yet.</p>;
  }
  return (
    <ol aria-label="Activity feed" className="grid">
      {entries.map((e) => (
        <li key={e.key}>
          <button
            type="button"
            disabled={!e.select}
            onClick={() => e.select && onSelect(e.select)}
            className={`grid w-full grid-cols-[8px_1fr_auto] items-start gap-3 rounded-lg px-2 py-2 text-left hover:bg-muted disabled:hover:bg-transparent ${FOCUS}`}
          >
            <span aria-hidden className={`mt-1.5 h-2 w-2 rounded-full ${TONE[e.tone]}`} />
            <span className="min-w-0 text-[13px] text-fg">
              {e.text}
              {e.code && <span className="block text-xs text-fg-3">{e.code}</span>}
            </span>
            <span className="text-xs text-fg-3 tabular-nums">{pktTime(e.at).slice(0, 5)}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}
