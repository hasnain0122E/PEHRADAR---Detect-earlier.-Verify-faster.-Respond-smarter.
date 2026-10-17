# PehRadar

**Detect earlier. Verify faster. Respond smarter.**

PehRadar is a hackathon MVP for **fire and smoke incident detection with operator-assisted response in Karachi, Pakistan**. Pre-recorded videos stand in for camera feeds. A computer-vision pipeline flags *possible* fire/smoke, a human operator reviews the evidence, and confirmed incidents are routed to a candidate fire station through a **test** notification.

> ⚠️ **Demo system.** Cameras are simulated, notifications go to controlled test recipients, and station data is unverified. PehRadar is decision support and is **not connected to any emergency service**.

**Current status:** M1a (local scaffold), verified locally. Only a health endpoint and a status page exist. See [`Tracker.md`](Tracker.md).

## Architecture

```
apps/web  (Next.js 16, TypeScript, Tailwind 4)  ──HTTPS/JSON──▶  apps/api  (FastAPI, Python 3.12)
   browser calls the API directly                                 REST under /api/v1, CORS allowlist
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
apps/api/    FastAPI backend          (see apps/api/README.md)
apps/web/    Next.js frontend         (see apps/web/README.md)
*.md         planning documents
```

Planned later (not yet created): `data/sources/`, `samples/`, `models/`, `scripts/`, `.github/workflows/`.

## Deployment

Not started. The hosting spike is milestone M1b (see Tracker.md).
