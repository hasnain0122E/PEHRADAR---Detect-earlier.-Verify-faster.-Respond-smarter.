import { describe, expect, it } from "vitest";

import { INCIDENT, INCIDENT_DETAIL } from "@/test/fixtures";

import {
  MAX_UPLOAD_BYTES,
  peakConfidence,
  sortIncidents,
  timelineView,
  validateClip,
  videoOffset,
} from "./ops";

const clip = (size: number, name = "a.mp4", type = "video/mp4") =>
  new File([new Uint8Array(size)], name, { type });

describe("display rules", () => {
  it("sorts unresolved incidents first, then by severity, then newest", () => {
    const resolvedHigh = { ...INCIDENT, id: "r", status: "resolved" as const, created_at: "2026-10-17T20:00:00Z" };
    const activeLow = { ...INCIDENT, id: "l", severity: "low" as const, created_at: "2026-10-17T21:00:00Z" };
    const activeHighOld = { ...INCIDENT, id: "h1", created_at: "2026-10-17T18:00:00Z" };
    const activeHighNew = { ...INCIDENT, id: "h2", created_at: "2026-10-17T19:00:00Z" };
    const order = sortIncidents([resolvedHigh, activeLow, activeHighOld, activeHighNew]).map((i) => i.id);
    expect(order).toEqual(["h2", "h1", "l", "r"]);
  });

  it("labels timeline events, including operator-recorded status changes", () => {
    expect(INCIDENT_DETAIL.timeline.map((e) => timelineView(e).label)).toEqual([
      "Detected",
      "Confirmed",
      "Station selected",
    ]);
    const changed = { ...INCIDENT_DETAIL.timeline[0], event_type: "status_changed" as const };
    expect(timelineView({ ...changed, details: { to: "notified" } }).label).toBe("Notified");
    expect(timelineView({ ...changed, details: { to: "acknowledged" } }).label).toBe("Acknowledged");
    expect(timelineView({ ...changed, event_type: "rejected" }).label).toBe("Rejected");
  });

  it("validates clips on the client before upload", () => {
    expect(validateClip(clip(100))).toBeNull();
    expect(validateClip(clip(100, "a.avi"))).toMatch(/\.mp4/);
    expect(validateClip(clip(100, "a.mp4", "video/quicktime"))).toMatch(/not an MP4/);
    expect(validateClip(clip(0))).toMatch(/empty/);
    expect(validateClip(clip(MAX_UPLOAD_BYTES + 1))).toMatch(/demo limit/);
  });

  it("formats offsets and peak confidence", () => {
    expect(videoOffset(18.7)).toBe("00:18.7");
    expect(videoOffset(75)).toBe("01:15.0");
    const verdict = { confirmed: false, reason: null, positive_frames: 0, peak_confidence: 0.3, peak_timestamp: 1 };
    expect(peakConfidence({ fire: verdict })).toBe(0.3);
    expect(peakConfidence({})).toBeNull();
  });
});
