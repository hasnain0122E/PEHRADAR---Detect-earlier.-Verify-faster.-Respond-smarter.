# PehRadar

**Detect earlier. Verify faster. Respond smarter.**

PehRadar is a hackathon MVP for **fire and smoke incident detection with operator-assisted response in Karachi, Pakistan**.
- A simulated city monitoring network runs licensed sample clips through a real fire/smoke model.
- A human operator reviews the evidence.
- Confirmed incidents get a candidate fire station and a suggested road route.

> ⚠️ **Demo system.**
> - **No official or Safe City CCTV is connected.** Monitoring nodes are simulated placements or OSM-mapped locations, and demo feeds are licensed sample footage.
> - Station data is from OpenStreetMap and unverified; availability is a demo flag. Routes are estimates.
> - PehRadar is decision support and is **not connected to any emergency service**.

**Current status:**
- M1–M4 are complete and deployed (per the user's M5 brief).
- M5 is built and verified locally: city-scale network, automated scenarios, 3D map, clustering, feeds and road routing. Its Render and Vercel redeploy is pending.

See [`Tracker.md`](Tracker.md).

## Architecture

```
apps/web  (Next.js 16, TypeScript, Tailwind 4)  ──HTTPS/JSON──▶  apps/api  (FastAPI, Python 3.12)
   browser reads the API directly                                 REST under /api/v1, CORS allowlist
   operator writes go via /api/operator/* (server adds the key)
```

| Document | Purpose |
|---|---|
| [PRD.md](PRD.md) | Problem, users, requirements, acceptance criteria |
| [Techspec.md](Techspec.md) | Architecture, API, CV pipeline, decisions |
| [Appflow.md](Appflow.md) | Operator journey, error flows, state machines |
| [Design.md](Design.md) | UI system and components |
| [Schema.md](Schema.md) | Data model |
| [ImplementationPlan.md](ImplementationPlan.md) | Milestones, vertical slice, risk register |
| [Tracker.md](Tracker.md) | Live status, decisions, next task |
| [Rules.md](Rules.md) | Engineering rules |

## Prerequisites

| Tool | Version used | Install |
|---|---|---|
| uv | 0.13.0 | `powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 \| iex"` |
| Python | 3.12 (uv-managed) | `uv python install 3.12` (does not change your system Python) |
| Node.js | ≥ 22 (verified on 24.19.0) | https://nodejs.org |
| npm | verified on 12.0.2 | ships with Node |

## Local setup (Windows PowerShell)

Run the two apps in **two terminals** from the repo root.

**Terminal 1: API**
```powershell
cd apps\api
uv python install 3.12
uv sync
uv run uvicorn app.main:app --reload --port 8000
```

**Terminal 2: Web**
```powershell
cd apps\web
npm ci
Copy-Item .env.example .env.local
npm run dev
```

Open http://localhost:3000. The **Backend API** card should show **Connected** with `pehradar-api v0.1.0`. If the API is stopped, it shows **Disconnected** with a Retry button.

The API accepts browser requests only from `CORS_ORIGINS` (default `http://localhost:3000` and `http://127.0.0.1:3000`). If you run the web app on another port, add that origin in `apps/api/.env`.

## Checks

```powershell
cd apps\api; uv run pytest; uv run ruff check .; cd ..\..
cd apps\web; npm test; npm run lint; npm run typecheck; npm run build; cd ..\..
```

## Repository layout

```
apps/api/            FastAPI backend          (see apps/api/README.md)
apps/web/            Next.js frontend         (see apps/web/README.md)
.github/workflows/   CI: API ruff + pytest; web lint + typecheck + test + build
*.md                 planning documents
```

Planned later (not yet created): `data/sources/`, `samples/`, `models/`, `scripts/`.

## Deployment (M1b: deployed 2026-10-17)

The live URLs and verification results are recorded in `Tracker.md`. No production URL is hard-coded anywhere in the code.

### API on Render (native Python + uv, no Docker)

| Setting | Value |
|---|---|
| Service type | Web Service |
| Repository / branch | this GitHub repo / `main` |
| Root Directory | `apps/api` |
| Language | Python 3 |
| Build Command | `uv sync --locked --no-dev && uv run --no-sync python -m app.detection.fetch_model` (M2: downloads the pinned 12 MB fire/smoke model and verifies its SHA-256) |
| Start Command | `uv run --no-sync alembic upgrade head && uv run --no-sync python -m app.seed && uv run --no-sync uvicorn app.main:app --host 0.0.0.0 --port $PORT` (M3: idempotent migrations + seed before start) |
| Health Check Path | `/api/v1/health` |
| Env `PYTHON_VERSION` | `3.12.15` (explicit, because Render's default for new services is 3.14) |
| Env `UV_VERSION` | `0.12.24` (verified to read this repo's `uv.lock`) |
| Env `APP_ENV` | `production` |
| Env `LOG_LEVEL` | `INFO` |
| Env `DATABASE_URL` | M3: Neon PostgreSQL connection string (secret; required in production) |
| Env `OPERATOR_API_KEY` | M3: long random secret for operator writes (`X-Operator-Key`) |
| Env `CORS_ORIGINS` | **Leave unset** until the Vercel URL exists, then set `https://<your-vercel-domain>` |
| Env `SCENARIOS_ENABLED` | M5: `true` to enable the demo scenario engine. It is **off in production when unset**. |
| Env `ROUTING_PROVIDER` | M5: `osrm` (default; public OSRM demo server, light use) or `none` |
| Env `SCENARIO_DELAY_OVERRIDE_S` | M5, optional: one trigger delay for every scenario. Unset keeps the configured 6 s (M6B). The console also sends its own per-run delay (Settings › Scenario delay, default 5 s) |
| Env `SCENARIO_MAX_DELAY_S` | M6B, optional: longest per-run delay the console may request (default `300`) |
| Env `INCIDENT_MERGE_WINDOW_MIN` | M6B, optional: a confirmed detection from the same camera and event type within this many minutes of an open incident joins it instead of creating a new one (default `30`; `0` disables merging) |

- Render detects uv because `apps/api/uv.lock` exists.
- `--no-dev` and `--no-sync` keep pytest and ruff out of production. Plain `uv run` would install the dev group at startup.
- With `APP_ENV=production` and `CORS_ORIGINS` unset, the API serves direct requests (curl, opening the URL in a browser) but **allows no cross-origin browser calls**. A wildcard is never used. Production also requires `https://` origins and disables `/api/v1/docs`.
- M6B adds migration `0003` (camera `feed_meta`, `detection_merged` timeline event); the start command's `alembic upgrade head` applies it, and the seed then assigns the Pakistan-based demo feeds to 156 nodes. The demo clips live in `apps/api/demo_assets/` (committed; see `SOURCES.md`).
- The web app now serves the landing page at `/` and the command center at `/monitor`.
- `/` returns 404 by design. The public check URL is `https://<service>.onrender.com/api/v1/health`.

### Web on Vercel (after the API is live)

| Setting | Value |
|---|---|
| Root Directory | `apps/web` |
| Framework Preset | Next.js (auto-detected) |
| Build / Install / Output | defaults (`next build`, npm with `package-lock.json`) |
| Node.js | 24.x (from `engines.node: ">=22"`) |
| Env `NEXT_PUBLIC_API_BASE_URL` | `https://<service>.onrender.com`, set **before** the first build |
| Env `OPERATOR_API_KEY` | M4: the same value as on Render. **Server-only**: not `NEXT_PUBLIC_`. Mark it Sensitive. Used by the `/api/operator/*` proxy. |

`NEXT_PUBLIC_API_BASE_URL` is inlined at build time, so changing it requires a redeploy. After Vercel assigns its domain, set `CORS_ORIGINS=https://<your-vercel-domain>` on Render. Vercel preview deployments use different origins and will show "Disconnected" unless their origin is added too.
