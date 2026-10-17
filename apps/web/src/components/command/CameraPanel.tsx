"use client";

import { useEffect, useState } from "react";

import type { Camera, DetectionResult } from "@/lib/api/types";
import { MONITORING_VIEW, SOURCE_VIEW } from "@/lib/city";
import {
  formatBytes,
  MAX_UPLOAD_BYTES,
  pktDateTime,
  MAX_VIDEO_SECONDS,
  peakConfidence,
  validateClip,
  videoOffset,
} from "@/lib/ops";

import {
  BUTTON_PRIMARY,
  BUTTON_SECONDARY,
  Facts,
  InlineError,
  Mono,
  SectionTitle,
} from "./ui";
import { CameraFeed, type FeedMode } from "./CameraFeed";

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
  return (
    <span className={`inline-flex items-center rounded-sm border px-1.5 text-[11px] leading-4 font-medium tracking-wide uppercase ${view.tone}`}>
      {view.short}
    </span>
  );
}

export function CameraPanel(props: CameraPanelProps) {
  const { camera, analysis, busyCameraName, pendingCount, onOpenReview } = props;
  const mine = analysis?.cameraId === camera.id ? analysis : null;

  return (
    <div className="grid gap-5">
      <header>
        <p className="font-mono text-[11px] tracking-wider text-ink-500 uppercase">
          {camera.code} · {camera.district ?? "Karachi"}
        </p>
        <div className="mt-0.5 flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold">{camera.name}</h2>
          <SourceBadge camera={camera} />
        </div>
        <p className="mt-0.5 text-sm text-ink-300">{camera.location_label}</p>
      </header>

      <CameraFeed camera={camera} mode={props.feed} />

      <Facts
        rows={[
          ["Camera code", <Mono key="c">{camera.code}</Mono>],
          [
            "Monitoring",
            <span key="s" className={MONITORING_VIEW[camera.monitoring_status].tone}>
              {MONITORING_VIEW[camera.monitoring_status].label}
            </span>,
          ],
          [
            "Feed",
            <span key="f" className={props.feed.kind === "none" ? "text-ink-300" : "text-ack"}>
              {props.feed.kind === "none" ? "No stream" : `${props.feed.label.toLowerCase()} (${camera.stream_type})`}
            </span>,
          ],
          ["Source type", SOURCE_VIEW[camera.source_type].label],
          ["Source", <span key="r" className="text-xs text-ink-300">{camera.source_reference ?? "—"}</span>],
          ["Last activity", props.lastActivity ? pktDateTime(props.lastActivity) : "No detections recorded"],
          [
            "Coordinates",
            <Mono key="x">
              {camera.latitude.toFixed(5)}, {camera.longitude.toFixed(5)}
            </Mono>,
          ],
        ]}
      />

      {props.scenarioNote && (
        <p className="border-l-2 border-notified pl-3 text-xs text-ink-300">{props.scenarioNote}</p>
      )}

      {pendingCount > 0 && (
        <button type="button" onClick={onOpenReview} className={`${BUTTON_SECONDARY} border-review/60 text-review`}>
          {pendingCount} detection{pendingCount > 1 ? "s" : ""} from this camera awaiting review →
        </button>
      )}

      <section aria-labelledby="analyze-title" className="grid gap-3 rounded-md border border-ink-700 bg-ink-850 p-4">
        <SectionTitle>
          <span id="analyze-title">Diagnostic: analyze a clip</span>
        </SectionTitle>
        <p className="text-xs text-ink-300">
          Fallback to the automated scenarios: upload a pre-recorded MP4 as this node&apos;s input. The
          API analyzes it with the same detector, keeps one evidence frame if it detects something,
          and deletes the video.
        </p>

        {mine?.phase === "uploading" || mine?.phase === "analyzing" ? (
          <ProcessingStages analysis={mine} />
        ) : mine?.phase === "negative" ? (
          <NegativeResult analysis={mine} onReset={props.onReset} />
        ) : (
          <>
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
      </section>
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
      <label className="grid gap-1.5 text-sm">
        <span className="text-ink-300">Video clip (.mp4)</span>
        <input
          type="file"
          accept="video/mp4,.mp4"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="text-sm text-ink-300 file:mr-3 file:rounded-md file:border file:border-ink-700 file:bg-ink-800 file:px-3 file:py-1.5 file:text-sm file:text-ink-100 hover:file:border-ink-500"
        />
      </label>
      {file && (
        <p className="text-sm">
          Selected: <span className="font-mono break-all">{file.name}</span>{" "}
          <span className="text-ink-300">({formatBytes(file.size)})</span>
        </p>
      )}
      {problem && <InlineError>{problem}</InlineError>}
      <p className="text-xs text-ink-500">
        Limits: MP4 up to {formatBytes(MAX_UPLOAD_BYTES)} and {MAX_VIDEO_SECONDS} s. Clips of 30 s
        or less at 480p work best.
      </p>
      {disabledReason && <p className="text-sm text-review">{disabledReason}</p>}
      <button
        type="button"
        className={BUTTON_PRIMARY}
        disabled={!file || !!problem || !!disabledReason}
        title={!file ? "Choose a clip first" : (problem ?? disabledReason ?? undefined)}
        onClick={() => file && onAnalyze(file)}
      >
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

const SERVER_STEPS = [
  ["Analyzing frames", "Samples 2 frames per second and runs the fire/smoke model on each."],
  ["Evaluating temporal consistency", "Requires a detection in at least 3 of any 5 consecutive sampled frames."],
  ["Preparing evidence", "Saves the strongest frame with its boxes for review."],
] as const;

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
      <p className="text-sm">
        <span className="font-mono break-all">{analysis.fileName}</span>
        <span className="ml-2 font-mono text-xs text-ink-300 tabular-nums">{elapsed} s elapsed</span>
      </p>
      <ol className="grid gap-2 text-sm">
        <li className="grid gap-1">
          <span className="flex items-center justify-between">
            <span className={uploading ? "font-medium text-notified" : "text-ack"}>
              {uploading ? "◌" : "✓"} Uploading footage
            </span>
            {percent !== null && <span className="font-mono text-xs tabular-nums">{percent}%</span>}
          </span>
          {uploading && (
            <span className="h-1 overflow-hidden rounded bg-ink-800">
              <span
                className="block h-full bg-notified transition-[width]"
                style={{ width: `${percent ?? 0}%` }}
              />
            </span>
          )}
        </li>
        {SERVER_STEPS.map(([label, detail]) => (
          <li key={label} className={uploading ? "text-ink-500" : ""}>
            <span className={uploading ? "" : "font-medium text-notified"}>
              {uploading ? "○" : "◌"} {label}
            </span>
            <span className="block text-xs text-ink-300">{detail}</span>
          </li>
        ))}
      </ol>
      {!uploading && (
        <>
          <span className="pr-indeterminate h-1 overflow-hidden rounded bg-ink-800" aria-hidden />
          <p className="text-xs text-ink-300">
            These steps run together on the server, which reports no partial progress. A 30 s clip
            usually takes 15–20 s; the first request after the demo server has been idle can take
            longer.
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
    <div role="status" className="grid gap-3">
      <p className="rounded-md border border-ink-700 bg-ink-900 px-3 py-2 text-sm font-medium">
        No persistent fire or smoke event detected.
      </p>
      <p className="text-xs text-ink-300">
        This is not a safety confirmation. The model can miss small, distant or black-and-white
        fires. Nothing was stored and no incident was created.
      </p>
      <Facts
        rows={[
          ["Clip", <span key="f" className="font-mono break-all">{analysis.fileName}</span>],
          ["Frames analyzed", <Mono key="n">{result.sampled_frames}</Mono>],
          ["Processing time", <Mono key="t">{result.processing_seconds.toFixed(1)} s</Mono>],
          ["Peak model confidence", <Mono key="p">{peak === null ? "—" : peak.toFixed(2)}</Mono>],
          ["Video length", <Mono key="d">{videoOffset(result.video.duration_s)}</Mono>],
          ["Decision rule", <span key="r" className="text-xs">{result.rule}</span>],
        ]}
      />
      <button type="button" className={BUTTON_SECONDARY} onClick={onReset}>
        Analyze another clip
      </button>
    </div>
  );
}
