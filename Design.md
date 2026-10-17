# PehRadar — Design Specification

**Status:** Draft v0.1 (M0). Target design for M6 (vertical-slice UI) and M9 (polish). §0 (M4) and §0.1 (M5) record what is built.
**Design intent:** a control-room instrument, not a "SaaS analytics" dashboard. One question drives every screen: *what does the operator need to decide right now, and what evidence supports it?* The UI is dense, calm, and high-contrast. Colour is reserved for state. Motion is used only to draw attention to something new.

What we deliberately avoid: gradient hero cards, KPI tiles with sparklines, glassmorphism, purple-AI accents, chat bubbles, decorative illustrations, and "AI-powered" badges.

---

## 0. M4 implementation status (2026-10-17)

The M4 command center (`apps/web`, user brief) implements the core of this spec on one screen. Where it differs from the target below, the M4 behaviour is:

| Area | Implemented in M4 | Differs from the target spec |
|---|---|---|
| Layout | Demo banner, top bar, left rail, map, context panel, slim footer. Rail 300 px / panel 400 px; 340 / 460 px at ≥ 1536 px. | Below 1024 px the three areas become tabs (Queues / Map / Details), not drawers or a bottom sheet. Panel is not resizable. |
| Rail | Three tabs: **Cameras** (search), **Review** (pending detections), **Incidents** (active first, then severity, then newest; closed ones below a divider). | Adds a Cameras tab. No escalation pinning (no dedup yet). |
| Top bar | Wordmark, "Karachi Fire Department · Command Center", tagline, operational-state chip, API pill with retry, last sync (PKT), alert-sound toggle. | No operator-label menu or access-key dialog: the operator key stays server-side (Tracker D36). |
| Map | MapLibre GL JS 6.11.2, OpenFreeMap **dark** style (no API key). Fits all cameras and stations on load. Selecting an item eases to it; an incident is framed together with its candidate station. Layer toggles (cameras / stations / incidents) and a legend. | No 3D, no routes, no history layer toggle (closed incidents show only while selected). |
| Markers | Camera: dashed violet rounded square with a camera glyph. Pending detections: amber fill + count badge. Active incident: red corner diamond. Analysing: rotating ring. Selected: focus ring + label. Station: shield. Unavailable: dashed outline + ×. Candidate: filled blue. Incident: diamond with ▲/◆/● glyph and a pulse ring; closed incidents grey. | As §7.2. Markers are HTML elements, so hit targets are ≥ 32 px and each has an `aria-label`. |
| Camera panel | Details, a file picker for a local MP4 (client checks: `.mp4`, video/mp4, ≤ 4 MB), staged progress. | No sample selector, video player or job list (no analysis jobs yet). |
| Progress | **Uploading** shows the real upload percentage (XHR progress). The server steps (analyzing frames → temporal consistency → evidence) share one indeterminate bar, an elapsed-seconds counter and a note that the server reports no partial progress. | Overrides §13 "never an indeterminate spinner for jobs": the synchronous API gives no progress numbers, and inventing them is not allowed. |
| Evidence review | Header, evidence image (opens full size), class chips, large peak confidence, strongest-frame offset, positive / sampled frames, decision rule, camera location, model, processing time, per-class result, decision-support line. Reject / Confirm, sticky. | Two-step inline confirmation instead of dialogs. No severity picker (severity is set by the API rule on confirmation). No keyboard shortcuts except `Esc`. |
| Negative result | "No persistent fire or smoke event detected." plus a not-a-safety-confirmation line, frames analysed, processing time, peak model confidence, and **Analyze another clip**. | New in M4. |
| Incident panel | Event, severity, status, simulated badge, location, evidence, confidence, confirmation time/operator, candidate station (OSM · UNVERIFIED badge, straight-line km, demo-availability note) and the fixed line "Candidate station based on geographic proximity. Not a dispatch confirmation." Timeline: only events that happened, colour rule + label + actor + elapsed chips. | No notify, acknowledge or resolve actions (M5). |
| Alerts | A new pending detection or confirmed incident (seen in the 10 s poll, or the operator's own positive result) adds an amber alert strip with **Review now / Open incident** (`aria-live="assertive"`), up to 3 stacked. The rail's Review badge pulses. | Audio follows §12: off by default, **Enable alert sound** creates the Web Audio context on that click and plays a test chime. Rate limited to 1 per 3 s. No volume slider. |

Lucide is not installed; the few icons are inline SVG or text glyphs.

## 0.1 M5 implementation status (2026-10-17)

| Area | Implemented in M5 |
|---|---|
| Header | Demo banner now states "Simulated monitoring network and licensed sample footage · No official or Safe City CCTV connected". Top bar adds **Demo scenarios** (popover; "● Demo running" while a run is live). |
| City status bar | One row under the top bar with Monitoring nodes · Public/demo feeds · Feeds online · Pending alerts · Active incidents · Available facilities (x/y, demo flag). Every number is counted from API data; tooltips explain each. Right side shows the live scenario or "Simulated network · no official CCTV connected". |
| Map | 3D by default (pitch 52°, bearing −17°) with a **3D / 2D** toggle. Buildings are extruded from OSM footprints from zoom 13.5 (sparse in Karachi; see K25). Quiet coverage nodes are violet clusters with counts and expand on click; individual nodes are small violet dots, and the mapped location is a white ring. Feed nodes are solid blue camera markers with a live dot and permanent label. Alerting cameras pulse amber. The route is a blue line with a dark casing. A vignette keeps markers readable. The legend explains every symbol and states that no official CCTV is connected. |
| Feed viewer | 16:9 frame. Tag top-left (**SIMULATED LIVE FEED** dashed violet; **PUBLIC LIVE FEED** solid green, only for `public_live`), code top-right, provenance caption at the bottom. The unavailable state uses a hatched background with the reason ("Feed unavailable in hackathon environment: simulated coverage node"). |
| Camera panel | Code · district eyebrow, name, source badge, feed, facts (monitoring, feed, source type, source reference, last activity, coordinates), scenario note on demo nodes, and the diagnostic upload below. |
| Evidence review | Adds a compact camera feed above a labelled "AI evidence frame", plus coordinates, source and input (scenario or upload) rows. |
| Incident panel | Route block under the candidate station: two numeric tiles (road distance, estimated travel), provider/profile/generated time, free-flow caveat, and the fixed "Route is an estimate. Not a dispatch confirmation." Facility type and operator on the station. |
| Rail | Fourth tab **Activity**. The camera list gains source filters (All / Feeds / Simulated / Mapped) with a count, and sorts alerting and feed cameras first. Each row shows feed status and a source badge. |
| Overview | City overview: counts, demo scenarios (Start, status, T−countdown, peak confidence, two-step Reset demo), and the 8 most recent activity entries. |
| Activity feed | Time (PKT) · tone dot · camera code · message. Built only from real records: scenario runs, detections, incidents and routes, plus this console's own review and reject actions. Click to open the related item. |

Copy rules added: never "dispatched"; the route is a "Suggested response route"; demo footage is never called CCTV.

## 1. Layout

Desktop-first (operators sit at a workstation). Target ≥ 1280 × 720. Optimised for 1920 × 1080.

```
┌────────────────────────────────────────────────────────────────────────────────────────────────┐
│ DEMO BANNER  ▸ Simulated cameras · Test notifications · Not connected to any emergency service │  28px, always visible
├────────────────────────────────────────────────────────────────────────────────────────────────┤
│ ◉ PehRadar  Karachi Fire Ops │ API ● online  · Last sync 14:32:07 PKT │ 🔔 Audio: off │ Op: A ▾ │  48px top bar
├───────────────┬────────────────────────────────────────────────────────┬───────────────────────┤
│ LEFT RAIL     │                                                        │ CONTEXT PANEL         │
│ 360px         │                    MAP (fills)                         │ 440px (resizable      │
│ ┌───────────┐ │                                                        │  400–560)             │
│ │Review (3) │ │   layer toggles ▢Cameras ▢Stations ▢Incidents ▢3D     │                       │
│ │Incidents 2│ │                                                        │ Camera | Detection    │
│ └───────────┘ │                                                        │ review | Incident     │
│ queue cards…  │                                                        │ (one at a time)       │
│               │                         legend ▸ bottom-left           │                       │
└───────────────┴────────────────────────────────────────────────────────┴───────────────────────┘
```

- **Left rail:** two tabs. **Review** holds pending detections, newest first, with escalations pinned on top. **Incidents** holds active incidents ordered by severity, then age. Tab badges show counts. The Review badge pulses amber when it is above 0.
- **Map:** always visible. It is the shared spatial reference. Selecting an item in the rail flies the map to it (≤ 600 ms ease-out, no flight when "reduce motion" is set).
- **Context panel:** shows exactly one of Camera / Detection Review / Incident. A breadcrumb lets the operator step back (e.g. Incident → its source Detection). Closing the panel gives the map the full width.
- **No page navigation inside the dashboard.** Everything happens on one screen. The only other route is `/ack/[token]` (recipient page).

## 2. Responsive behaviour

| Width | Behaviour |
|---|---|
| ≥ 1600 | As above. Context panel 480 px. |
| 1280–1599 | Left rail 320 px, context panel 420 px. |
| 1024–1279 | Left rail collapses to a 56 px icon strip with count badges, and expands as an overlay. The context panel overlays the map from the right. |
| 768–1023 | Read-mostly: the map and a bottom sheet for rail and panel. Review actions still work. |
| < 768 | Dashboard shows "Use a desktop for operations" plus a read-only incident list. **The `/ack/[token]` page is mobile-first** because recipients are likely to use phones. |

## 3. Typography

| Token | Font | Size / line | Use |
|---|---|---|---|
| `font-ui` | **IBM Plex Sans** (OFL, via `next/font`) | — | All UI text. Chosen for legibility at small sizes and an engineered, non-generic tone. |
| `font-data` | **IBM Plex Mono** | — | Timestamps, coordinates, IDs, confidence values, video offsets. Tabular figures. |
| `text-xs` | Plex Sans 12/16 | | Meta labels, badges (uppercase, +4% tracking) |
| `text-sm` | 13/18 | | Dense lists, table cells |
| `text-base` | 14/20 | | Body default |
| `text-md` | 16/22, 500 | | Panel section titles |
| `text-lg` | 20/26, 600 | | Panel headline (incident reference, camera name) |
| `text-xl` | 28/32, 600 Mono | | Large confidence readout in evidence review |

Numbers that update (clock, progress, confidence) use `font-variant-numeric: tabular-nums` so they don't jitter.

## 4. Colour tokens

Dark theme by default (control rooms are dim, and the map reads better). A light theme is not in the MVP.

### 4.1 Neutrals (Tailwind theme extension `colors.ink`)
| Token | Hex | Use |
|---|---|---|
| `ink-950` | `#0A0D12` | App background |
| `ink-900` | `#10151C` | Panels, rail |
| `ink-850` | `#151B24` | Cards |
| `ink-800` | `#1C2430` | Hover, input background |
| `ink-700` | `#2A3442` | Borders, dividers |
| `ink-500` | `#5B6878` | Disabled text, tertiary icons |
| `ink-300` | `#9AA6B5` | Secondary text |
| `ink-100` | `#E6EBF1` | Primary text |

### 4.2 State colours (reserved, never used decoratively)
| Token | Hex | Meaning |
|---|---|---|
| `sev-high` | `#FF4D3D` | Severity HIGH; FIRE class chip |
| `sev-medium` | `#FF9F1C` | Severity MEDIUM |
| `sev-low` | `#F2D45C` | Severity LOW; SMOKE class chip uses `#B8C2CC` grey with an outline |
| `review` | `#FFB020` | Pending review (amber) |
| `notified` | `#3DA5FF` | NOTIFIED |
| `ack` | `#2FD1A1` | ACKNOWLEDGED / success |
| `resolved` | `#6B7685` | RESOLVED (muted) |
| `danger` | `#FF4D6A` | Errors, failed notification, destructive confirm |
| `sim` | `#B39DFF` | SIMULATED / TEST / UNVERIFIED provenance badges. Always paired with a dashed border. |
| `focus` | `#7CC4FF` | Focus ring (2 px + 2 px offset) |

**Rules:**
- State is never conveyed by colour alone. Every coloured element also carries a text label or icon shape (e.g. severity uses ▲ HIGH / ◆ MEDIUM / ● LOW).
- All text/background pairs meet WCAG AA (4.5:1). For example, `ink-100` on `ink-900` is ≈ 14:1, and `review` amber text on `ink-900` is ≈ 9:1. Contrast is verified in M9 with a checker tool, and the measured results are recorded.
- The provenance colour (`sim` violet) is deliberately distinct from every state colour, so "simulated" is never confused with "severity".

## 5. Spacing, shape, elevation

- Spacing scale is 4 px based: `1=4, 2=8, 3=12, 4=16, 6=24, 8=32`. Panels use 16 px padding, cards 12 px, dense list rows 8 px vertical.
- Radius: 6 px for cards and inputs, 4 px for badges, 10 px for modals. No pill-shaped buttons.
- Elevation is expressed through borders (`ink-700`), not shadows. Modals get a single shadow plus a 60% `ink-950` backdrop.
- Icon set: **Lucide** (ISC licence), 16 px in lists, 20 px in headers.

## 6. Component inventory

| Component | Description | States |
|---|---|---|
| `DemoBanner` | Full-width violet-outlined strip with fixed copy (PRD FR-28). Cannot be dismissed. | — |
| `TopBar` | Product mark, "Karachi Fire Ops", API status pill, last-sync time (PKT), audio control, operator label menu. | API: online / degraded / offline |
| `ApiStatusPill` | ● online (ack green), ◐ slow (> 2 s responses), ○ offline with retry countdown | |
| `AccessKeyDialog` | First-run prompt for the operator key and operator label. | idle / validating / invalid |
| `RailTabs` | Review / Incidents with count badges | |
| `DetectionCard` | Thumbnail (evidence, 96×54), class chips, peak confidence, camera name, relative time ("2 min ago") plus absolute PKT on hover, `+N similar` badge, ESCALATION tag, SIMULATED tag | default / hover / selected / new (2 s amber flash) |
| `IncidentCard` | Reference, severity glyph+label, status chip, camera/area, age, assigned station, notification-failed badge | per status |
| `MapView` | MapLibre map with layers below | loading / ready / tiles-failed |
| `MapLegend` | Marker meanings, provenance note, OSM attribution | collapsed / expanded |
| `LayerToggles` | Cameras / Stations / Incidents / Routes / 3D buildings (off by default; disabled with tooltip when the style lacks building data) | |
| `CameraPanel` | Header (name, code, SIMULATED), coordinates (mono), area, sample selector, upload dropzone, Start button, job progress, video player, recent jobs list | idle / uploading / queued / processing / completed / failed / busy |
| `JobProgress` | Linear bar, "Frame 84 / 240 · 42 s of 120 s", detections-so-far counter | |
| `EvidenceViewer` | Evidence JPEG at panel width, toggle for box overlay, click to enlarge (lightbox), the watermark is part of the image | loading (skeleton at 16:9) / loaded / purged / error |
| `DetectionFacts` | Definition list: classes, peak confidence (large mono), video offset `00:42.5` with "jump to" action, detected at (PKT), detector name+version, suggested severity, prior-rejection hint, duplicates | |
| `ReviewActions` | **Reject** (secondary, left) and **Confirm** (primary, right), with shortcut hints `R` / `C`. Sticky at the panel bottom. | enabled / submitting / disabled (already reviewed) |
| `ConfirmDialog` | Severity segmented control (prefilled with suggestion, labelled "suggested: MEDIUM"), optional note, "Confirm as incident" button | |
| `RejectDialog` | Required reason radio list, note (required for OTHER) | |
| `IncidentPanel` | Header (reference, severity, status), location, source detection link, station candidates, notification section, timeline, resolve action | per status |
| `StationCandidateList` | Rank, name, provenance badge (`OSM · UNVERIFIED`), distance, duration or "straight-line estimate", Assign button. The assigned row is highlighted. | routing ok / fallback (amber note + Refresh) |
| `NotifyAlertModal` | See §9 | |
| `NotificationRow` | Channel icon, recipient label, status chip, sent time, attempts, error text, Retry | QUEUED / SENT / FAILED / ACKNOWLEDGED |
| `Timeline` | See §10 | |
| `ResolveDialog` | Resolution code (required), note | |
| `AudioControl` | See §11 | |
| `Toast` | Bottom-right, max 3 stacked, 5 s, errors persist until dismissed | info / success / error |
| `EmptyState`, `ErrorState`, `Skeleton` | See §12 | |
| `AckPage` | Mobile-first recipient page (§13) | |

## 7. Map

### 7.1 Basemap
A dark vector style (source decided in M2: OpenFreeMap "dark" variant, or MapTiler "dataviz-dark"). Labels are de-emphasized so markers dominate. Default view: centre `24.8607, 67.0011`, zoom 11, pitch 0. With 3D on, pitch 50 and bearing −15.

### 7.2 Markers and states

| Entity | Shape | Default | Variants |
|---|---|---|---|
| Camera | Rounded square 20 px, camera glyph, dashed `sim` outline (= simulated) | `ink-300` fill | **Analysing:** rotating 1.5 s ring (`notified` blue). **Pending review:** amber fill + count badge. **Has active incident:** small severity dot at the corner. **Inactive:** 40% opacity. **Selected:** 2 px `focus` ring + label. |
| Fire station | Shield 20 px, flame-free icon (to avoid confusion with incidents) | `ink-100` outline | **Candidate:** numbered badge 1–3. **Assigned:** filled `notified` blue. **UNVERIFIED** is always shown in the popup, never hidden. |
| Incident | Diamond 28 px with severity glyph | severity colour fill | **OPEN:** 2 s pulse ring (pulse disabled under reduce-motion, replaced by a thicker ring). **NOTIFIED:** blue outer ring. **ACKNOWLEDGED:** green outer ring. **RESOLVED:** hidden unless the history layer is on, then grey. **Selected:** scale 1.15. |
| Route | Line 4 px `notified` blue, solid = `ROAD_NETWORK`, dashed 6-4 = `STRAIGHT_LINE` | | A mid-line label shows distance/duration plus the disclaimer icon (ⓘ). The tooltip text is fixed (Techspec §7.3). |

Clustering is not needed (≤ 50 markers). Hit target is ≥ 32 px for every marker.

### 7.3 3D buildings (M9, optional)
`fill-extrusion` layer `ink-800` at 0.7 opacity. Only shown at zoom ≥ 14. When on, a corner note appears: "Approximate building footprints © OpenStreetMap — heights estimated". The toggle is disabled with an explanation if the tile source has no building layer.

## 8. Incident severity presentation

| Severity | Glyph | Colour | Card treatment |
|---|---|---|---|
| HIGH | ▲ | `sev-high` | 3 px left border, severity label in bold |
| MEDIUM | ◆ | `sev-medium` | 3 px left border |
| LOW | ● | `sev-low` | 3 px left border |

"Suggested" severity (from the detector rule) is always written as `Suggested: MEDIUM` in `ink-300`. Operator-set severity is shown plain, so it is always clear which one is the human decision.

## 9. Evidence review (the core screen)

Order matters. The operator should be able to decide from the top half of the panel.

1. **Header:** camera name + SIMULATED badge, PKT time, `ESCALATION` tag if applicable.
2. **Evidence image** (full panel width, 16:9). Box overlay is on by default and toggles with `B`. A lightbox opens on click or `Space`.
3. **Big readout row:** class chips (FIRE red / SMOKE grey outlined), `Peak confidence 0.82` (mono xl), `Suggested: HIGH`.
4. **Facts list:** video offset (with jump-to), duration seen (first→last offset), positive frames, detector name/version, duplicates (`+2 similar` expandable list of thumbnails).
5. **Context hint:** if the camera had a rejection within the last hour, an amber info line.
6. **Decision-support disclaimer** (one line, `ink-300`): "Automated detection can be wrong. Confirm only if the evidence shows fire or smoke."
7. **Sticky actions:** Reject (`R`) / Confirm (`C`). `J` / `K` move to the next/previous card in the queue.

## 10. Alert modal (Notify station)

```
┌──────────────────────────────────────────────────────────────┐
│  Send TEST notification                                  ✕   │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ TEST ONLY · This does not dispatch any real fire service │ │  violet dashed box
│ └──────────────────────────────────────────────────────────┘ │
│  Incident     PR-20261017-0003 · ▲ HIGH · Korangi (sim.)    │
│  Station      Korangi Fire Station · OSM · UNVERIFIED       │
│  Recipient    Test recipient (demo) — standing in for       │
│               Korangi Fire Station                          │
│  Channel      ◉ Email   ○ Webhook        (only configured)  │
│  Preview  ▾   [TEST — PehRadar demo] Possible fire …        │
│                                                              │
│                         [ Cancel ]  [ Send test notification ]│
└──────────────────────────────────────────────────────────────┘
```

- The primary button is the only red-filled (`danger`) button in the whole app, because this is the consequential action.
- Focus starts on **Cancel**. Esc cancels.
- While sending, the button shows a spinner and "Sending…". Both buttons are disabled and the modal cannot be dismissed. The modal closes on SENT. On FAILED it stays open and shows the error inline with a Retry button.

## 11. Timeline

A vertical list in the incident panel, oldest first, with the current-state header pinned above it.

- Each row has a time (PKT, mono, `HH:mm:ss`), an actor glyph (⚙ system / 👤 operator / ✉ recipient, as Lucide icons, not emoji), the event label, and an optional one-line detail (e.g. "Assigned Korangi Fire Station (rank 1, straight-line 3.2 km)").
- Rows are colour-keyed with a 2 px left rule (`review`, `notified`, `ack`, `danger`, `resolved`).
- `DETECTION_CREATED` rows are backdated and marked "(detected)".
- Notes use a quote style. An "Add note" input sits at the bottom (Enter to submit, 1000-character counter).
- Elapsed-time chips between rows ("+1m 12s") show how quickly the response progressed. This makes the "verify faster" claim visible.

## 12. Audio controls

- Default is **off**. Browsers block autoplay, and surprise sound is hostile.
- `AudioControl` in the top bar: a speaker icon, then a click to "Enable alert sound". Once enabled, there is a mute toggle and a volume slider (0–100, default 60) in a popover, persisted in `localStorage`.
- Sound is a short two-tone chime synthesized with the Web Audio API (no audio file, so no licensing issue). It plays once per new `PENDING_REVIEW` detection and twice for an ESCALATION. Chimes are rate-limited to 1 per 3 s.
- Every sound is paired with a visual cue (card flash + tab badge pulse). Audio is never the only signal.

## 13. Interface states

| State | Treatment |
|---|---|
| **Loading** | Skeleton blocks matching final layout (cards, panel sections). The map shows the style background with a small "Loading map…" chip. No full-screen spinners. |
| **Empty: review queue** | Icon + "No detections awaiting review." + secondary line "Run a sample video from any camera to start." |
| **Empty: incidents** | "No active incidents." |
| **Empty: candidate stations** | "No demo stations configured" (seed problem). Notify stays disabled. |
| **Error: API offline** | Top-bar pill turns red. Rail shows a stale banner "Data may be out of date — last sync 40 s ago". Actions are disabled with a tooltip "API offline". |
| **Error: action failed** | Inline error at the action site with the API `message`. A toast only for background failures. |
| **Error: map tiles failed** | The map area shows "Map tiles unavailable" over a plain background. Markers still render on a blank canvas using coordinates, so the workflow continues. |
| **Disabled** | 40% opacity, `cursor: not-allowed`, and a tooltip that explains why (e.g. "Assign a station first", "Incident resolved"). Disabled controls are never hidden without explanation. |
| **Success** | Brief inline confirmation (e.g. green check "Incident PR-…-0003 created"). The map flies to the new incident. |
| **Busy / processing** | Progress with numbers. Never an indeterminate spinner for jobs. |

## 14. Recipient acknowledgement page (`/ack/[token]`)

Mobile-first, single column, max-width 480 px, large tap targets (≥ 48 px).
1. Violet TEST banner: "This is a PehRadar test notification. No real emergency has been dispatched."
2. Incident reference, severity, area, approximate location (static coordinates + "Open in maps" link), time confirmed (PKT), suggested station.
3. **Acknowledge** button (full-width, `ack` green). Optional "Your name" field (≤ 80 chars).
4. After POST: "Acknowledged at 14:35 PKT. The operator can see this." The states for expired / used / invalid tokens follow Appflow §2.7.
5. No evidence image, no operator labels, no other incidents.

## 15. Keyboard and accessibility

- Shortcuts are active only when no input is focused: `C` confirm, `R` reject, `J`/`K` next/prev card, `B` toggle boxes, `Space` enlarge evidence, `Esc` close dialog/panel, `?` shortcut sheet.
- All dialogs trap focus and restore it on close. Visible focus rings everywhere.
- `aria-live="polite"` region announces "New detection from <camera>". Errors use `assertive`.
- `prefers-reduced-motion` disables pulses, map flights and card flashes (replaced by static emphasis).

## 16. Copy rules

- Say "possible fire", "detection", "suggested". Never "fire confirmed by AI".
- Say "notification sent to test recipient". Never "fire brigade dispatched".
- Say "suggested route". Never "fastest/safe route".
- Times are always PKT with an explicit label in headers ("14:32:07 PKT").
