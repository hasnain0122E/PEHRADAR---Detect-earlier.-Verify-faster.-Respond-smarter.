# PehRadar — Application Flows

**Status:** Draft v0.1 (M0); §1.2 (M5 automated monitoring), §1.1 (M4 UI), §3.1, §3.2 and §5 (M3) describe implemented behaviour. Defines the intended behaviour. Endpoint names match `Techspec.md` §3.1. Enum values match `Schema.md` §3.

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

### 1.1 M4 command-center flow (implemented 2026-10-17; replaces rows 1–8 above until jobs and notifications exist)

| # | Operator action | System behaviour | UI result |
|---|---|---|---|
| 1 | Opens the dashboard | Browser calls `GET /cameras`, `/fire-stations`, `/incidents`, `/detections?review_status=pending` directly on the API, then polls incidents and pending detections every 10 s. | Demo banner, map fitted to all cameras and stations, Cameras tab, overview panel with counts. |
| 2 | Clicks a camera (map or list) | — | Map eases to it. Panel: camera details (SIMULATED) and **Analyze test footage**. |
| 3 | Chooses a local MP4 and presses **Analyze test footage** | Client checks `.mp4`, type and ≤ 4 MB. The browser posts `multipart(camera_id, file)` to `/api/operator/detect/fire` on the web app. The Next.js route adds `X-Operator-Key` and forwards to `POST /api/v1/detect/fire`. | Stage list: Uploading (real %), then server steps with an indeterminate bar and elapsed seconds. Camera marker shows the analysing ring. |
| 4a | Result `detected` | API stores a **pending** `DetectionEvent`. The web fetches `GET /detections/{id}`. | Alert strip "Possible FIRE detected at …". Review tab. Evidence review panel opens. Camera marker turns amber with a badge. |
| 4b | Result `not_detected` | Nothing stored. | "No persistent fire or smoke event detected." with frames, processing time, peak confidence, and **Analyze another clip**. |
| 5 | **Confirm incident**, then **Yes, confirm incident** | `POST /api/operator/detections/{id}/confirm` → API creates the incident, severity, timeline and nearest available station. Buttons are disabled while it runs, so a second click does nothing. | Incidents tab. Incident panel with a success line ("Candidate station: … km straight-line. No dispatch was sent."). The map frames the incident and the candidate station. |
| 5′ | **Reject detection**, optional reason, **Yes, reject detection** | `POST /api/operator/detections/{id}/reject {note}`. No incident. | "Detection rejected. No incident was created." Badge cleared. |
| 6 | Opens an incident from the queue or map | `GET /incidents/{id}`. Reloaded when the polled list shows a newer `updated_at`. | Incident detail and timeline (only events that exist). |

Errors: network/5xx on load → red banner with Retry (stale-data note after a later failed poll). Upload or review failures show inline with the API message. `409 DETECTION_ALREADY_REVIEWED` explains that another console reviewed it and links the incident. `401` names the server-side key.

### 1.2 M5 automated monitoring flow (implemented 2026-10-17; the primary demo path)

| # | Actor | System behaviour | UI result |
|---|---|---|---|
| 1 | Operator opens the dashboard | Loads 179 nodes and 11 stations once; polls incidents and detections (10 s) and scenarios (10 s, or 2 s while a run is live). | City status bar, 3D map with clusters, feed nodes, stations; overview with demo scenarios and recent activity. |
| 2 | Operator presses **Start** on a scenario (overview or **Demo scenarios** in the top bar) | `POST /api/operator/scenarios/{id}/start` → `scenario_run` scheduled at now + delay. | "Armed T−N s"; status bar "Demo scenario: … · armed"; activity "Scenario armed". |
| 3 | — (trigger time passes) | Worker claims the run; the demo-stream node's feed switches to the scenario clip; the **real detector** analyses it. | Feed on that camera plays the scenario clip (SIMULATED LIVE FEED); activity "Demo feed changed; real detector analysing frames"; camera marker spins. |
| 4a | — (temporal rule confirms) | Pending `DetectionEvent` with real confidence, evidence and `details.source = scenario`. | The web sees the run finish and reloads detections immediately. The alert strip says "Possible FIRE detected at …". The Review count rises, the camera marker turns amber with a badge, and the map flies to it. The chime plays only if the operator enabled sound. Activity: "Temporal confirmation passed …". |
| 4b | — (rule not met, e.g. Lyari glare) | Run stored as `not_detected` with the real peaks. No detection, no alert. | Activity "No persistent fire or smoke; temporal rule not met (peak 0.52). No alert raised". |
| 5 | Operator presses **Review now** | `GET /detections/{id}`. | Review panel: camera, feed, AI evidence frame, type, confidence, detection time, rule, coordinates, source/provenance, input ("Automated demo scenario …"), disclaimer, **Reject detection** / **Confirm incident**. |
| 6 | **Confirm incident**, then **Yes, confirm incident** | M3 confirmation (incident, severity, nearest available station by Haversine), then a road route from OSRM, stored on the incident. | Notice includes the candidate station and "Suggested response route: X km by road, about N min (estimate). No dispatch was sent." The map draws the route and frames station + route + incident. Route panel: road distance, estimated travel, provider, generated time, "Route is an estimate. Not a dispatch confirmation." Timeline: Detected → Confirmed → Station selected → Suggested route. |
| 6′ | **Reject detection** | M3 rejection. | "Detection rejected. No incident was created." Activity "Operator rejected the detection". |
| 7 | **Reset demo** (two-step) | `POST /api/operator/scenarios/reset`: cancel unfinished runs, reject pending scenario detections, resolve open scenario incidents (system timeline event). Nothing deleted. | Queues and counts update immediately. |

Manual clip upload (§1.1) remains on every camera as **Diagnostic: analyze a clip**.

Routing failure (§2.6 as built): the incident still completes; `route.status = unavailable`, the panel shows "Road route unavailable; straight-line distance shown", and the timeline records `route_unavailable`.

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

### 3.1 DetectionEvent.review_status (implemented M3)

```
POST /detect/fire with camera_id, result "detected"
             │
             ▼
          pending ── POST /detections/{id}/confirm ──▶ confirmed (+ incident)
             │
             └──── POST /detections/{id}/reject ──▶ rejected (no incident)
```
- `confirmed` and `rejected` are terminal. A second review returns `409 DETECTION_ALREADY_REVIEWED`, with the existing `incident_id` if there is one.
- `not_detected` results create no row.
- Duplicate handling (attaching repeat detections from one camera to an open incident) is **not built in M3**. Each confirmed detection opens its own incident (Tracker K14).

### 3.2 Incident.status (implemented M3; supersedes the v0.1 OPEN/NOTIFIED/ACKNOWLEDGED/RESOLVED draft)

```
 operator confirms detection
            │
            ▼
        confirmed ──(system: nearest available station found)──▶ station_selected ──▶ notified ──▶ acknowledged ──▶ resolved
            │                                                         │                 │              │
            └───────────────────────── resolved / rejected ───────────┴─────────────────┘              │
                                                                                                    resolved
```

| From | To | Who | Guard / effect |
|---|---|---|---|
| (none) | `confirmed` | operator (confirm detection) | Detection is `pending`. Coordinates come from the camera; severity rule (Schema.md §6). |
| `confirmed` | `station_selected` | system, same transaction | An `available` station exists. Nearest by Haversine; stores `station_distance_km`. If none, the incident stays `confirmed` and the timeline gets `no_station_available`. |
| `station_selected` | `notified` | operator (PATCH) | **Recorded by the operator: PehRadar sent no notification (M3).** |
| `notified` | `acknowledged` | operator (PATCH) | Same: operator-recorded. |
| `confirmed`, `station_selected`, `notified`, `acknowledged` | `resolved` | operator (PATCH) | Sets `resolved_at`. Terminal. |
| `confirmed`, `station_selected`, `notified` | `rejected` | operator (PATCH) | False alarm found after confirmation. Terminal. |
| `resolved`, `rejected` | anything | — | `409 INVALID_STATE_TRANSITION` |

- PATCH accepts only `notified`, `acknowledged`, `resolved` and `rejected` (anything else → `422 VALIDATION_ERROR`). `confirmed` and `station_selected` are set only by the review flow.
- `detected` is reserved: the pre-review stage is modelled by the detection's `pending` status, because incidents exist only after a human confirms.

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

## 5. Timeline events written per flow (implemented M3)

| Flow step | `event_type` (in `seq` order) | `actor` |
|---|---|---|
| Operator confirms detection | `detection_created` (occurred_at backdated to `detected_at`), `operator_confirmed`, then `station_selected` or `no_station_available` | system, operator, system |
| PATCH → `notified` / `acknowledged` | `status_changed` (message says the operator recorded it and PehRadar sent no notification) | operator |
| PATCH → `resolved` | `resolved` | operator |
| PATCH → `rejected` | `rejected` | operator |

- The timeline is returned in `seq` order on `GET /api/v1/incidents/{id}`.
- Rejected detections have no incident and therefore no timeline; their review data (`reviewed_at`, `reviewed_by`, `review_note`) lives on the `detection_event` row.
