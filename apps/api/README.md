# PehRadar API (`apps/api`)

FastAPI backend. Python **3.12** managed by [uv](https://docs.astral.sh/uv/). Current scope: health endpoint, CORS, and the CV runtime (OpenCV headless and ONNX Runtime CPU) with a self-check. No detector yet.

## Commands (run inside `apps/api`)

| Task | Command |
|---|---|
| Install Python 3.12 (once) | `uv python install 3.12` |
| Install dependencies (from `uv.lock`) | `uv sync` |
| Optional local config | `Copy-Item .env.example .env` (PowerShell) |
| Run dev server | `uv run uvicorn app.main:app --reload --port 8000` |
| Tests | `uv run pytest` |
| Lint / format check | `uv run ruff check .` · `uv run ruff format --check .` |

Health: `GET http://localhost:8000/api/v1/health` → `{"status":"ok","app":"pehradar-api","version":"0.1.0"}`.
Interactive docs (non-production only): `http://localhost:8000/api/v1/docs`.

## Configuration

| Variable | Default | Notes |
|---|---|---|
| `APP_ENV` | `development` | `development` \| `test` \| `production`. Production disables `/docs` and `/openapi.json` and requires https origins. |
| `CORS_ORIGINS` | unset: `http://localhost:3000,http://127.0.0.1:3000` outside production, **none** in production | Comma-separated exact origins. Empty means no browser origins. `*` is rejected at startup. |
| `LOG_LEVEL` | `INFO` | |
| `CV_RUNTIME_CHECK` | `false` | M1c spike only. `true` runs the OpenCV/ONNX Runtime self-check at startup and logs one `CV runtime check OK` line. Startup fails if the check fails. |
| `VIDEO_TEST_ENABLED` | `false` | M1d spike only. `true` mounts `POST /api/v1/video/test`. When `false`, the endpoint returns 404. |
| `VIDEO_TEST_MAX_MB` | `20` | Upload cap. Checked against `Content-Length` before the body is read, then against the stored size. |
| `VIDEO_MAX_SECONDS` | `120` | Longer clips get `422 VIDEO_TOO_LONG`. |
| `VIDEO_SAMPLE_FPS` | `2` | Frames sampled per second of video |

Video benchmark (M1d): `uv run python -m app.detection.benchmark clip.mp4 [--sample-fps 2] [--decode-threads 1]` prints metadata, frames decoded/sampled, wall and CPU time, and RSS before/during/after/peak.

`POST /api/v1/video/test` (only when enabled):
- Takes `multipart/form-data` with a single field `file` (an `.mp4`).
- Returns the same metrics as JSON.
- Errors use the `{"error":{"code","message","details"}}` format: `411 LENGTH_REQUIRED`, `413 UPLOAD_TOO_LARGE`, `415 UNSUPPORTED_MEDIA`, `409 VIDEO_TEST_BUSY`, `422 VIDEO_UNREADABLE | VIDEO_TOO_LONG | VALIDATION_ERROR`.

CV runtime self-check (M1c): `uv run python -m app.detection.runtime_check` prints the OpenCV, numpy and ONNX Runtime versions and the execution providers. CPU only, no model weights.

## Production (Render)

Build: `uv sync --locked --no-dev`. Start: `uv run --no-sync uvicorn app.main:app --host 0.0.0.0 --port $PORT`.
Full Render settings are in the root `README.md` → Deployment.

## Layout

```
app/
  main.py        app factory (create_app), CORS, router mounting under /api/v1
  config.py      Pydantic settings + validation
  routers/       HTTP routers (health)
  schemas/       Pydantic response models
  domain/ services/ detection/ jobs/ notifications/ routing/ models/   (empty until their milestones)
tests/           pytest (health + config/CORS)
```
