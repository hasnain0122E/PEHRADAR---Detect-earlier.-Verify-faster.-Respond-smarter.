# PehRadar — Implementation Plan

**Status:** Draft v0.1 (M0). Live status is in `Tracker.md`, not here.
**Strategy:** get a thin, honest, **deployed** end-to-end slice (VS1) working as early as possible, then deepen it. The heuristic detector, the console notification provider, and straight-line station ranking mean VS1 does not depend on any external spike succeeding. Each spike upgrades the slice when it lands.

---

## 1. Repository structure (to be scaffolded in M1, not before)

```
CODE-CONNECT-2026/                      # repo root (rename to pehradar/ optional)
├── PRD.md  Techspec.md  Appflow.md  Design.md  Schema.md
├── ImplementationPlan.md  Tracker.md  Rules.md
├── README.md                           # setup + run + deploy (M1)
├── .gitignore                          # .env, var/, samples/*.mp4|mov|webm, models/*.onnx, node_modules, .venv
├── .github/workflows/ci.yml            # ruff + pytest; eslint + tsc + vitest (M1)
├── apps/
│   ├── api/
│   │   ├── pyproject.toml  uv.lock  .python-version (3.12)
│   │   ├── .env.example  Dockerfile  alembic.ini
│   │   ├── app/
│   │   │   ├── main.py  config.py  db.py  errors.py  security.py  logging.py
│   │   │   ├── models/          # SQLAlchemy ORM (one module per entity in Schema.md)
│   │   │   ├── schemas/         # Pydantic request/response models
│   │   │   ├── routers/         # health, dashboard, cameras, stations, samples, jobs, detections, incidents, notifications, ack
│   │   │   ├── services/        # transactional orchestration (review, incidents, notify, ack)
│   │   │   ├── domain/          # PURE: incident_state, aggregation, dedup, severity, station_ranking, tokens
│   │   │   ├── detection/       # detector.py (Protocol), heuristic.py, onnx_yolo.py, video.py, evidence.py
│   │   │   ├── jobs/            # runner.py (single worker thread, startup recovery)
│   │   │   ├── notifications/   # console.py, email.py, webhook.py, message.py
│   │   │   └── routing/         # haversine.py, client.py (provider chosen in M2)
│   │   ├── migrations/          # Alembic
│   │   ├── seed/                # cameras.json, stations.json, load.py
│   │   └── tests/
│   │       ├── unit/            # domain/*
│   │       ├── integration/     # API + DB + pipeline
│   │       └── fixtures/        # synthetic video generator (no binary fixtures committed)
│   └── web/
│       ├── package.json  package-lock.json  .env.example  next.config.ts  tailwind config
│       ├── src/app/             # page.tsx (dashboard), ack/[token]/page.tsx, layout.tsx
│       ├── src/components/      # map/, rail/, panels/, review/, incident/, dialogs/, ui/
│       ├── src/lib/             # api client, query hooks, format (PKT), audio, keyboard
│       ├── src/types/api.gen.ts # generated from OpenAPI — never hand-edited
│       └── tests/               # vitest unit; e2e/ (Playwright)
├── data/sources/                # overpass query, raw OSM export (dated), PROVENANCE.md
├── samples/                     # manifest.json, SOURCES.md (licences); video files git-ignored unless licence+size allow
├── models/                      # README.md (source, licence, SHA-256), EVALUATION.md; weights git-ignored
└── scripts/                     # fetch_samples, fetch_model, export_stations, purge_evidence, gen_api_types
```

**Why a monorepo without a monorepo tool:** two apps with different toolchains (uv, npm) share docs and an API contract. Turborepo/Nx would add config with no payoff at this size. Root-level scripts are thin wrappers.

## 2. Milestones

Legend: **Dep** = dependencies. **Exit** = criteria that must be verified, and recorded in `Tracker.md`, before the milestone is marked DONE.

### M0 — Foundation & documentation
- Eight docs, directory plan, VS1 definition, risk register.
- **Exit:** all eight docs exist and agree with each other. The user has reviewed and approved them, and open questions are listed in Tracker.

### M1 — Repository scaffold + deployment spike
M1 was split into **M1a** (local scaffold, no heavy dependencies, as requested at M1 kickoff) and **M1b** (GitHub remote + deployment spike).

**M1a: local scaffold** (DONE, verified locally 2026-10-17; evidence in Tracker)
- `git init`, `.gitignore`, README, `.env.example` files (placeholders only).
- `apps/api`: uv project pinned to Python 3.12. FastAPI `GET /api/v1/health` returning `{status, app, version}`. CORS from `CORS_ORIGINS` (wildcard rejected). Pydantic Settings. Ruff + pytest.
- `apps/web`: Next.js + TS + Tailwind status page calling the health endpoint from the browser. Vitest.
- JSON logging is deferred to M3, when there are requests worth logging.

**M1b: GitHub + lightweight deployment** ← *in progress*
At M1b kickoff the user excluded OpenCV, ONNX Runtime, video processing and the DB from this milestone. M1b proves only that the existing lightweight scaffold runs in production. The heavy-dependency checks moved to **M1c**.
**Dep:** M1a, GitHub remote, Render and Vercel accounts (user).
- GitHub repo verified. CI workflow (ruff + pytest; lint + typecheck + vitest + build).
- API on Render **native Python + uv** (no Docker): Root Directory `apps/api`, `uv sync --locked --no-dev`, `uv run --no-sync uvicorn … --port $PORT`. Settings are in README → Deployment.
- In production, unset `CORS_ORIGINS` means no browser origins (never a wildcard) until the Vercel origin is known.
- Then web on Vercel (Root Directory `apps/web`, `NEXT_PUBLIC_API_BASE_URL` set before build), and `CORS_ORIGINS` set to the Vercel origin.
- **Exit:**
  1. Public `GET /api/v1/health` returns 200 with `"app": "pehradar-api"`.
  2. It still works after a fresh redeploy/restart, and the logs show no unexplained startup errors.
  3. The deployed web page shows "Connected" against the deployed API, with `CORS_ORIGINS` restricted to the Vercel origin.
  4. CI is green on GitHub.
  5. Real URLs and results are recorded in Tracker (not in code).

**M1c: heavy-dependency hosting spike** (after M1b, before M4)
**Dep:** M1b.
- `apps/api/Dockerfile` (slim, non-root) that **installs `opencv-python-headless` and `onnxruntime`**. The health check also reports that both import, so the spike tests the real heavy dependencies. It is used only if Render's native runtime can't install them.
- A throwaway spike endpoint `POST /spike/process` (behind `APP_ENV != production` **or** removed after the spike) that decodes an uploaded clip at 2 fps on a background thread and reports duration and peak RSS.
- Postgres (Neon) connected.
- Record the measurements listed in `Techspec.md` §10 in `Tracker.md`.
- **Exit:**
  1. A deployed 60 s 720p clip decodes on a background thread. Wall time and peak RAM are recorded. A 50 MB upload succeeds, or the real limit is recorded and `MAX_UPLOAD_MB` adjusted.
  2. Decision Q1 (host + DB) recorded. If the first host fails a criterion, the second candidate is tried within the spike timebox (½ day).

### M2 — Technical spikes (time-boxed, can run in parallel with M3)
**Dep:** M1. Each spike ≤ ½ day. If a spike overruns, the fallback is adopted and recorded.
| Spike | Output | Fallback if it fails |
|---|---|---|
| **S-Model** (Q2) | `models/README.md` (source, licence, SHA-256), ONNX file, `models/EVALUATION.md` comparing heuristic vs candidate on the eval set (§4.3 of Techspec), CPU ms/frame locally and on the deployed host | Ship with `HeuristicDetector`, clearly labelled baseline |
| **S-Samples** (Q6) | `samples/manifest.json` + `SOURCES.md` with ≥ 4 positive and ≥ 4 negative licensed clips, reference positive/negative designated | Team-recorded controlled clips; synthetic clips |
| **S-Map** (Q3) | Style URL chosen, screenshot of Karachi at z11/z15, notes on building/height coverage, attribution text | MapTiler free key; 2D only |
| **S-Routing** (Q4) | Provider chosen, sample route Korangi→station, latency, quota/policy notes | `ROUTING_PROVIDER=none` (straight line) |
| **S-Notify** (Q5) | One real email to the demo recipient and one webhook POST, via the chosen provider; deliverability notes (spam folder?) | Webhook only (e.g. webhook.site) + console |
| **S-Stations** | Overpass export + `seed/stations.json` with provenance; count of Karachi stations found | Manual `PUBLIC_WEB` entries with source URLs |
- **Exit:** each Q1–Q6 has a recorded decision (or adopted fallback) in Tracker → Decisions, with evidence.

### M3 — Backend domain core
**Dep:** M1.
- SQLAlchemy models + first Alembic migration exactly matching `Schema.md` (incl. CHECK constraints, and the circular FK `incident.primary_detection_id` ↔ `detection_event.incident_id` handled with `use_alter`).
- Seed loader (cameras simulated, stations from S-Stations or a placeholder `MANUAL_DEMO` set until then).
- Pure domain modules with unit tests: `incident_state`, `severity`, `dedup`, `station_ranking` (haversine path), `tokens`.
- Read endpoints: `/cameras`, `/stations`, `/samples`, `/dashboard` (empty lists OK). Auth dependency (`X-Operator-Key`). Error envelope.
- OpenAPI export script plus `gen_api_types` producing `api.gen.ts`.
- **Exit:** migration runs on SQLite (and Postgres once M1 provides it). The domain unit tests cover every row of Appflow §3.2 and Techspec §4.5. Read endpoints have integration tests. All tests pass and the actual output is recorded.

### M4 — Detection pipeline & analysis jobs
**Dep:** M3. (S-Model is **not** required. The heuristic unblocks it.)
- Video validation, sampling, `HeuristicDetector`, `aggregation`, evidence rendering, job runner with startup recovery, `POST /cameras/{id}/analysis-jobs`, `GET /analysis-jobs/{id}`, detection list/detail/evidence endpoints, dedup applied at persist time.
- `OnnxYoloDetector` added when S-Model delivers weights (can land after VS1).
- **Exit:** AC-03, AC-04 (synthetic), AC-05 (synthetic), AC-08 (unit + integration), AC-17 pass in pytest. Measured processing time for a 60 s clip recorded.

### M5 — Review, incident, notification & acknowledgement API
**Dep:** M3 (M4 for realistic data, but tests construct detections directly).
- Confirm/reject, incident creation/attachment, station candidates (straight-line, plus routing client if S-Routing is done), assign, notify (console + chosen email/webhook adapters + test `failing` provider), retry, limits, ack GET/POST, resolve, notes, timeline writes.
- **Exit:** AC-06, AC-07 (API part), AC-09 (API part), AC-10 (console), AC-11, AC-12, AC-13 (API part), AC-18 pass in pytest.

### M6 — Frontend vertical slice
**Dep:** M3 contracts (can start against generated types and the M3 read endpoints while M4/M5 finish).
- Access key dialog, demo banner, top bar, 2D MapLibre map with three layers, left rail (review + incidents), camera panel (sample run + upload + progress), evidence review with confirm/reject dialogs, incident panel (candidates, assign, notify modal, notification rows, timeline, resolve), `/ack/[token]` page. Polling via TanStack Query.
- Design tokens from `Design.md` §4–5 in the Tailwind config. Loading, empty and error states from Design §13 for every component built.
- **Exit:** manual run of the VS1 script (§3) passes locally against the real API. Vitest passes.

### M7 — VS1 integration, E2E, and deployment ★ (first complete vertical slice)
**Dep:** M4, M5, M6.
- Playwright spec for the VS1 happy path (heuristic detector, console notifications, no routing).
- Postgres integration test run. Deploy both apps. Run the VS1 script on the deployed URLs with real email or webhook (whatever S-Notify delivered).
- **Exit:** AC-01, 02, 04, 06, 07, 09, 10, 12, 13, 15, 16 verified. Playwright passes locally. The deployed run is recorded in Tracker with date, URLs and observations. **This is the minimum demo-able product.** Nothing optional starts before this milestone is DONE.

### M8 — Routing & route display
**Dep:** M7, S-Routing.
- Road-network candidates, route polylines, fallback styling, refresh action, disclaimer.
- **Exit:** AC-14 verified (provider up, and provider forced down).

### M9 — Model upgrade & design polish
**Dep:** M7 (S-Model for the detector part).
- Switch to `OnnxYoloDetector` if it beat the baseline in `EVALUATION.md`. Tune thresholds with recorded before/after results.
- Audio alerts, keyboard shortcuts, reduced-motion, 3D building toggle (if S-Map found usable data), contrast verification, responsive breakpoints, timeline elapsed chips.
- **Exit:** each item demoed. Contrast results recorded. Detector choice justified by measured numbers.

### M10 — Hardening & demo readiness
**Dep:** M8, M9.
- Error-path walkthrough (every Appflow §2 flow, manually), log review for leaked secrets/addresses, purge script, README final, warm-up procedure for sleeping hosts, demo script and backup demo video recording.
- **Exit:** all AC-01…AC-18 verified and recorded. Tracker shows no open P0 bugs.

### Deferred (explicitly not scheduled)
Police, ambulance, theft detection, vehicle-accident detection, RTSP/live streams, multi-camera correlation, SMS/WhatsApp, operator accounts. They are only reconsidered after M10, by an explicit decision recorded in Tracker.

### Dependency graph
```
M0 ─▶ M1 ─┬─▶ M2 (spikes) ─────────────┬──────────────▶ M8 ─┐
          └─▶ M3 ─┬─▶ M4 ─┐             │                    ├─▶ M10
                  ├─▶ M5 ─┼─▶ M7 (VS1) ─┴──────────────▶ M9 ─┘
                  └─▶ M6 ─┘
```

## 3. Vertical slice VS1: definition and acceptance script

**Scope:** one simulated camera, one reference positive sample (or a synthetic clip if samples aren't sourced yet), heuristic detector, review, confirm, incident on the map, straight-line station ranking, assign, test notification (console locally; real email/webhook when deployed), ack, resolve, complete timeline. All simulated/test labels present.

**Out of VS1:** road routing, route polyline (straight-line dashed line is fine but optional), ONNX model, 3D, audio, keyboard shortcuts, webhook signature verification UI.

**VS1 acceptance script** (run locally in M6/M7, then on deployed URLs in M7; every step maps to an AC):

| Step | Action | Expected | AC |
|---|---|---|---|
| 1 | Open dashboard, enter access key + label "Operator A" | DEMO banner, map centred on Karachi, ≥ 6 camera markers with SIMULATED, station markers with UNVERIFIED | AC-01, AC-15 |
| 2 | Click camera `KHI-SIM-03` | Camera panel with SIMULATED badge, sample selector, upload | AC-02 |
| 3 | Upload a `.txt` renamed `.mp4` | `UNSUPPORTED_MEDIA` message, no job | AC-03 |
| 4 | Run reference positive sample | Progress visible; ≥ 1 card appears in Review within 5 s of creation; card shows evidence, confidence, offset, PKT time, detector | AC-04 |
| 5 | Run reference positive sample again on the same camera before reviewing | No new card; existing card shows `+N similar` | AC-08 |
| 6 | On a second camera, run positive, then reject the card with `FALSE_POSITIVE_LIGHTING` | Card gone, no incident created | AC-06 |
| 7 | Confirm the first card (severity as suggested) | Incident marker + Incidents tab entry ≤ 5 s; timeline has 3 events | AC-07 |
| 8 | View candidates | ≤ 3 stations, labelled `STRAIGHT_LINE` with distances | AC-09 |
| 9 | Try Notify before assigning | Button disabled with "Assign a station first" | AC-10 |
| 10 | Assign rank-1 station, Notify, check modal, Send | Notification SENT, incident NOTIFIED; message (console log or inbox) begins `[TEST — PehRadar demo]` and has an ack link | AC-10 |
| 11 | Open the ack link (on a phone when deployed) | Summary, no auto-ack; press Acknowledge → success | AC-12 |
| 12 | Back on dashboard | Notification + incident ACKNOWLEDGED within ≤ 3 s | AC-12 |
| 13 | Reopen same ack link and press Acknowledge | "Already acknowledged" | AC-12 |
| 14 | Resolve with `HANDLED` | Incident leaves active list; timeline complete; Resolve/Notify disabled | AC-13 |
| 15 | (Deployed only) Repeat 1, 4, 7, 10–14 on public URLs | Same results | AC-16 |

## 4. Risk register

Likelihood (L) and Impact (I): H / M / L. Owner = the milestone that retires or contains the risk.

| ID | Risk | L | I | Early signal | Mitigation / contingency | Owner |
|---|---|---|---|---|---|---|
| R1 | **3D map infeasible or misleading.** Karachi OSM buildings sparse or without heights; Cesium/Google options costly or heavy. | H | L | S-Map screenshots show few footprints at z15 | 3D is optional and off by default. 2D MapLibre is the must-have. Honest "heights estimated" label. Cesium/Google rejected for MVP. | M2, M9 |
| R2 | **Tile provider unavailable / rate-limited** during the demo | L | H | Tile 4xx/5xx in browser console | Second style URL in config (MapTiler key). Markers still render on a blank map (Design §13). | M2, M10 |
| R3 | **Model accuracy poor:** misses real fire or floods false positives (sunsets, sodium lights, dust, steam) | H | H | EVALUATION.md recall < 0.8 or > 0.5 false events/negative clip | Human review is mandatory by design. Temporal aggregation (3/5) and dedup reduce noise. Thresholds tuned on the eval set with results recorded. The demo uses reference clips whose result has been **measured**, never assumed. The baseline is labelled as such. | M2, M4, M9 |
| R4 | **Model licence/provenance unclear** (AGPL Ultralytics, unknown community weights) | M | M | Weights source without licence or dataset info | Only weights with a documented source. Train on D-Fire ourselves if needed. Apache-2.0 alternative. Heuristic fallback. | M2 |
| R5 | **Processing too slow / OOM on free host** (CPU-only, 512 MB) | M | H | M1 spike peak RSS > 400 MB or > 90 s for 60 s clip | ONNX Runtime instead of PyTorch. Downscale to 640. 2 fps (can drop to 1). Single worker. Max 120 s clips. Move to a larger instance or HF Spaces if needed. | M1 |
| R6 | **Host kills background work / sleeps** (CPU throttled after response, idle sleep, ephemeral disk) | M | H | Spike job stalls after 202 response | Verified in M1. Avoid hosts that throttle. DB-backed jobs with restart recovery. Evidence stored in DB (no disk dependency). Warm-up ping before demo. | M1, M10 |
| R7 | **Upload size limits** at proxy (Vercel ~4.5 MB for serverless bodies; host proxy limits) | M | M | 413 from proxy in spike | Upload goes browser → API directly. Measure real limit. Lower `MAX_UPLOAD_MB`. Samples need no upload. | M1 |
| R8 | **Video codec issues** (H.265/HEVC phone clips not decodable by OpenCV wheels) | M | M | `VIDEO_UNREADABLE` on team phone clips | Document "H.264 MP4 recommended". Provide ffmpeg one-liner in README. Samples pre-transcoded. | M4 |
| R9 | **Email deliverability** (spam folder, provider requires domain verification, free-tier restrictions) | M | M | S-Notify test lands in spam / is rejected | Controlled recipient is the team's own inbox (matches provider sandbox rules). Webhook channel as second path. Console provider for offline demo. | M2 |
| R10 | **Ack link pre-fetched by email scanners** acknowledging automatically | M | M | Ack recorded without a click | GET never mutates. POST only (already designed). | M5 |
| R11 | **Notification abuse on public deployment** (anyone triggers emails) | L | M | Unexpected notifications in logs | Operator key required. Server-side recipient allowlist only. Per-incident and per-hour limits. | M5 |
| R12 | **Routing provider policy/quota/outage** (OSRM demo has no SLA) | M | L | Timeouts in S-Routing | Straight-line fallback always available and labelled. Results cached per incident. Routing never blocks the flow. | M2, M8 |
| R13 | **Unverified station data mistaken for real** | M | H | Judge or user reads station as authoritative | Provenance badge everywhere. "Availability unknown". No phone numbers stored. TEST messaging. | M3, M6 |
| R14 | **Sample footage licensing** | M | M | Clip source without explicit licence | Only clips with documented licence in SOURCES.md. Otherwise record our own controlled clips. Don't commit clips that aren't redistributable. | M2 |
| R15 | **Python 3.14 locally vs wheel availability** | M | L | `uv sync` fails building cv2/onnxruntime | Pin 3.12 via uv (`.python-version`). Docker uses 3.12. | M1 |
| R16 | **Scope creep** (police/ambulance, live CCTV, LLM features) | M | H | Tasks appear outside fire MVP | Rules.md prohibition. Deferred list. Nothing optional before M7 DONE. | all |
| R17 | **Free-tier DB limits / cold start** (Neon suspends compute) | L | M | First request slow | Warm-up in demo procedure. Pool pre-ping. SQLite-on-volume fallback if the host supports volumes. | M1, M10 |
| R18 | **Deadline slip** (date not yet known) | M | H | M7 not DONE by ~60% of available time | VS1-first ordering. Spikes time-boxed with fallbacks. Record a backup demo video once M7 is DONE. | all |
