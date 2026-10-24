"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { Map as MapLibreMap, setWorkerUrl, type GeoJSONSource, type StyleSpecification } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import type { Activity } from "@/config/activities";
import type { Difficulty } from "@/config/difficulty";
import { zombieLatLon } from "@/engine/core/movement";
import { STEP_S } from "@/config/game-rules";
import { edgeLatLon, nodeLatLon } from "@/geo/graph/graph";
import { SimSession, type StrategyName } from "@/sim/runner";
import { gridGraph } from "@/sim/test-graphs";

// Utan karttjänst: mörk bakgrund + själva stignätet. En riktig kartleverantör kan anges via NEXT_PUBLIC_MAP_STYLE.
const BLANK_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: "bg", type: "background", paint: { "background-color": "#0b0f14" } }],
};

const fc = (features: GeoJSON.Feature[] = []): GeoJSON.FeatureCollection => ({ type: "FeatureCollection", features });
const pt = (p: { lat: number; lon: number }, props: Record<string, unknown> = {}): GeoJSON.Feature => ({
  type: "Feature",
  properties: props,
  geometry: { type: "Point", coordinates: [p.lon, p.lat] },
});

const CELL: Record<Activity, number> = { walk: 90, run: 130, mtb: 200 };

export default function SimMap() {
  const el = useRef<HTMLDivElement>(null);
  const [activity, setActivity] = useState<Activity>("run");
  const [difficulty, setDifficulty] = useState<Difficulty>("normal");
  const [strategy, setStrategy] = useState<StrategyName>("extraction");
  const [speedup, setSpeedup] = useState(20);
  const [seed, setSeed] = useState(1);
  const [open, setOpen] = useState(false);
  const [hud, setHud] = useState({ phase: "", t: 0, threats: 0, infect: 0, result: "" });
  const speedRef = useRef(speedup);
  speedRef.current = speedup;

  useEffect(() => {
    if (!el.current) return;
    const g = gridGraph(18, 18, CELL[activity]);
    const session = new SimSession({ g, activity, difficulty, durationS: 2700, seed, strategy });
    const centre = edgeLatLon(g, { edgeId: "r9:8", distM: 0 });

    const map = createMap(el.current, centre);
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    let lastHud = 0;

    const network: GeoJSON.Feature[] = [...g.edges.values()].map((e) => ({
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: e.geometry.map((p) => [p.lon, p.lat]) },
    }));

    map.on("load", () => {
      map.addSource("net", { type: "geojson", data: fc(network) });
      map.addLayer({ id: "net", type: "line", source: "net", paint: { "line-color": "#2a3645", "line-width": 2 } });
      for (const id of ["zombies", "player", "extraction"]) map.addSource(id, { type: "geojson", data: fc() });
      map.addLayer({ id: "infect", type: "circle", source: "zombies", paint: { "circle-radius": ["interpolate", ["exponential", 2], ["zoom"], 12, 1, 18, 40], "circle-color": "#ef4444", "circle-opacity": 0.1 } });
      map.addLayer({ id: "zombies", type: "circle", source: "zombies", paint: { "circle-radius": 6, "circle-color": "#ef4444", "circle-stroke-color": "#fff", "circle-stroke-width": 1 } });
      map.addLayer({ id: "extraction", type: "circle", source: "extraction", paint: { "circle-radius": 9, "circle-color": "#22d3ee", "circle-opacity": 0.85 } });
      map.addLayer({ id: "player", type: "circle", source: "player", paint: { "circle-radius": 7, "circle-color": "#3b82f6", "circle-stroke-color": "#fff", "circle-stroke-width": 2 } });

      const frame = (now: number) => {
        acc += ((now - last) / 1000) * speedRef.current;
        last = now;
        // Begränsa uppställt arbete så att en bakgrundsflik inte hoppar fram okontrollerat (PRD 13.3).
        acc = Math.min(acc, 5);
        while (acc >= STEP_S && !session.finished) {
          session.step();
          acc -= STEP_S;
        }
        const s = session.state;
        (map.getSource("zombies") as GeoJSONSource).setData(fc(s.zombies.map((z) => pt(zombieLatLon(g, z), { state: z.state }))));
        const me = edgeLatLon(g, session.pos);
        (map.getSource("player") as GeoJSONSource).setData(fc([pt(me)]));
        // Kartan följer spelaren som standard (PRD 11.3).
        map.setCenter([me.lon, me.lat]);
        (map.getSource("extraction") as GeoJSONSource).setData(fc(s.extractionNodeId ? [pt(nodeLatLon(g, s.extractionNodeId))] : []));
        if (now - lastHud > 250) {
          lastHud = now;
          setHud({ phase: s.phase, t: s.elapsedSeconds, threats: s.zombies.length, infect: s.infectionProgressSeconds, result: s.result ?? "" });
        }
        raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
    });

    return () => {
      cancelAnimationFrame(raf);
      map.remove();
    };
  }, [activity, difficulty, strategy, seed]);

  const mm = Math.floor(hud.t / 60);
  const ss = String(Math.floor(hud.t % 60)).padStart(2, "0");
  return (
    <div className="map-shell">
      <div ref={el} style={{ position: "absolute", inset: 0 }} />
      <div className="hud">
        <span className="pill">{hud.result ? hud.result.toUpperCase() : hud.phase.toUpperCase()}</span>
        <span className="pill">{mm}:{ss}</span>
        <span className="pill threat">{hud.threats} THREATS{hud.infect > 0 ? ` · ${hud.infect.toFixed(1)}s` : ""}</span>
        <button className="pill" aria-expanded={open} onClick={() => setOpen((o) => !o)} style={{ color: "inherit" }}>⚙</button>
      </div>
      {open && <div className="panel">
        <select aria-label="Aktivitet" value={activity} onChange={(e) => setActivity(e.target.value as Activity)}>
          <option value="walk">Promenad</option><option value="run">Löpning</option><option value="mtb">MTB</option>
        </select>
        <select aria-label="Svårighet" value={difficulty} onChange={(e) => setDifficulty(e.target.value as Difficulty)}>
          <option value="easy">Lätt</option><option value="normal">Normal</option><option value="hard">Svår</option>
        </select>
        <select aria-label="Spelarstrategi" value={strategy} onChange={(e) => setStrategy(e.target.value as StrategyName)}>
          <option value="extraction">Mot extraction</option><option value="avoid">Undvik närmaste</option>
          <option value="maximize">Maximera avstånd</option><option value="random">Slumpmässig</option>
        </select>
        <select aria-label="Hastighet" value={speedup} onChange={(e) => setSpeedup(Number(e.target.value))}>
          <option value={1}>1×</option><option value={5}>5×</option><option value={20}>20×</option><option value={60}>60×</option>
        </select>
        <button className="grow" onClick={() => setSeed((s) => s + 1)}>Ny match (seed {seed + 1})</button>
        <span className="hint grow">Simulerad spelare på syntetiskt nät – ingen verklig GPS. Rött = zombier, blått = spelare, cyan = extraction.</span>
      </div>}
    </div>
  );
}

function createMap(container: HTMLElement, centre: { lat: number; lon: number }) {
  setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
  return new MapLibreMap({
    container,
    style: process.env.NEXT_PUBLIC_MAP_STYLE || BLANK_STYLE,
    center: [centre.lon, centre.lat],
    zoom: 14.2,
    attributionControl: { compact: true },
  });
}
