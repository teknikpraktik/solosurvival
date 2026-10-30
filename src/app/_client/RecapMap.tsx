"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { Map as MapLibreMap, Marker, setWorkerUrl, type GeoJSONSource } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import { haversineM, type LatLon } from "@/geo/geometry";
import { positionAt, type RecapMark, type Track } from "@/play/recap";
import { MAP_ATTRIBUTION, MAP_STYLE } from "./mapStyle";
import { EXTRACTION_SVG, HOME_SVG } from "./symbols";

const fc = (features: GeoJSON.Feature[] = []): GeoJSON.FeatureCollection => ({ type: "FeatureCollection", features });
/** Faster than this between two samples (m/s) is a jump (GPS reacquired, zombie moved by the game), not movement: the line is broken there. */
const JUMP_MPS = 40;
/** A track (samples from..to) as lines, broken at jumps; `until` adds the position between samples so the line reaches the dot. */
function linesOf(tr: Track, from = 0, to = tr.t.length, until?: LatLon | null): GeoJSON.Feature {
  const parts: [number, number][][] = [];
  let cur: [number, number][] = [];
  for (let i = from; i < to; i++) {
    if (i > from && haversineM({ lat: tr.lat[i - 1], lon: tr.lon[i - 1] }, { lat: tr.lat[i], lon: tr.lon[i] }) > JUMP_MPS * Math.max(1, tr.t[i] - tr.t[i - 1])) { parts.push(cur); cur = []; }
    cur.push([tr.lon[i], tr.lat[i]]);
  }
  if (until && cur.length) cur.push([until.lon, until.lat]);
  parts.push(cur);
  return { type: "Feature", properties: { id: tr.id }, geometry: { type: "MultiLineString", coordinates: parts.filter((p) => p.length > 1) } };
}
const pointOf = (p: LatLon, props: Record<string, unknown>): GeoJSON.Feature => ({ type: "Feature", properties: props, geometry: { type: "Point", coordinates: [p.lon, p.lat] } });
/** Index of the last sample at or before t. */
const upTo = (tr: Track, t: number) => { let lo = 0, hi = tr.t.length; while (lo < hi) { const m = (lo + hi) >> 1; if (tr.t[m] <= t) lo = m + 1; else hi = m; } return lo; };
/** Zombie trail shown brightly behind each zombie (s). */
const TAIL_S = 90;

export interface RecapMapProps {
  player: Track;
  zombies: Track[];
  /** Game time shown (s). */
  t: number;
  start: LatLon | null;
  end: LatLon | null;
  captured: boolean;
  targets: RecapMark[];
  extraction: LatLon | null;
}

/**
 * The match on a map: the whole player track (faint) and the part up to `t` (bright), every zombie's track (thin, faint) with a bright tail
 * behind its position at `t`, and start, checkpoints, home, extraction and where it ended.
 */
export default function RecapMap(props: RecapMapProps) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [loaded, setLoaded] = useState(false);
  const { player, zombies, t } = props;

  useEffect(() => {
    if (!el.current) return;
    setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
    const c = props.start ?? (player.t.length ? { lat: player.lat[0], lon: player.lon[0] } : { lat: 59.38, lon: 13.5 });
    const map = new MapLibreMap({ container: el.current, style: MAP_STYLE, center: [c.lon, c.lat], zoom: 14, minZoom: 9, maxZoom: 18, attributionControl: false, dragRotate: false, pitchWithRotate: false, fadeDuration: 0, pixelRatio: Math.min(window.devicePixelRatio || 1, 2) });
    mapRef.current = map;
    map.on("load", () => {
      map.addSource("ztracks", { type: "geojson", data: fc() });
      map.addLayer({ id: "ztracks", type: "line", source: "ztracks", paint: { "line-color": "#ef4444", "line-width": 1.5, "line-opacity": 0.3 } });
      map.addSource("ztails", { type: "geojson", data: fc() });
      map.addLayer({ id: "ztails", type: "line", source: "ztails", paint: { "line-color": "#ff4d4d", "line-width": 3, "line-opacity": 0.85 }, layout: { "line-cap": "round", "line-join": "round" } });
      map.addSource("ptrack", { type: "geojson", data: fc() });
      map.addLayer({ id: "ptrack", type: "line", source: "ptrack", paint: { "line-color": "#60a5fa", "line-width": 3, "line-opacity": 0.35 }, layout: { "line-cap": "round", "line-join": "round" } });
      map.addSource("pnow", { type: "geojson", data: fc() });
      map.addLayer({ id: "pnow", type: "line", source: "pnow", paint: { "line-color": "#3b82f6", "line-width": 5 }, layout: { "line-cap": "round", "line-join": "round" } });
      map.addSource("dots", { type: "geojson", data: fc() });
      map.addLayer({ id: "dots", type: "circle", source: "dots", paint: {
        "circle-radius": ["case", ["get", "player"], 8, 6], "circle-color": ["case", ["get", "player"], "#2563eb", "#ef4444"],
        "circle-stroke-color": "#ffffff", "circle-stroke-width": ["case", ["get", "player"], 2.5, 1.5],
      } });
      setLoaded(true);
    });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => map.resize()) : null;
    ro?.observe(el.current);
    return () => { ro?.disconnect(); map.remove(); mapRef.current = null; setLoaded(false); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Whole tracks and the view: when the tracks change (zombie filter).
  useEffect(() => {
    const map = mapRef.current;
    if (!loaded || !map) return;
    (map.getSource("ptrack") as GeoJSONSource).setData(fc([linesOf(player)]));
    (map.getSource("ztracks") as GeoJSONSource).setData(fc(zombies.map((z) => linesOf(z))));
    const lons = player.lon.concat(...zombies.map((z) => z.lon)), lats = player.lat.concat(...zombies.map((z) => z.lat));
    if (lons.length) map.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], { padding: 36, duration: 0, maxZoom: 16 });
  }, [loaded, player, zombies]);

  // Marks.
  useEffect(() => {
    const map = mapRef.current;
    if (!loaded || !map) return;
    const ms: Marker[] = [];
    const add = (p: LatLon, html: string, label: string) => {
      const d = document.createElement("div");
      d.innerHTML = html;
      d.setAttribute("role", "img");
      d.setAttribute("aria-label", label);
      ms.push(new Marker({ element: d }).setLngLat([p.lon, p.lat]).addTo(map));
    };
    const disc = (text: string, bg: string) => `<div style="width:26px;height:26px;border-radius:50%;background:${bg};color:#fff;font:700 13px system-ui;display:flex;align-items:center;justify-content:center;border:2px solid #fff">${text}</div>`;
    if (props.start) add(props.start, disc("S", "#0b0f14"), "Start");
    let n = 0;
    for (const m of props.targets) {
      if (m.kind === "home") add(m, HOME_SVG, "Home");
      else add(m, disc(m.kind === "destination" ? "B" : String(++n), m.reachedAtS !== null ? "#16a34a" : "#475569"), m.kind === "destination" ? "B" : `Checkpoint ${n}`);
    }
    if (props.extraction) add(props.extraction, EXTRACTION_SVG, "Extraction");
    if (props.end && props.captured) add(props.end, disc("✕", "#b91c1c"), "Captured here");
    return () => ms.forEach((m) => m.remove());
  }, [loaded, props.start, props.end, props.captured, props.targets, props.extraction]);

  // Time: the player's track so far, every zombie's tail, and where everyone is.
  useEffect(() => {
    const map = mapRef.current;
    if (!loaded || !map) return;
    const pi = upTo(player, t);
    const pp = positionAt(player, t);
    (map.getSource("pnow") as GeoJSONSource).setData(fc([linesOf(player, 0, pi, pp)]));
    const tails: GeoJSON.Feature[] = [];
    const dots: GeoJSON.Feature[] = [];
    for (const z of zombies) {
      const p = positionAt(z, t);
      if (!p) continue;
      dots.push(pointOf(p, { player: false }));
      tails.push(linesOf(z, upTo(z, t - TAIL_S), upTo(z, t), p));
    }
    if (pp) dots.push(pointOf(pp, { player: true }));
    (map.getSource("ztails") as GeoJSONSource).setData(fc(tails));
    (map.getSource("dots") as GeoJSONSource).setData(fc(dots));
  }, [loaded, player, zombies, t]);

  return (
    <div className="recapmap">
      <div ref={el} className="map-canvas" data-testid="recap-map" data-loaded={loaded} />
      <a className="attrib" href={MAP_ATTRIBUTION.href} target="_blank" rel="noreferrer">{MAP_ATTRIBUTION.text}</a>
    </div>
  );
}
