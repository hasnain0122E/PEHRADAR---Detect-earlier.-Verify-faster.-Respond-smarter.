"use client";

import { useEffect, useRef, useState } from "react";

import type { Camera } from "@/lib/api/types";
import { INCIDENT_FEED_LABEL, INCIDENT_FEED_NOTE, type ScenarioFeed } from "@/lib/scenarioFeed";

import { Icon } from "../icons";

/**
 * Feed abstraction (M5). One component for every stream type, chosen from the node's
 * stream_type. Adding an authorised HLS/RTSP-to-HLS source later only means seeding a
 * `public_live` (or future `authorized`) node with its URL; no UI change.
 *
 * Labels never overstate provenance: demo footage is always "SIMULATED LIVE FEED", scenario
 * footage is "SIMULATED INCIDENT FEED", and only a `public_live` node may say "PUBLIC LIVE FEED".
 */

export type FeedMode =
  | {
      kind: "video";
      src: string;
      loop: boolean;
      label: string;
      note: string;
      /** M6B: where this node's loop starts, so nodes sharing a clip look different. */
      startAt?: number;
      /** M6B: second overlay tag, e.g. "Pakistan-based demo footage · Peshawar". */
      provenance?: string;
      /** Hotfix: the scenario clip playing on this node (same asset the detector analyses). */
      incident?: ScenarioFeed;
    }
  | { kind: "hls"; src: string; label: string; note: string }
  | { kind: "mjpeg"; src: string; label: string; note: string }
  | { kind: "none"; reason: string };

export const FEED_UNAVAILABLE = "Feed unavailable in hackathon environment";

/** The scenario clip temporarily replacing a node's feed (never stored on the camera). */
export type FeedOverride = ScenarioFeed;

export function feedMode(
  camera: Camera,
  resolve: (url: string | null) => string | null,
  override?: FeedOverride | null,
): FeedMode {
  // A running scenario feeds this node: its clip plays even if the node was marked offline,
  // so a valid scenario asset is never hidden behind "Camera offline".
  // A lawful public stream is never replaced by demo footage.
  const scenarioSrc = override && camera.source_type !== "public_live" ? resolve(override.videoUrl) : null;
  if (override && scenarioSrc) {
    return {
      kind: "video",
      src: scenarioSrc,
      loop: true,
      label: INCIDENT_FEED_LABEL,
      note: INCIDENT_FEED_NOTE,
      startAt: override.startAt,
      incident: override,
    };
  }
  if (camera.status !== "active") return { kind: "none", reason: `Camera ${camera.status}` };
  const label = camera.source_type === "public_live" ? "PUBLIC LIVE FEED" : "SIMULATED LIVE FEED";
  const src = resolve(camera.stream_url);
  if (!src) {
    return {
      kind: "none",
      reason:
        camera.source_type === "verified_mapped"
          ? `${FEED_UNAVAILABLE}: mapped location only, no stream access`
          : camera.source_type === "simulated_coverage"
            ? `${FEED_UNAVAILABLE}: simulated coverage node`
            : FEED_UNAVAILABLE,
    };
  }
  const feed = camera.feed;
  const note =
    camera.source_type === "public_live"
      ? "Publicly viewable stream"
      : feed
        ? `${feed.title}: ${feed.context}. Recorded in ${feed.city}, Pakistan, not at this location. Looped on a simulated node; not CCTV.`
        : "Licensed sample footage looped on a simulated node. Not Karachi CCTV.";
  switch (camera.stream_type) {
    case "mp4_loop":
      return {
        kind: "video",
        src,
        loop: true,
        label,
        note,
        startAt: feed?.start_offset_s,
        provenance: feed ? `Pakistan-based demo footage · ${feed.city}` : undefined,
      };
    case "hls":
      return { kind: "hls", src, label, note };
    case "mjpeg":
      return { kind: "mjpeg", src, label, note };
    default:
      return { kind: "none", reason: FEED_UNAVAILABLE };
  }
}

const canPlayHls = () =>
  typeof document !== "undefined" &&
  document.createElement("video").canPlayType("application/vnd.apple.mpegurl") !== "";

export function CameraFeed({
  camera,
  mode,
  compact = false,
}: {
  camera: Camera;
  mode: FeedMode;
  compact?: boolean;
}) {
  const [attempt, setAttempt] = useState(0);
  const key = mode.kind === "none" ? "none" : `${mode.src}#${attempt}`;
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const error = failure?.key === key ? failure.message : null;
  const [blocked, setBlocked] = useState<string | null>(null); // key whose autoplay was refused
  const [paused, setPaused] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const incident = mode.kind === "video" ? mode.incident : undefined;

  // Muted autoplay is normally allowed; if the browser still refuses, offer a Play button.
  useEffect(() => {
    const el = video.current;
    if (!el) return;
    el.play?.()?.catch(() => setBlocked(key));
  }, [key]);

  const fail = (message: string) => setFailure({ key, message });
  const play = () => {
    const el = video.current;
    if (!el) return;
    el.play?.()
      ?.then(() => setBlocked(null))
      .catch(() => setBlocked(key));
  };

  return (
    <figure className="grid gap-2" aria-label={`Feed for ${camera.name}`}>
      <div className={`relative overflow-hidden rounded-lg bg-navy ${compact ? "aspect-[16/9]" : "aspect-video"}`}>
        {mode.kind === "none" || error ? (
          <div className="pr-feed-empty absolute inset-0 grid place-items-center p-6 text-center">
            <div className="grid justify-items-center gap-2">
              <Icon name="camera" size={22} className="text-fg-3" />
              <p className="text-[13px] text-fg-2">{error ?? (mode.kind === "none" ? mode.reason : "")}</p>
              {error && (
                <button
                  type="button"
                  onClick={() => setAttempt((n) => n + 1)}
                  className="rounded-md border border-line bg-surface px-3 py-1 text-[13px] font-medium text-fg hover:bg-muted"
                >
                  Retry feed
                </button>
              )}
            </div>
          </div>
        ) : mode.kind === "mjpeg" ? (
          // eslint-disable-next-line @next/next/no-img-element -- MJPEG streams render only in <img>
          <img src={mode.src} alt={`Live view: ${camera.name}`} className="h-full w-full object-cover" onError={() => fail("Stream could not be loaded")} />
        ) : mode.kind === "hls" && !canPlayHls() ? (
          <div className="absolute inset-0 grid place-items-center p-4 text-center text-[13px] text-white/70">
            This browser cannot play HLS natively.
          </div>
        ) : (
          <video
            ref={video}
            key={key}
            src={mode.src}
            muted
            autoPlay
            playsInline
            loop={mode.kind === "video" ? mode.loop : false}
            // Only the selected camera's clip loads; incident footage buffers fully, idle loops
            // start with metadata (autoplay then streams what it needs).
            preload={incident ? "auto" : "metadata"}
            aria-label={`${mode.label}: ${camera.name}`}
            className="h-full w-full object-cover"
            onError={() => fail("Feed could not be loaded")}
            onPlay={() => setPaused(false)}
            onPause={() => setPaused(true)}
            onLoadedMetadata={(e) => {
              const start = mode.kind === "video" ? mode.startAt : undefined;
              const el = e.currentTarget;
              if (start && start < el.duration) el.currentTime = start;
            }}
          />
        )}
        {mode.kind !== "none" && !error && (
          <span
            className={`pr-feed-tag absolute top-3 left-3 ${mode.label.startsWith("PUBLIC") ? "is-public" : ""} ${incident ? "is-incident" : ""}`}
          >
            <span aria-hidden className="pr-feed-dot" /> {mode.label}
          </span>
        )}
        {mode.kind === "video" && mode.provenance && !error && (
          <span className="pr-feed-tag absolute bottom-3 left-3 font-medium tracking-normal normal-case">
            {mode.provenance}
          </span>
        )}
        {mode.kind !== "none" && mode.kind !== "mjpeg" && !error && blocked === key && (
          <button
            type="button"
            onClick={play}
            className="absolute inset-0 m-auto grid h-14 w-40 place-items-center rounded-xl bg-white/95 text-sm font-semibold text-[#111318] shadow-float"
          >
            <span className="flex items-center gap-2">
              <Icon name="play" size={20} />
              Play feed
            </span>
          </button>
        )}
        {mode.kind === "video" && !error && blocked !== key && (
          <button
            type="button"
            aria-label={paused ? "Play feed" : "Pause feed"}
            onClick={() => (paused ? play() : video.current?.pause())}
            className="absolute right-3 bottom-3 grid h-8 w-8 place-items-center rounded-lg bg-black/55 text-white hover:bg-black/70"
          >
            <Icon name={paused ? "play" : "pause"} size={16} />
          </button>
        )}
      </div>
      {incident && !error ? (
        <figcaption className="grid gap-1 text-xs text-fg-2">
          <span className="font-medium text-fg">{INCIDENT_FEED_NOTE}</span>
          <span>
            Scenario: <span className="text-fg">{incident.scenarioName}</span>
          </span>
          {incident.footage && (
            <span>
              {incident.footage.description} · Recorded in {incident.footage.recorded_in} · {incident.footage.source}
            </span>
          )}
        </figcaption>
      ) : (
        mode.kind !== "none" && !error && !compact && <figcaption className="text-xs text-fg-3">{mode.note}</figcaption>
      )}
    </figure>
  );
}
