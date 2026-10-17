"use client";

// Utvecklingsverktyg för hybrid-AI-studien. Kräver förbakad data: `npx tsx experiments/hybrid/export-viz.ts`.
import "maplibre-gl/dist/maplibre-gl.css";
import { Map as MapLibreMap, setWorkerUrl, type GeoJSONSource, type StyleSpecification } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import { STEP_S } from "@/config/game-rules";
import type { Activity } from "@/config/activities";
import type { Difficulty } from "@/config/difficulty";
import { zombieLatLon } from "@/engine/core/movement";
import { edgeLatLon, indexGraph, nodeLatLon } from "@/geo/graph/graph";
import type { SerializedGraph, TrailGraph } from "@/geo/graph/types";
import { createPairedSession, type AnyStrategy, type Density } from "../../../../experiments/hybrid/lib/pairing";
import type { SimSession } from "@/sim/runner";

const STYLE: StyleSpecification = { version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#0b0f14" } }] };
const fc = (features: GeoJSON.Feature[] = []): GeoJSON.FeatureCollection => ({ type: "FeatureCollection", features });
const pt = (p: { lat: number; lon: number }, props: Record<string, unknown> = {}): GeoJSON.Feature => ({ type: "Feature", properties: props, geometry: { type: "Point", coordinates: [p.lon, p.lat] } });
const line = (pts: { lat: number; lon: number }[], props: Record<string, unknown> = {}): GeoJSON.Feature => ({ type: "Feature", properties: props, geometry: { type: "LineString", coordinates: pts.map((p) => [p.lon, p.lat]) } });
const MODELS = ["B1-25", "B2-25", "B3-25", "B2-50", "B2-50-nms", "B2-25-perm"];

interface AreaInfo { id: string; name: string; imageCoords: [number, number][] }
interface Pane { map: MapLibreMap; session: SimSession; g: TrailGraph; label: string; hist: Map<string, { ll: { lat: number; lon: number }; off: boolean }[]>; prevOff: Map<string, boolean>; ready: boolean }

async function load<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}

export default function HybridViewer() {
  const refA = useRef<HTMLDivElement>(null);
  const refB = useRef<HTMLDivElement>(null);
  const [areas, setAreas] = useState<AreaInfo[]>([]);
  const [area, setArea] = useState("sormon");
  const [activity, setActivity] = useState<Activity>("run");
  const [difficulty, setDifficulty] = useState<Difficulty>("hard");
  const [strategy, setStrategy] = useState<AnyStrategy>("planner-trail");
  const [density, setDensity] = useState<Density>("normal");
  const [model, setModel] = useState("B2-50");
  const [seed, setSeed] = useState(1);
  const [speed, setSpeed] = useState(30);
  const [duration, setDuration] = useState(2700);
  const [compare, setCompare] = useState(true);
  const [terrain, setTerrain] = useState(true);
  const [open, setOpen] = useState(false);
  const [playing, setPlaying] = useState(true);
  const [err, setErr] = useState("");
  const [hud, setHud] = useState<{ label: string; phase: string; t: number; z: number; off: number; res: string; links: number }[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const speedRef = useRef(speed); speedRef.current = speed;
  const playRef = useRef(playing); playRef.current = playing;
  const terrainRef = useRef(terrain); terrainRef.current = terrain;
  const mapsRef = useRef<MapLibreMap[]>([]);

  useEffect(() => { load<{ areas: AreaInfo[] }>("/dev-hybrid/index.json").then((d) => setAreas(d.areas)).catch(() => setErr("Saknar data. Kör: npx tsx experiments/hybrid/export-viz.ts")); }, []);

  useEffect(() => {
    const info = areas.find((a) => a.id === area);
    if (!info || !refA.current) return;
    setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
    let raf = 0;
    let cancelled = false;
    const panes: Pane[] = [];
    const logLines: string[] = [];

    (async () => {
      const base = indexGraph(await load<SerializedGraph>(`/dev-hybrid/${area}.${activity}.trail.json`));
      const hyb = indexGraph(await load<SerializedGraph>(`/dev-hybrid/${area}.${activity}.${model}.json`));
      if (cancelled) return;
      const common = { base, activity, difficulty, durationS: duration, strategy, density, seed };
      const a = createPairedSession({ ...common, g: base });
      const b = createPairedSession({ ...common, g: hyb, from: { zombies: a.initial, rng: a.initialRng } });
      const specs = [{ el: refA.current!, g: base, session: a.session, label: "A · stigbunden" }, ...(compare && refB.current ? [{ el: refB.current, g: hyb, session: b.session, label: `${model} · hybrid` }] : [])];
      if (!compare) specs[0] = { el: refA.current!, g: hyb, session: b.session, label: `${model} · hybrid` };
      const centre = edgeLatLon(base, a.session.pos);

      for (const sp of specs) {
        const map = new MapLibreMap({ container: sp.el, style: STYLE, center: [centre.lon, centre.lat], zoom: 14.6, attributionControl: false });
        const pane: Pane = { map, session: sp.session, g: sp.g, label: sp.label, hist: new Map(), prevOff: new Map(), ready: false };
        panes.push(pane);
        mapsRef.current = panes.map((x) => x.map);
        map.on("load", () => {
          map.addSource("terrain", { type: "image", url: `/dev-hybrid/${area}.terrain.png`, coordinates: info.imageCoords as [[number, number], [number, number], [number, number], [number, number]] });
          map.addLayer({ id: "terrain", type: "raster", source: "terrain", paint: { "raster-opacity": 0.55, "raster-fade-duration": 0 }, layout: { visibility: terrainRef.current ? "visible" : "none" } });
          const trail: GeoJSON.Feature[] = [], links: GeoJSON.Feature[] = [];
          for (const e of pane.g.edges.values()) (e.offroad ? links : trail).push(line(e.geometry));
          map.addSource("trail", { type: "geojson", data: fc(trail) });
          map.addSource("links", { type: "geojson", data: fc(links) });
          for (const id of ["zhist", "zombies", "player", "extraction"]) map.addSource(id, { type: "geojson", data: fc() });
          map.addLayer({ id: "trail", type: "line", source: "trail", paint: { "line-color": "#8a99ad", "line-width": 1.5, "line-opacity": 0.8 } });
          map.addLayer({ id: "links", type: "line", source: "links", paint: { "line-color": "#fb923c", "line-width": 2.5, "line-dasharray": [1.5, 1.5] } });
          map.addLayer({ id: "zhist", type: "line", source: "zhist", paint: { "line-color": ["case", ["get", "off"], "#fb923c", "#ef4444"], "line-width": ["case", ["get", "off"], 3, 1.5], "line-opacity": 0.55 } });
          map.addLayer({ id: "zombies", type: "circle", source: "zombies", paint: { "circle-radius": 6, "circle-color": ["case", ["get", "off"], "#fb923c", "#ef4444"], "circle-stroke-color": ["case", ["get", "off"], "#fff", "#7f1d1d"], "circle-stroke-width": ["case", ["get", "off"], 2.5, 1] } });
          map.addLayer({ id: "extraction", type: "circle", source: "extraction", paint: { "circle-radius": 9, "circle-color": "#22d3ee", "circle-opacity": 0.85 } });
          map.addLayer({ id: "player", type: "circle", source: "player", paint: { "circle-radius": 7, "circle-color": "#3b82f6", "circle-stroke-color": "#fff", "circle-stroke-width": 2 } });
          pane.ready = true;
        });
      }

      let last = performance.now(), acc = 0, lastHud = 0, lastHist = 0;
      const frame = (now: number) => {
        const dt = (now - last) / 1000; last = now;
        if (playRef.current) acc = Math.min(acc + dt * speedRef.current, 5);
        else acc = 0;
        const steps: number[] = panes.map(() => 0);
        while (acc >= STEP_S) {
          for (const [i, p] of panes.entries()) if (!p.session.finished) { p.session.step(); steps[i]++; }
          acc -= STEP_S;
        }
        const sampleHist = panes[0]?.session.state.elapsedSeconds - lastHist >= 0.5;
        if (sampleHist) lastHist = panes[0].session.state.elapsedSeconds;
        for (const p of panes) {
          if (!p.ready) continue;
          const s = p.session.state;
          const me = edgeLatLon(base, p.session.pos);
          p.map.jumpTo({ center: [me.lon, me.lat] });
          const zs = s.zombies.map((z) => ({ z, ll: zombieLatLon(p.g, z), off: !!p.g.edges.get(z.edgeId)?.offroad }));
          for (const { z, off } of zs) {
            const prev = p.prevOff.get(z.id);
            if (prev !== undefined && prev !== off) {
              const t = s.elapsedSeconds;
              logLines.push(`${p.label.split(" ")[0]} ${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")} ${z.id} ${off ? "lämnar stigen" : "åter på stig"} (${z.state})`);
              if (logLines.length > 40) logLines.shift();
            }
            p.prevOff.set(z.id, off);
          }
          (p.map.getSource("zombies") as GeoJSONSource).setData(fc(zs.map(({ z, ll, off }) => pt(ll, { off, state: z.state }))));
          (p.map.getSource("player") as GeoJSONSource).setData(fc([pt(me)]));
          (p.map.getSource("extraction") as GeoJSONSource).setData(fc(s.extractionNodeId ? [pt(nodeLatLon(base, s.extractionNodeId))] : []));
          if (sampleHist) {
            const feats: GeoJSON.Feature[] = [];
            for (const { z, ll, off } of zs) {
              const h = p.hist.get(z.id) ?? [];
              h.push({ ll, off });
              if (h.length > 90) h.shift();
              p.hist.set(z.id, h);
              for (let i = 1; i < h.length; i++) feats.push(line([h[i - 1].ll, h[i].ll], { off: h[i].off }));
            }
            (p.map.getSource("zhist") as GeoJSONSource).setData(fc(feats));
          }
        }
        if (now - lastHud > 250) {
          lastHud = now;
          setHud(panes.map((p) => ({ label: p.label, phase: p.session.state.phase, t: p.session.state.elapsedSeconds, z: p.session.state.zombies.length, off: p.session.state.zombies.filter((z) => p.g.edges.get(z.edgeId)?.offroad).length, res: p.session.state.result ?? "", links: [...p.g.edges.values()].filter((e) => e.offroad).length })));
          setLog([...logLines].reverse().slice(0, 6));
        }
        raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
    })().catch((e) => setErr(String(e)));

    return () => { cancelled = true; cancelAnimationFrame(raf); panes.forEach((p) => p.map.remove()); };
  }, [areas, area, activity, difficulty, strategy, density, model, seed, duration, compare]);

  useEffect(() => {
    for (const m of mapsRef.current) if (m.getLayer("terrain")) m.setLayoutProperty("terrain", "visibility", terrain ? "visible" : "none");
  }, [terrain]);

  const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
  return (
    <div className="map-shell" style={{ display: "flex", flexDirection: "column" }}>
      <style>{`.pane{position:relative;flex:1;min-height:0}.tag{position:absolute;left:8px;bottom:8px;z-index:2;background:#131a22e8;border:1px solid #243040;border-radius:10px;padding:6px 10px;font-size:.8rem;font-variant-numeric:tabular-nums}.logbox{position:absolute;right:8px;bottom:64px;z-index:2;max-width:55%;font-size:.7rem;color:#fdba74;text-align:right;line-height:1.3;pointer-events:none}`}</style>
      <div className="hud" style={{ position: "absolute", zIndex: 5 }}>
        <span className="pill">{err ? "Fel" : "HYBRID-AI · experiment"}</span>
        <button className="pill" onClick={() => setPlaying((p) => !p)} style={{ color: "inherit" }}>{playing ? "⏸" : "▶"}</button>
        <button className="pill" aria-expanded={open} onClick={() => setOpen((o) => !o)} style={{ color: "inherit" }}>⚙</button>
      </div>
      {err && <div style={{ position: "absolute", top: 70, left: 12, right: 12, zIndex: 6, color: "#fca5a5" }}>{err}</div>}
      {[0, 1].slice(0, compare ? 2 : 1).map((i) => (
        <div key={i} className="pane" ref={i === 0 ? refA : refB} style={{ position: "relative", flex: 1, minHeight: 0 }}>
          {hud[i] && <div className="tag" style={{ pointerEvents: "none" }}><b>{hud[i].label}</b> · {hud[i].res ? hud[i].res.toUpperCase() : hud[i].phase} · {fmt(hud[i].t)} · {hud[i].z} zombier{hud[i].links ? ` · ${hud[i].off} off-road (${hud[i].links} förb.)` : ""}</div>}
          {i === (compare ? 1 : 0) && <div className="logbox">{log.map((l, k) => <div key={k}>{l}</div>)}</div>}
        </div>
      ))}
      {open && (
        <div className="panel" style={{ zIndex: 7 }}>
          <select aria-label="Område" value={area} onChange={(e) => setArea(e.target.value)}>{areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
          <select aria-label="Aktivitet" value={activity} onChange={(e) => setActivity(e.target.value as Activity)}><option value="run">Löpning</option><option value="mtb">MTB</option></select>
          <select aria-label="Svårighet" value={difficulty} onChange={(e) => setDifficulty(e.target.value as Difficulty)}><option value="easy">Lätt</option><option value="normal">Normal</option><option value="hard">Svår</option></select>
          <select aria-label="Modell B" value={model} onChange={(e) => setModel(e.target.value)}>{MODELS.map((m) => <option key={m}>{m}</option>)}</select>
          <select aria-label="Strategi" value={strategy} onChange={(e) => setStrategy(e.target.value as AnyStrategy)}>{["random", "avoid", "extraction", "planner-trail", "planner-omni"].map((s) => <option key={s}>{s}</option>)}</select>
          <select aria-label="Täthet" value={density} onChange={(e) => setDensity(e.target.value as Density)}><option value="sparse">Gles</option><option value="normal">Normal</option><option value="dense">Tät</option></select>
          <select aria-label="Matchlängd" value={duration} onChange={(e) => setDuration(Number(e.target.value))}><option value={1200}>20 min</option><option value={2700}>45 min</option><option value={3600}>60 min</option></select>
          <select aria-label="Hastighet" value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>{[1, 5, 30, 90, 200].map((s) => <option key={s} value={s}>{s}×</option>)}</select>
          <button onClick={() => setSeed((s) => s + 1)}>Seed {seed} → {seed + 1}</button>
          <button onClick={() => setCompare((c) => !c)}>{compare ? "Visa bara B" : "Jämför A + B"}</button>
          <button onClick={() => setTerrain((t) => !t)}>Terräng {terrain ? "på" : "av"}</button>
          <span className="hint grow">Grå = stig. Orange streckad = off-road-förbindelse. Röd zombie = på stig, orange = i terräng. Terräng: blå vatten, teal våtmark, brun byggnad, rosa barriär, grön skog, ljusgrön öppen mark.</span>
        </div>
      )}
    </div>
  );
}
