"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import type {
  ExpressionSpecification,
  GeoJSONSource,
  LayerSpecification,
  Map as MapLibreMap,
  MapGeoJSONFeature,
  Marker,
} from "maplibre-gl";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";

import type { ResponseUnitKind } from "@/lib/api/types";
import { type MapRoute, responseUnits, UNIT_VIEW } from "@/lib/response";

import { type Selection, selectionKey } from "../command/selection";
import { Icon, type IconName } from "../icons";
import { buildMarkers, cameraFeatures, candidateUnits, facilityFeatures, type MarkerInput } from "./markers";

/** OpenFreeMap basemaps: free, no API key, OpenStreetMap data. Positron (light) and Dark. */
const STYLE_URL: Record<MapTheme, string> = {
  light: "https://tiles.openfreemap.org/styles/positron",
  dark: "https://tiles.openfreemap.org/styles/dark",
};
const WORKER_URL = "/vendor/maplibre-gl/maplibre-gl-worker.mjs";
const FONT = ["Noto Sans Regular"]; // served by every OpenFreeMap style
const KARACHI_CENTER: [number, number] = [67.0611, 24.8807];
// Same box as the API's Karachi CHECK constraint, padded a little.
const KARACHI_BOUNDS: [[number, number], [number, number]] = [
  [66.45, 24.6],
  [67.75, 25.4],
];
// M6B: a steeper, slightly rotated camera with sky and lit buildings reads as 3D even at city
// zoom; the 2D view stays flat and north-up.
const VIEW_3D = { pitch: 60, bearing: -20 };
const VIEW_2D = { pitch: 0, bearing: 0 };
/** Buildings only when they carry information: below this zoom the extrusion layer is hidden. */
const BUILDINGS_MIN_ZOOM = 12.5;

type MapState = "loading" | "ready" | "tiles-failed" | "unsupported";
type Layer = "cameras" | ResponseUnitKind | "incidents";
/** Quiet police and ambulance points appear from district zoom (no city-wide clutter). */
const FACILITY_MIN_ZOOM = 11.5;
export type MapView = "3d" | "2d";
export type MapTheme = "light" | "dark";

/** GL layer colours per theme (HTML markers follow the CSS tokens). */
const PALETTE = {
  light: {
    canvas: "#eef0f2",
    cluster: "#ffffff",
    clusterStroke: "#d0d5dd",
    clusterText: "#111318",
    coverage: "#98a2b3",
    feed: "#16a36a",
    mapped: "#111827",
    pointStroke: "#ffffff",
    routeCasing: "#ffffff",
    route: "#2563eb",
    buildings: ["#e9ecef", "#d9dde3", "#c6ccd5"],
    sky: { "sky-color": "#dce9f7", "horizon-color": "#f3f5f8", "fog-color": "#f1f3f5" },
  },
  dark: {
    canvas: "#0b0d11",
    cluster: "#1b1f27",
    clusterStroke: "#3a4250",
    clusterText: "#e9ebef",
    coverage: "#6b7486",
    feed: "#22b573",
    mapped: "#c9d1dd",
    pointStroke: "#0b0d11",
    routeCasing: "#0b0d11",
    route: "#4f8bff",
    buildings: ["#1d222b", "#262c37", "#313946"],
    sky: { "sky-color": "#0d1525", "horizon-color": "#1a2333", "fog-color": "#11151c" },
  },
} as const;

export interface MapFocus {
  /** Changes for every new focus request (e.g. a new alert). */
  key: string;
  lng: number;
  lat: number;
  /** Frame an area (e.g. a zone) instead of flying to one point. */
  bounds?: [[number, number], [number, number]];
}

export interface OpsMapProps extends MarkerInput {
  onSelect: (selection: Selection) => void;
  /** M6C response view: one road route per suggested unit, each in its service colour.
   *  Unrelated nodes recede while any route is shown. */
  routes?: MapRoute[] | null;
  focus?: MapFocus | null;
  view?: MapView;
  theme?: MapTheme;
  /** History layer toggle from the layers menu (mirrors Settings: show resolved incidents). */
  onShowClosed?: (on: boolean) => void;
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
      const routes = input.routes ?? [];
      // In the response view: the incident, every suggested facility and every route.
      points = [
        at(incident),
        ...(routes.length && incident ? responseUnits(incident).map((u) => at(u.facility)) : []),
        ...routes.flatMap((r) => r.coordinates),
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

export function boundsOf(points: Point[]): [Point, Point] {
  const lngs = points.map((p) => p[0]);
  const lats = points.map((p) => p[1]);
  return [
    [Math.min(...lngs), Math.min(...lats)],
    [Math.max(...lngs), Math.max(...lats)],
  ];
}

export const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

const CAMERA_LAYERS = ["pr-cluster", "pr-cluster-count", "pr-camera-point"];
const FACILITY_COLOR: ExpressionSpecification = [
  "match",
  ["get", "category"],
  "police",
  UNIT_VIEW.police.color,
  "ambulance",
  UNIT_VIEW.ambulance.color,
  UNIT_VIEW.fire.color,
];
const pointOpacity = (): ExpressionSpecification => ["case", ["get", "inactive"], 0.4, 1];

function cityLayers(theme: MapTheme): LayerSpecification[] {
  const c = PALETTE[theme];
  return [
    {
      id: "pr-route-casing",
      type: "line",
      source: "pr-route",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": c.routeCasing, "line-width": ["interpolate", ["linear"], ["zoom"], 10, 6, 15, 10] },
    },
    {
      id: "pr-route-line",
      type: "line",
      source: "pr-route",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        // One colour per service: fire red, ambulance green, police blue.
        "line-color": ["coalesce", ["get", "color"], c.route],
        "line-width": ["interpolate", ["linear"], ["zoom"], 10, 3, 15, 5],
        "line-opacity": 0.92,
      },
    },
    {
      id: "pr-facility-point",
      type: "circle",
      source: "pr-facilities",
      minzoom: FACILITY_MIN_ZOOM,
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 11.5, 3.5, 15, 6],
        "circle-color": c.cluster,
        "circle-stroke-color": FACILITY_COLOR,
        "circle-stroke-width": 2,
        "circle-opacity": ["case", ["get", "inactive"], 0.4, 1],
        "circle-stroke-opacity": ["case", ["get", "inactive"], 0.4, 1],
      },
    },
    {
      id: "pr-cluster",
      type: "circle",
      source: "pr-cameras",
      filter: ["has", "point_count"],
      paint: {
        "circle-color": c.cluster,
        "circle-stroke-color": c.clusterStroke,
        "circle-stroke-width": 1,
        "circle-radius": ["step", ["get", "point_count"], 13, 10, 15, 25, 18],
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
      paint: { "text-color": c.clusterText },
    },
    {
      id: "pr-camera-point",
      type: "circle",
      source: "pr-cameras",
      filter: ["!", ["has", "point_count"]],
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 3.5, 15, 6],
        // Green: a node with a (demo) feed. Dark: a mapped location. Grey: coverage only.
        "circle-color": [
          "case",
          ["get", "feed"],
          c.feed,
          ["==", ["get", "source_type"], "verified_mapped"],
          c.mapped,
          c.coverage,
        ],
        "circle-stroke-color": c.pointStroke,
        "circle-stroke-width": 1.5,
        "circle-opacity": pointOpacity(),
        "circle-stroke-opacity": pointOpacity(),
      },
    },
  ];
}

/** Lit extrusions graded by height: depth without darkening the light map. */
function buildingLayer(theme: MapTheme): LayerSpecification {
  const [low, mid, high] = PALETTE[theme].buildings;
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
        low,
        40,
        mid,
        120,
        high,
      ],
      // Rise in over one zoom level instead of popping in.
      "fill-extrusion-height": [
        "interpolate",
        ["linear"],
        ["zoom"],
        BUILDINGS_MIN_ZOOM,
        0,
        BUILDINGS_MIN_ZOOM + 1,
        // Slightly exaggerated so mid-rise Karachi reads as 3D at district zoom.
        ["*", 1.4, ["coalesce", ["get", "render_height"], 6]],
      ],
      "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
      "fill-extrusion-opacity": 0.9,
      "fill-extrusion-vertical-gradient": true,
    },
  };
}

/** Adds the PehRadar sources and layers to a freshly loaded basemap style. */
function installCityStyle(map: MapLibreMap, theme: MapTheme, view: MapView) {
  const styleLayers = map.getStyle().layers;
  const firstSymbol = styleLayers.find((l) => l.type === "symbol")?.id;
  // One calm label per place: the Latin name only (the basemaps print Latin and local script).
  for (const l of styleLayers) {
    if (l.type === "symbol" && JSON.stringify(l.layout?.["text-field"] ?? "").includes("name")) {
      map.setLayoutProperty(l.id, "text-field", ["coalesce", ["get", "name:en"], ["get", "name:latin"], ["get", "name"]]);
    }
  }
  map.addSource("pr-cameras", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
    cluster: true,
    clusterRadius: 46,
    clusterMaxZoom: 14,
  });
  map.addSource("pr-route", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  map.addSource("pr-facilities", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  try {
    map.addLayer(buildingLayer(theme), firstSymbol);
  } catch {
    // A style without the OpenMapTiles building layer simply stays flat.
  }
  for (const layer of cityLayers(theme)) map.addLayer(layer);
  applyDepth(map, theme, view);
}

/** 3D: buildings, a soft sky at the horizon and a light from the south-west. 2D: flat. */
function applyDepth(map: MapLibreMap, theme: MapTheme, view: MapView) {
  const on = view === "3d";
  if (map.getLayer("pr-buildings-3d")) map.setLayoutProperty("pr-buildings-3d", "visibility", on ? "visible" : "none");
  try {
    map.setLight({ anchor: "viewport", color: "#ffffff", intensity: theme === "dark" ? 0.25 : 0.4, position: [1.4, 210, 35] });
    // 2D: a fully transparent sky blend leaves the flat basemap untouched.
    map.setSky({
      ...PALETTE[theme].sky,
      "sky-horizon-blend": on ? 0.6 : 0,
      "horizon-fog-blend": on ? 0.4 : 0,
      "fog-ground-blend": on ? 0.75 : 1,
      "atmosphere-blend": 0,
    });
  } catch {
    // A style or GPU without sky support keeps the plain view.
  }
}

export function OpsMap(props: OpsMapProps) {
  const { onSelect, routes = null, focus = null, view = "3d", theme = "light", onShowClosed, ...input } = props;
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerCtor = useRef<typeof Marker | null>(null);
  const markers = useRef(new Map<string, { marker: Marker; el: HTMLButtonElement }>());
  const onSelectRef = useRef(onSelect);
  const [state, setState] = useState<MapState>("loading");
  // Bumped once the map exists. styleVersion counts style loads (first load and theme swaps):
  // every effect that writes to a source or layer reruns after one.
  const [markersVersion, setMarkersVersion] = useState(0);
  const [styleVersion, setStyleVersion] = useState(0);
  const styleReady = styleVersion > 0;
  const themeRef = useRef(theme);
  const viewRef = useRef(view);
  useEffect(() => {
    viewRef.current = view;
  });
  const [layersOpen, setLayersOpen] = useState(false);
  const [layers, setLayers] = useState<Record<Layer, boolean>>({
    cameras: true,
    fire: true,
    ambulance: true,
    police: true,
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
      const initial = view === "3d" ? VIEW_3D : VIEW_2D;
      try {
        map = new lib.Map({
          container: container.current,
          style: STYLE_URL[themeRef.current],
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
      // Runs on the first load and after every theme swap (setStyle drops custom layers).
      map.on("style.load", () => {
        styleLoaded = true;
        if (cancelled) return;
        installCityStyle(map, themeRef.current, viewRef.current);
        setStyleVersion((v) => v + 1);
        setState("ready");
      });
      map.on("load", () => {
        // Layer-bound handlers survive style swaps (they look the layer up per event).
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
        map.on("click", "pr-facility-point", (event) => {
          const id = event.features?.[0]?.properties?.id;
          if (typeof id === "string") onSelectRef.current({ kind: "station", id });
        });
        for (const id of ["pr-cluster", "pr-camera-point", "pr-facility-point"]) {
          map.on("mouseenter", id, () => (map.getCanvas().style.cursor = "pointer"));
          map.on("mouseleave", id, () => (map.getCanvas().style.cursor = ""));
        }
      });
      map.on("error", () => {
        // Individual tile errors after load are tolerated; a style that never loads is not.
        if (!styleLoaded && !cancelled) setState("tiles-failed");
      });
      // The map pane resizes when the context drawer opens; keep the canvas matched to it.
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
    // The initial view is read once; later changes are eased below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Theme swap: load the other basemap; "style.load" reinstalls the PehRadar layers.
  useEffect(() => {
    if (themeRef.current === theme) return;
    themeRef.current = theme;
    mapRef.current?.setStyle(STYLE_URL[theme]);
  }, [theme]);

  const { cameras, stations, incidents, pending, analyzingCameraId, scenarioCameraIds, selection, showClosed } = input;
  const markerInput = useMemo<MarkerInput>(
    () => ({ cameras, stations, incidents, pending, analyzingCameraId, scenarioCameraIds, selection, showClosed }),
    [cameras, stations, incidents, pending, analyzingCameraId, scenarioCameraIds, selection, showClosed],
  );
  const specs = useMemo(() => buildMarkers(markerInput), [markerInput]);
  const features = useMemo(() => cameraFeatures(markerInput), [markerInput]);
  const facilityPoints = useMemo(() => facilityFeatures(markerInput), [markerInput]);
  const routeMode = !!routes && routes.length > 0;
  const candidateIds = useMemo(() => [...candidateUnits(markerInput).keys()], [markerInput]);

  // Clustered quiet cameras: one GeoJSON source, updated only when the set changes.
  useEffect(() => {
    if (!styleReady) return;
    mapRef.current?.getSource<GeoJSONSource>("pr-cameras")?.setData(features);
  }, [features, styleReady, styleVersion]);

  useEffect(() => {
    if (!styleReady) return;
    mapRef.current?.getSource<GeoJSONSource>("pr-facilities")?.setData(facilityPoints);
  }, [facilityPoints, styleReady, styleVersion]);

  useEffect(() => {
    if (!styleReady) return;
    mapRef.current?.getSource<GeoJSONSource>("pr-route")?.setData({
      type: "FeatureCollection",
      features: (routes ?? [])
        .filter((r) => r.coordinates.length > 1)
        .map((r) => ({
          type: "Feature" as const,
          properties: { unit: r.unit, color: r.color },
          geometry: { type: "LineString" as const, coordinates: r.coordinates },
        })),
    });
  }, [routes, styleReady, styleVersion]);

  // Route mode: the clustered network recedes (HTML markers are dimmed in CSS).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReady || !map.getLayer("pr-cluster")) return;
    const dim = 0.25;
    map.setPaintProperty("pr-cluster", "circle-opacity", routeMode ? dim : 1);
    map.setPaintProperty("pr-cluster", "circle-stroke-opacity", routeMode ? dim : 1);
    map.setPaintProperty("pr-cluster-count", "text-opacity", routeMode ? dim : 1);
    map.setPaintProperty("pr-camera-point", "circle-opacity", routeMode ? dim : pointOpacity());
    map.setPaintProperty("pr-camera-point", "circle-stroke-opacity", routeMode ? dim : pointOpacity());
    map.setPaintProperty("pr-facility-point", "circle-opacity", routeMode ? dim : ["case", ["get", "inactive"], 0.4, 1]);
    map.setPaintProperty("pr-facility-point", "circle-stroke-opacity", routeMode ? dim : ["case", ["get", "inactive"], 0.4, 1]);
  }, [routeMode, styleReady, styleVersion]);

  // Facility layer toggles (Fire / Ambulance / Police) also filter the GL points.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReady || !map.getLayer("pr-facility-point")) return;
    const shown = (["ambulance", "police"] as const).filter((c) => layers[c]);
    map.setFilter("pr-facility-point", ["in", ["get", "category"], ["literal", shown]]);
  }, [layers, styleReady, styleVersion]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReady) return;
    for (const id of CAMERA_LAYERS) {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", layers.cameras ? "visible" : "none");
    }
  }, [layers.cameras, styleReady, styleVersion]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReady) return;
    applyDepth(map, themeRef.current, view);
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
          anchor: spec.anchor,
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

  // First data load: frame the whole network. "Show all of Karachi" returns to the same view.
  const fitAll = (duration: number) => {
    const map = mapRef.current;
    const points = [...input.cameras, ...input.stations].map((x) => at(x)!);
    if (!map || points.length < 2) return false;
    map.fitBounds(boundsOf(points), { padding: 48, duration, maxZoom: 12, ...(view === "3d" ? VIEW_3D : VIEW_2D) });
    return true;
  };
  const fitted = useRef(false);
  useEffect(() => {
    if (!fitted.current) fitted.current = fitAll(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input.cameras, input.stations, markersVersion]);

  // A new alert flies to its camera (only when the operator is not looking at something else).
  const lastFocus = useRef<string | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focus || lastFocus.current === focus.key) return;
    lastFocus.current = focus.key;
    const reduced = prefersReducedMotion();
    if (focus.bounds) map.fitBounds(focus.bounds, { padding: 64, maxZoom: 14.5, duration: reduced ? 0 : 800 });
    else if (reduced) map.jumpTo({ center: [focus.lng, focus.lat], zoom: 14.5 });
    else map.flyTo({ center: [focus.lng, focus.lat], zoom: 14.5, speed: 1.1, curve: 1.5, essential: true });
  }, [focus, markersVersion]);

  // Move to the selected item when the selection changes (not on every data refresh). In route
  // mode an incident is framed together with its candidate station and the whole route.
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
        // Extra room on the right for the incident label; in the response view the route summary
        // card covers the bottom-left, so the routes are kept clear of it.
        padding: routeMode ? { top: 80, bottom: 80, left: 300, right: 140 } : { top: 96, bottom: 140, left: 120, right: 180 },
        maxZoom: 14.5,
        duration,
      });
    }
  }, [framingKey, framing, markersVersion, routeMode]);

  const hidden = (Object.keys(layers) as Layer[]).filter((l) => !layers[l]);
  const motion = () => (prefersReducedMotion() ? 0 : 300);

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden" style={{ background: PALETTE[theme].canvas }}>
      {/* MapLibre's own CSS makes the container position:relative, so size it from a wrapper. */}
      <div className="absolute inset-0">
        <div
          ref={container}
          data-testid="ops-map"
          data-candidates={candidateIds.join(" ")}
          className={`ops-map h-full w-full ${routeMode ? "is-route-mode" : ""} ${hidden.map((l) => `hide-${l}`).join(" ")}`}
        />
      </div>

      <div
        role="toolbar"
        aria-label="Map controls"
        aria-orientation="vertical"
        className="absolute right-4 bottom-10 grid rounded-lg border border-line bg-surface shadow-float"
      >
        <ToolButton icon="plus" label="Zoom in" onClick={() => mapRef.current?.zoomIn({ duration: motion() })} />
        <ToolButton icon="minus" label="Zoom out" onClick={() => mapRef.current?.zoomOut({ duration: motion() })} />
        <ToolButton icon="locate" label="Show all of Karachi" onClick={() => fitAll(prefersReducedMotion() ? 0 : 700)} />
        <div className="relative">
          <ToolButton icon="layers" label="Layers and legend" pressed={layersOpen} onClick={() => setLayersOpen((v) => !v)} />
          {layersOpen && (
            <LayersPanel
              layers={layers}
              showClosed={!!showClosed}
              onShowClosed={onShowClosed}
              onChange={(layer, on) => setLayers((prev) => ({ ...prev, [layer]: on }))}
              onClose={() => setLayersOpen(false)}
            />
          )}
        </div>
      </div>

      {state !== "ready" && (
        <p
          role="status"
          className="absolute bottom-10 left-4 rounded-lg border border-line bg-surface px-3 py-2 text-[13px] text-fg-2 shadow-float"
        >
          {state === "loading" && "Loading map…"}
          {state === "tiles-failed" && "Map tiles unavailable. Markers are still shown at their coordinates."}
          {state === "unsupported" &&
            "The map cannot run in this browser (WebGL unavailable). Use the lists in the navigation."}
        </p>
      )}
    </div>
  );
}

function ToolButton({
  icon,
  label,
  onClick,
  pressed,
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
  pressed?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      onClick={onClick}
      className={`grid h-9 w-9 place-items-center border-b border-line text-fg-2 first:rounded-t-lg last:rounded-b-lg last:border-b-0 hover:bg-muted hover:text-fg focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-info ${
        pressed ? "bg-muted text-fg" : ""
      }`}
    >
      <Icon name={icon} size={18} />
    </button>
  );
}

const LAYER_LABEL: Record<Layer, string> = {
  cameras: "Cameras",
  incidents: "Incidents",
  fire: "Fire stations",
  ambulance: "Ambulance",
  police: "Police stations",
};

function LayersPanel({
  layers,
  showClosed,
  onShowClosed,
  onChange,
  onClose,
}: {
  layers: Record<Layer, boolean>;
  showClosed: boolean;
  onShowClosed?: (on: boolean) => void;
  onChange: (layer: Layer, on: boolean) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      role="dialog"
      aria-label="Layers and legend"
      className="absolute right-full bottom-0 mr-2 grid w-64 gap-4 rounded-lg border border-line bg-surface p-4 shadow-float"
    >
      <fieldset className="grid gap-2">
        <legend className="mb-2 text-xs font-medium tracking-wide text-fg-3 uppercase">Layers</legend>
        {(Object.keys(LAYER_LABEL) as Layer[]).map((layer) => (
          <label key={layer} className="flex cursor-pointer items-center justify-between gap-2 text-[13px]">
            {LAYER_LABEL[layer]}
            <input
              type="checkbox"
              className="h-4 w-4 accent-navy"
              checked={layers[layer]}
              onChange={(e) => onChange(layer, e.target.checked)}
            />
          </label>
        ))}
        {onShowClosed && (
          <label className="flex cursor-pointer items-center justify-between gap-2 text-[13px]">
            Resolved incidents (history)
            <input
              type="checkbox"
              className="h-4 w-4 accent-navy"
              checked={showClosed}
              onChange={(e) => onShowClosed(e.target.checked)}
            />
          </label>
        )}
      </fieldset>
      <div className="grid gap-2">
        <p className="text-xs font-medium tracking-wide text-fg-3 uppercase">Legend</p>
        <ul className="grid gap-2 text-[13px] text-fg-2">
          <LegendRow swatch={<span className="legend-cluster">12</span>}>Group of nodes</LegendRow>
          <LegendRow swatch={<span className="legend-dot" />}>Simulated coverage node</LegendRow>
          <LegendRow swatch={<span className="legend-dot is-live" />}>Node with a demo feed</LegendRow>
          <LegendRow swatch={<span className="legend-dot is-selected" />}>Selected</LegendRow>
          <LegendRow swatch={<span className="legend-dot is-pending" />}>Detection to review</LegendRow>
          <LegendRow swatch={<span className="legend-pin" />}>Confirmed incident (fire or smoke)</LegendRow>
          {showClosed && <LegendRow swatch={<span className="legend-pin is-closed" />}>Closed incident (history)</LegendRow>}
          <LegendRow swatch={<span className="legend-station" />}>Fire station</LegendRow>
          <LegendRow swatch={<span className="legend-station is-ambulance" />}>Ambulance facility</LegendRow>
          <LegendRow swatch={<span className="legend-station is-police" />}>Police station</LegendRow>
          <LegendRow swatch={<span className="legend-station is-unavailable" />}>Facility unavailable (demo flag)</LegendRow>
          <LegendRow swatch={<span className="legend-route is-fire" />}>Fire route (estimate)</LegendRow>
          <LegendRow swatch={<span className="legend-route is-ambulance" />}>Ambulance route (estimate)</LegendRow>
          <LegendRow swatch={<span className="legend-route is-police" />}>Police route (estimate)</LegendRow>
        </ul>
      </div>
      <p className="text-xs text-fg-3">
        Facilities and roads © OpenStreetMap contributors, unverified. Police and ambulance points show from district zoom.
      </p>
    </div>
  );
}

function LegendRow({ swatch, children }: { swatch: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-3">
      <span aria-hidden className="grid w-5 place-items-center">
        {swatch}
      </span>
      {children}
    </li>
  );
}
