"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError, getHealth, type HealthResponse } from "@/lib/api/client";

export type ApiHealthState =
  | { kind: "unconfigured" }
  | { kind: "loading" }
  | { kind: "connected"; health: HealthResponse; checkedAt: Date }
  | { kind: "error"; message: string; checkedAt: Date };

export const HEALTH_POLL_MS = 15_000;

async function probe(
  baseUrl: string,
  fetchImpl: typeof fetch | undefined,
  signal: AbortSignal,
): Promise<ApiHealthState> {
  try {
    const health = await getHealth({ baseUrl, fetchImpl }, signal);
    return { kind: "connected", health, checkedAt: new Date() };
  } catch (err) {
    const message = err instanceof ApiError ? err.message : "Unexpected error checking the API";
    return { kind: "error", message, checkedAt: new Date() };
  }
}

export function useApiHealth(baseUrl: string | null, fetchImpl?: typeof fetch) {
  const [state, setState] = useState<ApiHealthState>(
    baseUrl ? { kind: "loading" } : { kind: "unconfigured" },
  );
  const inFlight = useRef<AbortController | null>(null);

  const check = useCallback(() => {
    if (!baseUrl) return;
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    void probe(baseUrl, fetchImpl, controller.signal).then((next) => {
      // A newer check (or unmount) superseded this one; drop its result.
      if (!controller.signal.aborted) setState(next);
    });
  }, [baseUrl, fetchImpl]);

  useEffect(() => {
    if (!baseUrl) return;
    // Check on mount, then keep polling so the indicator stays honest if the API stops.
    check();
    const id = setInterval(check, HEALTH_POLL_MS);
    return () => {
      clearInterval(id);
      inFlight.current?.abort();
    };
  }, [baseUrl, check]);

  return { state, recheck: check };
}
