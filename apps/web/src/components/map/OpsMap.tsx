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

import { type Selection, selectionKey } from "../command/selection";
import { Icon, type IconName } from "../icons";
import { buildMarkers, cameraFeatures, type MarkerInput } from "./markers";

/** OpenFreeMap Positron: light neutral basemap, free, no API key, OpenStreetMap data. */
const STYLE_URL = "https://tiles.openfreemap.org/styles/positron";
const WORKER_URL = "/vendor/maplibre-gl/maplibre-gl-worker.mjs";
const FONT = ["Noto Sans Regular"]; // served by every OpenFreeMap style
const KARACHI_CENTER: [number, number] = [67.0611, 24.8807];
// Same box as the API's Karachi CHECK constraint, padded a little.
const KARACHI_BOUNDS: [[number, number], [number, number]] = [
  [66.45, 24.6],
  [67.75, 25.4],
];
const VIEW_3D = { pitch: 52, bearing: -17 };
const VIEW_2D = { pitch: 0, bearing: 0 };
/** Buildings only when they carry information: below this zoom the extrusion layer is hidden. */
const BUILDINGS_MIN_ZOOM = 13.5;

type MapState = "loading" | "ready" | "tiles-failed" | "unsupported";
type Layer = "cameras" | "stations" | "incidents";
export type MapView = "3d" | "2d";

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
  /** Suggested response route in route mode ([lng, lat] pairs). Unrelated nodes recede. */
  route?: [number, number][] | null;
  focus?: MapFocus | null;
  view?: MapView;
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
        ...(input.route?.length ? [at(input.stations.find((s) => s.id === incident?.assigned_station_id))] : []),
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
const pointOpacity = (): ExpressionSpecification => ["case", ["get", "inactive"], 0.4, 1];

function cityLayers(): LayerSpecification[] {
  return [
    {
      id: "pr-route-casing",
      type: "line",
      source: "pr-route",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#ffffff", "line-width": ["interpolate", ["linear"], ["zoom"], 10, 7, 15, 12] },
    },
    {
      id: "pr-route-line",
      type: "line",
      source: "pr-route",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": "#2563eb",
        "line-width": ["interpolate", ["linear"], ["zoom"], 10, 3.5, 15, 6],
      },
    },
    {
      id: "pr-cluster",
      type: "circle",
      source: "pr-cameras",
      filter: ["has", "point_count"],
      paint: {
        "circle-color": "#ffffff",
        "circle-stroke-color": "#d0d5dd",
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
      paint: { "text-color": "#111318" },
    },
    {
      id: "pr-camera-point",
      type: "circle",
      source: "pr-cameras",
      filter: ["!", ["has", "point_count"]],
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 3.5, 15, 6],
        "circle-color": ["match", ["get", "source_type"], "verified_mapped", "#111827", "#98a2b3"],
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 1.5,
        "circle-opacity": pointOpacity(),
        "circle-stroke-opacity": pointOpacity(),
      },
    },
  ];
}

/** Very subtle light-grey extrusions: depth without a dark cityscape. */
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
        "#eceef1",
        60,
        "#e3e6ea",
        150,
        "#dadee3",
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
      "fill-extrusion-opacity": 0.8,
      "fill-extrusion-vertical-gradient": true,
    },
  };
}

export function OpsMap(props: OpsMapProps) {
  const { onSelect, route = null, focus = null, view = "3d", ...input } = props;
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerCtor = useRef<typeof Marker | null>(null);
  const markers = useRef(new Map<string, { marker: Marker; el: HTMLButtonElement }>());
  const onSelectRef = useRef(onSelect);
  const [state, setState] = useState<MapState>("loading");
  // Bumped once the map exists, and again when the style has loaded (layers can be added).
  const [markersVersion, setMarkersVersion] = useState(0);
  const [styleReady, setStyleReady] = useState(false);
  const [layersOpen, setLayersOpen] = useState(false);
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
      const initial = view === "3d" ? VIEW_3D : VIEW_2D;
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
      map.on("load", () => {
        styleLoaded = true;
        if (cancelled) return;
        const styleLayers = map.getStyle().layers;
        const firstSymbol = styleLayers.find((l) => l.type === "symbol")?.id;
        // One calm label per place: the Latin name only (Positron prints Latin + local script).
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

  const { cameras, stations, incidents, pending, analyzingCameraId, scenarioCameraIds, selection } = input;
  const markerInput = useMemo<MarkerInput>(
    () => ({ cameras, stations, incidents, pending, analyzingCameraId, scenarioCameraIds, selection }),
    [cameras, stations, incidents, pending, analyzingCameraId, scenarioCameraIds, selection],
  );
  const specs = useMemo(() => buildMarkers(markerInput), [markerInput]);
  const features = useMemo(() => cameraFeatures(markerInput), [markerInput]);
  const routeMode = !!route && route.length > 1;

  // Clustered quiet cameras: one GeoJSON source, updated only when the set changes.
  useEffect(() => {
    if (!styleReady) return;
    mapRef.current?.getSource<GeoJSONSource>("pr-cameras")?.setData(features);
  }, [features, styleReady]);

  useEffect(() => {
    if (!styleReady) return;
    mapRef.current?.getSource<GeoJSONSource>("pr-route")?.setData({
      type: "FeatureCollection",
      features: routeMode
        ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: route } }]
        : [],
    });
  }, [route, routeMode, styleReady]);

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
  }, [routeMode, styleReady]);

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
        // Extra room on the right for the incident label; the bottom-left route card.
        padding: { top: 96, bottom: 140, left: 120, right: 180 },
        maxZoom: 14.5,
        duration,
      });
    }
  }, [framingKey, framing, markersVersion]);

  const hidden = (Object.keys(layers) as Layer[]).filter((l) => !layers[l]);
  const motion = () => (prefersReducedMotion() ? 0 : 300);

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden bg-[#eef0f2]">
      {/* MapLibre's own CSS makes the container position:relative, so size it from a wrapper. */}
      <div className="absolute inset-0">
        <div
          ref={container}
          data-testid="ops-map"
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

const LAYER_LABEL: Record<Layer, string> = { cameras: "Cameras", stations: "Fire stations", incidents: "Incidents" };

function LayersPanel({
  layers,
  onChange,
  onClose,
}: {
  layers: Record<Layer, boolean>;
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
      </fieldset>
      <div className="grid gap-2">
        <p className="text-xs font-medium tracking-wide text-fg-3 uppercase">Legend</p>
        <ul className="grid gap-2 text-[13px] text-fg-2">
          <LegendRow swatch={<span className="legend-cluster">12</span>}>Group of nodes</LegendRow>
          <LegendRow swatch={<span className="legend-dot" />}>Simulated coverage node</LegendRow>
          <LegendRow swatch={<span className="legend-dot is-feed" />}>Camera with a feed</LegendRow>
          <LegendRow swatch={<span className="legend-dot is-selected" />}>Selected</LegendRow>
          <LegendRow swatch={<span className="legend-dot is-pending" />}>Detection to review</LegendRow>
          <LegendRow swatch={<span className="legend-dot is-incident" />}>Confirmed incident</LegendRow>
          <LegendRow swatch={<span className="legend-station" />}>Fire station (demo availability)</LegendRow>
          <LegendRow swatch={<span className="legend-station is-unavailable" />}>Station unavailable</LegendRow>
          <LegendRow swatch={<span className="legend-route" />}>Suggested route (estimate)</LegendRow>
        </ul>
      </div>
      <p className="text-xs text-fg-3">Stations and roads © OpenStreetMap contributors, unverified.</p>
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
