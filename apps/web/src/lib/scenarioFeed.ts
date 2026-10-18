// Final hotfix: which scenario clip (if any) a camera's viewer plays right now.
// The viewer plays the SAME asset the scenario engine runs through the detector.

import type { Detection, Incident, Scenario } from "@/lib/api/types";
import { isActiveIncident } from "@/lib/ops";

export const INCIDENT_FEED_LABEL = "SIMULATED INCIDENT FEED";
export const INCIDENT_FEED_NOTE =
  "Pre-recorded validation footage used for this demonstration. Not a live Karachi CCTV feed.";
/** A negative (no-detection) run keeps its clip on screen this long after the verdict. */
export const NEGATIVE_HOLD_MS = 60_000;

export interface ScenarioFeed {
  scenarioId: string;
  scenarioName: string;
  /** API-relative media URL of the scenario clip (resolved against the API origin). */
  videoUrl: string;
  /** Deterministic start near the incident sequence (no random offset for incident footage). */
  startAt: number;
  footage: Scenario["footage"];
}

export interface FeedContext {
  pending: Detection[];
  incidents: Incident[];
  /** Server-clock milliseconds now (browser clock + scenario offset). */
  nowMs: number;
  /** Server-clock time of the last reset in this console: older runs never override a feed. */
  resetAtMs: number;
}

const time = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : 0);

/**
 * The newest run on this camera decides:
 * - armed or analysing → its clip plays (from the moment the scenario starts);
 * - detected → its clip stays while the detection awaits review or the camera has an open
 *   incident (review and confirmation keep the same footage);
 * - no detection → its clip stays for NEGATIVE_HOLD_MS after the verdict, so the suppressed
 *   false alarm is visible;
 * - cancelled, failed, closed, or older than the last reset → the node's normal feed returns.
 */
export function scenarioFeedFor(scenarios: Scenario[], cameraId: string, ctx: FeedContext): ScenarioFeed | null {
  const latest = scenarios
    .filter((s) => s.camera_id === cameraId && s.latest_run && time(s.latest_run.created_at) > ctx.resetAtMs)
    .sort((a, b) => time(b.latest_run!.created_at) - time(a.latest_run!.created_at))[0];
  const run = latest?.latest_run;
  if (!latest || !run) return null;
  let show = false;
  switch (run.status) {
    case "scheduled":
    case "running":
      show = true;
      break;
    case "detected":
      show =
        ctx.pending.some((d) => d.id === run.detection_event_id) ||
        ctx.incidents.some((i) => isActiveIncident(i) && i.camera.id === cameraId);
      break;
    case "not_detected":
      show = ctx.nowMs - time(run.completed_at) < NEGATIVE_HOLD_MS;
      break;
    default:
      show = false;
  }
  if (!show) return null;
  return {
    scenarioId: latest.id,
    scenarioName: latest.name,
    videoUrl: latest.video_url ?? run.video_url,
    startAt: latest.feed_start_s ?? 0,
    footage: latest.footage,
  };
}
