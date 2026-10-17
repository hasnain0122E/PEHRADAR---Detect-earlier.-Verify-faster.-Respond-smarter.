// Response fixtures shaped like the real API (apps/api serializers). Ids are UUIDs because the
// operator proxy only forwards UUID paths.
import { vi } from "vitest";

import type { OpsApi } from "@/lib/api/client";
import type {
  Camera,
  Detection,
  DetectionResult,
  FireStation,
  Incident,
  IncidentDetail,
  Scenario,
  ScenarioList,
  ScenarioRun,
} from "@/lib/api/types";

export const CAMERA_KORANGI: Camera = {
  id: "18cce093-0fc3-5d7b-b0a2-1eb134d3c656",
  code: "KHI-CAM-03",
  name: "Korangi Industrial Area (simulated)",
  latitude: 24.833,
  longitude: 67.124,
  location_label: "Korangi Industrial Area",
  department: "fire",
  status: "active",
  is_simulated: true,
  district: "Korangi",
  camera_type: "fixed_cctv",
  source_type: "demo_stream",
  source_reference: "PehRadar demo stream: licensed sample footage looped as a simulated feed",
  stream_type: "mp4_loop",
  stream_url: "/api/v1/media/street_sunset_traffic.mp4",
  monitoring_status: "monitoring",
  created_at: "2026-10-17T10:00:00+00:00",
};

export const CAMERA_SADDAR: Camera = {
  ...CAMERA_KORANGI,
  id: "2b8f0c55-5b7e-5d0e-9d7a-6a1c3f0d1e01",
  code: "KHI-CAM-01",
  name: "Saddar - Empress Market (simulated)",
  latitude: 24.8608,
  longitude: 67.0302,
  location_label: "Saddar, near Empress Market",
  district: "Saddar",
  source_type: "simulated_coverage",
  source_reference: "PehRadar simulated coverage point (M3 demo camera)",
  stream_type: "none",
  stream_url: null,
  monitoring_status: "simulated",
};

/** OSM-mapped camera location: real place, no feed access. */
export const CAMERA_MAPPED: Camera = {
  ...CAMERA_SADDAR,
  id: "4c1d2e3f-0a1b-5c2d-8e3f-4a5b6c7d8e9f",
  code: "KHI-OSM-001",
  name: "Mapped surveillance point near Gulshan-e-Iqbal",
  latitude: 24.93872,
  longitude: 67.09846,
  location_label: "Gulshan-e-Iqbal (OSM-mapped camera location)",
  district: "Gulshan-e-Iqbal",
  is_simulated: false,
  source_type: "verified_mapped",
  source_reference: "osm:node/12272747009 (man_made=surveillance)",
  monitoring_status: "not_connected",
};

export const STATION_LANDHI: FireStation = {
  id: "7d1c2b3a-4e5f-5a6b-8c7d-9e0f1a2b3c4d",
  code: "KHI-FS-03",
  name: "Landhi Fire Station",
  latitude: 24.85,
  longitude: 67.2,
  location_label: "Landhi",
  status: "available",
  status_note: "Demo availability flag; not real-time station availability.",
  is_simulated: false,
  data_source: "osm",
  source_ref: "osm:node/5133191784",
  licence: "ODbL-1.0",
  verification_status: "unverified",
  operator: null,
  facility_type: "municipal_fire_station",
  availability_is_demo: true,
  created_at: "2026-10-17T10:00:00+00:00",
};

export const STATION_ORANGI: FireStation = {
  ...STATION_LANDHI,
  id: "8e2d3c4b-5f60-5b7c-9d8e-0f1a2b3c4d5e",
  code: "KHI-FS-04",
  name: "Orangi Fire Station",
  latitude: 24.95,
  longitude: 66.99,
  status: "unavailable",
  source_ref: "osm:node/5087779613",
};

const CLASSES = {
  fire: { confirmed: true, reason: "window" as const, positive_frames: 38, peak_confidence: 0.7274, peak_timestamp: 18.7 },
  smoke: { confirmed: false, reason: null, positive_frames: 0, peak_confidence: 0.02, peak_timestamp: 3 },
};
const VIDEO = { size_bytes: 482072, width: 640, height: 360, fps: 30, duration_s: 29.9, frames_decoded: 897 };
const RULE = "score >= 0.45 in >= 3 of any 5 consecutive sampled frames";

export const DETECTION_PENDING: Detection = {
  id: "3401c1ec-0037-44d1-ba70-c441fecc422a",
  camera_id: CAMERA_KORANGI.id,
  event_type: "fire",
  confidence: 0.7274,
  evidence_url: "/api/v1/detections/3401c1ec-0037-44d1-ba70-c441fecc422a/evidence.jpg",
  evidence_timestamp_s: 18.7,
  detected_at: "2026-10-17T19:08:16+00:00",
  model: "cctv-ai-fire-smoke-yolov8n-320@343990e",
  threshold: 0.45,
  review_status: "pending",
  reviewed_at: null,
  reviewed_by: null,
  review_note: null,
  details: {
    classes: CLASSES,
    sampled_frames: 57,
    positive_frames: 38,
    processing_seconds: 12.8,
    rule: RULE,
    video: VIDEO,
    boxes: [],
  },
  is_simulated: true,
  created_at: "2026-10-17T19:08:16+00:00",
};

export const POSITIVE_RESULT: DetectionResult = {
  status: "detected",
  event_type: "fire",
  confidence: 0.7274,
  best_frame_timestamp: 18.7,
  sampled_frames: 57,
  positive_frames: 38,
  processing_seconds: 12.8,
  model: DETECTION_PENDING.model,
  threshold: 0.45,
  rule: RULE,
  classes: CLASSES,
  evidence: { url: DETECTION_PENDING.evidence_url!, timestamp: 18.7, boxes: [] },
  video: VIDEO,
  inference_ms_per_frame: 190,
  peak_rss_mb: 176.2,
  disclaimer: "Decision support only. A human operator must review this result.",
  camera: CAMERA_KORANGI,
  detection_event_id: DETECTION_PENDING.id,
  review_status: "pending",
};

export const NEGATIVE_RESULT: DetectionResult = {
  ...POSITIVE_RESULT,
  status: "not_detected",
  event_type: null,
  confidence: 0,
  best_frame_timestamp: null,
  sampled_frames: 60,
  positive_frames: 0,
  processing_seconds: 14.5,
  classes: {
    fire: { confirmed: false, reason: null, positive_frames: 1, peak_confidence: 0.52, peak_timestamp: 12 },
    smoke: { confirmed: false, reason: null, positive_frames: 0, peak_confidence: 0.11, peak_timestamp: 4 },
  },
  evidence: null,
  detection_event_id: null,
  review_status: undefined,
};

export const INCIDENT: Incident = {
  id: "c0a80101-0000-4000-8000-000000000001",
  event_type: "fire",
  severity: "high",
  status: "station_selected",
  latitude: CAMERA_KORANGI.latitude,
  longitude: CAMERA_KORANGI.longitude,
  camera: CAMERA_KORANGI,
  detection_event_id: DETECTION_PENDING.id,
  evidence_url: DETECTION_PENDING.evidence_url,
  assigned_station_id: STATION_LANDHI.id,
  station_selection: {
    station: STATION_LANDHI,
    distance_km: 7.63,
    method: "straight_line_haversine",
    is_driving_eta: false,
    note: "Geographic proximity only.",
  },
  confirmed_by: "Duty operator (demo console)",
  confirmed_at: "2026-10-17T19:11:44+00:00",
  resolved_at: null,
  route: null,
  is_simulated: true,
  created_at: "2026-10-17T19:11:44+00:00",
  updated_at: "2026-10-17T19:11:44+00:00",
};

export const INCIDENT_DETAIL: IncidentDetail = {
  ...INCIDENT,
  detection: { ...DETECTION_PENDING, review_status: "confirmed" },
  timeline: [
    {
      id: "t1",
      seq: 1,
      event_type: "detection_created",
      actor: "system",
      actor_label: null,
      message: "fire detected on KHI-CAM-03 (confidence 0.73)",
      details: {},
      occurred_at: "2026-10-17T19:08:16+00:00",
      created_at: "2026-10-17T19:11:44+00:00",
    },
    {
      id: "t2",
      seq: 2,
      event_type: "operator_confirmed",
      actor: "operator",
      actor_label: "Duty operator (demo console)",
      message: "Operator confirmed the detection; incident created with severity high",
      details: {},
      occurred_at: "2026-10-17T19:11:44+00:00",
      created_at: "2026-10-17T19:11:44+00:00",
    },
    {
      id: "t3",
      seq: 3,
      event_type: "station_selected",
      actor: "system",
      actor_label: null,
      message: "Candidate station: Landhi Fire Station, 7.63 km straight-line",
      details: { distance_km: 7.63 },
      occurred_at: "2026-10-17T19:11:44+00:00",
      created_at: "2026-10-17T19:11:44+00:00",
    },
  ],
};

export const ROUTE_OK: Extract<NonNullable<Incident["route"]>, { status: "ok" }> = {
  status: "ok",
  provider: "osrm",
  profile: "driving",
  from_station_id: STATION_LANDHI.id,
  distance_km: 9.05,
  duration_min: 11.0,
  straight_line_km: 7.63,
  geometry: {
    type: "LineString",
    coordinates: [
      [67.2, 24.85],
      [67.16, 24.84],
      [67.124, 24.833],
    ],
  },
  generated_at: "2026-10-17T19:11:45+00:00",
  is_estimate: true,
  note: "Suggested response route. Not a dispatch confirmation.",
};

export const SCENARIO_FIRE: Scenario = {
  id: "korangi-industrial-fire",
  name: "Korangi industrial fire",
  description: "Night building fire on the Korangi node.",
  camera_id: CAMERA_KORANGI.id,
  camera_code: CAMERA_KORANGI.code,
  video_asset: "fire_jamestown_night.mp4",
  trigger_after_seconds: 45,
  expected_behavior: "fire_detected",
  latest_run: null,
};

export function scenarioRun(overrides: Partial<ScenarioRun> = {}): ScenarioRun {
  return {
    id: "9a8b7c6d-0000-4000-8000-00000000aa01",
    scenario_id: SCENARIO_FIRE.id,
    camera_id: CAMERA_KORANGI.id,
    video_asset: SCENARIO_FIRE.video_asset,
    video_url: "/api/v1/media/fire_jamestown_night.mp4",
    status: "scheduled",
    started_by: "Duty operator (demo console)",
    trigger_at: "2026-10-17T19:08:00+00:00",
    triggered_at: null,
    completed_at: null,
    detection_event_id: null,
    result: null,
    error: null,
    created_at: "2026-10-17T19:07:15+00:00",
    ...overrides,
  };
}

export function scenarioList(items: Scenario[] = [SCENARIO_FIRE], enabled = true): ScenarioList {
  return { enabled, server_time: new Date().toISOString(), items };
}

/** OpsApi double with sensible defaults; override any method per test. */
export function fakeApi(overrides: Partial<OpsApi> = {}): OpsApi {
  return {
    listCameras: vi.fn().mockResolvedValue([CAMERA_SADDAR, CAMERA_KORANGI]),
    listStations: vi.fn().mockResolvedValue([STATION_LANDHI, STATION_ORANGI]),
    listIncidents: vi.fn().mockResolvedValue([]),
    getIncident: vi.fn().mockResolvedValue(INCIDENT_DETAIL),
    listPendingDetections: vi.fn().mockResolvedValue([]),
    getDetection: vi.fn().mockResolvedValue(DETECTION_PENDING),
    analyzeFootage: vi.fn().mockResolvedValue(NEGATIVE_RESULT),
    confirmDetection: vi.fn().mockResolvedValue(INCIDENT_DETAIL),
    rejectDetection: vi
      .fn()
      .mockResolvedValue({ ...DETECTION_PENDING, review_status: "rejected", reviewed_at: "2026-10-17T19:12:00+00:00" }),
    listScenarios: vi.fn().mockResolvedValue(scenarioList()),
    startScenario: vi.fn().mockResolvedValue(scenarioRun()),
    resetScenarios: vi.fn().mockResolvedValue({ runs_cancelled: 0, detections_closed: 0, incidents_closed: 0 }),
    evidenceSrc: (path) => (path ? `http://api.test${path}` : null),
    mediaSrc: (url) => (url ? (url.startsWith("/") ? `http://api.test${url}` : url) : null),
    ...overrides,
  };
}

export function healthyFetch() {
  return vi.fn().mockImplementation(async () =>
    Response.json({ status: "ok", app: "pehradar-api", version: "0.1.0" }),
  );
}
