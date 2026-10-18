"use client";

import { type ReactNode, useCallback, useState } from "react";

import { pktTime } from "@/lib/ops";

import { Icon } from "../icons";
import type { MapView } from "../map/OpsMap";
import type { ApiHealthState } from "../useApiHealth";
import { FOCUS, ICON_BUTTON, useEscape } from "./ui";

export type Sound = { supported: boolean; enabled: boolean; enable: () => void; disable: () => void };

interface TopBarProps {
  health: ApiHealthState;
  onRetryHealth: () => void;
  lastSync: Date | null;
  zones: string[];
  zone: string;
  onZone: (zone: string) => void;
  view: MapView;
  onView: (view: MapView) => void;
  sound: Sound;
  activity: ReactNode;
  onOpenAbout: () => void;
}

const HEALTH_VIEW = {
  unconfigured: { label: "API not configured", dot: "bg-fire", text: "text-fire-ink" },
  loading: { label: "Connecting…", dot: "bg-fg-3 animate-pulse", text: "text-fg-2" },
  connected: { label: "System online", dot: "bg-ok", text: "text-fg" },
  error: { label: "API offline", dot: "bg-fire", text: "text-fire-ink" },
} as const;

export const ALL_ZONES = "all";

const SEGMENT = `h-7 rounded-md px-2.5 text-[13px] font-medium transition-colors ${FOCUS}`;

export function TopBar(props: TopBarProps) {
  const { health, lastSync, sound } = props;
  const view = HEALTH_VIEW[health.kind];
  const [activityOpen, setActivityOpen] = useState(false);
  const closeActivity = useCallback(() => setActivityOpen(false), []);
  useEscape(activityOpen, closeActivity);

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-line bg-surface px-6">
      <div className="flex min-w-0 items-center gap-4">
        <h1 className="truncate text-xl font-semibold tracking-tight">Karachi Monitoring</h1>
        <label className="relative">
          <span className="sr-only">Zone</span>
          <select
            value={props.zone}
            onChange={(e) => props.onZone(e.target.value)}
            className={`h-8 appearance-none rounded-lg border border-line bg-surface pr-8 pl-3 text-[13px] font-medium text-fg hover:bg-muted ${FOCUS}`}
          >
            <option value={ALL_ZONES}>All zones</option>
            {props.zones.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
          <Icon name="chevronDown" size={14} className="pointer-events-none absolute top-2 right-2.5 text-fg-2" />
        </label>
      </div>

      <div className="flex items-center gap-2">
        <div role="group" aria-label="Map view" className="flex rounded-lg bg-muted p-0.5">
          {(["2d", "3d"] as MapView[]).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={props.view === v}
              onClick={() => props.onView(v)}
              className={`${SEGMENT} ${props.view === v ? "bg-surface text-fg shadow-sm" : "text-fg-2 hover:text-fg"}`}
            >
              {v.toUpperCase()}
            </button>
          ))}
        </div>

        {sound.supported && (
          <button
            type="button"
            onClick={sound.enabled ? sound.disable : sound.enable}
            aria-pressed={sound.enabled}
            className={`inline-flex h-8 items-center gap-2 rounded-lg border px-3 text-[13px] font-medium transition-colors ${FOCUS} ${
              sound.enabled ? "border-line bg-surface text-fg hover:bg-muted" : "border-navy bg-navy text-white hover:bg-navy/90"
            }`}
          >
            <Icon name={sound.enabled ? "bell" : "bellOff"} size={16} />
            {sound.enabled ? "Alerts on" : "Enable alerts"}
          </button>
        )}

        <div className="relative">
          <button
            type="button"
            aria-label="Recent events"
            title="Recent events"
            aria-expanded={activityOpen}
            onClick={() => setActivityOpen((v) => !v)}
            className={`${ICON_BUTTON} ${activityOpen ? "bg-muted text-fg" : ""}`}
          >
            <Icon name="activity" size={18} />
          </button>
          {activityOpen && (
            <>
              <div className="fixed inset-0 z-30" onMouseDown={closeActivity} />
              <div
                role="dialog"
                aria-label="Recent events"
                className="absolute top-full right-0 z-40 mt-2 max-h-[min(480px,70vh)] w-[360px] overflow-y-auto rounded-xl border border-line bg-surface p-2 shadow-float"
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest("button")) closeActivity();
                }}
              >
                <p className="px-2 pt-1 pb-2 text-xs font-medium tracking-wide text-fg-3 uppercase">Recent events</p>
                {props.activity}
              </div>
            </>
          )}
        </div>

        <span className="mx-2 h-6 w-px bg-line" aria-hidden />

        <div className="grid justify-items-end leading-tight">
          <span
            className={`flex items-center gap-1.5 text-[13px] font-medium ${view.text}`}
            title={health.kind === "error" ? health.message : lastSync ? `Last sync ${pktTime(lastSync)} PKT` : undefined}
          >
            <span aria-hidden className={`h-2 w-2 rounded-full ${view.dot}`} />
            {view.label}
            {health.kind === "error" && (
              <button type="button" onClick={props.onRetryHealth} className={`ml-1 rounded text-fg underline underline-offset-2 ${FOCUS}`}>
                Retry
              </button>
            )}
          </span>
          <button
            type="button"
            onClick={props.onOpenAbout}
            className={`rounded text-xs text-fg-2 hover:text-fg hover:underline ${FOCUS}`}
          >
            Demo environment
          </button>
        </div>
      </div>
    </header>
  );
}
