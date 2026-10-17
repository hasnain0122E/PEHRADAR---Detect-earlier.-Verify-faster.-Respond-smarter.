"use client";

import { type ReactNode, useState } from "react";

import type { EventType, IncidentStatus, Severity } from "@/lib/api/types";
import { EVENT_LABEL, SEVERITY_VIEW, STATUS_LABEL, STATUS_TONE } from "@/lib/ops";

export const BUTTON =
  "inline-flex items-center justify-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-40";
export const BUTTON_SECONDARY = `${BUTTON} border-ink-700 bg-ink-800 hover:border-ink-500`;
export const BUTTON_PRIMARY = `${BUTTON} border-sev-high bg-sev-high text-ink-950 hover:bg-sev-high/90`;

/** Violet dashed provenance badge: SIMULATED / DEMO / UNVERIFIED (Design.md §4.2). */
export function ProvenanceBadge({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded border border-dashed border-sim/70 px-1.5 text-[11px] leading-4 font-medium tracking-wide text-sim uppercase">
      {children}
    </span>
  );
}

export function SeverityTag({ severity, prefix }: { severity: Severity; prefix?: string }) {
  const view = SEVERITY_VIEW[severity];
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold ${view.text}`}>
      <span aria-hidden>{view.glyph}</span>
      {prefix}
      {view.label}
    </span>
  );
}

export function StatusChip({ status }: { status: IncidentStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 text-[11px] leading-4 font-medium tracking-wide uppercase ${STATUS_TONE[status]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

export function EventChips({ type }: { type: EventType }) {
  const fire = type === "fire" || type === "fire_smoke";
  const smoke = type === "smoke" || type === "fire_smoke";
  return (
    <span className="inline-flex gap-1" aria-label={EVENT_LABEL[type]}>
      {fire && (
        <span className="rounded bg-sev-high px-1.5 text-[11px] leading-5 font-semibold text-ink-950">
          FIRE
        </span>
      )}
      {smoke && (
        <span className="rounded border border-[#B8C2CC] px-1.5 text-[11px] leading-[18px] font-semibold text-[#B8C2CC]">
          SMOKE
        </span>
      )}
    </span>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h3 className="text-xs font-medium tracking-wider text-ink-300 uppercase">{children}</h3>
  );
}

export function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[9rem_1fr] gap-x-3 gap-y-1.5 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-ink-300">{label}</dt>
          <dd className="min-w-0 break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Mono({ children }: { children: ReactNode }) {
  return <span className="font-mono tabular-nums">{children}</span>;
}

/** Evidence JPEG at panel width (16:9 box), with loading and error states. */
export function EvidenceImage({ src, alt }: { src: string | null; alt: string }) {
  const [state, setState] = useState<"loading" | "loaded" | "error">("loading");
  if (!src) {
    return (
      <div className="grid aspect-video place-items-center rounded-md border border-dashed border-ink-700 text-sm text-ink-500">
        No evidence frame stored
      </div>
    );
  }
  return (
    <a
      href={src}
      target="_blank"
      rel="noreferrer"
      className="relative block aspect-video overflow-hidden rounded-md border border-ink-700 bg-ink-850 focus-visible:outline-2 focus-visible:outline-focus"
      title="Open the full evidence frame"
    >
      {state === "loading" && <span className="absolute inset-0 animate-pulse bg-ink-800" />}
      {state === "error" && (
        <span className="absolute inset-0 grid place-items-center text-sm text-danger">
          Evidence image could not be loaded
        </span>
      )}
      {/* eslint-disable-next-line @next/next/no-img-element -- served by the API, not optimisable */}
      <img
        src={src}
        alt={alt}
        className="h-full w-full object-contain"
        onLoad={() => setState("loaded")}
        onError={() => setState("error")}
      />
    </a>
  );
}

export function InlineError({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="rounded-md border border-danger/50 bg-danger/10 px-3 py-2 text-sm text-danger">
      {children}
    </p>
  );
}

export const DECISION_SUPPORT =
  "Automated detection can be wrong. Confirm only if the evidence shows fire or smoke.";
