# PehRadar API (`apps/api`)

FastAPI backend. Python **3.12** managed by [uv](https://docs.astral.sh/uv/). Current scope:
- health endpoint and CORS;
- the M2 fire/smoke detection endpoint (an ONNX YOLOv8n model on CPU, with a temporal confirmation rule and an evidence JPEG);
- the M3 operational backend: PostgreSQL (Neon) or local SQLite via SQLAlchemy + Alembic, simulated Karachi cameras, OSM fire stations, operator review, incidents, the nearest available station by straight-line distance, and an incident timeline.

There are no notifications and no road routing yet. Every detection is decision support only and needs operator review.

## Commands (run inside `apps/api`)

| Task | Command |
|---|---|
| Install Python 3.12 (once) | `uv python install 3.12` |
| Install dependencies (from `uv.lock`) | `uv sync` |
| Download the model (once; SHA-256 checked) | `uv run python -m app.detection.fetch_model` |
| Create/upgrade the database schema | `uv run alembic upgrade head` (SQLite `./pehradar-dev.db` unless `DATABASE_URL` is set) |
| Load the Karachi demo seed (idempotent) | `uv run python -m app.seed` |
| Optional local config | `Copy-Item .env.example .env` (PowerShell) |
| Run dev server | `uv run uvicorn app.main:app --reload --port 8000` |
| Tests | `uv run pytest -rs` (the 2 real-model tests are skipped if the model is absent) |
| Lint / format check | `uv run ruff check .` · `uv run ruff format --check .` |
| Run clips through the detector | `uv run python -m app.detection.validate_clips path\to\*.mp4` |

Health: `GET http://localhost:8000/api/v1/health` → `{"status":"ok","app":"pehradar-api","version":"0.1.0"}`.
Interactive docs (non-production only): `http://localhost:8000/api/v1/docs`.

## Fire/smoke detection

`POST /api/v1/detect/fire` takes `multipart/form-data` with one field `file`, an `.mp4` of at most 20 MB and 60 s.

```powershell
curl.exe -s -F "file=@C:\path\clip.mp4" http://localhost:8000/api/v1/detect/fire
```

The response includes:
- `status` (`detected` | `not_detected`) and `event_type` (`fire` | `smoke` | `fire_smoke` | null);
- `confidence`, `best_frame_timestamp`, `sampled_frames`, `positive_frames`, `processing_seconds`;
- `model`, `threshold` and `rule`;
- per-class `classes{}`;
- `evidence{url, timestamp, boxes}` or null;
- `video{}`, `inference_ms_per_frame`, `peak_rss_mb` and a `disclaimer`.

`GET /api/v1/detect/evidence/{id}.jpg` returns the annotated evidence frame. Only the newest 20 are kept, in temporary storage.

Pipeline:
1. Decode the MP4 with one thread and sample at 2 fps.
2. Letterbox each frame to 320 px and run YOLOv8n on ONNX Runtime with the CPU provider.
3. Apply class-wise NMS (IoU 0.45).
4. Confirm each class with the temporal rule in `app/domain/fire_decision.py`.
5. Save the strongest frame of a confirmed class as the evidence JPEG, keeping at most 960 px on the long side and adding a watermark.

**Decision rule:** a class is confirmed when its score is ≥ `DETECT_CONF_THRESHOLD` (0.45) in at least `DETECT_MIN_POSITIVE_FRAMES` (3) of any `DETECT_WINDOW_FRAMES` (5) consecutive sampled frames. The single-frame rule is off by default.

Errors use `{"error":{"code","message","details"}}`:

| Status | Codes |
|---|---|
| 411 | `LENGTH_REQUIRED` |
| 413 | `UPLOAD_TOO_LARGE` |
| 415 | `UNSUPPORTED_MEDIA` |
| 409 | `VIDEO_BUSY` |
| 422 | `VIDEO_UNREADABLE`, `VIDEO_TOO_LONG`, `VALIDATION_ERROR` |
| 503 | `MODEL_UNAVAILABLE` |
| 500 | `INFERENCE_FAILED` (details only in server logs) |

Model provenance and licence (treated as AGPL-3.0): [`models/README.md`](models/README.md).

**Linking a detection to a camera (M3).**
- Add the form field `camera_id` to `POST /detect/fire`. This needs the `X-Operator-Key` header.
- A `detected` result is stored as a **pending** `DetectionEvent`, including its evidence JPEG. The response then also has `detection_event_id`, `review_status` and `camera`.
- The evidence URL becomes the persistent `/api/v1/detections/{id}/evidence.jpg`.
- `not_detected` stores nothing.
- No incident is ever created automatically.
- Without `camera_id`, the endpoint behaves exactly as it did in M2.

## Operational API (M3)

Reads are public. Writes need the header `X-Operator-Key: <OPERATOR_API_KEY>`.

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/cameras[?department=fire]` · `/api/v1/cameras/{id}` | Simulated Karachi cameras (`is_simulated: true`) |
| GET | `/api/v1/fire-stations` · `/api/v1/fire-stations/{id}` | OSM locations, `unverified`; `status` is a demo flag (`status_note`) |
| GET | `/api/v1/detections[?review_status=pending]` · `/api/v1/detections/{id}` · `/api/v1/detections/{id}/evidence.jpg` | Review queue and evidence |
| POST | `/api/v1/detections/{id}/confirm` | Body `{"operator"?, "note"?}`. Creates the incident: camera coordinates, severity rule, nearest available station (Haversine, `is_driving_eta: false`), timeline. Repeat → 409 `DETECTION_ALREADY_REVIEWED`. |
| POST | `/api/v1/detections/{id}/reject` | Body `{"operator"?, "note"?}`. No incident is created; the review is stored on the detection. |
| GET | `/api/v1/incidents[?status=&event_type=]` · `/api/v1/incidents/{id}` | The detail view includes camera, detection, station selection, evidence URL and the timeline (ordered by `seq`) |
| PATCH | `/api/v1/incidents/{id}/status` | Body `{"status": "notified"\|"acknowledged"\|"resolved"\|"rejected", "operator"?, "note"?}`. Invalid transition → 409 `INVALID_STATE_TRANSITION`. |

**State machine** (`app/domain/incident_rules.py`):

```
confirmed → station_selected → notified → acknowledged → resolved
```

`resolved` and `rejected` are terminal. Before `acknowledged`, an incident can also go straight to `resolved` or `rejected` (false alarm). `notified` and `acknowledged` are recorded by the operator; PehRadar sends nothing.

**Severity:** `fire_smoke` → high; `fire` → high at ≥ 0.70, otherwise medium; `smoke` → medium at ≥ 0.80, otherwise low.

## Configuration

| Variable | Default | Notes |
|---|---|---|
| `APP_ENV` | `development` | `development` \| `test` \| `production`. Production disables `/docs` and `/openapi.json` and requires https origins. |
| `CORS_ORIGINS` | unset: `http://localhost:3000,http://127.0.0.1:3000` outside production, **none** in production | Comma-separated exact origins. Empty means no browser origins. `*` is rejected at startup. |
| `LOG_LEVEL` | `INFO` | |
| `MAX_UPLOAD_MB` | `20` | Checked against `Content-Length` before the body is read, then against the stored size |
| `VIDEO_MAX_SECONDS` | `60` | Longer clips get `422 VIDEO_TOO_LONG` |
| `VIDEO_SAMPLE_FPS` | `2` | Frames sampled per second of video |
| `MODEL_PATH` / `MODEL_SHA256` | `models/fire_smoke_yolov8n_320.onnx` / pinned hash | If the file is missing or its hash doesn't match, `/detect/fire` returns 503. The rest of the API keeps working. |
| `MODEL_THREADS` | `1` | ONNX Runtime intra-op threads. 1 suits Render's ~0.15 CPU. |
| `DETECT_CONF_THRESHOLD` | `0.45` | Per-frame score threshold |
| `DETECT_MIN_POSITIVE_FRAMES` / `DETECT_WINDOW_FRAMES` | `3` / `5` | Temporal confirmation |
| `DETECT_SINGLE_FRAME_CONFIDENCE` | `0` (off) | If > 0, one frame at or above it confirms on its own |
| `EVIDENCE_DIR` / `EVIDENCE_MAX_FILES` | system temp / `20` | Evidence JPEG storage (ephemeral) |
| `DATABASE_URL` | unset → `sqlite:///./pehradar-dev.db` | **Required in production** and must be PostgreSQL, or the app refuses to start. Neon URLs (`postgresql://…?sslmode=require`) are switched to the psycopg 3 driver automatically. |
| `OPERATOR_API_KEY` | unset | Shared key for writes (`X-Operator-Key`). Unset in production → writes return 503. Unset in dev/test → writes allowed. |
| `CV_RUNTIME_CHECK` | `false` | M1c spike: startup self-check log line |
| `VIDEO_TEST_ENABLED` | `false` | M1d diagnostics: mounts `POST /api/v1/video/test` (decode metrics, no detection) |

Other diagnostics:
- `uv run python -m app.detection.benchmark clip.mp4` measures decode speed and memory.
- `uv run python -m app.detection.runtime_check` checks the CV runtime.

## Production (Render)

Build: `uv sync --locked --no-dev && uv run --no-sync python -m app.detection.fetch_model`.
Start (M3): `uv run --no-sync alembic upgrade head && uv run --no-sync python -m app.seed && uv run --no-sync uvicorn app.main:app --host 0.0.0.0 --port $PORT`.
Migrations and the seed are idempotent, so running them at every start is safe. If either fails, the new deploy doesn't go live.
Full Render settings are in the root `README.md` → Deployment.

## Layout

```
app/
  main.py        app factory (create_app), CORS, router mounting under /api/v1, model preload
  config.py      Pydantic settings + validation
  routers/       health, detect, operations (cameras/stations/detections/incidents), security
                 (operator key), serializers, uploads (shared MP4 guards), video_test
  db.py          engine/session (psycopg 3 / SQLite), UTC datetime type
  models/        ORM tables: camera, fire_station, detection_event, incident, incident_timeline_event
  services/      operations.py: record/confirm/reject detections, station selection, status, timeline
  seed.py        idempotent Karachi seed loader (seed/karachi_demo.json)
  domain/        fire_decision.py (temporal confirmation), incident_rules.py (states, severity, Haversine)
  detection/     video sampling, fire_model (ONNX pre/post-processing), fire_pipeline, evidence,
                 fetch_model, validate_clips, benchmark, runtime_check, memory
alembic/         migrations (0001 = M3 schema); URL comes from DATABASE_URL
seed/            karachi_demo.json (simulated cameras, OSM stations)
models/          README.md (provenance); *.onnx downloaded, git-ignored
tests/           pytest (unit tests use a scripted detector; 2 real-model integration tests)
```
