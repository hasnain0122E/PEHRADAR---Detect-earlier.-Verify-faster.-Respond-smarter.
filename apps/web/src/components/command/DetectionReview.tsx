"use client";

import { useState } from "react";

import { ApiError } from "@/lib/api/client";
import type { Camera, Detection } from "@/lib/api/types";
import { SOURCE_VIEW } from "@/lib/city";
import { confidencePct, EVENT_LABEL, pktDateTime, pktTime, videoOffset } from "@/lib/ops";

import { Icon } from "../icons";
import { CameraFeed, type FeedMode } from "./CameraFeed";
import {
  BUTTON_DANGER,
  BUTTON_SECONDARY,
  DECISION_SUPPORT,
  Disclosure,
  EvidenceImage,
  Facts,
  FOCUS,
  InlineError,
  Mono,
  ProvenanceBadge,
} from "./ui";

interface DetectionReviewProps {
  detection: Detection;
  camera: Camera | undefined;
  evidenceSrc: string | null;
  onConfirm: (detection: Detection) => Promise<void>;
  onReject: (detection: Detection, note: string) => Promise<void>;
  onOpenIncident: (incidentId: string) => void;
  onBack: () => void;
  feed?: FeedMode;
  /** Where the clip came from: a named demo scenario or an operator upload. */
  originNote?: string | null;
}

type Armed = "confirm" | "reject" | null;

const HEADLINE: Record<Detection["event_type"], string> = {
  fire: "Fire detected",
  smoke: "Smoke detected",
  fire_smoke: "Fire and smoke detected",
};

const SUMMARY: Record<Detection["event_type"], string> = {
  fire: "Persistent fire activity detected across consecutive sampled frames.",
  smoke: "Persistent smoke detected across consecutive sampled frames.",
  fire_smoke: "Persistent fire and smoke detected across consecutive sampled frames.",
};

export function DetectionReview(props: DetectionReviewProps) {
  const { detection: d, camera, evidenceSrc } = props;
  const [armed, setArmed] = useState<Armed>(null);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<{ message: string; incidentId?: string } | null>(null);
  const details = d.details;
  const pending = d.review_status === "pending";
  const smokeOnly = d.event_type === "smoke";

  async function submit(action: "confirm" | "reject") {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      if (action === "confirm") await props.onConfirm(d);
      else await props.onReject(d, note.trim());
    } catch (err) {
      const incidentId =
        err instanceof ApiError && typeof err.details?.incident_id === "string"
          ? err.details.incident_id
          : undefined;
      setError({ message: reviewErrorMessage(err), incidentId });
      setSubmitting(false);
      setArmed(null);
    }
    // On success the parent switches the panel, so this component unmounts.
  }

  return (
    <div className="grid gap-5">
      <header className="grid gap-2">
        <p
          aria-label={EVENT_LABEL[d.event_type]}
          className={`flex items-center gap-1.5 text-[13px] font-semibold tracking-wide uppercase ${
            pending ? (smokeOnly ? "text-warn-ink" : "text-fire-ink") : "text-fg-2"
          }`}
        >
          <Icon name={smokeOnly ? "smoke" : "flame"} size={16} />
          {HEADLINE[d.event_type]}
        </p>
        <h2 className="text-lg leading-6 font-semibold">{camera?.location_label ?? "Unknown location"}</h2>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-fg-2">
          {camera?.name !== camera?.location_label && <span>{camera?.name ?? "Unknown camera"}</span>}
          <span className="flex items-center gap-1">
            <Icon name="clock" size={14} className="text-fg-3" />
            {pktTime(d.detected_at)} PKT
          </span>
          {d.is_simulated && <ProvenanceBadge>Simulated</ProvenanceBadge>}
        </p>
      </header>

      <EvidenceImage
        key={evidenceSrc ?? "none"}
        src={evidenceSrc}
        alt={`Evidence frame: possible ${EVENT_LABEL[d.event_type].toLowerCase()} at ${camera?.name ?? "camera"}`}
      />

      <section aria-label="Detection metrics" className="grid gap-4">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-xs text-fg-2">AI confidence</p>
            <p className="text-[28px] leading-8 font-semibold tabular-nums">{confidencePct(d.confidence)}</p>
          </div>
          <dl className="flex gap-5 text-right">
            <div className="grid gap-1">
              <dt className="text-xs text-fg-2">Positive frames</dt>
              <dd className="text-sm font-semibold tabular-nums">
                {details.positive_frames} of {details.sampled_frames} sampled
              </dd>
            </div>
            <div className="grid gap-1">
              <dt className="text-xs text-fg-2">Strongest frame</dt>
              <dd className="text-sm font-semibold tabular-nums">{videoOffset(d.evidence_timestamp_s)} into the clip</dd>
            </div>
          </dl>
        </div>
        <p className="text-sm text-fg">{SUMMARY[d.event_type]}</p>
      </section>

      {error && (
        <InlineError>
          {error.message}{" "}
          {error.incidentId && (
            <button
              type="button"
              className="font-medium underline underline-offset-2"
              onClick={() => props.onOpenIncident(error.incidentId!)}
            >
              Open the incident
            </button>
          )}
        </InlineError>
      )}

      {pending ? (
        <div className="sticky bottom-0 -mx-5 grid gap-3 border-t border-line bg-surface px-5 py-4">
          {armed === null && (
            <>
              <p className="text-xs text-fg-2">{DECISION_SUPPORT}</p>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" className={BUTTON_SECONDARY} onClick={() => setArmed("reject")}>
                  Reject
                </button>
                <button type="button" className={BUTTON_DANGER} onClick={() => setArmed("confirm")}>
                  Confirm incident
                </button>
              </div>
            </>
          )}
          {armed === "confirm" && (
            <div className="grid gap-3">
              <p className="text-[13px] text-fg">
                Create an incident? PehRadar will suggest the nearest available station.{" "}
                <strong className="font-semibold">No one is notified or dispatched.</strong>
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" className={BUTTON_SECONDARY} disabled={submitting} onClick={() => setArmed(null)}>
                  Cancel
                </button>
                <button type="button" className={BUTTON_DANGER} disabled={submitting} onClick={() => void submit("confirm")}>
                  {submitting ? "Confirming…" : "Yes, confirm incident"}
                </button>
              </div>
            </div>
          )}
          {armed === "reject" && (
            <div className="grid gap-3">
              <label className="grid gap-1.5 text-[13px]">
                <span className="text-fg-2">Reason (optional)</span>
                <input
                  type="text"
                  maxLength={1000}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="e.g. sunset glare, welding, steam"
                  className={`h-9 rounded-lg border border-line bg-surface px-3 text-sm placeholder:text-fg-3 ${FOCUS}`}
                />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" className={BUTTON_SECONDARY} disabled={submitting} onClick={() => setArmed(null)}>
                  Cancel
                </button>
                <button type="button" className={BUTTON_SECONDARY} disabled={submitting} onClick={() => void submit("reject")}>
                  {submitting ? "Rejecting…" : "Yes, reject detection"}
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="grid gap-3 rounded-lg bg-muted p-4 text-[13px]">
          <p role="status" className="font-medium">
            {d.review_status === "rejected"
              ? "Detection rejected. No incident was created."
              : "Detection confirmed."}
            {d.reviewed_at && <span className="font-normal text-fg-2"> {pktDateTime(d.reviewed_at)}</span>}
          </p>
          {d.review_note && <p className="text-fg-2">Reason: “{d.review_note}”</p>}
          <button type="button" className={BUTTON_SECONDARY} onClick={props.onBack}>
            Back to camera
          </button>
        </div>
      )}

      {camera && props.feed && pending && (
        // Scenario footage opens by default so the evidence can be compared with the clip.
        <Disclosure
          summary={props.feed.kind === "video" && props.feed.incident ? "Camera feed (scenario footage)" : "Camera feed"}
          defaultOpen={props.feed.kind === "video" && !!props.feed.incident}
        >
          <CameraFeed camera={camera} mode={props.feed} compact />
        </Disclosure>
      )}

      <Disclosure summary="Detection details">
        <Facts
          rows={[
            ["Decision rule", details.rule],
            ["Threshold", <Mono key="th">{d.threshold.toFixed(2)}</Mono>],
            ["Model", <span key="m" className="font-mono text-xs break-all">{d.model}</span>],
            ["Processing time", <Mono key="s">{details.processing_seconds.toFixed(1)} s</Mono>],
            ["Input", props.originNote ?? "—"],
            ["Source", camera ? SOURCE_VIEW[camera.source_type].label : "—"],
            [
              "Coordinates",
              camera ? (
                <Mono key="xy">
                  {camera.latitude.toFixed(5)}, {camera.longitude.toFixed(5)}
                </Mono>
              ) : (
                "—"
              ),
            ],
          ]}
        />
        <ClassBreakdown classes={details.classes} />
      </Disclosure>
    </div>
  );
}

function ClassBreakdown({ classes }: { classes: Detection["details"]["classes"] }) {
  const entries = Object.entries(classes);
  if (!entries.length) return null;
  return (
    <ul aria-label="Per-class result" className="grid gap-1.5 text-[13px]">
      {entries.map(([label, v]) => (
        <li key={label} className="flex items-center justify-between gap-2">
          <span className="capitalize">{label}</span>
          <span className="text-fg-2 tabular-nums">
            {v.confirmed ? "confirmed" : "not confirmed"} · peak {v.peak_confidence.toFixed(2)} · {v.positive_frames} positive
          </span>
        </li>
      ))}
    </ul>
  );
}

export function reviewErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === "DETECTION_ALREADY_REVIEWED") {
      return "This detection was already reviewed, possibly from another console.";
    }
    if (err.kind === "unauthorized") {
      return "The API rejected the operator key. Check OPERATOR_API_KEY on the web server.";
    }
    if (err.code === "OPERATOR_KEY_NOT_CONFIGURED") {
      return "Operator actions are disabled: the API has no OPERATOR_API_KEY configured.";
    }
    return err.message;
  }
  return "The action failed unexpectedly. Try again.";
}
