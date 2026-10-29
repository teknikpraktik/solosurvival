"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { Map as MapLibreMap, Marker, ScaleControl, setWorkerUrl, type GeoJSONSource, type StyleSpecification } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import { viewZoom } from "@/play/camera-view";
import { bearingDeg, haversineM, type LatLon } from "@/geo/geometry";
import type { TrailGraph } from "@/geo/graph/types";
import { checkPickPoint, type MapFeature } from "@/geo/point-check";
import { BearingSmoother } from "@/play/bearing";
import { wrap180, type HeadingSource } from "@/play/heading";
import { ZombieAnimator, type ZombieTarget } from "@/play/zombie-anim";
import { MAP_ATTRIBUTION, MAP_STYLE } from "./mapStyle";
import { ARROW_SVG, DOT_SVG, EXTRACTION_SVG, GOAL_POINTER_SVG, HOME_SVG, ZOMBIE_DIR_SVG, ZOMBIE_SVG } from "./symbols";

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
  /** "home" = hemkomst (hus). Utan ikon ritas en numrerad cirkel (checkpoint) eller B. */
  icon?: "home";
}

export interface GameMapProps {
  graph?: TrailGraph | null;
  routes?: { points: LatLon[]; selected: boolean; faint?: boolean }[];
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
  /** Läser aktuell riktning varje bildruta (kompassen ändras oftare än vyn uppdateras). Utan den används `heading`. */
  getHeading?: () => { deg: number | null; source: HeadingSource };
  /** Startzoom (standard 15). Ändras aldrig automatiskt efteråt. */
  zoom?: number;
  extraction?: LatLon | null;
  /** Nästa mål (checkpoint, hem, B eller extraction). Ligger det utanför kartbilden pekar en diskret pil i kanten mot det. */
  pointTo?: LatLon | null;
  /** Skalstock längst ner till vänster (sätts vid start). */
  scale?: boolean;
  /** Följ spelaren (game view: AUTO on). Any touch on the map then hands it to the player at once: `onUserMove` is called and the game stops moving the camera. */
  follow?: boolean;
  /** Game view: player centred, zoom fitted so that `viewAheadM` (`viewCloseAheadM` when `viewClose`) is visible ahead of and behind the player (top/bottom edge). */
  viewAheadM?: number;
  viewCloseAheadM?: number;
  /** Zoomed in on the surroundings (zombie or goal near) instead of the wide view. */
  viewClose?: boolean;
  /** Game view: the player's height on the screen as a fraction from the top (standard 0.5 = middle). */
  viewPlayerY?: number;
  fit?: LatLon[] | null;
  onUserMove?: () => void;
  /** Tryck på kartan (t.ex. för att välja A/B). */
  onPick?: (p: LatLon) => void;
  /** Kontrollera tryckta punkter mot kartans vatten, byggnader, större vägar och järnväg innan `onPick` anropas (se geo/point-check.ts). */
  validatePick?: boolean;
  /** En tryckt punkt avvisades av kontrollen (texten kan visas för spelaren). `onPick` anropas inte. */
  onPickRejected?: (message: string) => void;
  onError?: (what: string) => void;
  /** Fiendesymbol (SVG-markup) per fiende-id. Utelämnad = vuxenappens zombie. Läses när fienden först ritas. */
  enemySvg?: (id: string) => string;
  /** Bakgrundskartans stil. Utelämnad = MAP_STYLE. Läses när kartan skapas. */
  mapStyle?: StyleSpecification;
}

// Next goal blue, reached green, upcoming neutral grey (field test: the goal to head for and a taken checkpoint must not look alike).
const TONE = { next: "#2563eb", done: "#16a34a", todo: "#475569" } as const;

export default function GameMap(props: GameMapProps) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [loaded, setLoaded] = useState(false);
  const markersRef = useRef<Marker[]>([]);
  const propsRef = useRef(props);
  propsRef.current = props;
  // The player has taken the map (touched it while following): from that moment no code moves the camera, until `follow` is turned on again.
  // Set synchronously in the input listener, before the gesture starts: every camera move (jumpTo/easeTo/setBearing) cancels MapLibre's gesture
  // handlers, which is what made pinch and pan feel unresponsive (the follow and rotation updates kept cancelling them).
  const manual = useRef(false);
  const smoother = useRef(new BearingSmoother(0));

  useEffect(() => {
    if (!el.current) return;
    setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
    const c = propsRef.current.player ?? propsRef.current.start ?? { lat: 59.38, lon: 13.5 };
    const map = new MapLibreMap({ container: el.current, style: propsRef.current.mapStyle ?? MAP_STYLE, center: [c.lon, c.lat], zoom: propsRef.current.zoom ?? 15, minZoom: 10, maxZoom: 18, attributionControl: false, dragRotate: false, pitchWithRotate: false, fadeDuration: 0, maxTileCacheSize: 40, pixelRatio: Math.min(window.devicePixelRatio || 1, 2) });
    mapRef.current = map;
    map.touchZoomRotate.disableRotation();
    if (propsRef.current.scale) map.addControl(new ScaleControl({ maxWidth: 90, unit: "metric" }), "bottom-left");
    const takeOver = () => {
      if (!propsRef.current.follow || manual.current) return;
      manual.current = true;
      propsRef.current.onUserMove?.();
    };
    const canvas = map.getCanvasContainer();
    for (const ev of ["wheel", "touchstart", "pointerdown", "mousedown", "dblclick", "keydown"]) canvas.addEventListener(ev, takeOver, { passive: true, capture: true });
    map.on("zoomend", () => { if (el.current) el.current.dataset.zoom = map.getZoom().toFixed(2); });
    map.on("click", (e) => {
      const p = { lat: e.lngLat.lat, lon: e.lngLat.lng };
      if (propsRef.current.validatePick) {
        // Bara inlästa kartrutor finns att fråga; saknas de (offline) godkänns punkten.
        const feats = (["water", "building", "transportation"] as const).flatMap((sourceLayer) => map.querySourceFeatures("omt", { sourceLayer }) as unknown as MapFeature[]);
        const problem = checkPickPoint(feats, p);
        if (problem) { propsRef.current.onPickRejected?.(problem.message); return; }
      }
      propsRef.current.onPick?.(p);
    });
    let tileErrors = 0;
    map.on("error", (e) => {
      // Kartbilden är en bonus: tappas tiles (offline/begränsning) fortsätter spelet på det egna nätet. Logga bara de första felen.
      if (tileErrors++ < 3) propsRef.current.onError?.(String((e as unknown as { error?: { message?: string } }).error?.message ?? "map error"));
    });
    map.on("load", () => {
      map.addSource("net", { type: "geojson", data: fc() });
      map.addLayer({ id: "net", type: "line", source: "net", paint: { "line-color": "#64748b", "line-width": 1.8, "line-opacity": 0.85 } });
      map.addSource("routes", { type: "geojson", data: fc() });
      map.addLayer({ id: "routes-faint", type: "line", source: "routes", filter: ["==", ["get", "faint"], true], paint: { "line-color": "#e2e8f0", "line-width": 2, "line-opacity": 0.4, "line-dasharray": [2, 3] } });
      map.addLayer({ id: "routes", type: "line", source: "routes", filter: ["!=", ["get", "faint"], true], paint: { "line-color": ["case", ["get", "sel"], "#22d3ee", "#64748b"], "line-width": ["case", ["get", "sel"], 5, 2.5], "line-opacity": ["case", ["get", "sel"], 0.95, 0.5] } });
      map.addSource("acc", { type: "geojson", data: fc() });
      map.addLayer({ id: "acc", type: "fill", source: "acc", paint: { "fill-color": "#3b82f6", "fill-opacity": 0.15 } });
      map.addSource("start", { type: "geojson", data: fc() });
      map.addLayer({ id: "start", type: "circle", source: "start", paint: { "circle-radius": 7, "circle-color": "#0b0f14", "circle-stroke-color": "#e6edf3", "circle-stroke-width": 2.5 } });
      setLoaded(true);
    });
    // Svart karta: iOS kan tappa ritytan när appen varit i bakgrunden eller när behållaren hade storlek 0 vid start. Rita om vid återkomst och vid storleksändring,
    // och försök läsa in kartstilen igen om den inte kommit inom 8 s (nätverkshack vid start).
    const repaint = () => { if (!document.hidden) { map.resize(); map.triggerRepaint(); } };
    document.addEventListener("visibilitychange", repaint);
    const ro = typeof ResizeObserver !== "undefined" && el.current ? new ResizeObserver(() => map.resize()) : null;
    if (ro && el.current) ro.observe(el.current);
    let retries = 0;
    const watchdog = setInterval(() => {
      if (map.isStyleLoaded() || retries >= 2) { clearInterval(watchdog); return; }
      retries++;
      propsRef.current.onError?.("map style timeout, retrying");
      map.setStyle(MAP_STYLE);
    }, 8000);
    map.on("load", () => clearInterval(watchdog));
    return () => { clearInterval(watchdog); ro?.disconnect(); document.removeEventListener("visibilitychange", repaint); markersRef.current.forEach((m) => m.remove()); map.remove(); mapRef.current = null; setLoaded(false); };
  }, []);

  const src = (id: string, data: GeoJSON.FeatureCollection) => (mapRef.current?.getSource(id) as GeoJSONSource | undefined)?.setData(data);

  const { graph, routes, markers, player, accuracyM, start, zombies, extraction, pointTo, follow, fit, frozen, viewAheadM, viewCloseAheadM, viewClose, viewPlayerY } = props;
  useEffect(() => { if (loaded) src("net", fc(graph ? [...graph.edges.values()].filter((e) => !e.offtrail).map((e) => line(e.geometry)) : [])); }, [loaded, graph]);
  useEffect(() => { if (loaded) src("routes", fc((routes ?? []).map((r) => line(r.points, { sel: r.selected, faint: !!r.faint })))); }, [loaded, routes]);
  useEffect(() => { if (loaded) src("start", fc(start ? [pt(start)] : [])); }, [loaded, start]);
  // Extraction: egen flaggikon (inte samma som hem eller checkpoint).
  const extractionMarker = useRef<Marker | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!loaded || !map) return;
    extractionMarker.current?.remove();
    extractionMarker.current = null;
    if (!extraction) return;
    const d = document.createElement("div");
    d.className = "goalmark";
    d.setAttribute("role", "img");
    d.setAttribute("aria-label", "Extraction point (helicopter)");
    d.innerHTML = `${EXTRACTION_SVG}<span class="goallabel">EXIT</span>`;
    extractionMarker.current = new Marker({ element: d }).setLngLat([extraction.lon, extraction.lat]).addTo(map);
    return () => { extractionMarker.current?.remove(); extractionMarker.current = null; };
  }, [loaded, extraction]);
  // Pil mot nästa mål när det ligger utanför bild: placeras i kanten av den fria kartytan (mellan HUD:en och knappraden) på linjen från ytans mitt mot målet.
  useEffect(() => {
    const map = mapRef.current;
    if (!loaded || !map || !pointTo) return;
    const target: [number, number] = [pointTo.lon, pointTo.lat];
    const d = document.createElement("div");
    d.className = "goalptr";
    d.innerHTML = GOAL_POINTER_SVG;
    const box = map.getContainer();
    box.appendChild(d);
    const update = () => {
      const r = box.getBoundingClientRect();
      const shell = box.parentElement;
      const hud = shell?.querySelector(".hudbar")?.getBoundingClientRect();
      const ctl = shell?.querySelector(".controls")?.getBoundingClientRect();
      const scaleBox = box.querySelector(".maplibregl-ctrl-scale")?.getBoundingClientRect();
      const inset = 22;
      const x0 = inset, x1 = r.width - inset;
      const y0 = (hud ? Math.max(0, hud.bottom - r.top) : 0) + inset;
      const y1 = Math.min(ctl ? ctl.top - r.top : r.height, scaleBox && scaleBox.height ? scaleBox.top - r.top : r.height, r.height) - inset; // above the controls and the scale bar
      const p = map.project(target);
      if (y1 <= y0 || (p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1)) { d.style.opacity = "0"; return; }
      const ox = r.width / 2, oy = (y0 + y1) / 2, dx = p.x - ox, dy = p.y - oy;
      const t = Math.min(dx ? ((dx > 0 ? x1 : x0) - ox) / dx : Infinity, dy ? ((dy > 0 ? y1 : y0) - oy) / dy : Infinity);
      const deg = (Math.atan2(dx, -dy) * 180) / Math.PI;
      d.style.opacity = "1";
      d.style.transform = `translate(${(ox + dx * t).toFixed(1)}px, ${(oy + dy * t).toFixed(1)}px) translate(-50%, -50%) rotate(${deg.toFixed(1)}deg)`;
    };
    update();
    map.on("render", update);
    window.addEventListener("resize", update);
    return () => { map.off("render", update); window.removeEventListener("resize", update); d.remove(); };
  }, [loaded, pointTo?.lat, pointTo?.lon]); // eslint-disable-line react-hooks/exhaustive-deps
  // --- Spelarmarkör (riktningspil) och Track Up ---
  const playerEl = useRef<HTMLDivElement | null>(null);
  const playerMarker = useRef<Marker | null>(null);
  const bearingRef = useRef(0); // aktuell kartrotation (grader, utrullad)
  const wasFollowing = useRef(true);
  const lastClose = useRef(false);
  // Following turned on again (AUTO tapped): the game takes the camera back. Declared before the follow effect so that it eases back at once.
  const followProp = useRef(follow);
  useEffect(() => {
    if (follow && !followProp.current) { manual.current = false; smoother.current = new BearingSmoother(mapRef.current?.getBearing() ?? 0); }
    if (!follow) wasFollowing.current = false;
    followProp.current = follow;
  }, [follow]);
  useEffect(() => {
    const map = mapRef.current;
    if (!loaded || !map) return;
    const el = document.createElement("div");
    el.className = "pmark";
    // Ovanför hem, checkpoints och extraction (som läggs till senare och annars hamnar ovanpå spelaren vid start); zombier ligger överst.
    el.style.zIndex = "2";
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
    const bearing = smoother.current.value;
    if (follow && !manual.current) {
      const h = map.getContainer().clientHeight;
      const cam: { center: [number, number]; bearing: number; padding: { top: number; bottom: number; left: number; right: number }; zoom?: number } = { center: [player.lon, player.lat], bearing, padding: { top: Math.round(h * 0.3), bottom: 0, left: 0, right: 0 } };
      let returning = false;
      if (viewAheadM !== undefined) {
        // Player at viewPlayerY of the height (padding moves the map centre); zoom so that viewAheadM fits between the player and the top edge.
        const y = Math.min(0.8, Math.max(0.2, viewPlayerY ?? 0.5));
        cam.padding = { top: Math.round(Math.max(0, 2 * y - 1) * h), bottom: Math.round(Math.max(0, 1 - 2 * y) * h), left: 0, right: 0 };
        cam.zoom = viewZoom(player.lat, h, viewClose ? (viewCloseAheadM ?? viewAheadM) : viewAheadM, y);
        // Coming back to AUTO, or switching between the wide and the close view: ease smoothly.
        returning = !wasFollowing.current || lastClose.current !== !!viewClose;
        lastClose.current = !!viewClose;
      }
      wasFollowing.current = true;
      // Rotationen sköts av egen bildrutesloop (mjuk, utan fördröjning); här flyttas bara kartan till spelaren. En GPS-fix = ett hopp.
      if (returning) map.easeTo({ ...cam, duration: 700, essential: true });
      else map.jumpTo(cam);
    }
    if (el.current) el.current.dataset.zoom = map.getZoom().toFixed(2);
  }, [loaded, player, accuracyM, follow, viewAheadM, viewCloseAheadM, viewClose, viewPlayerY]);
  // Rotation och pil: en enda bildrutesloop (högst ~30 Hz) som läser riktningen direkt och mjukar den. Kartan ritas bara om medan den roterar.
  useEffect(() => {
    if (!loaded) return;
    let raf = 0;
    let last = performance.now();
    let arrow = 0;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (document.hidden) { last = now; return; }
      if (now - last < 33) return;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const P = propsRef.current;
      const map = mapRef.current;
      const sm = smoother.current;
      if (!map) return;
      const h = P.getHeading ? P.getHeading() : { deg: P.heading ?? null, source: "gps" as HeadingSource };
      if (P.follow && !manual.current) {
        // Mål: Track Up följer riktningen (kompass med dödband mot darrning), North Up ligger fast på 0°. Okänd riktning: kartan står kvar.
        if (P.trackUp) {
          if (h.deg != null && Math.abs(wrap180(h.deg - sm.target)) >= (h.source === "compass" ? 1.5 : 0.5)) sm.setTarget(h.deg);
        } else sm.setTarget(0);
        if (sm.step(dt)) {
          const c = P.player;
          if (c) map.jumpTo({ bearing: sm.value, center: [c.lon, c.lat] });
          else map.setBearing(sm.value);
        }
        bearingRef.current = sm.value;
      } else bearingRef.current = map.getBearing(); // the player (or nobody) holds the map: never touch the camera, only follow its rotation for the arrows
      // Pilen visas relativt skärmen (≈ 0° i Track Up). Utan känd riktning visas en neutral prick, aldrig en gissad pil.
      const el0 = playerEl.current;
      if (el0) {
        el0.classList.toggle("has-heading", h.deg != null);
        if (h.deg != null) {
          arrow = arrow + wrap180(h.deg - bearingRef.current - arrow);
          (el0.querySelector(".arrow") as HTMLElement).style.transform = `rotate(${arrow.toFixed(1)}deg)`;
        }
      }
      if (el.current) el.current.dataset.bearing = String(Math.round(bearingRef.current));
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [loaded]);

  // --- Zombier: en enda rAF-loop som animerar mellan motorns uppdateringar ---
  const animRef = useRef<ZombieAnimator | null>(null);
  const zMarkers = useRef(new Map<string, { m: Marker; el: HTMLDivElement; dir: HTMLElement; label: HTMLElement; lat: number; lon: number; text: string }>());
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
        el.style.zIndex = "3";
        el.innerHTML = `${propsRef.current.enemySvg?.(f.id) ?? ZOMBIE_SVG}<span class="zdir">${ZOMBIE_DIR_SVG}</span><span class="zlabel"></span>`;
        z = { m: new Marker({ element: el, rotationAlignment: "viewport", pitchAlignment: "viewport" }).setLngLat([f.lon, f.lat]).addTo(map), el, dir: el.querySelector(".zdir") as HTMLElement, label: el.querySelector(".zlabel") as HTMLElement, lat: f.lat, lon: f.lon, text: "" };
        zMarkers.current.set(f.id, z);
      } else if (Math.abs(z.lat - f.lat) > 1e-8 || Math.abs(z.lon - f.lon) > 1e-8) {
        z.m.setLngLat([f.lon, f.lat]);
        z.lat = f.lat; z.lon = f.lon;
      }
      z.el.classList.toggle("chase", f.chasing);
      z.el.classList.toggle("sprint", f.sprinting);
      // Rörelsepil: tydlig rörelse även på låg zoom (zombier går ~1 m/s, bara någon pixel i sekunden). Vinkel relativt skärmen.
      if (f.bearing === null) z.dir.style.opacity = "0";
      else { z.dir.style.opacity = "1"; z.dir.style.transform = `rotate(${f.bearing - bearingRef.current}deg) translateY(-24px)`; }
    }
    // Avståndsetikett vid de tre zombier som är närmast spelaren, placerad åt spelarens håll (relativt skärmen).
    const me = propsRef.current.player;
    const near = new Set<string>();
    if (me) frames.map((f) => ({ id: f.id, d: haversineM(f, me) })).sort((a, b) => a.d - b.d).slice(0, 3).forEach((x) => near.add(x.id));
    for (const f of frames) {
      const z = zMarkers.current.get(f.id);
      if (!z) continue;
      if (!me || !near.has(f.id)) { if (z.text !== "") { z.label.style.opacity = "0"; z.text = ""; } continue; }
      const d = haversineM(f, me);
      const text = d >= 1000 ? `${(d / 1000).toFixed(1)} km` : `${Math.round(d / (d < 100 ? 1 : 5)) * (d < 100 ? 1 : 5)} m`;
      if (text !== z.text) { z.label.textContent = text; z.text = text; }
      const a = ((bearingDeg(f, me) - bearingRef.current) * Math.PI) / 180;
      z.label.style.opacity = "1";
      z.label.style.transform = `translate(-50%, -50%) translate(${(Math.sin(a) * 40).toFixed(1)}px, ${(-Math.cos(a) * 40).toFixed(1)}px)`;
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
      if (m.icon === "home") {
        d.className = `goalmark home ${m.tone}`;
        d.setAttribute("role", "img");
        d.setAttribute("aria-label", "Home");
        d.innerHTML = `${HOME_SVG}<span class="goallabel">HOME</span>`;
        return new Marker({ element: d }).setLngLat([m.lon, m.lat]).addTo(map);
      }
      d.textContent = m.label;
      d.setAttribute("aria-label", `Objective ${m.label}`);
      d.style.cssText = `width:28px;height:28px;border-radius:50%;background:${TONE[m.tone]};color:#fff;font:700 14px system-ui;display:flex;align-items:center;justify-content:center;border:2px solid #fff;${m.tone === "next" ? "box-shadow:0 0 0 4px #2563eb66;" : ""}`;
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
