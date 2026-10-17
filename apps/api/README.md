# PehRadar API (`apps/api`)

FastAPI backend. Python **3.12** managed by [uv](https://docs.astral.sh/uv/). M1 scope: health endpoint and CORS only.

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
| `CORS_ORIGINS` | `http://localhost:3000,http://127.0.0.1:3000` | Comma-separated exact origins. `*` is rejected at startup. |
| `LOG_LEVEL` | `INFO` | |

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
