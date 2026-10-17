# PehRadar — Tracker

**Last updated:** 2026-10-17
**Current milestone:** M1d — Video-processing feasibility spike (IN_PROGRESS: Render measured 2026-10-17, verdict GO WITH LIMITS. To close: one 60 s run, the `CV runtime check OK` log line, and spike flags off.)
**Last completed:** M1b — GitHub + lightweight deployment (DONE 2026-10-17)
**Statuses:** `TODO` · `IN_PROGRESS` · `BLOCKED` · `DONE` (DONE only with recorded verification, per `Rules.md` §8)

> Only the scaffold exists, deployed: `GET /api/v1/health` and a status page. No detection, database, map, incidents or notifications have been built.

| Track | Status |
|---|---|
| M1a local scaffold | **DONE** |
| GitHub repository | **DONE** (`origin/main` = `e23e4eb`) |
| CI workflow | **DONE** (green on GitHub, user-reported 2026-10-17) |
| API deployment preparation (Render config) | **DONE** |
| API deployment on Render | **DONE**: https://pehradar-detect-earlier-verify-faster.onrender.com/api/v1/health |
| Vercel deployment | **DONE**: https://pehradar-detect-earlier-verify-fast.vercel.app/ (shows "Connected") |
| OpenCV + ONNX Runtime (CPU) installed locally | **DONE** (M1c, 23 tests pass) |
| OpenCV + ONNX Runtime on Render | User reported it as "verified enough to proceed" in the M1d brief. **No Render log recorded yet**; the M1d deploy collects it. |
| Video decode/sampling + test upload endpoint | **Local DONE** (35 tests pass). **Render: works** (`ef27550`). Two real 11.7 s clips processed, peak RSS 145 MB. |
| Fire/smoke detector, model weights, real upload/jobs API | **NOT STARTED** |

Deployed URLs live here and in the hosts' env settings only. None is hard-coded in application code.

---

## Exact next task

**Close M1c/M1d (user, about 2 min):**
1. Upload one 60 s clip, e.g. the 480p 15 fps test clip.
2. Copy the `CV runtime check OK` line from the Render logs.
3. Set `VIDEO_TEST_ENABLED=false` and `CV_RUNTIME_CHECK=false`.

After that: **M2-S1 (model spike)**, which must measure inference ms/frame on Render (see K9).

## Milestone summary

| Milestone | Status | Depends on | Acceptance (summary; full in ImplementationPlan.md §2) |
|---|---|---|---|
| M0 Foundation & docs | DONE | — | Eight docs consistent; user reviewed and started M1 (2026-10-17) |
| M1a Local scaffold | DONE | M0 | API + web tests, lint, typecheck, build pass; browser↔API CORS verified (see M1a below) |
| M1b GitHub + lightweight deployment | DONE | M1a | Public health 200 with `pehradar-api`; survives redeploy; clean logs; deployed web "Connected" with restricted CORS; CI green |
| M1c CV runtime feasibility spike | IN_PROGRESS | M1b | OpenCV headless + ONNX Runtime CPU install and run locally **and** on Render; versions, providers and RSS recorded |
| M1d Video-processing feasibility spike | IN_PROGRESS | M1c | 60 s clip uploaded and processed synchronously on Render with wall time and RSS recorded; limits and go/no-go recorded; DB decision recorded |
| M2 Technical spikes | TODO | M1b | Q2–Q6 decided or fallback adopted, with evidence |
| M3 Backend domain core | TODO | M1a | Migration matches Schema.md; domain unit tests cover state table + dedup table; read endpoints tested |
| M4 Detection pipeline & jobs | TODO | M3 | AC-03, AC-04, AC-05, AC-08, AC-17 (pytest) |
| M5 Review/incident/notify/ack API | TODO | M3 | AC-06, 07, 09, 10, 11, 12, 13, 18 (pytest) |
| M6 Frontend vertical slice | TODO | M3 | VS1 script passes locally (manual), Vitest passes |
| M7 VS1 integration + deploy ★ | TODO | M4, M5, M6 | AC-01, 02, 04, 06, 07, 09, 10, 12, 13, 15, 16; Playwright passes |
| M8 Routing & route display | TODO | M7, S-Routing | AC-14 |
| M9 Model upgrade & design polish | TODO | M7 | Detector choice backed by EVALUATION.md; audio/keyboard/3D/contrast verified |
| M10 Hardening & demo readiness | TODO | M8, M9 | All AC-01…AC-18 verified; no open P0 bugs |

## M0 — Foundation & documentation (DONE)

| ID | Task | Status | Verification |
|---|---|---|---|
| M0-T1 | Inspect workspace | DONE | 2026-10-17: `D:\AI LEARNING\CODE-CONNECT-2026` was empty (no files, not a git repo). Toolchain present: git 2.55.0, Python 3.14.7, Node 24.19.0, npm 12.0.2. |
| M0-T2…T8 | Eight planning documents | DONE | Files created and cross-checked |
| M0-T9 | User review and approval of docs | DONE | User reviewed the report and started M1 (2026-10-17). Q7/Q8 still open. |

## M1a — Local monorepo scaffold (DONE)

**Acceptance criteria (all verified 2026-10-17, evidence in the Verification log):**
1. API `GET /api/v1/health` returns `{"status":"ok","app":"pehradar-api","version":"0.1.0"}`. ✔
2. CORS comes from `CORS_ORIGINS`: allowed origin gets `Access-Control-Allow-Origin`, unlisted origin does not, `*` is rejected at startup, production requires https. ✔
3. Web reads `NEXT_PUBLIC_API_BASE_URL`, fetches health from the browser, and shows loading / connected / disconnected / not-configured states. ✔
4. Backend tests, frontend tests, lint, typecheck and production build pass. ✔

| ID | Task | Status | Evidence |
|---|---|---|---|
| M1a-T1 | `git init -b main`; root `.gitignore`; README | DONE | Committed by the user as `39f0ea3` ("M1a: scaffold PEHRADAR web and API applications"), 56 files. `.gitignore` video rule widened to all paths before commit. |
| M1a-T2 | Python 3.12 via uv | DONE | 3.12 was not installed (only 3.11/3.13/3.14). Ran `uv python install 3.12`, which installed 3.12.15 (uv-managed, system Python untouched). |
| M1a-T3 | `apps/api` FastAPI scaffold: app factory, settings, health router, package skeleton | DONE | `pyproject.toml` + `uv.lock`; `uv sync --locked` OK |
| M1a-T4 | API tests (health, CORS allow/deny/preflight, config validation, prod docs disabled) | DONE | `uv run pytest`: **15 passed** |
| M1a-T5 | `apps/web` Next.js 16.3.8 + TS + Tailwind 4 status page, API client, Vitest | DONE | `npm test`: **9 passed (2 files)** |
| M1a-T6 | Local integration through real browser CORS | DONE | Headless Chrome against `next start` (:3000) + uvicorn (:8000): DOM showed "Connected" / "pehradar-api v0.1.0". From unlisted origin :3001: "Disconnected / Cannot reach the API (… CORS blocked)". With API stopped: "Disconnected" + "Retry now". |
| M1a-T7 | Docs: README (root, api, web), Techspec (health path, pinned versions), ImplementationPlan (M1 split) | DONE | — |

## M1b — GitHub + lightweight deployment (DONE 2026-10-17)

Scope set by the user at M1b kickoff: **no OpenCV, ONNX, video processing, DB, incidents, map, notifications or UI redesign.** Those checks moved to M1c.

**Acceptance criteria.** "User" means the user reported it. "Claude" means Claude checked it independently on 2026-10-17.
1. Public API URL is reachable and `GET /api/v1/health` returns **HTTP 200**. **PASS** (user + Claude)
2. The response body is `{"status":"ok","app":"pehradar-api","version":"0.1.0"}`. **PASS** (user + Claude)
3. It still returns 200 after a fresh deploy or restart. **PASS** (user: clear-cache redeploy)
4. Production logs show no unexplained startup errors. **PASS** (user: "None, everything is ok". The raw log was not shared.)
5. The deployed URL is recorded here (Tracker) only, never hard-coded in application code. **PASS**
6. The deployed web page shows "Connected", with `CORS_ORIGINS` set to the Vercel origin only. **PASS** (user: browser shows Connected. Claude: the Vercel origin gets ACAO and `https://evil.example` gets none.)
7. CI is green on GitHub. **PASS** (user)

| ID | Task | Status | Notes / evidence |
|---|---|---|---|
| M1b-T1 | GitHub repository and push | DONE | 2026-10-17: branch `main` tracks `origin` = `github.com/hasnain0122E/PEHRADAR---Detect-earlier.-Verify-faster.-Respond-smarter.`. `git ls-remote origin` shows `refs/heads/main` = `39f0ea3` = local HEAD. Working tree clean. 56 tracked files. No `.env`/`.env.local`, venv, `node_modules`, build output, video, weights, DB or key files tracked (only the two `.env.example`). |
| M1b-T2 | GitHub Actions CI (`.github/workflows/ci.yml`) | DONE | `actionlint` passes locally. Actions pinned to SHAs (checkout v7.0.1, setup-node v7.0.0, setup-uv v10.2.0; all ≥ 2 weeks old). Pushed in `e23e4eb`. User reported CI **PASS** on GitHub. |
| M1b-T3 | Production CORS without a wildcard | DONE | `CORS_ORIGINS` unset or empty in production means no browser origins. 2 new tests. `uv run pytest`: **16 passed**. Ruff clean. |
| M1b-T4 | Render configuration prepared and rehearsed | DONE | README → Deployment. Rehearsal in a clean copy of the tracked files with Render's uv 0.12.24: `uv lock --check` OK, `uv sync --locked --no-dev` OK (pytest absent), start command with `PORT=10000 APP_ENV=production` bound `0.0.0.0:10000`, health 200 `pehradar-api`, `/api/v1/docs` 404, no ACAO header for a browser origin, startup log clean. **This is a local rehearsal, not a deployment.** |
| M1b-T5 | Deploy API on Render (user, manual) | DONE | `https://pehradar-detect-earlier-verify-faster.onrender.com`. User's `curl -i /api/v1/health`: `HTTP/1.1 200 OK`, `x-render-origin-server: uvicorn`, body `{"status":"ok","app":"pehradar-api","version":"0.1.0"}`. |
| M1b-T6 | Verify redeploy/restart + logs | DONE | User reported clear-build-cache redeploy **PASS**, with no warnings or errors. The deploy log text was not shared, so the exact Python patch Render used is not recorded. |
| M1b-T7 | Deploy web on Vercel; set Render `CORS_ORIGINS` to the Vercel origin | DONE | `https://pehradar-detect-earlier-verify-fast.vercel.app/`. User reported the browser shows "Connected". Claude confirmed Render returns `access-control-allow-origin` for the Vercel origin only. |
| M1b-T8 | Record real URLs and results here | DONE | This section and the Verification log |

**Deployment status:** the API (Render) and web (Vercel) are both live with the health check and status page only.

## M1c — CV runtime feasibility spike (IN_PROGRESS)

Scope set by the user's M1c brief: add only `opencv-python-headless` and `onnxruntime`. **No detector, weights, upload, incidents, DB, frontend, map or notifications.** The verified production flow (health check and Vercel connection) must not be disturbed.

| ID | Task | Status | Notes / evidence |
|---|---|---|---|
| M1c-T1 | Dependency assessment | DONE | See Techspec §2 and §10 Stage 2 for versions and rationale. Wheels exist for cp312 Linux x86_64, so nothing compiles from source. ONNX Runtime 1.30's Linux wheel is `manylinux_2_28` only (glibc ≥ 2.28). |
| M1c-T2 | Add runtime deps via uv; update `uv.lock` | DONE | Direct: `opencv-python-headless>=4.14.0.94,<4.15`, `onnxruntime>=1.30.0,<1.31`. Lock: 4.14.0.94, 1.30.0, numpy 2.5.3 (pinned down from 2.5.4, under 2 weeks old), protobuf 7.36.2, flatbuffers 25.12.19. `uv lock --check` passes with Render's uv 0.12.24. numpy is used directly only by the self-check and is pulled in by both packages, so it is not declared separately. |
| M1c-T3 | Runtime self-check | DONE | `app/detection/runtime_check.py`, with `tests/test_cv_runtime.py` (7 tests). It checks: cv2 import/version, numpy, cvtColor/resize/JPEG round trip, CPU provider present, and inference of an in-memory `Add` graph on `CPUExecutionProvider` only. It also asserts that no GPU provider is used. It runs at startup only with `CV_RUNTIME_CHECK=true` (default false) and logs one line. There is no endpoint. CV libraries are not imported when the flag is off (verified via `sys.modules`). |
| M1c-T4 | Local verification | DONE | `uv sync --locked`: OK. `uv run pytest`: **23 passed**. `ruff check`: all passed. `ruff format --check`: 21 files formatted. `python -m app.detection.runtime_check`: opencv 4.14.0, numpy 2.5.3, onnxruntime 1.30.0, providers `['AzureExecutionProvider', 'CPUExecutionProvider']`, session `['CPUExecutionProvider']`. |
| M1c-T5 | Deployment impact (measured) | DONE | Clean Linux-wheel install (no cache, `--only-binary :all:`, uv 0.12.24): **35 → 315 MB** installed, about 100 MB downloaded. Only base system libraries are needed, plus libz. Windows working set: API 43 MB, then **77 MB** with cv2+ort imported and **85 MB** after the check. Imports take about 0.25 s. Linux RSS is still to be measured on Render. Download time on this machine (home connection) was about 3.5 min and is not representative of Render. |
| M1c-T6 | Render redeploy (user, manual) | NOT STARTED | Merged into M1d-T6 (same deploy). Build and start commands are **unchanged**. For this deploy only, add env `CV_RUNTIME_CHECK=true`. Evidence needed: <br>(a) build log lines showing the 5 new packages installed and no "Building" lines; <br>(b) startup log line `CV runtime check OK: …` with `rss_mb`/`peak_rss_mb`; <br>(c) `curl -i …/api/v1/health` 200; <br>(d) Vercel page still "Connected"; <br>(e) build duration. |
| M1c-T7 | Turn the startup check off | NOT STARTED | After T6: set `CV_RUNTIME_CHECK=false` (or delete it) on Render. The code is removed when M4 adds the real detector startup checks. |
| M1c-T8 | Mark M1c DONE | NOT STARTED | Only after T6 and T7 pass |

**Fallback if Render fails** (implement only if needed):
1. Another package version. For example, ONNX Runtime 1.28.0 also ships `manylinux_2_27`, which needs a slightly older glibc. OpenCV 4.13.0.92 is the previous release.
2. A different Python 3.12 patch, if the failure is interpreter-specific.
3. A CPU-only runtime change (for example, inference through OpenCV's DNN module instead of onnxruntime).
4. Docker (`python:3.12-slim`, non-root) on Render.
5. A hosted inference API, as a last resort.

## M1d — Video-processing feasibility spike (IN_PROGRESS)

Scope set by the user's M1d brief (time-critical, keep it small):
- **Not in scope:** detector, model, dashboard, map, notifications, incident lifecycle.
- **No new infrastructure:** no queue or job framework, WebSockets, Docker, cloud storage or database.

| ID | Task | Status | Notes / evidence |
|---|---|---|---|
| M1d-T1 | Video decode/sampling utility | DONE | `app/detection/video.py`. Reads width, height, fps, frame count and duration. Samples at `VIDEO_SAMPLE_FPS` using `grab()` for every frame and `retrieve()` only for sampled ones. Frames are processed incrementally (none kept). One decoder thread. `VideoCapture` is released in `finally`. Enforces `VIDEO_MAX_SECONDS` on metadata and on real frames. 4 unit tests use an in-test 3 s generated clip, including that the file can be deleted after processing. |
| M1d-T2 | Benchmark command | DONE | `python -m app.detection.benchmark`. Results are in Techspec §10 Stage 3 and the Verification log. |
| M1d-T3 | `POST /api/v1/video/test` | DONE | Mounted only with `VIDEO_TEST_ENABLED=true` (404 otherwise). Behaviour: <br>• `Content-Length` required (411) and capped at `VIDEO_TEST_MAX_MB`=20 before the body is read (413). <br>• One request at a time (409). <br>• `.mp4` and the `ftyp` signature required (415). <br>• Written to a server-named temp file that is always deleted. <br>• Undecodable or too long → 422. <br>8 endpoint tests. One new dependency, `python-multipart` 0.0.32 (released 2026-06-04), which FastAPI needs to read form uploads. |
| M1d-T4 | Sync vs background decision | DONE (provisional) | Synchronous, see D23 |
| M1d-T5 | Database decision | DONE (recommendation) | See D24 |
| M1d-T6 | Render test (user, manual) | DONE (partial: clips were 11.7 s, not 30–60 s) | 2026-10-17, user's PowerShell `curl.exe` against the deployed endpoint, two real stock clips (60 fps, 704 frames, 11.733 s, git-ignored in `sample_video/`): <br>• **960×540**, 4.25 MB: HTTP 200, request 14.11 s, processing **7.29 s**, CPU 1.10 s, 24 sampled, RSS before / during / after / peak **119.0 / 136.1 / 134.7 / 136.7 MB**. <br>• **1280×720**, 8.12 MB: HTTP 200, request 20.62 s, processing **13.30 s**, CPU 1.99 s, 24 sampled, RSS **128.4 / 145.4 / 142.7 / 144.5 MB**. <br>Not yet captured: the 60 s run, the 1080p → 413 check, the `CV runtime check OK` log line, and the Metrics graphs. Original plan for this task: set `CV_RUNTIME_CHECK=true` and `VIDEO_TEST_ENABLED=true`, deploy, and run the PowerShell curl commands from the M1d report. Capture: <br>(a) the `CV runtime check OK` log line; <br>(b) the JSON from the 720p, 480p15 and 360p15 uploads; <br>(c) the 1080p → 413 response; <br>(d) Render Metrics memory and CPU graphs during the uploads; <br>(e) any `Out of memory` or `502`/`503`/timeout. |
| M1d-T7 | Turn spike flags off | NOT STARTED | After T6, set `VIDEO_TEST_ENABLED=false` and `CV_RUNTIME_CHECK=false`. |
| M1d-T8 | Final go/no-go, then mark M1d (and M1c) DONE | IN_PROGRESS | Verdict **GO WITH LIMITS**, now based on Render data (D25). M1d is DONE after the 60 s run and T7. M1c is DONE after the log line. |

**Render analysis (derived from the two runs above):**
- **CPU share:** CPU ÷ wall = 1.095 ÷ 7.29 = **15.0 %**, and 1.993 ÷ 13.30 = **15.0 %**. The instance effectively gets about 0.15 of one core.
- **Decode cost is linear in pixels per frame:** 10.4 ms/frame at 540p (20.0 ns/px) and 18.9 ms/frame at 720p (20.5 ns/px).
- **Extrapolated decode time for a 60 s clip** (≈ 20 ns/px × pixels × frames; not measured):

  | Clip | Decode time |
  |---|---|
  | 720p60 | ~68 s |
  | 720p30 | ~34 s |
  | 540p30 | ~19 s |
  | 480p15 | ~7.5 s |
  | 360p15 | ~4 s |

- **Network:** request minus processing was 6.8 s for 4.2 MB and 7.3 s for 8.1 MB, so this connection uploads at about 0.6–1.1 MB/s.
- **Memory:** 119–128 MB idle, peak **145 MB**, which leaves about **367 MB (72 %)** of 512 MB for the model. RSS before the second request (128.4) was below RSS after the first (134.7), so there's no sign of growth. Two requests are thin evidence.

## M2 — Technical spikes

| ID | Task | Status | Fallback |
|---|---|---|---|
| M2-S1 | S-Model: candidate weights, licence, ONNX, eval vs heuristic → `models/EVALUATION.md` | TODO | Heuristic baseline |
| M2-S2 | S-Samples: ≥ 4 positive + ≥ 4 negative licensed clips, manifest, SOURCES.md | TODO | Self-recorded / synthetic |
| M2-S3 | S-Map: tile style, Karachi z11/z15 check, building coverage notes | TODO | MapTiler; 2D only |
| M2-S4 | S-Routing: provider, sample route, latency, policy | TODO | Straight line |
| M2-S5 | S-Notify: one real email + one webhook to demo recipient | TODO | Webhook + console |
| M2-S6 | S-Stations: Overpass export → `seed/stations.json` with provenance | TODO | Manual PUBLIC_WEB entries |

## M3–M10

The tasks are defined in `ImplementationPlan.md` §2. They will be broken into tracked tasks here when each milestone starts, so this list does not go stale. All are **TODO**.

## Decisions

| ID | Decision | Status | Evidence / date |
|---|---|---|---|
| D1 | Monorepo `apps/web` + `apps/api`, no monorepo tool | CONFIRMED | Techspec §2, 2026-10-17 |
| D2 | Python 3.12 via uv (not local 3.14) | CONFIRMED | Installed 3.12.15 with `uv python install 3.12`, 2026-10-17 |
| D3 | SQLite dev/test, Postgres deployed, portable schema | CONFIRMED (deployed provider in Q1) | Techspec §2, §11 |
| D4 | Evidence JPEGs stored in DB | CONFIRMED | Techspec §2 |
| D5 | Polling (3 s / 1 s), no SSE in MVP | CONFIRMED | Techspec §2 |
| D6 | In-process single worker thread, DB-backed jobs | CONFIRMED (background-thread behaviour on host to verify in M1d) | Techspec §5.3 |
| D7 | ONNX Runtime for inference; heuristic baseline always available | CONFIRMED | Techspec §4 |
| D8 | MapLibre GL; 2D required, 3D optional; Cesium/Google 3D rejected for MVP | CONFIRMED | Techspec §7.2 |
| D9 | Server-side recipient allowlist; client sends `recipient_key` only | CONFIRMED | Techspec §6 |
| D10 | Ack via explicit POST only | CONFIRMED | Appflow §2.7 |
| D11 | Rejection never auto-suppresses later detections | CONFIRMED | PRD FR-17 |
| D12 | Health endpoint is `/api/v1/health` (was `/health` in Techspec) | CONFIRMED | User request at M1 kickoff; Techspec §3.1 updated |
| D13 | M1 split into M1a (local scaffold, no heavy deps) and M1b (GitHub + deploy spike) | CONFIRMED | User excluded OpenCV/ONNX from the scaffold; ImplementationPlan updated |
| D14 | Web has no fallback API URL; missing `NEXT_PUBLIC_API_BASE_URL` shows "Not configured" | CONFIRMED | Avoids silently calling a guessed host |
| D15 | Only dependency versions ≥ 2 weeks old (`npm install --before=…`); Next 16.3.8 rather than 16.4.x | CONFIRMED | Supply-chain caution; Techspec §2 |
| D16 | Render native Python + uv (no Docker) for the lightweight API deploy; explicit `PYTHON_VERSION=3.12.15`, `UV_VERSION=0.12.24` | CONFIRMED (deployed and healthy 2026-10-17) | Render docs (python-version, uv-version) checked 2026-10-17; uv 0.12.24 verified against `uv.lock` locally |
| D17 | Production `CORS_ORIGINS` unset or empty means no browser origins; never `*` | CONFIRMED | Lets the API go live before the Vercel origin exists without opening CORS |
| D18 | M1b reduced to the lightweight deploy; OpenCV/ONNX/clip-decode/Neon moved to new M1c | CONFIRMED | User scope rule at M1b kickoff |
| D19 | M1c limited to the CV runtime only; clip decode, upload limit, background thread, Neon and Q1 moved to new M1d | CONFIRMED | User's M1c brief |
| D20 | `opencv-python-headless` 4.14.0.94 + `onnxruntime` 1.30.0 (CPU), installed natively on Render (no Docker) | CONFIRMED locally; Render pending | M1c-T1…T5 |
| D22 | Decode with one FFmpeg thread (`CAP_PROP_N_THREADS=1`), sequential `grab()` and `retrieve()` only for sampled frames | CONFIRMED locally | Same decode work, about 2.7× less CPU overhead and about half the RSS of auto-threading. Verification log, 2026-10-17. |
| D23 | Process uploads **synchronously** (upload → process → result) for the hackathon. No queue or worker. | CONFIRMED for decode (Render 2026-10-17); re-check after M2-S1 inference timing | Local decode of a 60 s clip takes 0.6–3 s. Revisit only if Render decode **plus** M2-S1's measured inference exceeds about 30 s for a 60 s demo clip. The fallback is the already-designed single in-process thread (Techspec §5.3), still with no framework. |
| D24 | DB: **SQLite for local dev/tests and Neon Postgres for the deployed app, added at the start of M3** (not in M1d) | RECOMMENDED | Render's free filesystem is ephemeral (lost on redeploy/restart and on spin-down), so deployed SQLite would wipe judge-created incidents. Neon free tier needs no card, and setup is about 15 min: `DATABASE_URL` env, SQLAlchemy + Alembic (already planned, D3). Cameras and stations are re-seeded idempotently on startup. Render's own free Postgres expires after 30 days, so it is not used. |
| D25 | M1d verdict: **GO WITH LIMITS** | CONFIRMED on Render data (2026-10-17) | Limits: <br>• Demo clips **≤ 30 s recommended, 60 s maximum**. <br>• **Pre-transcoded to H.264 MP4 at ≤ 854×480 and 15 fps** (`ffmpeg -i in.mp4 -vf scale=-2:480 -r 15 -c:v libx264 -an out.mp4`). <br>• Upload cap stays **20 MB**; demo files are realistically ≤ 10 MB because of upload speed. <br>• **2 fps sampling** (1 fps if inference is slow). <br>• Synchronous processing. <br>• 720p60 phone footage must be transcoded first: decode alone would be about 1.1× realtime. |
| D21 | Host runtime evidence comes from an env-gated startup log line (`CV_RUNTIME_CHECK`), not a diagnostic endpoint | CONFIRMED | Free tier has no shell. No public diagnostics. A failed check fails the deploy and Render keeps the previous one live. |

## Decisions pending

| ID | Question | Resolved by | Status |
|---|---|---|---|
| Q1 | API host for the **heavy** workload (Render / Railway / Fly / HF Spaces) and deployed DB (Neon vs SQLite on volume). Render is the lightweight-deploy host (D16). | M1d | DB part: D24 recommends Neon in M3. Host part: pending the M1d-T6 Render numbers. |
| Q2 | Fire/smoke model choice and licence (AGPL acceptable?) | M2-S1 | TODO |
| Q3 | Tile source (OpenFreeMap vs MapTiler) and 3D data quality | M2-S3 | TODO |
| Q4 | Routing provider | M2-S4 | TODO |
| Q5 | Email provider (Resend vs SMTP) and webhook demo target | M2-S5 | TODO |
| Q6 | Sample clip sources | M2-S2 | TODO |
| Q7 | Hackathon deadline date, team size, whether judges use the deployed app themselves, hosting accounts available | User | TODO |
| Q8 | Product name: "Aegis" or "PehRadar"? | User | RESOLVED 2026-10-17: **PEHRADAR** (user's M1a commit and M1b brief). Code displays "PehRadar" (`PRODUCT_NAME`); all-caps display is a one-line change if wanted. |

## Blockers

| ID | Blocker | Affects | Status |
|---|---|---|---|
| B1 | M0 review/approval needed before implementation | M1 | RESOLVED 2026-10-17 |
| B2 | GitHub repo URL needed for M1b-T1/T2 | M1b | RESOLVED 2026-10-17 |
| B3 | Render and Vercel deploys need the user's accounts (Claude cannot authorize them) | M1b-T5…T7 | RESOLVED 2026-10-17 (user deployed both) |

## Known bugs / issues

| ID | Issue | Severity | Status |
|---|---|---|---|
| K1 | `npm audit`: 5 high findings, all from one advisory (`braces` stack-exhaustion DoS, GHSA-vfj7-8cjw-p6xm) reached via `eslint-config-next` → `@next/eslint-plugin-next` → `fast-glob` → `micromatch`. **Dev-time lint tooling only, not in the shipped bundle.** npm's only "fix" downgrades to `eslint-config-next@14`, which is wrong for Next 16. | Low (dev only) | OPEN. Re-check when a patched `eslint-config-next` is ≥ 2 weeks old. |
| K2 | npm 12 blocked the `unrs-resolver@1.12.2` postinstall script (not in allowScripts). ESLint runs fine without it (exit 0). CI's Node 24 ships its own npm, which may run the script. | Low | OPEN. Approve with `npm install-scripts approve unrs-resolver` only if lint breaks. |
| K3 | Render free tier sleeps when idle. The first request after sleep can take tens of seconds, longer than the web client's 5 s timeout, so the status page may briefly show "Disconnected" until the next 15 s poll. | Low (expected) | OPEN. Warm up with a health request before demos. |
| K4 | Vercel preview deployments have per-deployment origins that are not in `CORS_ORIGINS`, so previews show "Disconnected". Only the production origin is allowed. | Low (by design) | OPEN. Add specific preview origins only if needed. |
| K5 | The API environment grew from 35 MB to 315 MB, so Render builds and cold starts will be slower. On the free tier (512 MB RAM), CV imports cost about 35–42 MB (Windows measurement). Real decode/inference memory is unmeasured until M1d. | Medium | OPEN. Measure on Render in M1c-T6 and M1d. |
| K7 | Decode cost scales with resolution × **source** frame rate, not the sample rate, because every H.264 frame must be decoded. **Measured on Render:** about 20 ns per pixel per frame at about 0.15 CPU, so 720p60 decodes at about 1.1× realtime. | Medium | MITIGATED by D25. Pre-transcode demo clips to ≤ 480p 15 fps. |
| K9 | **Inference will likely dominate on Render.** At 0.15 CPU, every 100 ms of full-core model time becomes about 0.67 s per sampled frame. That is about 40 s for 60 sampled frames (30 s at 2 fps). This is arithmetic, not a measurement. | High | OPEN. M2-S1 must measure ms/frame on Render. Options: 1 fps sampling, smaller input (e.g. 320 px), a smaller model, or Render Starter (paid, more CPU) if the demo needs it. |
| K8 | Starlette spools the multipart upload to a temp file, then the endpoint copies it to its own temp file, so the upload is briefly on disk twice (≤ 40 MB at the 20 MB cap). | Low | Accepted for the spike |
| K6 | ONNX Runtime 1.30 has no `manylinux_2_17` wheel. A host with glibc < 2.28 would fail to install it. | Low | OPEN until the Render build succeeds |

## Verification log

| Date | Item | Command / method | Result |
|---|---|---|---|
| 2026-10-17 | Workspace inspection | `ls -la`, `find`, tool `--version` | Empty directory; toolchain versions as in M0-T1 |
| 2026-10-17 | M1 pre-check | `git status`, `uv --version`, `py -0p`, md5 of docs | Not a repo; uv 0.13.0; Python 3.11/3.13/3.14 only (no 3.12); docs unchanged since M0 |
| 2026-10-17 | API deps reproducible | `uv sync --locked` | OK (33 packages resolved, Python 3.12.15) |
| 2026-10-17 | API tests | `uv run pytest` | **15 passed**, 0 failed, 0 skipped, no warnings |
| 2026-10-17 | API lint | `uv run ruff check .` · `uv run ruff format --check .` | All checks passed · 19 files already formatted |
| 2026-10-17 | Web clean install | `rm -rf node_modules .next; npm ci` | added 442 packages |
| 2026-10-17 | Web tests | `npm test` (vitest run) | **9 passed** (2 files), 0 failed |
| 2026-10-17 | Web lint | `npx eslint` | exit 0, no findings |
| 2026-10-17 | Web typecheck | `npm run typecheck` (`next typegen && tsc --noEmit`) | OK |
| 2026-10-17 | Web production build | `npm run build` | Compiled successfully (Next 16.3.8 Turbopack); `/` static |
| 2026-10-17 | CORS headers | `curl` with `Origin` headers against uvicorn :8000 | Allowed origin → `access-control-allow-origin: http://localhost:3000`; `https://evil.example` → no ACAO header; preflight OK |
| 2026-10-17 | Browser integration | Headless Chrome `--dump-dom` / screenshot of `next start` :3000 | "Connected", "pehradar-api v0.1.0" rendered from a real cross-origin fetch |
| 2026-10-17 | CORS enforced in browser | Same page served from :3001 (not in `CORS_ORIGINS`) | "Disconnected — Cannot reach the API (offline, wrong URL, or CORS blocked)" |
| 2026-10-17 | API-down state | API process stopped, page reloaded | "Disconnected" + "Retry now" |
| 2026-10-17 | M1b git checkpoint | `git status`, `git branch -vv`, `git remote -v`, `git ls-remote origin`, `git ls-files` scan | Clean tree on `main`; `origin/main` = `39f0ea3`; no secrets/env/venv/node_modules/build/video/weights tracked |
| 2026-10-17 | API tests after CORS change | `uv run pytest` · `uv run ruff check .` · `uv run ruff format --check .` | **16 passed** · all checks passed · 19 files formatted |
| 2026-10-17 | Render uv compatibility | `uvx --from uv==0.12.24 uv lock --check` and `uv sync --locked --no-dev` in a clean copy | Lock OK; installs on Python 3.12.15; `pytest` not installed (dev excluded) |
| 2026-10-17 | Render start-command rehearsal (local, **not a deployment**) | `PORT=10000 APP_ENV=production uv run --no-sync uvicorn app.main:app --host 0.0.0.0 --port $PORT` | Listening `0.0.0.0:10000`; health 200 `{"status":"ok","app":"pehradar-api","version":"0.1.0"}`; `/api/v1/docs` 404; `/` 404; no ACAO header for a browser origin; startup log clean |
| 2026-10-17 | CI workflow lint | `uvx --from actionlint-py actionlint .github/workflows/ci.yml` | exit 0 |
| 2026-10-17 | CI on GitHub (commit `e23e4eb`) | GitHub Actions (user-reported) | PASS |
| 2026-10-17 | Render deploy + health | User: `curl -i …onrender.com/api/v1/health` | `HTTP/1.1 200 OK`, `x-render-origin-server: uvicorn`, expected JSON body |
| 2026-10-17 | Render clean-cache redeploy | User: Manual Deploy → Clear build cache & deploy | PASS; no warnings or errors reported (log text not shared) |
| 2026-10-17 | Vercel → Render in browser | User: opened the Vercel URL | PASS ("Connected") |
| 2026-10-17 | Independent check of live API | Claude: `curl -i` with `Origin` headers; `/api/v1/docs` | 200 + expected body; Vercel origin → `access-control-allow-origin: https://pehradar-detect-earlier-verify-fast.vercel.app`; `https://evil.example` → no ACAO; docs 404 |
| 2026-10-17 | M1c dependency add | `uv add …`; `uv lock --upgrade-package numpy==2.5.3`; `uv sync --locked` | 38 packages resolved. Added flatbuffers 25.12.19, numpy 2.5.3, onnxruntime 1.30.0, opencv-python-headless 4.14.0.94, protobuf 7.36.2 |
| 2026-10-17 | M1c lock vs Render's uv | `uvx --from uv==0.12.24 uv lock --check` | OK |
| 2026-10-17 | M1c API tests | `uv run pytest` · `ruff check .` · `ruff format --check .` | **23 passed** · all checks passed · 21 files formatted |
| 2026-10-17 | M1c import check | `uv run python -m app.detection.runtime_check` (Windows) | opencv 4.14.0, numpy 2.5.3, onnxruntime 1.30.0; available `['AzureExecutionProvider', 'CPUExecutionProvider']`; session `['CPUExecutionProvider']`; `Add` inference correct |
| 2026-10-17 | M1c Linux install (wheels only) | `uv pip install --no-cache --only-binary :all: --python-platform x86_64-manylinux_2_28 --python-version 3.12.15 --target …` (uv 0.12.24), before vs after | Before: 21 packages, 35 MB. After: 27 packages, **315 MB** (cv2 78, opencv libs 84, onnxruntime 62, numpy 57). No source builds. |
| 2026-10-17 | M1c system libraries | ELF `DT_NEEDED` of `cv2.abi3.so`, `onnxruntime_pybind11_state…so`, numpy core | Beyond bundled libraries, only base glibc libraries (libc, libm, libstdc++, libgcc_s, libdl, libpthread, librt) plus libz.so.1. No libGL/glib. |
| 2026-10-17 | M1c memory (Windows) | `GetProcessMemoryInfo` probe | API loaded 43 MB → cv2+ort imported 77 MB (0.21–0.28 s) → after check 85 MB |
| 2026-10-17 | M1c production-start rehearsal (local) | `APP_ENV=production CV_RUNTIME_CHECK=true uv run --no-sync uvicorn … --port 10001` | Log `CV runtime check OK: opencv=4.14.0 numpy=2.5.3 onnxruntime=1.30.0 …`, health 200. With the flag off, `cv2`/`onnxruntime` are not in `sys.modules`. |
| 2026-10-17 | M1d test clips (not committed) | ffmpeg `testsrc2`, 60 s, libx264 | 1080p30 28.7 MB, 720p30 10.8 MB, 480p15 5.7 MB, 360p30 4.3 MB, 360p15 3.6 MB (in the session scratchpad) |
| 2026-10-17 | M1d decode cost by threads | Probe script, fresh process per run, 2 fps sampling | Auto threads → 1 thread. 1080p: wall 2.66 → 7.04 s, CPU 20.1 → 7.0 s, peak 165 → 84 MB. 720p: wall 1.16 → 3.03 s, CPU 8.3 → 3.0 s, peak 104 → 58 MB. 480p15: CPU 2.0 → 1.0 s, peak 78 → 47 MB. 360p15: CPU 1.1 → 0.66 s, peak 68 → 44 MB. |
| 2026-10-17 | M1d benchmark command | `python -m app.detection.benchmark <720p> --sample-fps 2` (auto threads, before D22) | 1800 decoded, 120 sampled, 1.18–1.42 s, peak 107 MB. 1 fps: 60 sampled, 1.06 s. |
| 2026-10-17 | M1d API tests | `uv run pytest` · `ruff check .` · `ruff format --check .` | **35 passed** · all checks passed · 26 files formatted |
| 2026-10-17 | M1d endpoint rehearsal (local) | `APP_ENV=production VIDEO_TEST_ENABLED=true uvicorn …`; `curl -F file=@…` | 720p 60 s: HTTP 200 in 2.87, 2.92 and 3.04 s (processing 2.8–3.0 s, CPU 2.8–3.2 s). 480p15: 1.02 s. 360p15: 0.63 s. RSS before 63–72 MB, during ≤ 90 MB, after 72–74 MB, process peak 95 MB, flat across 5 uploads. 1080p 30 MB → 413 `UPLOAD_TOO_LARGE`. Chunked (no Content-Length) → 411. 0 temp files left. |
| 2026-10-17 | M1d Render endpoint test | User: `curl.exe -F file=@…` against `…onrender.com/api/v1/video/test` (commit `ef27550`) | 540p60 11.7 s: 200, processing 7.29 s, CPU 1.10 s, peak RSS 136.7 MB. 720p60 11.7 s: 200, processing 13.30 s, CPU 1.99 s, peak RSS 144.5 MB. Effective CPU share 15.0 % for both. |
| 2026-10-17 | Independent check of Vercel page | Claude: `curl -I` | 403 with `X-Vercel-Mitigated: challenge`. Vercel bot protection blocks non-browser clients. This is not a deployment fault. |
