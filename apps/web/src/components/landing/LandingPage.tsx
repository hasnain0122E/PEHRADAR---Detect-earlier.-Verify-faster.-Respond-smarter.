import type { ReactNode } from "react";

import { PRODUCT_TAGLINE } from "@/lib/config";

import { Icon, type IconName } from "../icons";
import { LandingShell, StartMonitoringButton } from "./StartMonitoring";

const CTA =
  "inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-[#2563eb] px-6 text-[15px] font-semibold text-white shadow-[0_8px_24px_rgb(37_99_235/0.35)] transition hover:bg-[#1d4fd8] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white";
const CTA_SECONDARY =
  "inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-white/20 px-6 text-[15px] font-semibold text-white/90 transition hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white";

const VALUES: { icon: IconName; title: string; body: string }[] = [
  {
    icon: "eye",
    title: "Detect earlier",
    body: "An AI fire and smoke model watches every connected feed and flags persistent activity across consecutive frames, not single flickers.",
  },
  {
    icon: "shield",
    title: "Verify faster",
    body: "Each alert opens straight onto its evidence frame, confidence and frame counts. One operator decision confirms or rejects it.",
  },
  {
    icon: "route",
    title: "Respond smarter",
    body: "A confirmed incident gets the nearest available fire station, a road route and a timeline. Suggestions only: nothing is dispatched automatically.",
  },
];

const STEPS: { title: string; body: string }[] = [
  { title: "Monitor", body: "Camera nodes across the city stream into one map-first console." },
  { title: "Detect", body: "The model samples frames; a temporal rule confirms fire or smoke only when it persists." },
  { title: "Verify", body: "The operator reviews the evidence and confirms or rejects. Repeat alerts from one camera merge." },
  { title: "Respond", body: "PehRadar suggests the closest available station and a road route, and records every step." },
];

const FEATURES: { icon: IconName; title: string; body: string }[] = [
  { icon: "map", title: "City-scale live map", body: "179 Karachi monitoring nodes with clustering, 3D buildings, light and dark themes." },
  { icon: "cpu", title: "Real detection model", body: "YOLOv8n fire and smoke model with a 3-of-5 frame rule and evidence capture." },
  { icon: "alert", title: "Evidence-first review", body: "Confidence, strongest frame and positive frames up front; model details on demand." },
  { icon: "fireStation", title: "Response suggestions", body: "Nearest available station from OpenStreetMap data, with an OSRM road route and ETA." },
  { icon: "history", title: "Incident timeline", body: "Detection, confirmation, merges, station and route, in the order they happened." },
  { icon: "play", title: "Demo scenarios", body: "Fire, smoke, false-alarm, interior and roadway cases, analysed by the real model." },
];

const REAL = [
  "The fire and smoke model and its decision rule",
  "Fire-station locations from OpenStreetMap",
  "Road routes and travel estimates from OSRM",
  "Every operator decision and timeline event",
];
const SIMULATED = [
  "Monitoring nodes: no official or Safe City CCTV is connected",
  "Feeds: licensed Pakistan-based demo footage, labelled as simulated",
  "Station availability: a demo flag, not live status",
  "No notification or dispatch is ever sent",
];

function Section({ id, eyebrow, title, children }: { id?: string; eyebrow: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="mx-auto grid w-full max-w-6xl gap-10 px-6 py-20 sm:px-10">
      <div className="grid max-w-2xl gap-3">
        <p className="text-xs font-semibold tracking-[0.18em] text-[#2563eb] uppercase">{eyebrow}</p>
        <h2 className="text-3xl leading-tight font-semibold tracking-tight text-[#111318] sm:text-4xl">{title}</h2>
      </div>
      {children}
    </section>
  );
}

/** Product illustration: the console's own visual language (clusters, alert pin, station, route). */
function HeroVisual() {
  return (
    <div className="relative aspect-[5/4] w-full max-w-[560px] overflow-hidden rounded-3xl border border-white/10 bg-[#0f1a2e] shadow-[0_30px_80px_rgb(0_0_0/0.45)]">
      <svg viewBox="0 0 500 400" className="absolute inset-0 h-full w-full" aria-hidden>
        <defs>
          <pattern id="grid" width="25" height="25" patternUnits="userSpaceOnUse">
            <path d="M25 0H0V25" fill="none" stroke="rgb(255 255 255 / 0.05)" />
          </pattern>
          <radialGradient id="sweep" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor="#4f8bff" stopOpacity="0.35" />
            <stop offset="1" stopColor="#4f8bff" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="500" height="400" fill="url(#grid)" />
        {/* coastline */}
        <path d="M0 330 C80 300 120 345 190 318 S300 280 360 300 S450 340 500 315 V400 H0Z" fill="#13294a" />
        {/* roads */}
        <g stroke="rgb(255 255 255 / 0.12)" strokeWidth="3" fill="none" strokeLinecap="round">
          <path d="M40 80 C150 120 230 150 300 230 S420 300 480 290" />
          <path d="M120 20 C140 120 160 200 210 300" />
          <path d="M20 200 C140 190 300 160 470 120" />
        </g>
        {/* route */}
        <path className="pr-hero-route" d="M380 120 C350 160 330 190 300 230" stroke="#4f8bff" strokeWidth="5" fill="none" strokeLinecap="round" />
        {/* radar sweep */}
        <g className="pr-hero-sweep" style={{ transformOrigin: "300px 230px" }}>
          <path d="M300 230 L300 70 A160 160 0 0 1 438 150 Z" fill="url(#sweep)" />
        </g>
        <circle cx="300" cy="230" r="160" fill="none" stroke="rgb(79 139 255 / 0.15)" />
        <circle cx="300" cy="230" r="95" fill="none" stroke="rgb(79 139 255 / 0.15)" />
        {/* clusters */}
        {[
          [90, 110, 14],
          [170, 210, 11],
          [230, 90, 9],
          [420, 220, 12],
          [120, 280, 8],
        ].map(([x, y, n]) => (
          <g key={`${x}-${y}`}>
            <circle cx={x} cy={y} r="15" fill="#1b2a44" stroke="rgb(255 255 255 / 0.2)" />
            <text x={x} y={y + 4} textAnchor="middle" fontSize="11" fontWeight="600" fill="#e9ebef">
              {n}
            </text>
          </g>
        ))}
        {/* feed nodes */}
        {[
          [60, 160],
          [200, 150],
          [350, 300],
          [450, 170],
          [260, 330],
        ].map(([x, y]) => (
          <circle key={`${x}-${y}`} cx={x} cy={y} r="5" fill="#22b573" stroke="#0f1a2e" strokeWidth="2" />
        ))}
        {/* station */}
        <rect x="368" y="106" width="26" height="26" rx="7" fill="#16a36a" stroke="#fff" strokeWidth="2" />
        {/* incident pin */}
        <g className="pr-hero-pin">
          <circle cx="300" cy="222" r="22" fill="rgb(229 72 77 / 0.25)" className="pr-hero-pulse" />
          <path d="M300 236 l-13 -13 a18 18 0 1 1 26 0z" fill="#e5484d" stroke="#fff" strokeWidth="2" />
        </g>
      </svg>
      {/* alert card */}
      <div className="absolute top-5 right-5 w-52 rounded-xl bg-white p-3.5 text-[#111318] shadow-[0_12px_32px_rgb(0_0_0/0.35)]">
        <p className="flex items-center gap-2 text-[13px] font-semibold">
          <span className="grid h-6 w-6 place-items-center rounded-full bg-[#fff7e6] text-[#b45309]">
            <Icon name="flame" size={14} />
          </span>
          Possible fire detected
        </p>
        <p className="mt-1 text-xs text-[#667085]">Korangi Industrial Area</p>
        <p className="text-xs text-[#667085]">AI confidence 73%</p>
        <span className="mt-2.5 flex h-7 items-center justify-center rounded-lg bg-[#111827] text-xs font-semibold text-white">
          Review incident
        </span>
      </div>
      {/* route card */}
      <div className="absolute bottom-5 left-5 rounded-xl bg-white/95 px-3.5 py-2.5 text-[#111318] shadow-[0_12px_32px_rgb(0_0_0/0.35)]">
        <p className="text-[11px] font-medium text-[#2563eb]">Suggested response</p>
        <p className="text-[15px] font-semibold tabular-nums">9.3 km · 12 min</p>
      </div>
    </div>
  );
}

export function LandingPage() {
  return (
    <LandingShell>
      <div className="bg-[#0b1220] text-white">
        <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-5 sm:px-10">
          <span className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-white/10 ring-1 ring-white/15">
              <Icon name="radar" size={20} />
            </span>
            <span className="text-[15px] font-semibold tracking-[0.2em]">PEHRADAR</span>
          </span>
          <nav aria-label="Page" className="hidden items-center gap-7 text-sm text-white/70 sm:flex">
            <a href="#how-it-works" className="hover:text-white">
              How it works
            </a>
            <a href="#features" className="hover:text-white">
              Features
            </a>
            <a href="#operator" className="hover:text-white">
              Operator in the loop
            </a>
          </nav>
        </header>

        <section className="mx-auto grid w-full max-w-6xl items-center gap-12 px-6 pt-10 pb-24 sm:px-10 lg:grid-cols-[1.05fr_1fr] lg:pt-16">
          <div className="grid gap-7">
            <p className="inline-flex w-fit items-center gap-2 rounded-full border border-white/15 px-3 py-1 text-xs font-medium text-white/80">
              <span className="h-1.5 w-1.5 rounded-full bg-[#22b573]" />
              Karachi demo environment
            </p>
            <h1 className="grid gap-3">
              <span className="text-5xl font-semibold tracking-[0.12em] sm:text-6xl">PEHRADAR</span>
              <span className="text-2xl leading-snug font-medium text-white/90 sm:text-3xl">{PRODUCT_TAGLINE}</span>
            </h1>
            <p className="max-w-xl text-lg leading-relaxed text-white/70">
              AI-powered fire monitoring and emergency response command center for urban environments.
            </p>
            <div className="flex flex-wrap gap-3">
              <StartMonitoringButton className={CTA} />
              <a href="#features" className={CTA_SECONDARY}>
                View Features
              </a>
            </div>
          </div>
          <div className="flex justify-center lg:justify-end">
            <HeroVisual />
          </div>
        </section>
      </div>

      <main className="bg-[#f5f6f7]">
        <Section eyebrow="Why PehRadar" title="Minutes matter between the first flame and the first response.">
          <div className="grid gap-5 md:grid-cols-3">
            {VALUES.map((v) => (
              <article key={v.title} className="grid content-start gap-3 rounded-2xl border border-[#e7e9ec] bg-white p-6">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#eff4ff] text-[#2563eb]">
                  <Icon name={v.icon} size={20} />
                </span>
                <h3 className="text-lg font-semibold text-[#111318]">{v.title}</h3>
                <p className="text-[15px] leading-relaxed text-[#667085]">{v.body}</p>
              </article>
            ))}
          </div>
        </Section>

        <Section id="how-it-works" eyebrow="How it works" title="From camera frame to suggested response, in four steps.">
          <ol className="grid gap-5 md:grid-cols-4">
            {STEPS.map((s, i) => (
              <li key={s.title} className="relative grid content-start gap-3 rounded-2xl border border-[#e7e9ec] bg-white p-6">
                <span className="text-sm font-semibold text-[#2563eb] tabular-nums">0{i + 1}</span>
                <h3 className="text-lg font-semibold text-[#111318]">{s.title}</h3>
                <p className="text-[15px] leading-relaxed text-[#667085]">{s.body}</p>
              </li>
            ))}
          </ol>
        </Section>

        <Section id="features" eyebrow="Key features" title="Everything an operator needs, nothing they don’t.">
          <div className="grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.title} className="flex gap-4">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white text-[#111318] ring-1 ring-[#e7e9ec]">
                  <Icon name={f.icon} size={20} />
                </span>
                <div className="grid gap-1">
                  <h3 className="text-[15px] font-semibold text-[#111318]">{f.title}</h3>
                  <p className="text-[15px] leading-relaxed text-[#667085]">{f.body}</p>
                </div>
              </div>
            ))}
          </div>
        </Section>

        <Section id="operator" eyebrow="Demo realism" title="A human confirms every incident. The demo says what is real.">
          <div className="grid gap-5 md:grid-cols-2">
            <div className="grid content-start gap-4 rounded-2xl border border-[#e7e9ec] bg-white p-6">
              <h3 className="flex items-center gap-2 text-lg font-semibold text-[#111318]">
                <Icon name="check" size={18} className="text-[#16a36a]" />
                Real in this demo
              </h3>
              <ul className="grid gap-2.5 text-[15px] text-[#667085]">
                {REAL.map((r) => (
                  <li key={r} className="flex gap-2.5">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#16a36a]" />
                    {r}
                  </li>
                ))}
              </ul>
            </div>
            <div className="grid content-start gap-4 rounded-2xl border border-[#e7e9ec] bg-white p-6">
              <h3 className="flex items-center gap-2 text-lg font-semibold text-[#111318]">
                <Icon name="info" size={18} className="text-[#667085]" />
                Simulated for the hackathon
              </h3>
              <ul className="grid gap-2.5 text-[15px] text-[#667085]">
                {SIMULATED.map((r) => (
                  <li key={r} className="flex gap-2.5">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#98a2b3]" />
                    {r}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <p className="flex max-w-3xl items-start gap-3 rounded-2xl bg-[#111827] p-6 text-[15px] leading-relaxed text-white/80">
            <Icon name="user" size={20} className="mt-0.5 text-white" />
            The AI never confirms anything on its own. It raises an alert with its evidence; the operator decides. Every
            decision, merge and suggestion is written to the incident timeline.
          </p>
        </Section>

        <section className="bg-[#0b1220]">
          <div className="mx-auto grid w-full max-w-6xl justify-items-center gap-6 px-6 py-24 text-center sm:px-10">
            <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">See it work on a live Karachi map.</h2>
            <p className="max-w-xl text-lg text-white/70">Run a fire scenario, review the evidence, confirm, and follow the suggested route.</p>
            <StartMonitoringButton className={CTA} />
          </div>
        </section>
      </main>

      <footer className="bg-[#0b1220] text-white/50">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 border-t border-white/10 px-6 py-6 text-[13px] sm:px-10">
          <span>PehRadar · hackathon demo. Not connected to any emergency service.</span>
          <span>Map data © OpenStreetMap contributors</span>
        </div>
      </footer>
    </LandingShell>
  );
}
