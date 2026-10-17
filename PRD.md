# PehRadar — Product Requirements Document

**Tagline:** Detect earlier. Verify faster. Respond smarter.
**Scope of this version:** Fire/smoke incident detection and operator-assisted response, Karachi, Pakistan. Hackathon MVP.
**Status:** Draft v0.1 (M0), with the M5 scope update in §0. See `Tracker.md` for real status.

Related documents: `Techspec.md` (how), `Appflow.md` (flows and state machines), `Design.md` (UI), `Schema.md` (data), `ImplementationPlan.md` (milestones and risk register), `Tracker.md` (status), `Rules.md` (engineering rules).

---

## 0. M5 scope update: city intelligence upgrade (2026-10-17)

The user's M5 brief widened the demo from a manual upload console to a city-scale monitoring product. What changed in scope, and the data-integrity rules that come with it:

- **Monitoring network:** 179 nodes across 23 Karachi districts and corridors. **No official, Safe City (SSCA) or other government CCTV is connected.** Every node declares its provenance:
  - `simulated_coverage` (175): deterministic placeholder points on mapped major roads, where PehRadar *could* monitor once authorised CCTV is integrated. Not cameras.
  - `demo_stream` (3): simulated nodes that loop licensed sample footage (`apps/api/demo_assets/SOURCES.md`). None of it was recorded in Karachi.
  - `verified_mapped` (1): a camera location mapped in OpenStreetMap. Location only; no feed access.
  - `public_live` (0): no lawful, stable public Karachi stream was found. The feed abstraction supports HLS/MJPEG for when one is.
- **Fire-response facilities:** 11 real OpenStreetMap facilities (target was 20–30). No station was invented to reach a number. Availability stays a demo flag.
- **Automated demo scenarios:** a scenario plays a licensed clip on a demo-stream node and runs it through the **real** detector after a delay. A confirmed result becomes an ordinary pending detection with real confidence and evidence. **Nothing is auto-confirmed**; the operator still confirms or rejects. Three scenarios: Korangi fire, Clifton smoke, and Lyari sunset glare (a false-alarm lookalike that the temporal rule correctly does not confirm). Manual upload remains as a diagnostic fallback.
- **Suggested response route:** after confirmation, a road route from the candidate station (still chosen by straight-line proximity) to the incident, from OSRM on OpenStreetMap roads. It is an **estimate** (free-flow, no traffic) and never a dispatch. If routing fails, the incident keeps the straight-line distance.
- **3D map, clustering, feed viewer, city status bar and activity feed** in the command center.
- **Still out of scope:** police, ambulance, authentication, LLMs, notifications and acknowledgement automation.

## 1. Problem statement

Karachi is a dense megacity of 20M+ people with large industrial zones (SITE, Korangi, North Karachi), dense markets (Saddar, Lyari), and high-rise residential areas. Building and factory fires are recurring, and response time is affected by late reporting, unclear location information, and traffic.

Fire is typically reported by phone after bystanders notice it. Any camera-based monitoring that exists depends on a person watching screens continuously. That creates three gaps:

1. **Detection gap.** Early smoke can be visible on a camera minutes before anyone phones it in, but no one is watching that feed at that moment.
2. **Verification gap.** When an alert does exist, the operator needs the evidence (a frame, a time, a place) in one view to decide quickly whether it is real.
3. **Coordination gap.** After an incident is confirmed, someone has to pick a fire station and hand off the location, and that step is manual and not recorded.

PehRadar is a **decision-support** tool. It flags *possible* fire or smoke in video, puts the evidence in front of a human operator, and helps that operator notify a station and track the incident to resolution. **It does not make the emergency determination.** The operator does.

## 2. Target users

| User | Description | MVP role |
|---|---|---|
| **Fire-control operator** (primary) | A person at a fire department control room or municipal monitoring desk. Works under time pressure and needs evidence fast, with few clicks. | Uses the dashboard: runs analysis, reviews detections, confirms/rejects, notifies, resolves. |
| **Station recipient** (secondary) | The person at a fire station who receives the alert. | Receives a test email/webhook and acknowledges it through a link (works on mobile). In the MVP this is always a **controlled demo recipient**, never a real station. |
| **Hackathon judge / evaluator** | Watches the demo and may try the deployed app. | Needs every simulated element to be obvious and the workflow to work end to end. |

## 3. Goals

- **G1.** Show a complete, working, deployed loop: video, then detection, then human review, then incident, then station suggestion, then test notification, then acknowledgement, then resolution, with a full timeline.
- **G2.** Make operator verification fast: the evidence frame, confidence, timestamp and location are visible in one panel, with confirm/reject in one or two actions.
- **G3.** Keep the system honest: every simulated camera, sample incident, test recipient and unverified facility record is clearly labelled, and no claim of a real dispatch is ever made.
- **G4.** Handle the realistic failure cases: false positives, duplicate detections, bad uploads, notification failures, and an unavailable routing provider.
- **G5.** Keep critical logic (event aggregation, deduplication, incident state, station ranking) deterministic and unit-tested.

## 4. Non-goals (this MVP)

- Real CCTV/RTSP/ONVIF stream ingestion.
- Integration with any official emergency service system (Rescue 1122, KMC Fire Department, or others).
- Police, ambulance, theft detection, vehicle-accident detection, or any non-fire category. These are explicitly **deferred** until the fire MVP is complete and deployed.
- Cities other than Karachi.
- Automatic dispatch without human confirmation.
- User accounts, roles, or multi-tenant administration (a single shared demo access key only).
- Face recognition, person identification, or licence-plate reading. These are never in scope for this product without a separate privacy review.
- LLM-based detection or severity decisions.
- Live traffic-aware routing or guaranteed route safety.
- Native mobile apps.

## 5. MVP features

| ID | Feature | Notes |
|---|---|---|
| F1 | Karachi operations map | Simulated camera markers, fire station markers (OSM-derived, unverified), active incident markers. 2D is required; 3D buildings are an enhancement (M9) behind a toggle. |
| F2 | Camera detail panel | Metadata, SIMULATED badge, analysis history, "Run sample video" and "Upload test video". |
| F3 | Video analysis job | Pre-recorded video processed as a simulated stream. Progress is shown. Validated input. |
| F4 | Fire/smoke detection pipeline | Frame sampling, per-frame detector, temporal aggregation into detection events, evidence frame capture. |
| F5 | Review queue and evidence review | Evidence frame with boxes, class, peak confidence, video offset, wall-clock time, detector version, suggested severity. Confirm or reject with a reason. |
| F6 | Duplicate suppression | Repeat detections for the same camera within a time window attach to the existing pending detection or active incident instead of creating new review cards. |
| F7 | Incidents | Created on confirmation. State machine OPEN → NOTIFIED → ACKNOWLEDGED → RESOLVED. Listed and mapped. |
| F8 | Station suggestion | Up to 3 candidate stations ranked by road-network duration when routing is available, otherwise by straight-line distance. The method is always labelled. The operator assigns one. |
| F9 | Test notification | Email and/or webhook to a server-side allowlisted demo recipient, after explicit operator confirmation in a modal. Carries a TEST disclaimer and an acknowledgement link. |
| F10 | Acknowledgement | Recipient opens the link, sees a summary, and presses Acknowledge (POST, single use, expiring). |
| F11 | Incident timeline | Append-only record of detection, review, station, notification, acknowledgement, resolution and notes. |
| F12 | Route display | Polyline from the assigned station to the incident with a "suggested route, not verified" disclaimer. Falls back to a dashed straight line. |
| F13 | Audio alert | Optional chime on a new pending detection. Off until the operator enables it (browser autoplay rules). |

## 6. Future features (post-MVP, not to be started early)

- RTSP/HLS live stream ingestion with a stream-worker process.
- Multi-camera correlation (same fire seen by two cameras gives one incident).
- Real station contact directory with verified data and an agreement with the operating agency.
- SMS/WhatsApp channels (these need provider approval and cost review).
- Operator accounts, roles, and audit export.
- Live traffic-aware routing.
- Additional departments: ambulance (medical), police (security). Only after the fire MVP is deployed and stable.
- Model fine-tuning on Karachi-specific negatives (dust storms, smog, sodium street lighting).

## 7. Functional requirements

**Map and cameras**
- FR-01 The dashboard shows a map centred on Karachi (approx. 24.86 N, 67.01 E) with camera, station and incident layers that can be toggled.
- FR-02 Every camera record has `data_source = SIMULATED` in the MVP, and the UI shows a SIMULATED badge wherever a camera appears.
- FR-03 Every fire station shows its provenance (`OSM`, `PUBLIC_WEB`, or `MANUAL_DEMO`) and verification status (`UNVERIFIED` by default) with an "availability unknown" note.

**Video analysis**
- FR-04 The operator can start analysis for a camera using a sample video from the manifest or an uploaded file.
- FR-05 Uploads are validated by extension, MIME type/magic bytes, size (`MAX_UPLOAD_MB`, default 50), duration (`MAX_VIDEO_SECONDS`, default 120), and decodability. Rejections return a specific error code (see `Techspec.md` §5.4).
- FR-06 Only one active (QUEUED or PROCESSING) job per camera. A second request returns `CAMERA_BUSY`.
- FR-07 Job progress (frames processed / estimated total) is visible while processing.
- FR-08 Uploaded video files are deleted from disk when the job finishes (COMPLETED or FAILED).

**Detection**
- FR-09 The pipeline samples frames at `SAMPLE_FPS` (default 2) and runs the configured detector.
- FR-10 Per-frame results are aggregated into **detection events** using a deterministic temporal rule (default: 3 positive of the last 5 sampled frames). Single-frame flickers never create events.
- FR-11 Each detection event stores the classes, peak confidence, first/last video offset, wall-clock creation time, detector name and version, suggested severity, and one annotated evidence frame.
- FR-12 Suggested severity comes from a deterministic rule (`Techspec.md` §4.6). It is labelled "suggested", and the operator sets the final severity.

**Review and duplicates**
- FR-13 New non-duplicate detection events enter `PENDING_REVIEW` and appear in the review queue.
- FR-14 The operator can **confirm** (optionally adjusting severity and adding a note) or **reject** (required reason code, optional note).
- FR-15 Rejection creates no incident and no notification.
- FR-16 Duplicate rule: a new event for a camera that already has a `PENDING_REVIEW` detection or a non-RESOLVED incident within `DEDUP_WINDOW_MINUTES` (default 15) is stored as `DUPLICATE` and linked, **unless** its suggested severity is higher than the existing one. In that case it is created as `PENDING_REVIEW` and flagged as a possible escalation.
- FR-17 A previous rejection never auto-suppresses later detections. The UI shows a "camera had a rejected detection N min ago" hint instead.

**Incidents and response**
- FR-18 Confirming a detection creates an incident (`OPEN`), or attaches the detection to the camera's existing active incident.
- FR-19 On incident creation the system computes up to 3 station candidates and records each one's method (`ROAD_NETWORK` or `STRAIGHT_LINE`), distance, and duration if known.
- FR-20 The operator must assign a station before notifying.
- FR-21 Sending a notification requires explicit confirmation in an alert modal showing recipient label, channel, message preview and the TEST disclaimer.
- FR-22 The client sends only a `recipient_key`. Addresses and URLs live only in server configuration (`DEMO_RECIPIENTS`). Unknown keys are rejected.
- FR-23 Notification failures are recorded with a sanitized error. The operator can retry up to `NOTIFY_MAX_ATTEMPTS` (default 3).
- FR-24 The acknowledgement link opens a page. Only an explicit POST acknowledges, so email link scanners cannot trigger it. Tokens are single-use and expire (`ACK_TOKEN_TTL_HOURS`, default 24).
- FR-25 The operator can resolve an incident with a resolution code (`HANDLED`, `FALSE_ALARM`, `DUPLICATE`, `OTHER`) and a note.
- FR-26 Every state change writes an `IncidentTimelineEvent`. Timeline events are never edited or deleted.
- FR-27 A route between the assigned station and the incident is displayed when available, with a disclaimer.

**Labelling**
- FR-28 A persistent banner reads "DEMO — simulated cameras, test notifications. Not connected to any emergency service."
- FR-29 Notification bodies begin with `[TEST — PehRadar demo]` and state that this is not an official dispatch.

## 8. Non-functional requirements

| ID | Category | Requirement |
|---|---|---|
| NFR-01 | Performance | A 60 s, 720p clip at 2 fps sampling finishes processing in ≤ 90 s on the deployed API instance (target, measured in M1/M2). |
| NFR-02 | Latency | A new detection event appears in the review queue ≤ 5 s after it is persisted (polling interval 3 s). |
| NFR-03 | Responsiveness | Dashboard initial load ≤ 5 s on broadband locally. The map stays interactive while a job runs. |
| NFR-04 | Reliability | API restart marks interrupted jobs FAILED. No job stays PROCESSING forever. |
| NFR-05 | Determinism | Aggregation, dedup, severity, state transitions and station ranking are pure functions with unit tests. |
| NFR-06 | Security | Mutating endpoints need the operator access key. CORS is restricted to the frontend origin. Secrets come only from environment variables. Ack tokens are stored hashed. |
| NFR-07 | Privacy | No face/person identification. Uploaded videos are deleted after processing. Only evidence frames are retained, and they can be purged with a script. Recipient addresses are masked in logs. |
| NFR-08 | Abuse limits | ≤ `NOTIFY_MAX_PER_INCIDENT` (default 3) notifications per incident and ≤ `NOTIFY_MAX_PER_HOUR` (default 20) globally. |
| NFR-09 | Accessibility | WCAG 2.1 AA text contrast. Status is never conveyed by colour alone. The review flow is keyboard operable. |
| NFR-10 | Browser support | Latest Chrome/Edge/Firefox desktop for the dashboard. The ack page works on mobile Chrome/Safari. |
| NFR-11 | Portability | Reproducible local setup from README. Same code runs on SQLite (dev/test) and PostgreSQL (deployed). |
| NFR-12 | Observability | Structured JSON logs with request IDs. Job and notification failures are logged with cause. |

## 9. Operator workflow (summary)

The full flows, including error paths, are in `Appflow.md`.

1. Open the dashboard. The DEMO banner, the Karachi map, and an empty or populated review queue are visible.
2. Click a simulated camera. The camera panel opens.
3. Choose a sample video (or upload one) and start analysis. Progress is shown and the video plays in the panel.
4. A detection card appears in the review queue (optional chime).
5. Open the card. Review the evidence frame, class, confidence, video offset and time.
6. **Reject** (choose a reason) and the card leaves the queue. Or **Confirm** (adjust severity) and an incident appears on the map and in the list.
7. In the incident panel, review the suggested stations (method labelled) and assign one.
8. Click **Notify station**. The alert modal shows the TEST recipient and message. Confirm to send.
9. Watch the notification status: SENT, then ACKNOWLEDGED when the recipient clicks the link and presses Acknowledge.
10. View the route between station and incident.
11. Resolve the incident with a resolution code. The timeline shows the complete history.

## 10. Acceptance criteria

Each criterion is testable. IDs are referenced by `ImplementationPlan.md` and `Tracker.md`. "Reference positive clip" and "reference negative clip" are files listed in `samples/manifest.json` (chosen in M2).

| ID | Criterion | How to test |
|---|---|---|
| AC-01 | Dashboard loads a Karachi-centred map with ≥ 6 simulated camera markers and all seeded station markers, each showing provenance. | Manual + Playwright smoke: count markers, check badges. |
| AC-02 | Selecting a camera opens a panel with name, coordinates, SIMULATED badge, sample selector and upload control. | Playwright. |
| AC-03 | Invalid uploads (non-video, > `MAX_UPLOAD_MB`, > `MAX_VIDEO_SECONDS`, undecodable) are rejected with the specific error code and message. No job is created. | pytest integration tests per case. |
| AC-04 | Running the reference positive clip yields ≥ 1 `PENDING_REVIEW` detection with evidence frame, peak confidence, video offset, timestamp, detector name/version, and suggested severity. Progress is visible during processing. | pytest (synthetic positive video with heuristic detector) + manual on reference clip. |
| AC-05 | Running a negative clip completes with status `COMPLETED`, `frames_processed > 0`. The synthetic negative test video produces 0 events. The reference negative clip's result is recorded in the model evaluation report (never assumed). | pytest + `models/EVALUATION.md`. |
| AC-06 | Rejecting a detection with a reason sets `REJECTED`, removes it from the queue, and creates no incident or notification. | pytest + Playwright. |
| AC-07 | Confirming a detection creates an `OPEN` incident visible on the map and list within ≤ 5 s. Its timeline contains `DETECTION_CREATED`, `DETECTION_CONFIRMED`, `INCIDENT_CREATED`. | pytest + Playwright. |
| AC-08 | Re-running the positive clip on the same camera within the dedup window creates no new review card. Events are stored as `DUPLICATE` and linked. An active incident receives an `ADDITIONAL_DETECTION` timeline event. A higher-severity event is instead created `PENDING_REVIEW` with `is_escalation = true`. | pytest unit (dedup function) + integration. |
| AC-09 | A new incident shows ≤ 3 candidate stations ranked, each labelled `ROAD_NETWORK` or `STRAIGHT_LINE` with distance. The operator can assign one. | pytest (ranking) + Playwright. |
| AC-10 | Notify is disabled until a station is assigned. Sending requires modal confirmation. A successful send sets the notification `SENT` and the incident `NOTIFIED`. The message contains the TEST disclaimer and ack link. An unknown `recipient_key` returns `RECIPIENT_NOT_ALLOWED`. | pytest (console provider) + manual (real email/webhook). |
| AC-11 | A provider failure sets the notification `FAILED` with a sanitized error. The incident stays `OPEN`. Retry is available until `NOTIFY_MAX_ATTEMPTS`, then returns `NOTIFICATION_LIMIT_REACHED`. | pytest with failing fake provider. |
| AC-12 | `GET` on the ack page does not acknowledge. `POST` acknowledges: notification `ACKNOWLEDGED`, incident `ACKNOWLEDGED`, timeline event added. Reuse returns `TOKEN_USED`. Expired returns `TOKEN_EXPIRED`. | pytest + manual on phone. |
| AC-13 | Resolving sets `RESOLVED` with a resolution code. The incident leaves the active layer and the timeline gets `INCIDENT_RESOLVED`. Further transitions return `409 INVALID_STATE_TRANSITION`. | pytest + Playwright. |
| AC-14 | With routing available, a route polyline with disclaimer is shown. With routing unavailable, a dashed straight line labelled "straight-line estimate" is shown and the incident flow still works. | pytest (provider fake) + manual. |
| AC-15 | Every camera, incident and notification surface shows SIMULATED/TEST labelling. The DEMO banner is always visible. | Manual checklist + Playwright text assertions. |
| AC-16 | On the deployed URLs, AC-01, AC-04, AC-07, AC-10, AC-12 and AC-13 pass. | Manual run recorded in `Tracker.md` with date. |
| AC-17 | Jobs in `PROCESSING` at API startup are marked `FAILED` with `error_code = JOB_INTERRUPTED`. | pytest. |
| AC-18 | A double-submitted confirm creates exactly one incident (second returns 409). A double-submitted notification with the same `client_request_id` creates exactly one notification. | pytest. |

## 11. Assumptions

- A1. Hackathon judging rewards a working, honest, end-to-end demo more than raw detection accuracy.
- A2. Publicly licensed fire/smoke video clips can be found and their licences documented (`samples/SOURCES.md`). If not, the team records its own controlled clips (e.g. a candle or a small controlled flame, filmed safely) or uses synthetic clips.
- A3. OpenStreetMap has at least some `amenity=fire_station` features in Karachi. If coverage is poor, stations are entered manually from public web sources with per-record source URLs, still marked `UNVERIFIED`.
- A4. A free-tier email provider or webhook endpoint can deliver to one controlled recipient.
- A5. Free/low-cost hosting can run a CPU-only Python container with OpenCV and ONNX Runtime (verified in M1).
- A6. Operators are trusted. One shared access key is acceptable for the demo.

## 12. Constraints

- Karachi only. Fire and smoke only.
- No real CCTV, no official systems, no real dispatch.
- CPU-only inference (no GPU hosting budget assumed).
- Free or near-free hosting tiers, with their memory, sleep and request-size limits.
- Hackathon deadline. **The exact date and team size are not yet stated** (see `Tracker.md` → Decisions pending).

## 13. Risks and limitations

The full risk register with likelihood, impact, mitigation and owner milestone is in `ImplementationPlan.md` §4. The main limitations users must understand:

- **Detection is probabilistic.** A pretrained fire/smoke model will miss some fires and flag some non-fires: sunsets, orange sodium street lights, dust, smog, steam from food stalls, welding sparks. That is why every detection needs human review.
- **Station data is unverified.** OSM fire-station locations may be outdated or wrong, and PehRadar has no information about station availability.
- **Routes are suggestions.** Road-network routes come from a third-party router without live traffic, road closures, or safety information.
- **Simulated input.** Pre-recorded videos stand in for camera feeds. Wall-clock timestamps reflect processing time, not the time the footage was recorded.
- **Single-camera scope.** One fire seen by two cameras produces two incidents. The operator resolves one as `DUPLICATE`.
