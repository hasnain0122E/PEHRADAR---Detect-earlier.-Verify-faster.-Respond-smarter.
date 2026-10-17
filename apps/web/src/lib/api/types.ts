// Response shapes of the PehRadar API (apps/api/app/routers/serializers.py and detect.py).
// Field names and enum values match the backend exactly (Rules.md §19).

export type EventType = "fire" | "smoke" | "fire_smoke";
export type Severity = "low" | "medium" | "high";
export type CameraStatus = "active" | "offline" | "maintenance";
/** M5 provenance: what the node really is (Schema.md). */
export type SourceType = "public_live" | "verified_mapped" | "simulated_coverage" | "demo_stream";
export type StreamType = "hls" | "mjpeg" | "mp4_loop" | "none";
/** What PehRadar actually does with the node (serializers.monitoring_status). */
export type MonitoringStatus =
  | "monitoring"
  | "simulated"
  | "not_connected"
  | "offline"
  | "maintenance";
export type FacilityType =
  | "municipal_fire_station"
  | "port_fire_station"
  | "airport_fire_station"
  | "industrial_fire_station"
  | "rescue_station"
  | "institutional_fire_response"
  | "fire_station_unclassified";
export type StationStatus = "available" | "unavailable";
export type ReviewStatus = "pending" | "confirmed" | "rejected";
export type IncidentStatus =
  | "detected"
  | "confirmed"
  | "station_selected"
  | "notified"
  | "acknowledged"
  | "resolved"
  | "rejected";
export type TimelineEventType =
  | "detection_created"
  | "operator_confirmed"
  | "station_selected"
  | "no_station_available"
  | "route_generated"
  | "route_unavailable"
  | "status_changed"
  | "resolved"
  | "rejected";

export interface Camera {
  id: string;
  code: string;
  name: string;
  latitude: number;
  longitude: number;
  location_label: string;
  department: string;
  status: CameraStatus;
  is_simulated: boolean;
  district: string | null;
  camera_type: string;
  source_type: SourceType;
  source_reference: string | null;
  stream_type: StreamType;
  /** API-relative for demo loops (/api/v1/media/...), absolute only for public_live. */
  stream_url: string | null;
  monitoring_status: MonitoringStatus;
  created_at: string | null;
}

export interface FireStation {
  id: string;
  code: string;
  name: string;
  latitude: number;
  longitude: number;
  location_label: string;
  status: StationStatus;
  status_note: string;
  is_simulated: boolean;
  data_source: string;
  source_ref: string | null;
  licence: string | null;
  verification_status: "unverified" | "verified";
  operator: string | null;
  facility_type: FacilityType;
  availability_is_demo: boolean;
  created_at: string | null;
}

export interface ClassVerdict {
  confirmed: boolean;
  reason: "window" | "single_frame" | null;
  positive_frames: number;
  peak_confidence: number;
  peak_timestamp: number | null;
}

export interface EvidenceBox {
  label: string;
  confidence: number;
  box: number[];
}

export interface VideoInfo {
  size_bytes: number;
  width: number;
  height: number;
  fps: number;
  duration_s: number;
  frames_decoded: number;
}

/** `detection_event.details`: a copy of the detector result fields (detect.py _detection_details). */
export interface DetectionDetails {
  classes: Record<string, ClassVerdict>;
  sampled_frames: number;
  positive_frames: number;
  processing_seconds: number;
  rule: string;
  video: VideoInfo;
  boxes: EvidenceBox[];
  /** M5: where the clip came from. Older rows have no source. */
  source?:
    | { kind: "upload" }
    | { kind: "scenario"; scenario_id: string; scenario_run_id: string; video_asset: string };
}

export interface Detection {
  id: string;
  camera_id: string;
  event_type: EventType;
  confidence: number;
  evidence_url: string | null;
  evidence_timestamp_s: number | null;
  detected_at: string;
  model: string;
  threshold: number;
  review_status: ReviewStatus;
  reviewed_at: string | null;
  reviewed_by: string | null;
  review_note: string | null;
  details: DetectionDetails;
  is_simulated: boolean;
  created_at: string | null;
}

export interface StationSelection {
  station: FireStation;
  distance_km: number;
  method: string;
  is_driving_eta: false;
  note: string;
}

export interface Incident {
  id: string;
  event_type: EventType;
  severity: Severity;
  status: IncidentStatus;
  latitude: number;
  longitude: number;
  camera: Camera;
  detection_event_id: string;
  evidence_url: string | null;
  assigned_station_id: string | null;
  station_selection: StationSelection | null;
  confirmed_by: string | null;
  confirmed_at: string | null;
  resolved_at: string | null;
  /** Suggested response route; lists omit `geometry`. */
  route: IncidentRoute | null;
  is_simulated: boolean;
  created_at: string | null;
  updated_at: string | null;
}

export type IncidentRoute =
  | {
      status: "ok";
      provider: string;
      profile: string;
      from_station_id: string;
      distance_km: number;
      duration_min: number;
      straight_line_km: number;
      geometry?: { type: "LineString"; coordinates: [number, number][] };
      generated_at: string;
      is_estimate: true;
      note: string;
    }
  | {
      status: "unavailable";
      provider: string | null;
      from_station_id: string;
      reason: string;
      fallback: "straight_line";
      straight_line_km: number;
      generated_at: string;
      is_estimate: true;
      note: string;
    };

export interface TimelineEvent {
  id: string;
  seq: number;
  event_type: TimelineEventType;
  actor: "system" | "operator";
  actor_label: string | null;
  message: string;
  details: Record<string, unknown>;
  occurred_at: string;
  created_at: string | null;
}

export interface IncidentDetail extends Incident {
  detection: Detection;
  timeline: TimelineEvent[];
}

/** POST /api/v1/detect/fire response. */
export interface DetectionResult {
  status: "detected" | "not_detected";
  event_type: EventType | null;
  confidence: number;
  best_frame_timestamp: number | null;
  sampled_frames: number;
  positive_frames: number;
  processing_seconds: number;
  model: string;
  threshold: number;
  rule: string;
  classes: Record<string, ClassVerdict>;
  evidence: { url: string; timestamp: number | null; boxes: EvidenceBox[] } | null;
  video: VideoInfo;
  inference_ms_per_frame: number;
  peak_rss_mb: number | null;
  disclaimer: string;
  camera: Camera | null;
  detection_event_id: string | null;
  review_status?: ReviewStatus;
}

export interface ReviewInput {
  operator?: string;
  note?: string;
}

export type ScenarioRunStatus =
  | "scheduled"
  | "running"
  | "detected"
  | "not_detected"
  | "failed"
  | "cancelled";

/** Real detector output recorded on the run (services/scenarios.summarize). */
export interface ScenarioResult {
  status: "detected" | "not_detected";
  event_type: EventType | null;
  confidence: number;
  sampled_frames: number;
  positive_frames: number;
  processing_seconds: number;
  model: string;
  rule: string;
  classes: Record<string, { confirmed: boolean; peak_confidence: number; positive_frames: number }>;
}

export interface ScenarioRun {
  id: string;
  scenario_id: string;
  camera_id: string;
  video_asset: string;
  video_url: string;
  status: ScenarioRunStatus;
  started_by: string | null;
  trigger_at: string;
  triggered_at: string | null;
  completed_at: string | null;
  detection_event_id: string | null;
  result: ScenarioResult | null;
  error: string | null;
  created_at: string | null;
}

export interface Scenario {
  id: string;
  name: string;
  description: string;
  camera_id: string | null;
  camera_code: string;
  video_asset: string;
  trigger_after_seconds: number;
  expected_behavior: "fire_detected" | "smoke_detected" | "no_detection";
  latest_run: ScenarioRun | null;
}

export interface ScenarioList {
  enabled: boolean;
  server_time: string;
  disclaimer?: string;
  items: Scenario[];
}

export interface ResetResult {
  runs_cancelled: number;
  detections_closed: number;
  incidents_closed: number;
}
