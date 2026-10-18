import { describe, expect, it } from "vitest";

import type { Scenario } from "@/lib/api/types";
import { CAMERA_KORANGI, DETECTION_PENDING, INCIDENT, SCENARIO_FIRE, scenarioRun } from "@/test/fixtures";

import { type FeedContext, NEGATIVE_HOLD_MS, scenarioFeedFor } from "./scenarioFeed";

const CREATED = "2026-10-17T19:07:50+00:00";
const T = new Date(CREATED).getTime();
const ctx = (over: Partial<FeedContext> = {}): FeedContext => ({ pending: [], incidents: [], nowMs: T + 20_000, resetAtMs: 0, ...over });

const KORANGI: Scenario = {
  ...SCENARIO_FIRE,
  video_url: "/api/v1/media/fire_jamestown_night.mp4",
  feed_start_s: 12,
  footage: { description: "Pre-recorded fire validation footage", recorded_in: "Jamestown, ND, USA, outside Karachi", source: "archive.org" },
};
const CLIFTON: Scenario = {
  ...KORANGI,
  id: "clifton-structure-smoke",
  name: "Clifton structure smoke",
  camera_id: "clifton-cam",
  video_asset: "smoke_structure_1964.mp4",
  video_url: "/api/v1/media/smoke_structure_1964.mp4",
  feed_start_s: 9,
};
const LYARI: Scenario = {
  ...KORANGI,
  id: "lyari-sunset-glare",
  name: "Lyari sunset glare",
  camera_id: "lyari-cam",
  video_asset: "street_sunset_traffic.mp4",
  video_url: "/api/v1/media/street_sunset_traffic.mp4",
  feed_start_s: 20,
  expected_behavior: "no_detection",
};
const run = (s: Scenario, over = {}) => ({ ...s, latest_run: scenarioRun({ scenario_id: s.id, camera_id: s.camera_id!, created_at: CREATED, ...over }) });

describe("scenarioFeedFor", () => {
  it("gives the scenario camera its clip from the moment the scenario starts", () => {
    const feed = scenarioFeedFor([run(KORANGI, { status: "scheduled" })], CAMERA_KORANGI.id, ctx());
    expect(feed).toMatchObject({ videoUrl: "/api/v1/media/fire_jamestown_night.mp4", startAt: 12, scenarioName: "Korangi industrial fire" });
    expect(scenarioFeedFor([run(KORANGI, { status: "running" })], CAMERA_KORANGI.id, ctx())?.videoUrl).toContain("fire_jamestown_night");
  });

  it("uses the smoke clip for the Clifton smoke scenario", () => {
    expect(scenarioFeedFor([run(CLIFTON, { status: "running" })], "clifton-cam", ctx())).toMatchObject({
      videoUrl: "/api/v1/media/smoke_structure_1964.mp4",
      startAt: 9,
    });
  });

  it("keeps the clip through review and while the incident is open", () => {
    const detected = run(KORANGI, { status: "detected", detection_event_id: DETECTION_PENDING.id });
    expect(scenarioFeedFor([detected], CAMERA_KORANGI.id, ctx({ pending: [DETECTION_PENDING] }))).not.toBeNull();
    expect(scenarioFeedFor([detected], CAMERA_KORANGI.id, ctx({ incidents: [INCIDENT] }))).not.toBeNull();
    // Reviewed and closed: the node returns to its normal feed.
    expect(scenarioFeedFor([detected], CAMERA_KORANGI.id, ctx({ incidents: [{ ...INCIDENT, status: "resolved" }] }))).toBeNull();
  });

  it("shows a negative scenario's clip while it runs and briefly after the verdict", () => {
    expect(scenarioFeedFor([run(LYARI, { status: "running" })], "lyari-cam", ctx())?.videoUrl).toBe("/api/v1/media/street_sunset_traffic.mp4");
    const done = run(LYARI, { status: "not_detected", completed_at: "2026-10-17T19:08:00+00:00" });
    const doneAt = new Date("2026-10-17T19:08:00+00:00").getTime();
    expect(scenarioFeedFor([done], "lyari-cam", ctx({ nowMs: doneAt + 5_000 }))).not.toBeNull();
    expect(scenarioFeedFor([done], "lyari-cam", ctx({ nowMs: doneAt + NEGATIVE_HOLD_MS + 1 }))).toBeNull();
  });

  it("drops every scenario clip at reset and for cancelled runs", () => {
    const live = run(KORANGI, { status: "running" });
    expect(scenarioFeedFor([live], CAMERA_KORANGI.id, ctx({ resetAtMs: T + 1 }))).toBeNull();
    expect(scenarioFeedFor([run(KORANGI, { status: "cancelled" })], CAMERA_KORANGI.id, ctx())).toBeNull();
  });

  it("follows the newest run when two scenarios share a camera", () => {
    const old = run(KORANGI, { status: "cancelled", created_at: "2026-10-17T19:00:00+00:00" });
    const follow = run({ ...KORANGI, id: "korangi-follow-up-detection", name: "Korangi follow-up detection" }, { status: "scheduled" });
    expect(scenarioFeedFor([old, follow], CAMERA_KORANGI.id, ctx())?.scenarioName).toBe("Korangi follow-up detection");
  });

  it("leaves cameras without a scenario alone", () => {
    expect(scenarioFeedFor([run(KORANGI, { status: "running" })], "other-cam", ctx())).toBeNull();
  });
});
