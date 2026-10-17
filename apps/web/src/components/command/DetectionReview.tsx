"use client";

import { useState } from "react";

import { ApiError } from "@/lib/api/client";
import type { Camera, Detection } from "@/lib/api/types";
import { confidence, EVENT_LABEL, pktDateTime, videoOffset } from "@/lib/ops";

import {
  BUTTON_PRIMARY,
  BUTTON_SECONDARY,
  DECISION_SUPPORT,
  EventChips,
  EvidenceImage,
  Facts,
  InlineError,
  Mono,
  ProvenanceBadge,
  SectionTitle,
} from "./ui";

interface DetectionReviewProps {
  detection: Detection;
  camera: Camera | undefined;
  evidenceSrc: string | null;
  onConfirm: (detection: Detection) => Promise<void>;
  onReject: (detection: Detection, note: string) => Promise<void>;
  onOpenIncident: (incidentId: string) => void;
  onBack: () => void;
}

type Armed = "confirm" | "reject" | null;

export function DetectionReview(props: DetectionReviewProps) {
  const { detection: d, camera, evidenceSrc } = props;
  const [armed, setArmed] = useState<Armed>(null);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<{ message: string; incidentId?: string } | null>(null);
  const details = d.details;
  const pending = d.review_status === "pending";

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
    <div className="grid gap-4">
      <header>
        <p className="text-xs font-medium tracking-wider text-review uppercase">
          {pending ? "Evidence review · awaiting operator decision" : `Detection ${d.review_status}`}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold">{camera?.name ?? "Unknown camera"}</h2>
          {d.is_simulated && <ProvenanceBadge>Simulated</ProvenanceBadge>}
        </div>
        <p className="font-mono text-xs text-ink-300">Detected {pktDateTime(d.detected_at)}</p>
      </header>

      <EvidenceImage
        key={evidenceSrc ?? "none"}
        src={evidenceSrc}
        alt={`Evidence frame: possible ${EVENT_LABEL[d.event_type].toLowerCase()} at ${camera?.name ?? "camera"}`}
      />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs text-ink-300">Possible event</p>
          <div className="mt-1">
            <EventChips type={d.event_type} />
          </div>
        </div>
        <div className="text-right">
          <p className="text-xs text-ink-300">Peak confidence</p>
          <p className="font-mono text-[28px] leading-8 font-semibold tabular-nums">
            {confidence(d.confidence)}
          </p>
        </div>
      </div>

      <Facts
        rows={[
          ["Strongest frame", <Mono key="t">{videoOffset(d.evidence_timestamp_s)} into the clip</Mono>],
          [
            "Positive frames",
            <Mono key="p">
              {details.positive_frames} of {details.sampled_frames} sampled
            </Mono>,
          ],
          ["Decision rule", <span key="r" className="text-xs">{details.rule}</span>],
          ["Camera location", camera ? `${camera.location_label}` : "—"],
          ["Model", <span key="m" className="font-mono text-xs break-all">{d.model}</span>],
          ["Processing time", <Mono key="s">{details.processing_seconds.toFixed(1)} s</Mono>],
        ]}
      />

      <ClassBreakdown classes={details.classes} />

      <p className="border-l-2 border-review pl-3 text-sm text-ink-300">{DECISION_SUPPORT}</p>

      {error && (
        <InlineError>
          {error.message}{" "}
          {error.incidentId && (
            <button
              type="button"
              className="underline underline-offset-2"
              onClick={() => props.onOpenIncident(error.incidentId!)}
            >
              Open the incident
            </button>
          )}
        </InlineError>
      )}

      {pending ? (
        <div className="sticky bottom-0 -mx-4 grid gap-3 border-t border-ink-700 bg-ink-900 px-4 py-3">
          {armed === null && (
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className={BUTTON_SECONDARY} onClick={() => setArmed("reject")}>
                Reject detection
              </button>
              <button type="button" className={BUTTON_PRIMARY} onClick={() => setArmed("confirm")}>
                Confirm incident
              </button>
            </div>
          )}
          {armed === "confirm" && (
            <div className="grid gap-2">
              <p className="text-sm">
                Create an incident for this camera? PehRadar will suggest the nearest available
                station by straight-line distance. <strong>No one is notified or dispatched.</strong>
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" className={BUTTON_SECONDARY} disabled={submitting} onClick={() => setArmed(null)}>
                  Cancel
                </button>
                <button type="button" className={BUTTON_PRIMARY} disabled={submitting} onClick={() => void submit("confirm")}>
                  {submitting ? "Confirming…" : "Yes, confirm incident"}
                </button>
              </div>
            </div>
          )}
          {armed === "reject" && (
            <div className="grid gap-2">
              <label className="grid gap-1 text-sm">
                <span>Reason (optional)</span>
                <input
                  type="text"
                  maxLength={1000}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="e.g. sunset glare, welding, steam"
                  className="rounded-md border border-ink-700 bg-ink-800 px-3 py-1.5 text-sm placeholder:text-ink-500 focus-visible:outline-2 focus-visible:outline-focus"
                />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" className={BUTTON_SECONDARY} disabled={submitting} onClick={() => setArmed(null)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className={`${BUTTON_SECONDARY} border-danger/70 text-danger`}
                  disabled={submitting}
                  onClick={() => void submit("reject")}
                >
                  {submitting ? "Rejecting…" : "Yes, reject detection"}
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="grid gap-2 rounded-md border border-ink-700 bg-ink-850 p-3 text-sm">
          <p role="status">
            {d.review_status === "rejected"
              ? "Detection rejected. No incident was created."
              : "Detection confirmed."}
            {d.reviewed_at && <span className="text-ink-300"> ({pktDateTime(d.reviewed_at)})</span>}
          </p>
          {d.review_note && <p className="text-ink-300">Reason: “{d.review_note}”</p>}
          <button type="button" className={BUTTON_SECONDARY} onClick={props.onBack}>
            Back to camera
          </button>
        </div>
      )}
    </div>
  );
}

function ClassBreakdown({ classes }: { classes: Detection["details"]["classes"] }) {
  const entries = Object.entries(classes);
  if (!entries.length) return null;
  return (
    <section className="grid gap-2">
      <SectionTitle>Per-class result</SectionTitle>
      <ul className="grid gap-1 text-sm">
        {entries.map(([label, v]) => (
          <li key={label} className="flex items-center justify-between gap-2">
            <span className="uppercase">{label}</span>
            <span className="font-mono text-xs text-ink-300 tabular-nums">
              {v.confirmed ? "✓ confirmed" : "✗ not confirmed"} · peak {v.peak_confidence.toFixed(2)}{" "}
              · {v.positive_frames} positive
            </span>
          </li>
        ))}
      </ul>
    </section>
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
