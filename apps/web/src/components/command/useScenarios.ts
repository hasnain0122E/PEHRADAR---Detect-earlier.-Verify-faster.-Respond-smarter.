"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { OpsApi } from "@/lib/api/client";
import type { Scenario, ScenarioRun } from "@/lib/api/types";
import { isLiveRun } from "@/lib/city";
import { POLL_MS } from "@/lib/ops";

import { describeError } from "./useOpsData";

/** Faster polling only while a run is armed or analysing; one request covers every scenario. */
export const SCENARIO_LIVE_POLL_MS = 2_000;

export interface ScenarioState {
  status: "loading" | "ready" | "error";
  enabled: boolean;
  items: Scenario[];
  disclaimer: string | null;
  /** server clock − browser clock, for the countdown. */
  offsetMs: number;
  error: string | null;
}

const INITIAL: ScenarioState = {
  status: "loading",
  enabled: false,
  items: [],
  disclaimer: null,
  offsetMs: 0,
  error: null,
};

/**
 * Demo scenarios (M5). `onFinished` fires once per run when it leaves scheduled/running, so the
 * command center can reload detections right away instead of waiting for its 10 s poll.
 */
export function useScenarios(api: OpsApi, onFinished?: (run: ScenarioRun) => void) {
  const [state, setState] = useState<ScenarioState>(INITIAL);
  const onFinishedRef = useRef(onFinished);
  useEffect(() => {
    onFinishedRef.current = onFinished;
  });
  const live = useRef(new Set<string>());

  const refresh = useCallback(async () => {
    try {
      const body = await api.listScenarios();
      const offsetMs = new Date(body.server_time).getTime() - Date.now();
      for (const s of body.items) {
        const run = s.latest_run;
        if (!run) continue;
        if (isLiveRun(s)) live.current.add(run.id);
        else if (live.current.delete(run.id)) onFinishedRef.current?.(run);
      }
      setState({
        status: "ready",
        enabled: body.enabled,
        items: body.items,
        disclaimer: body.disclaimer ?? null,
        offsetMs: Number.isFinite(offsetMs) ? offsetMs : 0,
        error: null,
      });
    } catch (err) {
      setState((prev) => ({
        ...prev,
        status: prev.status === "ready" ? "ready" : "error",
        error: describeError(err, "Could not load demo scenarios"),
      }));
    }
  }, [api]);

  const anyLive = state.items.some(isLiveRun);
  useEffect(() => {
    const first = setTimeout(() => void refresh(), 0);
    const id = setInterval(() => void refresh(), anyLive ? SCENARIO_LIVE_POLL_MS : POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [refresh, anyLive]);

  const start = useCallback(
    async (id: string) => {
      const run = await api.startScenario(id);
      live.current.add(run.id);
      await refresh();
      return run;
    },
    [api, refresh],
  );

  const reset = useCallback(async () => {
    const result = await api.resetScenarios();
    await refresh();
    return result;
  }, [api, refresh]);

  return { scenarios: state, refresh, start, reset };
}
