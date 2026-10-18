"use client";

import { getApiBaseUrl } from "@/lib/config";

import { type ApiHealthState, useApiHealth } from "./useApiHealth";

const PKT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Karachi",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

const VIEW = {
  unconfigured: { label: "Not configured", dot: "bg-fire", ring: "border-fire/40" },
  loading: { label: "Checking…", dot: "bg-fg-3 animate-pulse", ring: "border-line" },
  connected: { label: "Connected", dot: "bg-ok", ring: "border-ok/40" },
  error: { label: "Disconnected", dot: "bg-fire", ring: "border-fire/40" },
} as const;

export function ApiStatusView({
  state,
  baseUrl,
  onRetry,
}: {
  state: ApiHealthState;
  baseUrl: string | null;
  onRetry?: () => void;
}) {
  const view = VIEW[state.kind];

  return (
    <section
      aria-labelledby="api-status-title"
      className={`rounded-xl border bg-surface p-5 ${view.ring}`}
    >
      <div className="flex items-center justify-between gap-4">
        <h2
          id="api-status-title"
          className="text-xs font-medium tracking-wider text-fg-2 uppercase"
        >
          Backend API
        </h2>
        <p role="status" aria-live="polite" className="flex items-center gap-2 text-sm font-medium">
          <span aria-hidden className={`h-2.5 w-2.5 rounded-full ${view.dot}`} />
          {view.label}
        </p>
      </div>

      <dl className="mt-4 grid grid-cols-[7rem_1fr] gap-y-1.5 text-sm">
        <dt className="text-fg-2">Endpoint</dt>
        <dd className="font-mono break-all">{baseUrl ?? "—"}</dd>
        {state.kind === "connected" && (
          <>
            <dt className="text-fg-2">Service</dt>
            <dd className="font-mono">
              {state.health.app} v{state.health.version}
            </dd>
          </>
        )}
        {(state.kind === "connected" || state.kind === "error") && (
          <>
            <dt className="text-fg-2">Last check</dt>
            <dd className="font-mono tabular-nums">{PKT.format(state.checkedAt)} PKT</dd>
          </>
        )}
      </dl>

      {state.kind === "unconfigured" && (
        <p className="mt-4 text-sm text-fire-ink">
          NEXT_PUBLIC_API_BASE_URL is not set. Copy <code className="font-mono">.env.example</code>{" "}
          to <code className="font-mono">.env.local</code> and restart the dev server.
        </p>
      )}
      {state.kind === "error" && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-fire-ink">{state.message}</p>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="h-9 rounded-lg border border-line bg-surface px-3.5 text-sm font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-info"
            >
              Retry now
            </button>
          )}
        </div>
      )}
    </section>
  );
}

export function ApiStatus({ fetchImpl }: { fetchImpl?: typeof fetch }) {
  const baseUrl = getApiBaseUrl();
  const { state, recheck } = useApiHealth(baseUrl, fetchImpl);
  return <ApiStatusView state={state} baseUrl={baseUrl} onRetry={recheck} />;
}
