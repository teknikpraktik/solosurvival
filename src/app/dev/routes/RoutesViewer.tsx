"use client";

// Utvecklingsverktyg för etapp 2.5: genererade rutter och simulerade matcher i de tre spellägena.
// Kräver förbakad data: `npx tsx experiments/routes/export-viz.ts`.
import "maplibre-gl/dist/maplibre-gl.css";
import { Map as MapLibreMap, Marker, setWorkerUrl, type GeoJSONSource, type StyleSpecification } from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Activity } from "@/config/activities";
import type { Difficulty } from "@/config/difficulty";
import { STEP_S } from "@/config/game-rules";
import { zombieLatLon } from "@/engine/core/movement";
import { type GameMode } from "@/engine/objectives/objectives";
import { edgeLatLon, indexGraph, nodeLatLon } from "@/geo/graph/graph";
import type { SerializedGraph, TrailGraph } from "@/geo/graph/types";
import { generateRoutes } from "@/routes/generate";
import { objectivesFromProposal } from "@/routes/objectives";
import { estimateTimeLimitS } from "@/routes/timing";
import type { RouteProposal } from "@/routes/types";
import { makeGoalBot, newBotStats, type BotStats } from "@/sim/bots";
import { SimSession } from "@/sim/runner";
import { randomStart } from "@/sim/start";

const STYLE: StyleSpecification = { version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#0b0f14" } }] };
const fc = (features: GeoJSON.Feature[] = []): GeoJSON.FeatureCollection => ({ type: "FeatureCollection", features });
const pt = (p: { lat: number; lon: number }, props: Record<string, unknown> = {}): GeoJSON.Feature => ({ type: "Feature", properties: props, geometry: { type: "Point", coordinates: [p.lon, p.lat] } });
const line = (pts: { lat: number; lon: number }[], props: Record<string, unknown> = {}): GeoJSON.Feature => ({ type: "Feature", properties: props, geometry: { type: "LineString", coordinates: pts.map((p) => [p.lon, p.lat]) } });
const ROUTE_COLORS = ["#22d3ee", "#a78bfa", "#facc15"];
const DEFAULT_KM: Record<Activity, number> = { walk: 2, run: 4, mtb: 6 };

interface Net { g: TrailGraph; hazard: Set<string> }

export default function RoutesViewer() {
  const el = useRef<HTMLDivElement>(null);
  const [areas, setAreas] = useState<{ id: string; name: string }[]>([]);
  const [area, setArea] = useState("sormon");
  const [mode, setMode] = useState<GameMode>("mission");
  const [activity, setActivity] = useState<Activity>("run");
  const [difficulty, setDifficulty] = useState<Difficulty>("normal");
  const [km, setKm] = useState(DEFAULT_KM.run);
  const [minutes, setMinutes] = useState(45);
  const [seed, setSeed] = useState(1);
  const [cps, setCps] = useState<0 | 1 | 2 | 3>(0);
  const [bot, setBot] = useState<"planner" | "follower">("planner");
  const [speed, setSpeed] = useState(30);
  const [sel, setSel] = useState(0);
  const [play, setPlay] = useState(false);
  const [runId, setRunId] = useState(0);
  const [open, setOpen] = useState(true);
  const [net, setNet] = useState<Net | null>(null);
  const [err, setErr] = useState("");
  const [hud, setHud] = useState({ phase: "", t: 0, limit: 0, z: 0, res: "", idx: 0, total: 0, hold: 0, blocked: 0 });
  const speedRef = useRef(speed); speedRef.current = speed;

  useEffect(() => { fetch("/dev-routes/index.json").then((r) => r.json()).then((d) => setAreas(d.areas)).catch(() => setErr("Saknar data. Kör: npx tsx experiments/routes/export-viz.ts")); }, []);
  useEffect(() => {
    setNet(null);
    fetch(`/dev-routes/${area}.${activity === "mtb" ? "mtb" : "run"}.json`).then((r) => r.json()).then((d: { graph: SerializedGraph; hazardNodes: string[] }) => setNet({ g: indexGraph(d.graph), hazard: new Set(d.hazardNodes) })).catch((e) => setErr(String(e)));
  }, [area, activity]);

  const start = useMemo(() => (net ? randomStart(net.g, seed) : null), [net, seed]);
  const gen = useMemo(() => {
    if (!net || !start || mode === "survival") return null;
    return generateRoutes(net.g, { start, activity, mode, targetLengthM: km * 1000, seed, hazardNodes: net.hazard, checkpoints: cps || undefined });
  }, [net, start, mode, activity, km, seed, cps]);
  const proposals = gen?.proposals ?? [];
  const chosen: RouteProposal | undefined = proposals[Math.min(sel, proposals.length - 1)];
  useEffect(() => { setSel(0); setPlay(false); }, [gen]);

  // Karta + simulering.
  useEffect(() => {
    if (!el.current || !net || !start) return;
    setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
    const g = net.g;
    const map = new MapLibreMap({ container: el.current, style: STYLE, center: [start.lon, start.lat], zoom: 14.3, attributionControl: false });
    const markers: Marker[] = [];
    let raf = 0;
    let session: SimSession | null = null;
    const stats: BotStats = newBotStats();
    const limitS = mode === "survival" ? minutes * 60 : chosen ? estimateTimeLimitS(chosen.lengthM, activity, difficulty, chosen.waypoints.length) : 0;
    if (play && (mode === "survival" || chosen)) {
      session = new SimSession({
        g, activity, difficulty, durationS: limitS, seed, strategy: "avoid", start, mode,
        objectives: chosen && mode !== "survival" ? objectivesFromProposal(chosen) : undefined,
        strategyFn: makeGoalBot(bot, stats, chosen?.path), initialDir: chosen?.path[0]?.dir,
      });
    }
    map.on("load", () => {
      map.addSource("net", { type: "geojson", data: fc([...g.edges.values()].map((e) => line(e.geometry))) });
      map.addLayer({ id: "net", type: "line", source: "net", paint: { "line-color": "#3a4859", "line-width": 1.5 } });
      map.addSource("routes", { type: "geojson", data: fc(proposals.map((p, i) => line(p.geometry, { i, sel: i === Math.min(sel, proposals.length - 1) }))) });
      map.addLayer({ id: "routes", type: "line", source: "routes", paint: { "line-color": ["match", ["get", "i"], 0, ROUTE_COLORS[0], 1, ROUTE_COLORS[1], ROUTE_COLORS[2]], "line-width": ["case", ["get", "sel"], 4.5, 2], "line-opacity": ["case", ["get", "sel"], 0.95, 0.45] } });
      for (const id of ["zombies", "player", "extraction", "start"]) map.addSource(id, { type: "geojson", data: fc() });
      map.addLayer({ id: "zombies", type: "circle", source: "zombies", paint: { "circle-radius": 6, "circle-color": "#ef4444", "circle-stroke-color": "#fff", "circle-stroke-width": 1 } });
      map.addLayer({ id: "extraction", type: "circle", source: "extraction", paint: { "circle-radius": 9, "circle-color": "#22d3ee", "circle-opacity": 0.85 } });
      map.addLayer({ id: "start", type: "circle", source: "start", paint: { "circle-radius": 6, "circle-color": "#0b0f14", "circle-stroke-color": "#e6edf3", "circle-stroke-width": 2 } });
      map.addLayer({ id: "player", type: "circle", source: "player", paint: { "circle-radius": 7, "circle-color": "#3b82f6", "circle-stroke-color": "#fff", "circle-stroke-width": 2 } });
      (map.getSource("start") as GeoJSONSource).setData(fc([pt(start)]));
      (map.getSource("player") as GeoJSONSource).setData(fc([pt(start)]));
      if (chosen) for (const w of chosen.waypoints) {
        if (w.kind === "home") continue;
        const d = document.createElement("div");
        d.textContent = w.kind === "destination" ? "B" : w.id.replace("C", "");
        d.style.cssText = "width:24px;height:24px;border-radius:50%;background:#16a34a;color:#fff;font:700 13px system-ui;display:flex;align-items:center;justify-content:center;border:2px solid #fff";
        markers.push(new Marker({ element: d }).setLngLat([w.lon, w.lat]).addTo(map));
      }
      if (proposals.length && !play) {
        const b = proposals[0].geometry;
        const lons = b.map((p) => p.lon), lats = b.map((p) => p.lat);
        map.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], { padding: 60, duration: 0 });
      }
      let last = performance.now(), acc = 0, lastHud = 0;
      const frame = (now: number) => {
        if (session) {
          acc = Math.min(acc + ((now - last) / 1000) * speedRef.current, 5);
          while (acc >= STEP_S && !session.finished) { session.step(); acc -= STEP_S; }
          const s = session.state;
          const me = edgeLatLon(g, session.pos);
          map.jumpTo({ center: [me.lon, me.lat] });
          (map.getSource("zombies") as GeoJSONSource).setData(fc(s.zombies.map((z) => pt(zombieLatLon(g, z)))));
          (map.getSource("player") as GeoJSONSource).setData(fc([pt(me)]));
          (map.getSource("extraction") as GeoJSONSource).setData(fc(s.extractionNodeId ? [pt(nodeLatLon(g, s.extractionNodeId))] : []));
          if (now - lastHud > 200) {
            setHud({ phase: s.phase, t: s.elapsedSeconds, limit: limitS, z: s.zombies.length, res: s.result ?? "", idx: s.objectives?.index ?? 0, total: s.objectives?.targets.length ?? 0, hold: s.objectives?.holdS ?? 0, blocked: stats.blocked });
            lastHud = now;
          }
        }
        last = now;
        raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
    });
    return () => { cancelAnimationFrame(raf); markers.forEach((m) => m.remove()); map.remove(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [net, start, gen, sel, play, runId, mode, activity, difficulty, bot, minutes]);

  const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
  return (
    <div className="map-shell">
      <div ref={el} style={{ position: "absolute", inset: 0 }} />
      <div className="hud">
        <span className="pill">{mode.toUpperCase()}{play ? ` · ${hud.res ? hud.res.toUpperCase() : hud.phase.replace("survival", "jakt").toUpperCase()}` : ""}</span>
        {play && <span className="pill">{fmt(hud.t)} / {fmt(hud.limit)}</span>}
        {play && hud.total > 0 && <span className="pill">{hud.idx}/{hud.total}{hud.hold > 0 ? ` · ${hud.hold.toFixed(0)}s` : ""}</span>}
        {play && <span className="pill" style={{ color: "#ef4444" }}>{hud.z} Z</span>}
        <button className="pill" onClick={() => setOpen((o) => !o)} style={{ color: "inherit" }}>⚙</button>
      </div>
      {err && <div style={{ position: "absolute", top: 70, left: 12, right: 12, zIndex: 6, color: "#fca5a5" }}>{err}</div>}
      {open && (
        <div className="panel" style={{ zIndex: 7, maxHeight: "55vh", overflowY: "auto" }}>
          <select aria-label="Område" value={area} onChange={(e) => setArea(e.target.value)}>{areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
          <select aria-label="Spelläge" value={mode} onChange={(e) => setMode(e.target.value as GameMode)}><option value="escape">ESCAPE A→B</option><option value="mission">MISSION A→A</option><option value="survival">SURVIVAL</option></select>
          <select aria-label="Aktivitet" value={activity} onChange={(e) => { const a = e.target.value as Activity; setActivity(a); setKm(DEFAULT_KM[a]); }}><option value="walk">Promenad</option><option value="run">Löpning</option><option value="mtb">MTB</option></select>
          <select aria-label="Svårighet" value={difficulty} onChange={(e) => setDifficulty(e.target.value as Difficulty)}><option value="easy">Lätt</option><option value="normal">Normal</option><option value="hard">Svår</option></select>
          {mode !== "survival" ? (
            <label className="hint">Distans {km} km<input type="range" min={1} max={12} step={0.5} value={km} onChange={(e) => setKm(Number(e.target.value))} /></label>
          ) : (
            <label className="hint">Matchtid {minutes} min<input type="range" min={20} max={90} step={5} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} /></label>
          )}
          {mode === "mission" && <select aria-label="Checkpoints" value={cps} onChange={(e) => setCps(Number(e.target.value) as 0 | 1 | 2 | 3)}><option value={0}>Checkpoints: auto</option><option value={1}>1</option><option value={2}>2</option><option value={3}>3</option></select>}
          <select aria-label="Bot" value={bot} onChange={(e) => setBot(e.target.value as "planner" | "follower")}><option value="planner">Bot: planerare</option><option value="follower">Bot: ruttföljare</option></select>
          <select aria-label="Hastighet" value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>{[1, 5, 30, 90, 200].map((s) => <option key={s} value={s}>{s}×</option>)}</select>
          <button onClick={() => setSeed((s) => s + 1)}>Seed {seed} → {seed + 1}</button>
          <button className="grow" onClick={() => { setPlay(true); setRunId((r) => r + 1); }}>▶ Starta simulerad match</button>
          {play && <button onClick={() => setPlay(false)}>Stopp</button>}
          {mode !== "survival" && (
            <div className="hint grow" style={{ width: "100%" }}>
              {gen?.notes.map((n, i) => <div key={i} style={{ color: "#fdba74" }}>{n}</div>)}
              {proposals.map((p, i) => (
                <button key={p.id} onClick={() => { setSel(i); setPlay(false); }} style={{ display: "block", width: "100%", textAlign: "left", margin: "4px 0", borderColor: i === Math.min(sel, proposals.length - 1) ? ROUTE_COLORS[i % 3] : undefined }}>
                  <b style={{ color: ROUTE_COLORS[i % 3] }}>{i + 1}</b> {p.type} · {(p.lengthM / 1000).toFixed(2)} km ({(p.deviation * 100).toFixed(1)} %) · {p.waypoints.filter((w) => w.kind !== "home").length} mål · kvalitet {p.quality.score}
                  {p.quality.flags.length > 0 && <span style={{ color: "#fdba74" }}> · {p.quality.flags.join("; ")}</span>}
                  <span> · upprep. {(p.metrics.reuseShare * 100).toFixed(0)} % · återvänd. {(p.metrics.deadEndShare * 100).toFixed(0)} % · vägval {p.metrics.decisionPoints}</span>
                </button>
              ))}
              {gen && <div>Genererat på {gen.stats.ms.toFixed(0)} ms ({gen.stats.evaluated} utvärderade). Tidsgräns {chosen ? fmt(estimateTimeLimitS(chosen.lengthM, activity, difficulty, chosen.waypoints.length)) : "–"}.</div>}
            </div>
          )}
          {play && <div className="hint" style={{ width: "100%" }}>Blockerade vägval hittills: {hud.blocked}. Svagt streck = alternativa rutter; vit ring = start; grön = destination/checkpoint.</div>}
        </div>
      )}
    </div>
  );
}
