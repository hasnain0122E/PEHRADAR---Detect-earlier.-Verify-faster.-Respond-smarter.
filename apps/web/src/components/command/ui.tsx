"use client";

import { type ReactNode, useEffect, useState } from "react";

import type { EventType, IncidentStatus, Severity } from "@/lib/api/types";
import { EVENT_LABEL, SEVERITY_VIEW, STATUS_LABEL, STATUS_TONE } from "@/lib/ops";

import { Icon, type IconName } from "../icons";

export const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-info";
export const BUTTON = `inline-flex h-9 items-center justify-center gap-2 rounded-lg border px-3.5 text-sm font-medium transition-colors ${FOCUS} disabled:cursor-not-allowed disabled:opacity-40`;
export const BUTTON_SECONDARY = `${BUTTON} border-line bg-surface text-fg hover:bg-muted`;
export const BUTTON_PRIMARY = `${BUTTON} border-navy bg-navy text-white hover:bg-navy/90`;
export const BUTTON_DANGER = `${BUTTON} border-fire bg-fire text-white hover:bg-fire/90`;
export const BUTTON_GHOST = `${BUTTON} border-transparent bg-transparent text-fg-2 hover:bg-muted hover:text-fg`;
export const ICON_BUTTON = `inline-grid h-8 w-8 place-items-center rounded-lg text-fg-2 transition-colors hover:bg-muted hover:text-fg ${FOCUS}`;

/** Neutral provenance tag: SIMULATED / DEMO / UNVERIFIED. Visible but quiet. */
export function ProvenanceBadge({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-md border border-dashed border-line-strong px-1.5 text-xs leading-5 font-medium text-fg-2">
      {children}
    </span>
  );
}

export function Tag({ children, tone = "bg-muted text-fg-2" }: { children: ReactNode; tone?: string }) {
  return <span className={`inline-flex items-center rounded-md px-2 text-xs leading-5 font-medium ${tone}`}>{children}</span>;
}

export function SeverityTag({ severity }: { severity: Severity }) {
  const view = SEVERITY_VIEW[severity];
  return <span className={`text-xs font-semibold tracking-wide ${view.text}`}>{view.label}</span>;
}

export function StatusChip({ status }: { status: IncidentStatus }) {
  return <Tag tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Tag>;
}

/** "Fire" / "Smoke" label with its glyph. aria-label keeps the API wording (FIRE, SMOKE…). */
export function EventLabel({ type, className = "" }: { type: EventType; className?: string }) {
  const smokeOnly = type === "smoke";
  return (
    <span aria-label={EVENT_LABEL[type]} className={`inline-flex items-center gap-1.5 font-semibold ${className}`}>
      <Icon name={smokeOnly ? "smoke" : "flame"} size={16} className={smokeOnly ? "text-fg-2" : "text-fire"} />
      {type === "fire" ? "Fire" : type === "smoke" ? "Smoke" : "Fire + smoke"}
    </span>
  );
}

/** Small uppercase section heading, used sparingly. */
export function SectionTitle({ children }: { children: ReactNode }) {
  return <h3 className="text-xs font-medium tracking-wide text-fg-3 uppercase">{children}</h3>;
}

/** Compact two-column metadata list. */
export function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[8.5rem_1fr] gap-x-3 gap-y-2 text-[13px]">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-fg-2">{label}</dt>
          <dd className="min-w-0 break-words text-fg">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Mono({ children }: { children: ReactNode }) {
  return <span className="font-mono text-[13px] tabular-nums">{children}</span>;
}

/** Collapsed-by-default secondary detail: "Detection details ›". Content stays in the DOM. */
export function Disclosure({ summary, children, defaultOpen = false }: { summary: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details className="group border-t border-line pt-3" open={defaultOpen}>
      <summary className={`flex cursor-pointer items-center gap-1 rounded text-sm font-medium text-fg-2 hover:text-fg ${FOCUS}`}>
        {summary}
        <Icon name="chevronRight" size={16} className="pr-chevron transition-transform" />
      </summary>
      <div className="grid gap-3 pt-3">{children}</div>
    </details>
  );
}

/** Small icon + number + label cell (status strip, metrics). */
export function Metric({ label, value, tone = "text-fg" }: { label: string; value: ReactNode; tone?: string }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-xs text-fg-2">{label}</dt>
      <dd className={`text-base font-semibold tabular-nums ${tone}`}>{value}</dd>
    </div>
  );
}

/** Evidence JPEG (16:9 box), with loading and error states. */
export function EvidenceImage({ src, alt, compact = false }: { src: string | null; alt: string; compact?: boolean }) {
  const [state, setState] = useState<"loading" | "loaded" | "error">("loading");
  const box = compact ? "aspect-[4/3]" : "aspect-video";
  if (!src) {
    return (
      <div className={`grid ${box} place-items-center rounded-lg border border-dashed border-line-strong text-[13px] text-fg-3`}>
        No evidence frame stored
      </div>
    );
  }
  return (
    <a
      href={src}
      target="_blank"
      rel="noreferrer"
      className={`relative block ${box} overflow-hidden rounded-lg bg-navy ${FOCUS}`}
      title="Open the full evidence frame"
    >
      {state === "loading" && <span className="absolute inset-0 animate-pulse bg-muted" />}
      {state === "error" && (
        <span className="absolute inset-0 grid place-items-center bg-muted text-[13px] text-fire-ink">
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
    <p role="alert" className="rounded-lg bg-fire-soft px-3 py-2 text-[13px] text-fire-ink">
      {children}
    </p>
  );
}

/** Quiet single-line note with an icon (disclaimers, provenance). */
export function Note({ children, icon = "info" }: { children: ReactNode; icon?: IconName }) {
  return (
    <p className="flex gap-2 text-[13px] text-fg-2">
      <Icon name={icon} size={16} className="mt-0.5 text-fg-3" />
      <span>{children}</span>
    </p>
  );
}

export function Skeleton({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-lg bg-muted ${className}`} />;
}

export const DECISION_SUPPORT =
  "Automated detection can be wrong. Confirm only if the evidence shows fire or smoke.";

/** Closes on Escape while `active`. */
export function useEscape(active: boolean, onEscape: () => void) {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onEscape();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, onEscape]);
}

/** Centred modal dialog with a dimmed backdrop. */
export function Modal({
  title,
  onClose,
  children,
  width = "max-w-[440px]",
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  width?: string;
}) {
  useEscape(true, onClose);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-navy/25 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title} className={`pr-drawer grid w-full ${width} gap-5 rounded-xl border border-line bg-surface p-6 shadow-float`}>
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold">{title}</h2>
          <button type="button" aria-label={`Close ${title.toLowerCase()}`} className={ICON_BUTTON} onClick={onClose}>
            <Icon name="x" size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
