# PehRadar Web (`apps/web`)

Next.js 16 (App Router) + TypeScript + Tailwind CSS 4 + MapLibre GL JS 6.11.2.

**Scope (M4 + M5):** a single-screen city command center for the Karachi Fire Department.
- **Map:** 3D/2D. 179 monitoring nodes with provenance: quiet ones clustered, alerting and feed nodes as individual markers. Also fire stations, incidents and the suggested road route.
- **Monitoring:** city status bar; demo scenarios (start, countdown, reset); automatic alerts from scenario detections; an activity feed.
- **Detail:** a camera feed viewer (simulated/public labels, unavailable state); AI evidence review with Confirm / Reject; incident detail with the candidate station, road route and timeline. Manual clip upload stays as a diagnostic.

**No official or Safe City CCTV is connected.** Demo feeds are licensed sample footage on simulated nodes. There are no notifications, acknowledgement workflow or authentication.

## Commands (run inside `apps/web`)

| Task | Command |
|---|---|
| Install (exact versions from `package-lock.json`) | `npm ci` |
| Local config | `Copy-Item .env.example .env.local` (PowerShell) |
| Dev server | `npm run dev` → http://localhost:3000 |
| Unit tests (Vitest) | `npm test` |
| Lint / typecheck | `npm run lint` · `npm run typecheck` |
| Production build / serve | `npm run build` · `npm run start` |

`predev` and `prebuild` run `scripts/copy-maplibre-worker.mjs`. It copies MapLibre's web-worker files into `public/vendor/maplibre-gl/`, which is git-ignored. MapLibre 6 finds its worker at runtime, which a bundler cannot see, so `OpsMap` points `setWorkerUrl()` at the copy.

## Environment

| Variable | Where it is used | Secret? |
|---|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | Browser reads (cameras, stations, detections, incidents, evidence images) and the server proxy's upstream URL. **Inlined at build time**, so rebuild after changing it. | No |
| `OPERATOR_API_KEY` | **Server only.** The operator proxy adds it as `X-Operator-Key`. It must equal the API's `OPERATOR_API_KEY`. | **Yes**. Never use a `NEXT_PUBLIC_` name for it. |

If `NEXT_PUBLIC_API_BASE_URL` is unset, the page shows "Not configured" and calls no URL.

## How the operator key stays server-side

```
browser ── GET (public reads) ───────────────────────────────▶ API (Render)
browser ── POST /api/operator/<action> (same origin) ──▶ Next.js route handler
                                                          + X-Operator-Key from env ──▶ API
```

- **The proxy** (`src/app/api/operator/[...path]/route.ts` → `src/lib/server/operatorProxy.ts`, marked `server-only`) forwards only these actions:
  - `detect/fire`
  - `detections/{uuid}/confirm`
  - `detections/{uuid}/reject`
  - `scenarios/{id}/start` (M5)
  - `scenarios/reset` (M5)

  Any other path gets 404.
- **Guards:**
  - Cross-site requests (an `Origin` that isn't this host) get 403.
  - Bodies over 4.5 MB get 413. This is Vercel's function body limit, so the UI caps clips at **4 MB**.
  - API errors pass through unchanged. The key is never echoed.
- **Tests:**
  - `secretBoundary.test.ts` fails if any module other than the proxy reads the key, if a `NEXT_PUBLIC_*KEY/SECRET/TOKEN` name appears, or if a client component imports server code.
  - A production build with a sentinel key value was checked: the value does not appear in `.next/static`.
- **Limitation:** there is no login (out of M4 scope). Anyone who can open the dashboard URL can use the operator actions; the key only stops it from being copied out of the browser. See Tracker K17.

## Layout

```
src/app/page.tsx                    command center (client root)
src/app/api/operator/[...path]/     server-side operator proxy (route handler, maxDuration 150 s)
src/components/command/             CommandCenter (layout + flows), TopBar, LeftRail (cameras / review /
                                    incidents / activity), CameraPanel (feed + facts + diagnostic upload),
                                    CameraFeed (feed abstraction), CityPanels (status bar, scenario
                                    controls, demo menu, activity feed), DetectionReview, IncidentPanel
                                    (+ route, StationPanel, Timeline), hooks: useOpsData (10 s polling),
                                    useScenarios (2 s while a run is live, else 10 s), useAlertSound
src/components/map/                 OpsMap (MapLibre: 3D buildings, clustered camera layer, route line,
                                    fly-to), markers.ts (pure: HTML markers + clustered GeoJSON split)
src/components/ApiStatus*.tsx       API health (used when the API URL is not configured)
src/lib/api/                        client.ts (typed OpsApi; reads direct, writes via proxy), types.ts
src/lib/server/operatorProxy.ts     server-only key boundary
src/lib/ops.ts                      labels, ordering, clip validation, PKT formatting
src/lib/city.ts                     provenance labels, city status counts, activity feed (pure)
src/test/fixtures.ts                API-shaped fixtures and a fake OpsApi for component tests
```

`AGENTS.md` / `CLAUDE.md` are generated by Next.js (an agent hint to read the bundled docs) and re-created by `next dev`.
