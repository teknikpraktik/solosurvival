// Hämtar OSM-data via det officiella OSM-API:t (/api/0.6/map) i tiles och sparar fixturer.
// Overpass-speglar var blockerade/trasiga/regionala vid hämtningen (se README). Kör: node experiments/hybrid/fetch-osm.mjs [--force]
import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import { gzipSync } from "node:zlib";

const API = "https://api.openstreetmap.org/api/0.6/map.json";
const UA = "outbreak-solo-survival-research/0.1 (per.a.bjorkman@gmail.com)";
const force = process.argv.includes("--force");
const AREAS = {
  skutberget: [59.3588, 13.368, 59.3858, 13.42],
  "i2-skogen": [59.3965, 13.44, 59.4235, 13.492],
  sormon: [59.365, 13.328, 59.392, 13.38],
};
const WANTED = ["highway", "railway", "natural", "landuse", "waterway", "building", "barrier", "leisure"];
const relevant = (t) => t && WANTED.some((k) => k in t);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function tile(b, depth = 0) {
  const [s, w, n, e] = b;
  const url = `${API}?bbox=${w},${s},${e},${n}`;
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(120_000) });
  if (res.status === 400 && depth < 3) {
    // Över 50 000 noder: dela tilen.
    const ms = (s + n) / 2, mw = (w + e) / 2;
    const parts = [[s, w, ms, mw], [s, mw, ms, e], [ms, w, n, mw], [ms, mw, n, e]];
    const out = [];
    for (const p of parts) { await sleep(2000); out.push(...(await tile(p, depth + 1))); }
    return out;
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} för ${url}: ${(await res.text()).slice(0, 120)}`);
  return (await res.json()).elements;
}

mkdirSync("experiments/hybrid/fixtures", { recursive: true });
for (const [id, bbox] of Object.entries(AREAS)) {
  const out = `experiments/hybrid/fixtures/${id}.osm.json.gz`;
  if (existsSync(out) && !force) { console.log(`${id}: cachad, hoppar över`); continue; }
  const [s, w, n, e] = bbox;
  const ms = (s + n) / 2, mw = (w + e) / 2;
  const tiles = [[s, w, ms, mw], [s, mw, ms, e], [ms, w, n, mw], [ms, mw, n, e]];
  const nodes = new Map(), ways = new Map(), rels = new Map();
  let requests = 0;
  for (const t of tiles) {
    for (const el of await tile(t)) {
      if (el.type === "node") nodes.set(el.id, el);
      else if (el.type === "way") ways.set(el.id, el);
      else if (el.type === "relation") rels.set(el.id, el);
    }
    requests++;
    await sleep(3000);
  }
  // Konvertera till Overpass-`out geom`-liknande format med geometri på way/relation-medlemmar.
  const geom = (w) => w.nodes.map((nid) => (nodes.get(nid) ? { lat: nodes.get(nid).lat, lon: nodes.get(nid).lon } : null));
  const elements = [];
  for (const w of ways.values()) {
    if (!relevant(w.tags)) continue;
    elements.push({ type: "way", id: w.id, nodes: w.nodes, geometry: geom(w), tags: w.tags, version: w.version, timestamp: w.timestamp });
  }
  for (const r of rels.values()) {
    if (!relevant(r.tags) || r.tags.type !== "multipolygon") continue;
    const members = r.members.filter((m) => m.type === "way").map((m) => {
      const w = ways.get(m.ref);
      return { type: "way", ref: m.ref, role: m.role, geometry: w ? geom(w) : null };
    });
    elements.push({ type: "relation", id: r.id, tags: r.tags, members, complete: members.every((m) => m.geometry && !m.geometry.includes(null)) });
  }
  const payload = JSON.stringify({ source: "api.openstreetmap.org /api/0.6/map", elements });
  writeFileSync(out, gzipSync(payload));
  const counts = {};
  for (const el of elements) counts[el.type] = (counts[el.type] ?? 0) + 1;
  writeFileSync(`experiments/hybrid/fixtures/${id}.meta.json`, JSON.stringify({
    area: id, bbox, bboxOrder: "south,west,north,east", endpoint: API,
    fetchedAt: new Date().toISOString(), tilesRequested: requests,
    rawNodes: nodes.size, rawWays: ways.size, rawRelations: rels.size,
    keptElements: counts, keptBytes: Buffer.byteLength(payload),
    license: "ODbL 1.0 – © OpenStreetMap contributors (https://www.openstreetmap.org/copyright)",
    limitations: [
      "/map returnerar ways som har minst en nod i rutan; ways utanför kan vara beskurna av rutans kant bara i det avseende att deras noder utanför ingår",
      "Multipolygon-relationer kan sakna medlemsways som ligger utanför rutan (complete=false)",
      "Rutan klipps inte exakt; objekt strax utanför kan ingå",
    ],
  }, null, 2));
  console.log(`${id}: nodes ${nodes.size}, ways ${ways.size}, rels ${rels.size}, kept ${JSON.stringify(counts)}, ${(Buffer.byteLength(payload) / 1e6).toFixed(2)} MB`);
}
