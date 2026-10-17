// Response shapes of the PehRadar API (apps/api/app/routers/serializers.py and detect.py).
// Field names and enum values match the backend exactly (Rules.md §19).

export type EventType = "fire" | "smoke" | "fire_smoke";
export type Severity = "low" | "medium" | "high";
export type CameraStatus = "active" | "offline" | "maintenance";
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
  is_simulated: boolean;
  created_at: string | null;
  updated_at: string | null;
}

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
