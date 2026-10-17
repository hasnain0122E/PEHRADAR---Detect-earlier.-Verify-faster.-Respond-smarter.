"use client";

import type { ReactNode } from "react";

import { PRODUCT_NAME, PRODUCT_TAGLINE } from "@/lib/config";
import { pktTime } from "@/lib/ops";

import type { ApiHealthState } from "../useApiHealth";

interface TopBarProps {
  health: ApiHealthState;
  onRetryHealth: () => void;
  lastSync: Date | null;
  pendingCount: number;
  activeIncidents: number;
  analyzing: boolean;
  sound: { supported: boolean; enabled: boolean; enable: () => void; disable: () => void };
  demo?: ReactNode;
}

const HEALTH_VIEW = {
  unconfigured: { label: "API not configured", dot: "bg-danger", text: "text-danger" },
  loading: { label: "API checking…", dot: "bg-ink-500 animate-pulse", text: "text-ink-300" },
  connected: { label: "API online", dot: "bg-ack", text: "text-ink-100" },
  error: { label: "API offline", dot: "bg-danger", text: "text-danger" },
} as const;

export function DemoBanner() {
  return (
    <div className="border-b border-dashed border-sim/60 bg-sim/10 px-4 py-1 text-center text-xs font-medium tracking-wide text-sim uppercase">
      Demo · Simulated monitoring network and licensed sample footage · No official or Safe City
      CCTV connected · Station availability is demo data · Not connected to any emergency service
    </div>
  );
}

export function TopBar(props: TopBarProps) {
  const { health, lastSync, pendingCount, activeIncidents, analyzing, sound } = props;
  const view = HEALTH_VIEW[health.kind];
  const opState =
    pendingCount > 0
      ? { text: `${pendingCount} awaiting review`, tone: "border-review/60 text-review" }
      : activeIncidents > 0
        ? { text: `${activeIncidents} active incident${activeIncidents > 1 ? "s" : ""}`, tone: "border-sev-high/60 text-sev-high" }
        : analyzing
          ? { text: "Analyzing footage", tone: "border-notified/60 text-notified" }
          : { text: "Monitoring · no open threats", tone: "border-ink-700 text-ink-300" };

  return (
    <header className="flex min-h-12 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-ink-700 bg-ink-900 px-4 py-1.5">
      <div className="flex min-w-0 items-center gap-3">
        <span aria-hidden className="h-3 w-3 shrink-0 rotate-45 bg-sev-high" />
        <span className="text-base font-semibold tracking-[0.12em] uppercase">{PRODUCT_NAME}</span>
        <span className="hidden text-sm text-ink-300 md:inline">
          Karachi Fire Department · Command Center
        </span>
        <span className="hidden text-xs text-ink-500 xl:inline">{PRODUCT_TAGLINE}</span>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span
          role="status"
          aria-live="polite"
          className={`rounded border px-2 py-0.5 text-xs font-medium tracking-wide uppercase ${opState.tone}`}
        >
          {opState.text}
        </span>
        <span className={`flex items-center gap-1.5 ${view.text}`} title={health.kind === "error" ? health.message : undefined}>
          <span aria-hidden className={`h-2 w-2 rounded-full ${view.dot}`} />
          {view.label}
          {health.kind === "error" && (
            <button
              type="button"
              onClick={props.onRetryHealth}
              className="ml-1 rounded border border-ink-700 px-1.5 text-xs text-ink-100 hover:border-ink-500"
            >
              Retry
            </button>
          )}
        </span>
        <span className="hidden font-mono text-xs text-ink-300 tabular-nums sm:inline">
          Last sync {lastSync ? `${pktTime(lastSync)} PKT` : "—"}
        </span>
        {props.demo}
        {sound.supported && (
          <button
            type="button"
            onClick={sound.enabled ? sound.disable : sound.enable}
            aria-pressed={sound.enabled}
            className="rounded-md border border-ink-700 bg-ink-800 px-2 py-0.5 text-xs hover:border-ink-500 focus-visible:outline-2 focus-visible:outline-focus"
          >
            {sound.enabled ? "♪ Alert sound: on" : "♪ Enable alert sound"}
          </button>
        )}
      </div>
    </header>
  );
}
