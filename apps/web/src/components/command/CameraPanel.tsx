"use client";

import { useEffect, useState } from "react";

import type { Camera, DetectionResult } from "@/lib/api/types";
import { MONITORING_VIEW, SOURCE_VIEW } from "@/lib/city";
import {
  formatBytes,
  MAX_UPLOAD_BYTES,
  MAX_VIDEO_SECONDS,
  peakConfidence,
  pktDateTime,
  validateClip,
} from "@/lib/ops";

import { Icon } from "../icons";
import { CameraFeed, type FeedMode } from "./CameraFeed";
import {
  BUTTON_PRIMARY,
  BUTTON_SECONDARY,
  Disclosure,
  Facts,
  FOCUS,
  InlineError,
  Mono,
  Note,
  Tag,
} from "./ui";

/** One analysis at a time: the API processes a single video at once. */
export type AnalysisState =
  | { cameraId: string; fileName: string; phase: "uploading"; loaded: number; total: number; startedAt: number }
  | { cameraId: string; fileName: string; phase: "analyzing"; startedAt: number }
  | { cameraId: string; fileName: string; phase: "negative"; result: DetectionResult }
  | { cameraId: string; fileName: string; phase: "error"; message: string };

export const isRunning = (a: AnalysisState | null) =>
  a?.phase === "uploading" || a?.phase === "analyzing";

interface CameraPanelProps {
  camera: Camera;
  analysis: AnalysisState | null;
  busyCameraName: string | null;
  pendingCount: number;
  onAnalyze: (file: File) => void;
  onReset: () => void;
  onOpenReview: () => void;
  feed: FeedMode;
  /** Latest real event on this camera (detection or incident), if any. */
  lastActivity: string | null;
  /** Demo scenario on this node: name and run state, if one is configured. */
  scenarioNote: string | null;
}

export function SourceBadge({ camera }: { camera: Camera }) {
  const view = SOURCE_VIEW[camera.source_type];
  return <Tag tone={view.tone}>{view.short}</Tag>;
}

export function CameraPanel(props: CameraPanelProps) {
  const { camera, analysis, busyCameraName, pendingCount, onOpenReview } = props;
  const mine = analysis?.cameraId === camera.id ? analysis : null;
  const monitoring = MONITORING_VIEW[camera.monitoring_status];
  const active = camera.status === "active";

  return (
    <div className="grid gap-6">
      <header className="grid gap-2">
        <h2 className="text-lg leading-6 font-semibold">{camera.name}</h2>
        <p className="flex items-center gap-1.5 text-sm text-fg-2">
          <Icon name="pin" size={16} className="text-fg-3" />
          {camera.location_label}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 text-[13px] font-medium capitalize ${active ? "text-ok-ink" : "text-fg-3"}`}
            title={monitoring.label}
          >
            <span aria-hidden className={`h-2 w-2 rounded-full ${active ? "bg-ok" : "bg-fg-3"}`} />
            {active ? "Online" : camera.status}
          </span>
          <SourceBadge camera={camera} />
        </div>
      </header>

      {mine?.phase === "negative" ? (
        <NegativeResult analysis={mine} onReset={props.onReset} />
      ) : (
        <CameraFeed camera={camera} mode={props.feed} />
      )}

      {pendingCount > 0 && (
        <button
          type="button"
          onClick={onOpenReview}
          className={`flex items-center justify-between rounded-lg bg-warn-soft px-3 py-2.5 text-left text-sm font-medium text-warn-ink ${FOCUS}`}
        >
          {pendingCount} detection{pendingCount > 1 ? "s" : ""} awaiting review
          <Icon name="chevronRight" size={16} />
        </button>
      )}

      <Facts
        rows={[
          [
            "Coordinates",
            <Mono key="x">
              {camera.latitude.toFixed(5)}, {camera.longitude.toFixed(5)}
            </Mono>,
          ],
          ["Last activity", props.lastActivity ? pktDateTime(props.lastActivity) : "No detections recorded"],
          ["Source", SOURCE_VIEW[camera.source_type].label],
          ["Code", <Mono key="c">{camera.code}</Mono>],
        ]}
      />

      {camera.source_reference && <Note>{camera.source_reference}</Note>}
      {props.scenarioNote && <Note icon="play">{props.scenarioNote}</Note>}

      <Disclosure
        summary={<span id="analyze-title">Test footage analysis</span>}
        defaultOpen={mine !== null && mine.phase !== "negative"}
      >
        {mine?.phase === "uploading" || mine?.phase === "analyzing" ? (
          <ProcessingStages analysis={mine} />
        ) : (
          <>
            <p className="text-[13px] text-fg-2">
              Upload an MP4 as this node&apos;s input. The detector analyses it; only one evidence frame
              is kept if something is found.
            </p>
            {mine?.phase === "error" && (
              <InlineError>
                Analysis of {mine.fileName} failed: {mine.message}
              </InlineError>
            )}
            <ClipPicker
              disabledReason={
                camera.status !== "active"
                  ? `Camera is ${camera.status}.`
                  : busyCameraName
                    ? `Another clip is being analyzed (${busyCameraName}). Wait for it to finish.`
                    : null
              }
              onAnalyze={props.onAnalyze}
            />
          </>
        )}
      </Disclosure>
    </div>
  );
}

function ClipPicker({
  disabledReason,
  onAnalyze,
}: {
  disabledReason: string | null;
  onAnalyze: (file: File) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const problem = file ? validateClip(file) : null;

  return (
    <div className="grid gap-3">
      <label className="grid gap-1.5 text-[13px]">
        <span className="text-fg-2">Video clip (.mp4)</span>
        <input
          type="file"
          accept="video/mp4,.mp4"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="text-[13px] text-fg-2 file:mr-3 file:h-8 file:rounded-lg file:border file:border-line file:bg-surface file:px-3 file:text-[13px] file:font-medium file:text-fg hover:file:bg-muted"
        />
      </label>
      {file && (
        <p className="text-[13px]">
          <span className="font-mono break-all">{file.name}</span>{" "}
          <span className="text-fg-2">({formatBytes(file.size)})</span>
        </p>
      )}
      {problem && <InlineError>{problem}</InlineError>}
      <p className="text-xs text-fg-3">
        MP4 up to {formatBytes(MAX_UPLOAD_BYTES)} and {MAX_VIDEO_SECONDS} s. Clips of 30 s or less at 480p work best.
      </p>
      {disabledReason && <p className="text-[13px] text-warn-ink">{disabledReason}</p>}
      <button
        type="button"
        className={BUTTON_PRIMARY}
        disabled={!file || !!problem || !!disabledReason}
        title={!file ? "Choose a clip first" : (problem ?? disabledReason ?? undefined)}
        onClick={() => file && onAnalyze(file)}
      >
        <Icon name="upload" size={16} />
        Analyze test footage
      </button>
    </div>
  );
}

function useElapsed(startedAt: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return Math.max(0, Math.floor((now - startedAt) / 1000));
}

const SERVER_STEPS = ["Analyzing frames", "Evaluating temporal consistency", "Preparing evidence"] as const;

function ProcessingStages({
  analysis,
}: {
  analysis: Extract<AnalysisState, { phase: "uploading" | "analyzing" }>;
}) {
  const elapsed = useElapsed(analysis.startedAt);
  const uploading = analysis.phase === "uploading";
  const percent =
    uploading && analysis.total > 0 ? Math.round((analysis.loaded / analysis.total) * 100) : null;

  return (
    <div role="status" aria-live="polite" className="grid gap-3">
      <p className="flex items-center justify-between gap-2 text-[13px]">
        <span className="truncate font-mono">{analysis.fileName}</span>
        <span className="shrink-0 text-fg-2 tabular-nums">{elapsed} s</span>
      </p>
      <ol className="grid gap-2 text-[13px]">
        <li className="grid gap-1.5">
          <span className="flex items-center justify-between">
            <span className={`flex items-center gap-2 ${uploading ? "font-medium text-info" : "text-fg-2"}`}>
              {uploading ? <span className="h-2 w-2 rounded-full bg-info" /> : <Icon name="check" size={14} className="text-ok" />}
              Uploading footage
            </span>
            {percent !== null && <span className="tabular-nums">{percent}%</span>}
          </span>
          {uploading && (
            <span className="h-1 overflow-hidden rounded bg-muted">
              <span className="block h-full bg-info transition-[width]" style={{ width: `${percent ?? 0}%` }} />
            </span>
          )}
        </li>
        {SERVER_STEPS.map((label) => (
          <li key={label} className={`flex items-center gap-2 ${uploading ? "text-fg-3" : "font-medium text-info"}`}>
            <span className={`h-2 w-2 rounded-full ${uploading ? "border border-fg-3" : "bg-info"}`} />
            {label}
          </li>
        ))}
      </ol>
      {!uploading && (
        <>
          <span className="pr-indeterminate h-1 overflow-hidden rounded bg-muted" aria-hidden />
          <p className="text-xs text-fg-3">
            These steps run together on the server, which reports no partial progress. A 30 s clip
            usually takes 15–20 s.
          </p>
        </>
      )}
    </div>
  );
}

function NegativeResult({
  analysis,
  onReset,
}: {
  analysis: Extract<AnalysisState, { phase: "negative" }>;
  onReset: () => void;
}) {
  const { result } = analysis;
  const peak = peakConfidence(result.classes);
  return (
    <section role="status" className="grid gap-4 rounded-lg border border-line p-4">
      <div className="flex items-start gap-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-muted text-fg-2">
          <Icon name="check" size={16} />
        </span>
        <div className="grid gap-1">
          <p className="text-base font-semibold">No persistent fire or smoke detected.</p>
          <p className="text-[13px] text-fg-2">This does not confirm the location is safe.</p>
        </div>
      </div>
      <dl className="grid grid-cols-3 gap-3 border-y border-line py-3">
        <div className="grid gap-0.5">
          <dt className="text-xs text-fg-2">Frames analysed</dt>
          <dd className="text-[15px] font-semibold tabular-nums">{result.sampled_frames}</dd>
        </div>
        <div className="grid gap-0.5">
          <dt className="text-xs text-fg-2">Processing time</dt>
          <dd className="text-[15px] font-semibold tabular-nums">{result.processing_seconds.toFixed(1)} s</dd>
        </div>
        <div className="grid gap-0.5">
          <dt className="text-xs text-fg-2">Peak confidence</dt>
          <dd className="text-[15px] font-semibold tabular-nums">{peak === null ? "—" : peak.toFixed(2)}</dd>
        </div>
      </dl>
      <p className="truncate text-xs text-fg-3">
        {analysis.fileName} · nothing stored, no incident created
      </p>
      <button type="button" className={BUTTON_SECONDARY} onClick={onReset}>
        Analyse another clip
      </button>
    </section>
  );
}
