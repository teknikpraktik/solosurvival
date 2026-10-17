// Kompletterar ofullständiga multipolygon-relationer i fixturerna via /relation/<id>/full.
// Hoppar över mycket stora relationer (t.ex. Vänern, >300 medlemmar) – de hanteras i raster.ts med bbox-sluten heuristik.
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";

const UA = "outbreak-solo-survival-research/0.1 (per.a.bjorkman@gmail.com)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cache = new Map();
for (const id of ["skutberget", "i2-skogen", "sormon"]) {
  const f = `experiments/hybrid/fixtures/${id}.osm.json.gz`;
  const doc = JSON.parse(gunzipSync(readFileSync(f)));
  let fixed = 0, skipped = 0;
  for (const rel of doc.elements) {
    if (rel.type !== "relation" || rel.complete) continue;
    if (rel.members.length > 300) { skipped++; continue; }
    let full = cache.get(rel.id);
    if (!full) {
      const res = await fetch(`https://api.openstreetmap.org/api/0.6/relation/${rel.id}/full.json`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(60000) });
      if (!res.ok) { console.error(`relation ${rel.id}: HTTP ${res.status}`); skipped++; continue; }
      const els = (await res.json()).elements;
      const nodes = new Map(els.filter((e) => e.type === "node").map((n) => [n.id, n]));
      const ways = new Map(els.filter((e) => e.type === "way").map((w) => [w.id, w]));
      full = { nodes, ways };
      cache.set(rel.id, full);
      await sleep(1500);
    }
    rel.members = rel.members.filter((m) => m.type === "way").map((m) => {
      const w = full.ways.get(m.ref);
      return { type: "way", ref: m.ref, role: m.role, geometry: w ? w.nodes.map((n) => (full.nodes.get(n) ? { lat: full.nodes.get(n).lat, lon: full.nodes.get(n).lon } : null)) : null };
    });
    rel.complete = rel.members.every((m) => m.geometry && !m.geometry.includes(null));
    if (rel.complete) fixed++; else skipped++;
  }
  writeFileSync(f, gzipSync(JSON.stringify(doc)));
  const mf = f.replace(".osm.json.gz", ".meta.json");
  const meta = JSON.parse(readFileSync(mf, "utf8"));
  meta.relationsCompletedViaFull = fixed; meta.relationsStillIncomplete = skipped;
  writeFileSync(mf, JSON.stringify(meta, null, 2));
  console.log(`${id}: kompletterade ${fixed}, kvar ofullständiga ${skipped}`);
}
