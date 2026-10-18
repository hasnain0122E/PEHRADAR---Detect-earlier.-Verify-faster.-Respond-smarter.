"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError, type OpsApi } from "@/lib/api/client";
import type { Camera, Detection, FireStation, Incident } from "@/lib/api/types";
import { POLL_MS } from "@/lib/ops";

export interface OpsData {
  cameras: Camera[];
  stations: FireStation[];
  incidents: Incident[];
  pending: Detection[];
  /** "loading" only until the first successful load. */
  status: "loading" | "ready" | "error";
  error: string | null;
  lastSync: Date | null;
}

const EMPTY: OpsData = {
  cameras: [],
  stations: [],
  incidents: [],
  pending: [],
  status: "loading",
  error: null,
  lastSync: null,
};

export function describeError(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message;
  return fallback;
}

/**
 * Cameras and stations load once and again on demand (`refresh({ statics: true })`) after a
 * demo status change (M6B network simulation, station availability, full reset). Incidents and
 * pending detections are polled every POLL_MS and reloaded on demand after operator actions.
 */
export function useOpsData(
  api: OpsApi,
  onUpdate?: (update: { incidents: Incident[]; pending: Detection[] }) => void,
) {
  const [data, setData] = useState<OpsData>(EMPTY);
  const onUpdateRef = useRef(onUpdate);
  useEffect(() => {
    onUpdateRef.current = onUpdate;
  });
  const haveStatic = useRef(false);
  const inFlight = useRef<AbortController | null>(null);

  const refresh = useCallback(async (options?: { statics?: boolean }) => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    const { signal } = controller;
    try {
      const staticLoad = haveStatic.current && !options?.statics
        ? null
        : Promise.all([api.listCameras(signal), api.listStations(signal)]);
      const [incidents, pending, statics] = await Promise.all([
        api.listIncidents(signal),
        api.listPendingDetections(signal),
        staticLoad,
      ]);
      if (signal.aborted) return;
      haveStatic.current = true;
      onUpdateRef.current?.({ incidents, pending });
      setData((prev) => ({
        cameras: statics ? statics[0] : prev.cameras,
        stations: statics ? statics[1] : prev.stations,
        incidents,
        pending,
        status: "ready",
        error: null,
        lastSync: new Date(),
      }));
    } catch (err) {
      if (signal.aborted) return;
      setData((prev) => ({
        ...prev,
        status: prev.status === "ready" ? "ready" : "error",
        error: describeError(err, "Unexpected error loading operational data"),
      }));
    }
  }, [api]);

  useEffect(() => {
    // First load immediately, then poll so new detections and incidents appear on their own.
    const first = setTimeout(() => void refresh(), 0);
    const id = setInterval(() => void refresh(), POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(id);
      inFlight.current?.abort();
    };
  }, [refresh]);

  return { data, refresh };
}
