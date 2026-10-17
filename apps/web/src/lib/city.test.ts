import { describe, expect, it } from "vitest";

import {
  CAMERA_KORANGI,
  CAMERA_MAPPED,
  CAMERA_SADDAR,
  DETECTION_PENDING,
  INCIDENT,
  ROUTE_OK,
  SCENARIO_FIRE,
  scenarioRun,
  STATION_LANDHI,
  STATION_ORANGI,
} from "@/test/fixtures";

import { buildActivity, cityStats } from "./city";

describe("cityStats", () => {
  it("counts only what the API data shows", () => {
    const offline = { ...CAMERA_KORANGI, id: "x", code: "KHI-CAM-99", status: "offline" as const };
    const stats = cityStats(
      [CAMERA_SADDAR, CAMERA_KORANGI, CAMERA_MAPPED, offline],
      [STATION_LANDHI, STATION_ORANGI],
      [DETECTION_PENDING],
      [INCIDENT, { ...INCIDENT, id: "closed", status: "resolved" }],
    );
    expect(stats).toEqual({
      nodes: 4,
      feeds: 2,
      feedsOnline: 1,
      simulated: 1,
      mapped: 1,
      pending: 1,
      activeIncidents: 1,
      availableStations: 1,
      stations: 2,
    });
  });
});

describe("buildActivity", () => {
  it("lists real scenario, detection and incident events newest first", () => {
    const run = scenarioRun({
      status: "detected",
      triggered_at: "2026-10-17T19:08:01+00:00",
      completed_at: "2026-10-17T19:08:15+00:00",
      detection_event_id: DETECTION_PENDING.id,
      result: {
        status: "detected",
        event_type: "fire",
        confidence: 0.7274,
        sampled_frames: 57,
        positive_frames: 38,
        processing_seconds: 12.8,
        model: "m",
        rule: "r",
        classes: { fire: { confirmed: true, peak_confidence: 0.7274, positive_frames: 38 } },
      },
    });
    const entries = buildActivity({
      cameras: [CAMERA_KORANGI],
      incidents: [{ ...INCIDENT, route: ROUTE_OK }],
      pending: [DETECTION_PENDING],
      scenarios: [{ ...SCENARIO_FIRE, latest_run: run }],
      local: [],
    });

    expect(entries.map((e) => e.text)).toEqual([
      "Suggested road route generated: 9.1 km, about 11 min (estimate)",
      expect.stringMatching(/^Incident confirmed by operator: FIRE, HIGH severity/),
      expect.stringMatching(/^Candidate station selected: Landhi Fire Station \(7\.6 km straight-line\)/),
      "Possible FIRE detected at Korangi Industrial Area; operator review required",
      "Temporal confirmation passed: FIRE 0.73, 38/57 frames",
      "Demo feed changed; real detector analysing frames",
      expect.stringMatching(/^Scenario armed: Korangi industrial fire/),
    ]);
    expect(entries.every((e) => e.code === "KHI-CAM-03")).toBe(true);
    const confirmed = entries.find((e) => e.text.startsWith("Temporal"));
    expect(confirmed?.select).toEqual({ kind: "detection", id: DETECTION_PENDING.id });
  });

  it("reports a negative scenario without raising an alert entry", () => {
    const run = scenarioRun({
      status: "not_detected",
      triggered_at: "2026-10-17T19:08:01+00:00",
      completed_at: "2026-10-17T19:08:15+00:00",
      result: {
        status: "not_detected",
        event_type: null,
        confidence: 0,
        sampled_frames: 57,
        positive_frames: 1,
        processing_seconds: 14,
        model: "m",
        rule: "r",
        classes: { fire: { confirmed: false, peak_confidence: 0.52, positive_frames: 1 } },
      },
    });
    const entries = buildActivity({
      cameras: [CAMERA_KORANGI],
      incidents: [],
      pending: [],
      scenarios: [{ ...SCENARIO_FIRE, latest_run: run }],
      local: [],
    });
    expect(entries[0]).toMatchObject({ tone: "ok", text: expect.stringContaining("peak 0.52") });
    expect(entries.some((e) => e.tone === "alert")).toBe(false);
  });

  it("has no entries without data (nothing invented)", () => {
    expect(buildActivity({ cameras: [], incidents: [], pending: [], scenarios: [SCENARIO_FIRE], local: [] })).toEqual([]);
  });
});
