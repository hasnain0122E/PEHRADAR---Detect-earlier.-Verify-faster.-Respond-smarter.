"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import type { Map as MapLibreMap, Marker } from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";

import { type Selection, selectionKey } from "../command/selection";
import { buildMarkers, type MarkerInput } from "./markers";

/** OpenFreeMap dark style: free, no API key, OpenStreetMap data (Design.md §7.1). */
const STYLE_URL = "https://tiles.openfreemap.org/styles/dark";
const WORKER_URL = "/vendor/maplibre-gl/maplibre-gl-worker.mjs";
const KARACHI_CENTER: [number, number] = [67.0011, 24.8607];
// Same box as the API's Karachi CHECK constraint, padded a little.
const KARACHI_BOUNDS: [[number, number], [number, number]] = [
  [66.45, 24.6],
  [67.75, 25.4],
];
const INCIDENT_OFFSET: [number, number] = [16, -16];

type MapState = "loading" | "ready" | "tiles-failed" | "unsupported";
type Layer = "cameras" | "stations" | "incidents";

export interface OpsMapProps extends MarkerInput {
  onSelect: (selection: Selection) => void;
}

type Point = [number, number];
const at = (x?: { longitude: number; latitude: number }): Point | null =>
  x ? [x.longitude, x.latitude] : null;

/** Points to frame for a selection: one point, or an incident plus its candidate station. */
function framingFor(input: MarkerInput, selection: Selection | null): Point[] {
  if (!selection) return [];
  let points: (Point | null)[] = [];
  switch (selection.kind) {
    case "camera":
      points = [at(input.cameras.find((c) => c.id === selection.id))];
      break;
    case "station":
      points = [at(input.stations.find((s) => s.id === selection.id))];
      break;
    case "incident": {
      const incident = input.incidents.find((i) => i.id === selection.id);
      points = [at(incident), at(input.stations.find((s) => s.id === incident?.assigned_station_id))];
      break;
    }
    case "detection": {
      const d = input.pending.find((p) => p.id === selection.id);
      points = [at(input.cameras.find((c) => c.id === d?.camera_id))];
      break;
    }
  }
  return points.filter((p): p is Point => p !== null);
}

function boundsOf(points: Point[]): [Point, Point] {
  const lngs = points.map((p) => p[0]);
  const lats = points.map((p) => p[1]);
  return [
    [Math.min(...lngs), Math.min(...lats)],
    [Math.max(...lngs), Math.max(...lats)],
  ];
}

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export function OpsMap(props: OpsMapProps) {
  const { onSelect, ...input } = props;
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerCtor = useRef<typeof Marker | null>(null);
  const markers = useRef(new Map<string, { marker: Marker; el: HTMLButtonElement }>());
  const onSelectRef = useRef(onSelect);
  const [state, setState] = useState<MapState>("loading");
  // Bumped once the map exists so the marker effect runs with a live map.
  const [markersVersion, setMarkersVersion] = useState(0);
  const [layers, setLayers] = useState<Record<Layer, boolean>>({
    cameras: true,
    stations: true,
    incidents: true,
  });

  useEffect(() => {
    onSelectRef.current = onSelect;
  });

  useEffect(() => {
    let cancelled = false;
    const markerMap = markers.current;
    void (async () => {
      let lib: typeof import("maplibre-gl");
      try {
        lib = await import("maplibre-gl");
      } catch {
        if (!cancelled) setState("unsupported");
        return;
      }
      if (cancelled || !container.current) return;
      lib.setWorkerUrl(WORKER_URL);
      let map: MapLibreMap;
      try {
        map = new lib.Map({
          container: container.current,
          style: STYLE_URL,
          center: KARACHI_CENTER,
          zoom: 10.4,
          minZoom: 9,
          maxBounds: KARACHI_BOUNDS,
          attributionControl: { compact: true },
          dragRotate: false,
        });
      } catch {
        // No WebGL (or blocked): the lists still drive the whole workflow.
        setState("unsupported");
        return;
      }
      let styleLoaded = false;
      map.addControl(new lib.NavigationControl({ showCompass: false }), "top-right");
      map.on("load", () => {
        styleLoaded = true;
        if (!cancelled) setState("ready");
      });
      map.on("error", () => {
        // Individual tile errors after load are tolerated; a style that never loads is not.
        if (!styleLoaded && !cancelled) setState("tiles-failed");
      });
      // The map pane can be hidden (small screens) or resized; keep the canvas matched to it.
      const observer = new ResizeObserver(() => map.resize());
      observer.observe(container.current);
      map.once("remove", () => observer.disconnect());
      mapRef.current = map;
      markerCtor.current = lib.Marker;
      // Markers render even before the style finishes loading (or if it fails).
      setMarkersVersion((v) => v + 1);
    })();
    return () => {
      cancelled = true;
      markerMap.clear();
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  const specs = useMemo(
    () => buildMarkers(input),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [input.cameras, input.stations, input.incidents, input.pending, input.analyzingCameraId, input.selection],
  );

  useEffect(() => {
    const map = mapRef.current;
    const MarkerClass = markerCtor.current;
    if (!map || !MarkerClass) return;
    const seen = new Set<string>();
    for (const spec of specs) {
      seen.add(spec.key);
      let entry = markers.current.get(spec.key);
      if (!entry) {
        const el = document.createElement("button");
        el.type = "button";
        el.addEventListener("click", (event) => {
          event.stopPropagation();
          const select = el.dataset.select;
          if (select) onSelectRef.current(JSON.parse(select) as Selection);
        });
        const marker = new MarkerClass({
          element: el,
          anchor: "center",
          offset: spec.select.kind === "incident" ? INCIDENT_OFFSET : [0, 0],
        })
          .setLngLat([spec.lng, spec.lat])
          .addTo(map);
        entry = { marker, el };
        markers.current.set(spec.key, entry);
      }
      const { el, marker } = entry;
      marker.setLngLat([spec.lng, spec.lat]);
      // Keep MapLibre's own classes (maplibregl-marker…): they carry the absolute positioning.
      const own = [...el.classList].filter((c) => c.startsWith("maplibregl-"));
      el.className = [...own, spec.className].join(" ");
      el.innerHTML = spec.html;
      el.setAttribute("aria-label", spec.label);
      el.title = spec.label;
      el.dataset.select = JSON.stringify(spec.select);
      el.style.zIndex = String(spec.z + (spec.className.includes("is-selected") ? 10 : 0));
    }
    for (const [key, entry] of markers.current) {
      if (!seen.has(key)) {
        entry.marker.remove();
        markers.current.delete(key);
      }
    }
  }, [specs, markersVersion]);

  // First data load: frame every camera and station.
  const fitted = useRef(false);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || fitted.current) return;
    const points = [...input.cameras, ...input.stations].map((x) => at(x)!);
    if (points.length < 2) return;
    fitted.current = true;
    map.fitBounds(boundsOf(points), { padding: 60, duration: 0, maxZoom: 12 });
  }, [input.cameras, input.stations, markersVersion]);

  // Move to the selected item when the selection changes (not on every data refresh). An
  // incident is framed together with its candidate station.
  const key = selectionKey(input.selection);
  const framing = framingFor(input, input.selection);
  const framingKey = `${key}|${framing.length}`;
  const lastFramed = useRef("");
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !framing.length || lastFramed.current === framingKey) return;
    lastFramed.current = framingKey;
    const duration = prefersReducedMotion() ? 0 : 600;
    if (framing.length === 1) {
      map.easeTo({ center: framing[0], zoom: Math.max(map.getZoom(), 12), duration });
    } else {
      map.fitBounds(boundsOf(framing), { padding: 90, maxZoom: 13, duration });
    }
  }, [framingKey, framing, markersVersion]);

  const hidden = (Object.keys(layers) as Layer[]).filter((l) => !layers[l]);

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden bg-ink-950">
      {/* MapLibre's own CSS makes the container position:relative, so size it from a wrapper. */}
      <div className="absolute inset-0">
        <div
          ref={container}
          data-testid="ops-map"
          className={`ops-map h-full w-full ${hidden.map((l) => `hide-${l}`).join(" ")}`}
        />
      </div>

      <fieldset className="absolute top-3 left-3 flex gap-1 rounded-md border border-ink-700 bg-ink-900/95 p-1 text-xs">
        <legend className="sr-only">Map layers</legend>
        {(["cameras", "stations", "incidents"] as Layer[]).map((layer) => (
          <label
            key={layer}
            className="flex cursor-pointer items-center gap-1.5 rounded px-2 py-1 capitalize hover:bg-ink-800 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus"
          >
            <input
              type="checkbox"
              className="accent-focus"
              checked={layers[layer]}
              onChange={(e) => setLayers((prev) => ({ ...prev, [layer]: e.target.checked }))}
            />
            {layer}
          </label>
        ))}
      </fieldset>

      {state !== "ready" && (
        <p
          role="status"
          className="absolute top-14 left-3 rounded border border-ink-700 bg-ink-900/95 px-2 py-1 text-xs text-ink-300"
        >
          {state === "loading" && "Loading map…"}
          {state === "tiles-failed" &&
            "Map tiles unavailable. Markers are still shown at their coordinates."}
          {state === "unsupported" &&
            "The map cannot run in this browser (WebGL unavailable). Use the lists on the left."}
        </p>
      )}

      <MapLegend />
    </div>
  );
}

function MapLegend() {
  return (
    <details className="absolute bottom-3 left-3 max-w-64 rounded-md border border-ink-700 bg-ink-900/95 text-xs open:pb-2">
      <summary className="cursor-pointer px-3 py-1.5 font-medium tracking-wider text-ink-300 uppercase">
        Legend
      </summary>
      <ul className="grid gap-1.5 px-3 pt-1">
        <li className="flex items-center gap-2">
          <span className="legend-camera" aria-hidden /> Camera (simulated)
        </li>
        <li className="flex items-center gap-2">
          <span className="legend-camera is-pending" aria-hidden /> Camera with detection to review
        </li>
        <li className="flex items-center gap-2">
          <span className="legend-shield" aria-hidden /> Fire station, available (demo flag)
        </li>
        <li className="flex items-center gap-2">
          <span className="legend-shield is-unavailable" aria-hidden /> Fire station, unavailable
        </li>
        <li className="flex items-center gap-2">
          <span className="legend-shield is-candidate" aria-hidden /> Candidate station of the
          selected incident
        </li>
        <li className="flex items-center gap-2">
          <span className="legend-diamond" aria-hidden>
            ▲
          </span>{" "}
          Active incident (▲ high · ◆ medium · ● low)
        </li>
      </ul>
      <p className="px-3 pt-2 text-ink-500">
        Stations: OpenStreetMap locations, unverified. Map data © OpenStreetMap contributors.
      </p>
    </details>
  );
}
