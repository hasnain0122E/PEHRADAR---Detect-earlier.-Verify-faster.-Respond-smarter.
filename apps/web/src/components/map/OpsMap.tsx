"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import type {
  GeoJSONSource,
  LayerSpecification,
  Map as MapLibreMap,
  MapGeoJSONFeature,
  Marker,
} from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";

import { type Selection, selectionKey } from "../command/selection";
import { buildMarkers, cameraFeatures, type MarkerInput } from "./markers";

/** OpenFreeMap dark style: free, no API key, OpenStreetMap data (Design.md §7.1). */
const STYLE_URL = "https://tiles.openfreemap.org/styles/dark";
const WORKER_URL = "/vendor/maplibre-gl/maplibre-gl-worker.mjs";
const FONT = ["Noto Sans Regular"]; // the only font stack the OpenFreeMap dark style serves
const KARACHI_CENTER: [number, number] = [67.0611, 24.8807];
// Same box as the API's Karachi CHECK constraint, padded a little.
const KARACHI_BOUNDS: [[number, number], [number, number]] = [
  [66.45, 24.6],
  [67.75, 25.4],
];
const INCIDENT_OFFSET: [number, number] = [16, -16];
const VIEW_3D = { pitch: 52, bearing: -17 };
const VIEW_2D = { pitch: 0, bearing: 0 };
/** Buildings only when they carry information: below this zoom the extrusion layer is hidden. */
const BUILDINGS_MIN_ZOOM = 13.5;

type MapState = "loading" | "ready" | "tiles-failed" | "unsupported";
type Layer = "cameras" | "stations" | "incidents";
type View = "3d" | "2d";

export interface MapFocus {
  /** Changes for every new focus request (e.g. a new alert). */
  key: string;
  lng: number;
  lat: number;
}

export interface OpsMapProps extends MarkerInput {
  onSelect: (selection: Selection) => void;
  /** Suggested response route of the selected incident ([lng, lat] pairs). */
  route?: [number, number][] | null;
  focus?: MapFocus | null;
}

type Point = [number, number];
const at = (x?: { longitude: number; latitude: number }): Point | null =>
  x ? [x.longitude, x.latitude] : null;

/** Points to frame for a selection: one point, or an incident plus its station and route. */
function framingFor(input: OpsMapProps, selection: Selection | null): Point[] {
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
      points = [
        at(incident),
        at(input.stations.find((s) => s.id === incident?.assigned_station_id)),
        ...(input.route ?? []),
      ];
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

const CAMERA_LAYERS = ["pr-cluster-halo", "pr-cluster", "pr-cluster-count", "pr-camera-point"];

function cityLayers(): LayerSpecification[] {
  return [
    {
      id: "pr-route-casing",
      type: "line",
      source: "pr-route",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#05080c", "line-width": ["interpolate", ["linear"], ["zoom"], 10, 6, 15, 12] },
    },
    {
      id: "pr-route-line",
      type: "line",
      source: "pr-route",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": "#3da5ff",
        "line-width": ["interpolate", ["linear"], ["zoom"], 10, 3, 15, 6],
      },
    },
    {
      id: "pr-cluster-halo",
      type: "circle",
      source: "pr-cameras",
      filter: ["has", "point_count"],
      paint: {
        "circle-color": "#b39dff",
        "circle-opacity": 0.12,
        "circle-radius": ["step", ["get", "point_count"], 20, 10, 25, 25, 31],
      },
    },
    {
      id: "pr-cluster",
      type: "circle",
      source: "pr-cameras",
      filter: ["has", "point_count"],
      paint: {
        "circle-color": "#151b24",
        "circle-stroke-color": "#b39dff",
        "circle-stroke-width": 1.5,
        "circle-radius": ["step", ["get", "point_count"], 13, 10, 16, 25, 20],
      },
    },
    {
      id: "pr-cluster-count",
      type: "symbol",
      source: "pr-cameras",
      filter: ["has", "point_count"],
      layout: {
        "text-field": ["get", "point_count_abbreviated"],
        "text-font": FONT,
        "text-size": 12,
        "text-allow-overlap": true,
      },
      paint: { "text-color": "#e6ebf1" },
    },
    {
      id: "pr-camera-point",
      type: "circle",
      source: "pr-cameras",
      filter: ["!", ["has", "point_count"]],
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 3.5, 15, 7],
        "circle-color": [
          "match",
          ["get", "source_type"],
          "verified_mapped",
          "#0a0d12",
          "#2a2046",
        ],
        "circle-stroke-color": [
          "match",
          ["get", "source_type"],
          "verified_mapped",
          "#e6ebf1",
          "#b39dff",
        ],
        "circle-stroke-width": 1.5,
        "circle-opacity": ["case", ["get", "inactive"], 0.4, 1],
        "circle-stroke-opacity": ["case", ["get", "inactive"], 0.4, 1],
      },
    },
  ];
}

function buildingLayer(): LayerSpecification {
  return {
    id: "pr-buildings-3d",
    type: "fill-extrusion",
    source: "openmaptiles",
    "source-layer": "building",
    minzoom: BUILDINGS_MIN_ZOOM,
    paint: {
      "fill-extrusion-color": [
        "interpolate",
        ["linear"],
        ["coalesce", ["get", "render_height"], 6],
        0,
        "#273244",
        40,
        "#34425a",
        120,
        "#43546f",
      ],
      // Rise in over one zoom level instead of popping in.
      "fill-extrusion-height": [
        "interpolate",
        ["linear"],
        ["zoom"],
        BUILDINGS_MIN_ZOOM,
        0,
        BUILDINGS_MIN_ZOOM + 1,
        ["coalesce", ["get", "render_height"], 6],
      ],
      "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
      "fill-extrusion-opacity": 0.9,
      "fill-extrusion-vertical-gradient": true,
    },
  };
}

export function OpsMap(props: OpsMapProps) {
  const { onSelect, route = null, focus = null, ...input } = props;
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerCtor = useRef<typeof Marker | null>(null);
  const markers = useRef(new Map<string, { marker: Marker; el: HTMLButtonElement }>());
  const onSelectRef = useRef(onSelect);
  const [state, setState] = useState<MapState>("loading");
  // Bumped once the map exists, and again when the style has loaded (layers can be added).
  const [markersVersion, setMarkersVersion] = useState(0);
  const [styleReady, setStyleReady] = useState(false);
  const [view, setView] = useState<View>(() => (prefersReducedMotion() ? "2d" : "3d"));
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
      const initial = prefersReducedMotion() ? VIEW_2D : VIEW_3D;
      try {
        map = new lib.Map({
          container: container.current,
          style: STYLE_URL,
          center: KARACHI_CENTER,
          zoom: 10.6,
          minZoom: 9,
          maxPitch: 65,
          maxBounds: KARACHI_BOUNDS,
          attributionControl: { compact: true },
          ...initial,
        });
      } catch {
        // No WebGL (or blocked): the lists still drive the whole workflow.
        setState("unsupported");
        return;
      }
      let styleLoaded = false;
      map.addControl(new lib.NavigationControl({ visualizePitch: true }), "top-right");
      map.on("load", () => {
        styleLoaded = true;
        if (cancelled) return;
        const firstSymbol = map.getStyle().layers.find((l) => l.type === "symbol")?.id;
        map.addSource("pr-cameras", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
          cluster: true,
          clusterRadius: 46,
          clusterMaxZoom: 14,
        });
        map.addSource("pr-route", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        try {
          map.addLayer(buildingLayer(), firstSymbol);
        } catch {
          // A style without the OpenMapTiles building layer simply stays flat.
        }
        for (const layer of cityLayers()) map.addLayer(layer);
        map.on("click", "pr-cluster", async (event) => {
          const feature = event.features?.[0] as MapGeoJSONFeature | undefined;
          const clusterId = feature?.properties?.cluster_id;
          if (clusterId == null || feature?.geometry.type !== "Point") return;
          const source = map.getSource<GeoJSONSource>("pr-cameras");
          const zoom = await source?.getClusterExpansionZoom(clusterId);
          map.easeTo({
            center: feature.geometry.coordinates as [number, number],
            zoom: (zoom ?? map.getZoom() + 2) + 0.2,
            duration: prefersReducedMotion() ? 0 : 500,
          });
        });
        map.on("click", "pr-camera-point", (event) => {
          const id = event.features?.[0]?.properties?.id;
          if (typeof id === "string") onSelectRef.current({ kind: "camera", id });
        });
        for (const id of ["pr-cluster", "pr-camera-point"]) {
          map.on("mouseenter", id, () => (map.getCanvas().style.cursor = "pointer"));
          map.on("mouseleave", id, () => (map.getCanvas().style.cursor = ""));
        }
        setStyleReady(true);
        setState("ready");
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

  const { cameras, stations, incidents, pending, analyzingCameraId, scenarioCameraIds, selection } = input;
  const markerInput = useMemo<MarkerInput>(
    () => ({ cameras, stations, incidents, pending, analyzingCameraId, scenarioCameraIds, selection }),
    [cameras, stations, incidents, pending, analyzingCameraId, scenarioCameraIds, selection],
  );
  const specs = useMemo(() => buildMarkers(markerInput), [markerInput]);
  const features = useMemo(() => cameraFeatures(markerInput), [markerInput]);

  // Clustered quiet cameras: one GeoJSON source, updated only when the set changes.
  useEffect(() => {
    if (!styleReady) return;
    mapRef.current?.getSource<GeoJSONSource>("pr-cameras")?.setData(features);
  }, [features, styleReady]);

  useEffect(() => {
    if (!styleReady) return;
    mapRef.current?.getSource<GeoJSONSource>("pr-route")?.setData({
      type: "FeatureCollection",
      features:
        route && route.length > 1
          ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: route } }]
          : [],
    });
  }, [route, styleReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReady) return;
    for (const id of CAMERA_LAYERS) {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", layers.cameras ? "visible" : "none");
    }
  }, [layers.cameras, styleReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReady) return;
    if (map.getLayer("pr-buildings-3d")) {
      map.setLayoutProperty("pr-buildings-3d", "visibility", view === "3d" ? "visible" : "none");
    }
    map.easeTo({ ...(view === "3d" ? VIEW_3D : VIEW_2D), duration: prefersReducedMotion() ? 0 : 700 });
  }, [view, styleReady]);

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
          pitchAlignment: "viewport",
          rotationAlignment: "viewport",
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

  // First data load: frame the whole network.
  const fitted = useRef(false);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || fitted.current) return;
    const points = [...input.cameras, ...input.stations].map((x) => at(x)!);
    if (points.length < 2) return;
    fitted.current = true;
    map.fitBounds(boundsOf(points), { padding: 40, duration: 0, maxZoom: 12, ...(view === "3d" ? VIEW_3D : VIEW_2D) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input.cameras, input.stations, markersVersion]);

  // A new alert flies to its camera (only when the operator is not looking at something else).
  const lastFocus = useRef<string | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focus || lastFocus.current === focus.key) return;
    lastFocus.current = focus.key;
    if (prefersReducedMotion()) map.jumpTo({ center: [focus.lng, focus.lat], zoom: 14.5 });
    else map.flyTo({ center: [focus.lng, focus.lat], zoom: 14.5, speed: 1.1, curve: 1.5, essential: true });
  }, [focus, markersVersion]);

  // Move to the selected item when the selection changes (not on every data refresh). An
  // incident is framed together with its candidate station and suggested route.
  const key = selectionKey(input.selection);
  const framing = framingFor(props, input.selection);
  const framingKey = `${key}|${framing.length}`;
  const lastFramed = useRef("");
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !framing.length || lastFramed.current === framingKey) return;
    lastFramed.current = framingKey;
    const duration = prefersReducedMotion() ? 0 : 800;
    if (framing.length === 1) {
      map.easeTo({ center: framing[0], zoom: Math.max(map.getZoom(), 14.2), duration });
    } else {
      map.fitBounds(boundsOf(framing), {
        padding: { top: 90, bottom: 70, left: 80, right: 80 },
        maxZoom: 14.5,
        duration,
      });
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
      <div aria-hidden className="pr-map-vignette pointer-events-none absolute inset-0" />

      <div className="absolute top-3 left-3 flex flex-wrap gap-2">
        <fieldset className="pr-map-ctl flex gap-0.5 p-0.5 text-xs">
          <legend className="sr-only">Map layers</legend>
          {(["cameras", "stations", "incidents"] as Layer[]).map((layer) => (
            <label
              key={layer}
              className="flex cursor-pointer items-center gap-1.5 rounded-sm px-2 py-1 capitalize hover:bg-ink-800 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus"
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
        <div role="group" aria-label="Map view" className="pr-map-ctl flex gap-0.5 p-0.5 text-xs">
          {(["3d", "2d"] as View[]).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => setView(v)}
              className={`rounded-sm px-2.5 py-1 font-mono font-semibold uppercase focus-visible:outline-2 focus-visible:outline-focus ${
                view === v ? "bg-ink-700 text-ink-100" : "text-ink-300 hover:bg-ink-800"
              }`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

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
    <details className="pr-map-ctl absolute bottom-3 left-3 max-w-72 text-xs open:pb-2">
      <summary className="cursor-pointer px-3 py-1.5 font-medium tracking-wider text-ink-300 uppercase">
        Legend
      </summary>
      <ul className="grid gap-1.5 px-3 pt-1">
        <li className="flex items-center gap-2">
          <span className="legend-cluster" aria-hidden>
            12
          </span>{" "}
          Group of simulated coverage nodes (click to expand)
        </li>
        <li className="flex items-center gap-2">
          <span className="legend-node" aria-hidden /> Simulated coverage node (no feed)
        </li>
        <li className="flex items-center gap-2">
          <span className="legend-node is-mapped" aria-hidden /> Mapped camera location (OSM, no feed)
        </li>
        <li className="flex items-center gap-2">
          <span className="legend-camera is-demo" aria-hidden /> Demo-stream node (simulated feed)
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
          <span className="legend-route" aria-hidden /> Suggested response route (estimate)
        </li>
        <li className="flex items-center gap-2">
          <span className="legend-diamond" aria-hidden>
            ▲
          </span>{" "}
          Active incident (▲ high · ◆ medium · ● low)
        </li>
      </ul>
      <p className="px-3 pt-2 text-ink-500">
        No official CCTV is connected. Stations and roads: © OpenStreetMap contributors, unverified.
      </p>
    </details>
  );
}
