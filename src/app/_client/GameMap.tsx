"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { Map as MapLibreMap, Marker, setWorkerUrl, type GeoJSONSource } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import type { LatLon } from "@/geo/geometry";
import type { TrailGraph } from "@/geo/graph/types";
import { unwrapToward } from "@/play/heading";
import { ZombieAnimator, type ZombieTarget } from "@/play/zombie-anim";
import { MAP_ATTRIBUTION, MAP_STYLE } from "./mapStyle";
import { ARROW_SVG, DOT_SVG, ZOMBIE_DIR_SVG, ZOMBIE_SVG } from "./symbols";

const fc = (features: GeoJSON.Feature[] = []): GeoJSON.FeatureCollection => ({ type: "FeatureCollection", features });
const pt = (p: LatLon, props: Record<string, unknown> = {}): GeoJSON.Feature => ({ type: "Feature", properties: props, geometry: { type: "Point", coordinates: [p.lon, p.lat] } });
const line = (pts: LatLon[], props: Record<string, unknown> = {}): GeoJSON.Feature => ({ type: "Feature", properties: props, geometry: { type: "LineString", coordinates: pts.map((p) => [p.lon, p.lat]) } });

function circle(c: LatLon, rM: number): GeoJSON.Feature {
  const pts: [number, number][] = [];
  const dLat = rM / 111_320;
  const dLon = rM / (111_320 * Math.cos((c.lat * Math.PI) / 180));
  for (let i = 0; i <= 32; i++) {
    const a = (i / 32) * 2 * Math.PI;
    pts.push([c.lon + Math.cos(a) * dLon, c.lat + Math.sin(a) * dLat]);
  }
  return { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [pts] } };
}

export interface MapMarker {
  id: string;
  label: string;
  lat: number;
  lon: number;
  /** "next" = aktivt mål, "done" = klarat, "todo" = kommande. */
  tone: "next" | "done" | "todo";
}

export interface GameMapProps {
  graph?: TrailGraph | null;
  routes?: { points: LatLon[]; selected: boolean }[];
  markers?: MapMarker[];
  player?: LatLon | null;
  accuracyM?: number | null;
  start?: LatLon | null;
  /** Auktoritativa zombiepositioner (kant + sträcka). Kartan animerar mjukt längs kantgeometrin mellan uppdateringarna. */
  zombies?: ZombieTarget[];
  /** Pausad match: zombier står still och animationsloopen vilar. */
  frozen?: boolean;
  /** Spelarens färdriktning (0–360) eller null. Ren presentation. */
  heading?: number | null;
  /** Track Up: kartan roteras så att färdriktningen pekar uppåt. Annars North Up. */
  trackUp?: boolean;
  /** Startzoom (standard 15). Ändras aldrig automatiskt efteråt. */
  zoom?: number;
  extraction?: LatLon | null;
  /** Följ spelaren. */
  follow?: boolean;
  fit?: LatLon[] | null;
  onUserMove?: () => void;
  onError?: (what: string) => void;
}

const TONE = { next: "#16a34a", done: "#475569", todo: "#0f766e" } as const;

export default function GameMap(props: GameMapProps) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [loaded, setLoaded] = useState(false);
  const markersRef = useRef<Marker[]>([]);
  const propsRef = useRef(props);
  propsRef.current = props;

  useEffect(() => {
    if (!el.current) return;
    setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
    const c = propsRef.current.player ?? propsRef.current.start ?? { lat: 59.38, lon: 13.5 };
    const map = new MapLibreMap({ container: el.current, style: MAP_STYLE, center: [c.lon, c.lat], zoom: propsRef.current.zoom ?? 15, minZoom: 10, maxZoom: 18, attributionControl: false, dragRotate: false, pitchWithRotate: false, fadeDuration: 0, maxTileCacheSize: 40, pixelRatio: Math.min(window.devicePixelRatio || 1, 2) });
    mapRef.current = map;
    map.touchZoomRotate.disableRotation();
    map.on("dragstart", () => propsRef.current.onUserMove?.());
    let tileErrors = 0;
    map.on("error", (e) => {
      // Kartbilden är en bonus: tappas tiles (offline/begränsning) fortsätter spelet på det egna nätet. Logga bara de första felen.
      if (tileErrors++ < 3) propsRef.current.onError?.(String((e as unknown as { error?: { message?: string } }).error?.message ?? "map error"));
    });
    map.on("load", () => {
      map.addSource("net", { type: "geojson", data: fc() });
      map.addLayer({ id: "net", type: "line", source: "net", paint: { "line-color": "#64748b", "line-width": 1.8, "line-opacity": 0.85 } });
      map.addSource("routes", { type: "geojson", data: fc() });
      map.addLayer({ id: "routes", type: "line", source: "routes", paint: { "line-color": ["case", ["get", "sel"], "#22d3ee", "#64748b"], "line-width": ["case", ["get", "sel"], 5, 2.5], "line-opacity": ["case", ["get", "sel"], 0.95, 0.5] } });
      map.addSource("acc", { type: "geojson", data: fc() });
      map.addLayer({ id: "acc", type: "fill", source: "acc", paint: { "fill-color": "#3b82f6", "fill-opacity": 0.15 } });
      for (const id of ["extraction", "start"]) map.addSource(id, { type: "geojson", data: fc() });
      map.addLayer({ id: "extraction", type: "circle", source: "extraction", paint: { "circle-radius": 11, "circle-color": "#22d3ee", "circle-opacity": 0.85, "circle-stroke-color": "#fff", "circle-stroke-width": 2 } });
      map.addLayer({ id: "start", type: "circle", source: "start", paint: { "circle-radius": 7, "circle-color": "#0b0f14", "circle-stroke-color": "#e6edf3", "circle-stroke-width": 2.5 } });
      setLoaded(true);
    });
    return () => { markersRef.current.forEach((m) => m.remove()); map.remove(); mapRef.current = null; setLoaded(false); };
  }, []);

  const src = (id: string, data: GeoJSON.FeatureCollection) => (mapRef.current?.getSource(id) as GeoJSONSource | undefined)?.setData(data);

  const { graph, routes, markers, player, accuracyM, start, zombies, extraction, follow, fit, frozen, heading, trackUp } = props;
  useEffect(() => { if (loaded) src("net", fc(graph ? [...graph.edges.values()].map((e) => line(e.geometry)) : [])); }, [loaded, graph]);
  useEffect(() => { if (loaded) src("routes", fc((routes ?? []).map((r) => line(r.points, { sel: r.selected })))); }, [loaded, routes]);
  useEffect(() => { if (loaded) src("start", fc(start ? [pt(start)] : [])); }, [loaded, start]);
  useEffect(() => { if (loaded) src("extraction", fc(extraction ? [pt(extraction)] : [])); }, [loaded, extraction]);
  // --- Spelarmarkör (riktningspil) och Track Up ---
  const playerEl = useRef<HTMLDivElement | null>(null);
  const playerMarker = useRef<Marker | null>(null);
  const bearingRef = useRef(0); // senast beordrad kartrotation (grader, utrullad)
  const arrowRef = useRef(0);
  const lastCamBearing = useRef(0);
  useEffect(() => {
    const map = mapRef.current;
    if (!loaded || !map) return;
    const el = document.createElement("div");
    el.className = "pmark";
    el.innerHTML = `<div class="arrow">${ARROW_SVG}</div><div class="dot">${DOT_SVG}</div>`;
    playerEl.current = el;
    playerMarker.current = new Marker({ element: el, rotationAlignment: "viewport", pitchAlignment: "viewport" });
    return () => { playerMarker.current?.remove(); playerMarker.current = null; };
  }, [loaded]);
  useEffect(() => {
    const map = mapRef.current;
    const m = playerMarker.current;
    if (!loaded || !map) return;
    src("acc", fc(player && accuracyM ? [circle(player, accuracyM)] : []));
    if (!m || !playerEl.current) return;
    if (!player) { m.remove(); return; }
    m.setLngLat([player.lon, player.lat]);
    if (!m.getElement().isConnected) m.addTo(map);
    // Kartrotation: bara när riktningen ändrats minst 5° (hysteres), kortaste vägen, mjukt via kartmotorns egen easeTo.
    let bearing = bearingRef.current;
    if (trackUp && heading != null) {
      const t = unwrapToward(bearing, heading);
      if (Math.abs(t - bearing) >= 5) bearing = t;
    } else if (!trackUp) {
      bearing = unwrapToward(bearing, 0);
    }
    bearingRef.current = bearing;
    // Pilen visas relativt skärmen: ~0° i Track Up, annars färdriktningen mot norr.
    const screen = heading == null ? 0 : unwrapToward(arrowRef.current, heading - bearing);
    arrowRef.current = screen;
    playerEl.current.classList.toggle("has-heading", heading != null);
    (playerEl.current.querySelector(".arrow") as HTMLElement).style.transform = `rotate(${screen}deg)`;
    if (el.current) el.current.dataset.bearing = String(Math.round(bearing));
    if (follow) {
      const h = map.getContainer().clientHeight;
      const cam = { center: [player.lon, player.lat] as [number, number], bearing, padding: { top: Math.round(h * 0.3), bottom: 0, left: 0, right: 0 } };
      // Bara en kort animation när kartan ska rotera. Vanlig förflyttning (≈1 m/s … 5 m/s, någon pixel per GPS-fix) hoppar direkt:
      // en rendering per GPS-fix i stället för kontinuerlig animation sparar CPU/GPU och batteri.
      if (Math.abs(bearing - lastCamBearing.current) > 0.5) map.easeTo({ ...cam, duration: 800, easing: (t) => t, essential: true });
      else map.jumpTo(cam);
      lastCamBearing.current = bearing;
    }
  }, [loaded, player, accuracyM, follow, heading, trackUp]);

  // --- Zombier: en enda rAF-loop som animerar mellan motorns uppdateringar ---
  const animRef = useRef<ZombieAnimator | null>(null);
  const zMarkers = useRef(new Map<string, { m: Marker; el: HTMLDivElement; dir: HTMLElement; lat: number; lon: number }>());
  const loopRef = useRef<{ raf: number; running: boolean; last: number }>({ raf: 0, running: false, last: 0 });
  const frozenRef = useRef(false);
  frozenRef.current = !!frozen;
  const drawZombies = () => {
    const map = mapRef.current;
    const a = animRef.current;
    if (!map || !a) return;
    const frames = a.frames();
    const live = new Set<string>();
    for (const f of frames) {
      live.add(f.id);
      let z = zMarkers.current.get(f.id);
      if (!z) {
        const el = document.createElement("div");
        el.className = "zmark";
        el.innerHTML = `${ZOMBIE_SVG}<span class="zdir">${ZOMBIE_DIR_SVG}</span>`;
        z = { m: new Marker({ element: el, rotationAlignment: "viewport", pitchAlignment: "viewport" }).setLngLat([f.lon, f.lat]).addTo(map), el, dir: el.querySelector(".zdir") as HTMLElement, lat: f.lat, lon: f.lon };
        zMarkers.current.set(f.id, z);
      } else if (Math.abs(z.lat - f.lat) > 1e-8 || Math.abs(z.lon - f.lon) > 1e-8) {
        z.m.setLngLat([f.lon, f.lat]);
        z.lat = f.lat; z.lon = f.lon;
      }
      z.el.classList.toggle("chase", f.chasing);
      // Rörelsepil: tydlig rörelse även på låg zoom (zombier går ~1 m/s, bara någon pixel i sekunden). Vinkel relativt skärmen.
      if (f.bearing === null) z.dir.style.opacity = "0";
      else { z.dir.style.opacity = "1"; z.dir.style.transform = `rotate(${f.bearing - bearingRef.current}deg) translateY(-24px)`; }
    }
    for (const [id, z] of zMarkers.current) if (!live.has(id)) { z.m.remove(); zMarkers.current.delete(id); }
  };
  const ensureLoop = () => {
    const L = loopRef.current;
    if (L.running) return;
    L.running = true;
    L.last = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(0.25, (now - L.last) / 1000);
      L.last = now;
      // Ingen animation i bakgrunden eller när matchen är pausad: loopen vilar tills nästa uppdatering.
      if (document.hidden || frozenRef.current || !animRef.current) { L.running = false; return; }
      animRef.current.step(dt);
      drawZombies();
      L.raf = requestAnimationFrame(frame);
    };
    L.raf = requestAnimationFrame(frame);
  };
  useEffect(() => {
    if (!loaded || !graph) return;
    animRef.current = new ZombieAnimator(graph);
    return () => { cancelAnimationFrame(loopRef.current.raf); loopRef.current.running = false; animRef.current = null; zMarkers.current.forEach((z) => z.m.remove()); zMarkers.current.clear(); };
  }, [loaded, graph]);
  useEffect(() => {
    if (!animRef.current) return;
    animRef.current.setTargets(zombies ?? []);
    drawZombies();
    if (!frozen) ensureLoop();
  }, [zombies, frozen, loaded, graph]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const vis = () => { if (!document.hidden && !frozenRef.current) ensureLoop(); };
    document.addEventListener("visibilitychange", vis);
    return () => document.removeEventListener("visibilitychange", vis);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const map = mapRef.current;
    if (!loaded || !map) return;
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = (markers ?? []).map((m) => {
      const d = document.createElement("div");
      d.textContent = m.label;
      d.setAttribute("aria-label", `Mål ${m.label}`);
      d.style.cssText = `width:28px;height:28px;border-radius:50%;background:${TONE[m.tone]};color:#fff;font:700 14px system-ui;display:flex;align-items:center;justify-content:center;border:2px solid #fff;${m.tone === "next" ? "box-shadow:0 0 0 4px #16a34a66;" : ""}`;
      return new Marker({ element: d }).setLngLat([m.lon, m.lat]).addTo(map);
    });
  }, [loaded, markers]);
  useEffect(() => {
    const map = mapRef.current;
    if (!loaded || !map || !fit || fit.length === 0) return;
    const lons = fit.map((p) => p.lon), lats = fit.map((p) => p.lat);
    map.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], { padding: { top: 70, bottom: 260, left: 40, right: 40 }, duration: 0, maxZoom: 17 });
  }, [loaded, fit]);

  return (
    <>
      <div ref={el} className="map-canvas" data-testid="map" data-loaded={loaded} />
      <a className="attrib" href={MAP_ATTRIBUTION.href} target="_blank" rel="noreferrer">{MAP_ATTRIBUTION.text}</a>
    </>
  );
}
