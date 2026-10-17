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
  unconfigured: { label: "Not configured", dot: "bg-danger", ring: "border-danger/50" },
  loading: { label: "Checking…", dot: "bg-ink-500 animate-pulse", ring: "border-ink-700" },
  connected: { label: "Connected", dot: "bg-ack", ring: "border-ack/40" },
  error: { label: "Disconnected", dot: "bg-danger", ring: "border-danger/50" },
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
      className={`rounded-md border bg-ink-900 p-4 ${view.ring}`}
    >
      <div className="flex items-center justify-between gap-4">
        <h2
          id="api-status-title"
          className="text-xs font-medium tracking-wider text-ink-300 uppercase"
        >
          Backend API
        </h2>
        <p role="status" aria-live="polite" className="flex items-center gap-2 text-sm font-medium">
          <span aria-hidden className={`h-2.5 w-2.5 rounded-full ${view.dot}`} />
          {view.label}
        </p>
      </div>

      <dl className="mt-4 grid grid-cols-[7rem_1fr] gap-y-1.5 text-sm">
        <dt className="text-ink-300">Endpoint</dt>
        <dd className="font-mono break-all">{baseUrl ?? "—"}</dd>
        {state.kind === "connected" && (
          <>
            <dt className="text-ink-300">Service</dt>
            <dd className="font-mono">
              {state.health.app} v{state.health.version}
            </dd>
          </>
        )}
        {(state.kind === "connected" || state.kind === "error") && (
          <>
            <dt className="text-ink-300">Last check</dt>
            <dd className="font-mono tabular-nums">{PKT.format(state.checkedAt)} PKT</dd>
          </>
        )}
      </dl>

      {state.kind === "unconfigured" && (
        <p className="mt-4 text-sm text-danger">
          NEXT_PUBLIC_API_BASE_URL is not set. Copy <code className="font-mono">.env.example</code>{" "}
          to <code className="font-mono">.env.local</code> and restart the dev server.
        </p>
      )}
      {state.kind === "error" && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-danger">{state.message}</p>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="rounded-md border border-ink-700 bg-ink-800 px-3 py-1.5 text-sm hover:border-ink-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
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
