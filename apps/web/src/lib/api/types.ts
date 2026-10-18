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
  | "fire_station_unclassified"
  | "police_station"
  | "ambulance_station";
/** M6C: the service a response facility belongs to. */
export type FacilityCategory = "fire" | "police" | "ambulance";
/** Suggested response units per incident, in display order. */
export type ResponseUnitKind = "fire" | "ambulance" | "police";
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
  | "detection_merged"
  | "resource_selected"
  | "no_resource_available"
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
  /** M6B: provenance of the demo footage on a demo_stream node; null elsewhere. */
  feed?: FeedMeta | null;
  created_at: string | null;
}

/** seed/feed_library.json entry as assigned to one node. Demo footage, never Karachi CCTV. */
export interface FeedMeta {
  asset: string;
  title: string;
  country: string;
  city: string;
  context: string;
  source_type: "licensed_sample" | "pakistan_demo_footage";
  is_demo_feed: true;
  /** Seconds into the clip where this node's loop starts, so shared clips look different. */
  start_offset_s: number;
  source_url: string | null;
  licence: string;
  licence_note: string;
  attribution: string | null;
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
  /** M6C. Older API versions omit it (fire only). */
  category?: FacilityCategory;
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
  /** M6C: suggested fire, ambulance and police resources (null when none was selected). */
  response_units?: Record<ResponseUnitKind, ResponseUnit | null>;
  is_simulated: boolean;
  created_at: string | null;
  updated_at: string | null;
}

/** One suggested response resource: the facility, its straight-line distance and road route. */
export interface ResponseUnit {
  unit: ResponseUnitKind;
  facility: FireStation;
  distance_km: number;
  method: string;
  reason: string | null;
  route: IncidentRoute | null;
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
  /** M6B: the detection joined a pending one on the same camera instead of raising a new alert. */
  merged_into_pending?: string;
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
  /** M6B scenario family shown in the demo dialog. */
  category?: "fire" | "smoke" | "false_alarm" | "interior" | "roadway";
  latest_run: ScenarioRun | null;
}

export interface ScenarioList {
  enabled: boolean;
  server_time: string;
  disclaimer?: string;
  /** Longest per-run delay the server accepts (seconds). */
  max_delay_s?: number;
  items: Scenario[];
}

export type ResetScope = "demo" | "full";

export type ResetResult =
  | { scope?: "demo"; runs_cancelled: number; detections_closed: number; incidents_closed: number }
  | {
      scope: "full";
      timeline_events_deleted: number;
      incidents_deleted: number;
      scenario_runs_deleted: number;
      detections_deleted: number;
      cameras_restored: number;
      stations_restored: number;
    };
