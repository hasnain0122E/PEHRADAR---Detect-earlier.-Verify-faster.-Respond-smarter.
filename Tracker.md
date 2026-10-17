# PehRadar — Tracker

**Last updated:** 2026-10-17
**Current milestone:** M1b — GitHub + lightweight deployment (IN_PROGRESS: configuration prepared, awaiting the user's manual Render deploy)
**Last completed:** M1a — Local monorepo scaffold (DONE, verified locally 2026-10-17)
**Statuses:** `TODO` · `IN_PROGRESS` · `BLOCKED` · `DONE` (DONE only with recorded verification, per `Rules.md` §8)

> Only the M1a scaffold exists: `GET /api/v1/health` and a status page. No detection, database, map, incidents or notifications have been built.

| Track | Status |
|---|---|
| M1a local scaffold | **DONE** |
| GitHub repository | **DONE** (verified 2026-10-17: `origin/main` = local `39f0ea3`) |
| CI workflow | Added, **not yet run on GitHub** |
| API deployment preparation (Render config) | **DONE** (settings in README → Deployment; build/start rehearsed locally) |
| API deployment on Render | **NOT STARTED.** Waiting for the user's manual deploy and evidence. |
| Vercel deployment | **NOT STARTED** |
| OpenCV / ONNX / fire detection | **NOT STARTED** (heavy-dependency hosting spike is M1c) |

---

## Exact next task

**M1b-T5 (user, manual): deploy the API on Render** with the settings in README → Deployment, then send back:
1. The public service URL and the output of `curl -i https://<service>.onrender.com/api/v1/health`.
2. The first ~30 lines of the deploy log (build + startup).
3. The same health check after **Manual Deploy → Clear build cache & deploy** (or a restart).

Before that, commit and push the M1b changes (CI workflow, CORS change, docs) so Render builds the new commit, and report the CI result from the GitHub Actions tab.

## Milestone summary

| Milestone | Status | Depends on | Acceptance (summary; full in ImplementationPlan.md §2) |
|---|---|---|---|
| M0 Foundation & docs | DONE | — | Eight docs consistent; user reviewed and started M1 (2026-10-17) |
| M1a Local scaffold | DONE | M0 | API + web tests, lint, typecheck, build pass; browser↔API CORS verified (see M1a below) |
| M1b GitHub + lightweight deployment | IN_PROGRESS | M1a | Public health 200 with `pehradar-api`; survives redeploy; clean logs; deployed web "Connected" with restricted CORS; CI green |
| M1c Heavy-dependency hosting spike | TODO | M1b | OpenCV/ONNX install on host; 60 s clip processed with measurements; Q1 decided |
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

## M1b — GitHub + lightweight deployment (IN_PROGRESS)

Scope set by the user at M1b kickoff: **no OpenCV, ONNX, video processing, DB, incidents, map, notifications or UI redesign.** Those checks moved to M1c.

**Acceptance criteria** (none verified yet; each needs real evidence from the user's deployment)
1. Public API URL is reachable and `GET /api/v1/health` returns **HTTP 200**.
2. The response body is `{"status":"ok","app":"pehradar-api","version":"0.1.0"}`.
3. It still returns 200 after a fresh deploy or restart.
4. Production logs show no unexplained startup errors.
5. The deployed URL is recorded here (Tracker) only, never hard-coded in application code.
6. (After Vercel) the deployed web page shows "Connected", with `CORS_ORIGINS` set to the Vercel origin only.
7. CI is green on GitHub.

| ID | Task | Status | Notes / evidence |
|---|---|---|---|
| M1b-T1 | GitHub repository and push | DONE | 2026-10-17: branch `main` tracks `origin` = `github.com/hasnain0122E/PEHRADAR---Detect-earlier.-Verify-faster.-Respond-smarter.`. `git ls-remote origin` shows `refs/heads/main` = `39f0ea3` = local HEAD. Working tree clean. 56 tracked files. No `.env`/`.env.local`, venv, `node_modules`, build output, video, weights, DB or key files tracked (only the two `.env.example`). |
| M1b-T2 | GitHub Actions CI (`.github/workflows/ci.yml`) | IN_PROGRESS | Added. `actionlint` passes locally. Actions pinned to SHAs (checkout v7.0.1, setup-node v7.0.0, setup-uv v10.2.0; all ≥ 2 weeks old). **Not yet run on GitHub**: needs push. |
| M1b-T3 | Production CORS without a wildcard | DONE | `CORS_ORIGINS` unset or empty in production means no browser origins. 2 new tests. `uv run pytest`: **16 passed**. Ruff clean. |
| M1b-T4 | Render configuration prepared and rehearsed | DONE | README → Deployment. Rehearsal in a clean copy of the tracked files with Render's uv 0.12.24: `uv lock --check` OK, `uv sync --locked --no-dev` OK (pytest absent), start command with `PORT=10000 APP_ENV=production` bound `0.0.0.0:10000`, health 200 `pehradar-api`, `/api/v1/docs` 404, no ACAO header for a browser origin, startup log clean. **This is a local rehearsal, not a deployment.** |
| M1b-T5 | Deploy API on Render (user, manual) | NOT STARTED | **Next task.** Needs user's Render account. |
| M1b-T6 | Verify redeploy/restart + logs | NOT STARTED | After T5 |
| M1b-T7 | Deploy web on Vercel; set Render `CORS_ORIGINS` to the Vercel origin | NOT STARTED | Only after T5/T6 pass |
| M1b-T8 | Record real URLs and results here | NOT STARTED | |

**API deployment status: NOT STARTED.** No production URL, response or log has been observed yet.

## M1c — Heavy-dependency hosting spike (TODO, after M1b)

| ID | Task | Status | Notes |
|---|---|---|---|
| M1c-T1 | Add `opencv-python-headless` + `onnxruntime`; check native Render install (Docker only if native fails) | TODO | |
| M1c-T2 | Spike endpoint: upload → background-thread decode @ 2 fps → duration and peak RSS (non-production only; removed after) | TODO | |
| M1c-T3 | Record Techspec §10 measurements (cold start, RAM, 50 MB upload, background thread) | TODO | |
| M1c-T4 | Provision Neon Postgres; connect | TODO | Can slip to M3 |
| M1c-T5 | Record Q1 decision; Techspec §10 → CONFIRMED | TODO | |

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
| D6 | In-process single worker thread, DB-backed jobs | CONFIRMED (host behaviour verified in M1b) | Techspec §5.3 |
| D7 | ONNX Runtime for inference; heuristic baseline always available | CONFIRMED | Techspec §4 |
| D8 | MapLibre GL; 2D required, 3D optional; Cesium/Google 3D rejected for MVP | CONFIRMED | Techspec §7.2 |
| D9 | Server-side recipient allowlist; client sends `recipient_key` only | CONFIRMED | Techspec §6 |
| D10 | Ack via explicit POST only | CONFIRMED | Appflow §2.7 |
| D11 | Rejection never auto-suppresses later detections | CONFIRMED | PRD FR-17 |
| D12 | Health endpoint is `/api/v1/health` (was `/health` in Techspec) | CONFIRMED | User request at M1 kickoff; Techspec §3.1 updated |
| D13 | M1 split into M1a (local scaffold, no heavy deps) and M1b (GitHub + deploy spike) | CONFIRMED | User excluded OpenCV/ONNX from the scaffold; ImplementationPlan updated |
| D14 | Web has no fallback API URL; missing `NEXT_PUBLIC_API_BASE_URL` shows "Not configured" | CONFIRMED | Avoids silently calling a guessed host |
| D15 | Only dependency versions ≥ 2 weeks old (`npm install --before=…`); Next 16.3.8 rather than 16.4.x | CONFIRMED | Supply-chain caution; Techspec §2 |
| D16 | Render native Python + uv (no Docker) for the lightweight API deploy; explicit `PYTHON_VERSION=3.12.15`, `UV_VERSION=0.12.24` | CONFIRMED for M1b (deploy result pending) | Render docs (python-version, uv-version) checked 2026-10-17; uv 0.12.24 verified against `uv.lock` locally |
| D17 | Production `CORS_ORIGINS` unset or empty means no browser origins; never `*` | CONFIRMED | Lets the API go live before the Vercel origin exists without opening CORS |
| D18 | M1b reduced to the lightweight deploy; OpenCV/ONNX/clip-decode/Neon moved to new M1c | CONFIRMED | User scope rule at M1b kickoff |

## Decisions pending

| ID | Question | Resolved by | Status |
|---|---|---|---|
| Q1 | API host for the **heavy** workload (Render / Railway / Fly / HF Spaces) and deployed DB (Neon vs SQLite on volume). Render is the lightweight-deploy host (D16). | M1c | TODO |
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
| B3 | Render and Vercel deploys need the user's accounts (Claude cannot authorize them) | M1b-T5…T7 | OPEN |

## Known bugs / issues

| ID | Issue | Severity | Status |
|---|---|---|---|
| K1 | `npm audit`: 5 high findings, all from one advisory (`braces` stack-exhaustion DoS, GHSA-vfj7-8cjw-p6xm) reached via `eslint-config-next` → `@next/eslint-plugin-next` → `fast-glob` → `micromatch`. **Dev-time lint tooling only, not in the shipped bundle.** npm's only "fix" downgrades to `eslint-config-next@14`, which is wrong for Next 16. | Low (dev only) | OPEN. Re-check when a patched `eslint-config-next` is ≥ 2 weeks old. |
| K2 | npm 12 blocked the `unrs-resolver@1.12.2` postinstall script (not in allowScripts). ESLint runs fine without it (exit 0). CI's Node 24 ships its own npm, which may run the script. | Low | OPEN. Approve with `npm install-scripts approve unrs-resolver` only if lint breaks. |
| K3 | Render free tier sleeps when idle. The first request after sleep can take tens of seconds, longer than the web client's 5 s timeout, so the status page may briefly show "Disconnected" until the next 15 s poll. | Low (expected) | OPEN. Warm up with a health request before demos. |
| K4 | Vercel preview deployments have per-deployment origins that are not in `CORS_ORIGINS`, so previews show "Disconnected". Only the production origin is allowed. | Low (by design) | OPEN. Add specific preview origins only if needed. |

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
| 2026-10-17 | CI workflow lint | `uvx --from actionlint-py actionlint .github/workflows/ci.yml` | exit 0. Workflow **not yet executed on GitHub**. |
