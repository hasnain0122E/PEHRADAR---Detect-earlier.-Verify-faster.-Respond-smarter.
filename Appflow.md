# PehRadar — Application Flows

**Status:** Draft v0.1 (M0). Defines the intended behaviour. Endpoint names match `Techspec.md` §3.1. Enum values match `Schema.md` §3.

---

## 1. Operator journey: normal flow (dashboard → resolution)

| # | Operator action | System behaviour | UI result |
|---|---|---|---|
| 1 | Opens dashboard URL | Web loads. If there is no access key in `sessionStorage`, it prompts for one. Then it calls `GET /dashboard`, `/cameras`, `/stations`. | DEMO banner. Karachi map with camera markers (SIMULATED) and station markers (UNVERIFIED). Left rail shows the review queue (empty state if none). |
| 2 | Clicks a camera marker | `GET /cameras/{id}` | Right panel: camera details, SIMULATED badge, recent analysis jobs, "Run sample" selector, "Upload test video". |
| 3 | Picks a sample and presses **Start analysis** | `POST /cameras/{id}/analysis-jobs {sample_id}` returns `202` with a job (`QUEUED`). | Progress bar. Video plays in the panel. Camera marker shows the "analysing" ring. |
| 4 | Waits | Worker sets the job `PROCESSING`, samples frames, aggregates, and persists `DetectionEvent` rows (`PENDING_REVIEW`). The UI polls `GET /analysis-jobs/{id}` every 1 s. | Progress updates. A new card appears in the review queue. Optional chime. Camera marker turns to "pending review". |
| 5 | Job finishes | Job `COMPLETED`, upload file (if any) deleted. | "Analysis complete — N detections (M merged as duplicates)". |
| 6 | Opens the detection card | `GET /detections/{id}` plus the evidence image | Evidence review panel: annotated frame, class chips, peak confidence, video offset, wall-clock time (PKT), detector name/version, suggested severity, duplicate count, prior-rejection hint if any. |
| 7 | Presses **Confirm** (key `C`), checks severity, optional note, confirms | `POST /detections/{id}/confirm` creates an `Incident` (`OPEN`) and timeline events, then computes route estimates (≤ 3 candidates). | Card leaves queue. Incident marker (pulsing, severity colour) on map. Incident panel opens. |
| 8 | Reviews candidate stations | Data comes from `GET /incidents/{id}` | Up to 3 stations: rank, name, provenance badge, distance, duration (or "straight-line estimate"). |
| 9 | Selects a station and presses **Assign** | `POST /incidents/{id}/assign-station` adds timeline `STATION_ASSIGNED` | Route line drawn (solid if `ROAD_NETWORK`, dashed if `STRAIGHT_LINE`). **Notify station** button enabled. |
| 10 | Presses **Notify station** | — | Alert modal: TEST banner, station, "Demo recipient standing in for <station>", channel, message preview. |
| 11 | Presses **Send test notification** | `POST /incidents/{id}/notifications` with a new `client_request_id`. Provider sends. | Notification row `SENT`. Incident `NOTIFIED`. Timeline updated. |
| 12 | (Recipient) opens the ack link on phone | `GET /ack/{token}` | Ack page: TEST banner, incident summary (no evidence image), **Acknowledge** button. |
| 13 | (Recipient) presses **Acknowledge** | `POST /ack/{token}` | Recipient sees confirmation. Within ≤ 3 s the operator sees notification `ACKNOWLEDGED` and incident `ACKNOWLEDGED`. |
| 14 | Presses **Resolve**, picks code (e.g. `HANDLED`) and note | `POST /incidents/{id}/resolve` | Incident `RESOLVED`. Marker moves to the history layer (hidden by default). Timeline complete. |

## 2. Alternate and error flows

### 2.1 Rejected detection (false positive)
1. Operator opens a card and presses **Reject** (key `R`).
2. Modal requires a `reason_code`: `FALSE_POSITIVE_LIGHTING`, `FALSE_POSITIVE_DUST_FOG`, `FALSE_POSITIVE_STEAM`, `CONTROLLED_FIRE`, `POOR_EVIDENCE`, or `OTHER` (note required for `OTHER`).
3. `POST /detections/{id}/reject` sets status `REJECTED` and records `reviewed_at`, `review_reason_code`, `review_note`, `reviewed_by_label`.
4. The card leaves the queue. No incident and no notification are created. The camera's recent jobs show "1 rejected".
5. Later detections from that camera are **not** suppressed. Their cards show "This camera had a rejected detection 4 min ago (reason: lighting)".

### 2.2 Duplicate detection
- **Same job:** handled by aggregation cooldown (`Techspec.md` §4.4). It never reaches the DB as a separate event.
- **Pending detection exists** (same camera, within 15 min, not higher severity): the new event is stored as `DUPLICATE` with `duplicate_of_detection_id`. No new card. The existing card's badge increments to "+1 similar".
- **Active incident exists** (not higher severity): stored as `DUPLICATE` with `incident_id`. Timeline `ADDITIONAL_DETECTION`. The incident panel shows "Additional detections: 2".
- **Higher severity than the existing record:** a new `PENDING_REVIEW` card with an **ESCALATION** tag. Confirming it attaches it to the existing incident (if any), and the operator may raise the incident severity (`SEVERITY_CHANGED`).
- When a pending parent is confirmed, its duplicates inherit `incident_id`. When it is rejected, its duplicates stay `DUPLICATE` and are listed under the rejected record.

### 2.3 Invalid upload
| Condition | API response | UI |
|---|---|---|
| Wrong type / bad magic bytes | `415 UNSUPPORTED_MEDIA` | Inline error under upload control: "Only MP4, MOV or WebM video files are accepted." |
| > `MAX_UPLOAD_MB` | `413 UPLOAD_TOO_LARGE` | "File exceeds 50 MB." Client also pre-checks size before upload. |
| > `MAX_VIDEO_SECONDS` | `422 VIDEO_TOO_LONG` | "Video is longer than 120 s — trim it and retry." |
| Cannot decode | `422 VIDEO_UNREADABLE` | "The video could not be decoded." |
| Camera already has an active job | `409 CAMERA_BUSY` | "Analysis already running on this camera" with a link to the job. |

In all of these cases no job row is created.

### 2.4 Job failure during processing
- Decoder error mid-file → job `FAILED`, `error_code = DECODE_FAILED`. Detection events persisted before the failure are kept (they are real candidates from earlier frames). The UI shows "Analysis failed after 34 s of video — 1 detection was recorded before the failure".
- Detector exception → `DETECTOR_ERROR`, same handling.
- API restart while processing → on startup the job is set `FAILED` with `JOB_INTERRUPTED` (AC-17). The UI offers **Run again**.

### 2.5 Notification failure
1. Provider returns an error, or times out after `NOTIFY_TIMEOUT_S`.
2. Notification `FAILED` with `attempt_count`, `last_error` (sanitized, e.g. "Provider returned 401 — check API key"), timeline `NOTIFICATION_FAILED`.
3. Incident status **unchanged** (stays `OPEN`, or stays `NOTIFIED` if an earlier notification succeeded).
4. The UI shows a red notification row with **Retry** (`POST /notifications/{id}/retry`) and a persistent incident badge "Notification failed".
5. After `NOTIFY_MAX_ATTEMPTS`, Retry is disabled and the API returns `429 NOTIFICATION_LIMIT_REACHED`. The UI says "Retry limit reached — contact the station by other means." This is a reminder that PehRadar is not the only channel.
6. Missing recipient configuration (no `DEMO_RECIPIENTS` entry for the channel) → the modal shows "No test recipient configured" and the Send button is disabled.

### 2.6 Routing unavailable
- Provider timeout or error → candidates ranked by straight-line distance, `method = STRAIGHT_LINE`, timeline `STATION_SUGGESTED` notes the fallback.
- UI: amber note "Road routing unavailable — showing straight-line estimates" plus a **Refresh routes** action (`POST /incidents/{id}/route-estimates/refresh`).
- The incident flow (assign, notify, resolve) is never blocked by routing.

### 2.7 Acknowledgement edge cases
| Case | Result |
|---|---|
| Link opened (GET) by an email security scanner | No state change (only POST acknowledges). |
| Token reused | `410 TOKEN_USED`. Page shows "Already acknowledged at 14:32 PKT". |
| Token expired | `410 TOKEN_EXPIRED`. Page shows "This link has expired". |
| Unknown token | `404 TOKEN_INVALID`. Generic "Link not valid" message (no incident data leaked). |
| Ack after incident `RESOLVED` | Notification becomes `ACKNOWLEDGED` and a timeline event is written. Incident stays `RESOLVED` (status never moves backwards). |
| Second notification acked while incident already `ACKNOWLEDGED` | Notification `ACKNOWLEDGED`, timeline event, incident unchanged. |

### 2.8 Concurrency / double submit
- Two operators (or a double click) confirm the same detection: the first succeeds, the second gets `409 INVALID_STATE_TRANSITION`. The UI refreshes and shows the existing incident.
- Notification double-click: same `client_request_id`, so the API returns the original notification (`200`) and no second send happens.
- Any action on a `RESOLVED` incident returns `409`. The UI disables those controls.

### 2.9 Session / auth
- Missing or wrong access key returns `401 UNAUTHORIZED`. The UI clears the stored key and shows the key prompt.
- API unreachable (e.g. free host asleep): a top-bar status pill shows "API offline — retrying" with backoff. Map and last data stay visible and marked stale ("Last updated 40 s ago").

## 3. State machines

### 3.1 DetectionEvent.status

```
             ┌──────────────── created by pipeline + dedup.decide ────────────────┐
             ▼                                                                    ▼
      PENDING_REVIEW ── confirm ──▶ CONFIRMED                                 DUPLICATE (terminal;
             │                                                                 linked to parent detection
             └────── reject ──▶ REJECTED                                       or incident)
```
- `CONFIRMED`, `REJECTED` and `DUPLICATE` are terminal. There is no un-reject in the MVP. If the operator rejected by mistake, the next detection from that camera creates a new card, or the sample can be re-run.

### 3.2 Incident.status

```
  (confirm detection, no active incident on camera)
                    │
                    ▼
                  OPEN ──── first notification SENT ───▶ NOTIFIED ──── ack POST ───▶ ACKNOWLEDGED
                    │                                       │                             │
                    └──────────── resolve ──────────────────┴───────── resolve ───────────┘
                                                            ▼
                                                        RESOLVED (terminal)
```

| From | Event | To | Guard |
|---|---|---|---|
| — | Detection confirmed | `OPEN` | No non-RESOLVED incident for that camera. Otherwise attach to the existing one. |
| `OPEN` | Notification SENT | `NOTIFIED` | — |
| `OPEN` | Notification FAILED | `OPEN` | (no change) |
| `NOTIFIED` | Additional notification SENT/FAILED | `NOTIFIED` | ≤ `NOTIFY_MAX_PER_INCIDENT` |
| `NOTIFIED` | Ack POST | `ACKNOWLEDGED` | Valid token |
| `ACKNOWLEDGED` | Ack POST (another notification) | `ACKNOWLEDGED` | (no change) |
| `OPEN`/`NOTIFIED`/`ACKNOWLEDGED` | Resolve | `RESOLVED` | `resolution_code` required |
| `RESOLVED` | anything except a late ack | — | `409 INVALID_STATE_TRANSITION` |

Allowed actions per state:
| Action | OPEN | NOTIFIED | ACKNOWLEDGED | RESOLVED |
|---|---|---|---|---|
| Assign / change station | ✔ | ✔ | ✔ | ✘ |
| Send notification | ✔ (station required) | ✔ (station required) | ✘ | ✘ |
| Retry failed notification | ✔ | ✔ | ✘ | ✘ |
| Add note | ✔ | ✔ | ✔ | ✔ |
| Resolve | ✔ | ✔ | ✔ | ✘ |

### 3.3 Notification.status
```
QUEUED ──send ok──▶ SENT ──ack POST──▶ ACKNOWLEDGED
   │                  
   └──send fail──▶ FAILED ──retry (attempt < max)──▶ QUEUED
```

### 3.4 AnalysisJob.status
```
QUEUED ──worker picks──▶ PROCESSING ──done──▶ COMPLETED
   │                         └──error / restart──▶ FAILED
   └──startup, upload file missing──▶ FAILED
```

## 4. Sequence: camera → detection → review → notification → ack

```
Operator      Web (Next.js)            API (FastAPI)              Worker thread            DB              Provider        Recipient
   │ click cam     │                         │                          │                    │                  │                │
   │──────────────▶│ GET /cameras/{id}       │                          │                    │                  │                │
   │ start sample  │────────────────────────▶│ validate, insert job ───────────────────────▶│ QUEUED           │                │
   │──────────────▶│ POST analysis-jobs      │◀─ 202 job ─────────────── │                    │                  │                │
   │               │ poll GET job (1 s)      │                          │ pick job ─────────▶│ PROCESSING       │                │
   │               │                         │                          │ sample→detect→agg  │                  │                │
   │               │                         │                          │ dedup.decide(snap)◀│ read snapshot    │                │
   │               │                         │                          │ insert detection ─▶│ PENDING_REVIEW   │                │
   │               │ poll GET /dashboard 3 s │◀────────────────────────────────────────────── │                  │                │
   │ card appears ◀│ (chime if enabled)      │                          │ done ─────────────▶│ COMPLETED        │                │
   │ confirm       │ POST confirm            │ tx: detection CONFIRMED, incident OPEN,       │                  │                │
   │──────────────▶│────────────────────────▶│     timeline x3 ─────────────────────────────▶│                  │                │
   │               │                         │ rank stations (+routing, 5 s timeout) ───────▶│ route_estimate   │                │
   │ assign+notify │ POST assign, POST notif │ checks, token, QUEUED ──────────────────────▶│                  │                │
   │──────────────▶│────────────────────────▶│ send ──────────────────────────────────────────────────────────▶│                │
   │               │                         │◀── ok ───────────────────────────────────────────────────────── │ email/webhook ▶│
   │               │◀─ SENT, incident NOTIFIED│ update ─────────────────────────────────────▶│                  │                │
   │               │                         │◀───────────────────────────── GET /ack/{t}, then POST /ack/{t} ─────────────────│
   │               │                         │ ACKNOWLEDGED (notif + incident), timeline ──▶│                  │                │
   │ sees ACK      │ poll                    │                          │                    │                  │                │
```

## 5. Timeline events written per flow

| Flow step | `IncidentTimelineEvent.event_type` | `actor_type` |
|---|---|---|
| Confirm creates incident | `DETECTION_CREATED` (backdated to detection `created_at`), `DETECTION_CONFIRMED`, `INCIDENT_CREATED` | SYSTEM, OPERATOR, SYSTEM |
| Confirm attaches to existing incident | `DETECTION_CONFIRMED` (+ `SEVERITY_CHANGED` if raised) | OPERATOR |
| Duplicate attached to incident | `ADDITIONAL_DETECTION` | SYSTEM |
| Candidates computed | `STATION_SUGGESTED` (payload: ranked ids, method) | SYSTEM |
| Assign station | `STATION_ASSIGNED` | OPERATOR |
| Notification | `NOTIFICATION_QUEUED`, then `NOTIFICATION_SENT` or `NOTIFICATION_FAILED` | OPERATOR, SYSTEM |
| Ack | `NOTIFICATION_ACKNOWLEDGED` | RECIPIENT |
| Note | `NOTE_ADDED` | OPERATOR |
| Resolve | `INCIDENT_RESOLVED` | OPERATOR |

Rejected detections have no incident and therefore no timeline. Their review data lives on the `detection_event` row.
