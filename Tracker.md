# PehRadar — Tracker

**Last updated:** 2026-10-17
**Current milestone:** M1b — GitHub remote + deployment spike (NOT STARTED)
**Last completed:** M1a — Local monorepo scaffold (DONE, verified locally 2026-10-17)
**Statuses:** `TODO` · `IN_PROGRESS` · `BLOCKED` · `DONE` (DONE only with recorded verification, per `Rules.md` §8)

> Only the M1a scaffold exists: `GET /api/v1/health` and a status page. No detection, database, map, incidents or notifications have been built.
> **Hosting spike status: NOT STARTED.** Nothing has been deployed.

---

## Exact next task

**M1b-T1: create the first commit and connect the GitHub remote.**
1. The user reviews the M1a changes, then commits locally:
   `git add -A; git commit -m "M1a: monorepo scaffold with FastAPI health endpoint and Next.js status page"`
2. The user creates an **empty** GitHub repository (no README or .gitignore, to avoid a merge), then:
   `git remote add origin <url>; git push -u origin main`
3. Then **M1b-T2**: add the GitHub Actions CI workflow and confirm it goes green on GitHub.

After that: M1b-T3 Dockerfile with OpenCV + ONNX Runtime, and M1b-T5 API deployment (needs a Render or Railway account).

## Milestone summary

| Milestone | Status | Depends on | Acceptance (summary; full in ImplementationPlan.md §2) |
|---|---|---|---|
| M0 Foundation & docs | DONE | — | Eight docs consistent; user reviewed and started M1 (2026-10-17) |
| M1a Local scaffold | DONE | M0 | API + web tests, lint, typecheck, build pass; browser↔API CORS verified (see M1a below) |
| M1b GitHub + deployment spike | TODO (NOT STARTED) | M1a | CI green; deployed web↔API health; 60 s clip processed on host with measurements; Q1 decided |
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
| M1a-T1 | `git init -b main`; root `.gitignore`; README | DONE | `git add -A --dry-run` lists only source/docs/lockfiles. `.env.local`, `.venv`, `node_modules`, `.next` confirmed ignored with `git check-ignore`. Both `.env.example` files tracked. **No commit made yet** (left for user review). |
| M1a-T2 | Python 3.12 via uv | DONE | 3.12 was not installed (only 3.11/3.13/3.14). Ran `uv python install 3.12`, which installed 3.12.15 (uv-managed, system Python untouched). |
| M1a-T3 | `apps/api` FastAPI scaffold: app factory, settings, health router, package skeleton | DONE | `pyproject.toml` + `uv.lock`; `uv sync --locked` OK |
| M1a-T4 | API tests (health, CORS allow/deny/preflight, config validation, prod docs disabled) | DONE | `uv run pytest`: **15 passed** |
| M1a-T5 | `apps/web` Next.js 16.3.8 + TS + Tailwind 4 status page, API client, Vitest | DONE | `npm test`: **9 passed (2 files)** |
| M1a-T6 | Local integration through real browser CORS | DONE | Headless Chrome against `next start` (:3000) + uvicorn (:8000): DOM showed "Connected" / "pehradar-api v0.1.0". From unlisted origin :3001: "Disconnected / Cannot reach the API (… CORS blocked)". With API stopped: "Disconnected" + "Retry now". |
| M1a-T7 | Docs: README (root, api, web), Techspec (health path, pinned versions), ImplementationPlan (M1 split) | DONE | — |

## M1b — GitHub remote + deployment spike (NOT STARTED)

**Acceptance criteria**
1. Repository pushed to GitHub. CI runs API (ruff + pytest) and web (lint + typecheck + test + build) and is green.
2. The deployed web page shows "Connected" from the deployed API over HTTPS, with `CORS_ORIGINS` set to the deployed web origin only.
3. On the deployed API, a 60 s 720p clip is decoded at 2 fps on a background thread after the 202 response. Wall time and peak RSS are recorded. A 50 MB upload succeeds, or the real limit is recorded and `MAX_UPLOAD_MB` adjusted.
4. Decision Q1 (API host + deployed DB) recorded with evidence.

| ID | Task | Status | Notes |
|---|---|---|---|
| M1b-T1 | First commit; user creates GitHub repo; push | TODO | **Next task**. Needs user: GitHub repo URL |
| M1b-T2 | GitHub Actions CI | TODO | |
| M1b-T3 | `apps/api/Dockerfile` (python 3.12 slim, non-root, opencv-python-headless, onnxruntime); health reports both imports | TODO | |
| M1b-T4 | Spike endpoint: upload → background-thread decode @ 2 fps → report duration and peak RSS (non-production only; removed after spike) | TODO | |
| M1b-T5 | Deploy API to candidate host #1 (Render or Railway); record Techspec §10 measurements | TODO | Needs user account |
| M1b-T6 | Provision Neon Postgres; connect API | TODO | Can slip to M3 (no DB code yet) |
| M1b-T7 | Deploy web to Vercel with `NEXT_PUBLIC_API_BASE_URL` set **before build** | TODO | Needs user account |
| M1b-T8 | Record Q1 decision; update Techspec §10 to CONFIRMED | TODO | |

**Hosting spike status: NOT STARTED.** No deployment measurements exist.

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

## Decisions pending

| ID | Question | Resolved by | Status |
|---|---|---|---|
| Q1 | API host (Render / Railway / Fly / HF Spaces) and deployed DB (Neon vs SQLite on volume) | M1b | TODO |
| Q2 | Fire/smoke model choice and licence (AGPL acceptable?) | M2-S1 | TODO |
| Q3 | Tile source (OpenFreeMap vs MapTiler) and 3D data quality | M2-S3 | TODO |
| Q4 | Routing provider | M2-S4 | TODO |
| Q5 | Email provider (Resend vs SMTP) and webhook demo target | M2-S5 | TODO |
| Q6 | Sample clip sources | M2-S2 | TODO |
| Q7 | Hackathon deadline date, team size, whether judges use the deployed app themselves, hosting accounts available | User | TODO |
| Q8 | **Product name: "Aegis" or "PehRadar"?** The M1 brief again says "Aegis". Code and docs use PehRadar. The display name lives in one constant per app (`apps/web/src/lib/config.ts` `PRODUCT_NAME`, `apps/api/app/config.py` `APP_ID`), so a rename is cheap now and expensive later. | User | TODO (blocking only branding) |

## Blockers

| ID | Blocker | Affects | Status |
|---|---|---|---|
| B1 | M0 review/approval needed before implementation | M1 | RESOLVED 2026-10-17 |
| B2 | GitHub repo URL needed for M1b-T1/T2 | M1b | OPEN |
| B3 | Hosting accounts (Vercel, Render/Railway, Neon) needed for M1b-T5…T7 | M1b | OPEN |

## Known bugs / issues

| ID | Issue | Severity | Status |
|---|---|---|---|
| K1 | `npm audit`: 5 high findings, all from one advisory (`braces` stack-exhaustion DoS, GHSA-vfj7-8cjw-p6xm) reached via `eslint-config-next` → `@next/eslint-plugin-next` → `fast-glob` → `micromatch`. **Dev-time lint tooling only, not in the shipped bundle.** npm's only "fix" downgrades to `eslint-config-next@14`, which is wrong for Next 16. | Low (dev only) | OPEN. Re-check when a patched `eslint-config-next` is ≥ 2 weeks old. |
| K2 | npm 12 blocked the `unrs-resolver@1.12.2` postinstall script (not in allowScripts). ESLint runs fine without it (exit 0). | Low | OPEN. Approve with `npm install-scripts approve unrs-resolver` only if lint breaks. |

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
