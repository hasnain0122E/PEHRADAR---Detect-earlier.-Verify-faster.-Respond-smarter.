import { ApiStatus } from "@/components/ApiStatus";
import { PRODUCT_NAME, PRODUCT_TAGLINE } from "@/lib/config";

// What this scaffold does and does not do. Kept honest: nothing below is built until Tracker.md says so.
const SCOPE = [
  { label: "City", value: "Karachi, Pakistan" },
  { label: "Incidents", value: "Fire and smoke only" },
  { label: "Role", value: "Decision support. An operator confirms every detection." },
];

const NOT_YET_BUILT = [
  "Operations map",
  "Video analysis and detection",
  "Evidence review",
  "Incidents, notifications and acknowledgement",
];

export default function Home() {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <div className="border-b border-dashed border-sim/60 bg-sim/10 px-4 py-1.5 text-center text-xs font-medium tracking-wide text-sim uppercase">
        Demo build · Simulated cameras · Test notifications · Not connected to any emergency
        service
      </div>

      <header className="flex h-12 items-center justify-between border-b border-ink-700 bg-ink-900 px-4">
        <div className="flex items-center gap-3">
          <span aria-hidden className="h-3 w-3 rotate-45 bg-sev-high" />
          <span className="text-base font-semibold tracking-tight">{PRODUCT_NAME}</span>
          <span className="text-sm text-ink-300">Karachi Fire Ops</span>
        </div>
        <span className="font-mono text-xs text-ink-500">M1 scaffold</span>
      </header>

      <main className="mx-auto grid w-full max-w-5xl flex-1 content-start gap-6 px-4 py-10 md:grid-cols-[1fr_22rem]">
        <section>
          <h1 className="text-2xl font-semibold tracking-tight">{PRODUCT_NAME}</h1>
          <p className="mt-1 text-ink-300">{PRODUCT_TAGLINE}</p>

          <dl className="mt-8 divide-y divide-ink-700 rounded-md border border-ink-700 bg-ink-900">
            {SCOPE.map((item) => (
              <div key={item.label} className="grid grid-cols-[7rem_1fr] gap-4 px-4 py-3 text-sm">
                <dt className="text-ink-300">{item.label}</dt>
                <dd>{item.value}</dd>
              </div>
            ))}
          </dl>

          <h2 className="mt-8 text-xs font-medium tracking-wider text-ink-300 uppercase">
            Not built yet
          </h2>
          <ul className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
            {NOT_YET_BUILT.map((item) => (
              <li
                key={item}
                className="rounded-md border border-dashed border-ink-700 px-3 py-2 text-ink-500"
              >
                {item}
              </li>
            ))}
          </ul>
        </section>

        <aside>
          <ApiStatus />
        </aside>
      </main>
    </div>
  );
}
