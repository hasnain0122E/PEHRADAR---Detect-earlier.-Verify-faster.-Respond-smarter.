"use client";

import { useEffect, useRef, useState } from "react";

import type { Camera } from "@/lib/api/types";

/**
 * Feed abstraction (M5). One component for every stream type, chosen from the node's
 * stream_type. Adding an authorised HLS/RTSP-to-HLS source later only means seeding a
 * `public_live` (or future `authorized`) node with its URL; no UI change.
 *
 * Labels never overstate provenance: demo footage is always "SIMULATED LIVE FEED", and only a
 * `public_live` node may say "PUBLIC LIVE FEED".
 */

export type FeedMode =
  | { kind: "video"; src: string; loop: boolean; label: string; note: string }
  | { kind: "hls"; src: string; label: string; note: string }
  | { kind: "mjpeg"; src: string; label: string; note: string }
  | { kind: "none"; reason: string };

export const FEED_UNAVAILABLE = "Feed unavailable in hackathon environment";

export interface FeedOverride {
  /** Playable URL of the scenario clip currently on this node. */
  src: string;
  note: string;
}

export function feedMode(
  camera: Camera,
  resolve: (url: string | null) => string | null,
  override?: FeedOverride | null,
): FeedMode {
  if (camera.status !== "active") return { kind: "none", reason: `Camera ${camera.status}` };
  const label = camera.source_type === "public_live" ? "PUBLIC LIVE FEED" : "SIMULATED LIVE FEED";
  if (override && camera.source_type === "demo_stream") {
    return { kind: "video", src: override.src, loop: true, label, note: override.note };
  }
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
  const note =
    camera.source_type === "public_live"
      ? "Publicly viewable stream"
      : "Licensed sample footage looped on a simulated node. Not Karachi CCTV.";
  switch (camera.stream_type) {
    case "mp4_loop":
      return { kind: "video", src, loop: true, label, note };
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
  const [failed, setFailed] = useState<string | null>(null);
  const key = mode.kind === "none" ? "none" : mode.src;
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const error = failedKey === key ? failed : null;
  const video = useRef<HTMLVideoElement>(null);

  // Autoplay is muted, so browsers allow it; retry once the element is ready.
  useEffect(() => {
    const el = video.current;
    if (!el) return;
    el.play?.()?.catch(() => undefined);
  }, [key]);

  const fail = (message: string) => {
    setFailed(message);
    setFailedKey(key);
  };

  return (
    <figure
      className={`pr-feed relative overflow-hidden rounded-md border border-ink-700 bg-black ${compact ? "aspect-[16/8]" : "aspect-video"}`}
      aria-label={`Feed for ${camera.name}`}
    >
      {mode.kind === "none" || error ? (
        <div className="pr-feed-empty absolute inset-0 grid place-items-center p-4 text-center">
          <div>
            <p className="text-sm text-ink-100">{error ?? (mode.kind === "none" ? mode.reason : "")}</p>
            <p className="mt-1 font-mono text-[11px] text-ink-500">{camera.code}</p>
          </div>
        </div>
      ) : mode.kind === "mjpeg" ? (
        // eslint-disable-next-line @next/next/no-img-element -- MJPEG streams render only in <img>
        <img src={mode.src} alt={`Live view: ${camera.name}`} className="h-full w-full object-cover" onError={() => fail("Stream could not be loaded")} />
      ) : mode.kind === "hls" && !canPlayHls() ? (
        <div className="absolute inset-0 grid place-items-center p-4 text-center text-sm text-ink-300">
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
          preload="auto"
          aria-label={`${mode.label}: ${camera.name}`}
          className="h-full w-full object-cover"
          onError={() => fail("Feed could not be loaded")}
        />
      )}
      {mode.kind !== "none" && !error && (
        <>
          <span className={`pr-feed-tag absolute top-2 left-2 ${mode.label.startsWith("PUBLIC") ? "is-public" : ""}`}>
            <span aria-hidden className="pr-feed-dot" /> {mode.label}
          </span>
          <span className="absolute top-2 right-2 rounded-sm bg-black/60 px-1.5 font-mono text-[11px] text-ink-100">
            {camera.code}
          </span>
          {!compact && (
            <figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-2 pt-6 pb-1.5 text-[11px] text-ink-300">
              {mode.note}
            </figcaption>
          )}
        </>
      )}
    </figure>
  );
}
