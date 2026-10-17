# PehRadar — Tracker

**Last updated:** 2026-10-17
**Current milestone:** M4 — Fire Department command center (IN_PROGRESS: built and verified locally; Vercel deploy pending). M3 is still IN_PROGRESS: code committed (`45558c3`), but no Neon/Render evidence has been recorded yet.
**Last completed:** M2 — Fire/smoke detection MVP (DONE, verified on Render 2026-10-17; frozen per the user's M3 brief). Before that: M1 (M1a–M1d). M1c/M1d were accepted by the user in the M2 brief ("M1 is complete"). Two evidence items were never recorded; see M1c-T6 and M1d-T6.
**Statuses:** `TODO` · `IN_PROGRESS` · `BLOCKED` · `DONE` (DONE only with recorded verification, per `Rules.md` §8)

> **Deployed:** health and `POST /api/v1/detect/fire` (live on Render).
> **Built and verified locally, not yet deployed:**
> - the M3 database and incident API;
> - the M4 command-center dashboard (map, queues, upload, review, incidents).
>
> **Not built:** notifications and routing.

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
| Fire/smoke detection endpoint (M2) | **DONE on Render** (`b63863e`, CI green). Three 30 s clips: same decisions as locally, 12.8–14.8 s processing, peak RSS ≤ 178.5 MB. |
| Database + operational API (M3) | **Local DONE** (109 tests; end-to-end rehearsal on SQLite with the real model). **Neon NOT CONNECTED**; Render not yet redeployed. |
| Command-center dashboard + map (M4) | **Local DONE** (48 web tests; real-browser end-to-end against the local API with the real model). **Vercel NOT redeployed.** |
| Notifications, acknowledgement, routing | **NOT STARTED** |

Deployed URLs live here and in the hosts' env settings only. None is hard-coded in application code.

---

## Exact next task

1. **M3-T10/T11 (user):** Neon + Render deploy and the persistence check (steps in the M3 report), if not done yet.
2. **M4-T13 (user):** on Vercel, set `OPERATOR_API_KEY` (server-only, same value as Render), redeploy, and run the browser flow (steps in the M4 report).

M4 is marked DONE only after step 2's evidence is recorded.

Still open: Q2 (AGPL acceptance) and the demo clip choice.

## Milestone summary

| Milestone | Status | Depends on | Acceptance (summary; full in ImplementationPlan.md §2) |
|---|---|---|---|
| M0 Foundation & docs | DONE | — | Eight docs consistent; user reviewed and started M1 (2026-10-17) |
| M1a Local scaffold | DONE | M0 | API + web tests, lint, typecheck, build pass; browser↔API CORS verified (see M1a below) |
| M1b GitHub + lightweight deployment | DONE | M1a | Public health 200 with `pehradar-api`; survives redeploy; clean logs; deployed web "Connected" with restricted CORS; CI green |
| M1c CV runtime feasibility spike | DONE (user-accepted 2026-10-17) | M1b | OpenCV headless + ONNX Runtime CPU install and run locally **and** on Render; versions, providers and RSS recorded |
| M1d Video-processing feasibility spike | DONE (user-accepted 2026-10-17) | M1c | 60 s clip uploaded and processed synchronously on Render with wall time and RSS recorded; limits and go/no-go recorded; DB decision recorded |
| M2 Fire/smoke detection MVP (user brief; replaces spikes S-Model + S-Samples) | DONE (2026-10-17) | M1d | Real pretrained model behind `POST /api/v1/detect/fire`, temporal rule, evidence JPEG, tests, validation smoke test, Render memory/time measured |
| M2-spikes (Map, Routing, Notify, Stations) | TODO | M1b | Q3–Q5 decided or fallback adopted, with evidence |
| M3 Operational backend + persistent incidents (user brief) | IN_PROGRESS | M2 | Neon persistence, cameras/stations API, pending detections, confirm/reject, nearest available station, incident state machine + timeline; survives Render restart |
| M4 Fire Department command center (user brief; replaces the jobs draft) | IN_PROGRESS | M3 | One-screen dashboard: map, cameras, stations, incidents, upload → review → confirm/reject → incident with candidate station and timeline; operator key server-side; tests/lint/typecheck/build pass; works on Vercel |
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

## M1c — CV runtime feasibility spike (DONE, user-accepted 2026-10-17)

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

## M1d — Video-processing feasibility spike (DONE, user-accepted 2026-10-17)

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

## M2 — Fire/smoke detection MVP (DONE 2026-10-17)

Scope set by the user's M2 brief (time-critical):
- Prove the AI capability: MP4 → sampled frames → a real pretrained model → temporal confirmation → evidence frame → JSON result.
- **Not in scope:** dashboard, map, Neon/DB, incident lifecycle, notifications, routing, other emergency types, multiple models, training, LLMs.
- This replaces the planned S-Model and S-Samples spikes. The heuristic-baseline comparison is deferred (no second detector, per the brief).

| ID | Task | Status | Notes / evidence |
|---|---|---|---|
| M2-T1 | Model selection | DONE | **`fiacecson20/cctv-ai-fire-smoke`** YOLOv8n, 320 px, classes fire + smoke, 12.1 MB ONNX, pinned rev `343990e`, SHA-256 `f2699b75…0c6fad`. Licence treated as **AGPL-3.0** (card says MIT; the ONNX metadata and the card's own caveat say Ultralytics AGPL-3.0). Details in `apps/api/models/README.md` and D26. |
| M2-T2 | Model integration | DONE | `app/detection/fire_model.py`. Loads once at startup (lazy fallback); CPU provider only, 1 thread. Explicit letterbox preprocessing; contract validated at load (input [1,3,S,S], class names from metadata); output validated per frame; class-wise NMS (IoU 0.45). Configured by `MODEL_PATH` / `MODEL_SHA256`. Not committed (`*.onnx` ignored); `python -m app.detection.fetch_model` downloads and verifies it (Render build + CI). |
| M2-T3 | Video inference pipeline | DONE | `app/detection/fire_pipeline.py`. Reuses M1d `FrameSampler` (one decode thread, 2 fps, 60 s / 20 MB caps). Frames are processed one at a time; only the best candidate frame per class is kept. |
| M2-T4 | Evidence frame | DONE | `app/detection/evidence.py`. One annotated JPEG per detected result: boxes, labels, a `SIMULATED - PehRadar demo - operator review required` banner and a caption (model, time, type). Long side ≤ 960, quality 80, about 24 KB. UUID names, strict id regex on lookup, newest 20 kept, temp dir (ephemeral). |
| M2-T5 | `POST /api/v1/detect/fire` + `GET /api/v1/detect/evidence/{id}.jpg` | DONE | Upload guards shared with `/video/test` (`app/routers/uploads.py`): 411/413/415/409/422. Missing or bad model → 503 `MODEL_UNAVAILABLE` (the rest of the API stays up). Inference crash → 500 `INFERENCE_FAILED`, logged server-side, no details or stack trace to the client. `/video/test` stays flag-gated. |
| M2-T6 | Temporal confirmation | DONE | `app/domain/fire_decision.py` (pure). Per class: confirmed if score ≥ **0.45** in ≥ **3** of any **5** consecutive sampled frames (about 2.5 s at 2 fps). Single-frame rule implemented but **off** (0): nothing in the validation set justified it. All values are env-configurable. |
| M2-T7 | Tests | DONE | **76 passed** (74 + 2 skipped when the model file is absent). Covers: preprocessing, thresholding, NMS, letterbox mapping, invalid output (shape, NaN), missing/checksum/corrupt model, decision (none, 3-of-5, flicker, inclusive threshold, single-frame, per-class), evidence selection and pruning, id validation, endpoint (detected, not detected, 503, 500 without leak, 415/422/413/too long). Unit tests use a scripted detector; 2 integration tests use the real model (contract + determinism). CI now fetches the model so they run there. |
| M2-T8 | Validation smoke test | DONE (local) | See "M2 validation set" below. **Smoke test only, not an accuracy claim.** |
| M2-T9 | Render deploy + measurement (user) | DONE | 2026-10-17, commit `b63863e`, Render build command now fetches the model, CI run for `b63863e` = success (includes the fetch step, so the 2 real-model tests ran). Results in "Render results" below. |
| M2-T10 | Mark M2 DONE | DONE | All exit criteria met. Not reported: the evidence URL opened in a browser, and the Render memory graph. The model loaded on Render, otherwise the endpoint would have returned 503. |

**M2 validation set** (2026-10-17; 30 s segments re-encoded to 480p 15 fps, kept in git-ignored `sample_video/m2/`):
- **Sources:** archive.org, licences as listed: Jamestown ND fire 2005 (CC BY-NC-SA 2.5); *Structure Fire Control Tactics* 1964 (public domain mark); "Four elements: Fire" loop (CC BY 3.0); Princeton apartment fire (CC BY 2.0; footage is a logo slideshow); State Street Santa Barbara sunset (public domain); pasture sunset (CC0).
- **Ground truth:** labels are Claude's visual inspection of the frames.
- **Settings:** production defaults (0.45, 3-of-5, 2 fps); local Windows; `validate_clips`.

| Clip | Expected | Result | Peak confidence (positive frames of 57) | Processing |
|---|---|---|---|---|
| pos_jamestown_fire_a (night building fire) | fire | **detected: fire** | fire 0.64 (26) | 1.96 s |
| pos_jamestown_fire_b (night building fire) | fire | **detected: fire** | fire 0.73 (38) | 1.84 s |
| pos_daytime_structure_smoke_bw (B&W, heavy smoke + flames) | smoke (+fire) | **detected: smoke** (fire missed) | smoke 0.93 (18); fire 0.10 | 2.11 s |
| pos_fire_loop (glowing embers on black) | fire | **missed** | fire 0.24, smoke 0.32 | 2.11 s |
| neg_street_sunset_traffic (street, sunset, cars, people, lamps) | none | not detected | fire 0.52 (2 frames, rule held) | 2.08 s |
| neg_mountain_haze (B&W hazy hills, 11.9 s) | none | not detected | smoke 0.40 (0) | 0.82 s |
| neg_pasture_sunset (13.8 s) | none | not detected | fire 0.19 | 0.83 s |
| neg_red_logo (red/orange emblem) | none | not detected | fire 0.02 | 1.71 s |

- **Threshold sensitivity on the same set:**
  - At 0.30, the haze clip becomes a false smoke detection (12 positive frames).
  - At 0.40, the street clip reaches 4 positive frames, but not 3 within 5, so it is still not detected.
  - At 0.50, results are unchanged.
- **Choice:** 0.45, the value Techspec already planned.

**Local performance (Windows, 12-thread desktop, production server via curl):**
- Inference: 23 ms per sampled frame (1 thread).
- Processing: 1.5–1.8 s for a 30 s 480p15 clip.
- Server peak working set: 138 MB with the model loaded.
- Model session: about 38 MB.

**Render results (measured 2026-10-17; user ran PowerShell `curl.exe` against the deployed API; 30 s 480p15 clips, 57 sampled frames each):**

| Clip | Result (same as local) | processing_seconds | Request total | Inference ms/frame | peak_rss_mb |
|---|---|---|---|---|---|
| pos_jamestown_fire_b (0.48 MB) | detected: fire 0.7274 @ 18.667 s, 38 positive | **12.80** | 15.56 s | 186.8 | 176.2 |
| pos_daytime_structure_smoke_bw (1.57 MB) | detected: smoke 0.9268 @ 15.467 s, 18 positive | **14.75** | 17.90 s | 195.1 | 178.5 |
| neg_street_sunset_traffic (2.06 MB) | not detected (fire 0.5204 in 2 frames) | **14.53** | 18.28 s | 193.1 | 178.5 |

- **Inference: 187–195 ms per frame** (8.1–8.5× local), slightly worse than the 155 ms projection.
  - Inference total ≈ 57 × 0.19 = 10.9 s, about 75 % of processing.
  - Decode plus overhead ≈ 2–4 s.
- **Memory: peak 178.5 MB** of 512 MB, leaving about 333 MB (65 %) of headroom.
- **Determinism:** confidences match the local run to 4 decimals (0.7274, 0.9268, 0.5204), so preprocessing and inference are platform-consistent.
- **Upload:** request total minus processing is 2.8–3.8 s.
- **Projection for a 60 s 480p15 clip (not measured):** about 26–30 s processing plus upload.

## M3 — Operational backend + persistent incident workflow (IN_PROGRESS)

Scope set by the user's M3 brief (time-critical):
- **Not in scope:** dashboard, map, notifications, routing API, police/ambulance, detector changes.
- **M2 is frozen** (no model or threshold changes).

| ID | Task | Status | Notes / evidence |
|---|---|---|---|
| M3-T1 | Database | DONE (local) | SQLAlchemy **2.1.3** (sync), Alembic **1.20.0**, psycopg[binary] **3.3.6**; all ≥ 2 weeks old; 2.1.5 was pinned back. `DATABASE_URL`: production must be PostgreSQL or startup fails with a clear error; dev/test default to SQLite. Migration `0001` (autogenerated, made self-contained). |
| M3-T2 | Core entities | DONE | camera, fire_station, detection_event (+ deferred evidence bytes), incident (UNIQUE detection_event_id), incident_timeline_event (append-only, `seq`). Lowercase CHECK vocabularies; Karachi bbox CHECKs. See Schema.md v0.2. |
| M3-T3 | Karachi demo seed | DONE | `python -m app.seed`, `seed/karachi_demo.json`. 8 simulated cameras; 5 fire stations from OSM (Overpass, 2026-10-17, ODbL; Saddar `way/724176537`, Gulshan-e-Iqbal `node/4762522310`, Landhi `node/5133191784`, Orangi `node/5087779613`, Nazimabad `node/12184399097`), `unverified`, availability is a demo flag. UUIDv5 ids; idempotent; never overwrites `status`. |
| M3-T4 | Camera API | DONE | `GET /cameras[?department=]`, `/cameras/{id}` |
| M3-T5 | Fire station API | DONE | `GET /fire-stations`, `/fire-stations/{id}`, with `status_note` "Demo availability flag; not real-time" |
| M3-T6 | Detector → operational flow | DONE | `camera_id` form field (operator key required). `detected` → pending DetectionEvent with evidence bytes. `not_detected` → nothing stored. Without `camera_id`, the M2 behaviour is unchanged. |
| M3-T7 | Operator review | DONE | confirm → incident, severity, timeline, station selection in one transaction. reject → review stored on the detection, no incident. Repeat → 409 `DETECTION_ALREADY_REVIEWED` (row lock + UNIQUE constraint). |
| M3-T8 | Nearest eligible station | DONE | Haversine to `available` stations; ties break on id; `method: straight_line_haversine`, `is_driving_eta: false`, explanatory note. None available → stays `confirmed` + `no_station_available` event. |
| M3-T9 | Incident API + timeline | DONE | `GET /incidents[?status=&event_type=]`, `/incidents/{id}` (camera, detection, station selection, evidence URL, timeline by `seq`). `PATCH /incidents/{id}/status`: notified, acknowledged, resolved or rejected only; invalid → 409. |
| M3-T10 | Neon + Render deploy (user) | NOT STARTED | **Next task.** Needs a Neon `DATABASE_URL`, `OPERATOR_API_KEY` and the new start command on Render. |
| M3-T11 | Persistence check after Render restart (user) | NOT STARTED | Create an incident, restart the service, GET it again |
| M3-T12 | Mark M3 DONE | NOT STARTED | After T10 + T11 |

**Tests (2026-10-17):** `uv run pytest -rs` → **109 passed** (76 earlier + 33 M3). ruff check and format are clean. M3 tests cover:
- migration ↔ model parity, downgrade, and PostgreSQL DDL compilation;
- production DB validation and the Neon URL driver mapping;
- seed idempotency, including preserved status toggles;
- the cameras and stations endpoints;
- detection behaviour: pending detection with persistent evidence; nothing stored for `not_detected`; M2 behaviour without a camera; unknown camera → 404; no key → 401;
- review: confirm → incident, station and timeline order; repeat confirm/reject → 409; reject → no incident; operator key required (503 when production has no key);
- station selection: unavailable nearest skipped; no station available; Haversine unit tests;
- the severity table;
- status transitions: the valid path with timeline order; invalid → 409; system statuses not patchable (422); key required;
- the state table and list filters.

Unit tests use a scripted detector; the 2 real-model tests from M2 are unchanged.

**End-to-end rehearsal (local, SQLite, real model, uvicorn, curl):**
- `alembic upgrade head` → 0001; seed twice → "8 cameras, 5 stations", then "0, 0".
- Detection on Korangi camera `KHI-CAM-03` with the Jamestown fire clip → `detected fire 0.7274 pending`, evidence 200 (20 KB). The street negative → `not_detected`, no row.
- Confirm → `station_selected`, `high`, **Landhi Fire Station 7.63 km** straight-line.
- Repeat confirm → `DETECTION_ALREADY_REVIEWED`; no key → `UNAUTHORIZED`.
- PATCH notified → acknowledged → resolved, then notified → `INVALID_STATE_TRANSITION`. Timeline: 6 events in order.
- No errors in the server log.

## M4 — Fire Department command center (IN_PROGRESS)

Scope set by the user's M4 brief:
- **Not in scope:** police, ambulance, auth, admin, analytics, notifications, acknowledgement workflow, road routing, backend redesign, model tuning, extra pages, chatbot.
- No backend code changed.

| ID | Task | Status | Notes / evidence |
|---|---|---|---|
| M4-T1 | Application shell | DONE | Demo banner, top bar (wordmark, Fire Department context, tagline, operational-state chip, API pill + retry, last sync PKT, sound toggle), footer. Replaces the M1 status page. |
| M4-T2 | Karachi map | DONE | MapLibre GL JS **6.11.2** (2026-09-24; 6.12+ too new), OpenFreeMap dark style. Coordinates come only from the API. Camera, station and incident markers each have distinct shapes and states. |
| M4-T3 | Camera list | DONE | `GET /cameras`; name, location, code, status, SIMULATED badge, search; click selects and centres the marker and opens the camera panel. |
| M4-T4 | Fire stations | DONE | `GET /fire-stations`; map shields (available / unavailable ×); station panel with OSM link, licence and an unverified disclaimer. |
| M4-T5 | Incident queue | DONE | `GET /incidents`; active first, then severity, then newest; type, severity glyph, location, status, time, candidate station. |
| M4-T6 | Video analysis flow | DONE | File picker with client checks (.mp4, video/mp4, ≤ 4 MB); posts `camera_id + file` through the server proxy. |
| M4-T7 | Processing experience | DONE | Real upload %. The server steps share one indeterminate bar plus elapsed seconds. No invented percentage. |
| M4-T8 | Detection review | DONE | Evidence image, event chips, confidence, strongest-frame offset, positive/sampled frames, rule, location, model, per-class result, disclaimer. Two-step Confirm / Reject; buttons disabled while submitting. Refresh after the action. |
| M4-T9 | Negative result | DONE | "No persistent fire or smoke event detected." plus a no-safety-claim line, frames, time, peak confidence, and Analyze another clip. |
| M4-T10 | Incident detail | DONE | Type, severity, status, camera, confidence, evidence, candidate station + straight-line km + fixed "Candidate station based on geographic proximity. Not a dispatch confirmation."; timeline of the events that exist. |
| M4-T11 | Alerts | DONE | Amber alert strip (assertive live region) for new pending detections and incidents; Review badge pulse; opt-in Web Audio chime (no autoplay). |
| M4-T12 | API client, security, responsive, demo labels, tests, docs | DONE | `OpsApi` (`lib/api/client.ts`) with typed responses and error kinds. Server-only proxy `app/api/operator/[...path]`. Below 1024 px the areas become Queues/Map/Details tabs. 48 Vitest tests. Docs updated. |
| M4-T13 | Vercel deploy + browser check (user) | NOT STARTED | **Next task.** Needs `OPERATOR_API_KEY` on Vercel and the M3 Render deploy. |
| M4-T14 | Mark M4 DONE | NOT STARTED | After T13 |

**Tests (2026-10-17):**
- `npm test`: **48 passed** (7 files: 9 kept from M1 + 39 new).
- `npm run lint`, `npm run typecheck` and `npm run build` are clean.
- Backend regression: `uv run pytest` **109 passed**; ruff check and format are clean.

The new frontend tests cover:
- the command center rendering API data;
- camera selection;
- client-side clip validation;
- positive result → review;
- negative result;
- confirm (single submission);
- reject;
- 409 already-reviewed;
- incident selection and timeline;
- load error + retry;
- upload 401;
- the API client (envelope parsing, proxy paths, XHR upload progress);
- the proxy (key added, allowlist, cross-origin 403, 413, 502/503, key never echoed);
- the secret boundary (only `lib/server` reads the key; no `NEXT_PUBLIC_*KEY`; no client import of server code);
- the marker model;
- display rules.

**Local end-to-end** (2026-10-17). Setup: API on uvicorn with a fresh SQLite DB, the seed, the real model and `OPERATOR_API_KEY` set. Web on `next start` with the same key. Headless Chrome driven over CDP.
- Proxy with curl: an unknown path gave 404 `NOT_FOUND`. `Origin: https://evil.example` gave 403. A direct API write without the key gave 401. The fire clip through the proxy came back `detected fire 0.7274 pending`.
- Browser: Korangi pending detection → review panel → Confirm → **Landhi Fire Station 7.63 km** with the 3-event timeline. The map framed the incident and the station.
- Browser: Lyari + street clip → negative (57 frames, peak 0.52).
- Browser: Clifton + smoke clip → alert "Possible SMOKE…", 0.93, 18 of 57 frames → Reject → "Detection rejected. No incident was created." The API showed the detection `rejected` by "Duty operator (demo console)", with the incident count unchanged at 1.
- Screenshots were checked at 1440×900, 1366×768 and 820×900.
- A build with `OPERATOR_API_KEY=SENTINEL-…` had **0** hits for the value in `.next/static`. The only hit was in `.next/cache` (Turbopack's local build cache, not served). The variable *name* appears in the bundle once, in an error message.

**Bugs found and fixed during verification:**
1. Map container height collapsed because MapLibre's CSS sets `position: relative`. Fixed by sizing it from an absolute wrapper.
2. Markers stacked in normal flow because assigning `className` removed `maplibregl-marker`. Fixed by keeping MapLibre's classes.
3. `.pr-marker { position: relative }` overrode marker positioning. Removed.
4. The camera list overflowed (grid min-width). Fixed with `grid-cols-1`.

## M4–M10

M4 above follows the user's brief. The remaining planned milestones (jobs, notifications/ack, routing, polish, hardening) are defined in `ImplementationPlan.md` §2. They will be broken into tracked tasks here when each milestone starts, so this list does not go stale. All are **TODO**.

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
| D23 | Process uploads **synchronously** (upload → process → result) for the hackathon. No queue or worker. | CONFIRMED with inference (Render, M2): a 30 s clip takes 13–15 s processing and 16–18 s per request. A 60 s clip is projected at about 30 s, the stated limit, so demo clips stay ≤ 30 s. | Local decode of a 60 s clip takes 0.6–3 s. Revisit only if Render decode **plus** M2-S1's measured inference exceeds about 30 s for a 60 s demo clip. The fallback is the already-designed single in-process thread (Techspec §5.3), still with no framework. |
| D24 | DB: **SQLite for local dev/tests and Neon Postgres for the deployed app, added at the start of M3** (not in M1d) | RECOMMENDED | Render's free filesystem is ephemeral (lost on redeploy/restart and on spin-down), so deployed SQLite would wipe judge-created incidents. Neon free tier needs no card, and setup is about 15 min: `DATABASE_URL` env, SQLAlchemy + Alembic (already planned, D3). Cameras and stations are re-seeded idempotently on startup. Render's own free Postgres expires after 30 days, so it is not used. |
| D26 | Detector: `fiacecson20/cctv-ai-fire-smoke` YOLOv8n-320 ONNX (fire, smoke), treated as AGPL-3.0, fetched at build time with a pinned revision and SHA-256 | CONFIRMED on Render (M2); AGPL acceptance pending user confirmation (Q2) | Of 2–3 credible options it was the only small ONNX fire+smoke model with a stated licence: <br>• Pyronear yolo11s is Apache-2.0 but wildfire-smoke-only at 1024 px. <br>• fireviewer yolo11m is AGPL-3.0 and about 30× the compute. <br>• The Intel model is a 2B-parameter VLM, ruled out by the no-LLM rule. <br>• Others have no licence or a proprietary format. <br>23 ms/frame locally. Weak points: round-1 training (12 epochs), publisher-reported smoke recall 0.52, and an unverifiable upstream repo. |
| D27 | Temporal rule: per class, score ≥ 0.45 in ≥ 3 of any 5 consecutive sampled frames; single-frame rule off | CONFIRMED (M2 validation smoke test) | 0.30 produced a haze false positive. 0.40 and 0.50 gave the same decisions on the set. 3-of-5 suppressed the street-lamp flickers (fire 0.52 in 2 isolated frames). |
| D28 | Model loads once at startup. If it's missing or invalid, `/detect/fire` returns 503 and the rest of the API stays up (overrides Techspec §4.2 "startup fails loudly"). | CONFIRMED | Keeps `/health` and the Vercel status page working when the model download fails. The failure is logged at ERROR. |
| D29 | Sync SQLAlchemy 2.1 + psycopg 3 + Alembic; Neon PostgreSQL in production; SQLite for dev/tests; no repository layer (a thin service module) | CONFIRMED (M3) | Matches the sync FastAPI code; the M3 brief asked for no unneeded abstraction |
| D30 | Incident vocabulary per the M3 brief (lowercase; `station_selected`; `detected` reserved) replaces the v0.1 OPEN/NOTIFIED/… draft. `notified` / `acknowledged` are operator-recorded until notifications exist. | CONFIRMED | User brief; Appflow §3.2 updated |
| D31 | Evidence JPEG stored on `detection_event` (deferred column) instead of a separate `evidence_frame` table | CONFIRMED | The brief limited the entity list; bytes survive Render restarts; lists never load them |
| D32 | Migrations + seed run in the Render **start** command | CONFIRMED (pending deploy) | The free tier has no pre-deploy hook; both are idempotent; a failure keeps the old deploy live |
| D33 | One shared `OPERATOR_API_KEY` for writes; reads public; production without a key refuses writes (503) | CONFIRMED (M3) | A public URL must not allow anonymous incident creation. Reads are simulated/public data. Real operator accounts are later work. |
| D34 | Fire stations from OSM (5 public KMC stations), unverified, availability as a demo flag | CONFIRMED | Overpass export 2026-10-17. Institutional brigades (CAA, AKU) and mis-tagged features were excluded. |
| D35 | Map: MapLibre GL JS **6.11.2** + OpenFreeMap "dark" style (free, no key, OSM data). The worker is copied to `public/vendor` at build time (`scripts/copy-maplibre-worker.mjs`). | CONFIRMED locally (M4) | Matches D8. Leaflet was not needed. OpenFreeMap needs no account. MapLibre 6 resolves its worker at runtime, which Turbopack cannot see. Answers the tile part of Q3. |
| D36 | Operator writes go through a same-origin Next.js route handler (`/api/operator/*`) that adds `X-Operator-Key` from the server-only `OPERATOR_API_KEY`. Only three actions are allowlisted; cross-origin requests get 403. Reads go browser → API directly. | CONFIRMED (M4) | User brief: the key must never reach the browser. This is the smallest server boundary and needs no backend change. |
| D37 | UI clip limit **4 MB** (API limit 20 MB) | CONFIRMED | Vercel Functions accept request bodies up to 4.5 MB. The M2 demo clips are 0.1–2.1 MB. |
| D38 | Poll incidents and pending detections every **10 s** (D5 said 3 s) | CONFIRMED | Two light GETs per 10 s keep load low on Render's free tier. The operator's own actions refresh immediately. |
| D39 | Two-step inline Confirm / Reject instead of dialogs; no severity picker | CONFIRMED | The brief requires no accidental repeat actions. Severity is the API's deterministic rule (M3), so the UI does not duplicate it. |
| D25 | M1d verdict: **GO WITH LIMITS** | CONFIRMED on Render data (2026-10-17) | Limits: <br>• Demo clips **≤ 30 s recommended, 60 s maximum**. <br>• **Pre-transcoded to H.264 MP4 at ≤ 854×480 and 15 fps** (`ffmpeg -i in.mp4 -vf scale=-2:480 -r 15 -c:v libx264 -an out.mp4`). <br>• Upload cap stays **20 MB**; demo files are realistically ≤ 10 MB because of upload speed. <br>• **2 fps sampling** (1 fps if inference is slow). <br>• Synchronous processing. <br>• 720p60 phone footage must be transcoded first: decode alone would be about 1.1× realtime. |
| D21 | Host runtime evidence comes from an env-gated startup log line (`CV_RUNTIME_CHECK`), not a diagnostic endpoint | CONFIRMED | Free tier has no shell. No public diagnostics. A failed check fails the deploy and Render keeps the previous one live. |

## Decisions pending

| ID | Question | Resolved by | Status |
|---|---|---|---|
| Q1 | API host for the **heavy** workload (Render / Railway / Fly / HF Spaces) and deployed DB (Neon vs SQLite on volume). Render is the lightweight-deploy host (D16). | M1d | DB part: D24 recommends Neon in M3. Host part: pending the M1d-T6 Render numbers. |
| Q2 | Fire/smoke model choice and licence (AGPL acceptable?) | M2 | DECIDED 2026-10-17: D26. AGPL-3.0 accepted for the public hackathon repo. **The user should confirm.** |
| Q3 | Tile source (OpenFreeMap vs MapTiler) and 3D data quality | M2-S3 | Tile source DECIDED (D35: OpenFreeMap dark). 3D not evaluated (not in M4). |
| Q4 | Routing provider | M2-S4 | TODO |
| Q5 | Email provider (Resend vs SMTP) and webhook demo target | M2-S5 | TODO |
| Q6 | Sample clip sources | M2 | Validation clips from archive.org (see M2). Demo clips are still to be chosen. |
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
| K9 | **Inference dominates on Render** *(measured in M2: 187–195 ms/frame, about 75 % of the 13–15 s processing time for a 30 s clip. Acceptable for a ≤ 30 s demo clip. To halve it: 1 fps sampling.)* At 0.15 CPU, every 100 ms of full-core model time becomes about 0.67 s per sampled frame. That is about 40 s for 60 sampled frames (30 s at 2 fps). This is arithmetic, not a measurement. | High | OPEN. M2-S1 must measure ms/frame on Render. Options: 1 fps sampling, smaller input (e.g. 320 px), a smaller model, or Render Starter (paid, more CPU) if the demo needs it. |
| K10 | **False negatives:** fire in grayscale or IR footage (flames missed in the B&W clip) and embers or glowing coals without flames. Weak smoke recall per the publisher (0.52). Small or distant fires below 320 px input resolution. | High | OPEN. Demo with colour daytime/night flame clips. Operator review is always required. |
| K11 | **False positives (likely, partly observed):** street and vehicle lights at dusk reached fire 0.52 in isolated frames; haze reached smoke 0.40. Untested confusers: sodium lamps, welding, steam, dust, orange signage, fireworks, cooking fires. | Medium | OPEN. The 3-of-5 rule and the 0.45 threshold mitigate this. Build a Karachi confuser set before any accuracy claim. |
| K12 | Model provenance: upstream training repo unreachable; dataset named only as "CC-BY 4.0"; round-1 baseline weights | Medium | OPEN. Recorded in `models/README.md`. Replace with a better-documented model if one is found. |
| K13 | Evidence JPEGs are in a temp dir and lost on Render restart or redeploy | Low | Accepted until M3 (DB storage per Techspec) |
| K14 | Each confirmed detection opens its own incident: no dedup or attach-to-open-incident per camera yet (Appflow §2.2 / AC-18 planned) | Medium | OPEN. Fine for the demo; add before multi-clip demos on one camera. |
| K15 | Reads (cameras, stations, detections, incidents, evidence) are public | Low | Accepted for a simulated demo. Revisit before any real data. |
| K16 | The PostgreSQL migration has only been compiled, not executed; the first real run is on Neon | Medium | OPEN until M3-T10 |
| K17 | No operator login (out of M4 scope). The key is hidden, but anyone who can open the dashboard URL can analyze, confirm or reject through the proxy. Cross-site posts are blocked (Origin check). | Medium | OPEN. Acceptable for a simulated demo; add auth before any real use. |
| K18 | The proxy sets `maxDuration = 150` s. That needs Vercel Fluid compute (default for new projects). Without it the Hobby limit is 60 s, and a cold Render start plus a 15–20 s analysis could hit a 504. | Medium | OPEN until M4-T13. Warm the API before a demo by opening `/api/v1/health`. |
| K19 | OpenFreeMap is a free community service with no SLA. If the style fails, the map shows "Map tiles unavailable" and markers still render on a plain background. | Low | OPEN |
| K20 | Visual checks were done in headless Chrome with SwiftShader at 1440/1366/820 px. No physical-device or other-browser pass yet. | Low | OPEN until the user's M4-T13 check |
| K21 | The Turbopack build cache (`.next/cache`) keeps build-time env values locally. It is git-ignored and never served, and the browser bundle is clean. | Low | Accepted. Delete `.next` before sharing a machine's build folder. |
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
| 2026-10-17 | M2 model download + checksum | `curl` pinned rev; `sha256sum`; later `python -m app.detection.fetch_model` | 12,139,911 B, SHA-256 `f2699b75…0c6fad`. fetch_model: 11 s download, verified; second run "already present". |
| 2026-10-17 | M2 model contract | onnxruntime session inspection | input `images` [1,3,320,320] float; output `output0` [1,6,2100]; metadata names `{0: 'fire', 1: 'smoke'}`, licence "AGPL-3.0", Ultralytics 8.4.46 |
| 2026-10-17 | M2 inference speed | 50 runs on a random tensor | 1 thread: 23.5 ms/frame (CPU 23.4 ms), RSS 47 → 85 MB after session load. Auto threads: 9.8 ms wall / 60 ms CPU. |
| 2026-10-17 | M2 tests | `uv run pytest -rs` · `ruff check .` · `ruff format --check .` | **76 passed** (model present); 74 passed + 2 skipped (model absent) · all checks passed · 37 files formatted |
| 2026-10-17 | M2 validation smoke test | `python -m app.detection.validate_clips sample_video/m2/*.mp4` (thresholds 0.30/0.40/0.45/0.50) | At 0.45: positives 3/4 detected (embers missed), negatives 0/4 false. See the M2 table. |
| 2026-10-17 | M2 production rehearsal (local) | `APP_ENV=production uvicorn`; `curl -F file=@… /api/v1/detect/fire`; GET evidence | 200s with the expected results, 1.56–1.79 s per 30 s clip, evidence GET 200 image/jpeg 23.6 KB, log "Fire/smoke model loaded", server peak WS 137.9 MB |
| 2026-10-17 | M2 Render detection test | User: `curl.exe -F file=@…` × 3 against `…onrender.com/api/v1/detect/fire` (commit `b63863e`) | All HTTP 200. Fire 0.7274 detected (12.80 s); smoke 0.9268 detected (14.75 s); street negative not detected (14.53 s). Inference 186.8–195.1 ms/frame, peak RSS 176.2–178.5 MB. |
| 2026-10-17 | M2 CI | GitHub Actions API: runs for `b63863e` | completed / success (workflow includes `fetch_model` before pytest) |
| 2026-10-17 | M3 dependencies | `uv add sqlalchemy alembic psycopg[binary]`; `uv lock --upgrade-package sqlalchemy==2.1.3` | SQLAlchemy 2.1.3 (2.1.5 from 2026-10-16 rejected), Alembic 1.20.0, psycopg 3.3.6, Mako 1.4.3, MarkupSafe 3.0.4, tzdata 2026.5 |
| 2026-10-17 | M3 OSM station export | Overpass API, `amenity=fire_station` in the Karachi bbox | 15 features (OSM base 2026-10-17T17:18Z); 5 public KMC stations seeded |
| 2026-10-17 | M3 tests | `uv run pytest -rs` · `ruff check .` · `ruff format --check .` | **109 passed** · all checks passed · 49 files formatted |
| 2026-10-17 | M3 end-to-end rehearsal (local SQLite, real model) | alembic upgrade + seed ×2 + uvicorn + curl flow | See the M3 section: pending detection → confirm → Landhi 7.63 km → notified/acknowledged/resolved; 409/401 guards; 6-event timeline |
| 2026-10-17 | M4 dependency | `npm install --save-exact --before=2026-10-03 maplibre-gl@6.11.2` | maplibre-gl 6.11.2 (published 2026-09-24) |
| 2026-10-17 | M4 web checks | `npm test` · `npm run lint` · `npm run typecheck` · `npm run build` (after `rm -rf .next`) | **48 passed** (7 files) · clean · OK · compiled; routes `/` (static) and `/api/operator/[...path]` (dynamic) |
| 2026-10-17 | M4 backend regression | `uv run pytest` · `ruff check .` · `ruff format --check .` | **109 passed** · all checks passed · 49 files formatted |
| 2026-10-17 | M4 secret check | Build with `OPERATOR_API_KEY=SENTINEL-…`; `grep -rl` in `.next/static` | 0 files contain the value (1 hit in the local `.next/cache` only) |
| 2026-10-17 | M4 proxy check (local) | curl against `next start` + uvicorn (key set on both) | Unknown path 404; foreign Origin 403; direct API write without key 401; detect via proxy → `detected fire 0.7274 pending` |
| 2026-10-17 | M4 browser end-to-end (local) | Headless Chrome over CDP: confirm, negative and reject flows; screenshots at 1440×900, 1366×768, 820×900 | All three flows behaved as specified (details in the M4 section) |
| 2026-10-17 | Independent check of Vercel page | Claude: `curl -I` | 403 with `X-Vercel-Mitigated: challenge`. Vercel bot protection blocks non-browser clients. This is not a deployment fault. |
