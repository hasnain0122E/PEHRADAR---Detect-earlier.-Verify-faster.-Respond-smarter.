# PehRadar — Technical Specification

**Status:** Draft v0.1 (M0). Describes the intended design. No code exists yet.
Each decision is tagged **[CONFIRMED]** (decided, build on it) or **[INVESTIGATE]** (resolved by the named spike/milestone and recorded in `Tracker.md` → Decisions).

---

## 1. Architecture overview

```
┌──────────────────────────────┐        HTTPS (REST/JSON, polling)        ┌─────────────────────────────────────┐
│  apps/web  (Next.js, TS)     │ ───────────────────────────────────────▶ │  apps/api  (FastAPI, Python 3.12)   │
│  - Dashboard (map, queue,    │      direct browser → API calls          │  - REST routers  /api/v1/*          │
│    panels, modals)           │      (uploads go DIRECT, never via       │  - Domain logic (pure functions)    │
│  - /ack/[token] page         │       Next.js server — body limits)      │  - Job runner (in-process thread)   │
│  - MapLibre GL map           │                                          │  - Detection pipeline (OpenCV+ONNX) │
└──────────────┬───────────────┘                                          │  - Notification providers           │
               │ map tiles / style                                        │  - Routing client                   │
               ▼                                                          └──────┬──────────────┬───────────────┘
      Vector tile provider                                                       │              │
      [INVESTIGATE: OpenFreeMap / MapTiler]                           SQLAlchemy │              │ HTTPS (server-side only)
                                                                                 ▼              ▼
                                                                  SQLite (dev/test)     Routing provider [INVESTIGATE]
                                                                  PostgreSQL (deploy)   Email provider / Webhook [INVESTIGATE]
```

### 1.1 Component responsibilities

| Component | Owns | Does not own |
|---|---|---|
| **apps/web** | Rendering, map, user interaction, polling, audio cue, client-side form validation (convenience only), ack page. | Business rules, state transitions, recipient addresses, secrets, routing calls. |
| **API routers** (`app/routers`) | HTTP, auth check, request validation (Pydantic), mapping domain errors to HTTP codes. | Business rules (delegated to domain/services). |
| **Domain** (`app/domain`) | Pure, deterministic logic: incident state machine, detection aggregation, dedup decision, severity suggestion, station ranking. No I/O. | DB, network, files. |
| **Services** (`app/services`) | Orchestration: load records, call domain, persist, write timeline events, in one transaction. | HTTP concerns. |
| **Detection** (`app/detection`) | Video decode/sampling, detector implementations, evidence frame rendering. | Persisting incidents. |
| **Jobs** (`app/jobs`) | Single in-process worker thread with a FIFO queue. Runs analysis jobs, reports progress, recovers on startup. | Distributed scaling (out of scope). |
| **Notifications** (`app/notifications`) | Provider adapters (console, email, webhook), message rendering, ack-token issue/verify. | Deciding *whether* to notify (operator does). |
| **Routing** (`app/routing`) | Haversine distance, road-network client with timeout, fallback. | Route safety claims. |

### 1.2 Frontend/backend boundary [CONFIRMED]

- **All business state lives in the API.** The frontend never computes incident status, severity, dedup, or station rank. It displays what the API returns.
- The browser calls the API directly at `NEXT_PUBLIC_API_BASE_URL`. **Video uploads must not pass through Next.js route handlers or serverless functions** (Vercel's serverless request bodies are limited to about 4.5 MB).
- The contract is the API's OpenAPI document. TypeScript types are generated from it with `openapi-typescript` into `apps/web/src/types/api.gen.ts`. Hand-written duplicates of API types are not allowed.
- The frontend has no database and no secrets. `NEXT_PUBLIC_*` variables are public by definition.

## 2. Technology choices and alternatives

| Area | Choice | Status | Alternatives considered | Reason |
|---|---|---|---|---|
| Repo | Monorepo `apps/web` + `apps/api` | CONFIRMED | Two repos; Turborepo/Nx | One place for docs and contracts. Two independent toolchains (npm, uv) need no monorepo orchestrator. |
| Frontend | Next.js (App Router) + React + TypeScript + Tailwind CSS | CONFIRMED | Vite + React SPA | Required by brief. Easy Vercel deploy. The dashboard is fully client-rendered (`"use client"`) because the map is client-only anyway. |
| Data fetching | TanStack Query (polling via `refetchInterval`) | CONFIRMED | SWR; hand-rolled `setInterval` | Built-in polling, dedupe, retry, and cache invalidation after mutations. |
| Backend | Python 3.12 + FastAPI + Pydantic v2 + Uvicorn | CONFIRMED | Flask; Django | Typed contracts, automatic OpenAPI, async-friendly. **Python 3.12 rather than the locally installed 3.14** because OpenCV/ONNX Runtime wheel availability on 3.14 is not verified. `uv` manages the interpreter. |
| ORM/migrations | SQLAlchemy 2.0 + Alembic | CONFIRMED | SQLModel; raw SQL | Mature, works on SQLite and Postgres, explicit migrations. |
| DB | SQLite (local dev + tests), PostgreSQL (deployed) | CONFIRMED (dev); deployed provider INVESTIGATE (M1) | Postgres everywhere via Docker; SQLite in prod on a volume | SQLite needs zero setup on Windows. Postgres avoids relying on a persistent disk at the host. Neon free tier is the default candidate. Schema avoids engine-specific features (§11). |
| Evidence storage | JPEG bytes in DB table `evidence_frame` | CONFIRMED | Local disk; S3/R2 object storage | Evidence frames are small (≤ 250 KB, one per event). Keeping them in the DB removes the need for a persistent volume or object store on free hosts. Revisit if volume grows. |
| Live updates | Polling (3 s dashboard, 1 s active job) | CONFIRMED | SSE; WebSockets | Polling is the simplest thing that meets NFR-02 and works behind any proxy or sleeping host. SSE is deferred until polling is shown to be insufficient. |
| Job execution | In-process single worker thread + DB-persisted job rows | CONFIRMED | Celery/RQ + Redis; FastAPI BackgroundTasks | No extra infrastructure. A single worker bounds CPU/RAM on small instances. DB rows make progress visible and allow restart recovery. |
| CV runtime | OpenCV (decode, sampling, drawing) + ONNX Runtime (CPU inference) | CONFIRMED | PyTorch + Ultralytics at runtime | ONNX Runtime is far smaller than PyTorch (smaller image, lower RAM, faster cold start). Training/export tooling stays off the runtime image. |
| Detector model | Pretrained fire/smoke YOLOv8n ONNX (`fiacecson20/cctv-ai-fire-smoke`, 320 px), treated as AGPL-3.0. Heuristic baseline deferred. | CONFIRMED on Render (M2, Tracker D26) | See §4.3 | See §4.3. |
| Map | MapLibre GL JS (via `react-map-gl/maplibre` or direct) with vector tiles; 3D via `fill-extrusion` | Library CONFIRMED; tile source INVESTIGATE (M2) | CesiumJS + Cesium ion; Google Photorealistic 3D Tiles; Leaflet | See §7. |
| Routing | Road-network router with straight-line fallback | Fallback CONFIRMED; provider INVESTIGATE (M2) | OSRM public demo; OpenRouteService; GraphHopper; self-hosted OSRM | See §7.3. |
| Notifications | Provider adapters: `console` (dev/test), `email`, `webhook` | Adapters CONFIRMED; email provider INVESTIGATE (M2) | Resend; SMTP (e.g. Gmail app password); SendGrid; Slack/Discord webhook | See §6. |
| Hosting | Frontend: Vercel (default candidate). API: container host | INVESTIGATE (M1 deployment spike) | Render, Railway, Fly.io, Hugging Face Spaces, Google Cloud Run | See §10. |
| Testing | pytest (+ httpx TestClient), Vitest, Playwright (1 E2E smoke) | CONFIRMED | — | Matches the stack. Minimal set. |
| Lint/format | Ruff (Python), ESLint + `tsc --noEmit` (web) | CONFIRMED | Black + flake8; Prettier only | Fast, few tools. |

**Explicitly not used:** LangChain, vector databases, agent frameworks, LLMs anywhere in detection/severity/state logic, Redis, Kubernetes. These need a demonstrated requirement before they can be added (`Rules.md`).

Exact package versions are **pinned at scaffold time (M1)** and recorded in `package.json` / `uv.lock`. This document deliberately does not guess version numbers.

**Pinned in M1a (2026-10-17).** Only versions published at least 2 weeks earlier were accepted (`npm install --before=2026-10-03`).
- **API:** Python 3.12.15 (uv-managed), FastAPI 0.143.3, Uvicorn 0.54.0, pydantic-settings 2.16.0. Dev: pytest 9.1.1, httpx2 2.13.1 (Starlette's TestClient deprecates `httpx` in favour of `httpx2`), Ruff 0.17.1.
- **Web:** Next.js 16.3.8 (Turbopack), React 19.2.8, Tailwind CSS 4.3.3 (CSS-first `@theme` tokens in `globals.css`, no `tailwind.config`), TypeScript 5.9.3, ESLint 9.39.5. Tests: Vitest 5.0.3 + Testing Library + jsdom. `@types/node` 24 matches the local Node 24 runtime (Vitest 5 rejects `@types/node` 20).
- **CV runtime (M1c, 2026-10-17, same 2-week rule):** `opencv-python-headless` 4.14.0.94 and `onnxruntime` 1.30.0, plus their dependencies numpy 2.5.3, protobuf 7.36.2 and flatbuffers 25.12.19.
  - OpenCV 4.14 rather than 5.0.0.93, because 4.x is the mature API.
  - The headless build needs no libGL or GUI libraries.
  - numpy is pinned at 2.5.3 because 2.5.4 (released 2026-10-10) is under 2 weeks old.
- **Not yet added:** TanStack Query, MapLibre, `openapi-typescript`. Each is added in the milestone that first needs it.
- `NEXT_PUBLIC_API_BASE_URL` is inlined at **build** time, so the web host must set it before `next build`.

## 3. API strategy

- REST, JSON, prefix `/api/v1`. OpenAPI at `/api/v1/openapi.json`. Docs UI enabled only when `APP_ENV != production`.
- **Auth:** mutating endpoints and operator reads require header `X-Operator-Key: <OPERATOR_ACCESS_KEY>`. The operator enters the key once in the UI and it is kept in `sessionStorage`, not baked into the JS bundle. The ack endpoints and `/health` are public and token-scoped.
- **Error envelope** (all non-2xx):
  ```json
  { "error": { "code": "INVALID_STATE_TRANSITION", "message": "Incident is RESOLVED; cannot notify.", "details": {} } }
  ```
- **Idempotency:** `POST` confirm/reject are guarded by state (second call returns 409). Notification send requires a client-generated UUID `client_request_id`, which is unique in the DB, so a repeat returns the original notification with `200`.
- **Time:** all timestamps are ISO-8601 UTC (`Z`) in the API. The UI renders `Asia/Karachi` (PKT, UTC+5).
- **IDs:** UUIDv4 strings (`Schema.md` §1).
- **Pagination:** `?limit=&cursor=` on list endpoints. Default limit 50, max 200. The MVP volume is small, but the contract is fixed now.

### 3.1 Endpoints

| Method | Path | Auth | Purpose | Notes / errors |
|---|---|---|---|---|
| GET | `/api/v1/health` | none | Liveness: `{ "status": "ok", "app": "pehradar-api", "version": "x.y.z" }`. `detector` and `db` fields will be added once those components exist (M3/M4). | Implemented in M1a. Used by deploy spike and warm-up. (Moved from `/health` to `/api/v1/health` in M1a so all routes share one prefix.) |
| GET | `/api/v1/dashboard` | operator | Snapshot: `server_time`, pending detections, active incidents, active jobs | Polled every 3 s. One call instead of many. |
| GET | `/api/v1/cameras` | operator | List cameras | |
| GET | `/api/v1/cameras/{camera_id}` | operator | Camera detail + recent jobs | `NOT_FOUND` |
| GET | `/api/v1/stations` | operator | List fire stations with provenance | |
| GET | `/api/v1/samples` | operator | Sample video manifest (id, title, duration, licence, expected label) | |
| GET | `/api/v1/samples/{sample_id}/video` | operator* | Stream sample file for in-panel playback | *Key passed as query param `k` because `<video src>` cannot send headers. Sample clips are public-licence content only. |
| POST | `/api/v1/cameras/{camera_id}/analysis-jobs` | operator | Start job. `multipart/form-data` with `file`, **or** JSON `{ "sample_id": "..." }` | `202` + job. `CAMERA_BUSY`, `UPLOAD_TOO_LARGE`, `UNSUPPORTED_MEDIA`, `VIDEO_TOO_LONG`, `VIDEO_UNREADABLE`, `SAMPLE_NOT_FOUND` |
| GET | `/api/v1/analysis-jobs/{job_id}` | operator | Job status, progress, created detection ids | Polled every 1 s while active. |
| GET | `/api/v1/detections` | operator | Filter `status`, `camera_id` | |
| GET | `/api/v1/detections/{detection_id}` | operator | Detail incl. duplicates count, prior-rejection hint | |
| GET | `/api/v1/detections/{detection_id}/evidence.jpg` | operator* | Annotated evidence JPEG | `*` same `k` param approach for `<img>`; `Cache-Control: private`. |
| POST | `/api/v1/detections/{detection_id}/confirm` | operator | Body `{ operator_label, severity?, note? }` → `{ incident, created: bool }` | `INVALID_STATE_TRANSITION` (409) |
| POST | `/api/v1/detections/{detection_id}/reject` | operator | Body `{ operator_label, reason_code, note? }` | `INVALID_STATE_TRANSITION`, `VALIDATION_ERROR` |
| GET | `/api/v1/incidents` | operator | `?status=active` (OPEN, NOTIFIED, ACKNOWLEDGED) or explicit list | |
| GET | `/api/v1/incidents/{incident_id}` | operator | Incident + detections + route estimates + notifications + timeline | |
| POST | `/api/v1/incidents/{incident_id}/route-estimates/refresh` | operator | Recompute candidates (e.g. after routing outage) | `ROUTING_UNAVAILABLE` is non-fatal: returns straight-line results. |
| POST | `/api/v1/incidents/{incident_id}/assign-station` | operator | Body `{ station_id, operator_label }` | `INVALID_STATE_TRANSITION` if RESOLVED |
| POST | `/api/v1/incidents/{incident_id}/notifications` | operator | Body `{ client_request_id, recipient_key, channel, operator_label }` | `STATION_REQUIRED`, `RECIPIENT_NOT_ALLOWED`, `NOTIFICATION_LIMIT_REACHED`, `INVALID_STATE_TRANSITION` |
| POST | `/api/v1/notifications/{notification_id}/retry` | operator | Retry a FAILED notification | `NOTIFICATION_LIMIT_REACHED`, `INVALID_STATE_TRANSITION` |
| POST | `/api/v1/incidents/{incident_id}/resolve` | operator | Body `{ resolution_code, note?, operator_label }` | `INVALID_STATE_TRANSITION` |
| POST | `/api/v1/incidents/{incident_id}/notes` | operator | Body `{ text, operator_label }` → timeline `NOTE_ADDED` | max 1000 chars |
| GET | `/api/v1/ack/{token}` | token | Read-only summary for recipient (no evidence image, minimal data) | `TOKEN_INVALID`, `TOKEN_EXPIRED`, `TOKEN_USED` (still shows summary state) |
| POST | `/api/v1/ack/{token}` | token | Acknowledge. Body `{ recipient_name? }` (optional, max 80 chars) | Same codes. |

HTTP mapping: `VALIDATION_ERROR` 422, `UNAUTHORIZED` 401, `NOT_FOUND`/`SAMPLE_NOT_FOUND` 404, `INVALID_STATE_TRANSITION`/`CAMERA_BUSY` 409, `UPLOAD_TOO_LARGE` 413, `UNSUPPORTED_MEDIA` 415, `VIDEO_TOO_LONG`/`VIDEO_UNREADABLE`/`STATION_REQUIRED`/`RECIPIENT_NOT_ALLOWED` 422, `NOTIFICATION_LIMIT_REACHED` 429, `TOKEN_INVALID` 404, `TOKEN_EXPIRED`/`TOKEN_USED` 410, `ROUTING_UNAVAILABLE` (only reported inside the response body, never as a failed request).

## 4. Computer-vision pipeline

### 4.1 Flow

```
video file ──▶ validate (ext, magic bytes, size, cv2 open, duration) ──▶ sample @ SAMPLE_FPS
         ──▶ resize long side to 640 ──▶ detector.predict(frame) → [ {cls, conf, bbox_norm} ]
         ──▶ FrameResult(offset_s, detections) ──▶ TemporalAggregator (pure) ──▶ EventCandidate
         ──▶ severity.suggest (pure) ──▶ dedup.decide (pure, needs DB snapshot) ──▶ persist DetectionEvent + EvidenceFrame
```

### 4.2 Detector interface [CONFIRMED]

```python
class Detector(Protocol):
    name: str          # e.g. "heuristic-hsv-motion" | "onnx-yolo-fire-smoke"
    version: str       # semantic version or weights SHA-256 prefix
    def predict(self, frame_bgr: np.ndarray) -> list[FrameDetection]: ...
```

Exactly two implementations are planned. No plugin system.

1. **`HeuristicDetector` (baseline)** [CONFIRMED]. HSV colour mask for flame-like hues (high V, orange-red H range) and low-saturation grey regions for smoke, combined with frame-difference motion and a minimum blob area. Deterministic, dependency-light, and testable against synthetic videos generated inside pytest. **Documented as a baseline with a known high false-positive rate.** It always works, so the vertical slice is never blocked by model selection.
2. **`OnnxYoloDetector`** [INVESTIGATE M2]. A YOLO-family fire/smoke model exported to ONNX, run with `onnxruntime` CPU EP, with letterbox preprocessing and NMS in numpy.

Selected by `DETECTOR=heuristic|onnx`. If `onnx` is configured but the weights file is missing or the hash mismatches, startup fails loudly. It never silently falls back.

### 4.3 Model-selection criteria and candidates (M2 spike)

Criteria, in priority order:
1. **Licence clarity** for both the weights and the training data, recorded in `models/README.md`.
2. **Provenance.** Known training dataset, and the weights file is downloadable with a recorded SHA-256.
3. **Classes:** fire and smoke separately.
4. **ONNX export** possible and verified.
5. **CPU latency:** ≤ 250 ms/frame at 640 px on the deployed instance, so that a 60 s clip finishes within NFR-01.
6. **Measured accuracy on our own evaluation set** (event-level, below), not claimed accuracy from a model card.

Candidates:
- **C1:** heuristic baseline (always kept, used as a comparison floor).
- **C2:** a YOLOv8n/YOLO11n-class model trained on the public **D-Fire dataset** (fire + smoke classes). Either published community weights whose source and licence can be verified, or weights we train ourselves on D-Fire in a time-boxed Colab run (≤ 2 h), which gives full provenance. **Licence note:** Ultralytics code and models are AGPL-3.0. This is acceptable for an open-source hackathon repo but must be recorded. An Apache-2.0 alternative (e.g. a YOLOX-based model) is the fallback if AGPL is unacceptable.
- **C3:** any other verifiable pretrained fire/smoke model found during the spike, judged by the same criteria.

**M2 outcome (2026-10-17).** Chosen: **C3 = `fiacecson20/cctv-ai-fire-smoke`**.

| Property | Value |
|---|---|
| Architecture | YOLOv8n, fine-tuned on a dataset described as CC-BY 4.0 |
| Classes | `fire`, `smoke` |
| Input | 320×320 letterboxed RGB |
| Output | `[1, 6, 2100]` (cx, cy, w, h + 2 sigmoid scores), no NMS inside |
| Size | 12.1 MB ONNX, pinned HF revision + SHA-256 |
| Speed | 23 ms/frame on 1 CPU thread locally |

Provenance, licence (treated as AGPL-3.0) and the publisher's metrics are in `apps/api/models/README.md`.

Against the criteria above:
1. **Licence:** clear, but AGPL rather than permissive.
2. **Provenance:** **partial**. The dataset is named only by licence, and the upstream repo was unreachable.
3. **Classes:** met.
4. **ONNX:** met.
5. **Latency:** met. 320 px instead of 640 px, at 155 ms/frame projected on Render.
6. **Own evaluation:** only an 8-clip **smoke test** (Tracker M2): 3/4 positives and 0/4 false alarms. It is below the ≥ 8 + 8 set and is not an accuracy figure.

Rejected:
- **Pyronear yolo11s:** Apache-2.0, but wildfire smoke only, at 1024 px.
- **fireviewer yolo11m:** AGPL-3.0, about 30× the compute.
- **Intel fire-and-smoke:** a 2B-parameter VLM, which is an LLM-class model.
- **Unlicensed or proprietary-format repos.**

The heuristic baseline (C1) and `models/EVALUATION.md` are deferred, because the user's M2 brief asked for one model only.

**Implemented pipeline (M2):**
- **Code:** `app/detection/fire_model.py` (pre/post-processing, class-wise NMS at IoU 0.45, contract checks), `app/domain/fire_decision.py`, `app/detection/fire_pipeline.py`, `app/detection/evidence.py`, endpoint `POST /api/v1/detect/fire`.
- **Temporal rule:** per class, score ≥ `DETECT_CONF_THRESHOLD` (0.45) in ≥ `DETECT_MIN_POSITIVE_FRAMES` (3) of any `DETECT_WINDOW_FRAMES` (5) consecutive sampled frames. An optional single-frame rule (`DETECT_SINGLE_FRAME_CONFIDENCE`) is off.
- **Not yet implemented:** `MIN_BOX_AREA`, event open/close/cooldown and dedup (§4.4–4.5). These arrive with incidents in M4.
- **Model loading:** at startup. A missing model gives 503 on the endpoint instead of failing startup (Tracker D28; supersedes §4.2's "startup fails loudly").
- **Known limitations:** Tracker K10–K12.

**Evaluation set** (`models/EVALUATION.md`): ≥ 8 positive clips (fire and/or smoke) and ≥ 8 negative clips that include Karachi-relevant confusers: sunset/orange sky, sodium street lights, vehicle headlights at night, dust/haze, steam from food stalls, welding sparks. Report event-level recall on positives and false events per negative clip, for each candidate, with the date and commit. **Targets (goals, not claims):** recall ≥ 0.8, ≤ 0.5 false events per negative clip.

### 4.4 Temporal aggregation (pure, `app/domain/aggregation.py`) [CONFIRMED, thresholds tunable]

- A sampled frame is **positive** if any detection has `conf ≥ CONF_THRESHOLD` (default 0.45) and normalized box area ≥ `MIN_BOX_AREA` (default 0.002).
- An **event opens** when ≥ `AGG_MIN_POSITIVE` (3) of the last `AGG_WINDOW` (5) sampled frames are positive.
- While open, track `first_offset_s`, `last_offset_s`, `peak_confidence`, `classes_seen`, `positive_frame_count`, and the **peak frame** (the highest-confidence frame, kept as the evidence frame).
- An **event closes** after `AGG_CLOSE_NEGATIVE` (6) consecutive negative frames, or at the end of the video.
- **Within-job suppression:** an event that would open within `AGG_COOLDOWN_S` (30 video-seconds) of the previous event's close is merged into the previous event instead.
- At most `MAX_EVENTS_PER_JOB` (10) events per job. Further candidates are counted on the job (`suppressed_event_count`) but not persisted.

### 4.5 Deduplication across jobs (pure decision, `app/domain/dedup.py`) [CONFIRMED]

Input: the event candidate, plus a snapshot for the camera containing the latest `PENDING_REVIEW` detection (if any) and the active incident (if any), each with timestamps and severity.

| Situation (same camera, within `DEDUP_WINDOW_MINUTES` = 15) | Decision |
|---|---|
| Active (non-RESOLVED) incident exists, candidate severity ≤ incident severity | `DUPLICATE`, `incident_id` set, timeline `ADDITIONAL_DETECTION` |
| Active incident exists, candidate severity > incident severity | `PENDING_REVIEW`, `is_escalation = true`, `incident_id` hint set. Confirming attaches it to that incident and records `SEVERITY_CHANGED` if the operator raises severity. |
| Pending detection exists, candidate severity ≤ pending severity | `DUPLICATE`, `duplicate_of_detection_id` set |
| Pending detection exists, candidate severity > pending severity | `PENDING_REVIEW`, `is_escalation = true` |
| Nothing active, or previous record outside window | `PENDING_REVIEW` |
| Camera had a REJECTED detection recently | `PENDING_REVIEW` (never suppressed). The API computes `prior_rejection_minutes_ago` for the UI hint. |

When a pending detection is confirmed, its `DUPLICATE` children receive the same `incident_id`.

### 4.6 Suggested severity (pure, `app/domain/severity.py`) [CONFIRMED rule shape, thresholds tunable]

- `HIGH`: FIRE with `peak_confidence ≥ 0.6` and max box area ≥ 0.05, **or** FIRE and SMOKE both seen with event duration ≥ 5 s.
- `MEDIUM`: any other FIRE event, or SMOKE with max box area ≥ 0.10.
- `LOW`: all other SMOKE events.

The result is always presented as **suggested**. `Incident.severity` is set by the operator at confirmation (defaulting to the suggestion).

### 4.7 Evidence frame

The peak frame is annotated with boxes, class and confidence labels, the camera name, the video offset, and the watermark `SIMULATED — PehRadar demo`. It is encoded as JPEG quality 80 with the long side ≤ 960 px, which targets ≤ 250 KB. It is stored in `evidence_frame` with its SHA-256. Bounding boxes are also stored as JSON so the UI can draw a toggleable overlay.

## 5. Video upload and processing

### 5.1 Sources
- **Samples:** `samples/manifest.json` lists `{ id, title, file, duration_s, licence, source_url, expected: "positive"|"negative" }`. Video files are **not committed** unless their licence allows redistribution and size is ≤ 10 MB. Otherwise `scripts/fetch_samples` downloads them. `samples/SOURCES.md` records the licences.
- **Uploads:** written to `UPLOAD_DIR` with a server-generated name (never the client filename), deleted when the job ends.

### 5.2 Limits [CONFIRMED defaults, final values after M1 spike]
**M1d finding (confirmed on Render 2026-10-17; see §10 Stage 3):** use `MAX_UPLOAD_MB=20` rather than 50. A 60 s 720p H.264 clip at about 1.5 Mbit/s is 11 MB, and a 480p 15 fps clip is 6 MB. Demo clips should be ≤ 60 s, pre-transcoded to H.264 at ≤ 854×480 and 15 fps, because decode cost on a 0.1-CPU host scales with resolution × frame rate (see §10 Stage 3). Frames are sampled at 2 fps with a single decoder thread.

Originally planned: `MAX_UPLOAD_MB=50`, `MAX_VIDEO_SECONDS=120`, accepted containers MP4/MOV/WebM (validated by magic bytes and `cv2.VideoCapture` open + first-frame read). The upload body is streamed to disk in chunks and aborted once it exceeds the limit.

### 5.3 Job runner
- One worker thread. FIFO queue backed by `analysis_job` rows (`QUEUED`). Poll interval 0.5 s.
- Progress is written every 10 sampled frames (`frames_processed`, `frames_total_estimate`).
- **Startup recovery:** rows in `PROCESSING` are set to `FAILED` with `JOB_INTERRUPTED`. Rows in `QUEUED` are re-queued, and failed if their upload file is missing.
- **Host caveat:** hosts that throttle CPU after the HTTP response (e.g. Cloud Run default) break this model. The M1 spike must verify that background processing continues.

### 5.4 Error codes for jobs
`UPLOAD_TOO_LARGE`, `UNSUPPORTED_MEDIA`, `VIDEO_TOO_LONG`, `VIDEO_UNREADABLE` (synchronous, so no job row is created). `DECODE_FAILED`, `DETECTOR_ERROR`, `JOB_INTERRUPTED`, `UPLOAD_MISSING` (asynchronous, set on job row; enum `JobErrorCode` in `Schema.md`).

### 5.5 Playback in the UI
Uploaded file: the browser plays it from a local object URL (no round trip). Sample: `<video src="/api/v1/samples/{id}/video?k=...">`. The playback is illustrative. Detections are tied to `first_offset_s`, and the UI offers "jump to offset". The MVP does not claim real-time sync between playback and inference.

## 6. Notification flow

```
Operator assigns station ─▶ clicks Notify ─▶ Alert modal (recipient label, channel, preview, TEST banner)
  ─▶ POST /incidents/{id}/notifications {client_request_id, recipient_key, channel}
  ─▶ API: validate state (OPEN|NOTIFIED), station assigned, recipient_key ∈ DEMO_RECIPIENTS, limits
  ─▶ create Notification(QUEUED) + ack token (store SHA-256 only) + timeline NOTIFICATION_QUEUED
  ─▶ provider.send(message) with NOTIFY_TIMEOUT_S (10 s), synchronously in request
       ├─ ok   ─▶ SENT, sent_at, provider_message_id; incident OPEN→NOTIFIED; timeline NOTIFICATION_SENT
       └─ fail ─▶ FAILED, attempt_count, last_error (sanitized); timeline NOTIFICATION_FAILED; incident unchanged
Recipient opens ${PUBLIC_WEB_BASE_URL}/ack/{token} ─▶ GET summary ─▶ presses Acknowledge ─▶ POST
  ─▶ notification ACKNOWLEDGED; incident NOTIFIED→ACKNOWLEDGED (if not already ACK/RESOLVED); timeline NOTIFICATION_ACKNOWLEDGED
```

- **Recipients are server-side only:** `DEMO_RECIPIENTS` is a JSON array of `{ "key": "demo-email", "channel": "EMAIL", "address": "...", "label": "Test recipient (demo)" }`. The API returns `key`, `channel` and `label` only, never the address. Every station maps to the same demo recipient, shown in the UI as "Demo recipient standing in for <station name>".
- **Message content (minimal):** TEST prefix, operator-confirmed possible fire/smoke, simulated camera name, approximate coordinates and map link, severity, suggested station (with "OSM data, unverified, availability unknown"), ack link, and "This is NOT an official dispatch." **No evidence image** is attached or linked.
- **Providers:** `console` (logs the message, always succeeds; default in dev/tests), `email` (implementation chosen in M2: Resend HTTP API or SMTP), `webhook` (POST JSON with header `X-PehRadar-Signature: sha256=<HMAC(WEBHOOK_SECRET, body)>`). There is also a test-only `failing` fake provider.
- **Ack tokens:** 32 random bytes, URL-safe base64. Only `sha256(token)` is stored. Expiry `ACK_TOKEN_TTL_HOURS` (24). Single use. `GET` never mutates.

## 7. Mapping and routing

### 7.1 Requirements
Karachi-centred basemap, three marker layers, incident highlight, route line, a dark style that fits the ops theme, and **optional** 3D building extrusion. 2D must work on every target browser. 3D is an enhancement.

### 7.2 Evaluation [INVESTIGATE M2, recommendation stated]

| Option | 3D | Karachi data | Effort | Licence / cost | Verdict |
|---|---|---|---|---|---|
| **MapLibre GL JS + OpenFreeMap vector tiles** | `fill-extrusion` from building footprints; heights only where OSM has `height`/`building:levels` | OSM footprints in Karachi are **partial and mostly lack height tags** (to verify in spike) | Low | MapLibre BSD-3; tiles free, no key; OSM ODbL attribution required | **Recommended primary** |
| MapLibre + MapTiler | Same, plus terrain DEM | Same OSM base | Low | Free tier with key, usage limits | Fallback if OpenFreeMap style/availability is inadequate |
| CesiumJS + Cesium ion (OSM Buildings, World Terrain) | True 3D globe, 3D Tiles | Global OSM Buildings (same coverage gaps) | High: large bundle, static asset copying in Next.js, token | ion free tier has usage limits/terms | Rejected for MVP: high effort, little benefit. Karachi is flat and coastal, so terrain adds little. |
| Google Photorealistic 3D Tiles | Photoreal mesh | **Karachi coverage unverified** | Medium–high | Billing account, ToS restrictions | Rejected: cost, licence risk, unknown coverage. |
| Leaflet | None | — | Lowest | BSD | Rejected: no 3D path. |

**Honesty rule for 3D:** extruded buildings use OSM heights where they exist, and a uniform low default (e.g. 3 levels) elsewhere, labelled "Approximate building footprints © OpenStreetMap — heights estimated". The 3D toggle is off by default.

### 7.3 Routing and station ranking

- **Ranking (pure, `app/domain/station_ranking.py`):** take stations where `is_active_in_demo = true`, compute the haversine distance to the incident, take the top `ROUTE_CANDIDATES` (3) by distance, then (if routing is available) fetch road-network duration for each and re-rank by duration. Ties are broken by distance, then by `station_id`.
- **Fallback:** if the provider errors or times out (`ROUTING_TIMEOUT_S` = 5) or is `none`, rank by straight-line distance. `method = STRAIGHT_LINE`, `duration_s = null`, and the geometry is the 2-point line. The UI labels this "straight-line estimate".
- **Provider candidates [INVESTIGATE M2]:** OSRM public demo server (no key, fair-use policy, no SLA, fine for very low demo volume), OpenRouteService (free key, daily quota), GraphHopper (free key, quota). Self-hosted OSRM is rejected for the MVP (needs a large build and RAM). Calls are made **server-side only** and cached in `route_estimate` rows. They are never made per poll.
- **Disclaimer on every route:** "Suggested route from third-party map data. Not verified for traffic, closures, or safety."

### 7.4 Fire station data
A one-time Overpass export of `amenity=fire_station` within the Karachi bounding box is saved to `data/sources/stations_osm_<date>.geojson` with the query used. It is transformed into `apps/api/seed/stations.json` with `data_source=OSM`, `source_ref=osm:node/<id>`, `licence=ODbL-1.0`, `verification_status=UNVERIFIED`. **No runtime Overpass calls.** If coverage is poor, records are added by hand with `data_source=PUBLIC_WEB` and a `source_ref` URL each.

## 8. Environment variables

Strategy [CONFIRMED]: each app has its own `.env.example` committed with **placeholder values only**. Real `.env` files are git-ignored. Config is parsed once at startup with Pydantic Settings, and startup fails fast on invalid values. Secrets are never logged.

**apps/api/.env.example**
| Variable | Example / default | Secret |
|---|---|---|
| `APP_ENV` | `development` \| `test` \| `production` | |
| `DATABASE_URL` | `sqlite:///./var/pehradar.db` | yes (deployed) |
| `CORS_ORIGINS` | `http://localhost:3000`. Unset means localhost:3000 outside production and **no origins** in production. `*` is rejected. Production requires https. | |
| `OPERATOR_ACCESS_KEY` | `change-me` | yes |
| `PUBLIC_WEB_BASE_URL` | `http://localhost:3000` | |
| `DETECTOR` | `heuristic` \| `onnx` | |
| `MODEL_PATH` / `MODEL_SHA256` | `../../models/fire_smoke.onnx` / `<hex>` | |
| `CONF_THRESHOLD`, `MIN_BOX_AREA`, `SAMPLE_FPS` | `0.45`, `0.002`, `2` | |
| `AGG_WINDOW`, `AGG_MIN_POSITIVE`, `AGG_CLOSE_NEGATIVE`, `AGG_COOLDOWN_S`, `MAX_EVENTS_PER_JOB` | `5`, `3`, `6`, `30`, `10` | |
| `DEDUP_WINDOW_MINUTES` | `15` | |
| `UPLOAD_DIR`, `MAX_UPLOAD_MB`, `MAX_VIDEO_SECONDS` | `./var/uploads`, `50`, `120` | |
| `SAMPLES_DIR` | `../../samples` | |
| `ROUTING_PROVIDER`, `ROUTING_BASE_URL`, `ROUTING_API_KEY`, `ROUTING_TIMEOUT_S`, `ROUTE_CANDIDATES` | `none`, ``, ``, `5`, `3` | key: yes |
| `NOTIFY_EMAIL_PROVIDER` | `console` \| `resend` \| `smtp` | |
| `RESEND_API_KEY`, `EMAIL_FROM`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` | placeholders | yes |
| `WEBHOOK_SECRET` | placeholder | yes |
| `DEMO_RECIPIENTS` | `[{"key":"demo-console","channel":"CONSOLE","address":"console","label":"Console (dev)"}]` | addresses: treat as sensitive |
| `NOTIFY_TIMEOUT_S`, `NOTIFY_MAX_ATTEMPTS`, `NOTIFY_MAX_PER_INCIDENT`, `NOTIFY_MAX_PER_HOUR`, `ACK_TOKEN_TTL_HOURS` | `10`, `3`, `3`, `20`, `24` | |
| `LOG_LEVEL` | `INFO` | |

**apps/web/.env.example**
| Variable | Example |
|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | `http://localhost:8000` |
| `NEXT_PUBLIC_MAP_STYLE_URL` | style URL chosen in M2 |
| `NEXT_PUBLIC_DEMO_MODE` | `true` (always true in MVP; drives banner) |

## 9. Security, privacy, logging

- **Authn/z:** shared operator key (constant-time compare). Rate limiting on notifications (NFR-08). CORS allowlist. Upload size enforced while streaming.
- **Input validation:** Pydantic models with length limits (notes ≤ 1000, labels ≤ 80, enums strictly validated). Path IDs validated as UUIDs.
- **Files:** server-generated upload names, no client paths, upload dir outside any static-serving path, files deleted after the job.
- **Secrets:** environment variables only. `.env*` ignored except `.env.example`. A pre-commit check (or a manual check per `Rules.md`) looks for secrets in diffs.
- **Privacy:** no face/person/plate analysis. Evidence frames are retained only for the demo, with `scripts/purge_evidence` provided. Recipient addresses are masked in logs (`d***@example.com`). The operator identity is a free-text label (e.g. "Operator A"), not an account, so no personal data is required. The ack `recipient_name` is optional and capped at 80 characters.
- **Footage:** only licensed sample clips or footage the team recorded. Uploaded footage is never committed (`.gitignore` covers `var/`, `samples/*.mp4` etc.).
- **Logging:** JSON lines with `ts`, `level`, `request_id`, `route`, `status`, `duration_ms`, and entity IDs. Ack tokens, keys and full addresses are never logged.

## 10. Deployment [INVESTIGATE — M1 spike]

Default candidates: **web → Vercel**, **API → Render or Railway**, **DB → Neon PostgreSQL**. Backup API hosts: Fly.io, Hugging Face Spaces (Docker).

**Stage 1: lightweight deploy (M1b, deployed and verified 2026-10-17; evidence in Tracker).**
- API on Render's **native Python runtime with uv** (detected from `apps/api/uv.lock`), Root Directory `apps/api`. No Docker is needed for the current dependencies.
- `PYTHON_VERSION=3.12.15` is set explicitly. Render's default for new services is 3.14, and its docs only describe `.python-version` at the repository root.
- `UV_VERSION=0.12.24` (Render's current default) was verified locally to pass `uv lock --check` and `uv sync --locked --no-dev` on our lockfile.
- Start: `uv run --no-sync uvicorn app.main:app --host 0.0.0.0 --port $PORT`.
- Exact settings: README → Deployment.

**Stage 2: CV runtime feasibility (M1c) [INVESTIGATE: verified locally, Render pending].** Both packages install natively from wheels, so Docker is not used.

*Local evidence, 2026-10-17:*
- **Wheels:** both are prebuilt for CPython 3.12 Linux x86_64.
  - OpenCV: `cp37-abi3-manylinux_2_28`.
  - ONNX Runtime: `cp312-manylinux_2_28`, which needs glibc ≥ 2.28.
  - A clean `--only-binary :all:` install for Linux with uv 0.12.24 succeeds, so nothing compiles from source.
- **Download:** about 100 MB.
- **Installed size:** production environment grows from 35 MB to 315 MB.
  - OpenCV: cv2 78 MB plus bundled libraries 84 MB.
  - ONNX Runtime: 62 MB.
  - numpy: 57 MB.
- **System libraries:** none extra. Beyond their bundled libraries, the native modules link only base glibc libraries (libc, libm, libstdc++, libgcc_s, libdl, libpthread, librt) plus libz. OpenCV bundles FFmpeg (libavcodec, libavformat) for later video decode.
- **Memory (Windows):** loading cv2 and onnxruntime adds about 35 MB to the running API, and the full self-check adds about 42 MB (43 → 85 MB). Import takes about 0.25 s. The Linux figure is measured on Render by the startup check (`VmRSS`/`VmHWM`).

**Stage 3: video-processing feasibility (M1d) [INVESTIGATE: verified locally, Render pending].**

*Local measurements, 2026-10-17 (12-thread Windows desktop; synthetic `testsrc2` H.264 clips, each 60 s; 2 fps sampling with resize to 640):*

| Clip | Size | Decoder threads | Wall time | CPU time | Peak RSS (fresh process) |
|---|---|---|---|---|---|
| 1920×1080, 30 fps | 28.7 MB | auto / 1 | 2.7 s / 7.0 s | 20.1 s / 7.0 s | 165 / 84 MB |
| 1280×720, 30 fps | 10.8 MB | auto / 1 | 1.2 s / 3.0 s | 8.3 s / 3.0 s | 104 / 58 MB |
| 854×480, 15 fps | 5.7 MB | auto / 1 | 0.3 s / 1.0 s | 2.0 s / 1.0 s | 78 / 47 MB |
| 640×360, 15 fps | 3.6 MB | auto / 1 | 0.2 s / 0.65 s | 1.1 s / 0.66 s | 68 / 44 MB |

- **The whole clip is decoded, not just the sampled frames.** H.264 needs every frame to reconstruct the next, so cost is set by resolution × source frame rate, not by the 2 fps sample rate.
- **Multi-threaded decode** cuts wall time on a many-core machine, but uses about 2.7× the CPU and twice the memory. On a 0.1-CPU host it only adds overhead, so **one decoder thread is the default.**
- **Through the endpoint** (uvicorn in production mode, local curl upload):
  - The 720p clip took 2.8–3.0 s.
  - Process RSS was 63–74 MB before and after, with a peak of 95 MB.
  - It didn't grow across 5 uploads.
  - No temp files were left.
*Render free instance, measured 2026-10-17 (two real 60 fps stock clips, 11.7 s each, via the test endpoint):*

| Clip | Size | Processing (wall) | CPU | ms/frame | Peak RSS |
|---|---|---|---|---|---|
| 960×540, 60 fps | 4.2 MB | 7.29 s | 1.10 s | 10.4 | 137 MB |
| 1280×720, 60 fps | 8.1 MB | 13.30 s | 1.99 s | 18.9 | 145 MB |

- **CPU share:** CPU ÷ wall = 15 % for both, so the instance gets about 0.15 core.
- **Decode cost:** about 20 ns per pixel per frame.
- **Extrapolated decode for a 60 s clip:** 720p30 ≈ 34 s, 480p15 ≈ 7.5 s, 360p15 ≈ 4 s.
- **Memory:** idle RSS 119–128 MB; about 367 MB of 512 MB is free.
- **Resulting limits:** Tracker D25.
- **Inference cost is not included.** It is measured in M2-S1 once a model exists, and is likely the larger cost.

**Stage 4: model on Render (M2) [CONFIRMED 2026-10-17].**
- **Build command** becomes `uv sync --locked --no-dev && uv run --no-sync python -m app.detection.fetch_model`. It downloads the pinned 12 MB ONNX and verifies its SHA-256; the build fails on a mismatch.
- **Measured on Render (three 30 s 480p15 clips):**
  - Inference: **187–195 ms per sampled frame**.
  - Processing: **12.8–14.8 s** per clip; 15.6–18.3 s per request including upload.
  - Memory: peak **178.5 MB** out of 512 MB.
  - Decisions and confidences are identical to the local run.
- **Result:** the free instance is viable for synchronous processing of clips ≤ 30 s. A 60 s clip is projected at about 30 s. Details: Tracker M2.

**Remaining host checks (M1d on Render, then M3/M7).** Docker is introduced only if the native runtime cannot install OpenCV/ONNX Runtime reliably. Measure and record in `Tracker.md`:
1. (Done in M1c, natively: see Stage 2.) If Docker is ever needed, the image builds with `opencv-python-headless` and `onnxruntime`. Record image size.
2. Cold-start time and idle-sleep behaviour (a free tier may sleep, so there must be a warm-up plan before the demo).
3. Peak RAM while processing a 60 s 720p clip (must fit the instance, e.g. 512 MB).
4. The background thread keeps running after the response returns.
5. A 50 MB upload passes the host's proxy limits and timeouts.
6. Outbound HTTPS to the routing/email providers is allowed.
7. The Postgres connection works and `alembic upgrade head` runs at release.

The API Dockerfile uses a slim Python 3.12 base, `opencv-python-headless`, no PyTorch, and a non-root user. Model weights are fetched at build time from a pinned URL with SHA-256 verification, or baked in if the licence permits.

## 11. Database portability rules

Use only types that behave the same on SQLite and Postgres: `String` UUIDs, `DateTime(timezone=True)` stored as UTC, `JSON` (SQLAlchemy generic), `LargeBinary` for JPEG, enums as `String` + `CHECK` constraint (not native PG enums, so migrations stay simple). No partial indexes or engine-specific SQL in the MVP. Tests run on SQLite. One integration test run against Postgres happens before deployment (M7).

## 12. Testing strategy

| Layer | Tool | What |
|---|---|---|
| Domain unit | pytest | State machine (every allowed and forbidden transition), aggregation (window and cooldown edge cases), dedup table (§4.5, every row), severity rule, station ranking incl. fallback and ties, token hash/expiry. |
| Pipeline | pytest | Synthetic videos generated in-test with OpenCV (moving orange flickering blob = positive; static scene / slow grey fade = negative) run through `HeuristicDetector` end to end. ONNX detector smoke test is skipped when weights are absent (and reported as skipped, never as passed). |
| API integration | pytest + TestClient + temp SQLite | Every endpoint's happy path and every error code in §3.1, idempotency (AC-18), restart recovery (AC-17), notification failure via `failing` provider (AC-11). |
| Frontend unit | Vitest | Formatters (PKT time, distance), status→style mapping, API error parsing. |
| E2E | Playwright (1–2 specs) | VS1 happy path against local API with `DETECTOR=heuristic`, `NOTIFY_EMAIL_PROVIDER=console`, `ROUTING_PROVIDER=none`. |
| Manual | Checklist in `Tracker.md` | Real email/webhook, phone ack, deployed run (AC-16), 3D toggle. |

## 13. Open technical questions (tracked in `Tracker.md`)

| ID | Question | Resolved by |
|---|---|---|
| Q1 | API host (Render / Railway / Fly / HF Spaces) and deployed DB (Neon vs SQLite on a volume)? | M1 |
| Q2 | Which pretrained fire/smoke model passes §4.3 criteria, or do we train on D-Fire? AGPL acceptable? | M2 |
| Q3 | Tile source: OpenFreeMap vs MapTiler; quality of Karachi building data? | M2 |
| Q4 | Routing provider: OSRM demo vs ORS vs GraphHopper? | M2 |
| Q5 | Email provider: Resend vs SMTP; and is a webhook demo target (e.g. webhook.site, Discord) acceptable? | M2 |
| Q6 | Sample clips: which licensed sources, or record our own? | M2 |
| Q7 | Hackathon deadline date, team size, and whether judges will use the deployed app themselves (affects access-key UX). | User |
